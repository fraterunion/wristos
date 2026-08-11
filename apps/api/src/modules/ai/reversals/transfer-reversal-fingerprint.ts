import { createHash } from 'crypto';
import { TreasuryEntry } from '@prisma/client';
import {
  treasuryTransferInflowProvenanceKey,
  treasuryTransferOutflowProvenanceKey,
} from '../../treasury/treasury-transfer.service';
import { TransferReversalSnapshot } from './financial-reversal.types';
import { utcDayBucket } from './expense-reversal-fingerprint';

/**
 * Material fingerprint for REVERSE_TREASURY_TRANSFER.
 *
 * A transfer is the LOGICAL pair identified by transferId (= create register key),
 * not a single TreasuryEntry. Fingerprint requires both legs' provenances.
 *
 * Includes: transferId, source, destination, BOTH leg amounts (exact),
 * transferDate (UTC day), pair completeness, active state (both legs not deleted).
 * Strengthened in 26D.1 so amount/account drift on either leg stales the plan.
 */
export type TransferFingerprintInput = {
  transferId: string;
  sourceAccount: string;
  destinationAccount: string;
  /** Outflow absolute amount (primary display amount). */
  amount: string;
  /** Inflow absolute amount — included so mismatch stales the fingerprint. */
  inflowAmount: string;
  transferDate: string | null;
  pairComplete: boolean;
  active: boolean;
};

export function buildTransferFingerprintInput(args: {
  transferId: string;
  outflow: Pick<
    TreasuryEntry,
    'account' | 'amount' | 'transactionDate' | 'deletedAt' | 'direction'
  > | null;
  inflow: Pick<
    TreasuryEntry,
    'account' | 'amount' | 'transactionDate' | 'deletedAt' | 'direction'
  > | null;
}): TransferFingerprintInput {
  const { transferId, outflow, inflow } = args;
  const pairComplete = Boolean(outflow && inflow);
  const active =
    pairComplete && outflow!.deletedAt == null && inflow!.deletedAt == null;
  return {
    transferId,
    sourceAccount: outflow?.account ?? '',
    destinationAccount: inflow?.account ?? '',
    amount: outflow?.amount.toFixed(2) ?? '0.00',
    inflowAmount: inflow?.amount.toFixed(2) ?? '0.00',
    transferDate: utcDayBucket(outflow?.transactionDate ?? inflow?.transactionDate ?? null),
    pairComplete,
    active,
  };
}

export function transferReversalFingerprint(input: TransferFingerprintInput): string {
  const material = [
    'TREASURY_TRANSFER',
    input.transferId,
    input.sourceAccount,
    input.destinationAccount,
    input.amount,
    input.inflowAmount,
    input.transferDate ?? '',
    input.pairComplete ? '1' : '0',
    input.active ? '1' : '0',
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function transferReversalSnapshot(args: {
  transferId: string;
  outflow: Pick<
    TreasuryEntry,
    'account' | 'amount' | 'transactionDate' | 'deletedAt'
  > | null;
  inflow: Pick<
    TreasuryEntry,
    'account' | 'amount' | 'transactionDate' | 'deletedAt'
  > | null;
}): TransferReversalSnapshot {
  const { outflow, inflow } = args;
  const pairComplete = Boolean(outflow && inflow);
  return {
    kind: 'TREASURY_TRANSFER',
    amount: outflow?.amount.toFixed(2) ?? inflow?.amount.toFixed(2) ?? '0.00',
    currency: 'MXN',
    sourceAccount: (outflow?.account as TransferReversalSnapshot['sourceAccount']) ?? 'CASH',
    destinationAccount:
      (inflow?.account as TransferReversalSnapshot['destinationAccount']) ?? 'BANK',
    transferDate: utcDayBucket(outflow?.transactionDate ?? inflow?.transactionDate ?? null),
    active: pairComplete && outflow!.deletedAt == null && inflow!.deletedAt == null,
    pairComplete,
  };
}

export function transferLegProvenanceKeys(transferId: string) {
  return {
    outflow: treasuryTransferOutflowProvenanceKey(transferId),
    inflow: treasuryTransferInflowProvenanceKey(transferId),
  };
}

export function transferFingerprintsMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}
