/**
 * 26C.1 — Expense reversal economic classification.
 *
 * Positive identity only:
 * - provenance row ever existed (incl. soft-deleted) → was canonical
 * - no provenance row ever → genuine LEGACY_VALID
 *
 * Never: "no active outflow ⇒ legacy".
 */

export type ExpenseReversalEconomicClass =
  | 'LEGACY_VALID'
  | 'CANONICAL_VALID'
  | 'CANONICAL_INVARIANT';

export type ExpenseOutflowEvidence = {
  id: string;
  deletedAt: Date | null;
  direction?: string | null;
  amountMxn?: { toFixed?: (n: number) => string; toString?: () => string } | string | number | null;
  account?: string | null;
} | null;

export type ExpenseIdentityForClassification = {
  id: string;
  deletedAt: Date | null;
  amount: { toFixed: (n: number) => string } | string | number;
  sourceAccount: string | null;
};

export const CANONICAL_EXPENSE_INVARIANT_MESSAGE =
  'No puedo revertir ese gasto de forma segura porque su registro financiero está incompleto.';

function amountFixed(value: ExpenseIdentityForClassification['amount']): string {
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : value;
  }
  return value.toFixed(2);
}

function outflowAmountFixed(value: NonNullable<ExpenseOutflowEvidence>['amountMxn']): string | null {
  if (value == null) return null;
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : value;
  }
  if (typeof value.toFixed === 'function') return value.toFixed(2);
  if (typeof value.toString === 'function') {
    const n = Number(value.toString());
    return Number.isFinite(n) ? n.toFixed(2) : null;
  }
  return null;
}

/**
 * Classify an active (or any) expense against its provenance OUTFLOW row.
 *
 * Durable evidence: TreasuryEntry.provenanceKey = operating-expense:<id>:outflow
 * (row may be soft-deleted). Absence of any such row ⇒ historical legacy.
 */
export function classifyExpenseReversalEconomics(args: {
  expense: ExpenseIdentityForClassification;
  /** Provenance OUTFLOW row including soft-deleted; null if never existed. */
  treasuryOutflow: ExpenseOutflowEvidence;
}): ExpenseReversalEconomicClass {
  const { expense, treasuryOutflow } = args;

  // No provenance row ever → genuine legacy (WC historical imports).
  if (!treasuryOutflow) {
    return 'LEGACY_VALID';
  }

  // Soft-deleted provenance while expense still active ⇒ corrupt canonical.
  if (treasuryOutflow.deletedAt != null && expense.deletedAt == null) {
    return 'CANONICAL_INVARIANT';
  }

  // Active provenance: validate coherence when fields are available.
  if (treasuryOutflow.deletedAt == null) {
    if (treasuryOutflow.direction != null && treasuryOutflow.direction !== 'OUTFLOW') {
      return 'CANONICAL_INVARIANT';
    }
    const outAmt = outflowAmountFixed(treasuryOutflow.amountMxn);
    if (outAmt != null && outAmt !== amountFixed(expense.amount)) {
      return 'CANONICAL_INVARIANT';
    }
    if (
      expense.sourceAccount &&
      treasuryOutflow.account != null &&
      treasuryOutflow.account !== expense.sourceAccount
    ) {
      return 'CANONICAL_INVARIANT';
    }
    return 'CANONICAL_VALID';
  }

  // Expense already soft-deleted + provenance soft-deleted → coherent reversed
  // history (recovery paths handle SAME_COMMAND / EXTERNAL). Treat economics as
  // previously canonical for fingerprinting of restored/active checks.
  return 'CANONICAL_VALID';
}

/** True only when liquidity restore is safe to claim / execute. */
export function hasActiveCanonicalOutflow(
  classification: ExpenseReversalEconomicClass,
): boolean {
  return classification === 'CANONICAL_VALID';
}
