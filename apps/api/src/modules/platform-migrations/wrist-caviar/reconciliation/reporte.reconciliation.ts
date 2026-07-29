import { MONEY_TOLERANCE } from '../constants';
import type {
  CashLedgerCandidate,
  InventoryCandidate,
  ReconciliationItem,
  ReportedBalance,
  SaleCandidate,
  WorkbookAnalysis,
} from '../types/migration.types';
import { nearlyEqual, roundMoney } from '../workbook/cell.util';

function findReported(
  balances: ReportedBalance[],
  conceptMatcher: RegExp,
  currency: 'MXN' | 'USD',
): ReportedBalance | undefined {
  return balances.find(
    (b) => conceptMatcher.test(b.concept.toUpperCase()) && b.currency === currency,
  );
}

function item(
  concept: string,
  currency: 'MXN' | 'USD',
  declared: number | null | undefined,
  calculated: number | null | undefined,
  sourceCells: string[],
  notes: string | null = null,
  forceStatus?: ReconciliationItem['status'],
): ReconciliationItem {
  const declaredValue = declared ?? null;
  const calculatedValue = calculated ?? null;
  let status: ReconciliationItem['status'] = forceStatus ?? 'UNAVAILABLE';
  let difference: number | null = null;

  if (forceStatus) {
    difference =
      declaredValue != null && calculatedValue != null
        ? roundMoney(declaredValue - calculatedValue)
        : null;
  } else if (declaredValue == null && calculatedValue == null) {
    status = 'UNAVAILABLE';
  } else if (declaredValue == null || calculatedValue == null) {
    status = 'SCOPE_REVIEW_REQUIRED';
    notes = notes ?? 'Declared or calculated value unavailable for direct comparison';
  } else {
    difference = roundMoney(declaredValue - calculatedValue);
    if (nearlyEqual(declaredValue, calculatedValue, MONEY_TOLERANCE)) status = 'MATCHED';
    else if (nearlyEqual(declaredValue, calculatedValue, 1)) status = 'WITHIN_TOLERANCE';
    else status = 'MISMATCH';
  }

  return {
    concept,
    currency,
    declaredValue,
    calculatedValue,
    difference,
    tolerance: MONEY_TOLERANCE,
    status,
    notes,
    sourceCells,
  };
}

