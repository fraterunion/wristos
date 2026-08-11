import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TreasuryTransferService } from '../../../treasury/treasury-transfer.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import { TransferReversalTargetResolver } from '../../reversals/transfer-reversal-target-resolver.service';
import { transferFingerprintsMatch } from '../../reversals/transfer-reversal-fingerprint';
import { classifyTransferReversalRecovery } from '../../reversals/transfer-reversal-recovery';
import { buildTransferReversalPreview } from '../../reversals/reversal-preview';
import { reversalCommandKey } from '../../reversals/financial-reversal.types';
import { accountLabel } from './register-treasury-transfer.binding';
import {
  treasuryTransferInflowProvenanceKey,
  treasuryTransferOutflowProvenanceKey,
} from '../../../treasury/treasury-transfer.service';

const reverseTreasuryTransferInputSchema = z.object({
  targetId: z.string().min(1),
  targetFingerprint: z.string().min(16),
  reversalIdempotencyKey: z.string().min(1),
});

export type ReverseTreasuryTransferWriteInput = z.infer<
  typeof reverseTreasuryTransferInputSchema
>;

function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * WRITE #14 — REVERSE_TREASURY_TRANSFER.
 * Calls only TreasuryTransferService.reverse with server-owned causal key.
 * Logical transfer pair only — never a lone TreasuryEntry leg.
 */
