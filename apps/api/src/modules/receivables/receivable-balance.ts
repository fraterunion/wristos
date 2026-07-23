import { PaymentMethod, Prisma, ReceivablePaymentMethod, ReceivableStatus } from '@prisma/client';

export type AgingBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

type DecimalLike = Prisma.Decimal | number | string;

function toDecimal(value: DecimalLike): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Sum normalized amounts for active (non-deleted) payments. */
export function sumNormalizedPayments(
  payments: Array<{ normalizedAmount: DecimalLike; deletedAt?: Date | null }>,
): Prisma.Decimal {
  return payments.reduce((sum, payment) => {
    if (payment.deletedAt) return sum;
    return sum.plus(toDecimal(payment.normalizedAmount));
  }, new Prisma.Decimal(0));
}

/** Remaining balance; never negative for display / open AR. */
export function remainingBalance(
  normalizedAmount: DecimalLike,
  paidNormalized: DecimalLike,
): Prisma.Decimal {
  const remaining = toDecimal(normalizedAmount).minus(toDecimal(paidNormalized));
  return remaining.lessThan(0) ? new Prisma.Decimal(0) : remaining;
}

export function deriveReceivableStatus(params: {
  normalizedAmount: DecimalLike;
  paidNormalized: DecimalLike;
  dueDate?: Date | null;
  now: Date;
  writtenOff?: boolean;
}): ReceivableStatus {
  if (params.writtenOff) {
    return ReceivableStatus.WRITTEN_OFF;
  }

  const amount = toDecimal(params.normalizedAmount);
  const paid = toDecimal(params.paidNormalized);
  const remaining = amount.minus(paid);

  if (remaining.lessThanOrEqualTo(0)) {
    return ReceivableStatus.PAID;
  }

  const isOverdue =
    params.dueDate != null && params.now.getTime() > params.dueDate.getTime();

  if (isOverdue) {
    return ReceivableStatus.OVERDUE;
  }

  if (paid.lessThanOrEqualTo(0)) {
    return ReceivableStatus.PENDING;
  }

  return ReceivableStatus.PARTIALLY_PAID;
}

/** Whole calendar days since issue date (UTC midnight based). */
export function ageDays(issueDate: Date, now: Date): number {
  const issueUtc = Date.UTC(
    issueDate.getUTCFullYear(),
    issueDate.getUTCMonth(),
    issueDate.getUTCDate(),
  );
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((nowUtc - issueUtc) / 86_400_000));
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export function mapDealPaymentMethodToReceivable(
  method: PaymentMethod | string,
): ReceivablePaymentMethod {
  switch (method) {
    case PaymentMethod.TRANSFER:
    case PaymentMethod.BANCOS:
    case 'TRANSFER':
    case 'BANCOS':
      return ReceivablePaymentMethod.BANK_TRANSFER;
    case PaymentMethod.CESAR:
    case 'CESAR':
      return ReceivablePaymentMethod.OTHER;
    case PaymentMethod.CASH:
    case 'CASH':
      return ReceivablePaymentMethod.CASH;
    case PaymentMethod.CARD:
    case 'CARD':
      return ReceivablePaymentMethod.CARD;
    case PaymentMethod.OTHER:
    case 'OTHER':
    default:
      return ReceivablePaymentMethod.OTHER;
  }
}

/** Map receivable method back to deal PaymentMethod for ventas compatibility. */
export function mapReceivableMethodToDealPayment(
  method: ReceivablePaymentMethod,
): PaymentMethod {
  switch (method) {
    case ReceivablePaymentMethod.BANK_TRANSFER:
    case ReceivablePaymentMethod.WIRE:
      return PaymentMethod.TRANSFER;
    case ReceivablePaymentMethod.CASH:
      return PaymentMethod.CASH;
    case ReceivablePaymentMethod.CARD:
      return PaymentMethod.CARD;
    default:
      return PaymentMethod.OTHER;
  }
}
