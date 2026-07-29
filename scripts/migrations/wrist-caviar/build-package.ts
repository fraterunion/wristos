import * as fs from 'fs';
import * as path from 'path';

import { analyzeWristCaviarWorkbook } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/services/analyze-workbook';
import { normalizeCustomerName } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/normalization/customer-normalize';
import type { WorkbookAnalysis } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';

import { ACCEPTANCE_COUNTS, LOCAL_ROOT, MIGRATION_SOURCE, PARSER_VERSION, type Disposition } from './config';
import { prefix, safeLog, sha256Hex } from './hash';
import { ensureDir, writeJson } from './args';
import {
  emptyResolutionsTemplate,
  validateResolutionsFile,
  type ResolutionRecord,
  type ResolutionsFile,
} from './resolutions.schema';
import {
  applyHistoricalSaleFieldRules,
  classifyPartnerMovement,
  classifyPayableCard,
  classifyReceivableCard,
  freeFormCreditorSupported,
  resolveExpenseCategory,
  type RuleAudit,
} from './rules';
import { generateHumanReview } from './generate-human-review';
import { generateSalesReconciliation } from './generate-sales-reconciliation';

export type CanonicalCandidate = {
  sourceCandidateId: string;
  entityType: string;
  entityGroup: string;
  workbookFingerprint: string;
  parserVersion: string;
  sourceSheet: string;
  sourceRow: number | null;
  sourceBlockId: string | null;
  normalizedPayload: Record<string, unknown>;
  candidateFingerprint: string;
  resolutionIds: string[];
  disposition: Disposition;
  dispositionReason: string;
  appliedRules?: RuleAudit[];
  destinationHint?: { entityType: string; id?: string };
};

function applyResolutions(
  analysis: WorkbookAnalysis,
  resolutions: ResolutionRecord[],
): WorkbookAnalysis {
  // Lightweight overlay for CLI package — mutates a deep clone
  const snap = JSON.parse(JSON.stringify(analysis)) as WorkbookAnalysis;
  for (const res of resolutions) {
    const patch = res.resolvedValue ?? {};
    if (res.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK' && res.sourceCandidateId) {
      snap.receivables = snap.receivables.filter((r) => r.id !== res.sourceCandidateId);
      snap.payables = snap.payables.filter((p) => p.id !== res.sourceCandidateId);
      snap.sales = snap.sales.filter((s) => s.id !== res.sourceCandidateId);
      snap.inventory = snap.inventory.filter((i) => i.id !== res.sourceCandidateId);
      continue;
    }
    if (res.resolutionType === 'FORMULA_OVERRIDE' && res.sourceCandidateId) {
      const p = snap.payables.find((x) => x.id === res.sourceCandidateId);
      if (p) {
        if (patch.declaredRemaining != null) p.declaredRemaining = Number(patch.declaredRemaining);
        p.formulaErrors = [];
        p.ambiguous = false;
        p.balanceMismatch = false;
      }
      continue;
    }
    if (res.resolutionType === 'CORRECT_VALUE' && res.sourceCandidateId) {
      const r = snap.receivables.find((x) => x.id === res.sourceCandidateId);
      if (r) {
        Object.assign(r, patch);
        r.ambiguous = false;
        r.balanceMismatch = false;
      }
      const p = snap.payables.find((x) => x.id === res.sourceCandidateId);
      if (p) {
        Object.assign(p, patch);
        p.ambiguous = false;
        p.balanceMismatch = false;
        p.formulaErrors = [];
      }
      continue;
    }
    if (res.resolutionType === 'CORRECT_SERIAL' && res.sourceCandidateId) {
      const inv = snap.inventory.find((x) => x.id === res.sourceCandidateId);
      if (inv && typeof patch.serial === 'string') inv.serial = patch.serial;
      const sale = snap.sales.find((x) => x.id === res.sourceCandidateId);
      if (sale && typeof patch.serial === 'string') sale.serial = patch.serial;
      continue;
    }
    if (res.resolutionType === 'MARK_SERIAL_UNKNOWN' && res.sourceCandidateId) {
      const inv = snap.inventory.find((x) => x.id === res.sourceCandidateId);
      if (inv) inv.serial = null;
      const sale = snap.sales.find((x) => x.id === res.sourceCandidateId);
      if (sale) sale.serial = null;
      continue;
    }
    if (res.resolutionType === 'ACCEPT_SOURCE' || res.resolutionType === 'ACCEPT_CALCULATED') {
      if (res.sourceCandidateId) {
        const sale = snap.sales.find((x) => x.id === res.sourceCandidateId);
        if (sale) {
          if (res.resolutionType === 'ACCEPT_CALCULATED') {
            sale.declaredProfit = sale.calculatedProfit;
          }
          sale.profitMismatch = false;
        }
        const r = snap.receivables.find((x) => x.id === res.sourceCandidateId);
        if (r) {
          r.ambiguous = false;
          if (res.resolutionType === 'ACCEPT_CALCULATED') {
            r.declaredOutstanding = r.calculatedOutstanding;
          }
          r.balanceMismatch = false;
        }
        const p = snap.payables.find((x) => x.id === res.sourceCandidateId);
        if (p) {
          p.ambiguous = false;
          if (res.resolutionType === 'ACCEPT_CALCULATED') {
            p.declaredRemaining = p.calculatedRemaining;
          }
          p.balanceMismatch = false;
        }
      }
    }
  }
  return snap;
}

