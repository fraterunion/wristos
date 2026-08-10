import { Injectable } from '@nestjs/common';
import { OperatingExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildExpenseFingerprintInput,
  expenseOutflowProvenanceKey,
  expenseReversalFingerprint,
  expenseReversalSnapshot,
  utcDayBucket,
} from './expense-reversal-fingerprint';
import { TrustedReversalTarget } from './financial-reversal.types';

export type ExpenseReversalSearchQuery = {
  amount?: Prisma.Decimal | number | string | null;
  category?: OperatingExpenseCategory | null;
  sourceAccount?: 'CASH' | 'BANK' | 'CESAR' | null;
  expenseDate?: Date | string | null;
  /** Soft concept/notes contains — deterministic ILIKE, not fuzzy LLM. */
  conceptContains?: string | null;
  limit?: number;
};

export type ExpenseReversalResolveResult =
  | { kind: 'TRUSTED'; target: TrustedReversalTarget }
  | {
      kind: 'AMBIGUOUS';
      candidates: Array<{
        ordinal: number;
        label: string;
        /** Internal only — never sent to provider as authoritative. */
        targetId: string;
      }>;
    }
  | { kind: 'NONE' }
  | { kind: 'ALREADY_REVERSED'; targetId: string; safeLabel: string };

/**
 * Read-only expense reversal target resolver (26A).
 * Does NOT reverse. Does NOT trust provider IDs.
 */
@Injectable()
export class ExpenseReversalTargetResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve from a previously trusted selected expense id (working context / receipt).
   * Still re-loads from DB and builds fingerprint — never trusts caller economics.
   */
  async resolveTrustedId(
    tenantId: string,
    expenseId: string,
  ): Promise<ExpenseReversalResolveResult> {
    const expense = await this.prisma.operatingExpense.findFirst({
      where: { id: expenseId, tenantId },
    });
    if (!expense) return { kind: 'NONE' };

    const treasury = await this.prisma.treasuryEntry.findFirst({
      where: {
        tenantId,
        provenanceKey: expenseOutflowProvenanceKey(expense.id),
      },
      select: { id: true, deletedAt: true },
    });

    const snapshot = expenseReversalSnapshot(expense, treasury);
    const safeLabel = `${snapshot.category} ${snapshot.amount} ${snapshot.currency}`;

    if (expense.deletedAt) {
      return { kind: 'ALREADY_REVERSED', targetId: expense.id, safeLabel };
    }

    const fpInput = buildExpenseFingerprintInput(expense, treasury);
    const target: TrustedReversalTarget = {
      capability: 'REVERSE_EXPENSE',
      targetType: 'OPERATING_EXPENSE',
      targetId: expense.id,
      tenantId,
      targetFingerprint: expenseReversalFingerprint(fpInput),
      targetSnapshot: snapshot,
      observedAt: new Date().toISOString(),
    };
    return { kind: 'TRUSTED', target };
  }

  /**
   * Deterministic search among ACTIVE expenses only.
   * 0 → NONE, 1 → TRUSTED, 2+ → AMBIGUOUS picker.
   * Never returns cross-tenant rows. Never accepts provider id filters.
   */
  async resolveSearch(
    tenantId: string,
    query: ExpenseReversalSearchQuery,
  ): Promise<ExpenseReversalResolveResult> {
    const where: Prisma.OperatingExpenseWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.category) where.category = query.category;
    if (query.sourceAccount) where.sourceAccount = query.sourceAccount;
    if (query.amount != null && query.amount !== '') {
      where.amount = new Prisma.Decimal(query.amount);
    }
    const day = utcDayBucket(query.expenseDate ?? null);
    if (day) {
      where.expenseDate = new Date(`${day}T00:00:00.000Z`);
    }
    if (query.conceptContains && query.conceptContains.trim()) {
      where.notes = { contains: query.conceptContains.trim(), mode: 'insensitive' };
    }

    const limit = Math.min(Math.max(query.limit ?? 8, 1), 20);
    const rows = await this.prisma.operatingExpense.findMany({
      where,
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      take: limit + 1,
    });

    if (rows.length === 0) return { kind: 'NONE' };

    if (rows.length === 1) {
      return this.resolveTrustedId(tenantId, rows[0]!.id);
    }

    const candidates = rows.slice(0, limit).map((e, i) => {
      const dayLabel = utcDayBucket(e.expenseDate) ?? '';
      const concept =
        typeof e.notes === 'string' && e.notes.trim()
          ? e.notes.trim().slice(0, 40)
          : e.category;
      return {
        ordinal: i + 1,
        label: `${e.amount.toFixed(0)} ${e.currency} · ${concept} · ${e.sourceAccount ?? '—'} · ${dayLabel}`,
        targetId: e.id,
      };
    });
    return { kind: 'AMBIGUOUS', candidates };
  }
}
