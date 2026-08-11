import { Prisma } from '@prisma/client';
import { ReverseTreasuryTransferCausality } from '../../treasury/treasury-transfer.service';
import { classifyTransferPairEconomics } from '../../treasury/treasury-transfer-pair-economics';
import { ReversalRecoveryClassification } from './financial-reversal.types';
import { transferFingerprintsMatch } from './transfer-reversal-fingerprint';

type RecoveryLeg = {
  deletedAt: Date | null;
  reversalIdempotencyKey: string | null;
  direction?: string;
  account?: string;
  amount?: Prisma.Decimal | { abs: () => Prisma.Decimal } | string | number | null;
};

/**
 * Classify treasury-transfer reverse recovery for a future AI ActionRun.
 *
 * Requires durable TreasuryEntry.reversalIdempotencyKey on both legs (26A migration).
 * Pair invariant: unpaired / half-reversed / amount-account mismatch → INVARIANT (never MATCH).
 *
 * Precedence: structural → economic → causal mismatch → SAME_COMMAND / EXTERNAL.
 * Malformed economics never recover as SAME_COMMAND and never report EXTERNAL success.
 */
export function classifyTransferReversalRecovery(args: {
  commandKey: string;
  outflow: RecoveryLeg | null;
  inflow: RecoveryLeg | null;
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

  // When callers supply economics fields, INVARIANT wins over SAME_COMMAND/EXTERNAL.
  if (
    outflow.amount != null &&
    inflow.amount != null &&
    outflow.account &&
    inflow.account &&
    outflow.direction &&
    inflow.direction
  ) {
    const economics = classifyTransferPairEconomics(
      {
        direction: outflow.direction,
        account: outflow.account,
        amount:
          outflow.amount instanceof Prisma.Decimal
            ? outflow.amount
            : new Prisma.Decimal(String(outflow.amount)),
      },
      {
        direction: inflow.direction,
        account: inflow.account,
        amount:
          inflow.amount instanceof Prisma.Decimal
            ? inflow.amount
            : new Prisma.Decimal(String(inflow.amount)),
      },
    );
    if (!economics.ok) {
      return {
        kind: 'INVARIANT',
        code: 'STALE_TREASURY_TRANSFER_INVARIANT',
      };
    }
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
