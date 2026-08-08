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
  PaymentStatus,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
  TreasuryEntry,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TreasuryService } from '../treasury/treasury.service';
import { AccountPaymentDestination } from './dto/create-account-payment.dto';

export type ReceivablePaymentDestination =
  | 'CASH'
  | 'BANK'
  | 'CESAR'
  | 'APPLY_TO_PAYABLE';

export type RegisterReceivablePaymentInput = {
  receivableEntryId: string;
  amount: Prisma.Decimal | number | string;
  destination: ReceivablePaymentDestination;
  /** Required when destination = APPLY_TO_PAYABLE */
  payableEntryId?: string | null;
  paymentDate?: Date;
  notes?: string | null;
  currency?: Currency;
  exchangeRateUsed?: Prisma.Decimal | number | string | null;
  /**
   * Durable idempotency for received-money (CASH/BANK/CESAR) → AccountPayment.registerIdempotencyKey.
   * For APPLY_TO_PAYABLE → AccountSettlement.idempotencyKey.
   */
  registerIdempotencyKey?: string | null;
  actorUserId?: string | null;
};

export type RegisterReceivablePaymentResult = {
  destination: ReceivablePaymentDestination;
  receivablePayment: AccountPayment;
  receivableEntry: AccountEntry;
  treasuryEntry: TreasuryEntry | null;
  settlement: {
    id: string;
    idempotencyKey: string | null;
  } | null;
  payablePayment: AccountPayment | null;
  payableEntry: AccountEntry | null;
  replayed: boolean;
};

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

