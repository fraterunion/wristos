import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, WatchStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PurchaseRegistrationService } from '../../../inventory/purchase-registration.service';
import { inventoryPurchaseOutflowProvenanceKey } from '../../../treasury/treasury.service';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionResult, BusinessPlanStep } from '../../planner/planner.types';
import {
  WriteCapabilityBindingDefinition,
  WriteExecutionContext,
} from './write-capability-binding-definition';
import {
  PURCHASE_PAYMENT_MODE_LABELS,
  PURCHASE_SOURCE_LABELS,
  PURCHASE_STATUS_LABELS,
  resolvePurchasePaymentMode,
  resolvePurchaseSource,
} from './purchase-entity-enricher';

const sourceSchema = z.enum(['CASH', 'BANK', 'CESAR']);
const paymentModeSchema = z.enum(['PAID', 'CREDIT', 'PARTIAL']);
const statusSchema = z.enum(['AVAILABLE', 'IN_TRANSIT']);

const registerPurchaseInputSchema = z.object({
  brand: z.string().trim().min(1),
  model: z.string().trim().min(1),
  condition: z.string().trim().min(1),
  reference: z.string().trim().min(1).nullable().optional(),
  serialNumber: z.string().trim().min(1).nullable().optional(),
  purchaseAmount: z.number().positive(),
  currency: z.enum(['MXN', 'USD']),
  acquisitionDate: z.date(),
  paymentMode: paymentModeSchema,
  sourceAccount: sourceSchema.nullable().optional(),
  initialPaymentAmount: z.number().positive().nullable().optional(),
  sellerClientId: z.string().trim().min(1).nullable().optional(),
  sellerCounterpartyName: z.string().trim().min(1).nullable().optional(),
  status: statusSchema,
  priceMin: z.number().min(0),
  priceMax: z.number().min(0),
  registerIdempotencyKey: z.string().min(1),
});

export type RegisterPurchaseWriteInput = z.infer<typeof registerPurchaseInputSchema>;

function idHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseAcquisitionDate(value: unknown): Date | null {
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

export function registerPurchaseIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

@Injectable()
export class RegisterPurchaseWriteBinding
  implements WriteCapabilityBindingDefinition<RegisterPurchaseWriteInput>
{
  readonly capability = 'REGISTER_PURCHASE' as const;
  readonly version = '1.0.0';
  readonly mode = 'WRITE' as const;
  readonly bindingName = 'register_purchase_canonical@1.0.0';
  readonly inputSchema = registerPurchaseInputSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchaseRegistrationService,
  ) {}

  mapInput(step: BusinessPlanStep, context: WriteExecutionContext): RegisterPurchaseWriteInput {
    if (step.capability !== 'REGISTER_PURCHASE') {
      throw new BadRequestException('Unexpected capability for REGISTER_PURCHASE binding');
    }
    const args = step.arguments as Record<string, unknown>;

    const brand = asString(args.brand);
    const model = asString(args.model);
    if (!brand || !model) {
      throw new BadRequestException('REGISTER_PURCHASE requires brand and model');
    }

    const purchaseAmount =
      asNumber(args.purchaseAmount) ?? asNumber(args.cost) ?? asNumber(args.amount);
    if (purchaseAmount == null || purchaseAmount <= 0) {
      throw new BadRequestException('REGISTER_PURCHASE requires a positive purchase cost');
    }

    const currencyRaw = (asString(args.currency) ?? 'MXN').toUpperCase();
    if (currencyRaw !== 'MXN' && currencyRaw !== 'USD') {
      throw new BadRequestException('REGISTER_PURCHASE supports MXN or USD only');
    }

    const paymentMode =
      resolvePurchasePaymentMode(args.paymentMode) ??
      resolvePurchasePaymentMode(args.payment);
    if (!paymentMode) {
      throw new BadRequestException(
        'REGISTER_PURCHASE requires paymentMode PAID|CREDIT|PARTIAL',
      );
    }

    let sourceAccount =
      resolvePurchaseSource(args.sourceAccount) ??
      resolvePurchaseSource(args.source) ??
      null;
    if (paymentMode === 'CREDIT') {
      sourceAccount = null;
    } else if (!sourceAccount) {
      throw new BadRequestException(
        'REGISTER_PURCHASE PAID/PARTIAL requires sourceAccount CASH|BANK|CESAR',
      );
    }

    const initialPaymentAmount =
      paymentMode === 'PARTIAL'
        ? asNumber(args.initialPaymentAmount) ??
          asNumber(args.amountPaid) ??
          asNumber(args.paidAmount)
        : null;
    if (paymentMode === 'PARTIAL') {
      if (initialPaymentAmount == null || initialPaymentAmount <= 0) {
        throw new BadRequestException(
          'REGISTER_PURCHASE PARTIAL requires initialPaymentAmount > 0',
        );
      }
      if (initialPaymentAmount >= purchaseAmount) {
        throw new BadRequestException(
          'PARTIAL initialPaymentAmount must be less than purchase cost (use PAID for full)',
        );
      }
    }

    const acquisitionDate =
      parseAcquisitionDate(args.acquiredAt) ??
      parseAcquisitionDate(args.acquisitionDate) ??
      parseAcquisitionDate(args.date) ??
      parseAcquisitionDate(args.effectiveDate);
    if (!acquisitionDate) {
      throw new BadRequestException('REGISTER_PURCHASE requires acquisitionDate');
    }

    const sellerClientId = asString(args.sellerClientId);
    const sellerCounterpartyName =
      asString(args.sellerCounterpartyName) ??
      asString(args.sellerName) ??
      asString(args.supplierQuery);
    if (
      (paymentMode === 'CREDIT' || paymentMode === 'PARTIAL') &&
      !sellerClientId &&
      !sellerCounterpartyName
    ) {
      throw new BadRequestException(
        'CREDIT/PARTIAL purchase requires sellerClientId or sellerCounterpartyName',
      );
    }

    const statusRaw = (asString(args.status) ?? 'AVAILABLE').toUpperCase();
    const status = statusRaw === 'IN_TRANSIT' ? 'IN_TRANSIT' : 'AVAILABLE';

    const serialNumber = asString(args.serialNumber) ?? asString(args.serial);
    const reference = asString(args.reference);
    const condition = asString(args.condition) ?? 'Bueno';

    const priceMin = asNumber(args.priceMin) ?? 0;
    const priceMax = asNumber(args.priceMax) ?? 0;

    return registerPurchaseInputSchema.parse({
      brand,
      model,
      condition,
      reference: reference ?? null,
      serialNumber: serialNumber ?? null,
      purchaseAmount,
      currency: currencyRaw as 'MXN' | 'USD',
      acquisitionDate,
      paymentMode,
      sourceAccount,
      initialPaymentAmount: initialPaymentAmount ?? null,
      sellerClientId: sellerClientId ?? null,
      sellerCounterpartyName: sellerCounterpartyName ?? null,
      status,
      priceMin,
      priceMax,
      registerIdempotencyKey: registerPurchaseIdempotencyKey(context.actionRunId),
    });
  }

  async execute(
    input: RegisterPurchaseWriteInput,
    context: WriteExecutionContext,
  ): Promise<BusinessActionResult> {
    await this.assertMembership(context.tenantId, context.userId);
    await this.assertFreshness(context.tenantId, input);

    const result = await this.purchases.register(context.tenantId, {
      watch: {
        brand: input.brand,
        model: input.model,
        reference: input.reference,
        serialNumber: input.serialNumber,
        condition: input.condition,
        priceMin: input.priceMin,
        priceMax: input.priceMax,
        status: input.status as WatchStatus,
      },
      purchaseAmount: input.purchaseAmount,
      currency: input.currency,
      acquisitionDate: input.acquisitionDate,
      paymentMode: input.paymentMode,
      sourceAccount: input.sourceAccount,
      initialPaymentAmount: input.initialPaymentAmount,
      sellerClientId: input.sellerClientId,
      sellerCounterpartyName: input.sellerCounterpartyName,
      registerIdempotencyKey: input.registerIdempotencyKey,
    });

    this.assertCompleteState(result);

    return this.toResult(result, input);
  }

  private assertCompleteState(result: {
    paymentMode: string;
    treasuryEntry: { id: string; deletedAt: Date | null; provenanceKey: string | null } | null;
    payableEntry: { id: string; deletedAt: Date | null } | null;
    watch: { id: string };
    purchaseAmountMxn: string;
    amountPaidMxn: string;
    outstandingMxn: string;
  }) {
    const paid = new Prisma.Decimal(result.amountPaidMxn);
    const outstanding = new Prisma.Decimal(result.outstandingMxn);
    const cost = new Prisma.Decimal(result.purchaseAmountMxn);
    if (!paid.plus(outstanding).equals(cost)) {
      throw new ConflictException(
        'CANONICAL_PURCHASE_INVARIANT: paid + outstanding ≠ purchase cost',
      );
    }

    if (result.paymentMode === 'PAID') {
      const expected = inventoryPurchaseOutflowProvenanceKey(result.watch.id);
      if (
        !result.treasuryEntry ||
        result.treasuryEntry.deletedAt ||
        result.treasuryEntry.provenanceKey !== expected
      ) {
        throw new ConflictException(
          'CANONICAL_PURCHASE_INVARIANT: PAID purchase missing Treasury OUTFLOW',
        );
      }
      if (result.payableEntry && !result.payableEntry.deletedAt) {
        throw new ConflictException(
          'CANONICAL_PURCHASE_INVARIANT: PAID purchase must not have PURCHASE_AUTO payable',
        );
      }
    } else if (result.paymentMode === 'CREDIT') {
      if (result.treasuryEntry && !result.treasuryEntry.deletedAt) {
        throw new ConflictException(
          'CANONICAL_PURCHASE_INVARIANT: CREDIT purchase must not have Treasury OUTFLOW',
        );
      }
      if (!result.payableEntry || result.payableEntry.deletedAt) {
        throw new ConflictException(
          'CANONICAL_PURCHASE_INVARIANT: CREDIT purchase missing PURCHASE_AUTO payable',
        );
      }
    } else if (result.paymentMode === 'PARTIAL') {
      const expected = inventoryPurchaseOutflowProvenanceKey(result.watch.id);
      if (
        !result.treasuryEntry ||
        result.treasuryEntry.deletedAt ||
        result.treasuryEntry.provenanceKey !== expected
      ) {
        throw new ConflictException(
          'CANONICAL_PURCHASE_INVARIANT: PARTIAL purchase missing Treasury OUTFLOW',
        );
      }
      if (!result.payableEntry || result.payableEntry.deletedAt) {
        throw new ConflictException(
          'CANONICAL_PURCHASE_INVARIANT: PARTIAL purchase missing PURCHASE_AUTO payable',
        );
      }
    }
  }

  private async assertFreshness(tenantId: string, input: RegisterPurchaseWriteInput) {
    if (input.serialNumber) {
      const dup = await this.prisma.watch.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          serialNumber: input.serialNumber,
        },
        select: { id: true, registerIdempotencyKey: true },
      });
      if (dup && dup.registerIdempotencyKey !== input.registerIdempotencyKey) {
        throw new ConflictException(
          `A watch with serial "${input.serialNumber}" already exists in inventory`,
        );
      }
    }
    if (input.sellerClientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: input.sellerClientId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!client) {
        throw new ConflictException('Seller client is no longer valid in this tenant');
      }
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
    result: {
      watch: {
        id: string;
        brand: string | null;
        model: string | null;
        status: WatchStatus;
        acquiredAt: Date | null;
        cost: Prisma.Decimal | null;
        costCurrency: string | null;
      };
      treasuryEntry: { id: string; account: string; amountMxn: Prisma.Decimal } | null;
      payableEntry: {
        id: string;
        totalAmount: Prisma.Decimal;
        counterpartyName: string;
      } | null;
      paymentMode: 'PAID' | 'CREDIT' | 'PARTIAL';
      purchaseAmountMxn: string;
      amountPaidMxn: string;
      outstandingMxn: string;
      replayed: boolean;
    },
    input: RegisterPurchaseWriteInput,
  ): BusinessActionResult {
    const watchLabel = `${result.watch.brand ?? input.brand} ${result.watch.model ?? input.model}`.trim();
    const sourceLabel = input.sourceAccount
      ? PURCHASE_SOURCE_LABELS[input.sourceAccount]
      : null;
    const modeLabel = PURCHASE_PAYMENT_MODE_LABELS[result.paymentMode];
    const statusLabel =
      PURCHASE_STATUS_LABELS[result.watch.status as 'AVAILABLE' | 'IN_TRANSIT'] ??
      result.watch.status;
    const dateStr =
      result.watch.acquiredAt?.toISOString().slice(0, 10) ??
      input.acquisitionDate.toISOString().slice(0, 10);

    const affected: BusinessActionResult['affectedEntities'] = [
      {
        type: 'WATCH',
        id: idHash(result.watch.id),
        effect: result.replayed ? 'REPLAYED' : 'CREATED',
      },
    ];
    if (result.treasuryEntry) {
      affected.push({
        type: 'TREASURY_ENTRY',
        id: idHash(result.treasuryEntry.id),
        effect: 'OUTFLOW',
      });
    }
    if (result.payableEntry) {
      affected.push({
        type: 'ACCOUNT_ENTRY',
        id: idHash(result.payableEntry.id),
        effect: 'CREATED',
      });
    }

    return {
      actionId: 'REGISTER_PURCHASE',
      executionState: 'EXECUTED',
      success: true,
      affectedEntities: affected,
      warnings: [],
      generatedEvents: [],
      receipt: {
        kind: 'INVENTORY_PURCHASE',
        watchId: result.watch.id,
        watchLabel,
        costMxn: result.purchaseAmountMxn,
        currency: input.currency,
        originalCost:
          input.currency === 'USD' ? input.purchaseAmount.toFixed(2) : null,
        acquiredAt: dateStr,
        paymentMode: result.paymentMode,
        paymentModeLabel: modeLabel,
        initialPaymentAmount: result.amountPaidMxn,
        sourceAccount: input.sourceAccount,
        sourceLabel,
        outstandingPayable: result.outstandingMxn,
        seller:
          input.sellerCounterpartyName ??
          result.payableEntry?.counterpartyName ??
          null,
        sellerClientId: input.sellerClientId,
        status: result.watch.status,
        statusLabel,
        treasuryEntryId: result.treasuryEntry?.id ?? null,
        payableEntryId: result.payableEntry?.id ?? null,
        capitalUnchanged: true,
        pnlUnchanged: true,
        capitalNote:
          'La utilidad no cambia con la compra. El costo afecta COGS cuando el reloj se venda.',
        replayed: result.replayed,
      } as unknown as JsonValue,
      rollbackPossible: false,
    };
  }
}
