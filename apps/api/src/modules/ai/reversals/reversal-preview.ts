import {
  ExpenseReversalSnapshot,
  ReversalPreviewContract,
  TransferReversalSnapshot,
} from './financial-reversal.types';

function money(amount: string, currency = 'MXN'): string {
  const n = Number(amount);
  const formatted = Number.isFinite(n)
    ? n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : amount;
  return `$${formatted} ${currency}`;
}

function accountLabel(account: string | null): string {
  if (account === 'CASH') return 'Efectivo';
  if (account === 'BANK') return 'Bancos';
  if (account === 'CESAR') return 'Cuenta César';
  return 'Sin cuenta';
}

/**
 * Backend-derived expense reversal preview.
 * Legacy (no Treasury provenance): restoresLiquidity=false — never claims cash restore.
 */
export function buildExpenseReversalPreview(
  snapshot: ExpenseReversalSnapshot,
): ReversalPreviewContract {
  const legacyMode = !snapshot.hasCanonicalTreasuryOutflow;
  const restoresLiquidity = snapshot.hasCanonicalTreasuryOutflow && snapshot.sourceAccount != null;
  const effects: ReversalPreviewContract['reversalEffects'] = [
    {
      area: 'Expense',
      description: 'Se revertirá el gasto.',
    },
    {
      area: 'Amount',
      description: `Monto: ${money(snapshot.amount, snapshot.currency)}`,
    },
  ];

  if (restoresLiquidity) {
    effects.push({
      area: 'Treasury',
      description: `Tesorería: +${money(snapshot.amount, snapshot.currency)} (${accountLabel(snapshot.sourceAccount)})`,
    });
  } else {
    effects.push({
      area: 'Treasury',
      description: 'Tesorería: Sin cambios',
    });
  }

  effects.push({
    area: 'Capital',
    description: 'Capital: Sin cambios',
  });

  const concept = snapshot.conceptLabel || snapshot.category;
  return {
    targetCapability: 'REVERSE_EXPENSE',
    targetSafeLabel: `Gasto ${concept} ${money(snapshot.amount, snapshot.currency)}`,
    originalAmount: money(snapshot.amount, snapshot.currency),
    originalDate: snapshot.expenseDate,
    reversalEffects: effects,
    restoresLiquidity,
    changesPnl: true,
    changesCapital: false,
    legacyMode,
    riskTier: 'HIGH',
  };
}

/** Backend-derived transfer reversal preview — total liquidity Δ0. */
export function buildTransferReversalPreview(
  snapshot: TransferReversalSnapshot,
): ReversalPreviewContract {
  const amt = money(snapshot.amount, snapshot.currency);
  return {
    targetCapability: 'REVERSE_TREASURY_TRANSFER',
    targetSafeLabel: `Transferencia ${accountLabel(snapshot.sourceAccount)} → ${accountLabel(snapshot.destinationAccount)} ${amt}`,
    originalAmount: amt,
    originalDate: snapshot.transferDate,
    reversalEffects: [
      {
        area: 'Treasury',
        description: `${accountLabel(snapshot.sourceAccount)}: +${amt}`,
      },
      {
        area: 'Treasury',
        description: `${accountLabel(snapshot.destinationAccount)}: -${amt}`,
      },
      { area: 'Treasury', description: 'Liquidez total: Sin cambio' },
      { area: 'P&L', description: 'P&L: Sin cambio' },
      { area: 'Capital', description: 'Capital: Sin cambio' },
    ],
    restoresLiquidity: false,
    changesPnl: false,
    changesCapital: false,
    legacyMode: false,
    riskTier: 'HIGH',
  };
}