function candidateBase(
  id: string,
  entityType: string,
  entityGroup: string,
  analysis: WorkbookAnalysis,
  source: { sourceSheet?: string; sourceRow?: number; sourceBlockId?: string },
  payload: Record<string, unknown>,
  disposition: Disposition,
  reason: string,
  resolutionIds: string[],
  appliedRules: RuleAudit[] = [],
): CanonicalCandidate {
  const candidateFingerprint = sha256Hex({ entityType, id, payload });
  return {
    sourceCandidateId: id,
    entityType,
    entityGroup,
    workbookFingerprint: analysis.fingerprint,
    parserVersion: analysis.parserVersion,
    sourceSheet: source.sourceSheet ?? '',
    sourceRow: source.sourceRow ?? null,
    sourceBlockId: source.sourceBlockId ?? null,
    normalizedPayload: payload,
    candidateFingerprint,
    resolutionIds,
    disposition,
    dispositionReason: reason,
    appliedRules: appliedRules.length ? appliedRules : undefined,
  };
}

function resFor(
  resolutions: ResolutionRecord[],
  candidateId: string,
  entityType?: string,
): ResolutionRecord[] {
  return resolutions.filter(
    (r) =>
      r.sourceCandidateId === candidateId ||
      (entityType && r.entityType === entityType && !r.sourceCandidateId && r.issueCode),
  );
}

export function assertAcceptanceCounts(counts: WorkbookAnalysis['counts']): string[] {
  const warnings: string[] = [];
  const check = (label: string, value: number, range: { min: number; max: number }) => {
    if (value < range.min || value > range.max) {
      warnings.push(
        `${label}=${value} outside expected acceptance range [${range.min}, ${range.max}]`,
      );
    }
  };
  check('sales', counts.sales, ACCEPTANCE_COUNTS.sales);
  check('inventory', counts.inventory, ACCEPTANCE_COUNTS.inventory);
  check('expenses', counts.expenses, ACCEPTANCE_COUNTS.expenses);
  check('bank', counts.bankMovements, ACCEPTANCE_COUNTS.bank);
  check('receivables', counts.receivables, ACCEPTANCE_COUNTS.receivables);
  check('payables', counts.payables, ACCEPTANCE_COUNTS.payables);
  check(
    'cashCombined',
    counts.cashMxn + counts.cashUsd,
    ACCEPTANCE_COUNTS.cashCombined,
  );
  check('cashHidden', counts.cashHidden, ACCEPTANCE_COUNTS.cashHidden);
  return warnings;
}

