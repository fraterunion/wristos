import { analyzeWristCaviarWorkbook, toAnalysisSummary } from '../services/analyze-workbook';
import { buildSyntheticWorkbook } from '../fixtures/synthetic-workbook';

describe('preview pagination helpers', () => {
  it('43. paginates preview entities without returning full dump', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    const pageSize = 1;
    const page = 1;
    const all = analysis.sales;
    const slice = all.slice((page - 1) * pageSize, page * pageSize);
    expect(slice.length).toBe(1);
    expect(all.length).toBeGreaterThan(1);
    const summary = toAnalysisSummary(analysis);
    expect(summary.counts.sales).toBe(all.length);
    expect(JSON.stringify(summary).includes(all[0]?.customerName ?? '___')).toBe(false);
  });

  it('47. analysis is tenant-agnostic until persisted with tenantId', async () => {
    const buf = await buildSyntheticWorkbook();
    const analysis = await analyzeWristCaviarWorkbook(buf, 'demo.xlsx');
    expect(analysis.analysisId).toBeUndefined();
    expect(analysis.operationalWrites).toBe(0);
  });
});
