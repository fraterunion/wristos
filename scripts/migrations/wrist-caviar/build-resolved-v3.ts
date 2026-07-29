import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import { reconcileAgainstReporte } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/reconciliation/reporte.reconciliation';

import { analyzeWorkbookFile, buildPackage } from './build-package';
import {
  applyBusinessOwnerOverrides,
  isEdgarCreditor,
} from './business-owner-overrides';
import { parseEdgarCxpWorkbook } from './edgar-cxp-parser';
import {
  buildV3CardOverrides,
  buildV3PartnerDefers,
  EDGAR_ORIGINAL_EXCLUDE_IDS,
} from './v3-resolutions-data';
import { LOCAL_ROOT, MIGRATION_SOURCE } from './config';
import { ensureDir, writeJson } from './args';
import { prefix, safeLog, sha256Hex } from './hash';
import { emptyResolutionsTemplate, type ResolutionsFile } from './resolutions.schema';
import { validatePackage } from './validate-package';
import { planImport } from './plan-import';
import { buildPartnerBridge } from './generate-final-packet';

function fileSha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function money(n: number | null | undefined): string {
  if (n == null) return 'null';
  return String(Math.round(Number(n) * 100) / 100);
}

/**
 * Build resolved V3 package: primary workbook + Edgar CXP replacement + business-owner overrides.
 */
