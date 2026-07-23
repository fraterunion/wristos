import { Prisma } from '@prisma/client';

/**
 * Canonical business date for a completed sale.
 * Historical imports set `soldAt`; legacy deals fall back to updatedAt/createdAt.
 */
export function effectiveSaleDate(deal: {
  soldAt?: Date | null;
  updatedAt: Date;
  createdAt?: Date | null;
}): Date {
  return deal.soldAt ?? deal.updatedAt ?? deal.createdAt ?? deal.updatedAt;
}

/**
 * Prisma filter for CLOSED_WON deals whose effective sale date is in [start, endExclusive).
 * Uses soldAt when present; otherwise updatedAt (legacy).
 */
export function dealEffectiveSaleDateRangeWhere(
  start: Date,
  endExclusive: Date,
): Prisma.DealWhereInput {
  return {
    OR: [
      { soldAt: { gte: start, lt: endExclusive } },
      { soldAt: null, updatedAt: { gte: start, lt: endExclusive } },
    ],
  };
}

/**
 * Inclusive end variant for series windows that use lte end.
 */
export function dealEffectiveSaleDateInclusiveRangeWhere(
  start: Date,
  endInclusive: Date,
): Prisma.DealWhereInput {
  return {
    OR: [
      { soldAt: { gte: start, lte: endInclusive } },
      { soldAt: null, updatedAt: { gte: start, lte: endInclusive } },
    ],
  };
}
