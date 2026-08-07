import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AccountEntry,
  Currency,
  Deal,
  DealStage,
  OperatingExpense,
  OperatingExpenseCategory,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TreasuryEntry,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { FxService } from '../fx/fx.service';
import { TreasuryService } from '../treasury/treasury.service';

const BANK_RATES: Record<'JOSE' | 'MAYTE', number> = {
  JOSE: 0.02,
  MAYTE: 0.01,
};

export type SalePaymentInput = {
  /** Received amount in MXN. Omit / 0 → credit (no Payment / no Treasury). */
  amountReceived?: number | null;
  method?: 'CASH' | 'BANCOS' | 'CESAR' | null;
  bankChannel?: 'JOSE' | 'MAYTE' | null;
  paidAt?: Date | null;
};

export type RegisterSaleCanonicalInput = {
  watchId: string;
  clientId: string;
  /** Sale price in the caller's currency (MXN or USD). */
  agreedPrice: number;
  currency?: 'MXN' | 'USD';
  soldAt?: Date;
  notes?: string | null;
  payment?: SalePaymentInput | null;
  /**
   * Legacy: paymentMethod alone without amountReceived ⇒ full payment.
   * Prefer `payment.amountReceived` + `payment.method`.
   */
  legacyFullPaymentMethod?: 'CASH' | 'BANCOS' | 'CESAR' | null;
  registerIdempotencyKey?: string | null;
};

export type RegisterSaleCanonicalResult = {
  deal: Deal;
  watchId: string;
  payment: Payment | null;
  treasuryEntry: TreasuryEntry | null;
  receivable: AccountEntry | null;
  bankFee: OperatingExpense | null;
  /** Computed fee amount even when OpEx row exists (same Decimal). */
  bankFeeAmount: Prisma.Decimal;
  paidTotal: Prisma.Decimal;
  pendingAmount: Prisma.Decimal;
  computedStatus: 'PAGADO' | 'PARCIAL' | 'PENDIENTE';
  bankChannel: 'JOSE' | 'MAYTE' | null;
  canonicalMxn: Prisma.Decimal;
  replayed: boolean;
};

@Injectable()
export class SaleRegistrationService {
  private readonly logger = new Logger(SaleRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fxService: FxService,
    private readonly cuentasService: CuentasService,
    private readonly treasuryService: TreasuryService,
  ) {}

