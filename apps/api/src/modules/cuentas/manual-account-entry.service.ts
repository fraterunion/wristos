import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountEntry,
  AccountEntryCategory,
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  CounterpartyType,
  Currency,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RegisterManualAccountInput = {
  counterpartyName: string;
  concept: string;
  amount: Prisma.Decimal | number | string;
  category?: AccountEntryCategory;
  counterpartyType?: CounterpartyType;
  currency?: Currency;
  exchangeRate?: Prisma.Decimal | number | string | null;
  reference?: string | null;
  issuedAt?: Date | string | null;
  dueDate?: Date | string | null;
  notes?: string | null;
  clientId?: string | null;
  /**
   * Durable idempotency. Future AI marker: `ai-action-run:<actionRunId>`.
   * Manual UI may omit (null).
   */
  registerIdempotencyKey?: string | null;
};

export type RegisterManualAccountResult = {
  entry: AccountEntry;
  replayed: boolean;
};

/** Material financial identity for idempotency / future AI recovery (notes excluded). */
export type ManualAccountMaterialPayload = {
  type: AccountEntryType;
  source: typeof AccountEntrySource.MANUAL;
  clientId: string | null;
  counterpartyName: string;
  concept: string;
  amount: Prisma.Decimal;
  currency: Currency;
  issuedAt: Date | null;
  dueDate: Date | null;
};

export const MANUAL_ACCOUNT_ECONOMIC_IMMUTABLE_MESSAGE =
  'Esta cuenta no se puede modificar en monto, tipo, moneda o origen. Cancélala y crea una nueva con los datos correctos.';

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function normalizeRequiredText(value: string, field: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }
  return trimmed;
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes == null || String(notes).trim() === '') return null;
  return String(notes).trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim();
}

/**
 * Calendar business date (UTC day bucket). Prefers YYYY-MM-DD.
 */
