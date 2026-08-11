import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ExpenseRegistrationService } from '../../../expenses/expense-registration.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import { ExpenseReversalTargetResolver } from '../../reversals/expense-reversal-target-resolver.service';
import { expenseFingerprintsMatch } from '../../reversals/expense-reversal-fingerprint';
import { classifyExpenseReversalRecovery } from '../../reversals/expense-reversal-recovery';
import { buildExpenseReversalPreview } from '../../reversals/reversal-preview';
import { reversalCommandKey } from '../../reversals/financial-reversal.types';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_SOURCE_LABELS } from './expense-category-resolver';

const reverseExpenseInputSchema = z.object({
  targetId: z.string().min(1),
  targetFingerprint: z.string().min(16),
  reversalIdempotencyKey: z.string().min(1),
});

export type ReverseExpenseWriteInput = z.infer<typeof reverseExpenseInputSchema>;

function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * WRITE #13 — REVERSE_EXPENSE.
 * Calls only ExpenseRegistrationService.reverse with server-owned causal key.
 */
@Injectable()
export class ReverseExpenseWriteBinding
  implements WriteCapabilityBindingDefinition<ReverseExpenseWriteInput>
{
  readonly capability = 'REVERSE_EXPENSE' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'reverse_expense_canonical@1.0.0';
  readonly inputSchema = reverseExpenseInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpenseRegistrationService,
    private readonly targetResolver: ExpenseReversalTargetResolver,
  ) {}

  mapInput(step: BusinessPlanStep, context: WriteExecutionContext): ReverseExpenseWriteInput {
    if (step.capability !== 'REVERSE_EXPENSE') {
      throw new BadRequestException('Unexpected capability for REVERSE_EXPENSE binding');
    }
    const args = step.arguments as Record<string, unknown>;
    // Only server-injected trusted fields — never provider expenseId.
    const targetId = asString(args.targetId) ?? asString(args.trustedExpenseId);
    const targetFingerprint =
      asString(args.targetFingerprint) ?? asString(args.trustedTargetFingerprint);
    if (!targetId || !targetFingerprint) {
      throw new BadRequestException(
        'REVERSE_EXPENSE requires server-resolved targetId and targetFingerprint',
      );
    }
    return reverseExpenseInputSchema.parse({
      targetId,
      targetFingerprint,
      reversalIdempotencyKey: reversalCommandKey(context.actionRunId),
    });
  }

  async execute(
    input: ReverseExpenseWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context.tenantId, context.userId);

    const resolved = await this.targetResolver.resolveTrustedId(
      context.tenantId,
      input.targetId,
    );

    if (resolved.kind === 'NONE') {
      throw new ConflictException('REVERSAL_TARGET_NOT_FOUND');
    }
    if (resolved.kind === 'CANONICAL_INVARIANT') {
      throw new ConflictException('REVERSAL_INVARIANT');
    }
    if (resolved.kind === 'ALREADY_REVERSED') {
      // Distinguish same-command vs external via domain reverse / recovery.
      const expense = await this.prisma.operatingExpense.findFirst({
        where: { id: input.targetId, tenantId: context.tenantId },
        select: { deletedAt: true, reversalIdempotencyKey: true },
      });
      const recovery = classifyExpenseReversalRecovery({
        commandKey: input.reversalIdempotencyKey,
        expense,
        plannedFingerprint: input.targetFingerprint,
        currentFingerprint: input.targetFingerprint,
      });
      if (recovery.kind === 'MATCH') {
        return this.toResult({
          expenseId: input.targetId,
          snapshot: {
            amount: '0.00',
            currency: 'MXN',
            category: 'OTHER',
            sourceAccount: null,
            conceptLabel: resolved.safeLabel,
            hasCanonicalTreasuryOutflow: false,
            expenseDate: null,
          },
          causality: 'SAME_COMMAND',
          recovered: true,
          treasuryRestored: false,
        });
      }
      throw new ConflictException('REVERSAL_ALREADY_REVERSED_EXTERNALLY');
    }
    if (resolved.kind !== 'TRUSTED') {
      throw new ConflictException('REVERSAL_TARGET_AMBIGUOUS');
    }

    if (
      !expenseFingerprintsMatch(
        input.targetFingerprint,
        resolved.target.targetFingerprint,
      )
    ) {
      throw new ConflictException('REVERSAL_TARGET_STALE');
    }

    const result = await this.expenses.reverse(context.tenantId, input.targetId, {
      reversalIdempotencyKey: input.reversalIdempotencyKey,
    });

    if (result.causality === 'EXTERNAL') {
      throw new ConflictException('REVERSAL_ALREADY_REVERSED_EXTERNALLY');
    }

    const snapshot = resolved.target.targetSnapshot;
    if (snapshot.kind !== 'OPERATING_EXPENSE') {
      throw new ConflictException('REVERSAL_TARGET_NOT_FOUND');
    }
    return this.toResult({
      expenseId: result.expense.id,
      snapshot: {
        amount: snapshot.amount,
        currency: snapshot.currency,
        category: snapshot.category,
        sourceAccount: snapshot.sourceAccount,
        conceptLabel: snapshot.conceptLabel,
        hasCanonicalTreasuryOutflow: snapshot.hasCanonicalTreasuryOutflow,
        expenseDate: snapshot.expenseDate,
        economicClass: snapshot.economicClass,
      },
      causality: result.causality,
      recovered: result.causality === 'SAME_COMMAND',
      treasuryRestored: Boolean(result.treasuryEntry),
      treasuryEntryId: result.treasuryEntry?.id ?? null,
    });
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

  private toResult(args: {
    expenseId: string;
    snapshot: {
      amount: string;
      currency: string;
      category: string;
      sourceAccount: string | null;
      conceptLabel: string | null;
      hasCanonicalTreasuryOutflow: boolean;
      expenseDate: string | null;
      economicClass?: 'LEGACY_VALID' | 'CANONICAL_VALID' | 'CANONICAL_INVARIANT';
    };
    causality: 'APPLIED' | 'SAME_COMMAND' | 'EXTERNAL';
    recovered: boolean;
    treasuryRestored: boolean;
    treasuryEntryId?: string | null;
  }): BusinessActionResult {
    const categoryLabel =
      EXPENSE_CATEGORY_LABELS[args.snapshot.category as keyof typeof EXPENSE_CATEGORY_LABELS] ??
      args.snapshot.category;
    const concept = args.snapshot.conceptLabel || categoryLabel;
    const sourceLabel = args.snapshot.sourceAccount
      ? EXPENSE_SOURCE_LABELS[args.snapshot.sourceAccount] ?? args.snapshot.sourceAccount
      : null;
    const economicClass =
      args.snapshot.economicClass ??
      (args.snapshot.hasCanonicalTreasuryOutflow ? 'CANONICAL_VALID' : 'LEGACY_VALID');
    const preview = buildExpenseReversalPreview({
      kind: 'OPERATING_EXPENSE',
      amount: args.snapshot.amount,
      currency: args.snapshot.currency === 'USD' ? 'USD' : 'MXN',
      category: args.snapshot.category,
      sourceAccount: (args.snapshot.sourceAccount as 'CASH' | 'BANK' | 'CESAR' | null) ?? null,
      expenseDate: args.snapshot.expenseDate,
      conceptLabel: args.snapshot.conceptLabel,
      hasCanonicalTreasuryOutflow: args.snapshot.hasCanonicalTreasuryOutflow,
      active: false,
      economicClass,
    });

    const affected: BusinessActionResult['affectedEntities'] = [
      {
        type: 'OPERATING_EXPENSE',
        id: idHash(args.expenseId),
        effect: args.recovered ? 'REPLAYED' : 'REVERSED',
      },
    ];
    if (args.treasuryEntryId) {
      affected.push({
        type: 'TREASURY_ENTRY',
        id: idHash(args.treasuryEntryId),
        effect: 'REVERSED',
      });
    }

    return {
      actionId: 'REVERSE_EXPENSE',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: affected,
      warnings: [],
      generatedEvents: [],
      receipt: {
        kind: 'OPERATING_EXPENSE_REVERSAL',
        expenseId: args.expenseId,
        expenseIdHash: idHash(args.expenseId),
        amount: args.snapshot.amount,
        currency: args.snapshot.currency,
        category: args.snapshot.category,
        categoryLabel,
        concept,
        sourceAccount: args.snapshot.sourceAccount,
        sourceLabel,
        expenseDate: args.snapshot.expenseDate,
        legacyMode: preview.legacyMode,
        restoredLiquidity: preview.restoresLiquidity && args.treasuryRestored,
        pnlChanged: true,
        capitalChanged: false,
        capitalUnchanged: true,
        recovered: args.recovered,
        causality: args.causality,
        rollbackPossible: false,
        message: `Revertí el gasto de ${concept} por $${args.snapshot.amount} ${args.snapshot.currency}.`,
        treasuryNote: preview.legacyMode
          ? 'Tesorería\nSin cambios'
          : sourceLabel
            ? `${sourceLabel}\n+$${args.snapshot.amount}`
            : 'Tesorería\nRestaurada',
      } as unknown as JsonValue,
      rollbackPossible: false,
    };
  }
}
