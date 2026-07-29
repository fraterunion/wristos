import * as fs from 'fs';
import * as path from 'path';
import { analyzeWristCaviarWorkbook } from '../services/analyze-workbook';

/**
 * Safe issue-distribution dump for Phase 1.5 design.
 * Never prints names, serials, prices, or balances.
 */
describe('phase 1.5 issue distribution (safe)', () => {
  const resolved = path.resolve('/Users/rodrigoponcedeleon/FraterUnion/wristOS/RELOJES CESAR ADMIN.xlsx');
  const maybe = fs.existsSync(resolved) ? it : it.skip;

  maybe('reports issue codes and reconciliation concepts only', async () => {
    const analysis = await analyzeWristCaviarWorkbook(
      fs.readFileSync(resolved),
      'RELOJES CESAR ADMIN.xlsx',
    );

    const byCode: Record<string, number> = {};
    const bySeverityCode: Record<string, Record<string, number>> = {};
    const manualByCodeSheet: Record<string, Record<string, number>> = {};
    const critical: Array<{ code: string; category?: string; sheet?: string }> = [];

    for (const issue of analysis.issues) {
      byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
      const sev = issue.severity;
      bySeverityCode[sev] ??= {};
      bySeverityCode[sev][issue.code] = (bySeverityCode[sev][issue.code] ?? 0) + 1;

      if (issue.severity === 'CRITICAL') {
        critical.push({
          code: issue.code,
          category: issue.category,
          sheet: issue.source?.sourceSheet,
        });
      }
      if (issue.severity === 'MANUAL_REVIEW') {
        const sheet = issue.source?.sourceSheet ?? '(none)';
        manualByCodeSheet[issue.code] ??= {};
        manualByCodeSheet[issue.code][sheet] =
          (manualByCodeSheet[issue.code][sheet] ?? 0) + 1;
      }
    }

    const recon = analysis.reconciliation
      .filter((r) => r.status === 'MISMATCH' || r.status === 'SCOPE_REVIEW_REQUIRED')
      .map((r) => ({ concept: r.concept, currency: r.currency, status: r.status }));

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          readiness: analysis.readiness,
          critical,
          bySeverityCode,
          byCode,
          manualByCodeSheet,
          reconFocus: recon,
          deferredCounts: {
            crypto: analysis.crypto.length,
            externalFloat: analysis.externalFloat.length,
          },
          customerDuplicateSuggestions: analysis.customers.filter(
            (c) => c.duplicateSuggestions.length > 0,
          ).length,
          ambiguousReceivables: analysis.receivables.filter((r) => r.ambiguous).length,
          ambiguousPayables: analysis.payables.filter((p) => p.ambiguous).length,
          formulaErrorPayables: analysis.payables.filter((p) => p.formulaErrors.length > 0)
            .length,
        },
        null,
        2,
      ),
    );
  }, 60000);
});
