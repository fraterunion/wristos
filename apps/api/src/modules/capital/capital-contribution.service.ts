import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CapitalAccount, InvestorContribution, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RegisterCapitalContributionInput = {
  investorId: string;
  amount: Prisma.Decimal | number | string;
  account: CapitalAccount;
  contributedAt: Date | string;
  notes?: string | null;
  /**
   * Durable idempotency. Future AI marker: `ai-action-run:<actionRunId>`.
   * Manual UI may omit (null).
   */
  registerIdempotencyKey?: string | null;
};

export type RegisterCapitalContributionResult = {
  contribution: InvestorContribution;
  replayed: boolean;
};

export type ReverseCapitalContributionResult = {
  contribution: InvestorContribution;
  alreadyReversed: boolean;
};

export type UpdateCapitalContributionNotesInput = {
  notes?: string | null;
  /** Optional optimistic concurrency for interactive Admin note edits. */
  expectedUpdatedAt?: Date | string | null;
};

export type UpdateCapitalContributionNotesResult = {
  contribution: InvestorContribution;
  changed: boolean;
};

/** Material financial identity for idempotency / future AI recovery (notes excluded). */
export type CapitalContributionMaterialPayload = {
  investorId: string;
  amount: Prisma.Decimal;
  account: CapitalAccount;
  contributedAt: Date;
};

export const CAPITAL_CONTRIBUTION_IMMUTABLE_MESSAGE =
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
 * Calendar business date for Capital contribution (UTC day bucket).
 * Prefers YYYY-MM-DD; falls back to parsed Date UTC Y/M/D.
 */
export function toContributionDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('Invalid contributedAt');
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
    throw new BadRequestException('Invalid contributedAt');
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function dateBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Canonical Capital contribution — partner equity ledger ONLY.
 *
 * Writes InvestorContribution. Does NOT write TreasuryEntry.
 * Does NOT change ownershipPercent.
 * Does NOT affect P&L / totalBusinessProfit (Option C unchanged).
 * CapitalAccount is a declared funding label (CASH|BANK|CESAR_ACCOUNT), not a
 * Treasury mutation. CESAR_ACCOUNT ≠ TreasuryAccount.CESAR transfer.
 *
 * Not AI-bound in 23A.
 */
