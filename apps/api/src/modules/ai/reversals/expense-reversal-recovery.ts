import { ReverseExpenseCausality } from '../../expenses/expense-registration.service';
import { ReversalRecoveryClassification } from './financial-reversal.types';
import { expenseFingerprintsMatch } from './expense-reversal-fingerprint';

/**
 * Classify expense reverse recovery for a future AI ActionRun.
 *
 * Requires durable OperatingExpense.reversalIdempotencyKey (26A migration).
 * deletedAt alone is NEVER enough for MATCH.
 */
export function classifyExpenseReversalRecovery(args: {
  commandKey: string;
  expense: {
    deletedAt: Date | null;
    reversalIdempotencyKey: string | null;
  } | null;
  plannedFingerprint: string;
  currentFingerprint: string;
  domainCausality?: ReverseExpenseCausality | null;
}): ReversalRecoveryClassification {
  const { commandKey, expense, plannedFingerprint, currentFingerprint } = args;

  if (!expense) return { kind: 'MISSING' };

  if (!expenseFingerprintsMatch(plannedFingerprint, currentFingerprint)) {
    // Active target with drifted economics → stale plan (do not reverse different object).
    if (expense.deletedAt == null) {
      return { kind: 'STALE_TARGET', code: 'REVERSAL_TARGET_STALE' };
    }
  }

  if (expense.deletedAt == null) {
    return { kind: 'MISSING' };
  }

  if (expense.reversalIdempotencyKey && expense.reversalIdempotencyKey === commandKey) {
    return { kind: 'MATCH', causality: 'SAME_COMMAND', recovered: true };
  }

  if (args.domainCausality === 'SAME_COMMAND') {
    return { kind: 'MATCH', causality: 'SAME_COMMAND', recovered: true };
  }

  return { kind: 'EXTERNAL_ALREADY_REVERSED', causality: 'EXTERNAL' };
}
