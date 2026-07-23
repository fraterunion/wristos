import { PaymentMethod, ReceivablePaymentMethod, ReceivableStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  ageDays,
  agingBucket,
  deriveReceivableStatus,
  mapDealPaymentMethodToReceivable,
  remainingBalance,
  sumNormalizedPayments,
} from './receivable-balance';

function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

describe('receivable-balance helpers', () => {
  describe('sumNormalizedPayments', () => {
    it('sums active payments and ignores soft-deleted', () => {
      const total = sumNormalizedPayments([
        { normalizedAmount: d(100) },
        { normalizedAmount: d(50), deletedAt: null },
        { normalizedAmount: d(25), deletedAt: new Date() },
        { normalizedAmount: d(-10) },
      ]);
      expect(total.toString()).toBe('140');
    });

    it('returns 0 for empty list', () => {
      expect(sumNormalizedPayments([]).toString()).toBe('0');
    });
  });

  describe('remainingBalance', () => {
    it('subtracts paid from amount', () => {
      expect(remainingBalance(d(300), d(100)).toString()).toBe('200');
    });

    it('never returns negative', () => {
      expect(remainingBalance(d(100), d(150)).toString()).toBe('0');
    });
  });

  describe('deriveReceivableStatus', () => {
    const now = new Date('2026-07-23T12:00:00.000Z');

    it('returns WRITTEN_OFF when writtenOff', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(0),
          dueDate: new Date('2026-01-01'),
          now,
          writtenOff: true,
        }),
      ).toBe(ReceivableStatus.WRITTEN_OFF);
    });

    it('returns PENDING when unpaid and not overdue', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(0),
          dueDate: new Date('2026-08-01'),
          now,
        }),
      ).toBe(ReceivableStatus.PENDING);
    });

    it('returns PARTIALLY_PAID when partially collected', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(40),
          dueDate: new Date('2026-08-01'),
          now,
        }),
      ).toBe(ReceivableStatus.PARTIALLY_PAID);
    });

    it('returns PAID when fully collected', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(100),
          dueDate: new Date('2026-01-01'),
          now,
        }),
      ).toBe(ReceivableStatus.PAID);
    });

    it('returns PAID when overpaid', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(120),
          dueDate: new Date('2026-01-01'),
          now,
        }),
      ).toBe(ReceivableStatus.PAID);
    });

    it('returns OVERDUE when past due with remaining balance', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(20),
          dueDate: new Date('2026-06-01'),
          now,
        }),
      ).toBe(ReceivableStatus.OVERDUE);
    });

    it('returns OVERDUE for unpaid past due', () => {
      expect(
        deriveReceivableStatus({
          normalizedAmount: d(100),
          paidNormalized: d(0),
          dueDate: new Date('2026-06-01'),
          now,
        }),
      ).toBe(ReceivableStatus.OVERDUE);
    });
  });

  describe('ageDays / agingBucket', () => {
    const issue = new Date('2026-01-01T00:00:00.000Z');

    it('computes age in whole days', () => {
      expect(ageDays(issue, new Date('2026-01-01T23:00:00.000Z'))).toBe(0);
      expect(ageDays(issue, new Date('2026-01-15T12:00:00.000Z'))).toBe(14);
      expect(ageDays(issue, new Date('2026-04-11T00:00:00.000Z'))).toBe(100);
    });

    it('maps age to aging buckets', () => {
      expect(agingBucket(0)).toBe('CURRENT');
      expect(agingBucket(1)).toBe('D1_30');
      expect(agingBucket(30)).toBe('D1_30');
      expect(agingBucket(31)).toBe('D31_60');
      expect(agingBucket(60)).toBe('D31_60');
      expect(agingBucket(61)).toBe('D61_90');
      expect(agingBucket(90)).toBe('D61_90');
      expect(agingBucket(91)).toBe('D90_PLUS');
    });
  });

  describe('mapDealPaymentMethodToReceivable', () => {
    it('maps deal payment methods', () => {
      expect(mapDealPaymentMethodToReceivable(PaymentMethod.TRANSFER)).toBe(
        ReceivablePaymentMethod.BANK_TRANSFER,
      );
      expect(mapDealPaymentMethodToReceivable(PaymentMethod.BANCOS)).toBe(
        ReceivablePaymentMethod.BANK_TRANSFER,
      );
      expect(mapDealPaymentMethodToReceivable(PaymentMethod.CESAR)).toBe(
        ReceivablePaymentMethod.OTHER,
      );
      expect(mapDealPaymentMethodToReceivable(PaymentMethod.CASH)).toBe(
        ReceivablePaymentMethod.CASH,
      );
      expect(mapDealPaymentMethodToReceivable(PaymentMethod.CARD)).toBe(
        ReceivablePaymentMethod.CARD,
      );
      expect(mapDealPaymentMethodToReceivable(PaymentMethod.OTHER)).toBe(
        ReceivablePaymentMethod.OTHER,
      );
    });
  });
});