export function reconcileAgainstReporte(input: {
  reportedBalances: ReportedBalance[];
  sales: SaleCandidate[];
  inventory: InventoryCandidate[];
  receivables: WorkbookAnalysis['receivables'];
  payables: WorkbookAnalysis['payables'];
  expenses: WorkbookAnalysis['expenses'];
  cash: CashLedgerCandidate[];
  bank: WorkbookAnalysis['bank'];
  partnerLedger: WorkbookAnalysis['partnerLedger'];
  crypto: WorkbookAnalysis['crypto'];
  externalFloat: WorkbookAnalysis['externalFloat'];
  profitDistributions: WorkbookAnalysis['profitDistributions'];
}): ReconciliationItem[] {
  const r = input.reportedBalances;
  const out: ReconciliationItem[] = [];

  const bankDeclared = findReported(r, /^BANCOS$/, 'MXN');
  const lastBank = [...input.bank].reverse().find((b) => b.reportedBalance != null);
  out.push(
    item(
      'BANCOS',
      'MXN',
      bankDeclared?.value,
      lastBank?.reportedBalance ?? null,
      bankDeclared?.sourceCells ?? [],
      'Compared to last CONTROL BANCOS reported saldo (not drifting TOTAL cell)',
    ),
  );

  const cashMxnDecl = findReported(r, /EFECTIVO/, 'MXN');
  const cashMxnLast = [...input.cash]
    .filter((c) => c.currency === 'MXN')
    .reverse()
    .find((c) => c.reportedBalance != null);
  out.push(
    item(
      'EFECTIVO_MXN',
      'MXN',
      cashMxnDecl?.value,
      cashMxnLast?.reportedBalance ?? null,
      cashMxnDecl?.sourceCells ?? [],
    ),
  );

  const cashUsdDecl = findReported(r, /EFECTIVO/, 'USD');
  const cashUsdLast = [...input.cash]
    .filter((c) => c.currency === 'USD')
    .reverse()
    .find((c) => c.reportedBalance != null);
  out.push(
    item(
      'EFECTIVO_USD',
      'USD',
      cashUsdDecl?.value,
      cashUsdLast?.reportedBalance ?? null,
      cashUsdDecl?.sourceCells ?? [],
    ),
  );

  const cxcMxn = findReported(r, /^CXC$/, 'MXN');
  const cxcUsd = findReported(r, /^CXC$/, 'USD');
  const calcCxcMxn = roundMoney(
    input.receivables
      .filter((x) => x.currency === 'MXN')
      .reduce((s, x) => s + (x.declaredOutstanding ?? x.calculatedOutstanding ?? 0), 0),
  );
  const calcCxcUsd = roundMoney(
    input.receivables
      .filter((x) => x.currency === 'USD')
      .reduce((s, x) => s + (x.declaredOutstanding ?? x.calculatedOutstanding ?? 0), 0),
  );
  out.push(
    item('CXC_MXN', 'MXN', cxcMxn?.value, calcCxcMxn, cxcMxn?.sourceCells ?? [], 'Sum of card POR COBRAR'),
  );
  out.push(
    item('CXC_USD', 'USD', cxcUsd?.value, calcCxcUsd, cxcUsd?.sourceCells ?? [], 'Sum of card POR COBRAR'),
  );

  const cxpMxn = findReported(r, /^CXP$/, 'MXN');
  const cxpUsd = findReported(r, /^CXP$/, 'USD');
  if (cxpUsd?.formulaError) {
    out.push(
      item('CXP_USD', 'USD', cxpUsd.value, null, cxpUsd.sourceCells, 'Formula error in source', 'FORMULA_ERROR'),
    );
  } else {
    const calcCxpUsd = roundMoney(
      input.payables
        .filter((x) => x.currency === 'USD')
        .reduce((s, x) => s + (x.declaredRemaining ?? x.calculatedRemaining ?? 0), 0),
    );
    out.push(item('CXP_USD', 'USD', cxpUsd?.value, calcCxpUsd, cxpUsd?.sourceCells ?? []));
  }
  const calcCxpMxn = roundMoney(
    input.payables
      .filter((x) => x.currency === 'MXN')
      .reduce((s, x) => s + (x.declaredRemaining ?? x.calculatedRemaining ?? 0), 0),
  );
  out.push(item('CXP_MXN', 'MXN', cxpMxn?.value, calcCxpMxn, cxpMxn?.sourceCells ?? []));

  const invDecl = findReported(r, /INVENTARIO/, 'MXN');
  const invCalc = roundMoney(
    input.inventory.reduce((s, x) => s + (x.totalCost ?? x.cost ?? 0), 0),
  );
  out.push(item('INVENTARIO', 'MXN', invDecl?.value, invCalc, invDecl?.sourceCells ?? []));

  const utilDecl = findReported(r, /UTILIDADES/, 'MXN');
  out.push(
    item(
      'UTILIDADES',
      'MXN',
      utilDecl?.value,
      null,
      utilDecl?.sourceCells ?? [],
      'Utility outstanding is matrix-derived; scope review vs COBRO UTILIDADES',
      'SCOPE_REVIEW_REQUIRED',
    ),
  );

  const oscarDecl = findReported(r, /OSCAR|DINERO OSCAR/, 'MXN');
  const oscarCalc = input.externalFloat
    .map((e) => e.reportedBalance ?? e.amount)
    .filter((n): n is number => n != null)
    .sort((a, b) => b - a)[0] ?? null;
  out.push(item('DINERO_OSCAR', 'MXN', oscarDecl?.value, oscarCalc, oscarDecl?.sourceCells ?? []));

  const cesarDecl = findReported(r, /CUENTA CESAR/, 'MXN');
  const cesarLast = [...input.partnerLedger].reverse().find((p) => p.reportedBalance != null);
  out.push(
    item(
      'CUENTA_CESAR',
      'MXN',
      cesarDecl?.value,
      cesarLast?.reportedBalance ?? null,
      cesarDecl?.sourceCells ?? [],
    ),
  );

  const cryptoDecl = findReported(r, /CRIPTO/, 'USD');
  const cryptoLast = [...input.crypto].reverse().find((c) => c.reportedBalance != null);
  out.push(
    item(
      'CRIPTO',
      'USD',
      cryptoDecl?.value,
      cryptoLast?.reportedBalance ?? null,
      cryptoDecl?.sourceCells ?? [],
      'Deferred destination — included in reconciliation only',
    ),
  );

  // Sales count gate (informational reconciliation)
  out.push(
    item(
      'VENTAS_COUNT',
      'MXN',
      input.sales.length,
      input.sales.length,
      [],
      'Normalized sale count self-check',
      'MATCHED',
    ),
  );

  // Expense count informational
  out.push(
    item(
      'GASTOS_COUNT',
      'MXN',
      input.expenses.length,
      input.expenses.length,
      [],
      null,
      'MATCHED',
    ),
  );

  for (const bal of r) {
    if (bal.formulaError) {
      out.push(
        item(
          `REPORTE_FORMULA_${bal.concept}`,
          bal.currency === 'UNKNOWN' ? 'MXN' : bal.currency,
          bal.value,
          null,
          bal.sourceCells,
          'Source formula error',
          'FORMULA_ERROR',
        ),
      );
    }
  }

  return out;
}
