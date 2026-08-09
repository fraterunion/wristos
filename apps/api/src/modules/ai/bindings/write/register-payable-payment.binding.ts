import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  PayablePaymentService,
  PayablePaymentSourceAccount,
} from '../../../cuentas/payable-payment.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';

const sourceAccountSchema = z.enum(['CASH', 'BANK', 'CESAR']);

const registerPayablePaymentInputSchema = z.object({
  payableEntryId: z.string().min(1),
  amount: z.number().positive(),
  sourceAccount: sourceAccountSchema,
  paymentDate: z.date().optional(),
  notes: z.string().max(2000).nullable().optional(),
  currency: z.enum(['MXN', 'USD']).optional(),
  exchangeRateUsed: z.number().positive().optional(),
  registerIdempotencyKey: z.string().min(1),
  counterpartyLabel: z.string().optional(),
  payableLabel: z.string().optional(),
  outstandingAmount: z.number().nonnegative().optional(),
});

export type RegisterPayablePaymentWriteInput = z.infer<
  typeof registerPayablePaymentInputSchema
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

function sourceLabel(source: PayablePaymentSourceAccount): string {
  if (source === 'CASH') return 'Efectivo';
  if (source === 'BANK') return 'Bancos';
  return 'Cuenta César';
}

export function registerPayablePaymentIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

