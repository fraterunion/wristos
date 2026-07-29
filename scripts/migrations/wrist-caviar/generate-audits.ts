import * as fs from 'fs';
import * as path from 'path';

import type { WorkbookAnalysis } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';

import type { CanonicalCandidate } from './build-package';
import {
  classifyPartnerConcept,
  classifyPartnerMovement,
} from './rules/partner.rules';
import { normalizeExpenseLabel, resolveExpenseCategory } from './rules/expense.rules';

function money(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function writeExpenseCategoryAudit(opts: {
  outDir: string;
  candidates: CanonicalCandidate[];
}): {
  total: number;
  specific: number;
  other: number;
  otherPct: number;
} {
  const expenses = opts.candidates.filter((c) => c.entityType === 'expense');
  const other = expenses.filter((c) => c.normalizedPayload.category === 'OTHER');
  const specific = expenses.filter((c) => c.normalizedPayload.category !== 'OTHER');

  const freq: Record<string, number> = {};
  const amt: Record<string, number> = {};
  for (const e of other) {
    const n = normalizeExpenseLabel(String(e.normalizedPayload.concept ?? ''));
    freq[n] = (freq[n] || 0) + 1;
    amt[n] = (amt[n] || 0) + Number(e.normalizedPayload.amount ?? 0);
  }
  const unique = Object.keys(freq).sort();
  const byCount = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const byAmt = Object.entries(amt).sort((a, b) => b[1] - a[1]);

  const couldMap: string[] = [];
  for (const [label] of byCount) {
    const r = resolveExpenseCategory(label);
    // After alias improvements, OTHER remaining shouldn't rematch to specific unless patterns change
    if (r.category !== 'OTHER') couldMap.push(`${label} → ${r.category}`);
  }

  const lines = [
    '# Expense category audit (WC_EXPENSE_UNMAPPED_AS_OTHER)',
    '',
    `Total expenses: ${expenses.length}`,
    `Mapped to specific category: ${specific.length}`,
    `Mapped to OTHER: ${other.length}`,
    `Percentage OTHER: ${((other.length / Math.max(expenses.length, 1)) * 100).toFixed(1)}%`,
    `Unique normalized OTHER concepts: ${unique.length}`,
    '',
    '## Top OTHER by frequency',
    '',
    ...byCount.slice(0, 40).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Top OTHER by total amount (private)',
    '',
    ...byAmt.slice(0, 40).map(([k, v]) => `- ${k}: ${money(v)}`),
    '',
    '## Deterministic remaps available after alias pass',
    '',
    couldMap.length ? couldMap.map((x) => `- ${x}`).join('\n') : '- none (remaining OTHER are free-form)',
    '',
    'Note: Legitimate free-form operating costs may remain OTHER. Monetary amounts are unchanged by category mapping.',
    '',
  ];
  fs.writeFileSync(path.join(opts.outDir, 'expense-category-audit.md'), lines.join('\n'));
  return {
    total: expenses.length,
    specific: specific.length,
    other: other.length,
    otherPct: (other.length / Math.max(expenses.length, 1)) * 100,
  };
}

export function writePartnerClassificationAudit(opts: {
  outDir: string;
  analysis: WorkbookAnalysis;
  candidates: CanonicalCandidate[];
}): {
  sourceCount: number;
  contributions: number;
  withdrawals: number;
  unclassified: number;
  entrySum: number;
  exitSum: number;
  plannedContributionTotal: number;
  plannedWithdrawalTotal: number;
  suspiciousPatterns: Record<string, number>;
} {
  const partners = opts.analysis.partnerLedger;
  const cands = opts.candidates.filter((c) => c.entityType === 'partner');

  let contributions = 0;
  let withdrawals = 0;
  let unclassified = 0;
  let plannedContributionTotal = 0;
  let plannedWithdrawalTotal = 0;
  const entrySum = partners.reduce((s, p) => s + (p.entryAmount ?? 0), 0);
  const exitSum = partners.reduce((s, p) => s + (p.exitAmount ?? 0), 0);
  const suspiciousPatterns: Record<string, number> = {};
  const samples: Array<Record<string, unknown>> = [];

  for (const row of partners) {
    const kind = classifyPartnerConcept(row.concept);
    const classified = classifyPartnerMovement({
      entryAmount: row.entryAmount,
      exitAmount: row.exitAmount,
      classification: row.classification,
      concept: row.concept,
    });
    if (kind !== 'PLAIN') {
      suspiciousPatterns[kind] = (suspiciousPatterns[kind] || 0) + 1;
    }
    if (classified.classification === 'CONTRIBUTION') {
      contributions += 1;
      plannedContributionTotal += row.entryAmount ?? 0;
    } else if (classified.classification === 'WITHDRAWAL') {
      withdrawals += 1;
      plannedWithdrawalTotal += row.exitAmount ?? 0;
    } else {
      unclassified += 1;
    }
  }

  const byDisp: Record<string, number> = {};
  for (const c of cands) byDisp[c.disposition] = (byDisp[c.disposition] || 0) + 1;

  const first = partners.slice(0, 10);
  const midStart = Math.max(0, Math.floor(partners.length / 2) - 5);
  const middle = partners.slice(midStart, midStart + 10);
  const last = partners.slice(-10);

  const sampleBlock = (label: string, rows: typeof partners) => {
    samples.push({ section: label });
    for (const r of rows) {
      const c = classifyPartnerMovement({
        entryAmount: r.entryAmount,
        exitAmount: r.exitAmount,
        classification: r.classification,
        concept: r.concept,
      });
      samples.push({
        row: r.source.sourceRow,
        concept: r.concept,
        kind: classifyPartnerConcept(r.concept),
        entry: r.entryAmount,
        exit: r.exitAmount,
        classification: c.classification,
        source: r.source.sourceCellCoordinates,
      });
    }
  };
  sampleBlock('first10', first);
  sampleBlock('middle10', middle);
  sampleBlock('last10', last);

  const lastBalance = [...partners].reverse().find((p) => p.reportedBalance != null)?.reportedBalance;
  const net = entrySum - exitSum;

  const lines = [
    '# Partner classification audit',
    '',
    'Rules: WC_PARTNER_ENTRY_AS_CONTRIBUTION · WC_PARTNER_EXIT_AS_WITHDRAWAL',
    'Suspicious concepts are not classified by sign alone (loan/reimbursement/profit/transfer).',
    'Explicit: compra exit → WITHDRAWAL · gasto exit → WITHDRAWAL · venta entry → CONTRIBUTION.',
    '',
    `Source movement count: ${partners.length}`,
    `Entries classified as contributions: ${contributions}`,
    `Exits classified as withdrawals: ${withdrawals}`,
    `Formula/summary rows excluded: 0 (parser emits movements only)`,
    `Unclassified movements (remain CONFLICT): ${unclassified}`,
    '',
    `Source total entries: ${money(entrySum)}`,
    `Planned contribution total: ${money(plannedContributionTotal)}`,
    `Exact difference (source entries − planned contributions): ${money(entrySum - plannedContributionTotal)}`,
    '',
    `Source total exits: ${money(exitSum)}`,
    `Planned withdrawal total: ${money(plannedWithdrawalTotal)}`,
    `Exact difference (source exits − planned withdrawals): ${money(exitSum - plannedWithdrawalTotal)}`,
    '',
    `Net (entries − exits): ${money(net)}`,
    `Workbook last reported balance: ${money(lastBalance ?? 0)}`,
    `Reconciliation note: ending balance is workbook running saldo; package imports classified movements only.`,
    '',
    '## Candidate dispositions',
    '',
    ...Object.entries(byDisp).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Suspicious concept pattern counts',
    '',
    ...Object.entries(suspiciousPatterns)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Samples (private)',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ];
  fs.writeFileSync(path.join(opts.outDir, 'partner-classification-audit.md'), lines.join('\n'));

  return {
    sourceCount: partners.length,
    contributions,
    withdrawals,
    unclassified,
    entrySum,
    exitSum,
    plannedContributionTotal,
    plannedWithdrawalTotal,
    suspiciousPatterns,
  };
}
