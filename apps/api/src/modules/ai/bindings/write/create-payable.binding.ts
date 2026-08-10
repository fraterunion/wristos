import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccountEntryStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ManualAccountEntryService } from '../../../cuentas/manual-account-entry.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import {
  CreateManualAccountWriteInput,
  asNumber,
  asString,
  createManualAccountInputSchema,
  createPayableIdempotencyKey,
  defaultConcept,
  formatMoney,
  idHash,
  normalizeManualAccountCurrency,
  normalizeOptionalBusinessDate,
} from './create-manual-account.shared';

@Injectable()
export class CreatePayableWriteBinding
  implements WriteCapabilityBindingDefinition<CreateManualAccountWriteInput>
{
  readonly capability = 'CREATE_PAYABLE' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'create_payable_canonical@1.0.0';
  readonly inputSchema = createManualAccountInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly manualAccounts: ManualAccountEntryService,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): CreateManualAccountWriteInput {
    if (step.capability !== 'CREATE_PAYABLE') {
      throw new BadRequestException('Unexpected capability for CREATE_PAYABLE binding');
    }
    const args = step.arguments as Record<string, unknown>;
    const counterpartyName =
      asString(args.counterpartyName) ?? asString(args.counterpartyLabel);
    const amount = asNumber(args.amount) ?? asNumber(args.totalAmount);
    const currency = normalizeManualAccountCurrency(args.currency) ?? 'MXN';
    const clientId =
      asString(args.clientId) ??
      asString(args.selectedClientId) ??
      asString(args.useExistingClientId);

    if (!counterpartyName) {
      throw new BadRequestException('CREATE_PAYABLE requires counterpartyName');
    }
    if (amount === null || amount <= 0) {
      throw new BadRequestException('CREATE_PAYABLE requires a positive amount');
    }

    return {
      counterpartyName,
      concept: asString(args.concept) ?? defaultConcept('PAYABLE'),
      amount,
      currency,
      clientId: clientId ?? null,
      issuedAt: normalizeOptionalBusinessDate(args.issuedAt, 'issuedAt'),
      dueDate: normalizeOptionalBusinessDate(args.dueDate, 'dueDate'),
      notes: asString(args.notes),
      registerIdempotencyKey: createPayableIdempotencyKey(context.actionRunId),
    };
  }

  async execute(
    input: CreateManualAccountWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context);

    if (input.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: context.tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!client) {
        throw new ConflictException('STALE_CREATE_PAYABLE_CLIENT');
      }
    }

    let result;
    try {
      result = await this.manualAccounts.createPayable(context.tenantId, {
        counterpartyName: input.counterpartyName,
        concept: input.concept,
        amount: input.amount,
        currency: input.currency,
        clientId: input.clientId ?? null,
        issuedAt: input.issuedAt ?? null,
        dueDate: input.dueDate ?? null,
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
        if (msg.includes('cancelled/deleted')) {
          throw new ConflictException('STALE_CREATE_PAYABLE_CANCELLED');
        }
        if (msg.includes('conflicting')) {
          throw new ConflictException('CANONICAL_CREATE_PAYABLE_INVARIANT');
        }
        throw error;
      }
      throw error;
    }

    if (result.entry.deletedAt || result.entry.status === AccountEntryStatus.CANCELLED) {
      throw new ConflictException('STALE_CREATE_PAYABLE_CANCELLED');
    }

    if (!result.replayed) {
      const paymentCount = await this.prisma.accountPayment.count({
        where: { tenantId: context.tenantId, entryId: result.entry.id, deletedAt: null },
      });
      if (paymentCount > 0) {
        throw new ConflictException('CANONICAL_CREATE_PAYABLE_INVARIANT');
      }
    }

    const amountStr = result.entry.totalAmount.toFixed(2);
    return {
      actionId: 'CREATE_PAYABLE',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'ACCOUNT_ENTRY',
          id: idHash(result.entry.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
      ],
      generatedEvents: [
        {
          type: result.replayed ? 'PAYABLE_REPLAYED' : 'PAYABLE_CREATED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        kind: 'ACCOUNT_PAYABLE',
        accountEntryId: result.entry.id,
        accountEntryIdHash: idHash(result.entry.id),
        type: 'PAYABLE',
        source: 'MANUAL',
        counterpartyLabel: result.entry.counterpartyName,
        hasClient: Boolean(result.entry.clientId),
        clientId: result.entry.clientId,
        clientIdHash: result.entry.clientId ? idHash(result.entry.clientId) : null,
        concept: result.entry.concept,
        totalAmount: amountStr,
        amount: amountStr,
        currency: result.entry.currency,
        issuedAt: result.entry.issuedAt?.toISOString() ?? null,
        dueDate: result.entry.dueDate?.toISOString() ?? null,
        status: result.entry.status,
        paidTotal: '0.00',
        outstanding: amountStr,
        balance: amountStr,
        treasuryChanged: false,
        pnlChanged: false,
        capitalChanged: false,
        treasury: 'Sin cambio',
        pnl: 'Sin cambio',
        cxpDelta: `+$${formatMoney(amountStr)}`,
        replayed: result.replayed,
        correctionPolicy:
          'Después de crearla, cualquier corrección económica se realiza desde Cuentas (cancela y crea de nuevo).',
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
        'Authenticated tenant membership required for payable creation',
      );
    }
  }
}
