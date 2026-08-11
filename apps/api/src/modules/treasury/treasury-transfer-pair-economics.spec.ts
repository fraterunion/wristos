import { Prisma, TreasuryDirection } from '@prisma/client';
import {
  CANONICAL_TREASURY_TRANSFER_INVARIANT_MESSAGE,
  classifyTransferPairEconomics,
  transferPairAmountsMatch,
} from './treasury-transfer-pair-economics';

describe('treasury-transfer-pair-economics (26D.1)', () => {
  const d = (n: number) => new Prisma.Decimal(n);

  it('accepts equal absolute amounts with coherent accounts', () => {
    expect(
      classifyTransferPairEconomics(
        { direction: TreasuryDirection.OUTFLOW, account: 'BANK', amount: d(3000) },
        { direction: TreasuryDirection.INFLOW, account: 'CASH', amount: d(3000) },
      ),
    ).toEqual({ ok: true });
  });

  it('rejects 3000 vs 2999 with exact Decimal semantics', () => {
    expect(transferPairAmountsMatch(d(3000), d(2999))).toBe(false);
    expect(
      classifyTransferPairEconomics(
        { direction: 'OUTFLOW', account: 'BANK', amount: d(3000) },
        { direction: 'INFLOW', account: 'CASH', amount: d(2999) },
      ),
    ).toEqual({ ok: false, code: 'AMOUNT_MISMATCH' });
  });

  it('rejects same-account pairing', () => {
    expect(
      classifyTransferPairEconomics(
        { direction: 'OUTFLOW', account: 'BANK', amount: d(100) },
        { direction: 'INFLOW', account: 'BANK', amount: d(100) },
      ),
    ).toEqual({ ok: false, code: 'ACCOUNT_COHERENCE' });
  });

  it('rejects wrong directions', () => {
    expect(
      classifyTransferPairEconomics(
        { direction: 'INFLOW', account: 'BANK', amount: d(100) },
        { direction: 'OUTFLOW', account: 'CASH', amount: d(100) },
      ),
    ).toEqual({ ok: false, code: 'DIRECTION_COHERENCE' });
  });

  it('exposes transfer-specific invariant Spanish without expense nouns', () => {
    expect(CANONICAL_TREASURY_TRANSFER_INVARIANT_MESSAGE).toMatch(/transferencia/);
    expect(CANONICAL_TREASURY_TRANSFER_INVARIANT_MESSAGE).not.toMatch(/gasto/i);
  });
});
