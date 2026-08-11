import { Prisma, TreasuryDirection } from '@prisma/client';

/**
 * Canonical treasury-transfer pair economic validation (26D.1).
 *
 * Domain authority: used by TreasuryTransferService.reverse / classifyReversal
 * and mirrored by AI resolvers. Malformed economics → INVARIANT, never mutate.
 *
 * Precedence (fail-closed):
 * 1. Structural (unpaired / partial / direction) — handled by callers first
 * 2. Economic (amount equality + account coherence) — this module
 * 3. Causal key mismatch on reversed pairs — callers
 * 4. SAME_COMMAND / EXTERNAL / ACTIVE — callers
 *
 * Amount mismatch and account coherence never recover as SAME_COMMAND or
 * report EXTERNAL success; INVARIANT wins.
 */

export type TransferPairLeg = {
  direction: TreasuryDirection | string;
  account: string;
  amount: Prisma.Decimal | { abs: () => Prisma.Decimal; toFixed?: (n: number) => string };
  deletedAt?: Date | null;
};

export type TransferPairEconomicsCode =
  | 'AMOUNT_MISMATCH'
  | 'ACCOUNT_COHERENCE'
  | 'DIRECTION_COHERENCE';

export type TransferPairEconomicsResult =
  | { ok: true }
  | { ok: false; code: TransferPairEconomicsCode };

/** User-facing Spanish — never expose raw codes. */
export const CANONICAL_TREASURY_TRANSFER_INVARIANT_MESSAGE =
  'No puedo revertir esa transferencia de forma segura porque su registro financiero está incompleto.';

function asDecimal(
  value: TransferPairLeg['amount'],
): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value && typeof (value as Prisma.Decimal).abs === 'function') {
    return value as Prisma.Decimal;
  }
  return new Prisma.Decimal(String(value));
}

/**
 * Exact Decimal abs equality — no float, no tolerance, no silent normalize.
 */
export function transferPairAmountsMatch(
  outflowAmount: TransferPairLeg['amount'],
  inflowAmount: TransferPairLeg['amount'],
): boolean {
  const outAbs = asDecimal(outflowAmount).abs();
  const inAbs = asDecimal(inflowAmount).abs();
  return outAbs.equals(inAbs);
}

/**
 * Validate pair economics for a complete OUTFLOW+INFLOW pair.
 * Callers must already ensure both legs exist.
 */
export function classifyTransferPairEconomics(
  outflow: TransferPairLeg,
  inflow: TransferPairLeg,
): TransferPairEconomicsResult {
  if (
    outflow.direction !== TreasuryDirection.OUTFLOW &&
    outflow.direction !== 'OUTFLOW'
  ) {
    return { ok: false, code: 'DIRECTION_COHERENCE' };
  }
  if (
    inflow.direction !== TreasuryDirection.INFLOW &&
    inflow.direction !== 'INFLOW'
  ) {
    return { ok: false, code: 'DIRECTION_COHERENCE' };
  }

  if (!outflow.account || !inflow.account || outflow.account === inflow.account) {
    return { ok: false, code: 'ACCOUNT_COHERENCE' };
  }

  if (!transferPairAmountsMatch(outflow.amount, inflow.amount)) {
    return { ok: false, code: 'AMOUNT_MISMATCH' };
  }

  return { ok: true };
}

export function isTransferPairEconomicallyValid(
  outflow: TransferPairLeg,
  inflow: TransferPairLeg,
): boolean {
  return classifyTransferPairEconomics(outflow, inflow).ok;
}
