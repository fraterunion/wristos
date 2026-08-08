import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  Currency,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type CoercibleDecimal = Prisma.Decimal | number | string;

type DbClient = Prisma.TransactionClient | PrismaService;

export type CreateFromAccountPaymentArgs = {
  tenantId: string;
  accountPaymentId: string;
  account: TreasuryAccount;
  direction: TreasuryDirection;
  amount: CoercibleDecimal;
  currency: Currency;
  exchangeRateUsed?: CoercibleDecimal | null;
  transactionDate: Date;
  description?: string | null;
  /** Optional transaction client for atomic AccountPayment + Treasury registration. */
  tx?: Prisma.TransactionClient;
};

/** Provenance for account-payment treasury inflow/outflow (recovery / audit). */
export function accountPaymentProvenanceKey(accountPaymentId: string): string {
  return `account-payment:${accountPaymentId}`;
}

export type CreateFromDealPaymentArgs = {
  tenantId: string;
  dealPaymentId: string;
  account: TreasuryAccount;
  direction: TreasuryDirection;
  amount: CoercibleDecimal;
  currency: Currency;
  exchangeRateUsed?: CoercibleDecimal | null;
  transactionDate: Date;
  description?: string | null;
  /** Structured bank commission (Control Bancos). Leave null on gross sale inflows. */
  commission?: CoercibleDecimal | null;
  /** Optional transaction client for atomic sale registration. */
  tx?: Prisma.TransactionClient;
};

export type CreateDealPaymentBankFeeOutflowArgs = {
  tenantId: string;
  dealPaymentId: string;
  amount: CoercibleDecimal;
  transactionDate: Date;
  description?: string | null;
  tx?: Prisma.TransactionClient;
};

/** Typed provenance keys — one Payment may own multiple Treasury legs. */
export function dealPaymentInflowProvenanceKey(dealPaymentId: string): string {
  return `deal-payment:${dealPaymentId}:inflow`;
}

export function dealPaymentBankFeeProvenanceKey(dealPaymentId: string): string {
  return `deal-payment:${dealPaymentId}:bank-fee`;
}

/** Provenance for paid operating-expense Treasury OUTFLOW (Commit 15A). */
export function operatingExpenseOutflowProvenanceKey(operatingExpenseId: string): string {
  return `operating-expense:${operatingExpenseId}:outflow`;
}

/** Provenance for initial inventory-purchase Treasury OUTFLOW (Commit 17A). */
export function inventoryPurchaseOutflowProvenanceKey(watchId: string): string {
  return `inventory-purchase:${watchId}:outflow`;
}

export type CreateFromOperatingExpenseArgs = {
  tenantId: string;
  operatingExpenseId: string;
  account: TreasuryAccount;
  amount: CoercibleDecimal;
  currency: Currency;
  exchangeRateUsed?: CoercibleDecimal | null;
  transactionDate: Date;
  description?: string | null;
  tx?: Prisma.TransactionClient;
};

export type CreateFromInventoryPurchaseArgs = {
  tenantId: string;
  watchId: string;
  account: TreasuryAccount;
  amount: CoercibleDecimal;
  currency: Currency;
  exchangeRateUsed?: CoercibleDecimal | null;
  transactionDate: Date;
  description?: string | null;
  tx?: Prisma.TransactionClient;
};


export type UpdateFromAccountPaymentArgs = {
  tenantId: string;
  account?: TreasuryAccount;
  direction?: TreasuryDirection;
  amount?: CoercibleDecimal;
  currency?: Currency;
  exchangeRateUsed?: CoercibleDecimal | null;
  transactionDate?: Date;
  description?: string | null;
};

export type RecordPhysicalCashBalanceAdjustmentArgs = {
  tenantId: string;
  resultingBalance: CoercibleDecimal;
  reason: string;
  source: string;
  actor: string;
  effectiveDate: Date;
  /** Optional override; defaults to current Dashboard CASH KPI before this adjustment. */
  previousBalance?: CoercibleDecimal;
};

export type TreasuryAccountBalances = {
  CASH: string;
  BANK: string;
  CESAR: string;
};

const TREASURY_ACCOUNTS: TreasuryAccount[] = [
  TreasuryAccount.CASH,
  TreasuryAccount.BANK,
  TreasuryAccount.CESAR,
];

