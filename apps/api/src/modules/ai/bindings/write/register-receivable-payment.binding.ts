import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  ReceivablePaymentService,
  ReceivablePaymentDestination,
} from '../../../cuentas/receivable-payment.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';

const destinationSchema = z.enum(['CASH', 'BANK', 'CESAR', 'APPLY_TO_PAYABLE']);

const registerReceivablePaymentInputSchema = z
  .object({
    receivableEntryId: z.string().min(1),
    amount: z.number().positive(),
    destination: destinationSchema,
    payableEntryId: z.string().min(1).optional(),
    paymentDate: z.date().optional(),
    notes: z.string().max(2000).nullable().optional(),
    currency: z.enum(['MXN', 'USD']).optional(),
    registerIdempotencyKey: z.string().min(1),
    customerName: z.string().optional(),
    receivableLabel: z.string().optional(),
    payableLabel: z.string().optional(),
    outstandingAmount: z.number().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.destination === 'APPLY_TO_PAYABLE' && !value.payableEntryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'payableEntryId is required for APPLY_TO_PAYABLE',
        path: ['payableEntryId'],
      });
    }
  });

export type RegisterReceivablePaymentWriteInput = z.infer<
  typeof registerReceivablePaymentInputSchema
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

function destinationLabel(destination: ReceivablePaymentDestination): string {
  if (destination === 'CASH') return 'Efectivo';
  if (destination === 'BANK') return 'Bancos';
  if (destination === 'CESAR') return 'Cuenta César';
  return 'Aplicar a cuenta por pagar';
}

export function registerReceivablePaymentIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