export async function analyzeWorkbookFile(workbookPath: string): Promise<WorkbookAnalysis> {
  const buf = fs.readFileSync(workbookPath);
  return analyzeWristCaviarWorkbook(buf, path.basename(workbookPath));
}

export async function buildPackage(params: {
  workbookPath: string;
  resolutionsPath: string | null;
  outRoot?: string;
  allowOutOfRangeCounts?: boolean;
}): Promise<{
  packageDir: string;
  packageFingerprint: string;
  analysis: WorkbookAnalysis;
  dispositionCounts: Record<string, number>;
  humanDecisionCount: number;
  salesRecon: {
    sourceSaleCount: number;
    plannedDealCount: number;
    excludedSaleCount: number;
    conflictedSaleCount: number;
    allAccounted: boolean;
  };
}> {
  const analysis = await analyzeWorkbookFile(params.workbookPath);
  if (analysis.parserVersion !== PARSER_VERSION) {
    throw new Error(`Unsupported parser version: ${analysis.parserVersion}`);
  }

  const countWarnings = assertAcceptanceCounts(analysis.counts);
  if (countWarnings.length && !params.allowOutOfRangeCounts) {
    throw new Error(`Acceptance count gate failed:\n${countWarnings.join('\n')}`);
  }

  const fpPrefix = prefix(analysis.fingerprint);
  const baseDir = path.resolve(params.outRoot ?? LOCAL_ROOT, fpPrefix);
  ensureDir(baseDir);

  // Resolution template
  const defaultResPath = path.resolve(LOCAL_ROOT, 'resolutions.json');
  if (!fs.existsSync(defaultResPath)) {
    writeJson(defaultResPath, emptyResolutionsTemplate(analysis.fingerprint));
  }

  let resolutionsFile: ResolutionsFile = emptyResolutionsTemplate(analysis.fingerprint);
  const resPath = params.resolutionsPath ?? defaultResPath;
  if (fs.existsSync(resPath)) {
    resolutionsFile = validateResolutionsFile(JSON.parse(fs.readFileSync(resPath, 'utf8')));
  }

  const reviewed = applyResolutions(analysis, resolutionsFile.resolutions);
  const candidates: CanonicalCandidate[] = [];

  const deferredGroups = new Set(
    resolutionsFile.resolutions
      .filter((r) => r.resolutionType === 'DEFER')
      .map((r) => String(r.resolvedValue?.group ?? r.entityType ?? 'DEFERRED')),
  );

  for (const c of reviewed.customers) {
    const linked = resolutionsFile.resolutions.find(
      (r) =>
        r.sourceCandidateId === c.id &&
        r.resolutionType === 'MAP_TO_EXISTING' &&
        typeof r.resolvedValue?.destinationId === 'string',
    );
    const excluded = resolutionsFile.resolutions.find(
      (r) => r.sourceCandidateId === c.id && r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK',
    );
    let disposition: Disposition = 'CREATE';
    let reason = 'no_safe_match_default_create';
    if (excluded) {
      disposition = 'EXCLUDED';
      reason = 'excluded_by_resolution';
    } else if (linked) {
      disposition = 'LINK';
      reason = 'explicit_map_to_existing';
    }
    candidates.push(
      candidateBase(
        c.id,
        'customer',
        'CUSTOMERS',
        reviewed,
        c.sources[0] ?? { sourceSheet: 'DERIVED' },
        {
          displayName: c.displayName,
          normalizedName: c.normalizedName,
          sourceCount: c.sources.length,
        },
        disposition,
        reason,
        resFor(resolutionsFile.resolutions, c.id, 'customer').map((r) => r.id),
      ),
    );
  }

  for (const inv of reviewed.inventory) {
    const excluded = resolutionsFile.resolutions.find(
      (r) => r.sourceCandidateId === inv.id && r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK',
    );
    candidates.push(
      candidateBase(
        inv.id,
        'inventory',
        'INVENTORY',
        reviewed,
        inv.source,
        {
          brand: inv.brand,
          model: inv.model,
          reference: inv.reference,
          serial: inv.serial,
          cost: inv.cost,
        },
        excluded ? 'EXCLUDED' : 'CREATE',
        excluded ? 'excluded_by_resolution' : 'current_stock_create_default',
        resFor(resolutionsFile.resolutions, inv.id, 'inventory').map((r) => r.id),
      ),
    );
  }

  for (const sale of reviewed.sales) {
    const custNorm = normalizeCustomerName(sale.customerName);
    const saleFieldRules = applyHistoricalSaleFieldRules({
      serial: sale.serial,
      reference: sale.reference,
    });
    const approvedProfit =
      sale.declaredProfit != null && !sale.profitMismatch
        ? sale.declaredProfit
        : sale.calculatedProfit;
    let disposition: Disposition = 'CREATE';
    let reason = 'historical_sale_create';
    const applied: RuleAudit[] = saleFieldRules.audits.map((a) => a.audit);
    if (sale.profitMismatch) {
      const fixed = resolutionsFile.resolutions.some(
        (r) =>
          r.sourceCandidateId === sale.id &&
          (r.resolutionType === 'ACCEPT_SOURCE' ||
            r.resolutionType === 'ACCEPT_CALCULATED' ||
            r.resolutionType === 'CORRECT_VALUE' ||
            r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK'),
      );
      if (!fixed) {
        disposition = 'CONFLICT';
        reason = 'sale_profit_mismatch_unresolved';
      } else if (
        resolutionsFile.resolutions.some(
          (r) =>
            r.sourceCandidateId === sale.id &&
            r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK',
        )
      ) {
        disposition = 'EXCLUDED';
        reason = 'excluded_by_resolution';
      }
    }
    candidates.push(
      candidateBase(
        sale.id,
        'sale',
        'SALES',
        reviewed,
        sale.source,
        {
          saleDate: sale.saleDate,
          customerNormalized: custNorm,
          brand: sale.brand,
          model: sale.model,
          reference: saleFieldRules.reference ?? sale.reference,
          serial: saleFieldRules.serial,
          cost: sale.cost,
          salePrice: sale.salePrice,
          extras: sale.extras,
          approvedProfit,
          mutatesInventory: false,
        },
        disposition,
        reason,
        resFor(resolutionsFile.resolutions, sale.id, 'sale').map((r) => r.id),
        applied,
      ),
    );
  }

  for (const card of reviewed.receivables) {
    let disposition: Disposition = 'CREATE';
    let reason = 'receivable_create';
    const applied: RuleAudit[] = [];
    const cardRes = resolutionsFile.resolutions.filter((r) => r.sourceCandidateId === card.id);
    const excluded = cardRes.find((r) => r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK');
    const emptyRule = classifyReceivableCard({
      principal: card.principal,
      payments: card.payments,
    });
    if (excluded) {
      disposition = 'EXCLUDED';
      reason = 'excluded_by_resolution';
    } else if (emptyRule) {
      disposition = emptyRule.disposition;
      reason = emptyRule.dispositionReason;
      applied.push(emptyRule.audit);
    } else if (card.ambiguous || card.balanceMismatch || card.principal == null) {
      const fixed = cardRes.some((r) =>
        ['ACCEPT_SOURCE', 'ACCEPT_CALCULATED', 'CORRECT_VALUE', 'FORMULA_OVERRIDE'].includes(
          r.resolutionType,
        ),
      );
      if (!fixed) {
        disposition = 'CONFLICT';
        reason = card.ambiguous ? 'ambiguous_cxc' : 'cxc_balance_invalid';
      } else {
        reason = 'receivable_resolved';
      }
    }
    candidates.push(
      candidateBase(
        card.id,
        'receivable',
        'RECEIVABLES',
        reviewed,
        card.source,
        {
          customerName: card.customerName,
          customerNormalized: normalizeCustomerName(card.customerName),
          principal: card.principal,
          watchOrConcept: card.watchOrConcept,
          outstanding: card.declaredOutstanding ?? card.calculatedOutstanding,
          currency: card.currency,
          payments: card.payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            paymentDate: p.paymentDate,
            label: p.label,
          })),
        },
        disposition,
        reason,
        resFor(resolutionsFile.resolutions, card.id, 'receivable').map((r) => r.id),
        applied,
      ),
    );
    for (const pay of card.payments) {
      candidates.push(
        candidateBase(
          pay.id,
          'receivable_payment',
          'RECEIVABLES',
          reviewed,
          pay.source,
          { parentId: card.id, amount: pay.amount, paymentDate: pay.paymentDate, label: pay.label },
          disposition === 'EXCLUDED' ? 'EXCLUDED' : disposition === 'CONFLICT' ? 'CONFLICT' : 'CREATE',
          'child_of_receivable',
          [],
        ),
      );
    }
  }

  for (const card of reviewed.payables) {
    let disposition: Disposition = 'CREATE';
    let reason = 'payable_create';
    const applied: RuleAudit[] = [];
    const cardRes = resolutionsFile.resolutions.filter((r) => r.sourceCandidateId === card.id);
    const excluded = cardRes.find((r) => r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK');
    const emptyRule = classifyPayableCard({
      principal: card.principal,
      payments: card.payments,
    });
    if (excluded) {
      disposition = 'EXCLUDED';
      reason = 'excluded_by_resolution';
    } else if (emptyRule) {
      disposition = emptyRule.disposition;
      reason = emptyRule.dispositionReason;
      applied.push(emptyRule.audit);
    } else if (
      card.ambiguous ||
      card.balanceMismatch ||
      card.principal == null ||
      (card.formulaErrors?.length ?? 0) > 0
    ) {
      const fixed = cardRes.some((r) =>
        [
          'FORMULA_OVERRIDE',
          'CORRECT_VALUE',
          'ACCEPT_SOURCE',
          'ACCEPT_CALCULATED',
        ].includes(r.resolutionType),
      );
      if (!fixed) {
        disposition = 'CONFLICT';
        reason =
          (card.formulaErrors?.length ?? 0) > 0 ? 'cxp_formula_error' : 'cxp_balance_invalid';
      } else {
        reason = 'payable_resolved';
      }
    } else {
      const freeForm = freeFormCreditorSupported(card.creditorName);
      if (freeForm) applied.push(freeForm.audit);
    }
    candidates.push(
      candidateBase(
        card.id,
        'payable',
        'PAYABLES',
        reviewed,
        card.source,
        {
          creditorName: card.creditorName,
          principal: card.principal,
          watchOrConcept: card.watchOrConcept,
          remaining: card.declaredRemaining ?? card.calculatedRemaining,
          currency: card.currency,
          payments: card.payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            paymentDate: p.paymentDate,
            label: p.label,
          })),
        },
        disposition,
        reason,
        resFor(resolutionsFile.resolutions, card.id, 'payable').map((r) => r.id),
        applied,
      ),
    );
    for (const pay of card.payments) {
      candidates.push(
        candidateBase(
          pay.id,
          'payable_payment',
          'PAYABLES',
          reviewed,
          pay.source,
          { parentId: card.id, amount: pay.amount, paymentDate: pay.paymentDate, label: pay.label },
          disposition === 'EXCLUDED' ? 'EXCLUDED' : disposition === 'CONFLICT' ? 'CONFLICT' : 'CREATE',
          'child_of_payable',
          [],
        ),
      );
    }
  }

  for (const exp of reviewed.expenses) {
    const resolved = resolveExpenseCategory(exp.concept);
    candidates.push(
      candidateBase(
        exp.id,
        'expense',
        'EXPENSES',
        reviewed,
        exp.source,
        {
          expenseDate: exp.expenseDate,
          concept: exp.concept,
          amount: exp.amount,
          account: exp.account,
          category: resolved.category,
        },
        resolved.patch.disposition,
        resolved.patch.dispositionReason,
        [],
        [resolved.patch.audit],
      ),
    );
  }

  for (const row of reviewed.cash) {
    if (row.hidden) continue; // still counted in analysis; package includes visible + separate hidden note
    candidates.push(
      candidateBase(
        row.id,
        'cash',
        'CASH_LEDGER',
        reviewed,
        row.source,
        {
          currency: row.currency,
          entryDate: row.entryDate,
          entryAmount: row.entryAmount,
          exitAmount: row.exitAmount,
          exchangeRate: row.exchangeRate,
          reportedBalanceForValidation: row.reportedBalance,
        },
        'CREATE',
        'cash_create',
        [],
      ),
    );
  }
  // Hidden cash rows tracked as EXCLUDED from operational import but accounted
  for (const row of reviewed.cash.filter((c) => c.hidden)) {
    candidates.push(
      candidateBase(
        row.id,
        'cash_hidden',
        'CASH_LEDGER',
        reviewed,
        row.source,
        { currency: row.currency, hidden: true },
        'EXCLUDED',
        'hidden_cash_row_excluded_from_operational_ledger',
        [],
      ),
    );
  }

  for (const row of reviewed.bank) {
    candidates.push(
      candidateBase(
        row.id,
        'bank',
        'BANK_LEDGER',
        reviewed,
        row.source,
        {
          entryDate: row.entryDate,
          reference: row.reference,
          deposit: row.deposit,
          withdrawal: row.withdrawal,
          commission: row.commission,
          comment: row.comment,
          reportedBalanceForValidation: row.reportedBalance,
        },
        'CREATE',
        'bank_create',
        [],
      ),
    );
  }

  for (const row of reviewed.partnerLedger) {
    const excluded = resolutionsFile.resolutions.find(
      (r) =>
        r.sourceCandidateId === row.id && r.resolutionType === 'EXCLUDE_INVALID_SOURCE_BLOCK',
    );
    const deferred = resolutionsFile.resolutions.find(
      (r) => r.sourceCandidateId === row.id && r.resolutionType === 'DEFER',
    );
    const classified = classifyPartnerMovement({
      entryAmount: row.entryAmount,
      exitAmount: row.exitAmount,
      classification: row.classification,
    });
    const applied: RuleAudit[] = [];
    let disposition: Disposition =
      classified.classification === 'UNCLASSIFIED' ? 'CONFLICT' : 'CREATE';
    let reason =
      disposition === 'CONFLICT' ? 'unclassified_partner_movement' : 'partner_create';
    if (classified.patch) {
      disposition = classified.patch.disposition;
      reason = classified.patch.dispositionReason;
      applied.push(classified.patch.audit);
    }
    if (excluded) {
      disposition = 'EXCLUDED';
      reason = 'excluded_by_resolution';
    } else if (deferred) {
      disposition = 'DEFERRED';
      reason = 'deferred_by_resolution';
    }
    candidates.push(
      candidateBase(
        row.id,
        'partner',
        'PARTNER_LEDGER',
        reviewed,
        row.source,
        {
          entryDate: row.entryDate,
          entryAmount: row.entryAmount,
          exitAmount: row.exitAmount,
          classification: classified.classification,
        },
        disposition,
        reason,
        resFor(resolutionsFile.resolutions, row.id, 'partner').map((r) => r.id),
        applied,
      ),
    );
  }

  for (const row of reviewed.profitDistributions) {
    const ok =
      (row.partner === 'CESAR' || row.partner === 'EDGAR') && !row.shareMismatch;
    candidates.push(
      candidateBase(
        row.id,
        'profit',
        'PROFIT_DISTRIBUTIONS',
        reviewed,
        row.source,
        {
          partner: row.partner,
          monthLabel: row.monthLabel,
          accrued: row.accrued,
          collected: row.collected,
          outstanding: row.outstanding,
          expectedShare: row.partner === 'CESAR' ? 0.75 : row.partner === 'EDGAR' ? 0.25 : null,
        },
        ok ? 'CREATE' : 'CONFLICT',
        ok ? 'profit_create' : 'capital_semantics_unsupported',
        [],
      ),
    );
  }

  for (const d of [...reviewed.crypto, ...reviewed.externalFloat]) {
    const group =
      'destination' in d && d.destination === 'DEFERRED'
        ? String((d as { label?: string }).label ?? 'DEFERRED')
        : 'DEFERRED';
    const deferred =
      deferredGroups.has('CRIPTO_CESAR') ||
      deferredGroups.has('OSCAR_PAPA_CAMI') ||
      deferredGroups.has('DEFERRED') ||
      true;
    candidates.push(
      candidateBase(
        d.id,
        'deferred',
        'DEFERRED',
        reviewed,
        d.source,
        { group },
        deferred ? 'DEFERRED' : 'CONFLICT',
        'deferred_group',
        resolutionsFile.resolutions.filter((r) => r.resolutionType === 'DEFER').map((r) => r.id),
      ),
    );
  }

  const byGroup: Record<string, CanonicalCandidate[]> = {};
  for (const c of candidates) {
    (byGroup[c.entityGroup] ??= []).push(c);
  }

  const dispositionCounts: Record<string, number> = {
    CREATE: 0,
    LINK: 0,
    SKIP: 0,
    CONFLICT: 0,
    DEFERRED: 0,
    EXCLUDED: 0,
  };
  for (const c of candidates) dispositionCounts[c.disposition] += 1;

  // Accounting identity: every candidate has a disposition
  const groupAccounting: Record<string, Record<string, number>> = {};
  for (const [g, list] of Object.entries(byGroup)) {
    const counts: Record<string, number> = {
      source: list.length,
      CREATE: 0,
      LINK: 0,
      SKIP: 0,
      CONFLICT: 0,
      DEFERRED: 0,
      EXCLUDED: 0,
    };
    for (const c of list) counts[c.disposition] += 1;
    const sum =
      counts.CREATE + counts.LINK + counts.SKIP + counts.CONFLICT + counts.DEFERRED + counts.EXCLUDED;
    if (sum !== counts.source) {
      throw new Error(`Disposition accounting failed for ${g}: ${sum} != ${counts.source}`);
    }
    groupAccounting[g] = counts;
  }

  const packageBody = {
    migrationSource: MIGRATION_SOURCE,
    parserVersion: PARSER_VERSION,
    workbookFingerprint: analysis.fingerprint,
    candidates: candidates.map((c) => ({
      sourceCandidateId: c.sourceCandidateId,
      entityType: c.entityType,
      entityGroup: c.entityGroup,
      candidateFingerprint: c.candidateFingerprint,
      disposition: c.disposition,
    })),
    groupAccounting,
    dispositionCounts,
    sourceCounts: analysis.counts,
  };
  const packageFingerprint = sha256Hex(packageBody);

  const files: Record<string, unknown> = {
    manifest: {
      migrationSource: MIGRATION_SOURCE,
      parserVersion: PARSER_VERSION,
      workbookFingerprint: analysis.fingerprint,
      workbookFingerprintPrefix: fpPrefix,
      packageFingerprint,
      packageFingerprintPrefix: prefix(packageFingerprint),
      createdAt: new Date().toISOString(),
      sourceCounts: analysis.counts,
      dispositionCounts,
      groupAccounting,
      readiness: analysis.readiness,
      issueSummary: analysis.issueSummary,
      acceptanceWarnings: countWarnings,
      operationalWrites: 0,
    },
    customers: byGroup.CUSTOMERS ?? [],
    inventory: byGroup.INVENTORY ?? [],
    sales: byGroup.SALES ?? [],
    receivables: (byGroup.RECEIVABLES ?? []).filter((c) => c.entityType === 'receivable'),
    receivablePayments: (byGroup.RECEIVABLES ?? []).filter(
      (c) => c.entityType === 'receivable_payment',
    ),
    payables: (byGroup.PAYABLES ?? []).filter((c) => c.entityType === 'payable'),
    payablePayments: (byGroup.PAYABLES ?? []).filter((c) => c.entityType === 'payable_payment'),
    expenses: byGroup.EXPENSES ?? [],
    'cash-mxn': (byGroup.CASH_LEDGER ?? []).filter(
      (c) => c.entityType === 'cash' && c.normalizedPayload.currency === 'MXN',
    ),
    'cash-usd': (byGroup.CASH_LEDGER ?? []).filter(
      (c) => c.entityType === 'cash' && c.normalizedPayload.currency === 'USD',
    ),
    bank: byGroup.BANK_LEDGER ?? [],
    'partner-ledger': byGroup.PARTNER_LEDGER ?? [],
    'profit-distributions': byGroup.PROFIT_DISTRIBUTIONS ?? [],
    deferred: byGroup.DEFERRED ?? [],
    issues: analysis.issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      // message omitted from package summary file — kept in issues-full locally only
    })),
    reconciliation: analysis.reconciliation,
    resolutions: resolutionsFile,
  };

  const checksums: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    const file = path.join(baseDir, `${name}.json`);
    writeJson(file, data);
    checksums[`${name}.json`] = sha256Hex(data);
  }
  // Full candidates + issues with messages for local use only
  writeJson(path.join(baseDir, 'candidates.json'), candidates);
  checksums['candidates.json'] = sha256Hex(candidates);
  writeJson(path.join(baseDir, 'checksums.json'), checksums);

  // Human review report (no sensitive values)
  const pending = candidates.filter((c) => c.disposition === 'CONFLICT');
  const reviewMd = [
    '# Wrist Caviar package review',
    '',
    `- Workbook fingerprint prefix: \`${fpPrefix}\``,
    `- Package fingerprint prefix: \`${prefix(packageFingerprint)}\``,
    `- Source readiness: ${analysis.readiness}`,
    `- Disposition: CREATE ${dispositionCounts.CREATE}, LINK ${dispositionCounts.LINK}, CONFLICT ${dispositionCounts.CONFLICT}, DEFERRED ${dispositionCounts.DEFERRED}, EXCLUDED ${dispositionCounts.EXCLUDED}`,
    '',
    '## Blocking conflicts (ids only)',
    ...pending.slice(0, 200).map((c) => `- ${c.entityType} \`${c.sourceCandidateId}\` — ${c.dispositionReason}`),
    pending.length > 200 ? `… and ${pending.length - 200} more` : '',
    '',
    '## Acceptance count warnings',
    ...(countWarnings.length ? countWarnings.map((w) => `- ${w}`) : ['- none']),
  ].join('\n');
  fs.writeFileSync(path.join(baseDir, 'review.md'), `${reviewMd}\n`);

  const human = generateHumanReview({
    outDir: baseDir,
    fingerprintPrefix: fpPrefix,
    candidates,
  });
  const salesRecon = generateSalesReconciliation({
    outDir: baseDir,
    fingerprintPrefix: fpPrefix,
    candidates,
    includeSensitiveTotals: true,
  });

  safeLog('wrist_caviar_package_built', {
    workbookFingerprintPrefix: fpPrefix,
    packageFingerprintPrefix: prefix(packageFingerprint),
    dispositionCounts,
    conflictCount: dispositionCounts.CONFLICT,
    humanDecisions: human.decisionCount,
    salesAccounted: salesRecon.allAccounted,
  });

  return {
    packageDir: baseDir,
    packageFingerprint,
    analysis: reviewed,
    dispositionCounts,
    humanDecisionCount: human.decisionCount,
    salesRecon,
  };
}
