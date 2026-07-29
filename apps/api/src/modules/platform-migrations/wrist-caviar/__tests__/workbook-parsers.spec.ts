import { analyzeWristCaviarWorkbook } from '../services/analyze-workbook';
import { loadAndValidateWorkbook } from '../workbook/workbook-loader';
import { normalizeCustomerName, classifyNameSimilarity } from '../normalization/customer-normalize';
import { buildMacroLikeBuffer, buildSyntheticWorkbook } from '../fixtures/synthetic-workbook';
import { PARSER_VERSION } from '../constants';

describe('Wrist Caviar workbook Phase 1 parsers', () => {
  it('1. recognizes a valid workbook', async () => {
    const buf = await buildSyntheticWorkbook();
    const loaded = await loadAndValidateWorkbook(buf, 'demo.xlsx');
    expect(loaded.blocked).toBe(false);
    expect(loaded.sheetNames).toEqual(
      expect.arrayContaining(['VENTAS', 'INVENTARIO', 'REPORTE']),
    );
  });

  it('2. rejects invalid file signature', async () => {
    const loaded = await loadAndValidateWorkbook(Buffer.from('not-xlsx'), 'demo.xlsx');
    expect(loaded.blocked).toBe(true);
    expect(loaded.issues.some((i) => i.code === 'INVALID_SIGNATURE')).toBe(true);
  });

  it('3. rejects macro-like files', async () => {
    const buf = await buildMacroLikeBuffer();
    const loaded = await loadAndValidateWorkbook(buf, 'demo.xlsm');
    expect(loaded.blocked).toBe(true);
    expect(loaded.issues.some((i) => i.code === 'MACRO_ENABLED' || i.code === 'INVALID_EXTENSION')).toBe(
      true,
    );
  });

  it('4. blocks missing core sheet', async () => {
    const buf = await buildSyntheticWorkbook({ omitVentas: true });
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.readiness).toBe('BLOCKED');
    expect(analysis.missingCoreSheets).toContain('VENTAS');
  });

  it('5. reports unknown extra sheet without parsing it', async () => {
    const buf = await buildSyntheticWorkbook({ includeExtraSheet: true });
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.unknownSheets).toContain('HOJA RARA');
    expect(analysis.sheets.some((s) => s.sheetName === 'HOJA RARA' && s.status === 'UNKNOWN_SHEET')).toBe(
      true,
    );
  });

  it('6-10. parses VENTAS with headers, months, dates, profit, duplicates', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.counts.sales).toBeGreaterThanOrEqual(3);
    expect(analysis.sales.some((s) => s.profitMismatch)).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'DUPLICATE_SOLD_SERIAL')).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'SALE_PROFIT_MISMATCH')).toBe(true);
    expect(analysis.parserVersion).toBe(PARSER_VERSION);
  });

  it('11-14. inventory summary rejection, sparse serial, overlap', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.inventory.every((i) => i.brand.toUpperCase() !== 'TOTAL')).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'SPARSE_OR_POLLUTED_SERIAL')).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'SOLD_SERIAL_IN_INVENTORY')).toBe(true);
  });

  it('15-19. CXC left/right cards, payments, mismatch, ambiguous', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.receivables.length).toBeGreaterThanOrEqual(3);
    const right = analysis.receivables.find((r) => r.currency === 'USD');
    expect(right?.payments.length).toBeGreaterThanOrEqual(2);
    expect(analysis.issues.some((i) => i.code === 'RECEIVABLE_BALANCE_MISMATCH')).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'AMBIGUOUS_CXC_BLOCK')).toBe(true);
  });

  it('20-23. CXP ACREDOR/AACREDOR, broken formula, payments, mismatch', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.payables.some((p) => /AA?CREDOR/i.test(p.creditorLabelRaw))).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'FORMULA_ERROR')).toBe(true);
    expect(analysis.payables.some((p) => p.payments.length > 0)).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'PAYABLE_BALANCE_MISMATCH')).toBe(true);
  });

  it('24. expense parsing', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.counts.expenses).toBe(1);
  });

  it('25-28. efectivo hidden rows, MXN/USD, exchange rate', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.cash.some((c) => c.hidden)).toBe(true);
    expect(analysis.cash.some((c) => c.currency === 'MXN')).toBe(true);
    expect(analysis.cash.some((c) => c.currency === 'USD' && c.exchangeRate === 17.5)).toBe(true);
  });

  it('29-33. bank deposit/withdrawal/commission/1%/drift', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.bank.some((b) => (b.deposit ?? 0) > 0)).toBe(true);
    expect(analysis.bank.some((b) => (b.withdrawal ?? 0) > 0)).toBe(true);
    expect(analysis.bank.some((b) => b.onePercentRuleStatus === 'MATCHED')).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'BANK_TOTAL_CELL_DRIFT')).toBe(true);
  });

  it('34-35. Cesar running balance and unclassified', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.partnerLedger.length).toBeGreaterThan(0);
    expect(analysis.partnerLedger.every((p) => p.classification === 'UNCLASSIFIED')).toBe(true);
    expect(analysis.issues.some((i) => i.code === 'UNCLASSIFIED_CESAR_MOVEMENT')).toBe(true);
  });

  it('36. 75/25 profit split validation', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.profitDistributions.length).toBeGreaterThan(0);
    // synthetic 75/25 should not mismatch
    expect(analysis.issues.some((i) => i.code === 'PROFIT_SPLIT_MISMATCH')).toBe(false);
  });

  it('37-40. REPORTE reconciliation statuses exist', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.reconciliation.length).toBeGreaterThan(0);
    expect(analysis.reconciliation.some((r) => r.status === 'MATCHED' || r.status === 'MISMATCH')).toBe(
      true,
    );
    expect(analysis.reconciliation.some((r) => r.status === 'SCOPE_REVIEW_REQUIRED')).toBe(true);
    expect(analysis.operationalWrites).toBe(0);
  });

  it('41-42. customer exact normalization; accent remains review', () => {
    expect(normalizeCustomerName('  Juan   Pérez. ')).toBe('juan pérez');
    expect(classifyNameSimilarity('jose', 'josé')).toBe('ACCENT_VARIANT');
    expect(classifyNameSimilarity('juan perez', 'juan perez')).toBe('EXACT_NORMALIZED_MATCH');
  });

  it('48. analysis never claims operational writes', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.operationalWrites).toBe(0);
  });

  it('49. does not embed workbook bytes in issue messages', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    const blob = JSON.stringify(analysis.issues);
    expect(blob.includes('PK\u0003\u0004')).toBe(false);
  });
});
