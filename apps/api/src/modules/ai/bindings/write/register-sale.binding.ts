import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WatchStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  RegisterSaleCanonicalInput,
  SaleRegistrationService,
} from '../../../deals/sale-registration.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';

const destinationSchema = z.enum(['CASH', 'BANCOS', 'CESAR']);
const bankChannelSchema = z.enum(['JOSE', 'MAYTE']);
const paymentModeSchema = z.enum(['PAID', 'CREDIT', 'PARTIAL']);

const registerSaleInputSchema = z.object({
  watchId: z.string().min(1),
  clientId: z.string().min(1),
  agreedPrice: z.number().positive(),
  currency: z.enum(['MXN', 'USD']),
  soldAt: z.date().optional(),
  notes: z.string().max(2000).nullable().optional(),
  paymentMode: paymentModeSchema,
  amountReceived: z.number().nonnegative().optional(),
  destination: destinationSchema.optional(),
  bankChannel: bankChannelSchema.optional(),
  registerIdempotencyKey: z.string().min(1),
  watchLabel: z.string().optional(),
  customerName: z.string().optional(),
});

export type RegisterSaleWriteInput = z.infer<typeof registerSaleInputSchema>;

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

function resolvePaymentMode(
  args: Record<string, unknown>,
  agreedPrice: number,
): 'PAID' | 'CREDIT' | 'PARTIAL' {
  const explicit = asString(args.paymentMode);
  if (explicit === 'PAID' || explicit === 'CREDIT' || explicit === 'PARTIAL') {
    return explicit;
  }
  const received = asNumber(args.amountReceived);
  if (received === null || received <= 0) return 'CREDIT';
  if (received + 0.001 >= agreedPrice) return 'PAID';
  return 'PARTIAL';
}

