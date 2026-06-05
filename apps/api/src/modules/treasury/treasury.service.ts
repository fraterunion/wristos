import {
  BadRequestException,
  ConflictException,
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
    const existing = await this.prisma.treasuryEntry.findUnique({
      where: { accountPaymentId: args.accountPaymentId },
    });

    if (existing && existing.deletedAt === null) {
      throw new ConflictException(
        'Treasury entry already exists for this account payment',
      );
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
      deletedAt: null,
    };

    if (existing) {
      return this.prisma.treasuryEntry.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.treasuryEntry.create({ data });
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

  async deleteByAccountPaymentId(accountPaymentId: string) {
    const existing = await this.prisma.treasuryEntry.findFirst({
      where: { accountPaymentId, deletedAt: null },
    });

    if (!existing) {
      return null;
    }

    return this.prisma.treasuryEntry.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

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
      const sum = row._sum.amountMxn ?? new Prisma.Decimal(0);
      const current = balances.get(row.account) ?? new Prisma.Decimal(0);
      const next =
        row.direction === TreasuryDirection.INFLOW
          ? current.plus(sum)
          : current.minus(sum);
      balances.set(row.account, next);
    }

    return {
      CASH: (balances.get(TreasuryAccount.CASH) ?? new Prisma.Decimal(0)).toFixed(2),
      BANK: (balances.get(TreasuryAccount.BANK) ?? new Prisma.Decimal(0)).toFixed(2),
      CESAR: (balances.get(TreasuryAccount.CESAR) ?? new Prisma.Decimal(0)).toFixed(2),
    };
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
