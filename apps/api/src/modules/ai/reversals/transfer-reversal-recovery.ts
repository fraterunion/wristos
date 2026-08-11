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

  const outKey = outflow.reversalIdempotencyKey;
  const inKey = inflow.reversalIdempotencyKey;

  // Mismatched causal keys on a reversed pair → INVARIANT (never SAME_COMMAND).
  if (outKey && inKey && outKey !== inKey) {
    return {
      kind: 'INVARIANT',
      code: 'STALE_TREASURY_TRANSFER_INVARIANT',
    };
  }

  // SAME_COMMAND only when BOTH legs carry the same command key.
  const bothMatch =
    Boolean(outKey) &&
    Boolean(inKey) &&
    outKey === commandKey &&
    inKey === commandKey;

  if (bothMatch || args.domainCausality === 'SAME_COMMAND') {
    // Domain SAME_COMMAND already proved both legs; still require both deleted.
    if (args.domainCausality === 'SAME_COMMAND' && !(outDeleted && inDeleted)) {
      return {
        kind: 'INVARIANT',
        code: 'STALE_TREASURY_TRANSFER_INVARIANT',
      };
    }
    if (bothMatch || args.domainCausality === 'SAME_COMMAND') {
      return { kind: 'MATCH', causality: 'SAME_COMMAND', recovered: true };
    }
  }

  // One leg stamped, the other not → never recover from a single matching leg.
  if ((outKey === commandKey) !== (inKey === commandKey)) {
    return {
      kind: 'INVARIANT',
      code: 'STALE_TREASURY_TRANSFER_INVARIANT',
    };
  }

  return { kind: 'EXTERNAL_ALREADY_REVERSED', causality: 'EXTERNAL' };
}
