import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CapitalAccount } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  CapitalContributionService,
  toContributionDate,
} from '../../../capital/capital-contribution.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';

const accountSchema = z.enum(['CASH', 'BANK', 'CESAR_ACCOUNT']);

const registerCapitalContributionInputSchema = z.object({
  investorId: z.string().min(1),
  amount: z.number().positive(),
  account: accountSchema,
  contributedAt: z.date(),
  notes: z.string().max(2000).nullable().optional(),
  registerIdempotencyKey: z.string().min(1),
});

export type RegisterCapitalContributionWriteInput = z.infer<
  typeof registerCapitalContributionInputSchema
>;

export const CAPITAL_ACCOUNT_LABELS: Record<CapitalAccount, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR_ACCOUNT: 'Cuenta César',
};

/** Server-owned logical key — never from LLM / client / planner args. */
export function registerCapitalContributionIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

/**
 * Closed-enum CapitalAccount normalization (ledger metadata only).
 * Distinct from TreasuryAccount.CESAR — Capital uses CESAR_ACCOUNT.
 */
export function normalizeCapitalContributionAccount(
  raw: unknown,
): CapitalAccount | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t === 'cash' || t === 'efectivo' || t === 'caja') return CapitalAccount.CASH;
  if (
    t === 'bank' ||
    t === 'banco' ||
    t === 'bancos' ||
    t === 'cuenta bancaria' ||
    t === 'cuenta de banco'
  ) {
    return CapitalAccount.BANK;
  }
  if (
    t === 'cesar' ||
    t === 'césar' ||
    t === 'cesar_account' ||
    t === 'cuenta cesar' ||
    t === 'cuenta césar' ||
    t === 'cuenta de cesar' ||
    t === 'cuenta de césar'
  ) {
    return CapitalAccount.CESAR_ACCOUNT;
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'CASH' || upper === 'BANK' || upper === 'CESAR_ACCOUNT') {
    return upper as CapitalAccount;
  }
  // Treasury enum CESAR must not silently become Capital CESAR_ACCOUNT via AI invent;
  // only accept when clearly the capital label form above.
  return null;
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
export class RegisterCapitalContributionWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterCapitalContributionWriteInput>
{
  readonly capability = 'REGISTER_CAPITAL_CONTRIBUTION' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_capital_contribution_canonical@1.0.0';
  readonly inputSchema = registerCapitalContributionInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly capitalContributions: CapitalContributionService,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): RegisterCapitalContributionWriteInput {
    if (step.capability !== 'REGISTER_CAPITAL_CONTRIBUTION') {
      throw new BadRequestException(
        'Unexpected capability for REGISTER_CAPITAL_CONTRIBUTION binding',
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
        'REGISTER_CAPITAL_CONTRIBUTION requires a trusted investorId',
      );
    }
    if (amount === null || amount <= 0) {
      throw new BadRequestException(
        'REGISTER_CAPITAL_CONTRIBUTION requires a positive amount',
      );
    }
    if (!account) {
      throw new BadRequestException(
        'REGISTER_CAPITAL_CONTRIBUTION requires account CASH|BANK|CESAR_ACCOUNT',
      );
    }

    const currencyRaw = asString(args.currency)?.toUpperCase();
    if (currencyRaw && currencyRaw !== 'MXN') {
      throw new BadRequestException('REGISTER_CAPITAL_CONTRIBUTION V1 supports MXN only');
    }

    const dateRaw =
      asString(args.contributedAt) ??
      asString(args.date) ??
      asString(args.effectiveDate);
    if (!dateRaw) {
      throw new BadRequestException(
        'REGISTER_CAPITAL_CONTRIBUTION requires contributedAt',
      );
    }
    let contributedAt: Date;
    try {
      contributedAt = toContributionDate(dateRaw);
    } catch {
      throw new BadRequestException('REGISTER_CAPITAL_CONTRIBUTION contributedAt is invalid');
    }

    return {
      investorId,
      amount,
      account,
      contributedAt,
      notes: asString(args.notes),
      registerIdempotencyKey: registerCapitalContributionIdempotencyKey(context.actionRunId),
    };
  }

  async execute(
    input: RegisterCapitalContributionWriteInput,
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
      throw new ConflictException('STALE_CAPITAL_CONTRIBUTION_INVESTOR');
    }

    let result;
    try {
      result = await this.capitalContributions.register(context.tenantId, {
        investorId: input.investorId,
        amount: input.amount,
        account: input.account,
        contributedAt: input.contributedAt,
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
          msg.includes('reversed contribution') ||
          msg.includes('STALE_CAPITAL_CONTRIBUTION_REVERSED')
        ) {
          throw new ConflictException('STALE_CAPITAL_CONTRIBUTION_REVERSED');
        }
        if (
          msg.includes('conflicting contribution') ||
          msg.includes('CANONICAL_CAPITAL_CONTRIBUTION_INVARIANT')
        ) {
          throw new ConflictException('CANONICAL_CAPITAL_CONTRIBUTION_INVARIANT');
        }
        throw error;
      }
      throw error;
    }

    if (result.contribution.deletedAt) {
      throw new ConflictException('STALE_CAPITAL_CONTRIBUTION_REVERSED');
    }

    // Architecture invariant: Capital contribution never writes Treasury.
    const treasuryLinked = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId: context.tenantId,
        contributionId: result.contribution.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (treasuryLinked) {
      throw new ConflictException('CANONICAL_CAPITAL_CONTRIBUTION_INVARIANT');
    }

    const amountStr = result.contribution.amount.toFixed(2);
    return {
      actionId: 'REGISTER_CAPITAL_CONTRIBUTION',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'INVESTOR_CONTRIBUTION',
          id: idHash(result.contribution.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
      ],
      generatedEvents: [
        {
          type: result.replayed
            ? 'CAPITAL_CONTRIBUTION_REPLAYED'
            : 'CAPITAL_CONTRIBUTION_REGISTERED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        kind: 'CAPITAL_CONTRIBUTION',
        contributionId: result.contribution.id,
        contributionIdHash: idHash(result.contribution.id),
        investorId: investor.id,
        investorIdHash: idHash(investor.id),
        investorLabel: investor.name,
        amount: amountStr,
        currency: 'MXN',
        account: result.contribution.account,
        accountLabel: CAPITAL_ACCOUNT_LABELS[result.contribution.account],
        contributedAt: result.contribution.contributedAt.toISOString(),
        ownershipChanged: false,
        treasuryChanged: false,
        capitalContributedDelta: `+${amountStr}`,
        capitalNetoDelta: `+${amountStr}`,
        businessProfit: 'Sin cambio',
        ownership: 'Sin cambio',
        treasury: 'Sin cambio',
        replayed: result.replayed,
        correctionPolicy:
          'Después de registrarla, cualquier corrección se realiza desde Capital (revierte y crea de nuevo).',
      } as JsonValue,
      warnings: [],
      rollbackPossible: false,
    };
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
        'Authenticated tenant membership required for capital contribution execution',
      );
    }
  }
}
