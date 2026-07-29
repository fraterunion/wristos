import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildSyntheticWorkbook } from '../fixtures/synthetic-workbook';
import { buildPackage } from '../../../../../../../scripts/migrations/wrist-caviar/build-package';
import {
  FINAL_DECISION_IDS,
  generateHumanReview,
} from '../../../../../../../scripts/migrations/wrist-caviar/generate-human-review';
import {
  mergeFinalIntoResolutions,
  validateFinalResolutions,
} from '../../../../../../../scripts/migrations/wrist-caviar/apply-resolutions';
import { emptyResolutionsTemplate } from '../../../../../../../scripts/migrations/wrist-caviar/resolutions.schema';
import { writeExpenseCategoryAudit } from '../../../../../../../scripts/migrations/wrist-caviar/generate-audits';
import {
  classifyPartnerMovement,
} from '../../../../../../../scripts/migrations/wrist-caviar/rules/partner.rules';

const REAL_WB = path.resolve(process.cwd(), '../../RELOJES CESAR ADMIN.xlsx');
const hasReal = fs.existsSync(REAL_WB);

describe('wrist-caviar final decision packet', () => {
  it('4-6. invalid / missing / contradictory final resolutions rejected', () => {
    const base = {
      version: 1 as const,
      migrationSource: 'wrist-caviar-master-workbook-v1',
      decisions: FINAL_DECISION_IDS.map((id, i) => ({
        decisionId: id,
        area: id.startsWith('CXC')
          ? ('CXC' as const)
          : id.startsWith('CXP')
            ? ('CXP' as const)
            : id.startsWith('SALE')
              ? ('SALE' as const)
              : ('REPORTE' as const),
        issueIds: [`issue_${i}`],
        allowedResolutionTypes: [],
        resolutionType: id.startsWith('SALE')
          ? 'ACCEPT_CALCULATED_PROFIT'
          : id.startsWith('REPORT')
            ? 'ACKNOWLEDGE_SCOPE_DIFFERENCE'
            : 'ACCEPT_SOURCE_OUTSTANDING',
        approvedValue: null,
        reason: 'ok',
        actor: 'tester',
        date: '2026-07-29',
      })),
    };
    expect(validateFinalResolutions(base).decisions).toHaveLength(15);

    expect(() =>
      validateFinalResolutions({
        ...base,
        decisions: base.decisions.map((d, i) =>
          i === 0 ? { ...d, resolutionType: 'MAP_TO_EXISTING' } : d,
        ),
      }),
    ).toThrow(/invalid resolutionType/);

    expect(() =>
      validateFinalResolutions({
        ...base,
        decisions: base.decisions.map((d, i) =>
          i === 0
            ? { ...d, resolutionType: 'CORRECT_PRINCIPAL', approvedValue: null }
            : d,
        ),
      }),
    ).toThrow(/approvedValue required/);

    expect(() =>
      validateFinalResolutions({
        ...base,
        decisions: base.decisions.map((d, i) =>
          i === 1 ? { ...d, issueIds: ['issue_0'] } : d,
        ),
      }),
    ).toThrow(/Contradictory/);
  });

  it('11. suspicious partner concepts do not classify by sign alone', () => {
    expect(
      classifyPartnerMovement({
        entryAmount: null,
        exitAmount: 1,
        classification: 'UNCLASSIFIED',
        concept: 'reembolso anticipo',
      }).classification,
    ).toBe('UNCLASSIFIED');
  });

  it('7+14. resolution merge preserves defer provenance and zero-write rebuild is deterministic', async () => {
    const buf = await buildSyntheticWorkbook();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-final-'));
    const workbook = path.join(dir, 'synthetic.xlsx');
    fs.writeFileSync(workbook, buf);
    const resolutions = path.join(dir, 'resolutions.json');
    fs.writeFileSync(
      resolutions,
      JSON.stringify({
        version: 1,
        migrationSource: 'wrist-caviar-master-workbook-v1',
        notes: 'test',
        resolutions: [
          {
            id: 'res_defer_crypto',
            resolutionType: 'DEFER',
            reason: 'crypto',
            actor: 'test',
            date: '2026-07-28',
            resolvedValue: { group: 'CRIPTO_CESAR' },
          },
          {
            id: 'res_defer_oscar',
            resolutionType: 'DEFER',
            reason: 'oscar',
            actor: 'test',
            date: '2026-07-28',
            resolvedValue: { group: 'OSCAR_PAPA_CAMI' },
          },
        ],
      }),
    );

    const a = await buildPackage({
      workbookPath: workbook,
      resolutionsPath: resolutions,
      outRoot: path.join(dir, 'out'),
      allowOutOfRangeCounts: true,
    });
    const b = await buildPackage({
      workbookPath: workbook,
      resolutionsPath: resolutions,
      outRoot: path.join(dir, 'out2'),
      allowOutOfRangeCounts: true,
    });
    expect(a.packageFingerprint).toBe(b.packageFingerprint);

    const base = emptyResolutionsTemplate('fp');
    const final = validateFinalResolutions({
      version: 1,
      migrationSource: 'wrist-caviar-master-workbook-v1',
      decisions: FINAL_DECISION_IDS.map((id, i) => ({
        decisionId: id,
        area: id.startsWith('CXC')
          ? 'CXC'
          : id.startsWith('CXP')
            ? 'CXP'
            : id.startsWith('SALE')
              ? 'SALE'
              : 'REPORTE',
        issueIds: [`x_${i}`],
        allowedResolutionTypes: [],
        resolutionType: id.startsWith('SALE')
          ? 'ACCEPT_CALCULATED_PROFIT'
          : id.startsWith('REPORT')
            ? 'KEEP_BLOCKED'
            : 'EXCLUDE_INVALID_CARD',
        approvedValue: null,
        reason: 'test',
        actor: 'tester',
        date: '2026-07-29',
      })),
    });
    const merged = mergeFinalIntoResolutions(base, final);
    expect(merged.resolutions.some((r) => r.id === 'res_defer_crypto')).toBe(true);
    expect(merged.resolutions.some((r) => r.id.startsWith('res_cxc-'))).toBe(true);

    const audit = writeExpenseCategoryAudit({
      outDir: dir,
      candidates: JSON.parse(fs.readFileSync(path.join(a.packageDir, 'candidates.json'), 'utf8')),
    });
    expect(audit.total).toBe(audit.specific + audit.other);
  }, 60_000);

  const maybe = hasReal ? it : it.skip;
  maybe('1-3+13. real workbook emits exactly 15 decisions covering CXC/CXP/SALE conflicts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-real-final-'));
    const resolutions = path.join(dir, 'resolutions.json');
    fs.writeFileSync(
      resolutions,
      JSON.stringify({
        version: 1,
        migrationSource: 'wrist-caviar-master-workbook-v1',
        notes: 'test',
        resolutions: [
          {
            id: 'res_defer_crypto',
            resolutionType: 'DEFER',
            reason: 'crypto',
            actor: 'test',
            date: '2026-07-28',
            resolvedValue: { group: 'CRIPTO_CESAR' },
          },
          {
            id: 'res_defer_oscar',
            resolutionType: 'DEFER',
            reason: 'oscar',
            actor: 'test',
            date: '2026-07-28',
            resolvedValue: { group: 'OSCAR_PAPA_CAMI' },
          },
        ],
      }),
    );
    const built = await buildPackage({
      workbookPath: REAL_WB,
      resolutionsPath: resolutions,
      outRoot: path.join(dir, 'out'),
      allowOutOfRangeCounts: true,
    });
    const candidates = JSON.parse(
      fs.readFileSync(path.join(built.packageDir, 'candidates.json'), 'utf8'),
    );
    const human = generateHumanReview({
      outDir: built.packageDir,
      fingerprintPrefix: '6505cf18e723',
      candidates,
      analysis: built.analysis,
    });
    expect(human.decisionCount).toBe(15);
    expect(human.decisions.map((d) => d.decisionId)).toEqual([...FINAL_DECISION_IDS]);

    const conflicts = candidates.filter((c: { disposition: string }) => c.disposition === 'CONFLICT');
    const parents = conflicts.filter((c: { entityType: string }) =>
      ['receivable', 'payable', 'sale'].includes(c.entityType),
    );
    const childOnly = conflicts.filter((c: { entityType: string }) =>
      ['receivable_payment', 'payable_payment'].includes(c.entityType),
    );
    const mapped = new Set(human.decisions.flatMap((d) => d.issueIds));
    for (const p of parents) {
      expect(mapped.has(p.sourceCandidateId)).toBe(true);
    }
    // children are covered via parent issueIds — no separate decision required
    for (const ch of childOnly) {
      const parentId = ch.normalizedPayload.parentId;
      expect(mapped.has(parentId) || mapped.has(ch.sourceCandidateId)).toBe(true);
    }

    const sales = candidates.filter((c: { entityType: string }) => c.entityType === 'sale');
    expect(sales.length).toBe(469);
    const accounted = sales.filter((c: { disposition: string }) =>
      ['CREATE', 'LINK', 'SKIP', 'CONFLICT', 'DEFERRED', 'EXCLUDED'].includes(c.disposition),
    );
    expect(accounted.length).toBe(469);

    expect(fs.existsSync(path.join(built.packageDir, 'FINAL_RESOLUTIONS_TEMPLATE.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(built.packageDir, 'expense-category-audit.md'))).toBe(true);
    expect(fs.existsSync(path.join(built.packageDir, 'partner-classification-audit.md'))).toBe(
      true,
    );
  }, 120_000);
});
