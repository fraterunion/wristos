import { Prisma } from '@prisma/client';

/**
 * Exact migration description format written by Wrist Caviar bank import:
 *   migration:{sourceCandidateId}; commission={number}; ref={reference|}
 *
 * Used ONLY for one-time backfill — analytics must read TreasuryEntry.commission.
 */
export const MIGRATION_BANK_COMMISSION_DESCRIPTION_RE =
  /^migration:([A-Za-z0-9_]+);\s*commission=([0-9]+(?:\.[0-9]+)?);\s*ref=(.*)$/;

export type ParsedMigrationBankCommission = {
  sourceCandidateId: string;
  commission: Prisma.Decimal;
  reference: string;
};

/**
 * Parse a migration bank description. Rejects malformed / negative / non-exact formats.
 * Returns null when the description is not eligible (not an error for non-migration rows).
 */
export function parseMigrationBankCommissionDescription(
  description: string | null | undefined,
): ParsedMigrationBankCommission | null {
  if (description == null) return null;
  const trimmed = description.trim();
  const match = MIGRATION_BANK_COMMISSION_DESCRIPTION_RE.exec(trimmed);
  if (!match) return null;

  const sourceCandidateId = match[1]!;
  const raw = match[2]!;
  const reference = match[3] ?? '';

  // Reject negatives / scientific notation / trailing junk already blocked by regex.
  if (raw.startsWith('-')) return null;

  try {
    const commission = new Prisma.Decimal(raw);
    if (commission.isNeg()) return null;
    // Preserve scale as provided (Decimal keeps exact decimal string).
    return { sourceCandidateId, commission, reference };
  } catch {
    return null;
  }
}

/** Strict eligibility: must match exact format; throws on malformed migration-like strings. */
export function requireMigrationBankCommission(
  description: string | null | undefined,
): ParsedMigrationBankCommission {
  const parsed = parseMigrationBankCommissionDescription(description);
  if (!parsed) {
    throw new Error(
      `Invalid migration bank commission description: ${JSON.stringify(description)}`,
    );
  }
  return parsed;
}

export const WRIST_CAVIAR_TENANT_ID = 'cmnzph8dm0000qotapt94alxs';
export const WRIST_CAVIAR_BANK_IMPORT_RUN_ID = 'k8n5mrynwn2kl8961texx1m2';

export const EXPECTED_BANK_COMMISSION_TOTALS = {
  migratedBankRows: 520,
  nonZeroRows: 323,
  allTimeTotal: '435289.15',
  july2026Total: '54453.80',
  july2026Rows: 24,
} as const;

export type TreasuryBankCommissionAggregate = {
  total: string;
  movementCount: number;
};

/**
 * Aggregate structured commission > 0. Never uses amount/amountMxn or description parsing.
 */
export function aggregateStructuredBankCommissions(
  rows: Array<{ commission: Prisma.Decimal | null; transactionDate?: Date }>,
  opts?: { from?: Date; toExclusive?: Date },
): TreasuryBankCommissionAggregate {
  let total = new Prisma.Decimal(0);
  let movementCount = 0;
  for (const row of rows) {
    if (row.commission == null) continue;
    if (!(row.commission instanceof Prisma.Decimal)) {
      const asDecimal = new Prisma.Decimal(row.commission as unknown as string);
      if (!asDecimal.greaterThan(0)) continue;
      if (opts?.from && row.transactionDate && row.transactionDate < opts.from) continue;
      if (opts?.toExclusive && row.transactionDate && row.transactionDate >= opts.toExclusive) {
        continue;
      }
      total = total.plus(asDecimal);
      movementCount += 1;
      continue;
    }
    if (!row.commission.greaterThan(0)) continue;
    if (opts?.from && row.transactionDate && row.transactionDate < opts.from) continue;
    if (opts?.toExclusive && row.transactionDate && row.transactionDate >= opts.toExclusive) {
      continue;
    }
    total = total.plus(row.commission);
    movementCount += 1;
  }
  return { total: total.toFixed(2), movementCount };
}

/** Prisma where for structured bank commissions (commission > 0). */
export function structuredBankCommissionWhere(
  tenantId: string,
  dateFilter?: { gte?: Date; lt?: Date; lte?: Date },
): Prisma.TreasuryEntryWhereInput {
  const where: Prisma.TreasuryEntryWhereInput = {
    tenantId,
    account: 'BANK',
    deletedAt: null,
    commission: { gt: 0 },
  };
  if (dateFilter && (dateFilter.gte || dateFilter.lt || dateFilter.lte)) {
    where.transactionDate = {
      ...(dateFilter.gte ? { gte: dateFilter.gte } : {}),
      ...(dateFilter.lt ? { lt: dateFilter.lt } : {}),
      ...(dateFilter.lte ? { lte: dateFilter.lte } : {}),
    };
  }
  return where;
}