@Injectable()
export class CapitalContributionService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    tenantId: string,
    input: RegisterCapitalContributionInput,
  ): Promise<RegisterCapitalContributionResult> {
    if (!ALLOWED_ACCOUNTS.has(input.account)) {
      throw new BadRequestException(
        'Unsupported capital account. Allowed: CASH, BANK, CESAR_ACCOUNT',
      );
    }

    const amount = asDecimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Contribution amount must be greater than 0');
    }

    const contributedAt = toContributionDate(input.contributedAt);
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
      const existing = await this.prisma.investorContribution.findFirst({
        where: { tenantId, registerIdempotencyKey: idempotencyKey },
      });
      if (existing && !existing.deletedAt) {
        this.assertCompatibleReplay(existing, {
          investorId: input.investorId,
          amount,
          account: input.account,
          contributedAt,
        });
        return { contribution: existing, replayed: true };
      }
      if (existing?.deletedAt) {
        throw new ConflictException(
          'registerIdempotencyKey already used by a reversed contribution; use a new key',
        );
      }
    }

    try {
      const contribution = await this.prisma.investorContribution.create({
        data: {
          tenantId,
          investorId: input.investorId,
          amount,
          account: input.account,
          notes,
          contributedAt,
          registerIdempotencyKey: idempotencyKey,
        },
      });
      return { contribution, replayed: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        idempotencyKey
      ) {
        const raced = await this.prisma.investorContribution.findFirst({
          where: { tenantId, registerIdempotencyKey: idempotencyKey },
        });
        if (raced && !raced.deletedAt) {
          this.assertCompatibleReplay(raced, {
            investorId: input.investorId,
            amount,
            account: input.account,
            contributedAt,
          });
          return { contribution: raced, replayed: true };
        }
        throw new ConflictException(
          'registerIdempotencyKey already used with a conflicting contribution payload',
        );
      }
      throw error;
    }
  }

  /**
   * Notes-only mutation. Economic fields are immutable after creation (Commit 23B).
   * Applies to ALL active contribution rows (legacy + keyed).
   */
  async updateNotes(
    tenantId: string,
    contributionId: string,
    input: UpdateCapitalContributionNotesInput,
  ): Promise<UpdateCapitalContributionNotesResult> {
    const contribution = await this.prisma.investorContribution.findFirst({
      where: { id: contributionId, tenantId },
    });
    if (!contribution || contribution.deletedAt) {
      throw new NotFoundException('Contribution not found');
    }

    if (input.expectedUpdatedAt != null && String(input.expectedUpdatedAt).trim() !== '') {
      const expected = new Date(input.expectedUpdatedAt);
      if (Number.isNaN(expected.getTime())) {
        throw new BadRequestException('Invalid expectedUpdatedAt');
      }
      if (contribution.updatedAt.toISOString() !== expected.toISOString()) {
        throw new ConflictException({
          code: 'CAPITAL_CONTRIBUTION_NOTES_STALE',
          message:
            'Las notas fueron actualizadas por otro cambio. Recarga e intenta de nuevo.',
        });
      }
    }

    if (input.notes === undefined) {
      return { contribution, changed: false };
    }

    const notes = normalizeNotes(input.notes);
    if (normalizeNotes(contribution.notes) === notes) {
      return { contribution, changed: false };
    }

    const updated = await this.prisma.investorContribution.update({
      where: { id: contributionId },
      data: { notes },
    });
    return { contribution: updated, changed: true };
  }

  /**
   * Future AI / API recovery classification against material payload.
   * Does not mutate. Not bound to AI in 23B.
   */
  classifyRecovery(
    existing: InvestorContribution | null,
    expected: CapitalContributionMaterialPayload,
  ):
    | 'MATCH'
    | 'STALE_CAPITAL_CONTRIBUTION_REVERSED'
    | 'CANONICAL_CAPITAL_CONTRIBUTION_INVARIANT'
    | 'MISSING' {
    if (!existing) return 'MISSING';
    if (existing.deletedAt) return 'STALE_CAPITAL_CONTRIBUTION_REVERSED';
    try {
      this.assertCompatibleReplay(existing, expected);
      return 'MATCH';
    } catch {
      return 'CANONICAL_CAPITAL_CONTRIBUTION_INVARIANT';
    }
  }

  async reverse(
    tenantId: string,
    contributionId: string,
  ): Promise<ReverseCapitalContributionResult> {
    const contribution = await this.prisma.investorContribution.findFirst({
      where: { id: contributionId, tenantId },
    });
    if (!contribution) throw new NotFoundException('Contribution not found');
    if (contribution.deletedAt) {
      return { contribution, alreadyReversed: true };
    }

    // V1: soft-delete Capital row only. No Treasury leg exists under frozen semantics.
    const linked = await this.prisma.treasuryEntry.findFirst({
      where: { tenantId, contributionId, deletedAt: null },
      select: { id: true },
    });
    if (linked) {
      throw new ConflictException(
        'Contribution has a linked Treasury entry; cash-linked Capital reversal is not enabled in V1',
      );
    }

    const updated = await this.prisma.investorContribution.update({
      where: { id: contributionId },
      data: { deletedAt: new Date() },
    });
    return { contribution: updated, alreadyReversed: false };
  }

  private assertCompatibleReplay(
    existing: InvestorContribution,
    expected: CapitalContributionMaterialPayload,
  ) {
    // Notes are non-material after creation (23B): later notes-only edits must not
    // break idempotent replay / future AI recovery.
    const sameInvestor = existing.investorId === expected.investorId;
    const sameAmount = existing.amount.equals(expected.amount);
    const sameAccount = existing.account === expected.account;
    const sameDate =
      dateBucket(existing.contributedAt) === dateBucket(expected.contributedAt);
    if (!sameInvestor || !sameAmount || !sameAccount || !sameDate) {
      throw new ConflictException(
        'registerIdempotencyKey already used with a conflicting contribution payload',
      );
    }
  }
}

/** Typed rejection when a client attempts economic in-place mutation. */
export function capitalContributionImmutableConflict(): ConflictException {
  return new ConflictException({
    code: 'CAPITAL_CONTRIBUTION_IMMUTABLE',
    message: CAPITAL_CONTRIBUTION_IMMUTABLE_MESSAGE,
  });
}
