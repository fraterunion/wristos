import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

export function dec(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function money2(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function holdingCostBasis(
  quantity: Prisma.Decimal,
  averageCostMxn: Prisma.Decimal,
): Prisma.Decimal {
  return quantity.mul(averageCostMxn);
}

export function holdingCurrentValue(
  quantity: Prisma.Decimal,
  latestPriceMxn: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (latestPriceMxn == null) return null;
  return quantity.mul(latestPriceMxn);
}

export function unrealizedPnl(
  currentValue: Prisma.Decimal | null,
  costBasis: Prisma.Decimal,
): Prisma.Decimal | null {
  if (currentValue == null) return null;
  return currentValue.minus(costBasis);
}

export function unrealizedPnlPercent(
  pnl: Prisma.Decimal | null,
  costBasis: Prisma.Decimal,
): string | null {
  if (pnl == null) return null;
  if (costBasis.equals(ZERO)) return null;
  return pnl.div(costBasis).mul(HUNDRED).toFixed(2);
}

export { ZERO };
