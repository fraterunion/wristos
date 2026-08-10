import { createHash } from 'crypto';
import { OperatingExpense, TreasuryEntry } from '@prisma/client';
import { operatingExpenseOutflowProvenanceKey } from '../../treasury/treasury.service';
import { ExpenseReversalSnapshot } from './financial-reversal.types';

/**
 * Material fingerprint for REVERSE_EXPENSE targets.
 *
 * Includes: expenseId, amount, category, sourceAccount, expenseDate (UTC day),
 * currency, whether canonical Treasury OUTFLOW provenance exists, active state.
 *
 * Excludes mutable free-form notes so note edits do not stale a valid plan.
 */
export type ExpenseFingerprintInput = {
  expenseId: string;
  amount: string;
  category: string;
  sourceAccount: string | null;
  expenseDate: string | null;
  currency: string;
  hasCanonicalTreasuryOutflow: boolean;
  active: boolean;
};

export function utcDayBucket(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (m) return m[1]!;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function buildExpenseFingerprintInput(
  expense: Pick<
    OperatingExpense,
    | 'id'
    | 'amount'
    | 'category'
    | 'sourceAccount'
    | 'expenseDate'
    | 'currency'
    | 'deletedAt'
    | 'notes'
  >,
  treasuryOutflow: Pick<TreasuryEntry, 'id' | 'deletedAt'> | null,
): ExpenseFingerprintInput {
  const hasCanonicalTreasuryOutflow = Boolean(treasuryOutflow);
  return {
    expenseId: expense.id,
    amount: expense.amount.toFixed(2),
    category: String(expense.category),
    sourceAccount: expense.sourceAccount ?? null,
    expenseDate: utcDayBucket(expense.expenseDate),
    currency: String(expense.currency),
    hasCanonicalTreasuryOutflow,
    active: expense.deletedAt == null,
  };
}

export function expenseReversalFingerprint(input: ExpenseFingerprintInput): string {
  const material = [
    'OPERATING_EXPENSE',
    input.expenseId,
    input.amount,
    input.category,
    input.sourceAccount ?? '',
    input.expenseDate ?? '',
    input.currency,
    input.hasCanonicalTreasuryOutflow ? '1' : '0',
    input.active ? '1' : '0',
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function expenseReversalSnapshot(
  expense: Pick<
    OperatingExpense,
    | 'amount'
    | 'category'
    | 'sourceAccount'
    | 'expenseDate'
    | 'currency'
    | 'deletedAt'
    | 'notes'
  >,
  treasuryOutflow: Pick<TreasuryEntry, 'id'> | null,
): ExpenseReversalSnapshot {
  const notes =
    typeof expense.notes === 'string' && expense.notes.trim()
      ? expense.notes.trim().slice(0, 80)
      : null;
  return {
    kind: 'OPERATING_EXPENSE',
    amount: expense.amount.toFixed(2),
    currency: (expense.currency === 'USD' ? 'USD' : 'MXN') as 'MXN' | 'USD',
    category: String(expense.category),
    sourceAccount: (expense.sourceAccount as ExpenseReversalSnapshot['sourceAccount']) ?? null,
    expenseDate: utcDayBucket(expense.expenseDate),
    conceptLabel: notes,
    hasCanonicalTreasuryOutflow: Boolean(treasuryOutflow),
    active: expense.deletedAt == null,
  };
}

export function expenseOutflowProvenanceKey(expenseId: string): string {
  return operatingExpenseOutflowProvenanceKey(expenseId);
}

export function expenseFingerprintsMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}
