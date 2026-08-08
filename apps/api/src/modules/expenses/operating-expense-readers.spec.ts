import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Architecture gate: active OperatingExpense P&L / list readers must filter deletedAt.
 * Soft-deleted (reversed) expenses must not affect live financial surfaces.
 */
describe('OperatingExpense deletedAt reader audit (15A)', () => {
  const root = join(__dirname, '../..'); // apps/api/src

  function read(rel: string) {
    return readFileSync(join(root, rel), 'utf8');
  }

  it('Analytics monthly profit aggregates exclude soft-deleted expenses', () => {
    const src = read('modules/analytics/analytics.service.ts');
    expect(src).toMatch(
      /operatingExpense\.aggregate\(\{[\s\S]*?deletedAt:\s*null[\s\S]*?expenseDate:/,
    );
    expect(src).toMatch(
      /getMonthlyProfit[\s\S]*operatingExpense\.aggregate\(\{\s*where:\s*\{\s*tenantId,\s*deletedAt:\s*null/,
    );
  });

  it('ExpensesService list/summary where includes deletedAt null', () => {
    const src = read('modules/expenses/expenses.service.ts');
    expect(src).toMatch(/deletedAt:\s*null/);
    expect(src).toMatch(/buildWhere[\s\S]*deletedAt:\s*null/);
  });

  it('History legacy BANK_FEES readers exclude soft-deleted expenses', () => {
    const src = read('modules/history/history.service.ts');
    expect(src).toMatch(
      /operatingExpense\.aggregate\(\{[\s\S]*deletedAt:\s*null[\s\S]*BANK_FEES/,
    );
    expect(src).toMatch(
      /operatingExpenses:\s*\{\s*where:\s*\{\s*category:\s*OperatingExpenseCategory\.BANK_FEES,\s*deletedAt:\s*null/,
    );
  });

  it('Cuentas expense FK validation rejects soft-deleted expenses', () => {
    const src = read('modules/cuentas/cuentas.service.ts');
    expect(src).toMatch(
      /ensureExpenseInTenant[\s\S]*deletedAt:\s*null/,
    );
  });

  it('Capital does not read OperatingExpense (documented Option C gate)', () => {
    const src = read('modules/capital/capital.service.ts');
    expect(src).not.toMatch(/operatingExpense\./);
    expect(src).toMatch(/DOES NOT subtract OperatingExpense/);
  });
});
