import { resolveExpenseCategory } from '../../../../../scripts/migrations/wrist-caviar/rules/expense.rules';

describe('expense category normalization precedence', () => {
  const bankCases = [
    'comisión bancaria',
    'comisiones bancarias',
    'comisión BBVA',
    'comisión Santander',
    'comisión SPEI',
    'cargo bancario',
    'bank fee',
  ];

  const salesCases = [
    'comisión JP',
    'comisión Lafaurie',
    'comisión de venta',
    'comisión vendedor',
  ];

  it.each(bankCases)('maps %s → BANK_FEES', (label) => {
    expect(resolveExpenseCategory(label).category).toBe('BANK_FEES');
  });

  it.each(salesCases)('maps %s → COMMISSIONS', (label) => {
    expect(resolveExpenseCategory(label).category).toBe('COMMISSIONS');
  });

  it('never maps internet to BANK_FEES', () => {
    expect(resolveExpenseCategory('internet').category).toBe('OTHER');
  });

  it('bank-specific expressions beat generic commission matching', () => {
    // Regression: previously /comision|comisión/ ran first and stole "comisión bancaria".
    expect(resolveExpenseCategory('comisión bancaria').category).toBe('BANK_FEES');
    expect(resolveExpenseCategory('comisiones bancarias').category).toBe('BANK_FEES');
  });
});
