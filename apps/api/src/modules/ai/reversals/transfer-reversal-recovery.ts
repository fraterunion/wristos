import { ReverseTreasuryTransferCausality } from '../../treasury/treasury-transfer.service';
import { ReversalRecoveryClassification } from './financial-reversal.types';
import { transferFingerprintsMatch } from './transfer-reversal-fingerprint';

/**
 * Classify treasury-transfer reverse recovery for a future AI ActionRun.
 *
 * Requires durable TreasuryEntry.reversalIdempotencyKey on both legs (26A migration).
 * Pair invariant: unpaired / half-reversed → INVARIANT (never MATCH).
 */
export function classifyTransferReversalRecovery(args: {
  commandKey: string;
  outflow: {
    deletedAt: Date | null;
    reversalIdempotencyKey: string | null;
  } | null;
  inflow: {
    deletedAt: Date | null;
    reversalIdempotencyKey: string | null;
  } | null;
  plannedFingerprint: string;
  currentFingerprint: string;
  domainCausality?: ReverseTreasuryTransferCausality | null;
}): ReversalRecoveryClassification {
  const { commandKey, outflow, inflow, plannedFingerprint, currentFingerprint } = args;

  if (!outflow && !inflow) return { kind: 'MISSING' };

  if (!outflow || !inflow) {
    return {
      kind: 'INVARIANT',
      code: 'STALE_TREASURY_TRANSFER_INVARIANT',
    };
  }

  const outDeleted = outflow.deletedAt != null;
  const inDeleted = inflow.deletedAt != null;
  if (outDeleted !== inDeleted) {
    return {
      kind: 'INVARIANT',
      code: 'STALE_TREASURY_TRANSFER_INVARIANT',
    };
  }

  if (!transferFingerprintsMatch(plannedFingerprint, currentFingerprint)) {
    if (!outDeleted && !inDeleted) {
      return { kind: 'STALE_TARGET', code: 'REVERSAL_TARGET_STALE' };
    }
  }

  if (!outDeleted && !inDeleted) {
    return { kind: 'MISSING' };
  }

  const stamped =
    (outflow.reversalIdempotencyKey &&
      outflow.reversalIdempotencyKey === commandKey) ||
    (inflow.reversalIdempotencyKey && inflow.reversalIdempotencyKey === commandKey);

  if (stamped || args.domainCausality === 'SAME_COMMAND') {
    return { kind: 'MATCH', causality: 'SAME_COMMAND', recovered: true };
  }

  return { kind: 'EXTERNAL_ALREADY_REVERSED', causality: 'EXTERNAL' };
}
