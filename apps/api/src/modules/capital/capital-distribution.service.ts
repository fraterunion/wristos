import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CapitalAccount, InvestorDistribution, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RegisterCapitalDistributionInput = {
  investorId: string;
  amount: Prisma.Decimal | number | string;
  /** Declared funding/source label. Not a Treasury write in V1. */
  account: CapitalAccount;
  paidAt: Date | string;
  notes?: string | null;
  /**
   * Durable idempotency. Future AI marker: `ai-action-run:<actionRunId>`.
   * Manual UI may omit (null).
   */
  registerIdempotencyKey?: string | null;
};

export type RegisterCapitalDistributionResult = {
  distribution: InvestorDistribution;
  replayed: boolean;
};

export type ReverseCapitalDistributionResult = {
  distribution: InvestorDistribution;
  alreadyReversed: boolean;
};

export type UpdateCapitalDistributionNotesInput = {
  notes?: string | null;
  expectedUpdatedAt?: Date | string | null;
};

export type UpdateCapitalDistributionNotesResult = {
  distribution: InvestorDistribution;
  changed: boolean;
};

/** Material financial identity for idempotency / future AI recovery (notes excluded). */
export type CapitalDistributionMaterialPayload = {
  investorId: string;
  amount: Prisma.Decimal;
  account: CapitalAccount;
  paidAt: Date;
};

export const CAPITAL_DISTRIBUTION_IMMUTABLE_MESSAGE =
  'Este movimiento financiero no se puede modificar. Revierte el registro y crea uno nuevo con los datos correctos.';

const ALLOWED_ACCOUNTS: ReadonlySet<CapitalAccount> = new Set([
  CapitalAccount.CASH,
  CapitalAccount.BANK,
  CapitalAccount.CESAR_ACCOUNT,
]);

function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes == null || String(notes).trim() === '') return null;
  return String(notes).trim();
}

/**
 * Calendar business date for Capital distribution (UTC day bucket).
 */
export function toDistributionDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('Invalid paidAt');
    }
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
    throw new BadRequestException('Invalid paidAt');
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function dateBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Canonical Capital distribution — partner profit payout ledger ONLY.
 *
 * Writes InvestorDistribution. Does NOT write TreasuryEntry.
 * Does NOT change ownershipPercent.
 * Does NOT affect P&L / totalBusinessProfit (Option C unchanged).
 * Does NOT reject over-entitlement (UI warns; historical + current policy allow).
 * CapitalAccount is a declared source label — not BANK→CESAR Treasury transfer.
 * CESAR_ACCOUNT ≠ money leaving business liquidity via Treasury.
 *
 * AI-bound via REGISTER_CAPITAL_DISTRIBUTION (Commit 24B).
 */