  /**
   * Canonical sale registration shared by manual Ventas and future AI REGISTER_SALE.
   * Atomic: Deal + Watch + Payment + Treasury + AccountEntry (+ OpEx bank fee).
   */
  async register(
    tenantId: string,
    input: RegisterSaleCanonicalInput,
  ): Promise<RegisterSaleCanonicalResult> {
    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        this.assertCompatibleReplay(existing, input, tenantId);
        return this.loadResult(existing, /* replayed */ true);
      }
    }

    const watch = await this.prisma.watch.findFirst({
      where: { id: input.watchId, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!watch) {
      throw new BadRequestException('Watch not found or does not belong to this tenant');
    }
    if (watch.status === WatchStatus.SOLD) {
      throw new BadRequestException('Watch is already sold');
    }

    await this.ensureClientInTenant(input.clientId, tenantId);
    await this.ensureNoOtherWonDealForWatch(input.watchId, tenantId);

    const soldAt = input.soldAt ?? new Date();
    const currency = input.currency ?? 'MXN';
    let canonicalMxn: Prisma.Decimal;
    let exchangeRateDecimal: Prisma.Decimal | null = null;

    if (currency === 'USD') {
      const fxResult = await this.fxService.getUsdMxn();
      if (fxResult.stale) {
        this.logger.warn('USD sale using stale FX rate (cached %s)', fxResult.fetchedAt);
      }
      exchangeRateDecimal = new Prisma.Decimal(fxResult.rate.toString());
      canonicalMxn = new Prisma.Decimal(input.agreedPrice.toString())
        .mul(exchangeRateDecimal)
        .toDecimalPlaces(2);
    } else {
      canonicalMxn = new Prisma.Decimal(input.agreedPrice);
    }

    const paymentPlan = resolvePaymentPlan({
      canonicalMxn,
      payment: input.payment,
      legacyFullPaymentMethod: input.legacyFullPaymentMethod,
      soldAt,
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const deal = await tx.deal.create({
          data: {
            tenant: { connect: { id: tenantId } },
            client: { connect: { id: input.clientId } },
            watch: { connect: { id: input.watchId } },
            stage: DealStage.CLOSED_WON,
            soldAt,
            agreedPrice: canonicalMxn,
            originalCurrency: currency,
            originalAmount: new Prisma.Decimal(input.agreedPrice),
            exchangeRate: exchangeRateDecimal,
            notes: input.notes ?? null,
            expectedCloseAt: soldAt,
            registerIdempotencyKey: idempotencyKey,
          },
        });

        let payment: Payment | null = null;
        let treasuryEntry: TreasuryEntry | null = null;
        let bankFee: OperatingExpense | null = null;

        if (paymentPlan.amount !== null && paymentPlan.method !== null) {
          payment = await tx.payment.create({
            data: {
              tenant: { connect: { id: tenantId } },
              deal: { connect: { id: deal.id } },
              amount: paymentPlan.amount,
              method: paymentPlan.method,
              status: PaymentStatus.PAID,
              paidAt: paymentPlan.paidAt,
            },
          });

          const account = TreasuryService.treasuryAccountForPaymentMethod(
            paymentPlan.method,
          );
          treasuryEntry = await this.treasuryService.createFromDealPayment({
            tenantId,
            dealPaymentId: payment.id,
            account,
            direction: 'INFLOW',
            amount: paymentPlan.amount,
            currency: Currency.MXN,
            transactionDate: paymentPlan.paidAt,
            description: `Venta ${deal.id}`,
            // Commission stays on OpEx BANK_FEES (existing Ventas semantics).
            commission: null,
            tx,
          });

          if (
            paymentPlan.method === PaymentMethod.BANCOS &&
            paymentPlan.bankChannel
          ) {
            const bankRate = BANK_RATES[paymentPlan.bankChannel];
            const feeAmount = paymentPlan.amount.mul(new Prisma.Decimal(bankRate));
            const pct = (bankRate * 100).toFixed(0);
            bankFee = await tx.operatingExpense.create({
              data: {
                tenant: { connect: { id: tenantId } },
                deal: { connect: { id: deal.id } },
                category: OperatingExpenseCategory.BANK_FEES,
                amount: feeAmount,
                expenseDate: paymentPlan.paidAt,
                notes: `Comisión ${paymentPlan.bankChannel} ${pct}% — venta ${deal.id}`,
              },
            });
          }
        }

        await tx.watch.update({
          where: { id: input.watchId },
          data: { status: WatchStatus.SOLD },
        });

        const receivable = await this.cuentasService.syncDealReceivable(
          deal.id,
          tenantId,
          tx,
        );

        return { deal, payment, treasuryEntry, bankFee, receivable };
      });

      return this.toResult({
        deal: created.deal,
        payment: created.payment,
        treasuryEntry: created.treasuryEntry,
        receivable: created.receivable,
        bankFee: created.bankFee,
        bankChannel: paymentPlan.bankChannel,
        canonicalMxn,
        replayed: false,
      });
    } catch (error: unknown) {
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.findByIdempotencyKey(tenantId, idempotencyKey);
        if (raced) {
          this.assertCompatibleReplay(raced, input, tenantId);
          return this.loadResult(raced, /* replayed */ true);
        }
      }
      throw error;
    }
  }

  /**
   * Follow-on payment on an existing CLOSED_WON deal (manual Ventas add-payment).
   * Atomic with Treasury + CXC refresh.
   */
  async addPayment(
    dealId: string,
    tenantId: string,
    args: {
      amount: number;
      method: 'CASH' | 'BANCOS' | 'CESAR';
      bankChannel?: 'JOSE' | 'MAYTE' | null;
      paidAt?: Date;
      notes?: string | null;
    },
  ) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null },
      select: { id: true, agreedPrice: true, stage: true },
    });
    if (!deal) {
      throw new BadRequestException('Deal not found');
    }
    if (deal.stage !== DealStage.CLOSED_WON) {
      throw new BadRequestException('Payments can only be added to CLOSED_WON deals');
    }

    const paidAt = args.paidAt ?? new Date();
    const paymentAmount = new Prisma.Decimal(args.amount);

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          tenant: { connect: { id: tenantId } },
          deal: { connect: { id: dealId } },
          amount: paymentAmount,
          method: args.method as PaymentMethod,
          status: PaymentStatus.PAID,
          paidAt,
          notes: args.notes ?? null,
        },
      });

      let bankFee: OperatingExpense | null = null;
      if (args.method === 'BANCOS' && args.bankChannel) {
        const bankRate = BANK_RATES[args.bankChannel];
        const feeAmount = paymentAmount.mul(new Prisma.Decimal(bankRate));
        const pct = (bankRate * 100).toFixed(0);
        bankFee = await tx.operatingExpense.create({
          data: {
            tenant: { connect: { id: tenantId } },
            deal: { connect: { id: dealId } },
            category: OperatingExpenseCategory.BANK_FEES,
            amount: feeAmount,
            expenseDate: paidAt,
            notes: `Comisión ${args.bankChannel} ${pct}% — venta ${dealId}`,
          },
        });
      }

      const treasuryEntry = await this.treasuryService.createFromDealPayment({
        tenantId,
        dealPaymentId: payment.id,
        account: TreasuryService.treasuryAccountForPaymentMethod(args.method),
        direction: 'INFLOW',
        amount: paymentAmount,
        currency: Currency.MXN,
        transactionDate: paidAt,
        description: `Abono venta ${dealId}`,
        commission: null,
        tx,
      });

      await this.cuentasService.syncDealReceivable(dealId, tenantId, tx);

      return { payment, bankFee, treasuryEntry };
    });

    const paidAgg = await this.prisma.payment.aggregate({
      where: { tenantId, dealId, status: PaymentStatus.PAID, deletedAt: null },
      _sum: { amount: true },
    });
    const paidTotal = paidAgg._sum.amount ?? new Prisma.Decimal(0);
    const rawPending = deal.agreedPrice.minus(paidTotal);
    const pendingAmount = rawPending.lessThan(0) ? new Prisma.Decimal(0) : rawPending;
    const computedStatus =
      paidTotal.gte(deal.agreedPrice)
        ? 'PAGADO'
        : paidTotal.greaterThan(0)
          ? 'PARCIAL'
          : 'PENDIENTE';

    return {
      payment: result.payment,
      bankFee: result.bankFee,
      treasuryEntry: result.treasuryEntry,
      paidTotal,
      pendingAmount,
      computedStatus,
    };
  }

  private async findByIdempotencyKey(tenantId: string, key: string) {
    return this.prisma.deal.findFirst({
      where: {
        tenantId,
        registerIdempotencyKey: key,
        deletedAt: null,
      },
      include: {
        payments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  private assertCompatibleReplay(
    existing: Deal & { payments: Payment[] },
    input: RegisterSaleCanonicalInput,
    tenantId: string,
  ) {
    void tenantId;
    if (existing.watchId !== input.watchId) {
      throw new ConflictException(
        'Idempotency key already used with a different watchId',
      );
    }
    if (existing.clientId !== input.clientId) {
      throw new ConflictException(
        'Idempotency key already used with a different clientId',
      );
    }

    const currency = input.currency ?? 'MXN';
    if (existing.originalCurrency && existing.originalCurrency !== currency) {
      throw new ConflictException(
        'Idempotency key already used with a different currency',
      );
    }
    if (existing.originalAmount) {
      const requested = new Prisma.Decimal(input.agreedPrice);
      if (!existing.originalAmount.equals(requested)) {
        throw new ConflictException(
          'Idempotency key already used with a different sale price',
        );
      }
    }

    const plan = resolvePaymentPlan({
      canonicalMxn: existing.agreedPrice,
      payment: input.payment,
      legacyFullPaymentMethod: input.legacyFullPaymentMethod,
      soldAt: existing.soldAt ?? existing.createdAt,
    });

    const firstPayment = existing.payments[0] ?? null;
    if (plan.amount === null) {
      if (firstPayment) {
        throw new ConflictException(
          'Idempotency key already used with a payment; credit request conflicts',
        );
      }
      return;
    }

    if (!firstPayment) {
      throw new ConflictException(
        'Idempotency key already used without a payment; paid request conflicts',
      );
    }
    if (!firstPayment.amount.equals(plan.amount)) {
      throw new ConflictException(
        'Idempotency key already used with a different payment amount',
      );
    }
    if (firstPayment.method !== plan.method) {
      throw new ConflictException(
        'Idempotency key already used with a different payment method',
      );
    }
  }

  private async loadResult(
    deal: Deal & { payments: Payment[] },
    replayed: boolean,
  ): Promise<RegisterSaleCanonicalResult> {
    const payment = deal.payments[0] ?? null;
    const [treasuryEntry, receivable, bankFee] = await Promise.all([
      payment
        ? this.prisma.treasuryEntry.findFirst({
            where: { dealPaymentId: payment.id, deletedAt: null },
          })
        : Promise.resolve(null),
      this.prisma.accountEntry.findFirst({
        where: {
          tenantId: deal.tenantId,
          dealId: deal.id,
          type: 'RECEIVABLE',
          deletedAt: null,
        },
      }),
      this.prisma.operatingExpense.findFirst({
        where: {
          tenantId: deal.tenantId,
          dealId: deal.id,
          category: OperatingExpenseCategory.BANK_FEES,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const bankChannel = parseBankChannelFromNotes(bankFee?.notes ?? null);

    return this.toResult({
      deal,
      payment,
      treasuryEntry,
      receivable,
      bankFee,
      bankChannel,
      canonicalMxn: deal.agreedPrice,
      replayed,
    });
  }

  private toResult(args: {
    deal: Deal;
    payment: Payment | null;
    treasuryEntry: TreasuryEntry | null;
    receivable: AccountEntry | null;
    bankFee: OperatingExpense | null;
    bankChannel: 'JOSE' | 'MAYTE' | null;
    canonicalMxn: Prisma.Decimal;
    replayed: boolean;
  }): RegisterSaleCanonicalResult {
    const paidTotal = args.payment?.amount ?? new Prisma.Decimal(0);
    const rawPending = args.canonicalMxn.minus(paidTotal);
    const pendingAmount = rawPending.lessThan(0)
      ? new Prisma.Decimal(0)
      : rawPending;
    const computedStatus =
      paidTotal.gte(args.canonicalMxn)
        ? 'PAGADO'
        : paidTotal.greaterThan(0)
          ? 'PARCIAL'
          : 'PENDIENTE';

    return {
      deal: args.deal,
      watchId: args.deal.watchId!,
      payment: args.payment,
      treasuryEntry: args.treasuryEntry,
      receivable: args.receivable,
      bankFee: args.bankFee,
      bankFeeAmount: args.bankFee?.amount ?? new Prisma.Decimal(0),
      paidTotal,
      pendingAmount,
      computedStatus,
      bankChannel: args.bankChannel,
      canonicalMxn: args.canonicalMxn,
      replayed: args.replayed,
    };
  }

  private async ensureClientInTenant(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new BadRequestException('Client is invalid for this tenant');
    }
  }

  private async ensureNoOtherWonDealForWatch(
    watchId: string,
    tenantId: string,
    excludeDealId?: string,
  ) {
    const wonDeal = await this.prisma.deal.findFirst({
      where: {
        tenantId,
        watchId,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
        ...(excludeDealId ? { id: { not: excludeDealId } } : {}),
      },
      select: { id: true },
    });

    if (wonDeal) {
      throw new BadRequestException(
        'This watch already has an active CLOSED_WON deal',
      );
    }
  }
}

function normalizeIdempotencyKey(key?: string | null): string | null {
  if (key === undefined || key === null) return null;
  const trimmed = key.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function resolvePaymentPlan(args: {
  canonicalMxn: Prisma.Decimal;
  payment?: SalePaymentInput | null;
  legacyFullPaymentMethod?: 'CASH' | 'BANCOS' | 'CESAR' | null;
  soldAt: Date;
}): {
  amount: Prisma.Decimal | null;
  method: PaymentMethod | null;
  bankChannel: 'JOSE' | 'MAYTE' | null;
  paidAt: Date;
} {
  const payment = args.payment;
  const bankChannel = payment?.bankChannel ?? null;
  const paidAt = payment?.paidAt ?? args.soldAt;

  if (
    args.legacyFullPaymentMethod &&
    (payment?.amountReceived === undefined || payment?.amountReceived === null)
  ) {
    return {
      amount: args.canonicalMxn,
      method: args.legacyFullPaymentMethod as PaymentMethod,
      bankChannel,
      paidAt,
    };
  }

  if (
    payment?.amountReceived !== undefined &&
    payment.amountReceived !== null &&
    payment.amountReceived > 0
  ) {
    const method = (payment.method ??
      args.legacyFullPaymentMethod ??
      'CASH') as PaymentMethod;
    if (method === PaymentMethod.BANCOS && !bankChannel) {
      throw new BadRequestException(
        'bankChannel is required when payment method is BANCOS',
      );
    }
    return {
      amount: new Prisma.Decimal(payment.amountReceived),
      method,
      bankChannel,
      paidAt,
    };
  }

  return {
    amount: null,
    method: null,
    bankChannel: null,
    paidAt,
  };
}

function parseBankChannelFromNotes(
  notes: string | null,
): 'JOSE' | 'MAYTE' | null {
  if (!notes) return null;
  if (notes.includes('JOSE')) return 'JOSE';
  if (notes.includes('MAYTE')) return 'MAYTE';
  return null;
}