@Injectable()
export class RegisterReceivablePaymentWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterReceivablePaymentWriteInput>
{
  readonly capability = 'REGISTER_RECEIVABLE_PAYMENT' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_receivable_payment_canonical@1.0.0';
  readonly inputSchema = registerReceivablePaymentInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly receivablePayments: ReceivablePaymentService,
  ) {}

  mapInput(
    step: BusinessPlanStep,
    context: WriteExecutionContext,
  ): RegisterReceivablePaymentWriteInput {
    if (step.capability !== 'REGISTER_RECEIVABLE_PAYMENT') {
      throw new BadRequestException(
        'Unexpected capability for REGISTER_RECEIVABLE_PAYMENT binding',
      );
    }
    const args = step.arguments as Record<string, unknown>;
    const receivableEntryId =
      asString(args.receivableEntryId) ?? asString(args.accountId);
    const amount = asNumber(args.amount);
    const destinationRaw = asString(args.destination)?.toUpperCase();
    if (
      destinationRaw !== 'CASH' &&
      destinationRaw !== 'BANK' &&
      destinationRaw !== 'CESAR' &&
      destinationRaw !== 'APPLY_TO_PAYABLE'
    ) {
      throw new BadRequestException(
        'REGISTER_RECEIVABLE_PAYMENT requires destination CASH|BANK|CESAR|APPLY_TO_PAYABLE',
      );
    }
    if (!receivableEntryId || amount === null || amount <= 0) {
      throw new BadRequestException(
        'REGISTER_RECEIVABLE_PAYMENT plan is missing required trusted payment fields',
      );
    }

    const payableEntryId =
      asString(args.payableEntryId) ?? asString(args.payableAccountId) ?? undefined;
    if (destinationRaw === 'APPLY_TO_PAYABLE' && !payableEntryId) {
      throw new BadRequestException(
        'REGISTER_RECEIVABLE_PAYMENT requires payableEntryId for APPLY_TO_PAYABLE',
      );
    }

    const dateRaw = asString(args.date) ?? asString(args.paymentDate) ?? asString(args.effectiveDate);
    const paymentDate = dateRaw ? new Date(dateRaw) : undefined;
    if (paymentDate && Number.isNaN(paymentDate.getTime())) {
      throw new BadRequestException('REGISTER_RECEIVABLE_PAYMENT payment date is invalid');
    }

    const currencyRaw = asString(args.currency)?.toUpperCase();
    const currency =
      currencyRaw === 'MXN' || currencyRaw === 'USD' ? currencyRaw : undefined;

    // Server-owned idempotency — never from LLM / client.
    const registerIdempotencyKey = registerReceivablePaymentIdempotencyKey(
      context.actionRunId,
    );

    return {
      receivableEntryId,
      amount,
      destination: destinationRaw,
      payableEntryId,
      paymentDate,
      notes: asString(args.notes),
      currency,
      registerIdempotencyKey,
      customerName: asString(args.customerName) ?? undefined,
      receivableLabel:
        asString(args.receivableLabel) ?? asString(args.accountLabel) ?? undefined,
      payableLabel: asString(args.payableLabel) ?? undefined,
      outstandingAmount: asNumber(args.outstandingAmount) ?? undefined,
    };
  }

  async execute(
    input: RegisterReceivablePaymentWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context);
    await this.assertFreshEntities(input, context);

    const result = await this.receivablePayments.register(context.tenantId, {
      receivableEntryId: input.receivableEntryId,
      amount: input.amount,
      destination: input.destination,
      payableEntryId: input.payableEntryId,
      paymentDate: input.paymentDate,
      notes: input.notes ?? null,
      currency: input.currency as Currency | undefined,
      registerIdempotencyKey: input.registerIdempotencyKey,
      actorUserId: context.userId,
    });

    const remainingReceivable = await this.computeOutstanding(
      context.tenantId,
      result.receivableEntry.id,
      result.receivableEntry.totalAmount,
      result.receivableEntry.dealId,
    );

    if (input.destination === 'APPLY_TO_PAYABLE') {
      const remainingPayable = result.payableEntry
        ? await this.computeOutstanding(
            context.tenantId,
            result.payableEntry.id,
            result.payableEntry.totalAmount,
            null,
          )
        : new Prisma.Decimal(0);

      return {
        actionId: 'REGISTER_RECEIVABLE_PAYMENT',
        executionState: 'EXECUTED',
        success: true,
        affectedEntities: [
          {
            type: 'RECEIVABLE_ENTRY',
            id: idHash(result.receivableEntry.id),
            effect: result.replayed ? 'REPLAYED' : 'UPDATED',
          },
          {
            type: 'PAYABLE_ENTRY',
            id: idHash(result.payableEntry!.id),
            effect: result.replayed ? 'REPLAYED' : 'UPDATED',
          },
          {
            type: 'ACCOUNT_SETTLEMENT',
            id: idHash(result.settlement!.id),
            effect: result.replayed ? 'REPLAYED' : 'CREATED',
          },
          {
            type: 'ACCOUNT_PAYMENT',
            id: idHash(result.receivablePayment.id),
            effect: result.replayed ? 'REPLAYED' : 'CREATED',
          },
          {
            type: 'ACCOUNT_PAYMENT',
            id: idHash(result.payablePayment!.id),
            effect: result.replayed ? 'REPLAYED' : 'CREATED',
          },
        ],
        generatedEvents: [
          {
            type: result.replayed
              ? 'RECEIVABLE_PAYMENT_REPLAYED'
              : 'RECEIVABLE_PAYMENT_SETTLED',
            at: new Date().toISOString(),
          },
        ],
        receipt: {
          kind: 'SETTLEMENT',
          paymentId: result.receivablePayment.id,
          payablePaymentId: result.payablePayment!.id,
          settlementId: result.settlement!.id,
          receivableEntryId: result.receivableEntry.id,
          payableEntryId: result.payableEntry!.id,
          amount: result.receivablePayment.amount.toFixed(2),
          currency: result.receivablePayment.currency,
          destination: 'APPLY_TO_PAYABLE',
          destinationLabel: destinationLabel('APPLY_TO_PAYABLE'),
          remainingReceivable: remainingReceivable.toFixed(2),
          remainingPayable: remainingPayable.toFixed(2),
          liquidityChanged: false,
          customerName: input.customerName ?? result.receivableEntry.counterpartyName,
          receivableLabel: input.receivableLabel ?? result.receivableEntry.concept,
          payableLabel: input.payableLabel ?? result.payableEntry!.counterpartyName,
          paymentDate: result.receivablePayment.paidAt.toISOString(),
          replayed: result.replayed,
          correctionPolicy: 'Después de registrarlo, cualquier corrección se realiza desde Cuentas.',
        } as JsonValue,
        warnings: [],
        rollbackPossible: false,
      };
    }

    return {
      actionId: 'REGISTER_RECEIVABLE_PAYMENT',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        {
          type: 'RECEIVABLE_ENTRY',
          id: idHash(result.receivableEntry.id),
          effect: result.replayed ? 'REPLAYED' : 'UPDATED',
        },
        {
          type: 'ACCOUNT_PAYMENT',
          id: idHash(result.receivablePayment.id),
          effect: result.replayed ? 'REPLAYED' : 'CREATED',
        },
        ...(result.treasuryEntry
          ? [
              {
                type: 'TREASURY_ENTRY',
                id: idHash(result.treasuryEntry.id),
                effect: result.replayed ? 'REPLAYED' : 'CREATED',
              },
            ]
          : []),
      ],
      generatedEvents: [
        {
          type: result.replayed
            ? 'RECEIVABLE_PAYMENT_REPLAYED'
            : 'RECEIVABLE_PAYMENT_REGISTERED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        kind: 'RECEIVED_MONEY',
        paymentId: result.receivablePayment.id,
        receivableEntryId: result.receivableEntry.id,
        amount: result.receivablePayment.amount.toFixed(2),
        currency: result.receivablePayment.currency,
        destination: input.destination,
        destinationLabel: destinationLabel(input.destination),
        remainingReceivable: remainingReceivable.toFixed(2),
        treasuryEntryId: result.treasuryEntry?.id ?? null,
        customerName: input.customerName ?? result.receivableEntry.counterpartyName,
        receivableLabel: input.receivableLabel ?? result.receivableEntry.concept,
        paymentDate: result.receivablePayment.paidAt.toISOString(),
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
        'Authenticated tenant membership required for receivable payment execution',
      );
    }
  }

  private async assertFreshEntities(
    input: RegisterReceivablePaymentWriteInput,
    context: WriteExecutionContext,
  ) {
    const entry = await this.prisma.accountEntry.findFirst({
      where: {
        id: input.receivableEntryId,
        tenantId: context.tenantId,
        deletedAt: null,
      },
      include: { payments: { where: { deletedAt: null } } },
    });
    if (!entry || entry.type !== AccountEntryType.RECEIVABLE) {
      throw new ConflictException('STALE_RECEIVABLE_MISSING');
    }
    if (
      entry.status === AccountEntryStatus.CANCELLED ||
      entry.status === AccountEntryStatus.PAID
    ) {
      // Idempotent replay may re-confirm after this payment already closed the CXC.
      const existing = await this.prisma.accountPayment.findFirst({
        where: {
          tenantId: context.tenantId,
          registerIdempotencyKey: input.registerIdempotencyKey,
          deletedAt: null,
        },
        select: { id: true },
      });
      const existingSettlement =
        input.destination === 'APPLY_TO_PAYABLE'
          ? await this.prisma.accountSettlement.findFirst({
              where: {
                tenantId: context.tenantId,
                idempotencyKey: input.registerIdempotencyKey,
                deletedAt: null,
              },
              select: { id: true },
            })
          : null;
      if (!existing && !existingSettlement) {
        throw new ConflictException('STALE_RECEIVABLE_NOT_PAYABLE');
      }
      return;
    }

    if (input.currency && input.currency !== entry.currency) {
      throw new ConflictException('STALE_RECEIVABLE_CURRENCY');
    }

    const outstanding = await this.computeOutstanding(
      context.tenantId,
      entry.id,
      entry.totalAmount,
      entry.dealId,
    );
    // Already committed under this key → allow.
    const existingPayment = await this.prisma.accountPayment.findFirst({
      where: {
        tenantId: context.tenantId,
        registerIdempotencyKey: input.registerIdempotencyKey,
        deletedAt: null,
      },
      select: { id: true },
    });
    const existingSettlement =
      input.destination === 'APPLY_TO_PAYABLE'
        ? await this.prisma.accountSettlement.findFirst({
            where: {
              tenantId: context.tenantId,
              idempotencyKey: input.registerIdempotencyKey,
              deletedAt: null,
            },
            select: { id: true },
          })
        : null;
    if (!existingPayment && !existingSettlement && outstanding.lessThan(input.amount)) {
      throw new ConflictException('STALE_RECEIVABLE_OUTSTANDING');
    }

    if (input.destination === 'APPLY_TO_PAYABLE') {
      const payable = await this.prisma.accountEntry.findFirst({
        where: {
          id: input.payableEntryId!,
          tenantId: context.tenantId,
          deletedAt: null,
        },
        include: { payments: { where: { deletedAt: null } } },
      });
      if (!payable || payable.type !== AccountEntryType.PAYABLE) {
        throw new ConflictException('STALE_PAYABLE_MISSING');
      }
      if (
        payable.status === AccountEntryStatus.CANCELLED ||
        payable.status === AccountEntryStatus.PAID
      ) {
        if (!existingSettlement) {
          throw new ConflictException('STALE_PAYABLE_NOT_PAYABLE');
        }
        return;
      }
      if (payable.currency !== entry.currency) {
        throw new ConflictException('STALE_CURRENCY_MISMATCH');
      }
      const payableOutstanding = payable.totalAmount.minus(
        payable.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0)),
      );
      if (!existingSettlement && payableOutstanding.lessThan(input.amount)) {
        throw new ConflictException('STALE_PAYABLE_OUTSTANDING');
      }
    }
  }

  private async computeOutstanding(
    tenantId: string,
    entryId: string,
    totalAmount: Prisma.Decimal,
    dealId: string | null,
  ): Promise<Prisma.Decimal> {
    const accountAgg = await this.prisma.accountPayment.aggregate({
      where: { tenantId, entryId, deletedAt: null },
      _sum: { amount: true },
    });
    let paid = accountAgg._sum.amount ?? new Prisma.Decimal(0);
    if (dealId) {
      const dealAgg = await this.prisma.payment.aggregate({
        where: {
          tenantId,
          dealId,
          status: PaymentStatus.PAID,
          deletedAt: null,
        },
        _sum: { amount: true },
      });
      paid = paid.plus(dealAgg._sum.amount ?? new Prisma.Decimal(0));
    }
    const remaining = totalAmount.minus(paid);
    return remaining.lessThan(0) ? new Prisma.Decimal(0) : remaining;
  }
}
