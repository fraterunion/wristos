import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountEntry,
  AccountEntrySource,
  AccountEntryType,
  Currency,
  Prisma,
  TreasuryAccount,
  TreasuryEntry,
  Watch,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CuentasService } from '../cuentas/cuentas.service';
import { FxService } from '../fx/fx.service';
import {
  inventoryPurchaseOutflowProvenanceKey,
  TreasuryService,
} from '../treasury/treasury.service';

export type PurchasePaymentMode = 'PAID' | 'CREDIT' | 'PARTIAL';
export type PurchaseMoneySource = 'CASH' | 'BANK' | 'CESAR';

export type RegisterPurchaseWatchInput = {
  brand: string;
  model: string;
  reference?: string | null;
  serialNumber?: string | null;
  imageUrl?: string | null;
  condition: string;
  priceMin: number;
  priceMax: number;
  status?: WatchStatus;
  ownershipType?: WatchOwnershipType;
  consignmentOwnerName?: string | null;
  consignmentSplitPercentage?: number | null;
};

export type RegisterPurchaseInput = {
  watch: RegisterPurchaseWatchInput;
  /** Purchase amount in `currency` (stored as MXN Watch.cost after FX). */
  purchaseAmount: Prisma.Decimal | number | string;
  currency?: 'MXN' | 'USD';
  acquisitionDate: Date | string;
  sellerClientId?: string | null;
  /** Required for CREDIT/PARTIAL when sellerClientId is absent. */
  sellerCounterpartyName?: string | null;
  paymentMode: PurchasePaymentMode;
  /** Same currency as purchaseAmount. Required for PARTIAL. */
  initialPaymentAmount?: Prisma.Decimal | number | string | null;
  sourceAccount?: PurchaseMoneySource | null;
  notes?: string | null;
  registerIdempotencyKey?: string | null;
};

export type RegisterPurchaseResult = {
  watch: Watch;
  treasuryEntry: TreasuryEntry | null;
  payableEntry: AccountEntry | null;
  paymentMode: PurchasePaymentMode;
  purchaseAmountMxn: string;
  amountPaidMxn: string;
  outstandingMxn: string;
  replayed: boolean;
};

const ALLOWED_SOURCES: PurchaseMoneySource[] = ['CASH', 'BANK', 'CESAR'];

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function toAcquisitionDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
  const raw = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Invalid acquisitionDate');
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function moneySourceToAccount(source: PurchaseMoneySource): TreasuryAccount {
  if (source === 'CASH') return TreasuryAccount.CASH;
  if (source === 'BANK') return TreasuryAccount.BANK;
  return TreasuryAccount.CESAR;
}

