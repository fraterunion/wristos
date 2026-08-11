import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  OperatingExpense,
  OperatingExpenseCategory,
  Prisma,
  TreasuryAccount,
  TreasuryEntry,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  operatingExpenseOutflowProvenanceKey,
  TreasuryService,
} from '../treasury/treasury.service';
import {
  CANONICAL_EXPENSE_INVARIANT_MESSAGE,
  classifyExpenseReversalEconomics,
} from '../ai/reversals/expense-reversal-classification';

export type ExpenseMoneySource = 'CASH' | 'BANK' | 'CESAR';

export type RegisterExpenseInput = {
  amount: Prisma.Decimal | number | string;
  category: OperatingExpenseCategory;
  /** Paid-from treasury source. Required for cash-linked registration. */
  source: ExpenseMoneySource;
  expenseDate: Date | string;
  notes?: string | null;
  currency?: Currency;
  exchangeRateUsed?: Prisma.Decimal | number | string | null;
  /**
   * Durable idempotency. Future AI marker: `ai-action-run:<actionRunId>`.
   */
  registerIdempotencyKey?: string | null;
};

export type RegisterExpenseResult = {
  expense: OperatingExpense;
  treasuryEntry: TreasuryEntry;
  replayed: boolean;
};

export type ReverseExpenseCausality =
  | 'APPLIED'
  | 'SAME_COMMAND'
  | 'EXTERNAL';

export type ReverseExpenseResult = {
  expense: OperatingExpense;
  treasuryEntry: TreasuryEntry | null;
  alreadyReversed: boolean;
  /**
   * Commit 26A causality:
   * - APPLIED: this call soft-deleted the expense
   * - SAME_COMMAND: already reversed with the same reversalIdempotencyKey (AI recovery MATCH)
   * - EXTERNAL: already reversed by a different/unknown actor (human or other ActionRun)
   */
  causality: ReverseExpenseCausality;
};

export type ReverseExpenseOptions = {
  /**
   * Durable reverse causality. Future AI: `ai-action-run:<actionRunId>`.
   * Never accept from provider/user — server-owned only.
   */
  reversalIdempotencyKey?: string | null;
};

const ALLOWED_SOURCES: ExpenseMoneySource[] = ['CASH', 'BANK', 'CESAR'];

/** Categories allowed for new cash-linked registration (BANK_FEES excluded). */
export const REGISTERABLE_EXPENSE_CATEGORIES: OperatingExpenseCategory[] = [
  OperatingExpenseCategory.GASOLINE,
  OperatingExpenseCategory.TOLLS,
  OperatingExpenseCategory.WATCHMAKER,
  OperatingExpenseCategory.PARKING,
  OperatingExpenseCategory.MEALS,
  OperatingExpenseCategory.FLIGHTS,
  OperatingExpenseCategory.TRAVEL,
  OperatingExpenseCategory.MARKETING,
  OperatingExpenseCategory.COMMISSIONS,
  OperatingExpenseCategory.OTHER,
];

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function toExpenseDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
  const raw = String(value).trim();
  // Prefer YYYY-MM-DD calendar date (manual Gastos + future AI).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Invalid expenseDate');
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