@Injectable()
export class RegisterSaleWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterSaleWriteInput>
{
  readonly capability = 'REGISTER_SALE' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_sale_canonical@1.0.0';
  readonly inputSchema = registerSaleInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly saleRegistration: SaleRegistrationService,
  ) {}

  mapInput(step: BusinessPlanStep, context: WriteExecutionContext): RegisterSaleWriteInput {
    if (step.capability !== 'REGISTER_SALE') {
      throw new BadRequestException('Unexpected capability for REGISTER_SALE binding');
    }
    const args = step.arguments as Record<string, unknown>;
    const watchId = asString(args.watchId);
    const clientId = asString(args.customerId) ?? asString(args.clientId);
    const price = asNumber(args.price) ?? asNumber(args.agreedPrice);
    const currencyRaw = asString(args.currency)?.toUpperCase();
    if (!watchId || !clientId || price === null || (currencyRaw !== 'MXN' && currencyRaw !== 'USD')) {
      throw new BadRequestException('REGISTER_SALE plan is missing required trusted sale fields');
    }

    const paymentMode = resolvePaymentMode(args, price);
    const amountReceived =
      paymentMode === 'CREDIT'
        ? undefined
        : asNumber(args.amountReceived) ?? (paymentMode === 'PAID' ? price : null);
    if (paymentMode !== 'CREDIT' && (amountReceived == null || amountReceived <= 0)) {
      throw new BadRequestException('REGISTER_SALE requires amountReceived for PAID/PARTIAL');
    }

    const destination =
      paymentMode === 'CREDIT'
        ? undefined
        : (asString(args.destination) as 'CASH' | 'BANCOS' | 'CESAR' | null) ??
          (asString(args.paymentMethod) as 'CASH' | 'BANCOS' | 'CESAR' | null) ??
          undefined;
    if (paymentMode !== 'CREDIT' && !destination) {
      throw new BadRequestException('REGISTER_SALE requires destination for PAID/PARTIAL');
    }

    const bankChannel =
      destination === 'BANCOS'
        ? ((asString(args.bankChannel) as 'JOSE' | 'MAYTE' | null) ?? undefined)
        : undefined;
    if (destination === 'BANCOS' && !bankChannel) {
      throw new BadRequestException('REGISTER_SALE requires bankChannel when destination is BANCOS');
    }

    const dateRaw = asString(args.date) ?? asString(args.soldAt);
    const soldAt = dateRaw ? new Date(dateRaw) : undefined;
    if (soldAt && Number.isNaN(soldAt.getTime())) {
      throw new BadRequestException('REGISTER_SALE effective date is invalid');
    }

    // Server-owned idempotency — never from LLM / client.
    const registerIdempotencyKey = `ai-action-run:${context.actionRunId}`;

    return {
      watchId,
      clientId,
      agreedPrice: price,
      currency: currencyRaw,
      soldAt,
      notes: asString(args.notes),
      paymentMode,
      amountReceived: amountReceived ?? undefined,
      destination,
      bankChannel,
      registerIdempotencyKey,
      watchLabel: asString(args.watchLabel) ?? undefined,
      customerName: asString(args.customerName) ?? undefined,
    };
  }

  async execute(
    input: RegisterSaleWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context);
    await this.assertFreshEntities(input, context);

    const canonical: RegisterSaleCanonicalInput = {
      watchId: input.watchId,
      clientId: input.clientId,
      agreedPrice: input.agreedPrice,
      currency: input.currency,
      soldAt: input.soldAt,
      notes: input.notes ?? null,
      registerIdempotencyKey: input.registerIdempotencyKey,
      payment:
        input.paymentMode === 'CREDIT'
          ? null
          : {
              amountReceived: input.amountReceived,
              method: input.destination!,
              bankChannel: input.bankChannel ?? null,
              paidAt: input.soldAt ?? null,
            },
    };

    const result = await this.saleRegistration.register(context.tenantId, canonical);
    const watchLabel =
      input.watchLabel ??
      (await this.prisma.watch.findFirst({
        where: { id: input.watchId, tenantId: context.tenantId },
        select: { brand: true, model: true },
      }).then((w) => (w ? `${w.brand ?? ''} ${w.model ?? ''}`.trim() : input.watchId)));

    const amountReceived =
      result.payment?.amount.toString() ??
      (input.paymentMode === 'CREDIT' ? '0.00' : String(input.amountReceived ?? 0));

    return {
      actionId: 'REGISTER_SALE',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: [
        { type: 'WATCH', id: idHash(input.watchId), effect: 'SOLD' },
        { type: 'DEAL', id: idHash(result.deal.id), effect: result.replayed ? 'REPLAYED' : 'CREATED' },
      ],
      generatedEvents: [
        {
          type: result.replayed ? 'SALE_REGISTRATION_REPLAYED' : 'SALE_REGISTERED',
          at: new Date().toISOString(),
        },
      ],
      receipt: {
        dealId: result.deal.id,
        watchLabel: watchLabel ?? null,
        customerName: input.customerName ?? null,
        amount: result.canonicalMxn.toFixed(2),
        currency: input.currency,
        paymentMode: input.paymentMode,
        amountReceived,
        destination: input.destination ?? null,
        bankChannel: input.bankChannel ?? null,
        bankFee: result.bankFeeAmount.greaterThan(0) ? result.bankFeeAmount.toFixed(2) : null,
        remainingReceivable: result.pendingAmount.toFixed(2),
        computedStatus: result.computedStatus,
        effectiveDate: (result.deal.soldAt ?? result.deal.createdAt).toISOString(),
        replayed: result.replayed,
        correctionPolicy:
          'Después de registrarla, cualquier corrección se realiza desde Ventas.',
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
      throw new ForbiddenException('Authenticated tenant membership required for sale execution');
    }
  }

  private async assertFreshEntities(
    input: RegisterSaleWriteInput,
    context: WriteExecutionContext,
  ) {
    const watch = await this.prisma.watch.findFirst({
      where: { id: input.watchId, tenantId: context.tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!watch) {
      throw new ConflictException('STALE_WATCH_MISSING');
    }
    // Idempotent replay may re-confirm after watch is already SOLD by this sale.
    if (watch.status === WatchStatus.SOLD) {
      const existing = await this.prisma.deal.findFirst({
        where: {
          tenantId: context.tenantId,
          registerIdempotencyKey: input.registerIdempotencyKey,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new ConflictException('STALE_WATCH_SOLD');
      }
    } else if (
      watch.status !== WatchStatus.AVAILABLE &&
      watch.status !== WatchStatus.RESERVED
    ) {
      throw new ConflictException('STALE_WATCH_NOT_SELLABLE');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: context.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!client) {
      throw new ConflictException('STALE_CUSTOMER_MISSING');
    }
  }
}