@Injectable()
export class CapitalDistributionService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    tenantId: string,
    input: RegisterCapitalDistributionInput,
  ): Promise<RegisterCapitalDistributionResult> {
    if (!ALLOWED_ACCOUNTS.has(input.account)) {
      throw new BadRequestException(
        'Unsupported capital account. Allowed: CASH, BANK, CESAR_ACCOUNT',
      );
    }

    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Distribution amount must be greater than 0');
    }

    const paidAt = toDistributionDate(input.paidAt);
    const notes = normalizeNotes(input.notes);
    const idempotencyKey = normalizeIdempotencyKey(input.registerIdempotencyKey);

    const investor = await this.prisma.investor.findFirst({
      where: { id: input.investorId, tenantId, deletedAt: null },
    });
    if (!investor) throw new NotFoundException('Investor not found');
    if (!investor.isActive) {
      throw new BadRequestException('Investor is inactive');
    }

    if (idempotencyKey) {
      const existing = await this.prisma.investorDistribution.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        this.assertCompatibleReplay(existing, {
          investorId: input.investorId,
          amount,
          account: input.account,
          paidAt,
        });
        return { distribution: existing, replayed: true };
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'registerIdempotencyKey already used by a reversed distribution; use a new key',
        );
      }
    }

    try {
      const distribution = await this.prisma.investorDistribution.create({
        data: {
          tenantId,
          investorId: input.investorId,
          amount,
          account: input.account,
          notes,
          paidAt,
          registerIdempotencyKey: idempotencyKey,
        },
      });
      return { distribution, replayed: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const raced = await this.prisma.investorDistribution.findFirst({
          where: { tenantId, registerIdempotencyKey: idempotencyKey },
        });
        if (raced && !raced.deletedAt) {
          this.assertCompatibleReplay(raced, {
            investorId: input.investorId,
            amount,
            account: input.account,
            paidAt,
          });
          return { distribution: raced, replayed: true };
        }
        throw new ConflictException(
          'registerIdempotencyKey already used with a conflicting distribution payload',
        );
      }
      throw error;
    }
  }

  /**
   * Notes-only mutation. Economic fields are immutable after creation (Commit 23B).
   * Applies to ALL active distribution rows (legacy + keyed).
   */
  async updateNotes(
    tenantId: string,
    distributionId: string,
    input: UpdateCapitalDistributionNotesInput,
  ): Promise<UpdateCapitalDistributionNotesResult> {
    const distribution = await this.prisma.investorDistribution.findFirst({
      where: { id: distributionId, tenantId },
    });
    if (!distribution || distribution.deletedAt) {
      throw new NotFoundException('Distribution not found');
    }

    if (input.expectedUpdatedAt != null && String(input.expectedUpdatedAt).trim() !== '') {
      const expected = new Date(input.expectedUpdatedAt);
      if (Number.isNaN(expected.getTime())) {
        throw new BadRequestException('Invalid expectedUpdatedAt');
      }
      if (distribution.updatedAt.toISOString() !== expected.toISOString()) {
        throw new ConflictException({
          code: 'CAPITAL_DISTRIBUTION_NOTES_STALE',
          message:
            'Las notas fueron actualizadas por otro cambio. Recarga e intenta de nuevo.',
        });
      }
    }

    if (input.notes === undefined) {
      return { distribution, changed: false };
    }

    const notes = normalizeNotes(input.notes);
    if (normalizeNotes(distribution.notes) === notes) {
      return { distribution, changed: false };
    }

    const updated = await this.prisma.investorDistribution.update({
      where: { id: distributionId },
      data: { notes },
    });
    return { distribution: updated, changed: true };
  }

  /**
   * AI / API recovery classification against material payload.
   * Does not mutate. Used by WritePlanRunner + RegisterCapitalDistributionWriteBinding (24B).
   */
  classifyRecovery(
    existing: InvestorDistribution | null,
    expected: CapitalDistributionMaterialPayload,
  ):
    | 'MATCH'
    | 'STALE_CAPITAL_DISTRIBUTION_REVERSED'
    | 'CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT'
    | 'MISSING' {
    if (!existing) return 'MISSING';
    if (existing.deletedAt) return 'STALE_CAPITAL_DISTRIBUTION_REVERSED';
    try {
      this.assertCompatibleReplay(existing, expected);
      return 'MATCH';
    } catch {
      return 'CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT';
    }
  }

  async reverse(
    tenantId: string,
    distributionId: string,
  ): Promise<ReverseCapitalDistributionResult> {
    const distribution = await this.prisma.investorDistribution.findFirst({
      where: { id: distributionId, tenantId },
    });
    if (!distribution) throw new NotFoundException('Distribution not found');
    if (distribution.deletedAt) {
      return { distribution, alreadyReversed: true };
    }

    const linked = await this.prisma.treasuryEntry.findFirst({
      where: { tenantId, distributionId, deletedAt: null },
      select: { id: true },
    });
    if (linked) {
      throw new ConflictException(
        'Distribution has a linked Treasury entry; cash-linked Capital reversal is not enabled in V1',
      );
    }

    const updated = await this.prisma.investorDistribution.update({
      where: { id: distributionId },
      data: { deletedAt: new Date() },
    });
    return { distribution: updated, alreadyReversed: false };
  }

  private assertCompatibleReplay(
    existing: InvestorDistribution,
    expected: CapitalDistributionMaterialPayload,
  ) {
    // Notes are non-material after creation (23B).
    const sameInvestor = existing.investorId === expected.investorId;
    const sameAmount = existing.amount.equals(expected.amount);
    const sameAccount = existing.account === expected.account;
    const sameDate = dateBucket(existing.paidAt) === dateBucket(expected.paidAt);
    if (!sameInvestor || !sameAmount || !sameAccount || !sameDate) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting distribution payload',
      );
    }
  }
}

export function capitalDistributionImmutableConflict(): ConflictException {
  return new ConflictException({
    code: 'CAPITAL_DISTRIBUTION_IMMUTABLE',
    message: CAPITAL_DISTRIBUTION_IMMUTABLE_MESSAGE,
  });
}
