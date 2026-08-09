import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CapitalService } from '../../../capital/capital.service';
import {
  CapitalDistributionService,
  toDistributionDate,
} from '../../../capital/capital-distribution.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import {
  CAPITAL_ACCOUNT_LABELS,
  normalizeCapitalContributionAccount,
} from './register-capital-contribution.binding';

const accountSchema = z.enum(['CASH', 'BANK', 'CESAR_ACCOUNT']);

const registerCapitalDistributionInputSchema = z.object({
  investorId: z.string().min(1),
  amount: z.number().positive(),
  account: accountSchema,
  paidAt: z.date(),
  notes: z.string().max(2000).nullable().optional(),
  registerIdempotencyKey: z.string().min(1),
});

export type RegisterCapitalDistributionWriteInput = z.infer<
  typeof registerCapitalDistributionInputSchema
>;

/** Server-owned logical key — never from LLM / client / planner args. */
export function registerCapitalDistributionIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

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

@Injectable()
export class RegisterCapitalDistributionWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterCapitalDistributionWriteInput>
{
  readonly capability = 'REGISTER_CAPITAL_DISTRIBUTION' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_capital_distribution_canonical@1.0.0';
  readonly inputSchema = registerCapitalDistributionInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly capitalDistributions: CapitalDistributionService,
    private readonly capital: CapitalService,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): RegisterCapitalDistributionWriteInput {
    if (step.capability !== 'REGISTER_CAPITAL_DISTRIBUTION') {
      throw new BadRequestException(
        'Unexpected capability for REGISTER_CAPITAL_DISTRIBUTION binding',
      );
    }
    const args = step.arguments as Record<string, unknown>;
    const investorId = asString(args.investorId) ?? asString(args.selectedInvestorId);
    const amount = asNumber(args.amount);
    const account =
      normalizeCapitalContributionAccount(args.account) ??
      normalizeCapitalContributionAccount(args.capitalAccount);

    if (!investorId) {
      throw new BadRequestException(
        'REGISTER_CAPITAL_DISTRIBUTION requires a trusted investorId',
      );
    }
    if (amount === null || amount <= 0) {
      throw new BadRequestException(
        'REGISTER_CAPITAL_DISTRIBUTION requires a positive amount',
      );
    }
    if (!account) {
      throw new BadRequestException(
        'REGISTER_CAPITAL_DISTRIBUTION requires account CASH|BANK|CESAR_ACCOUNT',
      );
    }

    const currencyRaw = asString(args.currency)?.toUpperCase();
    if (currencyRaw && currencyRaw !== 'MXN') {
      throw new BadRequestException('REGISTER_CAPITAL_DISTRIBUTION V1 supports MXN only');
    }

    const dateRaw =
      asString(args.paidAt) ?? asString(args.date) ?? asString(args.effectiveDate);
    if (!dateRaw) {
      throw new BadRequestException('REGISTER_CAPITAL_DISTRIBUTION requires paidAt');
    }
    let paidAt: Date;
    try {
      paidAt = toDistributionDate(dateRaw);
    } catch {
      throw new BadRequestException('REGISTER_CAPITAL_DISTRIBUTION paidAt is invalid');
    }

    return {
      investorId,
      amount,
      account,
      paidAt,
      notes: asString(args.notes),
      registerIdempotencyKey: registerCapitalDistributionIdempotencyKey(context.actionRunId),
    };
  }

  async execute(
    input: RegisterCapitalDistributionWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context);

    const investor = await this.prisma.investor.findFirst({
      where: {
        id: input.investorId,
        tenantId: context.tenantId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, name: true },
    });
    if (!investor) {
      throw new ConflictException('STALE_CAPITAL_DISTRIBUTION_INVESTOR');
    }

    const previousPending = await this.safeInvestorPending(
      context.tenantId,
      input.investorId,
    );

    let result;
    try {
      result = await this.capitalDistributions.register(context.tenantId, {
        investorId: input.investorId,
        amount: input.amount,
        account: input.account,
        paidAt: input.paidAt,
        notes: input.notes ?? null,
        registerIdempotencyKey: input.registerIdempotencyKey,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        const body = error.getResponse();
        const msg =
          typeof body === 'string'
            ? body
            : typeof body === 'object' && body && 'message' in body
              ? String((body as { message: unknown }).message)
              : error.message;
        if (
          msg.includes('reversed distribution') ||
          msg.includes('STALE_CAPITAL_DISTRIBUTION_REVERSED')
        ) {
          throw new ConflictException('STALE_CAPITAL_DISTRIBUTION_REVERSED');
        }
        if (
          msg.includes('conflicting distribution') ||
          msg.includes('CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT')
        ) {
          throw new ConflictException('CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT');
        }
        throw error;
      }
      throw error;
    }

    if (result.distribution.deletedAt) {
      throw new ConflictException('STALE_CAPITAL_DISTRIBUTION_REVERSED');
    }

    // Architecture invariant: Capital distribution never writes Treasury.
    const treasuryLinked = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId: context.tenantId,
        distributionId: result.distribution.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (treasuryLinked) {
      throw new ConflictException('CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT');
    }

    const amountStr = result.distribution.amount.toFixed(2);
    const amountDec = new Prisma.Decimal(amountStr);
    const remainingPendingStr =
      previousPending != null
        ? previousPending.minus(amountDec).toFixed(2)
        : (await this.safeInvestorPending(context.tenantId, input.investorId))?.toFixed(2) ??
          null;

    const overDistribution =
      previousPending != null ? previousPending.lessThan(amountDec) : false;

    return {
      actionId: 'REGISTER_CAPITAL_DISTRIBUTION',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'INVESTOR_DISTRIBUTION',
          id: idHash(result.distribution.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
      ],
      generatedEvents: [
        {
          type: result.replayed
            ? 'CAPITAL_DISTRIBUTION_REPLAYED'
            : 'CAPITAL_DISTRIBUTION_REGISTERED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        kind: 'CAPITAL_DISTRIBUTION',
        distributionId: result.distribution.id,
        distributionIdHash: idHash(result.distribution.id),
        investorId: investor.id,
        investorIdHash: idHash(investor.id),
        investorLabel: investor.name,
        amount: amountStr,
        currency: 'MXN',
        account: result.distribution.account,
        accountLabel: CAPITAL_ACCOUNT_LABELS[result.distribution.account],
        paidAt: result.distribution.paidAt.toISOString(),
        previousPending: previousPending?.toFixed(2) ?? null,
        remainingPending: remainingPendingStr,
        overDistribution,
        ownershipChanged: false,
        treasuryChanged: false,
        businessProfitChanged: false,
        distributionsPaidDelta: `+${amountStr}`,
        pendingDelta: `-${amountStr}`,
        capitalNetoDelta: `-${amountStr}`,
        businessProfit: 'Sin cambio',
        ownership: 'Sin cambio',
        treasury: 'Sin cambio',
        replayed: result.replayed,
        correctionPolicy:
          'Después de registrarla, cualquier corrección se realiza desde Capital (revierte y crea de nuevo).',
      } as JsonValue,
      warnings: overDistribution
        ? [
            {
              code: 'OVER_DISTRIBUTION',
              message:
                'Esta distribución deja al socio con pendiente negativo. Política V1: over-distribution permitida.',
            },
          ]
        : [],
      rollbackPossible: false,
    };
  }

  private async safeInvestorPending(
    tenantId: string,
    investorId: string,
  ): Promise<Prisma.Decimal | null> {
    try {
      const summary = await this.capital.getSummary(tenantId);
      const row = summary.investors.find((i) => i.id === investorId);
      if (!row) return null;
      return new Prisma.Decimal(row.pendingProfit);
    } catch {
      return null;
    }
  }

  private async assertMembership(context: WriteExecutionContext) {
    const membership = await this.prisma.tenantUser.findFirst({
      where: {
        tenantId: context.tenantId,
        userId: context.userId,
        tenant: { status: 'ACTIVE' },
        user: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Authenticated tenant membership required for capital distribution execution',
      );
    }
  }
}
