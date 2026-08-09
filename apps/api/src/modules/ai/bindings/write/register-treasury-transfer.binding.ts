import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  TreasuryTransferService,
  type TreasuryTransferAccount,
} from '../../../treasury/treasury-transfer.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';

const accountSchema = z.enum(['CASH', 'BANK', 'CESAR']);

const registerTreasuryTransferInputSchema = z
  .object({
    sourceAccount: accountSchema,
    destinationAccount: accountSchema,
    amount: z.number().positive(),
    transferDate: z.date().optional(),
    notes: z.string().max(2000).nullable().optional(),
    registerIdempotencyKey: z.string().min(1),
  })
  .refine((v) => v.sourceAccount !== v.destinationAccount, {
    message: 'Source and destination accounts must be different',
  });

export type RegisterTreasuryTransferWriteInput = z.infer<
  typeof registerTreasuryTransferInputSchema
>;

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

export function accountLabel(account: TreasuryTransferAccount): string {
  if (account === 'CASH') return 'Efectivo';
  if (account === 'BANK') return 'Bancos';
  return 'Cuenta César';
}

/** Server-owned logical key — never from LLM / client / planner args. */
export function registerTreasuryTransferIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

/**
 * Closed-enum account normalization for transfer intents.
 * Rejects CRYPTO / arbitrary strings.
 */
export function normalizeTreasuryTransferAccount(
  raw: unknown,
): TreasuryTransferAccount | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t === 'cash' || t === 'efectivo' || t === 'caja') return 'CASH';
  if (
    t === 'bank' ||
    t === 'banco' ||
    t === 'bancos' ||
    t === 'cuenta bancaria' ||
    t === 'cuenta de banco'
  ) {
    return 'BANK';
  }
  if (
    t === 'cesar' ||
    t === 'césar' ||
    t === 'cuenta cesar' ||
    t === 'cuenta césar' ||
    t === 'cuenta de cesar' ||
    t === 'cuenta de césar'
  ) {
    return 'CESAR';
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'CASH' || upper === 'BANK' || upper === 'CESAR') return upper;
  return null;
}

@Injectable()
export class RegisterTreasuryTransferWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterTreasuryTransferWriteInput>
{
  readonly capability = 'REGISTER_TREASURY_TRANSFER' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_treasury_transfer_canonical@1.0.0';
  readonly inputSchema = registerTreasuryTransferInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryTransfers: TreasuryTransferService,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): RegisterTreasuryTransferWriteInput {
    if (step.capability !== 'REGISTER_TREASURY_TRANSFER') {
      throw new BadRequestException(
        'Unexpected capability for REGISTER_TREASURY_TRANSFER binding',
      );
    }
    const args = step.arguments as Record<string, unknown>;
    const source =
      normalizeTreasuryTransferAccount(args.sourceAccount) ??
      normalizeTreasuryTransferAccount(args.source);
    const destination =
      normalizeTreasuryTransferAccount(args.destinationAccount) ??
      normalizeTreasuryTransferAccount(args.destination);
    const amount = asNumber(args.amount);

    if (!source || !destination) {
      throw new BadRequestException(
        'REGISTER_TREASURY_TRANSFER requires sourceAccount and destinationAccount CASH|BANK|CESAR',
      );
    }
    if (source === destination) {
      throw new BadRequestException(
        'No puedo registrar una transferencia entre la misma cuenta.',
      );
    }
    if (amount === null || amount <= 0) {
      throw new BadRequestException(
        'REGISTER_TREASURY_TRANSFER requires a positive amount',
      );
    }

    const currencyRaw = asString(args.currency)?.toUpperCase();
    if (currencyRaw && currencyRaw !== 'MXN') {
      throw new BadRequestException('REGISTER_TREASURY_TRANSFER V1 supports MXN only');
    }

    const dateRaw =
      asString(args.date) ??
      asString(args.transferDate) ??
      asString(args.effectiveDate);
    const transferDate = dateRaw ? new Date(dateRaw) : undefined;
    if (transferDate && Number.isNaN(transferDate.getTime())) {
      throw new BadRequestException('REGISTER_TREASURY_TRANSFER transfer date is invalid');
    }

    return {
      sourceAccount: source,
      destinationAccount: destination,
      amount,
      transferDate,
      notes: asString(args.notes),
      registerIdempotencyKey: registerTreasuryTransferIdempotencyKey(context.actionRunId),
    };
  }

  async execute(
    input: RegisterTreasuryTransferWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context);

    // Freshness: re-check closed enums + same-account (no balance-based stale).
    if (input.sourceAccount === input.destinationAccount) {
      throw new ConflictException('STALE_TREASURY_TRANSFER_SAME_ACCOUNT');
    }

    let result;
    try {
      result = await this.treasuryTransfers.register(context.tenantId, {
        sourceAccount: input.sourceAccount,
        destinationAccount: input.destinationAccount,
        amount: input.amount,
        transferDate: input.transferDate,
        notes: input.notes ?? null,
        registerIdempotencyKey: input.registerIdempotencyKey,
        actorUserId: context.userId,
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('STALE_TREASURY_TRANSFER_REVERSED')) {
        throw new ConflictException('STALE_TREASURY_TRANSFER_REVERSED');
      }
      if (msg.includes('STALE_TREASURY_TRANSFER_INVARIANT')) {
        throw new ConflictException('CANONICAL_TREASURY_TRANSFER_INVARIANT');
      }
      throw error;
    }

    if (result.outflowEntry.deletedAt || result.inflowEntry.deletedAt) {
      throw new ConflictException('STALE_TREASURY_TRANSFER_REVERSED');
    }

    return {
      actionId: 'REGISTER_TREASURY_TRANSFER',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'TREASURY_ENTRY',
          id: idHash(result.outflowEntry.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
        {
          type: 'TREASURY_ENTRY',
          id: idHash(result.inflowEntry.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
      ],
      generatedEvents: [
        {
          type: result.replayed
            ? 'TREASURY_TRANSFER_REPLAYED'
            : 'TREASURY_TRANSFER_REGISTERED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        kind: 'TREASURY_TRANSFER',
        transferId: result.transferId,
        transferIdHash: idHash(result.transferId),
        sourceAccount: result.sourceAccount,
        sourceAccountLabel: accountLabel(result.sourceAccount),
        destinationAccount: result.destinationAccount,
        destinationAccountLabel: accountLabel(result.destinationAccount),
        amount: result.amount.toFixed(2),
        currency: 'MXN',
        transferDate: result.outflowEntry.transactionDate.toISOString(),
        outflowEntryId: result.outflowEntry.id,
        inflowEntryId: result.inflowEntry.id,
        replayed: result.replayed,
        totalLiquidity: 'Sin cambio',
        profit: 'Sin cambio',
        capital: 'Sin cambio',
        correctionPolicy:
          'Después de registrarla, cualquier corrección se realiza desde Tesorería.',
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
        'Authenticated tenant membership required for treasury transfer execution',
      );
    }
  }
}