@Injectable()
export class ExpenseRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryService: TreasuryService,
  ) {}

  /**
   * Canonical paid operating-expense registration shared by manual Gastos
   * and future AI REGISTER_EXPENSE (15B). Not AI-bound in 15A.
   *
   * Writes atomically:
   * - OperatingExpense (P&L)
   * - Treasury OUTFLOW on CASH | BANK | CESAR (liquidity)
   *
   * Does NOT write: CXP, Deal/Payment, crypto holdings, bank commission P&L.
   * Rejects BANK_FEES (sale/control-bancos path owns structured commissions).
   * V1 currency: MXN only (no invented FX).
   */
  async register(
    tenantId: string,
    input: RegisterExpenseInput,
  ): Promise<RegisterExpenseResult> {
    const source = input.source;
    if (!ALLOWED_SOURCES.includes(source)) {
      throw new BadRequestException(
        'Unsupported expense source. Allowed: CASH, BANK, CESAR',
      );
    }

    const category = input.category;
    if (!Object.values(OperatingExpenseCategory).includes(category)) {
      throw new BadRequestException('Invalid expense category');
    }
    if (category === OperatingExpenseCategory.BANK_FEES) {
      throw new BadRequestException(
        'BANK_FEES cannot be registered as an operating expense. Sale bank fees use Control Bancos / Treasury commission.',
      );
    }
    if (!REGISTERABLE_EXPENSE_CATEGORIES.includes(category)) {
      throw new BadRequestException('Expense category is not allowed for registration');
    }

    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Expense amount must be greater than 0');
    }

    const currency = input.currency ?? Currency.MXN;
    if (currency !== Currency.MXN) {
      throw new BadRequestException(
        'V1 expense registration supports MXN only. USD expenses are not enabled.',
      );
    }
    if (input.exchangeRateUsed != null && input.exchangeRateUsed !== '') {
      throw new BadRequestException(
        'exchangeRateUsed is not supported for MXN expenses',
      );
    }

    const expenseDate = toExpenseDate(input.expenseDate);
    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);
    const cashAccount =
      source === 'CASH'
        ? TreasuryAccount.CASH
        : source === 'BANK'
          ? TreasuryAccount.BANK
          : TreasuryAccount.CESAR;

    if (idempotencyKey) {
      const existing = await this.prisma.operatingExpense.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        this.assertCompatibleReplay(existing, {
          amount,
          category,
          source: cashAccount,
          expenseDate,
          currency,
          notes: input.notes ?? null,
        });
        return this.loadResult(existing, /* replayed */ true);
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'registerIdempotencyKey already used by a reversed expense; use a new key',
        );
      }
    }

    const notes =
      input.notes == null || String(input.notes).trim() === ''
        ? null
        : String(input.notes).trim();

    try {
      const expenseId = await this.prisma.$transaction(async (tx) => {
        const expense = await tx.operatingExpense.create({
          data: {
            tenantId,
            category,
            amount,
            currency,
            sourceAccount: cashAccount,
            notes,
            expenseDate,
            registerIdempotencyKey: idempotencyKey,
          },
        });

        await this.treasuryService.createFromOperatingExpense({
          tenantId,
          operatingExpenseId: expense.id,
          account: cashAccount,
          amount,
          currency,
          exchangeRateUsed: null,
          transactionDate: expenseDate,
          description: this.treasuryDescription(category, notes),
          tx,
        });

        return expense.id;
      });

      const expense = await this.prisma.operatingExpense.findFirstOrThrow({
        where: { id: expenseId, tenantId, deletedAt: null },
      });
      return this.loadResult(expense, /* replayed */ false);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const raced = await this.prisma.operatingExpense.findFirst({
          where: {
            tenantId,
            registerIdempotencyKey: idempotencyKey,
            deletedAt: null,
          },
        });
        if (raced) {
          this.assertCompatibleReplay(raced, {
            amount,
            category,
            source: cashAccount,
            expenseDate,
            currency,
            notes,
          });
          return this.loadResult(raced, /* replayed */ true);
        }
      }
      throw error;
    }
  }

  /**
   * Soft-delete expense + soft-delete matching Treasury OUTFLOW (if any) atomically.
   * Idempotent: second call returns alreadyReversed.
   *
   * Treasury convention: soft-delete original OUTFLOW (not a compensating INFLOW).
   * Legacy OpEx rows without provenance: soft-delete expense only — never invents Treasury.
   *
   * Commit 26A: optional `reversalIdempotencyKey` stamped atomically with deletedAt so
   * AI ActionRun recovery can distinguish SAME_COMMAND vs EXTERNAL reverse.
   */
  async reverse(
    tenantId: string,
    expenseId: string,
    options?: ReverseExpenseOptions,
  ): Promise<ReverseExpenseResult> {
    const reversalKey = normalizeReversalKey(options?.reversalIdempotencyKey);
    const existing = await this.prisma.operatingExpense.findFirst({
      where: { id: expenseId, tenantId },
    });
    if (!existing) throw new NotFoundException('Expense not found');

    if (existing.deletedAt) {
      const treasury = await this.prisma.treasuryEntry.findFirst({
        where: {
          tenantId,
          provenanceKey: operatingExpenseOutflowProvenanceKey(expenseId),
        },
      });
      return {
        expense: existing,
        treasuryEntry: treasury,
        alreadyReversed: true,
        causality: classifyAlreadyReversedCausality(
          existing.reversalIdempotencyKey,
          reversalKey,
        ),
      };
    }

    // 26C.1 — refuse corrupt canonical state (provenance exists but leg incoherent).
    {
      const treasury = await this.prisma.treasuryEntry.findFirst({
        where: {
          tenantId,
          provenanceKey: operatingExpenseOutflowProvenanceKey(expenseId),
        },
        select: {
          id: true,
          deletedAt: true,
          direction: true,
          amountMxn: true,
          account: true,
        },
      });
      const economicClass = classifyExpenseReversalEconomics({
        expense: existing,
        treasuryOutflow: treasury,
      });
      if (economicClass === 'CANONICAL_INVARIANT') {
        throw new ConflictException(
          `REVERSAL_INVARIANT: ${CANONICAL_EXPENSE_INVARIANT_MESSAGE}`,
        );
      }
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.operatingExpense.updateMany({
        where: { id: expenseId, tenantId, deletedAt: null },
        data: {
          deletedAt: now,
          ...(reversalKey ? { reversalIdempotencyKey: reversalKey } : {}),
        },
      });

      if (claimed.count === 0) {
        const raced = await tx.operatingExpense.findFirst({
          where: { id: expenseId, tenantId },
        });
        if (!raced) throw new NotFoundException('Expense not found');
        const treasury = await tx.treasuryEntry.findFirst({
          where: {
            tenantId,
            provenanceKey: operatingExpenseOutflowProvenanceKey(expenseId),
          },
        });
        return {
          expense: raced,
          treasury,
          alreadyReversed: true as const,
          causality: classifyAlreadyReversedCausality(
            raced.reversalIdempotencyKey,
            reversalKey,
          ),
        };
      }

      const expense = await tx.operatingExpense.findFirstOrThrow({
        where: { id: expenseId, tenantId },
      });
      const treasury = await this.treasuryService.softDeleteOperatingExpenseOutflow({
        tenantId,
        operatingExpenseId: expenseId,
        reversalIdempotencyKey: reversalKey,
        tx,
      });
      return {
        expense,
        treasury,
        alreadyReversed: false as const,
        causality: 'APPLIED' as const,
      };
    });

    return {
      expense: result.expense,
      treasuryEntry: result.treasury,
      alreadyReversed: result.alreadyReversed,
      causality: result.causality,
    };
  }

  /**
   * Commit 26B — read-only causality classification for future AI recovery.
   * Does not mutate. Outcomes: ACTIVE | SAME_COMMAND | EXTERNAL | MISSING.
   */
  async classifyReversal(
    tenantId: string,
    expenseId: string,
    reversalIdempotencyKey?: string | null,
  ): Promise<
    | { kind: 'MISSING' }
    | { kind: 'ACTIVE'; expenseId: string }
    | { kind: 'SAME_COMMAND'; expenseId: string }
    | { kind: 'EXTERNAL'; expenseId: string }
  > {
    const key = normalizeReversalKey(reversalIdempotencyKey);
    const expense = await this.prisma.operatingExpense.findFirst({
      where: { id: expenseId, tenantId },
      select: { id: true, deletedAt: true, reversalIdempotencyKey: true },
    });
    if (!expense) return { kind: 'MISSING' };
    if (!expense.deletedAt) return { kind: 'ACTIVE', expenseId: expense.id };
    if (key && expense.reversalIdempotencyKey === key) {
      return { kind: 'SAME_COMMAND', expenseId: expense.id };
    }
    return { kind: 'EXTERNAL', expenseId: expense.id };
  }

  private assertCompatibleReplay(
    existing: OperatingExpense,
    expected: {
      amount: Prisma.Decimal;
      category: OperatingExpenseCategory;
      source: TreasuryAccount;
      expenseDate: Date;
      currency: Currency;
      notes: string | null;
    },
  ) {
    const sameAmount = existing.amount.equals(expected.amount);
    const sameCategory = existing.category === expected.category;
    const sameSource = existing.sourceAccount === expected.source;
    const sameCurrency = existing.currency === expected.currency;
    const sameDate =
      existing.expenseDate.toISOString().slice(0, 10) ===
      expected.expenseDate.toISOString().slice(0, 10);
    if (!sameAmount || !sameCategory || !sameSource || !sameCurrency || !sameDate) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting expense payload',
      );
    }
  }

  private async loadResult(
    expense: OperatingExpense,
    replayed: boolean,
  ): Promise<RegisterExpenseResult> {
    const treasuryEntry = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId: expense.tenantId,
        provenanceKey: operatingExpenseOutflowProvenanceKey(expense.id),
        deletedAt: null,
      },
    });
    if (!treasuryEntry) {
      throw new ConflictException(
        'Expense exists without Treasury OUTFLOW; refusing incomplete economic state',
      );
    }
    return { expense, treasuryEntry, replayed };
  }

  private treasuryDescription(
    category: OperatingExpenseCategory,
    notes: string | null,
  ): string {
    if (notes) return `Gasto ${category}: ${notes}`.slice(0, 240);
    return `Gasto ${category}`;
  }
}

function normalizeReversalKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function classifyAlreadyReversedCausality(
  existingKey: string | null | undefined,
  requestedKey: string | null,
): ReverseExpenseCausality {
  if (requestedKey && existingKey && existingKey === requestedKey) {
    return 'SAME_COMMAND';
  }
  return 'EXTERNAL';
}