@Injectable()
export class PurchaseRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fxService: FxService,
    private readonly treasuryService: TreasuryService,
    private readonly cuentasService: CuentasService,
  ) {}

  /**
   * Canonical inventory purchase shared by manual UI and future AI REGISTER_PURCHASE.
   * Not AI-bound in 17A.
   *
   * Atomic effects by paymentMode:
   * - PAID: Watch + Treasury OUTFLOW (full cost MXN). No CXP.
   * - CREDIT: Watch + AccountEntry PAYABLE (full). No Treasury.
   * - PARTIAL: Watch + Treasury OUTFLOW (paid) + PAYABLE (remainder).
   *
   * Does NOT create Client/seller. Does NOT register WatchExpense.
   * CRYPTO / partner funds unsupported in V1.
   */
  async register(
    tenantId: string,
    input: RegisterPurchaseInput,
  ): Promise<RegisterPurchaseResult> {
    const paymentMode = input.paymentMode;
    if (!['PAID', 'CREDIT', 'PARTIAL'].includes(paymentMode)) {
      throw new BadRequestException('paymentMode must be PAID, CREDIT, or PARTIAL');
    }

    const currency = input.currency ?? 'MXN';
    if (currency !== 'MXN' && currency !== 'USD') {
      throw new BadRequestException('Unsupported currency. Allowed: MXN, USD');
    }

    const purchaseAmount = asDecimal(input.purchaseAmount);
    if (!purchaseAmount.isFinite() || purchaseAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('purchaseAmount must be greater than 0');
    }

    const acquisitionDate = toAcquisitionDate(input.acquisitionDate);
    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);

    const { canonicalCost, originalAmount, exchangeRate } = await this.resolveCost(
      purchaseAmount,
      currency,
    );

    let amountPaidMxn = new Prisma.Decimal(0);
    let source: PurchaseMoneySource | null = null;

    if (paymentMode === 'CREDIT') {
      if (input.sourceAccount) {
        throw new BadRequestException(
          'CREDIT purchase must not include sourceAccount (no Treasury movement)',
        );
      }
      if (input.initialPaymentAmount != null && input.initialPaymentAmount !== '') {
        const partial = asDecimal(input.initialPaymentAmount);
        if (!partial.isZero()) {
          throw new BadRequestException(
            'CREDIT purchase must not include an initialPaymentAmount',
          );
        }
      }
    } else if (paymentMode === 'PAID') {
      source = input.sourceAccount ?? null;
      if (!source || !ALLOWED_SOURCES.includes(source)) {
        throw new BadRequestException(
          'PAID purchase requires sourceAccount: CASH, BANK, or CESAR',
        );
      }
      if (input.initialPaymentAmount != null && input.initialPaymentAmount !== '') {
        const paidInCurrency = asDecimal(input.initialPaymentAmount);
        amountPaidMxn = await this.toMxn(paidInCurrency, currency, exchangeRate);
        if (!amountPaidMxn.equals(canonicalCost)) {
          throw new BadRequestException(
            'PAID purchase initialPaymentAmount must equal purchaseAmount (use PARTIAL for less)',
          );
        }
      } else {
        amountPaidMxn = canonicalCost;
      }
    } else {
      // PARTIAL
      source = input.sourceAccount ?? null;
      if (!source || !ALLOWED_SOURCES.includes(source)) {
        throw new BadRequestException(
          'PARTIAL purchase requires sourceAccount: CASH, BANK, or CESAR',
        );
      }
      if (input.initialPaymentAmount == null || input.initialPaymentAmount === '') {
        throw new BadRequestException('PARTIAL purchase requires initialPaymentAmount');
      }
      const paidInCurrency = asDecimal(input.initialPaymentAmount);
      if (!paidInCurrency.isFinite() || paidInCurrency.lessThanOrEqualTo(0)) {
        throw new BadRequestException('initialPaymentAmount must be greater than 0');
      }
      amountPaidMxn = await this.toMxn(paidInCurrency, currency, exchangeRate);
      if (amountPaidMxn.greaterThanOrEqualTo(canonicalCost)) {
        throw new BadRequestException(
          'PARTIAL initialPaymentAmount must be less than purchaseAmount (use PAID for full)',
        );
      }
    }

    const outstandingMxn = canonicalCost.minus(amountPaidMxn);
    const sellerClientId = input.sellerClientId?.trim() || null;
    let counterpartyName =
      input.sellerCounterpartyName?.trim() || null;

    if (sellerClientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: sellerClientId, tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!client) {
        throw new NotFoundException('sellerClientId not found in this tenant');
      }
      if (!counterpartyName) counterpartyName = client.name;
    }

    if (
      (paymentMode === 'CREDIT' || paymentMode === 'PARTIAL') &&
      !counterpartyName
    ) {
      throw new BadRequestException(
        'CREDIT/PARTIAL purchase requires sellerClientId or sellerCounterpartyName for CXP',
      );
    }

    const watchInput = input.watch;
    if (!watchInput.brand?.trim() || !watchInput.model?.trim()) {
      throw new BadRequestException('brand and model are required');
    }
    if (!watchInput.condition?.trim()) {
      throw new BadRequestException('condition is required');
    }
    if (watchInput.priceMin < 0 || watchInput.priceMax < 0) {
      throw new BadRequestException('priceMin and priceMax must be >= 0');
    }

    const serial = watchInput.serialNumber?.trim() || null;
    if (serial) {
      const dup = await this.prisma.watch.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          serialNumber: serial,
        },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(
          `A watch with serial "${serial}" already exists in inventory`,
        );
      }
    }

    if (idempotencyKey) {
      const existing = await this.prisma.watch.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        await this.assertCompatibleReplay(existing, {
          brand: watchInput.brand.trim(),
          model: watchInput.model.trim(),
          serial,
          canonicalCost,
          currency,
          acquisitionDate,
          paymentMode,
          amountPaidMxn,
          outstandingMxn,
          sellerClientId,
        });
        return this.loadResult(existing, paymentMode, /* replayed */ true);
      }
    }

    const ownershipType = watchInput.ownershipType ?? WatchOwnershipType.OWNED;
    const status = watchInput.status ?? WatchStatus.AVAILABLE;
    const label = `${watchInput.brand.trim()} ${watchInput.model.trim()}`;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const watch = await tx.watch.create({
          data: {
            tenant: { connect: { id: tenantId } },
            brand: watchInput.brand.trim(),
            model: watchInput.model.trim(),
            reference: watchInput.reference?.trim() || null,
            serialNumber: serial,
            imageUrl: watchInput.imageUrl ?? null,
            condition: watchInput.condition.trim(),
            cost: canonicalCost,
            costCurrency: currency,
            costOriginalAmount: originalAmount,
            costExchangeRate: exchangeRate,
            priceMin: new Prisma.Decimal(watchInput.priceMin),
            priceMax: new Prisma.Decimal(watchInput.priceMax),
            status,
            ownershipType,
            consignmentOwnerName:
              ownershipType === WatchOwnershipType.CONSIGNMENT
                ? watchInput.consignmentOwnerName ?? null
                : null,
            consignmentSplitPercentage:
              ownershipType === WatchOwnershipType.CONSIGNMENT &&
              watchInput.consignmentSplitPercentage != null
                ? new Prisma.Decimal(watchInput.consignmentSplitPercentage)
                : null,
            acquiredAt: acquisitionDate,
            sellerClient: sellerClientId
              ? { connect: { id: sellerClientId } }
              : undefined,
            registerIdempotencyKey: idempotencyKey,
          },
        });

        let treasuryEntry: TreasuryEntry | null = null;
        if (amountPaidMxn.greaterThan(0) && source) {
          treasuryEntry = await this.treasuryService.createFromInventoryPurchase({
            tenantId,
            watchId: watch.id,
            account: moneySourceToAccount(source),
            amount: amountPaidMxn,
            currency: Currency.MXN,
            transactionDate: acquisitionDate,
            description: `Compra inventario — ${label}`,
            tx,
          });
        }

        let payableEntry: AccountEntry | null = null;
        if (outstandingMxn.greaterThan(0) && counterpartyName) {
          payableEntry = await this.cuentasService.createPurchasePayable(
            tenantId,
            {
              watchId: watch.id,
              totalAmount: outstandingMxn,
              counterpartyName,
              clientId: sellerClientId,
              concept: `Compra — ${label}`,
              issuedAt: acquisitionDate,
              currency: Currency.MXN,
              exchangeRate,
              notes: input.notes ?? null,
            },
            tx,
          );
        }

        return { watch, treasuryEntry, payableEntry };
      });

      return {
        watch: created.watch,
        treasuryEntry: created.treasuryEntry,
        payableEntry: created.payableEntry,
        paymentMode,
        purchaseAmountMxn: canonicalCost.toFixed(2),
        amountPaidMxn: amountPaidMxn.toFixed(2),
        outstandingMxn: outstandingMxn.toFixed(2),
        replayed: false,
      };
    } catch (error: unknown) {
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.watch.findFirst({
          where: { tenantId, registerIdempotencyKey: idempotencyKey, deletedAt: null },
        });
        if (raced) {
          await this.assertCompatibleReplay(raced, {
            brand: watchInput.brand.trim(),
            model: watchInput.model.trim(),
            serial,
            canonicalCost,
            currency,
            acquisitionDate,
            paymentMode,
            amountPaidMxn,
            outstandingMxn,
            sellerClientId,
          });
          return this.loadResult(raced, paymentMode, /* replayed */ true);
        }
      }
      throw error;
    }
  }

  private async resolveCost(
    amount: Prisma.Decimal,
    currency: 'MXN' | 'USD',
  ): Promise<{
    canonicalCost: Prisma.Decimal;
    originalAmount: Prisma.Decimal | null;
    exchangeRate: Prisma.Decimal | null;
  }> {
    if (currency === 'MXN') {
      return {
        canonicalCost: amount.toDecimalPlaces(2),
        originalAmount: null,
        exchangeRate: null,
      };
    }
    const fx = await this.fxService.getUsdMxn();
    const rate = new Prisma.Decimal(fx.rate);
    const mxnAmount = amount.mul(rate).toDecimalPlaces(2);
    return {
      canonicalCost: mxnAmount,
      originalAmount: amount.toDecimalPlaces(2),
      exchangeRate: rate,
    };
  }

  private async toMxn(
    amountInCurrency: Prisma.Decimal,
    currency: 'MXN' | 'USD',
    exchangeRate: Prisma.Decimal | null,
  ): Promise<Prisma.Decimal> {
    if (currency === 'MXN') return amountInCurrency.toDecimalPlaces(2);
    const rate = exchangeRate ?? new Prisma.Decimal((await this.fxService.getUsdMxn()).rate);
    return amountInCurrency.mul(rate).toDecimalPlaces(2);
  }

  private async assertCompatibleReplay(
    existing: Watch,
    expected: {
      brand: string;
      model: string;
      serial: string | null;
      canonicalCost: Prisma.Decimal;
      currency: string;
      acquisitionDate: Date;
      paymentMode: PurchasePaymentMode;
      amountPaidMxn: Prisma.Decimal;
      outstandingMxn: Prisma.Decimal;
      sellerClientId: string | null;
    },
  ) {
    const mismatches: string[] = [];
    if ((existing.brand ?? '') !== expected.brand) mismatches.push('brand');
    if ((existing.model ?? '') !== expected.model) mismatches.push('model');
    if ((existing.serialNumber ?? null) !== expected.serial) mismatches.push('serialNumber');
    if (!(existing.cost ?? new Prisma.Decimal(0)).equals(expected.canonicalCost)) {
      mismatches.push('cost');
    }
    if ((existing.costCurrency ?? 'MXN') !== expected.currency) mismatches.push('currency');
    if (existing.sellerClientId !== expected.sellerClientId) mismatches.push('sellerClientId');
    if (existing.acquiredAt) {
      const a = existing.acquiredAt;
      const e = expected.acquisitionDate;
      if (
        a.getUTCFullYear() !== e.getUTCFullYear() ||
        a.getUTCMonth() !== e.getUTCMonth() ||
        a.getUTCDate() !== e.getUTCDate()
      ) {
        mismatches.push('acquisitionDate');
      }
    }

    const treasuryEntry = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId: existing.tenantId,
        provenanceKey: inventoryPurchaseOutflowProvenanceKey(existing.id),
        deletedAt: null,
      },
    });
    const paid = treasuryEntry?.amountMxn ?? new Prisma.Decimal(0);
    if (!paid.equals(expected.amountPaidMxn)) mismatches.push('amountPaid');

    const payableEntry = await this.prisma.accountEntry.findFirst({
      where: {
        tenantId: existing.tenantId,
        watchId: existing.id,
        type: AccountEntryType.PAYABLE,
        source: AccountEntrySource.PURCHASE_AUTO,
        deletedAt: null,
      },
    });
    const outstanding = payableEntry?.totalAmount ?? new Prisma.Decimal(0);
    if (!outstanding.equals(expected.outstandingMxn)) mismatches.push('outstanding');

    if (mismatches.length > 0) {
      throw new ConflictException(
        `Idempotency key conflict: payload differs on ${mismatches.join(', ')}`,
      );
    }
  }

  private async loadResult(
    watch: Watch,
    paymentMode: PurchasePaymentMode,
    replayed: boolean,
  ): Promise<RegisterPurchaseResult> {
    const treasuryEntry = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId: watch.tenantId,
        provenanceKey: inventoryPurchaseOutflowProvenanceKey(watch.id),
        deletedAt: null,
      },
    });
    const payableEntry = await this.prisma.accountEntry.findFirst({
      where: {
        tenantId: watch.tenantId,
        watchId: watch.id,
        type: AccountEntryType.PAYABLE,
        source: AccountEntrySource.PURCHASE_AUTO,
        deletedAt: null,
      },
    });

    const purchaseAmountMxn = (watch.cost ?? new Prisma.Decimal(0)).toFixed(2);
    const amountPaidMxn = treasuryEntry
      ? treasuryEntry.amountMxn.toFixed(2)
      : '0.00';
    const outstandingMxn = payableEntry
      ? payableEntry.totalAmount.toFixed(2)
      : '0.00';

    return {
      watch,
      treasuryEntry,
      payableEntry,
      paymentMode,
      purchaseAmountMxn,
      amountPaidMxn,
      outstandingMxn,
      replayed,
    };
  }
}