@Injectable()
export class ReceivablePaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryService: TreasuryService,
  ) {}

  /**
   * Canonical receivable payment registration shared by manual Cuentas and future AI.
   *
   * Eligible RECEIVABLE sources: MANUAL and DEAL_AUTO / deal-linked.
   *
   * Dual-ledger invariant (no double-write of the same economic event):
   * - Sale / Ventas addPayment → Deal `Payment` (+ deal Treasury path)
   * - This command → AccountPayment (+ account Treasury path; no bank fee)
   * - Deal-linked outstanding = Σ Deal.Payment(PAID) + Σ AccountPayment(on entry)
   *
   * A) CASH/BANK/CESAR — AccountPayment + Treasury inflow + status, atomic.
   * B) APPLY_TO_PAYABLE — AccountSettlement + two SETTLEMENT legs, atomic, no Treasury.
   *
   * Destinations are exactly: CASH | BANK | CESAR | APPLY_TO_PAYABLE (never CRYPTO).
   */
  async register(
    tenantId: string,
    input: RegisterReceivablePaymentInput,
  ): Promise<RegisterReceivablePaymentResult> {
    const destination = input.destination;
    if (
      destination !== 'CASH' &&
      destination !== 'BANK' &&
      destination !== 'CESAR' &&
      destination !== 'APPLY_TO_PAYABLE'
    ) {
      throw new BadRequestException(
        'Unsupported payment destination. Allowed: CASH, BANK, CESAR, APPLY_TO_PAYABLE',
      );
    }
    if (destination === 'APPLY_TO_PAYABLE') {
      return this.registerSettlement(tenantId, input);
    }
    return this.registerReceivedMoney(tenantId, input, destination);
  }

  private async registerReceivedMoney(
    tenantId: string,
    input: RegisterReceivablePaymentInput,
    destination: 'CASH' | 'BANK' | 'CESAR',
  ): Promise<RegisterReceivablePaymentResult> {
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
        this.assertCompatibleReceivedMoneyReplay(existing, input, destination, amount);
        return this.loadReceivedMoneyResult(existing, /* replayed */ true);
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'registerIdempotencyKey already used by a reversed payment; use a new key',
        );
      }
    }

    const cashAccount =
      destination === 'CASH'
        ? TreasuryAccount.CASH
        : destination === 'BANK'
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
              id: input.receivableEntryId,
              tenantId,
              deletedAt: null,
            },
            include: { payments: { where: { deletedAt: null } } },
          });
          if (!entry) throw new NotFoundException('Account entry not found');
          this.assertPayableReceivable(entry);
          if (entry.status === AccountEntryStatus.CANCELLED) {
            throw new BadRequestException('Cannot pay a cancelled receivable');
          }
          if (entry.status === AccountEntryStatus.PAID) {
            throw new BadRequestException('Cannot pay a fully paid receivable');
          }

          const currency = input.currency ?? entry.currency;
          if (currency !== entry.currency) {
            throw new BadRequestException('Payment currency must match entry currency');
          }
          this.assertExchangeRateForCurrency(currency, input.exchangeRateUsed);

          const paid = await this.resolveReceivablePaidTotal(entry, tenantId, tx);
          const outstanding = entry.totalAmount.minus(paid);
          if (outstanding.lessThanOrEqualTo(0)) {
            throw new BadRequestException('Cannot pay a fully paid receivable');
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
            direction: TreasuryDirection.INFLOW,
            amount: payment.amount,
            currency: payment.currency,
            exchangeRateUsed: payment.exchangeRateUsed,
            transactionDate: payment.paidAt,
            description: `${entry.counterpartyName} — ${entry.concept}`,
            tx,
          });

          // Do NOT mutate Deal / Watch / agreedPrice — only AccountEntry payment state.
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
          this.assertCompatibleReceivedMoneyReplay(raced, input, destination, amount);
          return this.loadReceivedMoneyResult(raced, /* replayed */ true);
        }
      }
      throw error;
    }

    const created = await this.prisma.accountPayment.findFirstOrThrow({
      where: { id: paymentId, tenantId },
    });
    return this.loadReceivedMoneyResult(created, /* replayed */ false);
  }

  private async registerSettlement(
    tenantId: string,
    input: RegisterReceivablePaymentInput,
  ): Promise<RegisterReceivablePaymentResult> {
    const payableEntryId = input.payableEntryId?.trim();
    if (!payableEntryId) {
      throw new BadRequestException('payableEntryId is required for APPLY_TO_PAYABLE');
    }

    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Settlement amount must be greater than 0');
    }

    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);
    if (idempotencyKey) {
      const existing = await this.prisma.accountSettlement.findFirst({
        where: { tenantId, idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        return this.loadSettlementResult(existing.id, tenantId, /* replayed */ true);
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'idempotencyKey already used by a reversed settlement; use a new key',
        );
      }
    }

    const paidAt = input.paymentDate ?? new Date();
    let settlementId: string;
    try {
      settlementId = await this.prisma.$transaction(
        async (tx) => {
          const receivable = await tx.accountEntry.findFirst({
            where: { id: input.receivableEntryId, tenantId, deletedAt: null },
            include: { payments: { where: { deletedAt: null } } },
          });
          if (!receivable) throw new NotFoundException('Account entry not found');
          this.assertPayableReceivable(receivable);
          if (receivable.status === AccountEntryStatus.CANCELLED) {
            throw new BadRequestException('Cannot settle a cancelled receivable');
          }
          if (receivable.status === AccountEntryStatus.PAID) {
            throw new BadRequestException('Cannot settle a fully paid receivable');
          }

          const payable = await tx.accountEntry.findFirst({
            where: { id: payableEntryId, tenantId, deletedAt: null },
            include: { payments: { where: { deletedAt: null } } },
          });
          if (!payable) throw new NotFoundException('Payable account entry not found');
          if (payable.type !== AccountEntryType.PAYABLE) {
            throw new BadRequestException('Target must be a PAYABLE account entry');
          }
          if (payable.status === AccountEntryStatus.CANCELLED) {
            throw new BadRequestException('Cannot settle against a cancelled payable');
          }
          if (payable.status === AccountEntryStatus.PAID) {
            throw new BadRequestException('Cannot settle against a fully paid payable');
          }
          // Payables are manual Cuentas entries only (no DEAL_AUTO payables today).
          this.assertManualPayable(payable);

          if (receivable.currency !== payable.currency) {
            throw new BadRequestException(
              'Las cuentas deben estar en la misma moneda para aplicar una compensación.',
            );
          }

          const currency = input.currency ?? receivable.currency;
          if (currency !== receivable.currency) {
            throw new BadRequestException('Payment currency must match entry currency');
          }

          const receivablePaid = await this.resolveReceivablePaidTotal(
            receivable,
            tenantId,
            tx,
          );
          const receivableOutstanding = receivable.totalAmount.minus(receivablePaid);
          const payableOutstanding = this.outstandingFromPayments(
            payable.totalAmount,
            payable.payments,
          );
          if (receivableOutstanding.lessThanOrEqualTo(0)) {
            throw new BadRequestException('Cannot settle a fully paid receivable');
          }
          if (amount.greaterThan(receivableOutstanding)) {
            throw new BadRequestException(
              `El monto excede el saldo pendiente del cobro (${receivableOutstanding.toFixed(2)} ${currency}).`,
            );
          }
          if (amount.greaterThan(payableOutstanding)) {
            throw new BadRequestException(
              `El monto excede el saldo pendiente de la cuenta por pagar (${payableOutstanding.toFixed(2)} ${currency}).`,
            );
          }

          const receivablePayment = await tx.accountPayment.create({
            data: {
              tenantId,
              entryId: receivable.id,
              amount,
              currency,
              method: PaymentMethod.SETTLEMENT,
              paidAt,
              notes: input.notes ?? null,
              cashAccount: null,
              exchangeRateUsed: null,
              registerIdempotencyKey: null,
            },
          });
          const payablePayment = await tx.accountPayment.create({
            data: {
              tenantId,
              entryId: payable.id,
              amount,
              currency,
              method: PaymentMethod.SETTLEMENT,
              paidAt,
              notes: input.notes ?? null,
              cashAccount: null,
              exchangeRateUsed: null,
              registerIdempotencyKey: null,
            },
          });

          const settlement = await tx.accountSettlement.create({
            data: {
              tenantId,
              receivableEntryId: receivable.id,
              payableEntryId: payable.id,
              receivablePaymentId: receivablePayment.id,
              payablePaymentId: payablePayment.id,
              amount,
              currency,
              effectiveDate: paidAt,
              notes: input.notes ?? null,
              createdByUserId: input.actorUserId ?? null,
              idempotencyKey,
            },
          });

          // Persist status on both sides inside the same transaction.
          // Deal / Watch remain untouched for deal-linked CXC settlements.
          const nextRecvPaid = receivablePaid.plus(amount);
          const nextPayPaid = payable.payments
            .reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0))
            .plus(amount);
          const recvStatus = this.resolveStatus(receivable, nextRecvPaid);
          const payStatus = this.resolveStatus(payable, nextPayPaid);
          await tx.accountEntry.update({
            where: { id: receivable.id },
            data: { status: recvStatus.status, closedAt: recvStatus.closedAt },
          });
          await tx.accountEntry.update({
            where: { id: payable.id },
            data: { status: payStatus.status, closedAt: payStatus.closedAt },
          });

          return settlement.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const existing = await this.prisma.accountSettlement.findFirst({
          where: { tenantId, idempotencyKey, deletedAt: null },
        });
        if (existing) {
          return this.loadSettlementResult(existing.id, tenantId, /* replayed */ true);
        }
      }
      throw error;
    }

    return this.loadSettlementResult(settlementId, tenantId, /* replayed */ false);
  }

  private async loadReceivedMoneyResult(
    payment: AccountPayment,
    replayed: boolean,
  ): Promise<RegisterReceivablePaymentResult> {
    const [receivableEntry, treasuryEntry] = await Promise.all([
      this.prisma.accountEntry.findFirstOrThrow({
        where: { id: payment.entryId, tenantId: payment.tenantId },
      }),
      this.prisma.treasuryEntry.findFirst({
        where: { accountPaymentId: payment.id, deletedAt: null },
      }),
    ]);

    const destination: ReceivablePaymentDestination =
      payment.cashAccount === TreasuryAccount.BANK
        ? 'BANK'
        : payment.cashAccount === TreasuryAccount.CESAR
          ? 'CESAR'
          : 'CASH';

    return {
      destination,
      receivablePayment: payment,
      receivableEntry,
      treasuryEntry,
      settlement: null,
      payablePayment: null,
      payableEntry: null,
      replayed,
    };
  }

  private async loadSettlementResult(
    settlementId: string,
    tenantId: string,
    replayed: boolean,
  ): Promise<RegisterReceivablePaymentResult> {
    const settlement = await this.prisma.accountSettlement.findFirst({
      where: { id: settlementId, tenantId },
      include: {
        receivablePayment: true,
        payablePayment: true,
        receivableEntry: true,
        payableEntry: true,
      },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');

    return {
      destination: 'APPLY_TO_PAYABLE',
      receivablePayment: settlement.receivablePayment,
      receivableEntry: settlement.receivableEntry,
      treasuryEntry: null,
      settlement: {
        id: settlement.id,
        idempotencyKey: settlement.idempotencyKey,
      },
      payablePayment: settlement.payablePayment,
      payableEntry: settlement.payableEntry,
      replayed,
    };
  }

  private assertCompatibleReceivedMoneyReplay(
    existing: AccountPayment,
    input: RegisterReceivablePaymentInput,
    destination: 'CASH' | 'BANK' | 'CESAR',
    amount: Prisma.Decimal,
  ) {
    const expectedAccount =
      destination === 'CASH'
        ? TreasuryAccount.CASH
        : destination === 'BANK'
          ? TreasuryAccount.BANK
          : TreasuryAccount.CESAR;
    if (existing.entryId !== input.receivableEntryId) {
      throw new ConflictException('registerIdempotencyKey payload conflict: receivableEntryId');
    }
    if (!existing.amount.equals(amount)) {
      throw new ConflictException('registerIdempotencyKey payload conflict: amount');
    }
    if (existing.cashAccount !== expectedAccount) {
      throw new ConflictException('registerIdempotencyKey payload conflict: destination');
    }
  }

  /**
   * Business eligibility for receivable payment — not origin-type gatekeeping.
   * MANUAL and DEAL_AUTO / deal-linked sale CXC are both payable here.
   */
  private assertPayableReceivable(entry: AccountEntry) {
    if (entry.type !== AccountEntryType.RECEIVABLE) {
      throw new BadRequestException('ReceivablePaymentService only registers RECEIVABLE payments');
    }
    if (entry.deletedAt) {
      throw new BadRequestException('Cannot pay a deleted receivable');
    }
    if (
      entry.currency !== Currency.MXN &&
      entry.currency !== Currency.USD
    ) {
      throw new BadRequestException('Unsupported receivable currency');
    }
  }

  private assertManualPayable(entry: AccountEntry) {
    if (entry.source === AccountEntrySource.DEAL_AUTO || entry.dealId !== null) {
      throw new BadRequestException(
        'Settlement target must be a manual PAYABLE without deal linkage',
      );
    }
  }

  private isDealLinked(entry: Pick<AccountEntry, 'source' | 'dealId'>): boolean {
    return entry.source === AccountEntrySource.DEAL_AUTO || entry.dealId !== null;
  }

  /**
   * Canonical paid total for a receivable:
   * - MANUAL → Σ AccountPayment
   * - DEAL_AUTO → Σ Deal.Payment(PAID) + Σ AccountPayment (no double-write of one event)
   */
  private async resolveReceivablePaidTotal(
    entry: AccountEntry & { payments: Array<{ amount: Prisma.Decimal }> },
    tenantId: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<Prisma.Decimal> {
    const accountPaid = entry.payments.reduce(
      (sum, p) => sum.plus(p.amount),
      new Prisma.Decimal(0),
    );
    if (!this.isDealLinked(entry) || !entry.dealId) {
      return accountPaid;
    }
    const dealPaid = await this.getDealPaidTotal(tenantId, entry.dealId, db);
    return dealPaid.plus(accountPaid);
  }

  private async getDealPaidTotal(
    tenantId: string,
    dealId: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<Prisma.Decimal> {
    const agg = await db.payment.aggregate({
      where: {
        tenantId,
        dealId,
        status: PaymentStatus.PAID,
        deletedAt: null,
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Prisma.Decimal(0);
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

  private outstandingFromPayments(
    totalAmount: Prisma.Decimal,
    payments: Array<{ amount: Prisma.Decimal }>,
  ): Prisma.Decimal {
    const paid = payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    return totalAmount.minus(paid);
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

/** Map DTO destination enum → canonical destination. */
export function toReceivableDestination(
  destination: AccountPaymentDestination,
): ReceivablePaymentDestination {
  if (destination === AccountPaymentDestination.APPLY_TO_PAYABLE) return 'APPLY_TO_PAYABLE';
  if (destination === AccountPaymentDestination.BANK) return 'BANK';
  if (destination === AccountPaymentDestination.CESAR) return 'CESAR';
  return 'CASH';
}
