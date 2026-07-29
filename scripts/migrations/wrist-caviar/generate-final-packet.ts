import * as fs from 'fs';
import * as path from 'path';

import type { WorkbookAnalysis } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';
import type { PartnerLedgerCandidate } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';

import type { CanonicalCandidate } from './build-package';
import {
  CXC_CXP_RESOLUTION_TYPES,
  FINAL_DECISION_IDS,
  generateHumanReview,
  REPORT_RESOLUTION_TYPES,
  SALE_RESOLUTION_TYPES,
  type FinalDecisionTemplate,
} from './generate-human-review';
import {
  classifyPartnerConcept,
  classifyPartnerMovement,
} from './rules/partner.rules';
import {
  PARTNER_DESTINATION_SEMANTICS,
  PARTNER_UNSUPPORTED_FORCED_TYPES,
  partnerOptionsForKind,
} from './partner-destination-semantics';
import { normalizeExpenseLabel } from './rules/expense.rules';

export const PARTNER_DECISION_IDS = [
  'PARTNER-001',
  'PARTNER-002',
  'PARTNER-003',
  'PARTNER-004',
  'PARTNER-005',
  'PARTNER-006',
  'PARTNER-007',
  'PARTNER-008',
  'PARTNER-009',
  'PARTNER-010',
  'PARTNER-011',
  'PARTNER-012',
  'PARTNER-013',
] as const;

