type Coercible = { toString(): string } | number | string;

export function computeEffectiveCost(
  baseCost: Coercible,
  expenses: Array<{ amount: Coercible }>,
): string {
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  return (Number(baseCost) + total).toFixed(2);
}
