/**
 * Cash / bank Wrist Caviar semantics (classification helpers).
 * Running balances are validation-only; 1% bank rows are commission when patterned.
 */

export function isRunningBalanceOnlyRow(input: {
  entryAmount?: number | null;
  exitAmount?: number | null;
  deposit?: number | null;
  withdrawal?: number | null;
  commission?: number | null;
  reportedBalance?: number | null;
}): boolean {
  const movement =
    (input.entryAmount ?? 0) !== 0 ||
    (input.exitAmount ?? 0) !== 0 ||
    (input.deposit ?? 0) !== 0 ||
    (input.withdrawal ?? 0) !== 0 ||
    (input.commission ?? 0) !== 0;
  return !movement && input.reportedBalance != null;
}

/**
 * Workbook pattern: withdrawal ≈ 1% of deposit on same bank row → commission already on commission field,
 * or standalone 1% of prior deposit marked as commission.
 */
export function isBankOnePercentCommission(input: {
  deposit: number | null | undefined;
  withdrawal: number | null | undefined;
  commission: number | null | undefined;
}): boolean {
  if (input.commission != null && input.commission > 0) return true;
  if (input.deposit != null && input.withdrawal != null && input.deposit > 0) {
    const expected = Math.round(input.deposit * 0.01 * 100) / 100;
    return Math.abs(input.withdrawal - expected) < 0.05;
  }
  return false;
}

export const CASH_BANK_RULE_IDS = [
  'WC_RUNNING_BALANCE_VALIDATION_ONLY',
  'WC_BANK_ONE_PERCENT_AS_COMMISSION',
] as const;