export function toAccountBusinessDate(
  value: Date | string | null | undefined,
  field: string,
): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException(`Invalid ${field}`);
    }
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function dateBucket(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function initialStatus(dueDate: Date | null, now = new Date()): AccountEntryStatus {
  if (dueDate && dueDate.getTime() < now.getTime()) {
    return AccountEntryStatus.OVERDUE;
  }
  return AccountEntryStatus.OPEN;
}

/**
 * Canonical MANUAL standalone AccountEntry create — receivable or payable.
 *
 * Writes AccountEntry with source=MANUAL only.
 * Does NOT write TreasuryEntry, AccountPayment, Payment, Deal, Watch,
 * OperatingExpense, or Capital events.
 * Liquidity Δ0. No automatic collection/payment.
 *
 * Not AI-bound in 25B; AI CREATE_RECEIVABLE / CREATE_PAYABLE bindings added in 25C.
 */
@Injectable()
export class ManualAccountEntryService {
  constructor(private readonly prisma: PrismaService) {}

  async createReceivable(
    tenantId: string,
    input: RegisterManualAccountInput,
  ): Promise<RegisterManualAccountResult> {
    return this.create(tenantId, AccountEntryType.RECEIVABLE, input);
  }

  async createPayable(
    tenantId: string,
    input: RegisterManualAccountInput,
  ): Promise<RegisterManualAccountResult> {
    return this.create(tenantId, AccountEntryType.PAYABLE, input);
  }

  private async create(
    tenantId: string,
    type: AccountEntryType,
    input: RegisterManualAccountInput,
  ): Promise<RegisterManualAccountResult> {
    const counterpartyName = normalizeRequiredText(
      input.counterpartyName,
      'counterpartyName',
    );
    const concept = normalizeRequiredText(input.concept, 'concept');
    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Account amount must be greater than 0');
    }

    const currency = input.currency ?? Currency.MXN;
    if (currency !== Currency.MXN && currency !== Currency.USD) {
      throw new BadRequestException('Unsupported currency. Allowed: MXN, USD');
    }

    let exchangeRate: Prisma.Decimal | null = null;
    if (input.exchangeRate !== undefined && input.exchangeRate !== null && input.exchangeRate !== '') {
      exchangeRate = asDecimal(input.exchangeRate);
      if (!exchangeRate.isFinite() || exchangeRate.lessThan(0)) {
        throw new BadRequestException('exchangeRate must be a non-negative number');
      }
    }

    const issuedAt = toAccountBusinessDate(input.issuedAt, 'issuedAt');
    const dueDate = toAccountBusinessDate(input.dueDate, 'dueDate');
    const notes = normalizeNotes(input.notes);
    const reference = normalizeOptionalText(input.reference);
    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);
    const category = input.category ?? AccountEntryCategory.OTHER;
    const counterpartyType = input.counterpartyType ?? CounterpartyType.OTHER;
    const clientId = input.clientId?.trim() ? input.clientId.trim() : null;

    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!client) {
        throw new BadRequestException('Client is invalid for this tenant');
      }
    }

    const material: ManualAccountMaterialPayload = {
      type,
      source: AccountEntrySource.MANUAL,
      clientId,
      counterpartyName,
      concept,
      amount,
      currency,
      issuedAt,
      dueDate,
    };

    if (idempotencyKey) {
      const existing = await this.prisma.accountEntry.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        this.assertCompatibleReplay(existing, material);
        return { entry: existing, replayed: true };
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'registerIdempotencyKey already used by a cancelled/deleted account entry; use a new key',
        );
      }
    }

    try {
      const entry = await this.prisma.accountEntry.create({
        data: {
          tenantId,
          type,
          status: initialStatus(dueDate),
          category,
          source: AccountEntrySource.MANUAL,
          counterpartyName,
          counterpartyType: clientId ? CounterpartyType.CLIENT : counterpartyType,
          concept,
          totalAmount: amount,
          currency,
          exchangeRate,
          reference,
          issuedAt,
          dueDate,
          notes,
          registerIdempotencyKey: idempotencyKey,
          clientId,
          dealId: null,
          watchId: null,
          expenseId: null,
        },
      });
      return { entry, replayed: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const raced = await this.prisma.accountEntry.findFirst({
          where: { tenantId, registerIdempotencyKey: idempotencyKey },
        });
        if (raced && !raced.deletedAt) {
          this.assertCompatibleReplay(raced, material);
          return { entry: raced, replayed: true };
        }
        throw new ConflictException(
          'registerIdempotencyKey already used with a conflicting account entry payload',
        );
      }
      throw error;
    }
  }

  /**
   * Soft-cancel/delete unpaid MANUAL entry with zero payments/settlements.
   * Fail closed when payments or settlements exist.
   */
  async cancelUnpaidManual(
    tenantId: string,
    entryId: string,
  ): Promise<{ entry: AccountEntry; alreadyCancelled: boolean }> {
    const entry = await this.prisma.accountEntry.findFirst({
      where: { id: entryId, tenantId },
      include: {
        payments: { where: { deletedAt: null }, select: { id: true } },
        settlementsAsReceivable: {
          where: { deletedAt: null },
          select: { id: true },
        },
        settlementsAsPayable: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });
    if (!entry) throw new NotFoundException('Account entry not found');
    if (entry.source !== AccountEntrySource.MANUAL) {
      throw new BadRequestException('Only MANUAL account entries can be cancelled via this command');
    }
    if (entry.deletedAt || entry.status === AccountEntryStatus.CANCELLED) {
      const {
        payments: _payments,
        settlementsAsReceivable: _recv,
        settlementsAsPayable: _pay,
        ...rest
      } = entry;
      return { entry: rest, alreadyCancelled: true };
    }
    if (
      entry.payments.length > 0 ||
      entry.settlementsAsReceivable.length > 0 ||
      entry.settlementsAsPayable.length > 0
    ) {
      throw new BadRequestException(
        'Cannot cancel a MANUAL account that has payments or settlements; reverse dependent legs first',
      );
    }

    const cancelled = await this.prisma.accountEntry.update({
      where: { id: entryId },
      data: {
        status: AccountEntryStatus.CANCELLED,
        closedAt: entry.closedAt ?? new Date(),
        deletedAt: new Date(),
      },
    });
    return { entry: cancelled, alreadyCancelled: false };
  }

  assertCompatibleReplay(
    existing: AccountEntry,
    material: ManualAccountMaterialPayload,
  ): void {
    if (existing.source !== AccountEntrySource.MANUAL) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (existing.type !== material.type) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if ((existing.clientId ?? null) !== (material.clientId ?? null)) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (existing.counterpartyName.trim() !== material.counterpartyName) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (existing.concept.trim() !== material.concept) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (!asDecimal(existing.totalAmount).eq(material.amount)) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (existing.currency !== material.currency) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (dateBucket(existing.issuedAt) !== dateBucket(material.issuedAt)) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
    if (dateBucket(existing.dueDate) !== dateBucket(material.dueDate)) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting account entry payload',
      );
    }
  }
}
