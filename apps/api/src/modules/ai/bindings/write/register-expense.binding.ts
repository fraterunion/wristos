import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Currency, OperatingExpenseCategory, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  ExpenseRegistrationService,
  REGISTERABLE_EXPENSE_CATEGORIES,
} from '../../../expenses/expense-registration.service';
import { operatingExpenseOutflowProvenanceKey } from '../../../treasury/treasury.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_SOURCE_LABELS,
  resolveExpenseCategory,
  resolveExpenseSource,
} from './expense-category-resolver';

const sourceSchema = z.enum(['CASH', 'BANK', 'CESAR']);
const categorySchema = z.enum([
  'GASOLINE',
  'TOLLS',
  'WATCHMAKER',
  'PARKING',
  'MEALS',
  'FLIGHTS',
  'TRAVEL',
  'MARKETING',
  'COMMISSIONS',
  'OTHER',
]);

const registerExpenseInputSchema = z.object({
  amount: z.number().positive(),
  currency: z.literal('MXN'),
  category: categorySchema,
  source: sourceSchema,
  expenseDate: z.date(),
  notes: z.string().max(2000).nullable().optional(),
  concept: z.string().max(160).optional(),
  registerIdempotencyKey: z.string().min(1),
});

export type RegisterExpenseWriteInput = z.infer<typeof registerExpenseInputSchema>;

function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseExpenseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = asString(value);
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

export function registerExpenseIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

@Injectable()
export class RegisterExpenseWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterExpenseWriteInput>
{
  readonly capability = 'REGISTER_EXPENSE' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_expense_canonical@1.0.0';
  readonly inputSchema = registerExpenseInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpenseRegistrationService,
  ) {}

  mapInput(step: BusinessPlanStep, context: WriteExecutionContext): RegisterExpenseWriteInput {
    if (step.capability !== 'REGISTER_EXPENSE') {
      throw new BadRequestException('Unexpected capability for REGISTER_EXPENSE binding');
    }
    const args = step.arguments as Record<string, unknown>;
    const amount = asNumber(args.amount);
    const currencyRaw = (asString(args.currency) ?? 'MXN').toUpperCase();
    if (currencyRaw !== 'MXN') {
      throw new BadRequestException('REGISTER_EXPENSE V1 supports MXN only');
    }

    const source =
      resolveExpenseSource(args.source) ??
      resolveExpenseSource(args.sourceAccount) ??
      resolveExpenseSource(args.sourceAccountId);
    if (!source) {
      throw new BadRequestException(
        'REGISTER_EXPENSE requires source CASH|BANK|CESAR',
      );
    }

    const categoryResolve = resolveExpenseCategory({
      category: asString(args.category),
      concept: asString(args.concept) ?? asString(args.notes),
      notes: asString(args.notes),
    });
    if (categoryResolve.kind !== 'RESOLVED') {
      throw new BadRequestException(
        categoryResolve.reason || 'REGISTER_EXPENSE category could not be resolved',
      );
    }

    const expenseDate =
      parseExpenseDate(args.expenseDate) ??
      parseExpenseDate(args.date) ??
      parseExpenseDate(args.effectiveDate);
    if (!expenseDate) {
      throw new BadRequestException('REGISTER_EXPENSE requires expenseDate');
    }

    if (amount == null || amount <= 0) {
      throw new BadRequestException('REGISTER_EXPENSE requires a positive amount');
    }

    const notes =
      asString(args.notes) ??
      categoryResolve.concept ??
      asString(args.concept);

    return registerExpenseInputSchema.parse({
      amount,
      currency: 'MXN',
      category: categoryResolve.category,
      source,
      expenseDate,
      notes,
      concept: categoryResolve.concept,
      registerIdempotencyKey: registerExpenseIdempotencyKey(context.actionRunId),
    });
  }

  async execute(
    input: RegisterExpenseWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context.tenantId, context.userId);
    this.assertCanonicalArgs(input);

    const result = await this.expenses.register(context.tenantId, {
      amount: input.amount,
      currency: Currency.MXN,
      category: input.category as OperatingExpenseCategory,
      source: input.source,
      expenseDate: input.expenseDate,
      notes: input.notes ?? input.concept ?? null,
      registerIdempotencyKey: input.registerIdempotencyKey,
    });

    // Atomicity invariant: expense without OUTFLOW is corruption.
    const expectedKey = operatingExpenseOutflowProvenanceKey(result.expense.id);
    if (
      !result.treasuryEntry ||
      result.treasuryEntry.deletedAt ||
      result.treasuryEntry.provenanceKey !== expectedKey
    ) {
      throw new ConflictException(
        'CANONICAL_EXPENSE_INVARIANT: OperatingExpense committed without matching Treasury OUTFLOW',
      );
    }

    return this.toResult(result.expense, result.treasuryEntry, result.replayed, input);
  }

  private assertCanonicalArgs(input: RegisterExpenseWriteInput) {
    if (input.currency !== 'MXN') {
      throw new BadRequestException('REGISTER_EXPENSE V1 supports MXN only');
    }
    if (!(REGISTERABLE_EXPENSE_CATEGORIES as string[]).includes(input.category)) {
      throw new BadRequestException('Expense category is not allowed');
    }
  }

  private async assertMembership(tenantId: string, userId: string) {
    const membership = await this.prisma.tenantUser.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Actor is not a member of this tenant');
    }
  }

  private toResult(
    expense: {
      id: string;
      amount: Prisma.Decimal;
      currency: Currency;
      category: OperatingExpenseCategory;
      sourceAccount: string | null;
      notes: string | null;
      expenseDate: Date;
    },
    treasury: { id: string; account: string; amountMxn: Prisma.Decimal },
    replayed: boolean,
    input: RegisterExpenseWriteInput,
  ): BusinessActionResult {
    const categoryLabel =
      EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category;
    const sourceLabel =
      EXPENSE_SOURCE_LABELS[String(expense.sourceAccount ?? input.source)] ??
      String(expense.sourceAccount ?? input.source);
    const concept = input.concept ?? expense.notes ?? categoryLabel;
    const dateStr = expense.expenseDate.toISOString().slice(0, 10);

    return {
      actionId: 'REGISTER_EXPENSE',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'OPERATING_EXPENSE',
          id: idHash(expense.id),
          effect: replayed ? 'REPLAYED' : 'CREATED',
        },
        {
          type: 'TREASURY_ENTRY',
          id: idHash(treasury.id),
          effect: 'OUTFLOW',
        },
      ],
      warnings: [],
      generatedEvents: [],
      receipt: {
        kind: 'OPERATING_EXPENSE',
        expenseId: expense.id,
        treasuryEntryId: treasury.id,
        amount: expense.amount.toFixed(2),
        currency: expense.currency,
        category: expense.category,
        categoryLabel,
        concept,
        sourceAccount: expense.sourceAccount ?? input.source,
        sourceLabel,
        expenseDate: dateStr,
        capitalUnchanged: true,
        capitalNote:
          'Capital (utilidad bruta histórica) no cambia con este gasto bajo la metodología actual.',
        replayed,
      } as unknown as JsonValue,
      rollbackPossible: false,
    };
  }
}