@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromAccountPayment(args: CreateFromAccountPaymentArgs) {
    const db: DbClient = args.tx ?? this.prisma;
    const provenanceKey = accountPaymentProvenanceKey(args.accountPaymentId);

    const existing = await db.treasuryEntry.findFirst({
      where: {
        OR: [
          { accountPaymentId: args.accountPaymentId },
          { tenantId: args.tenantId, provenanceKey },
        ],
      },
    });

    if (existing && existing.deletedAt === null) {
      // Idempotent replay inside an outer register() transaction.
      return existing;
    }

    const { amount, amountMxn, exchangeRate } = this.resolveAmounts(
      args.amount,
      args.currency,
      args.exchangeRateUsed,
    );

    const data = {
      tenantId: args.tenantId,
      account: args.account,
      direction: args.direction,
      amount,
      currency: args.currency,
      amountMxn,
      exchangeRate,
      transactionDate: args.transactionDate,
      description: args.description ?? null,
      accountPaymentId: args.accountPaymentId,
      provenanceKey,
      deletedAt: null,
    };

    if (existing) {
      return db.treasuryEntry.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      return await db.treasuryEntry.create({ data });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await db.treasuryEntry.findFirst({
          where: {
            OR: [
              { accountPaymentId: args.accountPaymentId },
              { tenantId: args.tenantId, provenanceKey },
            ],
            deletedAt: null,
          },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Canonical Treasury INFLOW for a deal Payment (gross customer amount).
   * Idempotent on unique `dealPaymentId` and `provenanceKey` (`…:inflow`).
   *
   * Bank-fee cash effect is a separate OUTFLOW via `createBankFeeOutflowFromDealPayment`.
   * Do not set `commission` on the gross inflow — analytics embed fee cash in OUTFLOW amountMxn
   * and read P&L from OUTFLOW.commission (never add commission on top of amountMxn).
   */
  async createFromDealPayment(args: CreateFromDealPaymentArgs) {
    const db: DbClient = args.tx ?? this.prisma;
    const provenanceKey = dealPaymentInflowProvenanceKey(args.dealPaymentId);

    const existing = await db.treasuryEntry.findFirst({
      where: {
        OR: [
          { dealPaymentId: args.dealPaymentId },
          { tenantId: args.tenantId, provenanceKey },
        ],
        deletedAt: null,
      },
    });

    if (existing) {
      return existing;
    }

    const { amount, amountMxn, exchangeRate } = this.resolveAmounts(
      args.amount,
      args.currency,
      args.exchangeRateUsed,
    );

    const data = {
      tenantId: args.tenantId,
      account: args.account,
      direction: args.direction,
      amount,
      currency: args.currency,
      amountMxn,
      exchangeRate,
      commission: null as Prisma.Decimal | null,
      transactionDate: args.transactionDate,
      description: args.description ?? null,
      dealPaymentId: args.dealPaymentId,
      provenanceKey,
      deletedAt: null,
    };

    try {
      return await db.treasuryEntry.create({ data });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await db.treasuryEntry.findFirst({
          where: {
            OR: [
              { dealPaymentId: args.dealPaymentId },
              { tenantId: args.tenantId, provenanceKey },
            ],
            deletedAt: null,
          },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Canonical bank-fee cash OUTFLOW for a BANCOS deal payment.
   * - amountMxn reduces BANK liquidity (Σ INFLOW − Σ OUTFLOW)
   * - commission = fee for monthly profit / capital (exactly once; no OpEx BANK_FEES)
   * Idempotent on provenanceKey `deal-payment:<id>:bank-fee` (dealPaymentId stays on inflow only).
   */
  async createBankFeeOutflowFromDealPayment(
    args: CreateDealPaymentBankFeeOutflowArgs,
  ) {
    const db: DbClient = args.tx ?? this.prisma;
    const provenanceKey = dealPaymentBankFeeProvenanceKey(args.dealPaymentId);

    const existing = await db.treasuryEntry.findFirst({
      where: { tenantId: args.tenantId, provenanceKey, deletedAt: null },
    });
    if (existing) return existing;

    const { amount, amountMxn } = this.resolveAmounts(
      args.amount,
      Currency.MXN,
      null,
    );

    const data = {
      tenantId: args.tenantId,
      account: TreasuryAccount.BANK,
      direction: TreasuryDirection.OUTFLOW,
      amount,
      currency: Currency.MXN,
      amountMxn,
      exchangeRate: null as Prisma.Decimal | null,
      commission: amount,
      transactionDate: args.transactionDate,
      description: args.description ?? null,
      dealPaymentId: null as string | null,
      provenanceKey,
      deletedAt: null,
    };

    try {
      return await db.treasuryEntry.create({ data });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await db.treasuryEntry.findFirst({
          where: { tenantId: args.tenantId, provenanceKey, deletedAt: null },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Canonical Treasury OUTFLOW for a paid OperatingExpense.
   * - Liquidity: amountMxn OUTFLOW on CASH | BANK | CESAR
   * - commission stays null (ordinary expense ≠ bank commission P&L)
   * - Idempotent on provenanceKey `operating-expense:<id>:outflow`
   * - No operatingExpenseId FK — provenance is the durable link
   */
  async createFromOperatingExpense(args: CreateFromOperatingExpenseArgs) {
    const db: DbClient = args.tx ?? this.prisma;
    const provenanceKey = operatingExpenseOutflowProvenanceKey(args.operatingExpenseId);

    const existing = await db.treasuryEntry.findFirst({
      where: { tenantId: args.tenantId, provenanceKey },
    });
    if (existing && existing.deletedAt === null) {
      return existing;
    }

    const { amount, amountMxn, exchangeRate } = this.resolveAmounts(
      args.amount,
      args.currency,
      args.exchangeRateUsed,
    );

    const data = {
      tenantId: args.tenantId,
      account: args.account,
      direction: TreasuryDirection.OUTFLOW,
      amount,
      currency: args.currency,
      amountMxn,
      exchangeRate,
      commission: null as Prisma.Decimal | null,
      transactionDate: args.transactionDate,
      description: args.description ?? null,
      provenanceKey,
      deletedAt: null,
    };

    if (existing) {
      return db.treasuryEntry.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      return await db.treasuryEntry.create({ data });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await db.treasuryEntry.findFirst({
          where: { tenantId: args.tenantId, provenanceKey, deletedAt: null },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Soft-delete the OUTFLOW for an operating expense (correction / reverse). */
  async softDeleteOperatingExpenseOutflow(args: {
    tenantId: string;
    operatingExpenseId: string;
    tx?: Prisma.TransactionClient;
  }) {
    const db: DbClient = args.tx ?? this.prisma;
    const provenanceKey = operatingExpenseOutflowProvenanceKey(args.operatingExpenseId);
    const existing = await db.treasuryEntry.findFirst({
      where: { tenantId: args.tenantId, provenanceKey, deletedAt: null },
    });
    if (!existing) return null;
    return db.treasuryEntry.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Canonical Treasury OUTFLOW for an inventory purchase (PAID / PARTIAL initial payment).
   * - Liquidity: amountMxn OUTFLOW on CASH | BANK | CESAR
   * - Idempotent on provenanceKey `inventory-purchase:<watchId>:outflow`
   * - Later CXP servicing must NOT reuse this path (use Cuentas payable payment)
   */
  async createFromInventoryPurchase(args: CreateFromInventoryPurchaseArgs) {
    const db: DbClient = args.tx ?? this.prisma;
    const provenanceKey = inventoryPurchaseOutflowProvenanceKey(args.watchId);

    const existing = await db.treasuryEntry.findFirst({
      where: { tenantId: args.tenantId, provenanceKey },
    });
    if (existing && existing.deletedAt === null) {
      return existing;
    }

    const { amount, amountMxn, exchangeRate } = this.resolveAmounts(
      args.amount,
      args.currency,
      args.exchangeRateUsed,
    );

    const data = {
      tenantId: args.tenantId,
      account: args.account,
      direction: TreasuryDirection.OUTFLOW,
      amount,
      currency: args.currency,
      amountMxn,
      exchangeRate,
      commission: null as Prisma.Decimal | null,
      transactionDate: args.transactionDate,
      description: args.description ?? null,
      provenanceKey,
      deletedAt: null,
    };

    if (existing) {
      return db.treasuryEntry.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      return await db.treasuryEntry.create({ data });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await db.treasuryEntry.findFirst({
          where: { tenantId: args.tenantId, provenanceKey, deletedAt: null },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Maps deal PaymentMethod → TreasuryAccount. BANCOS → BANK. */
  static treasuryAccountForPaymentMethod(
    method: 'CASH' | 'BANCOS' | 'CESAR' | string,
  ): TreasuryAccount {
    if (method === 'CASH') return TreasuryAccount.CASH;
    if (method === 'CESAR') return TreasuryAccount.CESAR;
    if (method === 'BANCOS') return TreasuryAccount.BANK;
    throw new BadRequestException(
      `Unsupported payment method for treasury: ${method}`,
    );
  }

  static bankFeeProvenanceKey(dealPaymentId: string): string {
    return dealPaymentBankFeeProvenanceKey(dealPaymentId);
  }

  static inflowProvenanceKey(dealPaymentId: string): string {
    return dealPaymentInflowProvenanceKey(dealPaymentId);
  }

  async updateFromAccountPayment(
    accountPaymentId: string,
    args: UpdateFromAccountPaymentArgs,
  ) {
    const existing = await this.prisma.treasuryEntry.findFirst({
      where: { accountPaymentId, deletedAt: null },
    });

    if (existing) {
      const currency = args.currency ?? existing.currency;
      const amount = args.amount ?? existing.amount;
      const exchangeRateUsed =
        args.exchangeRateUsed !== undefined
          ? args.exchangeRateUsed
          : existing.exchangeRate;

      const { amount: nextAmount, amountMxn, exchangeRate } = this.resolveAmounts(
        amount,
        currency,
        exchangeRateUsed,
      );

      return this.prisma.treasuryEntry.update({
        where: { id: existing.id },
        data: {
          account: args.account ?? existing.account,
          direction: args.direction ?? existing.direction,
          amount: nextAmount,
          currency,
          amountMxn,
          exchangeRate,
          transactionDate: args.transactionDate ?? existing.transactionDate,
          description:
            args.description !== undefined ? args.description : existing.description,
        },
      });
    }

    const required = [
      args.account,
      args.direction,
      args.amount,
      args.currency,
      args.transactionDate,
    ];
    if (required.some((value) => value === undefined)) {
      throw new BadRequestException(
        'Treasury entry not found; provide account, direction, amount, currency, and transactionDate to create one',
      );
    }

    return this.createFromAccountPayment({
      tenantId: args.tenantId,
      accountPaymentId,
      account: args.account!,
      direction: args.direction!,
      amount: args.amount!,
      currency: args.currency!,
      exchangeRateUsed: args.exchangeRateUsed,
      transactionDate: args.transactionDate!,
      description: args.description,
    });
  }

  async deleteByAccountPaymentId(
    accountPaymentId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db: DbClient = tx ?? this.prisma;
    const existing = await db.treasuryEntry.findFirst({
      where: { accountPaymentId, deletedAt: null },
    });

    if (!existing) {
      return null;
    }

    return db.treasuryEntry.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Official balances:
   * - BANK / CESAR: Σ amountMxn(INFLOW) − Σ amountMxn(OUTFLOW)
   * - CASH (physical MXN): latest PhysicalCashBalanceAdjustment.resultingBalance
   *   + subsequent MXN CASH movements after effectiveDate.
   *   USD CASH rows never enter the physical MXN KPI.
   *   If no adjustment exists yet, falls back to MXN-only movement net.
   */
  async getAccountBalances(tenantId: string): Promise<TreasuryAccountBalances> {
    const groups = await this.prisma.treasuryEntry.groupBy({
      by: ['account', 'direction'],
      where: { tenantId, deletedAt: null },
      _sum: { amountMxn: true },
    });

    const balances = new Map<TreasuryAccount, Prisma.Decimal>(
      TREASURY_ACCOUNTS.map((account) => [account, new Prisma.Decimal(0)]),
    );

    for (const row of groups) {
      if (row.account === TreasuryAccount.CASH) {
        // CASH handled separately (MXN physical + optional snapshot).
        continue;
      }
      const sum = row._sum.amountMxn ?? new Prisma.Decimal(0);
      const current = balances.get(row.account) ?? new Prisma.Decimal(0);
      const next =
        row.direction === TreasuryDirection.INFLOW
          ? current.plus(sum)
          : current.minus(sum);
      balances.set(row.account, next);
    }

    const cash = await this.getPhysicalCashBalanceMxn(tenantId);
    balances.set(TreasuryAccount.CASH, cash);

    return {
      CASH: (balances.get(TreasuryAccount.CASH) ?? new Prisma.Decimal(0)).toFixed(2),
      BANK: (balances.get(TreasuryAccount.BANK) ?? new Prisma.Decimal(0)).toFixed(2),
      CESAR: (balances.get(TreasuryAccount.CESAR) ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }

  async getPhysicalCashBalanceMxn(tenantId: string): Promise<Prisma.Decimal> {
    const latest = await this.prisma.physicalCashBalanceAdjustment.findFirst({
      where: { tenantId, deletedAt: null, currency: Currency.MXN },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });

    if (!latest) {
      return this.sumMxnCashMovements(tenantId, null);
    }

    const after = await this.sumMxnCashMovements(tenantId, latest.effectiveDate);
    return new Prisma.Decimal(latest.resultingBalance.toString()).plus(after);
  }

  /**
   * Records an auditable physical MXN cash balance set (manual count).
   * Does not rewrite historical CASH movements. Does not touch USD.
   */
  async recordPhysicalCashBalanceAdjustment(
    args: RecordPhysicalCashBalanceAdjustmentArgs,
  ) {
    const resulting = new Prisma.Decimal(args.resultingBalance.toString());
    if (!resulting.isFinite()) {
      throw new BadRequestException('resultingBalance must be a finite number');
    }

    const previous =
      args.previousBalance !== undefined
        ? new Prisma.Decimal(args.previousBalance.toString())
        : await this.getPhysicalCashBalanceMxn(args.tenantId);

    const adjustmentAmount = resulting.minus(previous);

    return this.prisma.physicalCashBalanceAdjustment.create({
      data: {
        tenantId: args.tenantId,
        currency: Currency.MXN,
        previousBalance: previous.toDecimalPlaces(2),
        adjustmentAmount: adjustmentAmount.toDecimalPlaces(2),
        resultingBalance: resulting.toDecimalPlaces(2),
        reason: args.reason,
        source: args.source,
        actor: args.actor,
        effectiveDate: args.effectiveDate,
      },
    });
  }

  private async sumMxnCashMovements(
    tenantId: string,
    afterExclusive: Date | null,
  ): Promise<Prisma.Decimal> {
    const where: Prisma.TreasuryEntryWhereInput = {
      tenantId,
      account: TreasuryAccount.CASH,
      currency: Currency.MXN,
      deletedAt: null,
      ...(afterExclusive
        ? { transactionDate: { gt: afterExclusive } }
        : {}),
    };

    const groups = await this.prisma.treasuryEntry.groupBy({
      by: ['direction'],
      where,
      _sum: { amountMxn: true },
    });

    let net = new Prisma.Decimal(0);
    for (const row of groups) {
      const sum = row._sum.amountMxn ?? new Prisma.Decimal(0);
      net =
        row.direction === TreasuryDirection.INFLOW
          ? net.plus(sum)
          : net.minus(sum);
    }
    return net;
  }

  private resolveAmounts(
    amount: CoercibleDecimal,
    currency: Currency,
    exchangeRateUsed?: CoercibleDecimal | null,
  ): {
    amount: Prisma.Decimal;
    amountMxn: Prisma.Decimal;
    exchangeRate: Prisma.Decimal | null;
  } {
    const amountDecimal = new Prisma.Decimal(amount.toString());
    if (amountDecimal.lte(0)) {
      throw new BadRequestException('Treasury amount must be positive');
    }

    if (currency === Currency.MXN) {
      return {
        amount: amountDecimal,
        amountMxn: amountDecimal,
        exchangeRate: null,
      };
    }

    if (currency === Currency.USD) {
      if (exchangeRateUsed === null || exchangeRateUsed === undefined) {
        throw new BadRequestException(
          'exchangeRateUsed is required for USD treasury entries',
        );
      }
      const rate = new Prisma.Decimal(exchangeRateUsed.toString());
      if (rate.lte(0)) {
        throw new BadRequestException('exchangeRateUsed must be positive');
      }
      return {
        amount: amountDecimal,
        amountMxn: amountDecimal.mul(rate).toDecimalPlaces(2),
        exchangeRate: rate,
      };
    }

    throw new BadRequestException(`Unsupported currency: ${currency}`);
  }
}