@Injectable()
export class ReverseTreasuryTransferWriteBinding
  implements WriteCapabilityBindingDefinition<ReverseTreasuryTransferWriteInput>
{
  readonly capability = 'REVERSE_TREASURY_TRANSFER' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'reverse_treasury_transfer_canonical@1.0.0';
  readonly inputSchema = reverseTreasuryTransferInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TreasuryTransferService,
    private readonly targetResolver: TransferReversalTargetResolver,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): ReverseTreasuryTransferWriteInput {
    if (step.capability !== 'REVERSE_TREASURY_TRANSFER') {
      throw new BadRequestException('Unexpected capability for REVERSE_TREASURY_TRANSFER binding');
    }
    const args = step.arguments as Record<string, unknown>;
    const targetId = asString(args.targetId) ?? asString(args.trustedTransferId);
    const targetFingerprint =
      asString(args.targetFingerprint) ?? asString(args.trustedTargetFingerprint);
    if (!targetId || !targetFingerprint) {
      throw new BadRequestException(
        'REVERSE_TREASURY_TRANSFER requires server-resolved targetId and targetFingerprint',
      );
    }
    return reverseTreasuryTransferInputSchema.parse({
      targetId,
      targetFingerprint,
      reversalIdempotencyKey: reversalCommandKey(context.actionRunId),
    });
  }

  async execute(
    input: ReverseTreasuryTransferWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context.tenantId, context.userId);

    const resolved = await this.targetResolver.resolveTrustedTransferId(
      context.tenantId,
      input.targetId,
    );

    if (resolved.kind === 'NONE') {
      throw new ConflictException('REVERSAL_TARGET_NOT_FOUND');
    }
    if (resolved.kind === 'INVARIANT') {
      throw new ConflictException('REVERSAL_INVARIANT');
    }
    if (resolved.kind === 'ALREADY_REVERSED') {
      const outflow = await this.prisma.treasuryEntry.findFirst({
        where: {
          tenantId: context.tenantId,
          provenanceKey: treasuryTransferOutflowProvenanceKey(input.targetId),
        },
        select: { deletedAt: true, reversalIdempotencyKey: true },
      });
      const inflow = await this.prisma.treasuryEntry.findFirst({
        where: {
          tenantId: context.tenantId,
          provenanceKey: treasuryTransferInflowProvenanceKey(input.targetId),
        },
        select: { deletedAt: true, reversalIdempotencyKey: true },
      });
      const recovery = classifyTransferReversalRecovery({
        commandKey: input.reversalIdempotencyKey,
        outflow,
        inflow,
        plannedFingerprint: input.targetFingerprint,
        currentFingerprint: input.targetFingerprint,
      });
      if (recovery.kind === 'MATCH') {
        return this.toResult({
          transferId: input.targetId,
          snapshot: {
            amount: '0.00',
            sourceAccount: 'BANK',
            destinationAccount: 'CASH',
            transferDate: null,
          },
          causality: 'SAME_COMMAND',
          recovered: true,
          safeLabel: resolved.safeLabel,
        });
      }
      if (recovery.kind === 'INVARIANT') {
        throw new ConflictException('REVERSAL_INVARIANT');
      }
      throw new ConflictException('REVERSAL_ALREADY_REVERSED_EXTERNALLY');
    }
    if (resolved.kind !== 'TRUSTED') {
      throw new ConflictException('REVERSAL_TARGET_AMBIGUOUS');
    }

    if (
      !transferFingerprintsMatch(
        input.targetFingerprint,
        resolved.target.targetFingerprint,
      )
    ) {
      throw new ConflictException('REVERSAL_TARGET_STALE');
    }

    let result;
    try {
      result = await this.transfers.reverse(context.tenantId, input.targetId, {
        reversalIdempotencyKey: input.reversalIdempotencyKey,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('STALE_TREASURY_TRANSFER_INVARIANT')) {
        throw new ConflictException('REVERSAL_INVARIANT');
      }
      throw err;
    }

    if (result.causality === 'EXTERNAL') {
      throw new ConflictException('REVERSAL_ALREADY_REVERSED_EXTERNALLY');
    }

    const snapshot = resolved.target.targetSnapshot;
    if (snapshot.kind !== 'TREASURY_TRANSFER') {
      throw new ConflictException('REVERSAL_TARGET_NOT_FOUND');
    }
    return this.toResult({
      transferId: input.targetId,
      snapshot: {
        amount: snapshot.amount,
        sourceAccount: snapshot.sourceAccount,
        destinationAccount: snapshot.destinationAccount,
        transferDate: snapshot.transferDate,
      },
      causality: result.causality,
      recovered: result.causality === 'SAME_COMMAND',
      outflowEntryId: result.outflowEntry?.id ?? null,
      inflowEntryId: result.inflowEntry?.id ?? null,
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
    transferId: string;
    snapshot: {
      amount: string;
      sourceAccount: 'CASH' | 'BANK' | 'CESAR';
      destinationAccount: 'CASH' | 'BANK' | 'CESAR';
      transferDate: string | null;
    };
    causality: 'APPLIED' | 'SAME_COMMAND' | 'EXTERNAL';
    recovered: boolean;
    safeLabel?: string;
    outflowEntryId?: string | null;
    inflowEntryId?: string | null;
  }): BusinessActionResult {
    const preview = buildTransferReversalPreview({
      kind: 'TREASURY_TRANSFER',
      amount: args.snapshot.amount,
      currency: 'MXN',
      sourceAccount: args.snapshot.sourceAccount,
      destinationAccount: args.snapshot.destinationAccount,
      transferDate: args.snapshot.transferDate,
      active: false,
      pairComplete: true,
    });
    const sourceLabel = accountLabel(args.snapshot.sourceAccount);
    const destinationLabel = accountLabel(args.snapshot.destinationAccount);

    const affected: BusinessActionResult['affectedEntities'] = [
      {
        type: 'TREASURY_TRANSFER',
        id: idHash(args.transferId),
        effect: args.recovered ? 'REPLAYED' : 'REVERSED',
      } as unknown as import('../../domain/canonical-json').JsonValue,
    ];
    if (args.outflowEntryId) {
      affected.push({
        type: 'TREASURY_ENTRY',
        id: idHash(args.outflowEntryId),
        effect: 'REVERSED',
      } as unknown as import('../../domain/canonical-json').JsonValue);
    }
    if (args.inflowEntryId) {
      affected.push({
        type: 'TREASURY_ENTRY',
        id: idHash(args.inflowEntryId),
        effect: 'REVERSED',
      } as unknown as import('../../domain/canonical-json').JsonValue);
    }

    return {
      actionId: 'REVERSE_TREASURY_TRANSFER',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: affected,
      warnings: [],
      generatedEvents: [],
      receipt: {
        kind: 'TREASURY_TRANSFER_REVERSAL',
        transferId: args.transferId,
        transferIdHash: idHash(args.transferId),
        amount: args.snapshot.amount,
        currency: 'MXN',
        sourceAccount: args.snapshot.sourceAccount,
        destinationAccount: args.snapshot.destinationAccount,
        sourceLabel,
        destinationLabel,
        transferDate: args.snapshot.transferDate,
        liquidityUnchanged: true,
        pnlChanged: false,
        capitalChanged: false,
        capitalUnchanged: true,
        recovered: args.recovered,
        causality: args.causality,
        rollbackPossible: false,
        message: `Revertí la transferencia de $${args.snapshot.amount} MXN.`,
        treasuryNote: `${sourceLabel}\n+$${args.snapshot.amount}\n\n${destinationLabel}\n−$${args.snapshot.amount}\n\nLiquidez total\nSin cambios`,
        targetSafeLabel: args.safeLabel ?? preview.targetSafeLabel,
      } as unknown as JsonValue,
      rollbackPossible: false,
    };
  }
}
