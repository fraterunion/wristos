import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountEntry,
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  AccountPayment,
  Currency,
  PaymentMethod,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
  TreasuryEntry,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TreasuryService } from '../treasury/treasury.service';
import { AccountPaymentDestination } from './dto/create-account-payment.dto';

export type PayablePaymentSourceAccount = 'CASH' | 'BANK' | 'CESAR';

export type RegisterPayablePaymentInput = {
  payableEntryId: string;
  amount: Prisma.Decimal | number | string;
  sourceAccount: PayablePaymentSourceAccount;
  paymentDate?: Date;
  notes?: string | null;
  currency?: Currency;
  exchangeRateUsed?: Prisma.Decimal | number | string | null;
  /**
   * Durable idempotency → AccountPayment.registerIdempotencyKey.
   * Future AI marker: ai-action-run:<actionRunId>
   */
  registerIdempotencyKey?: string | null;
  actorUserId?: string | null;
};

export type RegisterPayablePaymentResult = {
  payablePayment: AccountPayment;
  payableEntry: AccountEntry;
  treasuryEntry: TreasuryEntry;
  remainingOutstanding: Prisma.Decimal;
  sourceAccount: PayablePaymentSourceAccount;
  replayed: boolean;
};

export type ReversePayablePaymentResult = {
  payableEntry: AccountEntry;
  reversed: boolean;
  alreadyReversed: boolean;
};

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/**
 * Canonical PAYABLE (CXP) cash payment — AccountPayment OUTFLOW + Treasury.
 *
 * Distinct from APPLY_TO_PAYABLE settlement (CXC↔CXP, no Treasury).
 * Eligible sources: MANUAL and PURCHASE_AUTO (not deal-linked).
 */
