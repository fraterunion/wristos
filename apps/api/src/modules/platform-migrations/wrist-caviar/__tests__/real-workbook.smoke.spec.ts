import * as fs from 'fs';
import * as path from 'path';

import { analyzeWristCaviarWorkbook } from '../services/analyze-workbook';

describe('real workbook smoke (local only)', () => {
  const workbookPath = path.resolve(process.cwd(), '../../RELOJES CESAR ADMIN.xlsx');
  const altPath = path.resolve(process.cwd(), '../../../RELOJES CESAR ADMIN.xlsx');
  const resolved = fs.existsSync(workbookPath)
    ? workbookPath
    : fs.existsSync(altPath)
      ? altPath
      : path.resolve('/Users/rodrigoponcedeleon/FraterUnion/wristOS/RELOJES CESAR ADMIN.xlsx');

  const maybe = fs.existsSync(resolved) ? it : it.skip;

  maybe('parses acceptance-scale counts without operational writes', async () => {
    const buf = fs.readFileSync(resolved);
    const analysis = await analyzeWristCaviarWorkbook(buf, 'RELOJES CESAR ADMIN.xlsx');

    // Safe summary only — no names/serials/amounts
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        readiness: analysis.readiness,
        parserVersion: analysis.parserVersion,
        fingerprintPrefix: analysis.fingerprintPrefix,
        durationMs: analysis.durationMs,
        counts: analysis.counts,
        issueSummary: analysis.issueSummary,
        sheetStatuses: analysis.sheets.map((s) => ({
          sheet: s.sheetName,
          classification: s.classification,
          status: s.status,
          detectedRecords: s.detectedRecords,
          warnings: s.warningCount,
          errors: s.errorCount,
        })),
        reconciliationStatuses: analysis.reconciliation.reduce(
          (acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
        operationalWrites: analysis.operationalWrites,
      }),
    );

    expect(analysis.operationalWrites).toBe(0);
    expect(analysis.parserVersion).toBe('wrist-caviar-master-xlsx-v1');
    expect(analysis.counts.sales).toBe(469);
    expect(analysis.counts.expenses).toBe(287);
    expect(analysis.counts.bankMovements).toBe(520);
    expect(analysis.counts.inventory).toBeGreaterThanOrEqual(35);
    expect(analysis.counts.inventory).toBeLessThanOrEqual(50);
    expect(analysis.counts.cashHidden).toBeGreaterThan(500);
    expect(['READY_FOR_DRY_RUN', 'NEEDS_REVIEW', 'BLOCKED']).toContain(analysis.readiness);
    expect(analysis.readiness).not.toBe('BLOCKED');
  }, 60000);
});