export async function buildResolvedV3(params: {
  workbookPath: string;
  edgarPath: string;
  tenantId: string;
  outRoot?: string;
  runDryRun?: boolean;
}): Promise<{
  packageDir: string;
  combinedFingerprint: string;
  dispositionCounts: Record<string, number>;
  conflictCount: number;
}> {
  const primaryHash = fileSha256(params.workbookPath);
  const edgarHash = fileSha256(params.edgarPath);
  const overrides = buildV3CardOverrides();
  const partnerDefers = buildV3PartnerDefers();

  const resolutionsPayload = {
    version: 3,
    migrationSource: MIGRATION_SOURCE,
    actor: 'Wrist Caviar Business Owner',
    date: '2026-07-29',
    notes:
      'V3: business-owner operational corrections + Edgar CXP replacement + partner DEFER_FOR_LATER. Original workbooks unchanged.',
    cardOverrides: overrides,
    partnerDefers,
    edgarOriginalExcludeIds: [...EDGAR_ORIGINAL_EXCLUDE_IDS],
  };
  const resolutionPackageHash = sha256Hex(resolutionsPayload);

  const combinedFingerprint = sha256Hex({
    primaryWorkbookSha256: primaryHash,
    edgarWorkbookSha256: edgarHash,
    resolutionPackageHash,
    resolutionVersion: 3,
  });
  const combinedPrefix = prefix(combinedFingerprint);

  const analysis = await analyzeWorkbookFile(params.workbookPath);
  const withOverrides = applyBusinessOwnerOverrides(analysis, overrides);

  const edgar = await parseEdgarCxpWorkbook(params.edgarPath);

  // Validate known CXP-001 / CXP-003 totals against Edgar workbook
  const cxp001 = edgar.audits.find((a) => a.decisionIds.includes('CXP-001'));
  const cxp003 = edgar.audits.find((a) => a.decisionIds.includes('CXP-003'));
  if (!cxp001) throw new Error('Edgar workbook missing CXP-001 replacement card (expected outstanding 3509715)');
  if (Math.abs(cxp001.principal - 5392000) > 0.05 || Math.abs(cxp001.paymentsTotal - 1882285) > 0.05) {
    throw new Error(
      `CXP-001 Edgar totals mismatch: principal=${cxp001.principal} payments=${cxp001.paymentsTotal}`,
    );
  }
  if (Math.abs(cxp001.outstanding - 3509715) > 0.05) {
    throw new Error(`CXP-001 Edgar outstanding mismatch: ${cxp001.outstanding}`);
  }
  if (!cxp003) throw new Error('Edgar workbook missing CXP-003 replacement card (expected outstanding 1055000)');
  if (Math.abs(cxp003.principal - 1055000) > 0.05 || Math.abs(cxp003.paymentsTotal) > 0.05) {
    throw new Error(
      `CXP-003 Edgar totals mismatch: principal=${cxp003.principal} payments=${cxp003.paymentsTotal}`,
    );
  }

  const originalEdgarIds = withOverrides.payables
    .filter(
      (p) =>
        EDGAR_ORIGINAL_EXCLUDE_IDS.includes(p.id as (typeof EDGAR_ORIGINAL_EXCLUDE_IDS)[number]) ||
        isEdgarCreditor(p.creditorName),
    )
    .map((p) => p.id);

  // Link supersession evidence
  for (const a of edgar.audits) {
    if (a.decisionIds.includes('CXP-001') && !a.supersedesOriginalIds.includes('cxp_000004')) {
      a.supersedesOriginalIds.push('cxp_000004');
    }
    if (a.decisionIds.includes('CXP-003') && !a.supersedesOriginalIds.includes('cxp_000011')) {
      a.supersedesOriginalIds.push('cxp_000011');
    }
  }

  // Append Edgar replacement payables (originals remain until EXCLUDE removes them in build)
  withOverrides.payables.push(...edgar.payables);
  withOverrides.counts.payables = withOverrides.payables.length;
  withOverrides.counts.payablePayments = withOverrides.payables.reduce(
    (s, p) => s + p.payments.length,
    0,
  );

  // Rebuild REPORTE reconciliation from overridden + Edgar-merged operational cards
  // (exclude originals from the operational sum used for CXP calculated)
  const reconPayables = withOverrides.payables.filter((p) => !originalEdgarIds.includes(p.id));
  withOverrides.reconciliation = reconcileAgainstReporte({
    reportedBalances: withOverrides.reportedBalances,
    sales: withOverrides.sales,
    inventory: withOverrides.inventory,
    receivables: withOverrides.receivables,
    payables: reconPayables,
    expenses: withOverrides.expenses,
    cash: withOverrides.cash,
    bank: withOverrides.bank,
    partnerLedger: withOverrides.partnerLedger,
    crypto: withOverrides.crypto,
    externalFloat: withOverrides.externalFloat,
    profitDistributions: withOverrides.profitDistributions,
  });

  // Build resolutions.json for partner DEFER + edgar excludes (audit trail)
  const resFile: ResolutionsFile = emptyResolutionsTemplate(combinedFingerprint);
  for (const id of originalEdgarIds) {
    resFile.resolutions.push({
      id: `res_exclude_edgar_original_${id}`,
      entityType: 'payable',
      sourceCandidateId: id,
      issueCode: 'REPLACE_SOURCE_SCOPE',
      resolutionType: 'EXCLUDE_INVALID_SOURCE_BLOCK',
      reason:
        'Superseded by authorized HOJA CXP EDGAR.xlsx replacement source for Edgar Trejo AP',
      actor: 'Wrist Caviar Business Owner',
      date: '2026-07-29',
      resolvedValue: {
        replacementSource: 'HOJA CXP EDGAR.xlsx',
        edgarFingerprint: edgar.fingerprint,
      },
    });
  }
  for (const d of partnerDefers) {
    resFile.resolutions.push({
      id: `res_${d.decisionId.toLowerCase()}`,
      entityType: 'partner',
      sourceCandidateId: d.sourceCandidateId,
      issueCode: d.decisionId,
      resolutionType: 'DEFER',
      reason: d.reason,
      actor: d.actor,
      date: d.date,
      resolvedValue: { decisionId: d.decisionId, decisionType: 'DEFER_FOR_LATER' },
    });
  }
  for (const ov of overrides) {
    // Minimal CORRECT_VALUE patch — card values already applied via preparedAnalysis.
    // Do not re-assign payments/chargeLines here (would smash typed payment candidates).
    resFile.resolutions.push({
      id: `res_${ov.decisionId.toLowerCase()}`,
      entityType: ov.decisionId.startsWith('SALE')
        ? 'sale'
        : ov.decisionId.startsWith('CXP')
          ? 'payable'
          : 'receivable',
      sourceCandidateId: ov.sourceCandidateId,
      issueCode: ov.decisionId,
      resolutionType: 'CORRECT_VALUE',
      reason: ov.reason,
      actor: ov.actor,
      date: ov.date,
      resolvedValue: {
        decisionId: ov.decisionId,
        decisionType: 'BUSINESS_OWNER_CARD_OVERRIDE',
        appliedVia: 'preparedAnalysis_business_owner_override',
        principal: ov.resolved.principal,
        outstanding: ov.resolved.outstanding ?? ov.resolved.remaining,
        salePrice: ov.resolved.salePrice,
        cost: ov.resolved.cost,
        extras: ov.resolved.extras,
        declaredProfit: ov.resolved.declaredProfit,
        originalCurrency: ov.resolved.originalCurrency,
        originalAmount: ov.resolved.originalAmount,
        exchangeRate: ov.resolved.exchangeRate,
        extrasNote: ov.resolved.extrasNote,
      },
      acknowledgedWarning: true,
    });
  }

  // REPORTE scope acknowledgements regenerated after operational fixes
  const reportRecs = withOverrides.reconciliation.filter((r) =>
    [
      'EFECTIVO_USD',
      'CXC_MXN',
      'CXC_USD',
      'CXP_USD',
      'CXP_MXN',
      'UTILIDADES',
      'DINERO_OSCAR',
    ].includes(r.concept),
  );
  for (const rec of reportRecs) {
    if (rec.status === 'MATCHED' || rec.status === 'WITHIN_TOLERANCE') continue;
    const isOscar = rec.concept === 'DINERO_OSCAR';
    const isUtil = rec.concept === 'UTILIDADES';
    const isCxpUsd = rec.concept === 'CXP_USD';
    resFile.resolutions.push({
      id: `res_report_${rec.concept.toLowerCase()}`,
      entityType: 'reconciliation',
      sourceCandidateId: rec.concept,
      issueCode: rec.concept,
      resolutionType: 'ACKNOWLEDGE_SCOPE_DIFFERENCE',
      reason: isOscar
        ? 'DINERO_OSCAR remains deferred-scope (Oscar Papa Cami outside operational import)'
        : isUtil
          ? 'UTILIDADES matrix outstanding is not a single operational destination total'
          : isCxpUsd
            ? 'CXP_USD has no declared REPORTE value; USD payables calculated separately'
            : `REPORTE ${rec.concept} scope/declared vs post-resolution calculated difference remains after operational corrections`,
      actor: 'Wrist Caviar Business Owner',
      date: '2026-07-29',
      acknowledgedWarning: true,
      resolvedValue: {
        concept: rec.concept,
        declaredValue: rec.declaredValue,
        calculatedValue: rec.calculatedValue,
        difference: rec.difference,
        status: rec.status,
        decisionType: 'ACKNOWLEDGE_SCOPE_DIFFERENCE',
      },
    });
  }

  const outRoot = params.outRoot ?? LOCAL_ROOT;
  const packageDir = path.resolve(outRoot, combinedPrefix);
  ensureDir(packageDir);
  writeJson(path.join(packageDir, 'FINAL_RESOLUTIONS_V3.json'), resolutionsPayload);
  writeJson(path.join(packageDir, 'resolutions.json'), resFile);
  writeJson(path.join(packageDir, 'source-fingerprints.json'), {
    primaryWorkbookSha256: primaryHash,
    primaryWorkbookPrefix: prefix(primaryHash),
    edgarWorkbookSha256: edgarHash,
    edgarWorkbookPrefix: prefix(edgarHash),
    resolutionPackageHash,
    combinedFingerprint,
    combinedFingerprintPrefix: combinedPrefix,
  });

  const built = await buildPackage({
    workbookPath: params.workbookPath,
    resolutionsPath: path.join(packageDir, 'resolutions.json'),
    outRoot,
    allowOutOfRangeCounts: true,
    preparedAnalysis: withOverrides,
    packageDirPrefix: combinedPrefix,
    fingerprintOverride: combinedFingerprint,
  });

  const candidates = JSON.parse(
    fs.readFileSync(path.join(built.packageDir, 'candidates.json'), 'utf8'),
  ) as Array<{
    sourceCandidateId: string;
    entityType: string;
    disposition: string;
    dispositionReason: string;
    normalizedPayload: Record<string, unknown>;
  }>;

  // Write Edgar audit
  const edgarMd = [
    '# Edgar CXP replacement audit',
    '',
    `Edgar workbook SHA-256: \`${edgarHash}\``,
    `Edgar cards imported: ${edgar.payables.length}`,
    `Original Edgar cards excluded: ${originalEdgarIds.join(', ')}`,
    '',
    '## Replacement cards',
    '',
    ...edgar.audits.flatMap((a) => [
      `### ${a.replacementId}`,
      `- Rows: ${a.startRow}–${a.endRow}`,
      `- Principal: ${money(a.principal)}`,
      `- Payments: ${money(a.paymentsTotal)}`,
      `- Outstanding: ${money(a.outstanding)}`,
      `- Declared: ${money(a.declaredOutstanding)}`,
      `- Decision IDs: ${a.decisionIds.join(', ') || '(additional Edgar AP card)'}`,
      `- Supersedes: ${a.supersedesOriginalIds.join(', ') || '(none linked)'}`,
      '',
    ]),
    '## Rules',
    '',
    '- Original Edgar Trejo CXP cards from RELOJES CESAR ADMIN.xlsx are EXCLUDED',
    '- Authorized records come only from HOJA CXP EDGAR.xlsx',
    '- Never import both versions',
    '',
  ];
  fs.writeFileSync(path.join(built.packageDir, 'EDGAR_CXP_REPLACEMENT_AUDIT.md'), edgarMd.join('\n'));

  // Sales FX audit
  const sale1 = candidates.find((c) => c.sourceCandidateId === 'sale_000041');
  const sale2 = candidates.find((c) => c.sourceCandidateId === 'sale_000176');
  const salesFx = [
    '# Sales currency and FX audit',
    '',
    '## SALE-001',
    '',
    `- Original currency: USD`,
    `- Original amount: 1450`,
    `- FX rate (MXN/USD): ${27042 / 1450}`,
    `- Agreed / planned MXN amount (salePrice): ${sale1?.normalizedPayload.salePrice}`,
    `- Cost: ${sale1?.normalizedPayload.cost}`,
    `- Realized profit MXN: ${sale1?.normalizedPayload.approvedProfit}`,
    `- Disposition: ${sale1?.disposition}`,
    '',
    '## SALE-002',
    '',
    `- Cost: ${sale2?.normalizedPayload.cost}`,
    `- Sale price: ${sale2?.normalizedPayload.salePrice}`,
    `- Extras (FX timing): ${sale2?.normalizedPayload.extras}`,
    `- Realized profit: ${sale2?.normalizedPayload.approvedProfit}`,
    `- Disposition: ${sale2?.disposition}`,
    `- Mapping: extrasAmount = 6000 MXN FX timing adjustment; reportedProfit = 200000`,
    '',
  ];
  fs.writeFileSync(path.join(built.packageDir, 'SALES_CURRENCY_AND_FX_AUDIT.md'), salesFx.join('\n'));

  // Partner bridge after defer
  const bridge = buildPartnerBridge({ analysis: built.analysis, candidates: candidates as never });
  writeJson(path.join(built.packageDir, 'partner-bridge-v3.json'), bridge);

  // Resolution summary
  const disp = built.dispositionCounts;
  const conflicts = candidates.filter((c) => c.disposition === 'CONFLICT');
  const summary = [
    '# FINAL RESOLUTION SUMMARY (V3)',
    '',
    `Combined fingerprint prefix: \`${combinedPrefix}\``,
    '',
    '| Disposition | Count |',
    '|---|---:|',
    ...Object.entries(disp).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `CONFLICT remaining: **${conflicts.length}**`,
    '',
    '## Applied decisions',
    '',
    ...overrides.map((o) => `- ${o.decisionId} → BUSINESS_OWNER_CARD_OVERRIDE → ${o.sourceCandidateId}`),
    `- CXP-001 / CXP-003 → Edgar replacement (${edgar.payables.length} cards; originals excluded)`,
    ...partnerDefers.map((d) => `- ${d.decisionId} → DEFER_FOR_LATER → ${d.sourceCandidateId}`),
    '',
    '## Remaining CONFLICT ids',
    '',
    ...(conflicts.length
      ? conflicts.map((c) => `- ${c.entityType} \`${c.sourceCandidateId}\` — ${c.dispositionReason}`)
      : ['- none']),
    '',
  ];
  fs.writeFileSync(path.join(built.packageDir, 'FINAL_RESOLUTION_SUMMARY.md'), summary.join('\n'));

  const redactedSummary = summary
    .join('\n')
    .replace(
      /\b(David lugard|EDGAR TREJO|REGINA TREJO|michael mcenry|pablo ramirez|MAYTE|PAPA CAMI)\b/gi,
      '[REDACTED]',
    );
  fs.writeFileSync(
    path.join(built.packageDir, 'FINAL_RESOLUTION_SUMMARY_REDACTED.md'),
    redactedSummary,
  );

  // REPORTE reconciliation snapshot (post-resolution)
  const recon = withOverrides.reconciliation ?? [];
  const reportAcks = resFile.resolutions.filter(
    (r) => r.resolutionType === 'ACKNOWLEDGE_SCOPE_DIFFERENCE',
  );
  const reconMd = [
    '# FINAL RECONCILIATION (V3)',
    '',
    'Regenerated after business-owner overrides + Edgar replacement + partner deferrals.',
    '',
    'Original workbook REPORTE declared values are unchanged. Calculated values use corrected CXC/CXP (Edgar replacement; original Edgar cards excluded).',
    '',
    '| Concept | Declared | Calculated | Diff | Status | Resolution |',
    '|---|---:|---:|---:|---|---|',
    ...recon.map((r) => {
      const ack = reportAcks.find((a) => a.sourceCandidateId === r.concept);
      const resLabel =
        r.status === 'MATCHED' || r.status === 'WITHIN_TOLERANCE'
          ? 'none (reconciled)'
          : ack
            ? 'ACKNOWLEDGE_SCOPE_DIFFERENCE'
            : 'open';
      return `| ${r.concept} | ${money(r.declaredValue)} | ${money(r.calculatedValue)} | ${money(r.difference)} | ${r.status} | ${resLabel} |`;
    }),
    '',
    '## Partner bridge',
    '',
    `- Entry delta attributed: ${bridge.entryFullyAttributed}`,
    `- Exit delta attributed: ${bridge.exitFullyAttributed}`,
    `- Entry delta: ${money(bridge.entryDelta)}`,
    `- Exit delta: ${money(bridge.exitDelta)}`,
    '',
    '## REPORT notes',
    '',
    '- REPORT-003 / DINERO_OSCAR: deferred Oscar scope — ACKNOWLEDGE_SCOPE_DIFFERENCE when mismatched',
    '- EFECTIVO_USD / CXC_MXN / CXP_MXN / CXP_USD / UTILIDADES: recalculated; remaining diffs are explicit scope acknowledgements',
    '',
  ];
  fs.writeFileSync(path.join(built.packageDir, 'FINAL_RECONCILIATION.md'), reconMd.join('\n'));
  fs.writeFileSync(
    path.join(built.packageDir, 'FINAL_RECONCILIATION_REDACTED.md'),
    reconMd.join('\n'),
  );

  // Enrich FINAL_RESOLUTIONS_V3 with fingerprints + report decisions
  writeJson(path.join(built.packageDir, 'FINAL_RESOLUTIONS_V3.json'), {
    ...resolutionsPayload,
    fingerprints: {
      primaryWorkbookSha256: primaryHash,
      edgarWorkbookSha256: edgarHash,
      resolutionPackageHash,
      combinedFingerprint,
      combinedFingerprintPrefix: combinedPrefix,
    },
    reportAcknowledgements: reportAcks.map((r) => ({
      concept: r.sourceCandidateId,
      resolutionType: r.resolutionType,
      reason: r.reason,
      resolvedValue: r.resolvedValue,
    })),
    dispositionCounts: disp,
    conflictCount: conflicts.length,
  });

  const v = validatePackage(built.packageDir);
  if (!v.ok) throw new Error(`Package invalid: ${v.errors.join('; ')}`);

  if (params.runDryRun) {
    const before = await countOps(params.tenantId);
    await planImport({ packageDir: built.packageDir, tenantId: params.tenantId });
    const after = await countOps(params.tenantId);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Dry-run mutated operational counts');
    }
  }

  safeLog('wrist_caviar_v3_resolved_build', {
    packageDir: built.packageDir,
    combinedFingerprintPrefix: combinedPrefix,
    dispositionCounts: disp,
    conflictCount: conflicts.length,
    edgarCards: edgar.payables.length,
    excludedOriginalEdgar: originalEdgarIds.length,
  });

  return {
    packageDir: built.packageDir,
    combinedFingerprint,
    dispositionCounts: disp,
    conflictCount: conflicts.length,
  };
}

async function countOps(tenantId: string) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const [clients, watches, deals, entries, payments, expenses, treasury] = await Promise.all([
      prisma.client.count({ where: { tenantId } }),
      prisma.watch.count({ where: { tenantId } }),
      prisma.deal.count({ where: { tenantId } }),
      prisma.accountEntry.count({ where: { tenantId } }),
      prisma.accountPayment.count({ where: { tenantId } }),
      prisma.operatingExpense.count({ where: { tenantId } }),
      prisma.treasuryEntry.count({ where: { tenantId } }),
    ]);
    return { clients, watches, deals, entries, payments, expenses, treasury };
  } finally {
    await prisma.$disconnect();
  }
}