@Injectable()
export class PayablePaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryService: TreasuryService,
  ) {}

  async register(
    tenantId: string,
    input: RegisterPayablePaymentInput,
  ): Promise<RegisterPayablePaymentResult> {
    const source = input.sourceAccount;
    if (source !== 'CASH' && source !== 'BANK' && source !== 'CESAR') {
      throw new BadRequestException(
        'Unsupported funding source. Allowed: CASH, BANK, CESAR',
      );
    }

    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);
    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    if (idempotencyKey) {
      const existing = await this.prisma.accountPayment.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        this.assertCompatibleReplay(existing, input, source, amount);
        return this.loadResult(existing, /* replayed */ true);
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'registerIdempotencyKey already used by a reversed payment; use a new key',
        );
      }
    }

    const cashAccount =
      source === 'CASH'
        ? TreasuryAccount.CASH
        : source === 'BANK'
          ? TreasuryAccount.BANK
          : TreasuryAccount.CESAR;
    const method =
      cashAccount === TreasuryAccount.CASH
        ? PaymentMethod.CASH
        : cashAccount === TreasuryAccount.BANK
          ? PaymentMethod.BANCOS
          : PaymentMethod.CESAR;
    const paidAt = input.paymentDate ?? new Date();

    let paymentId: string;
    try {
      paymentId = await this.prisma.$transaction(
        async (tx) => {
          const entry = await tx.accountEntry.findFirst({
            where: {
              id: input.payableEntryId,
              tenantId,
              deletedAt: null,
            },
            include: { payments: { where: { deletedAt: null } } },
          });
          if (!entry) throw new NotFoundException('Account entry not found');
          this.assertEligiblePayable(entry);
          if (entry.status === AccountEntryStatus.CANCELLED) {
            throw new BadRequestException('Cannot pay a cancelled payable');
          }
          if (entry.status === AccountEntryStatus.PAID) {
            throw new BadRequestException('Cannot pay a fully paid payable');
          }

          const currency = input.currency ?? entry.currency;
          if (currency !== entry.currency) {
            throw new BadRequestException('Payment currency must match entry currency');
          }
          this.assertExchangeRateForCurrency(currency, input.exchangeRateUsed);

          const paid = this.paidTotalFromPayments(entry.payments);
          const outstanding = entry.totalAmount.minus(paid);
          if (outstanding.lessThanOrEqualTo(0)) {
            throw new BadRequestException('Cannot pay a fully paid payable');
          }
          if (amount.greaterThan(outstanding)) {
            throw new BadRequestException(
              `El monto excede el saldo pendiente (${outstanding.toFixed(2)} ${entry.currency}).`,
            );
          }

          const payment = await tx.accountPayment.create({
            data: {
              tenantId,
              entryId: entry.id,
              amount,
              currency,
              method,
              paidAt,
              notes: input.notes ?? null,
              cashAccount,
              exchangeRateUsed:
                currency === Currency.USD && input.exchangeRateUsed != null
                  ? asDecimal(input.exchangeRateUsed)
                  : null,
              registerIdempotencyKey: idempotencyKey,
            },
          });

          await this.treasuryService.createFromAccountPayment({
            tenantId,
            accountPaymentId: payment.id,
            account: cashAccount,
            direction: TreasuryDirection.OUTFLOW,
            amount: payment.amount,
            currency: payment.currency,
            exchangeRateUsed: payment.exchangeRateUsed,
            transactionDate: payment.paidAt,
            description: `Pago — ${entry.counterpartyName} · ${entry.concept}`,
            tx,
          });

          const nextPaid = paid.plus(amount);
          const { status, closedAt } = this.resolveStatus(entry, nextPaid);
          if (entry.status !== status || entry.closedAt?.getTime() !== closedAt?.getTime()) {
            await tx.accountEntry.update({
              where: { id: entry.id },
              data: { status, closedAt },
            });
          }

          return payment.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const raced = await this.prisma.accountPayment.findFirst({
          where: { tenantId, registerIdempotencyKey: idempotencyKey, deletedAt: null },
        });
        if (raced) {
          this.assertCompatibleReplay(raced, input, source, amount);
          return this.loadResult(raced, /* replayed */ true);
        }
      }
      // Serializable conflict → surface as conflict for concurrent overpay races that lost.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Payable payment conflicted with a concurrent update; retry with current outstanding',
        );
      }
      throw error;
    }

    const created = await this.prisma.accountPayment.findFirstOrThrow({
      where: { id: paymentId, tenantId },
    });
    return this.loadResult(created, /* replayed */ false);
  }

  /**
   * Soft-delete AccountPayment + Treasury OUTFLOW + restore PAYABLE status (atomic).
   * Second reverse is idempotent (alreadyReversed).
   */
  async reverse(
    tenantId: string,
    payableEntryId: string,
    paymentId: string,
  ): Promise<ReversePayablePaymentResult> {
    const payment = await this.prisma.accountPayment.findFirst({
      where: { id: paymentId, tenantId, entryId: payableEntryId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.deletedAt) {
      const entry = await this.prisma.accountEntry.findFirstOrThrow({
        where: { id: payableEntryId, tenantId },
      });
      return { payableEntry: entry, reversed: false, alreadyReversed: true };
    }

    // Settlement-linked legs must use settlement reverse — never cash reverse.
    const settlement = await this.prisma.accountSettlement.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ receivablePaymentId: paymentId }, { payablePaymentId: paymentId }],
      },
    });
    if (settlement) {
      throw new BadRequestException(
        'Settlement-linked payment must be reversed via settlement reverse',
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        const entry = await tx.accountEntry.findFirst({
          where: { id: payableEntryId, tenantId, deletedAt: null },
          include: { payments: { where: { deletedAt: null } } },
        });
        if (!entry) throw new NotFoundException('Account entry not found');
        this.assertEligiblePayable(entry);

        await tx.accountPayment.update({
          where: { id: paymentId },
          data: { deletedAt: new Date() },
        });
        await this.treasuryService.deleteByAccountPaymentId(paymentId, tx);

        const remainingPayments = entry.payments.filter((p) => p.id !== paymentId);
        const paid = this.paidTotalFromPayments(remainingPayments);
        const { status, closedAt } = this.resolveStatus(entry, paid);
        await tx.accountEntry.update({
          where: { id: entry.id },
          data: { status, closedAt },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const payableEntry = await this.prisma.accountEntry.findFirstOrThrow({
      where: { id: payableEntryId, tenantId },
    });
    return { payableEntry, reversed: true, alreadyReversed: false };
  }

  private async loadResult(
    payment: AccountPayment,
    replayed: boolean,
  ): Promise<RegisterPayablePaymentResult> {
    const [payableEntry, treasuryEntry, payments] = await Promise.all([
      this.prisma.accountEntry.findFirstOrThrow({
        where: { id: payment.entryId, tenantId: payment.tenantId },
      }),
      this.prisma.treasuryEntry.findFirst({
        where: { accountPaymentId: payment.id, deletedAt: null },
      }),
      this.prisma.accountPayment.findMany({
        where: { entryId: payment.entryId, tenantId: payment.tenantId, deletedAt: null },
        select: { amount: true },
      }),
    ]);
    if (!treasuryEntry) {
      throw new ConflictException('Payable payment is missing Treasury outflow');
    }
    const paid = this.paidTotalFromPayments(payments);
    const remainingOutstanding = payableEntry.totalAmount.minus(paid);
    const sourceAccount: PayablePaymentSourceAccount =
      payment.cashAccount === TreasuryAccount.BANK
        ? 'BANK'
        : payment.cashAccount === TreasuryAccount.CESAR
          ? 'CESAR'
          : 'CASH';

    return {
      payablePayment: payment,
      payableEntry,
      treasuryEntry,
      remainingOutstanding,
      sourceAccount,
      replayed,
    };
  }

  private assertCompatibleReplay(
    existing: AccountPayment,
    input: RegisterPayablePaymentInput,
    source: PayablePaymentSourceAccount,
    amount: Prisma.Decimal,
  ) {
    const expectedAccount =
      source === 'CASH'
        ? TreasuryAccount.CASH
        : source === 'BANK'
          ? TreasuryAccount.BANK
          : TreasuryAccount.CESAR;
    if (existing.entryId !== input.payableEntryId) {
      throw new ConflictException('registerIdempotencyKey payload conflict: payableEntryId');
    }
    if (!existing.amount.equals(amount)) {
      throw new ConflictException('registerIdempotencyKey payload conflict: amount');
    }
    if (existing.cashAccount !== expectedAccount) {
      throw new ConflictException('registerIdempotencyKey payload conflict: sourceAccount');
    }
  }

  /**
   * Eligible PAYABLE sources for cash payment: MANUAL and PURCHASE_AUTO.
   * Deal-linked entries are not CXP cash-payment targets.
   */
  private assertEligiblePayable(entry: AccountEntry) {
    if (entry.type !== AccountEntryType.PAYABLE) {
      throw new BadRequestException('PayablePaymentService only registers PAYABLE payments');
    }
    if (entry.deletedAt) {
      throw new BadRequestException('Cannot pay a deleted payable');
    }
    if (entry.source === AccountEntrySource.DEAL_AUTO || entry.dealId !== null) {
      throw new BadRequestException(
        'Cannot pay a deal-linked entry as a PAYABLE cash payment',
      );
    }
    if (
      entry.source !== AccountEntrySource.MANUAL &&
      entry.source !== AccountEntrySource.PURCHASE_AUTO
    ) {
      throw new BadRequestException('Unsupported PAYABLE source for cash payment');
    }
    if (entry.currency !== Currency.MXN && entry.currency !== Currency.USD) {
      throw new BadRequestException('Unsupported payable currency');
    }
  }

  private assertExchangeRateForCurrency(
    currency: Currency,
    exchangeRateUsed?: Prisma.Decimal | number | string | null,
  ) {
    if (currency === Currency.USD) {
      if (exchangeRateUsed === undefined || exchangeRateUsed === null) {
        throw new BadRequestException('exchangeRateUsed is required for USD payments');
      }
    }
  }

  private paidTotalFromPayments(payments: Array<{ amount: Prisma.Decimal }>): Prisma.Decimal {
    return payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  }

  private resolveStatus(
    entry: AccountEntry,
    paidTotal: Prisma.Decimal,
  ): { status: AccountEntryStatus; closedAt: Date | null } {
    if (entry.status === AccountEntryStatus.CANCELLED) {
      return { status: AccountEntryStatus.CANCELLED, closedAt: entry.closedAt };
    }
    const balance = entry.totalAmount.minus(paidTotal);
    const now = new Date();
    let status: AccountEntryStatus;
    if (paidTotal.greaterThanOrEqualTo(entry.totalAmount)) {
      status = AccountEntryStatus.PAID;
    } else if (paidTotal.greaterThan(0)) {
      status = AccountEntryStatus.PARTIAL;
    } else if (entry.dueDate && entry.dueDate < now && balance.greaterThan(0)) {
      status = AccountEntryStatus.OVERDUE;
    } else {
      status = AccountEntryStatus.OPEN;
    }
    const closedAt =
      status === AccountEntryStatus.PAID ? entry.closedAt ?? new Date() : null;
    return { status, closedAt };
  }
}

/** Map DTO destination enum → payable funding source (never APPLY_TO_PAYABLE). */
export function toPayableSourceAccount(
  destination: AccountPaymentDestination,
): PayablePaymentSourceAccount {
  if (destination === AccountPaymentDestination.APPLY_TO_PAYABLE) {
    throw new BadRequestException(
      'APPLY_TO_PAYABLE is settlement, not payable cash payment',
    );
  }
  if (destination === AccountPaymentDestination.BANK) return 'BANK';
  if (destination === AccountPaymentDestination.CESAR) return 'CESAR';
  return 'CASH';
}