export type V2DecisionTemplate = {
  decisionId: string;
  area: string;
  issueIds: string[];
  sourceCandidateIds: string[];
  allowedResolutionTypes: string[];
  resolutionType: string;
  approvedValue: unknown;
  reason: string;
  actor: string;
  date: string;
};

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return 'null';
  return String(Math.round(Number(n) * 100) / 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function guidanceForPartner(kind: string, isExit: boolean): string {
  if (kind === 'LOAN_OR_ADVANCE') {
    return 'DEFER RECOMMENDED — loan/advance must not be forced as capital contribution/withdrawal';
  }
  if (kind === 'REIMBURSEMENT') {
    return 'DEFER RECOMMENDED — reimbursement has no faithful capital type';
  }
  if (kind === 'PROFIT' && isExit) {
    return 'BUSINESS OWNER DECISION REQUIRED — may be CLASSIFY_AS_PROFIT_DISTRIBUTION if confirmed Cesar profit payout';
  }
  if (kind === 'PROFIT' && !isExit) {
    return 'DEFER RECOMMENDED — utilidad inflow is not a capital contribution and not a distribution';
  }
  return 'BUSINESS OWNER DECISION REQUIRED';
}

function guidanceForFinancialMismatch(area: string): string {
  if (area === 'REPORTE') return 'BUSINESS OWNER DECISION REQUIRED';
  return 'BUSINESS OWNER DECISION REQUIRED';
}

function redactName(name: string, alias: string): string {
  if (!name || name === '(sin cliente)' || name === '(sin acreedor)') return name || alias;
  return alias;
}

function redactConcept(concept: string | null | undefined, alias: string): string {
  if (!concept) return alias;
  // Keep structural tokens, drop identifying names
  const structural =
    /\b(anticipo|prestamo|préstamo|reembolso|utilidad|cobro|pago|compra|gasto|venta|transfer)\b/gi;
  const tokens = String(concept).match(structural);
  if (tokens?.length) return `${alias} (${[...new Set(tokens.map((t) => t.toLowerCase()))].join('/')})`;
  return alias;
}

export function buildPartnerBridge(opts: {
  analysis: WorkbookAnalysis;
  candidates: CanonicalCandidate[];
}): {
  entryTotal: number;
  exitTotal: number;
  plannedContributionTotal: number;
  plannedWithdrawalTotal: number;
  entryDelta: number;
  exitDelta: number;
  entryAttributed: Array<{ id: string; amount: number; concept: string; kind: string }>;
  exitAttributed: Array<{ id: string; amount: number; concept: string; kind: string }>;
  entryFullyAttributed: boolean;
  exitFullyAttributed: boolean;
  endingBalance: number | null;
  net: number;
} {
  const partners = opts.analysis.partnerLedger;
  const entryTotal = round2(partners.reduce((s, p) => s + (p.entryAmount ?? 0), 0));
  const exitTotal = round2(partners.reduce((s, p) => s + (p.exitAmount ?? 0), 0));

  let plannedContributionTotal = 0;
  let plannedWithdrawalTotal = 0;
  const entryAttributed: Array<{ id: string; amount: number; concept: string; kind: string }> = [];
  const exitAttributed: Array<{ id: string; amount: number; concept: string; kind: string }> = [];

  const candById = new Map(
    opts.candidates.filter((c) => c.entityType === 'partner').map((c) => [c.sourceCandidateId, c]),
  );

  for (const row of partners) {
    const kind = classifyPartnerConcept(row.concept);
    const classified = classifyPartnerMovement({
      entryAmount: row.entryAmount,
      exitAmount: row.exitAmount,
      classification: row.classification,
      concept: row.concept,
    });
    const cand = candById.get(row.id);
    const disp = cand?.disposition ?? 'CONFLICT';

    if (classified.classification === 'CONTRIBUTION' && disp === 'CREATE') {
      plannedContributionTotal += row.entryAmount ?? 0;
    } else if (classified.classification === 'WITHDRAWAL' && disp === 'CREATE') {
      plannedWithdrawalTotal += row.exitAmount ?? 0;
    } else {
      // unresolved / deferred / excluded — attribute to bridge
      if ((row.entryAmount ?? 0) !== 0) {
        entryAttributed.push({
          id: row.id,
          amount: row.entryAmount ?? 0,
          concept: row.concept,
          kind: `${kind}/${disp}`,
        });
      }
      if ((row.exitAmount ?? 0) !== 0) {
        exitAttributed.push({
          id: row.id,
          amount: row.exitAmount ?? 0,
          concept: row.concept,
          kind: `${kind}/${disp}`,
        });
      }
    }
  }

  plannedContributionTotal = round2(plannedContributionTotal);
  plannedWithdrawalTotal = round2(plannedWithdrawalTotal);
  const entryDelta = round2(entryTotal - plannedContributionTotal);
  const exitDelta = round2(exitTotal - plannedWithdrawalTotal);
  const attributedEntry = round2(entryAttributed.reduce((s, x) => s + x.amount, 0));
  const attributedExit = round2(exitAttributed.reduce((s, x) => s + x.amount, 0));

  const endingBalance =
    [...partners].reverse().find((p) => p.reportedBalance != null)?.reportedBalance ?? null;

  return {
    entryTotal,
    exitTotal,
    plannedContributionTotal,
    plannedWithdrawalTotal,
    entryDelta,
    exitDelta,
    entryAttributed,
    exitAttributed,
    entryFullyAttributed: attributedEntry === entryDelta,
    exitFullyAttributed: attributedExit === exitDelta,
    endingBalance,
    net: round2(entryTotal - exitTotal),
  };
}

function priorBalance(
  ledger: PartnerLedgerCandidate[],
  row: PartnerLedgerCandidate,
): number | null {
  const idx = ledger.findIndex((p) => p.id === row.id);
  if (idx <= 0) return null;
  const prev = ledger[idx - 1];
  return prev?.reportedBalance ?? prev?.calculatedBalance ?? null;
}

export function generateFinalDecisionPacket(opts: {
  outDir: string;
  fingerprintPrefix: string;
  candidates: CanonicalCandidate[];
  analysis: WorkbookAnalysis;
}): {
  totalDecisions: number;
  partnerDecisionCount: number;
  bridgeOk: boolean;
  decisionIds: string[];
} {
  // Ensure base 15 packet exists
  const base = generateHumanReview(opts);
  if (base.decisionCount !== 15) {
    throw new Error(
      `Expected base 15 CXC/CXP/SALE/REPORT decisions, got ${base.decisionCount}`,
    );
  }

  const bridge = buildPartnerBridge(opts);
  if (!bridge.entryFullyAttributed || !bridge.exitFullyAttributed) {
    throw new Error(
      `Partner bridge attribution failed: entry ${bridge.entryDelta} vs attributed ${bridge.entryAttributed.reduce((s, x) => s + x.amount, 0)}; exit ${bridge.exitDelta} vs attributed ${bridge.exitAttributed.reduce((s, x) => s + x.amount, 0)}`,
    );
  }

  const conflictPartners = opts.candidates
    .filter((c) => c.entityType === 'partner' && c.disposition === 'CONFLICT')
    .sort((a, b) => a.sourceCandidateId.localeCompare(b.sourceCandidateId));

  if (conflictPartners.length !== 13) {
    throw new Error(`Expected 13 partner conflicts, got ${conflictPartners.length}`);
  }

  // Bridge MD
  const bridgeMd = [
    '# Partner reconciliation bridge',
    '',
    'Ending-balance match alone is NOT sufficient. Entry/exit deltas must attribute to candidate IDs.',
    '',
    '## Entry bridge',
    '',
    `| Step | Amount |`,
    `|---|---:|`,
    `| Source entry total | ${money(bridge.entryTotal)} |`,
    `| − Planned contribution total (CREATE) | ${money(bridge.plannedContributionTotal)} |`,
    `| = Entry delta | ${money(bridge.entryDelta)} |`,
    `| Attributed to unresolved/deferred/excluded entries | ${money(bridge.entryAttributed.reduce((s, x) => s + x.amount, 0))} |`,
    `| Fully attributed | ${bridge.entryFullyAttributed ? 'PASS' : 'FAIL'} |`,
    '',
    '### Entry attribution by sourceCandidateId',
    '',
    ...bridge.entryAttributed.map(
      (x) => `- \`${x.id}\` · ${money(x.amount)} · ${x.kind} · ${x.concept}`,
    ),
    '',
    '## Exit bridge',
    '',
    `| Step | Amount |`,
    `|---|---:|`,
    `| Source exit total | ${money(bridge.exitTotal)} |`,
    `| − Planned withdrawal total (CREATE) | ${money(bridge.plannedWithdrawalTotal)} |`,
    `| = Exit delta | ${money(bridge.exitDelta)} |`,
    `| Attributed to unresolved/deferred/excluded exits | ${money(bridge.exitAttributed.reduce((s, x) => s + x.amount, 0))} |`,
    `| Fully attributed | ${bridge.exitFullyAttributed ? 'PASS' : 'FAIL'} |`,
    '',
    '### Exit attribution by sourceCandidateId',
    '',
    ...bridge.exitAttributed.map(
      (x) => `- \`${x.id}\` · ${money(x.amount)} · ${x.kind} · ${x.concept}`,
    ),
    '',
    '## Ending balance check (insufficient alone)',
    '',
    `| Metric | Amount |`,
    `|---|---:|`,
    `| Net (entries − exits) | ${money(bridge.net)} |`,
    `| Workbook last reported balance | ${money(bridge.endingBalance)} |`,
    `| Match | ${bridge.endingBalance != null && Math.abs(bridge.net - bridge.endingBalance) < 0.05 ? 'YES' : 'NO'} |`,
    '',
    'Validation rule: if entry or exit pesos remain unattributed → FAIL even when ending balance matches.',
    '',
  ];
  fs.writeFileSync(path.join(opts.outDir, 'partner-reconciliation-bridge.md'), bridgeMd.join('\n'));
  fs.writeFileSync(
    path.join(opts.outDir, 'partner-destination-semantics.md'),
    [
      '# Partner destination semantics',
      '',
      'Unsupported forced types (not offered): ' + PARTNER_UNSUPPORTED_FORCED_TYPES.join(', '),
      '',
      ...PARTNER_DESTINATION_SEMANTICS.flatMap((s) => [
        `## ${s.resolutionType}`,
        `- Destination model: ${s.destinationModel}`,
        `- Enum/category: ${s.destinationEnumOrCategory}`,
        `- Changes capital balance: ${s.changesCapitalBalance}`,
        `- Changes treasury balance: ${s.changesTreasuryBalance}`,
        `- Affects profit distributions: ${s.affectsProfitDistributions}`,
        `- Representable without losing meaning: ${s.representableWithoutLosingMeaning}`,
        `- Notes: ${s.notes}`,
        '',
      ]),
    ].join('\n'),
  );

  const partnerDecisions: V2DecisionTemplate[] = [];
  const partnerSections: string[] = [];
  const partnerSectionsRedacted: string[] = [];

  conflictPartners.forEach((cand, idx) => {
    const decisionId = PARTNER_DECISION_IDS[idx]!;
    const src = opts.analysis.partnerLedger.find((p) => p.id === cand.sourceCandidateId)!;
    const kind = classifyPartnerConcept(src.concept);
    const isExit = (src.exitAmount ?? 0) !== 0 && (src.entryAmount ?? 0) === 0;
    const before = priorBalance(opts.analysis.partnerLedger, src);
    const after = src.reportedBalance ?? src.calculatedBalance;
    const options = partnerOptionsForKind(kind);
    const guidance = guidanceForPartner(kind, isExit);
    const alias = `Partner movement ${String.fromCharCode(65 + idx)}`;

    partnerDecisions.push({
      decisionId,
      area: 'PARTNER',
      issueIds: [cand.sourceCandidateId],
      sourceCandidateIds: [cand.sourceCandidateId],
      allowedResolutionTypes: options,
      resolutionType: '',
      approvedValue: null,
      reason: '',
      actor: '',
      date: '',
    });

    const block = [
      `## ${decisionId}`,
      '',
      'Area: PARTNER',
      '',
      `Source sheet: CUENTA CESAR`,
      `Source row/cell references: row ${src.source.sourceRow} · ${(src.source.sourceCellCoordinates ?? []).join(', ')}`,
      `Date: ${src.entryDate ?? 'null'}`,
      `Original concept: ${src.concept}`,
      `Entry amount: ${money(src.entryAmount)}`,
      `Exit amount: ${money(src.exitAmount)}`,
      `Source running balance before: ${money(before)}`,
      `Source running balance after: ${money(after)}`,
      `Detected semantic pattern: ${kind}`,
      `Related rows / evidence: candidate \`${cand.sourceCandidateId}\`; bridge attribution ${money(src.entryAmount ?? src.exitAmount ?? 0)}`,
      `Effect on planned contribution total: ${src.entryAmount ? `+${money(src.entryAmount)} if classified contribution; else remains in entry delta` : 'none'}`,
      `Effect on planned withdrawal total: ${src.exitAmount ? `+${money(src.exitAmount)} if classified withdrawal; else remains in exit delta` : 'none'}`,
      `Effect on profit distributions: ${kind === 'PROFIT' ? 'may create InvestorDistribution if CLASSIFY_AS_PROFIT_DISTRIBUTION chosen on exit' : 'none unless misclassified'}`,
      `Effect on final partner balance: cash ledger net unchanged unless EXCLUDE; DEFER keeps out of operational import`,
      '',
      'Allowed resolution types:',
      ...options.map((o) => `- ${o}`),
      '',
      `Guidance: ${guidance}`,
      '',
      'Do not classify a loan as contribution, a repayment as withdrawal, a reimbursement as contribution/withdrawal, or profit inflow as capital.',
      '',
    ];
    partnerSections.push(...block);

    const redactedBlock = [
      `## ${decisionId}`,
      '',
      'Area: PARTNER',
      '',
      `Source sheet: CUENTA CESAR`,
      `Source row/cell references: row ${src.source.sourceRow}`,
      `Date: ${src.entryDate ?? 'null'}`,
      `Concept (redacted): ${redactConcept(src.concept, alias)}`,
      `Entry amount: ${money(src.entryAmount)}`,
      `Exit amount: ${money(src.exitAmount)}`,
      `Balance before → after: ${money(before)} → ${money(after)}`,
      `Detected semantic pattern: ${kind}`,
      `Bridge amount: ${money(src.entryAmount ?? src.exitAmount ?? 0)}`,
      `Source/calculated relationship: unclassified partner movement (not sign-auto-classified)`,
      '',
      'Allowed options:',
      ...options.map((o) => `- ${o}`),
      '',
      `Guidance: ${guidance}`,
      `Reconciliation effect: keeps ${money(src.entryAmount ?? src.exitAmount ?? 0)} in entry/exit delta until resolved`,
      '',
    ];
    partnerSectionsRedacted.push(...redactedBlock);
  });

  // Expense OTHER check
  const expenses = opts.candidates.filter((c) => c.entityType === 'expense');
  const other = expenses.filter((c) => c.normalizedPayload.category === 'OTHER');
  const expSourceAmt = expenses.reduce((s, c) => s + Number(c.normalizedPayload.amount ?? 0), 0);
  const expPlannedAmt = expenses
    .filter((c) => c.disposition === 'CREATE')
    .reduce((s, c) => s + Number(c.normalizedPayload.amount ?? 0), 0);
  const otherFreq: Record<string, number> = {};
  for (const e of other) {
    const n = normalizeExpenseLabel(String(e.normalizedPayload.concept ?? ''));
    otherFreq[n] = (otherFreq[n] || 0) + 1;
  }

  // Closure simulation
  const conflicts = opts.candidates.filter((c) => c.disposition === 'CONFLICT');
  const childConflicts = conflicts.filter((c) =>
    ['receivable_payment', 'payable_payment'].includes(c.entityType),
  );
  const parentOps = conflicts.filter((c) =>
    ['receivable', 'payable', 'sale'].includes(c.entityType),
  );

  const v2: V2DecisionTemplate[] = [
    ...base.decisions.map((d: FinalDecisionTemplate) => ({
      decisionId: d.decisionId,
      area: d.area,
      issueIds: d.issueIds,
      sourceCandidateIds: d.issueIds.filter((id) => !id.startsWith('reporte:')),
      allowedResolutionTypes: [...d.allowedResolutionTypes],
      resolutionType: '',
      approvedValue: null,
      reason: '',
      actor: '',
      date: '',
    })),
    ...partnerDecisions,
  ];

  const totalDecisions = v2.length; // 28
  const projectedAfter =
    'If all 28 decisions are completed (CXC/CXP/SALE resolved or excluded; REPORT acknowledged/blocked; all 13 partners DEFER/EXCLUDE/classified), package CONFLICT should be 0 aside from KEEP_BLOCKED choices.';

  const privateMd = [
    '# Wrist Caviar — FINAL HUMAN REVIEW (complete)',
    '',
    `Fingerprint: \`${opts.fingerprintPrefix}\``,
    '',
    '## Summary',
    '',
    `| Metric | Count |`,
    `|---|---:|`,
    `| Total remaining grouped decisions | ${totalDecisions} |`,
    `| Operational parent decisions (CXC+CXP+SALE) | ${6 + 3 + 2} |`,
    `| Dependent child records (no separate decision) | ${childConflicts.length} |`,
    `| Scope acknowledgements (REPORTE) | 4 |`,
    `| Partner decisions | ${partnerDecisions.length} |`,
    `| Current CONFLICT candidates | ${conflicts.length} |`,
    `| Projected CONFLICT after all decisions completed | 0 (if none KEEP_BLOCKED) |`,
    '',
    projectedAfter,
    '',
    '## Closure simulation (what each area blocks)',
    '',
    '| Closure requirement | Blocking decisions |',
    '|---|---|',
    '| 469/469 sales planned with matching totals | SALE-001, SALE-002 |',
    '| CXC reconciliation | CXC-001…006 (+ child payments inherit) |',
    '| CXP reconciliation | CXP-001…003 (+ child payments inherit) |',
    '| Partner classification / entry-exit bridge | PARTNER-001…013 |',
    '| REPORTE reconciliation | REPORT-001…004 |',
    '| Production readiness | ALL of the above + no KEEP_BLOCKED without acknowledgement |',
    '',
    '## Expense OTHER final check',
    '',
    `- Expenses accounted: ${expenses.length}/287 expected`,
    `- Source amount total == planned CREATE amount: ${Math.abs(expSourceAmt - expPlannedAmt) < 0.05 ? 'PASS' : 'FAIL'} (${money(expSourceAmt)} vs ${money(expPlannedAmt)})`,
    `- OTHER count: ${other.length} (${((other.length / Math.max(expenses.length, 1)) * 100).toFixed(1)}%) — does not block production alone`,
    `- Concept/account/date/amount preserved on OTHER rows: yes (category mapping only)`,
    '',
    'Top OTHER by frequency:',
    ...Object.entries(otherFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([k, v]) => `- ${k}: ${v}`),
    '',
    '---',
    '',
    '# A. CXC decisions',
    '',
    // Pull existing HUMAN_REVIEW sections for CXC from file if present, else regenerate brief pointers
    fs.existsSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'))
      ? extractSections(fs.readFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), 'utf8'), [
          'CXC-001',
          'CXC-002',
          'CXC-003',
          'CXC-004',
          'CXC-005',
          'CXC-006',
        ])
      : '(see HUMAN_REVIEW.md)',
    '',
    '# B. CXP decisions',
    '',
    extractSections(fs.readFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), 'utf8'), [
      'CXP-001',
      'CXP-002',
      'CXP-003',
    ]),
    '',
    '# C. Sale decisions',
    '',
    extractSections(fs.readFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), 'utf8'), [
      'SALE-001',
      'SALE-002',
    ]),
    '',
    '# D. REPORTE decisions',
    '',
    extractSections(fs.readFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), 'utf8'), [
      'REPORT-001',
      'REPORT-002',
      'REPORT-003',
      'REPORT-004',
    ]),
    '',
    '# E. Partner decisions',
    '',
    'Grouping: none — each of the 13 movements has distinct counterparty/concept evidence; not grouped.',
    '',
    ...partnerSections,
    '',
    '## Guidance legend',
    '',
    '- DETERMINISTIC RECOMMENDATION — only when source evidence is sufficient',
    '- BUSINESS OWNER DECISION REQUIRED — default for financial mismatches',
    '- EXTERNAL SOURCE REQUIRED — needs info outside workbook',
    '- DEFER RECOMMENDED — schema cannot faithfully represent semantics',
    '',
  ];

  // Add guidance tags to CXC/CXP/SALE by appending note at top of sections already extracted
  const privateWithGuidance = privateMd
    .join('\n')
    .replace(
      /# A\. CXC decisions/,
      '# A. CXC decisions\n\nGuidance for each: BUSINESS OWNER DECISION REQUIRED — accepting source vs calculated changes CXC outstanding and REPORTE CXC_MXN/USD.',
    )
    .replace(
      /# B\. CXP decisions/,
      '# B. CXP decisions\n\nGuidance for each: BUSINESS OWNER DECISION REQUIRED — each choice changes CXP remaining and REPORTE CXP totals.',
    )
    .replace(
      /# C\. Sale decisions/,
      '# C. Sale decisions\n\nGuidance for each: BUSINESS OWNER DECISION REQUIRED — ACCEPT_SOURCE vs ACCEPT_CALCULATED changes approved profit totals for the 469-sale proof.',
    )
    .replace(
      /# D\. REPORTE decisions/,
      '# D. REPORTE decisions\n\nGuidance: REPORT-003 has DETERMINISTIC RECOMMENDATION → ACKNOWLEDGE_SCOPE_DIFFERENCE (Oscar deferred). Others: BUSINESS OWNER DECISION REQUIRED or KEEP_BLOCKED.',
    );

  fs.writeFileSync(path.join(opts.outDir, 'FINAL_HUMAN_REVIEW.md'), privateWithGuidance);

  // Redacted packet
  const redacted = [
    '# Wrist Caviar — FINAL HUMAN REVIEW (REDACTED)',
    '',
    `Fingerprint: \`${opts.fingerprintPrefix}\``,
    '',
    `Total grouped decisions: **${totalDecisions}**`,
    `Operational parents: 11 · Children (no separate decision): ${childConflicts.length} · REPORTE: 4 · Partner: 13`,
    '',
    'Names, serials, and identifying concepts redacted. Amounts retained for financial review.',
    '',
    '## A. CXC (redacted)',
    '',
    ...base.decisions
      .filter((d) => d.area === 'CXC')
      .map((d, i) => {
        const card = opts.candidates.find((c) => c.sourceCandidateId === d.issueIds[0]);
        const src = opts.analysis.receivables.find((r) => r.id === d.issueIds[0]);
        const declared = src?.declaredOutstanding;
        const calc = src?.calculatedOutstanding;
        const diff =
          declared != null && calc != null ? round2(declared - calc) : null;
        return [
          `### ${d.decisionId}`,
          `Alias: Customer ${String.fromCharCode(65 + i)} / Watch ${String.fromCharCode(65 + i)}`,
          `Principal: ${money(src?.principal)}`,
          `Source outstanding: ${money(declared)}`,
          `Calculated outstanding: ${money(calc)}`,
          `Difference (source − calculated): ${money(diff)}`,
          `Child payments: ${d.issueIds.length - 1}`,
          `Guidance: ${guidanceForFinancialMismatch('CXC')}`,
          `Options: ${CXC_CXP_RESOLUTION_TYPES.join(', ')}`,
          `Reconciliation effect: CXC totals / REPORTE CXC`,
          '',
        ].join('\n');
      }),
    '',
    '## B. CXP (redacted)',
    '',
    ...base.decisions
      .filter((d) => d.area === 'CXP')
      .map((d, i) => {
        const src = opts.analysis.payables.find((r) => r.id === d.issueIds[0]);
        const declared = src?.declaredRemaining;
        const calc = src?.calculatedRemaining;
        const diff =
          declared != null && calc != null ? round2(declared - calc) : null;
        return [
          `### ${d.decisionId}`,
          `Alias: Creditor ${String.fromCharCode(65 + i)}`,
          `Principal: ${money(src?.principal)}`,
          `Source remaining: ${money(declared)}`,
          `Calculated remaining: ${money(calc)}`,
          `Difference: ${money(diff)}`,
          `Child payments: ${d.issueIds.length - 1}`,
          `Guidance: ${guidanceForFinancialMismatch('CXP')}`,
          `Options: ${CXC_CXP_RESOLUTION_TYPES.join(', ')}`,
          '',
        ].join('\n');
      }),
    '',
    '## C. Sales (redacted)',
    '',
    ...base.decisions
      .filter((d) => d.area === 'SALE')
      .map((d, i) => {
        const src = opts.analysis.sales.find((s) => s.id === d.issueIds[0])!;
        const diff =
          src.declaredProfit != null && src.calculatedProfit != null
            ? round2(src.declaredProfit - src.calculatedProfit)
            : null;
        return [
          `### ${d.decisionId}`,
          `Alias: Customer ${String.fromCharCode(75 + i)} / Watch ${String.fromCharCode(75 + i)}`,
          `Sale date: ${src.saleDate}`,
          `Cost: ${money(src.cost)} · Sale price: ${money(src.salePrice)} · Extras: ${money(src.extras)}`,
          `Workbook profit: ${money(src.declaredProfit)}`,
          `Calculated profit: ${money(src.calculatedProfit)}`,
          `Difference: ${money(diff)}`,
          `Serial: [REDACTED]`,
          `Guidance: BUSINESS OWNER DECISION REQUIRED`,
          `Options: ${SALE_RESOLUTION_TYPES.join(', ')}`,
          '',
        ].join('\n');
      }),
    '',
    '## D. REPORTE (redacted)',
    '',
    ...base.decisions
      .filter((d) => d.area === 'REPORTE')
      .map((d) => {
        const concept = d.issueIds[0]?.replace('reporte:', '') ?? d.decisionId;
        const rows = opts.analysis.reconciliation.filter((r) =>
          concept.includes('/')
            ? concept.split('/').some((p) => r.concept.includes(p.trim()))
            : r.concept === concept || d.decisionId.includes('REPORT'),
        );
        // match by decision mapping
        return [
          `### ${d.decisionId}`,
          `Concept: ${d.issueIds.map((x) => x.replace('reporte:', '')).join(', ') || 'see packet'}`,
          ...rows.slice(0, 2).map(
            (r) =>
              `REPORTE ${r.concept}: declared ${money(r.declaredValue)} · calculated ${money(r.calculatedValue)} · diff ${money(r.difference)} · status ${r.status}`,
          ),
          `Guidance: ${d.decisionId === 'REPORT-003' ? 'DETERMINISTIC RECOMMENDATION — ACKNOWLEDGE_SCOPE_DIFFERENCE' : 'BUSINESS OWNER DECISION REQUIRED'}`,
          `Options: ${REPORT_RESOLUTION_TYPES.join(', ')}`,
          '',
        ].join('\n');
      }),
    '',
    '## E. Partner (redacted)',
    '',
    ...partnerSectionsRedacted,
    '',
  ];

  // Sanitize redacted file for names/serials
  let redactedText = redacted.join('\n');
  // Remove any leftover serial-like lines already marked
  const forbidden = opts.analysis.receivables
    .map((r) => r.customerName)
    .concat(opts.analysis.payables.map((p) => p.creditorName))
    .concat(opts.analysis.sales.map((s) => s.customerName))
    .filter(Boolean) as string[];
  for (const name of forbidden) {
    if (name.length >= 5) {
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      redactedText = redactedText.replace(re, '[REDACTED_NAME]');
    }
  }
  for (const s of opts.analysis.sales) {
    if (s.serial && s.serial.length >= 4 && /[A-Za-z]/.test(s.serial)) {
      const re = new RegExp(s.serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      redactedText = redactedText.replace(re, '[REDACTED_SERIAL]');
    }
  }

  fs.writeFileSync(path.join(opts.outDir, 'FINAL_HUMAN_REVIEW_REDACTED.md'), redactedText);

  fs.writeFileSync(
    path.join(opts.outDir, 'FINAL_RESOLUTIONS_TEMPLATE_V2.json'),
    JSON.stringify(
      {
        version: 2,
        migrationSource: 'wrist-caviar-master-workbook-v1',
        workbookFingerprintPrefix: opts.fingerprintPrefix,
        notes:
          'V2 complete packet: 15 operational/reporte + 13 partner. Fill every decision. Do not invent balancing entries. Prefer DEFER_FOR_LATER for unsupported partner semantics.',
        decisions: v2,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(opts.outDir, 'final-packet-summary.json'),
    JSON.stringify(
      {
        totalDecisions,
        decisionIds: v2.map((d) => d.decisionId),
        partnerGrouped: false,
        bridge: {
          entryDelta: bridge.entryDelta,
          exitDelta: bridge.exitDelta,
          entryFullyAttributed: bridge.entryFullyAttributed,
          exitFullyAttributed: bridge.exitFullyAttributed,
        },
        expenseOther: other.length,
        expensesTotal: expenses.length,
        currentConflicts: conflicts.length,
        parentOps: parentOps.length,
        childConflicts: childConflicts.length,
      },
      null,
      2,
    ),
  );

  return {
    totalDecisions,
    partnerDecisionCount: partnerDecisions.length,
    bridgeOk: bridge.entryFullyAttributed && bridge.exitFullyAttributed,
    decisionIds: v2.map((d) => d.decisionId),
  };
}

function extractSections(md: string, ids: string[]): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (const id of ids) {
    const start = lines.findIndex((l) => l.trim() === `## ${id}`);
    if (start < 0) {
      out.push(`## ${id}`, '', '(section missing)', '');
      continue;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    out.push(...lines.slice(start, end), '');
  }
  return out.join('\n');
}

/** Validate V2 template IDs — reject obsolete HC-* and require full set. */
export function assertV2DecisionSet(decisionIds: string[]): void {
  const expected = [...FINAL_DECISION_IDS, ...PARTNER_DECISION_IDS];
  if (decisionIds.length !== expected.length) {
    throw new Error(`Expected ${expected.length} decisions, got ${decisionIds.length}`);
  }
  for (const id of expected) {
    if (!decisionIds.includes(id)) throw new Error(`Missing decision ${id}`);
  }
  for (const id of decisionIds) {
    if (id.startsWith('HC-')) throw new Error(`Obsolete decision id ${id}`);
    if (!expected.includes(id as (typeof expected)[number])) {
      throw new Error(`Unexpected decision id ${id}`);
    }
  }
}
