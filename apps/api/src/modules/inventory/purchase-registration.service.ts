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

export type ReversePurchaseResult = {
  watch: Watch;
  treasuryEntry: TreasuryEntry | null;
  payableEntry: AccountEntry | null;
  alreadyReversed: boolean;
};

/** Canonical purchase = has purchase Treasury provenance and/or PURCHASE_AUTO payable. */
export type CanonicalPurchaseMarkers = {
  isCanonical: boolean;
  treasuryEntry: TreasuryEntry | null;
  payableEntry: AccountEntry | null;
};

const ALLOWED_SOURCES: PurchaseMoneySource[] = ['CASH', 'BANK', 'CESAR'];

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Trim; blank → null. Does not change case (serial uniqueness is case-sensitive). */
function normalizeSerial(raw: string | null | undefined): string | null {
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

    const serial = normalizeSerial(watchInput.serialNumber);
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
        const fieldBlob = fields.join(',');
        if (
          fieldBlob.includes('serialNumber') ||
          fieldBlob.includes('watches_tenantId_serialNumber_active_key')
        ) {
          throw new ConflictException(
            serial
              ? `A watch with serial "${serial}" already exists in inventory`
              : 'A watch with this serial already exists in inventory',
          );
        }
        if (idempotencyKey) {
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
      }
      throw error;
    }
  }

  /**
   * True when Watch was created by canonical purchase (Treasury and/or PURCHASE_AUTO CXP).
   * Legacy inventory-only watches return false — never invent financial reversal.
   */
  async getCanonicalPurchaseMarkers(
    tenantId: string,
    watchId: string,
  ): Promise<CanonicalPurchaseMarkers> {
    const treasuryEntry = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId,
        provenanceKey: inventoryPurchaseOutflowProvenanceKey(watchId),
      },
    });
    const payableEntry = await this.prisma.accountEntry.findFirst({
      where: {
        tenantId,
        watchId,
        type: AccountEntryType.PAYABLE,
        source: AccountEntrySource.PURCHASE_AUTO,
      },
    });
    const activeTreasury =
      treasuryEntry && treasuryEntry.deletedAt === null ? treasuryEntry : null;
    const activePayable =
      payableEntry && payableEntry.deletedAt === null ? payableEntry : null;
    return {
      isCanonical: Boolean(treasuryEntry || payableEntry),
      treasuryEntry: activeTreasury,
      payableEntry: activePayable,
    };
  }

  /**
   * Conservative V1 reverse for canonical purchases only.
   * Soft-deletes Watch + purchase Treasury OUTFLOW + PURCHASE_AUTO payable atomically.
   * Blocks: SOLD, linked Deal, payable payments, missing provenance, legacy watches.
   * Idempotent: second call → alreadyReversed.
   */
  async reverse(tenantId: string, watchId: string): Promise<ReversePurchaseResult> {
    const watch = await this.prisma.watch.findFirst({
      where: { id: watchId, tenantId },
    });
    if (!watch) throw new NotFoundException('Watch not found');

    const markers = await this.getCanonicalPurchaseMarkers(tenantId, watchId);
    if (!markers.isCanonical) {
      throw new BadRequestException(
        'Watch is not a canonical purchase record. Use inventory soft-delete for legacy items — financial reversal is not fabricated.',
      );
    }

    if (watch.deletedAt) {
      return {
        watch,
        treasuryEntry: await this.prisma.treasuryEntry.findFirst({
          where: {
            tenantId,
            provenanceKey: inventoryPurchaseOutflowProvenanceKey(watchId),
          },
        }),
        payableEntry: await this.prisma.accountEntry.findFirst({
          where: {
            tenantId,
            watchId,
            type: AccountEntryType.PAYABLE,
            source: AccountEntrySource.PURCHASE_AUTO,
          },
        }),
        alreadyReversed: true,
      };
    }

    if (watch.status === WatchStatus.SOLD) {
      throw new ConflictException(
        'Cannot reverse purchase: watch is SOLD. Manual financial correction required.',
      );
    }

    const deal = await this.prisma.deal.findFirst({
      where: { tenantId, watchId, deletedAt: null },
      select: { id: true, stage: true },
    });
    if (deal) {
      throw new ConflictException(
        `Cannot reverse purchase: watch is linked to deal ${deal.id}. Manual financial correction required.`,
      );
    }

    const payableAny = await this.prisma.accountEntry.findFirst({
      where: {
        tenantId,
        watchId,
        type: AccountEntryType.PAYABLE,
        source: AccountEntrySource.PURCHASE_AUTO,
      },
    });
    if (payableAny && !payableAny.deletedAt) {
      const payment = await this.prisma.accountPayment.findFirst({
        where: { tenantId, entryId: payableAny.id, deletedAt: null },
        select: { id: true },
      });
      if (payment) {
        throw new ConflictException(
          'Cannot reverse purchase: PURCHASE_AUTO payable has later payments. Manual financial correction required.',
        );
      }
      const settlement = await this.prisma.accountSettlement.findFirst({
        where: {
          tenantId,
          payableEntryId: payableAny.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (settlement) {
        throw new ConflictException(
          'Cannot reverse purchase: PURCHASE_AUTO payable is linked to a settlement. Manual financial correction required.',
        );
      }
    }

    // Ensure expected economic legs exist for an active canonical purchase
    const hasActiveTreasury = Boolean(markers.treasuryEntry);
    const hasActivePayable = Boolean(markers.payableEntry);
    if (!hasActiveTreasury && !hasActivePayable) {
      throw new ConflictException(
        'Canonical purchase economic legs are missing or already reversed inconsistently. Manual correction required.',
      );
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.watch.update({
        where: { id: watchId },
        data: { deletedAt: now },
      });

      const treasury = await this.treasuryService.softDeleteInventoryPurchaseOutflow({
        tenantId,
        watchId,
        tx,
      });

      let payable: AccountEntry | null = null;
      if (payableAny && !payableAny.deletedAt) {
        payable = await tx.accountEntry.update({
          where: { id: payableAny.id },
          data: { deletedAt: now },
        });
      } else if (payableAny) {
        payable = payableAny;
      }

      return { watch: updated, treasury, payable };
    });

    return {
      watch: result.watch,
      treasuryEntry: result.treasury,
      payableEntry: result.payable,
      alreadyReversed: false,
    };
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

    this.assertCompletePurchaseState(paymentMode, treasuryEntry, payableEntry);

    const purchaseAmountMxn = (watch.cost ?? new Prisma.Decimal(0)).toFixed(2);
    const amountPaidMxn = treasuryEntry
      ? treasuryEntry.amountMxn.toFixed(2)
      : '0.00';
    const outstandingMxn = payableEntry
      ? payableEntry.totalAmount.toFixed(2)
      : '0.00';

    // Decimal-safe identity: paid + outstanding === cost
    const paidDec = new Prisma.Decimal(amountPaidMxn);
    const outDec = new Prisma.Decimal(outstandingMxn);
    const costDec = new Prisma.Decimal(purchaseAmountMxn);
    if (!paidDec.plus(outDec).equals(costDec)) {
      throw new ConflictException(
        'Purchase recovery invariant failed: paid + outstanding ≠ cost',
      );
    }

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

  private assertCompletePurchaseState(
    paymentMode: PurchasePaymentMode,
    treasuryEntry: TreasuryEntry | null,
    payableEntry: AccountEntry | null,
  ) {
    if (paymentMode === 'PAID') {
      if (!treasuryEntry) {
        throw new ConflictException(
          'Purchase recovery invariant failed: PAID purchase missing Treasury OUTFLOW',
        );
      }
      if (payableEntry) {
        throw new ConflictException(
          'Purchase recovery invariant failed: PAID purchase must not have PURCHASE_AUTO payable',
        );
      }
    } else if (paymentMode === 'CREDIT') {
      if (treasuryEntry) {
        throw new ConflictException(
          'Purchase recovery invariant failed: CREDIT purchase must not have Treasury OUTFLOW',
        );
      }
      if (!payableEntry) {
        throw new ConflictException(
          'Purchase recovery invariant failed: CREDIT purchase missing PURCHASE_AUTO payable',
        );
      }
    } else if (paymentMode === 'PARTIAL') {
      if (!treasuryEntry) {
        throw new ConflictException(
          'Purchase recovery invariant failed: PARTIAL purchase missing Treasury OUTFLOW',
        );
      }
      if (!payableEntry) {
        throw new ConflictException(
          'Purchase recovery invariant failed: PARTIAL purchase missing PURCHASE_AUTO payable',
        );
      }
    }
  }
}