@Injectable()
export class RegisterPayablePaymentWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterPayablePaymentWriteInput>
{
  readonly capability = 'REGISTER_PAYABLE_PAYMENT' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_payable_payment_canonical@1.0.0';
  readonly inputSchema = registerPayablePaymentInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payablePayments: PayablePaymentService,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): RegisterPayablePaymentWriteInput {
    if (step.capability !== 'REGISTER_PAYABLE_PAYMENT') {
      throw new BadRequestException(
        'Unexpected capability for REGISTER_PAYABLE_PAYMENT binding',
      );
    }
    const args = step.arguments as Record<string, unknown>;
    const payableEntryId =
      asString(args.payableEntryId) ??
      asString(args.accountId) ??
      asString(args.payableAccountId);
    const amount = asNumber(args.amount);
    const sourceRaw =
      asString(args.sourceAccount)?.toUpperCase() ??
      asString(args.destination)?.toUpperCase();
    if (sourceRaw !== 'CASH' && sourceRaw !== 'BANK' && sourceRaw !== 'CESAR') {
      throw new BadRequestException(
        'REGISTER_PAYABLE_PAYMENT requires sourceAccount CASH|BANK|CESAR',
      );
    }
    if (!payableEntryId || amount === null || amount <= 0) {
      throw new BadRequestException(
        'REGISTER_PAYABLE_PAYMENT plan is missing required trusted payment fields',
      );
    }

    const dateRaw =
      asString(args.date) ?? asString(args.paymentDate) ?? asString(args.effectiveDate);
    const paymentDate = dateRaw ? new Date(dateRaw) : undefined;
    if (paymentDate && Number.isNaN(paymentDate.getTime())) {
      throw new BadRequestException('REGISTER_PAYABLE_PAYMENT payment date is invalid');
    }

    const currencyRaw = asString(args.currency)?.toUpperCase();
    const currency =
      currencyRaw === 'MXN' || currencyRaw === 'USD' ? currencyRaw : undefined;
    const exchangeRateUsed = asNumber(args.exchangeRateUsed) ?? undefined;

    // Server-owned idempotency — never from LLM / client.
    const registerIdempotencyKey = registerPayablePaymentIdempotencyKey(
      context.actionRunId,
    );

    return {
      payableEntryId,
      amount,
      sourceAccount: sourceRaw,
      paymentDate,
      notes: asString(args.notes),
      currency,
      exchangeRateUsed: exchangeRateUsed ?? undefined,
      registerIdempotencyKey,
      counterpartyLabel:
        asString(args.counterpartyLabel) ??
        asString(args.customerName) ??
        asString(args.supplierName) ??
        undefined,
      payableLabel:
        asString(args.payableLabel) ?? asString(args.accountLabel) ?? undefined,
      outstandingAmount: asNumber(args.outstandingAmount) ?? undefined,
    };
  }

  async execute(
    input: RegisterPayablePaymentWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context);
    const previousOutstanding = await this.assertFreshEntities(input, context);

    const result = await this.payablePayments.register(context.tenantId, {
      payableEntryId: input.payableEntryId,
      amount: input.amount,
      sourceAccount: input.sourceAccount,
      paymentDate: input.paymentDate,
      notes: input.notes ?? null,
      currency: input.currency as Currency | undefined,
      exchangeRateUsed: input.exchangeRateUsed,
      registerIdempotencyKey: input.registerIdempotencyKey,
      actorUserId: context.userId,
    });

    // Reversed-before-recovery: marker exists but soft-deleted → do not claim success.
    if (result.payablePayment.deletedAt) {
      throw new ConflictException('STALE_PAYABLE_PAYMENT_REVERSED');
    }
    if (!result.treasuryEntry || result.treasuryEntry.deletedAt) {
      throw new ConflictException('STALE_PAYABLE_PAYMENT_MISSING_TREASURY');
    }

    const remaining = result.remainingOutstanding;
    const status = result.payableEntry.status;

    return {
      actionId: 'REGISTER_PAYABLE_PAYMENT',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'PAYABLE_ENTRY',
          id: idHash(result.payableEntry.id),
          effect: result.replayed ? 'REPLAYED' : 'UPDATED',
        },
        {
          type: 'ACCOUNT_PAYMENT',
          id: idHash(result.payablePayment.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
        {
          type: 'TREASURY_ENTRY',
          id: idHash(result.treasuryEntry.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
      ],
      generatedEvents: [
        {
          type: result.replayed
            ? 'PAYABLE_PAYMENT_REPLAYED'
            : 'PAYABLE_PAYMENT_REGISTERED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        kind: 'PAYABLE_CASH_PAYMENT',
        paymentId: result.payablePayment.id,
        payableEntryId: result.payableEntry.id,
        amount: result.payablePayment.amount.toFixed(2),
        currency: result.payablePayment.currency,
        sourceAccount: input.sourceAccount,
        sourceAccountLabel: sourceLabel(input.sourceAccount),
        previousOutstanding: previousOutstanding.toFixed(2),
        remainingOutstanding: remaining.toFixed(2),
        status,
        treasuryEntryId: result.treasuryEntry.id,
        counterpartyLabel:
          input.counterpartyLabel ?? result.payableEntry.counterpartyName,
        payableLabel: input.payableLabel ?? result.payableEntry.concept,
        paymentDate: result.payablePayment.paidAt.toISOString(),
        replayed: result.replayed,
        correctionPolicy: 'Después de registrarlo, cualquier corrección se realiza desde Cuentas.',
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
        'Authenticated tenant membership required for payable payment execution',
      );
    }
  }

  private async assertFreshEntities(
    input: RegisterPayablePaymentWriteInput,
    context: WriteExecutionContext,
  ): Promise<Prisma.Decimal> {
    const existing = await this.prisma.accountPayment.findFirst({
      where: {
        tenantId: context.tenantId,
        registerIdempotencyKey: input.registerIdempotencyKey,
      },
    });
    if (existing?.deletedAt) {
      throw new ConflictException('STALE_PAYABLE_PAYMENT_REVERSED');
    }

    const entry = await this.prisma.accountEntry.findFirst({
      where: {
        id: input.payableEntryId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      include: { payments: { where: { deletedAt: null } } },
    });
    if (!entry || entry.type !== AccountEntryType.PAYABLE) {
      throw new ConflictException('STALE_PAYABLE_MISSING');
    }
    if (
      entry.source !== AccountEntrySource.MANUAL &&
      entry.source !== AccountEntrySource.PURCHASE_AUTO
    ) {
      throw new ConflictException('STALE_PAYABLE_SOURCE');
    }
    if (entry.dealId !== null) {
      throw new ConflictException('STALE_PAYABLE_DEAL_LINKED');
    }

    if (
      entry.status === AccountEntryStatus.CANCELLED ||
      entry.status === AccountEntryStatus.PAID
    ) {
      if (!existing || existing.deletedAt) {
        throw new ConflictException('STALE_PAYABLE_NOT_PAYABLE');
      }
      const paid = entry.payments.reduce(
        (s, p) => s.plus(p.amount),
        new Prisma.Decimal(0),
      );
      return entry.totalAmount.minus(paid).plus(existing.amount);
    }

    if (input.currency && input.currency !== entry.currency) {
      throw new ConflictException('STALE_PAYABLE_CURRENCY');
    }
    if (entry.currency === Currency.USD) {
      if (
        input.exchangeRateUsed === undefined &&
        !existing
      ) {
        throw new ConflictException('STALE_PAYABLE_EXCHANGE_RATE');
      }
    }

    const paid = entry.payments.reduce(
      (s, p) => s.plus(p.amount),
      new Prisma.Decimal(0),
    );
    const outstanding = entry.totalAmount.minus(paid);
    if (!existing && outstanding.lessThan(input.amount)) {
      throw new ConflictException('STALE_PAYABLE_OUTSTANDING');
    }
    return outstanding.lessThan(0) ? new Prisma.Decimal(0) : outstanding;
  }
}
