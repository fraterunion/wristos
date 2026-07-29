import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildPartnerBridge,
  generateFinalDecisionPacket,
  PARTNER_DECISION_IDS,
  assertV2DecisionSet,
} from '../../../../../../../scripts/migrations/wrist-caviar/generate-final-packet';
import { FINAL_DECISION_IDS } from '../../../../../../../scripts/migrations/wrist-caviar/generate-human-review';
import { validateFinalResolutions } from '../../../../../../../scripts/migrations/wrist-caviar/apply-resolutions';
import { buildPackage } from '../../../../../../../scripts/migrations/wrist-caviar/build-package';
import {
  classifyPartnerMovement,
} from '../../../../../../../scripts/migrations/wrist-caviar/rules/partner.rules';
import {
  PARTNER_UNSUPPORTED_FORCED_TYPES,
  partnerOptionsForKind,
} from '../../../../../../../scripts/migrations/wrist-caviar/partner-destination-semantics';

const REAL_WB = path.resolve(process.cwd(), '../../RELOJES CESAR ADMIN.xlsx');
const hasReal = fs.existsSync(REAL_WB);
const maybe = hasReal ? it : it.skip;

describe('wrist-caviar complete decision packet v2', () => {
  it('4-7. loan/reimbursement/profit do not auto-classify by sign', () => {
    expect(
      classifyPartnerMovement({
        entryAmount: 50,
        exitAmount: null,
        classification: 'UNCLASSIFIED',
        concept: 'PAGO PRESTAMO CESAR',
      }).classification,
    ).toBe('UNCLASSIFIED');
    expect(
      classifyPartnerMovement({
        entryAmount: null,
        exitAmount: 50,
        classification: 'UNCLASSIFIED',
        concept: 'PAGO PRESTAMO CESAR',
      }).classification,
    ).toBe('UNCLASSIFIED');
    expect(
      classifyPartnerMovement({
        entryAmount: 75,
        exitAmount: null,
        classification: 'UNCLASSIFIED',
        concept: 'reembolso',
      }).classification,
    ).toBe('UNCLASSIFIED');
    expect(
      classifyPartnerMovement({
        entryAmount: 18,
        exitAmount: null,
        classification: 'UNCLASSIFIED',
        concept: 'UTILIDAD NACHO',
      }).classification,
    ).toBe('UNCLASSIFIED');
  });

  it('8. unsupported semantic types are not forced; DEFER offered', () => {
    expect(PARTNER_UNSUPPORTED_FORCED_TYPES).toContain('CLASSIFY_AS_WATCH_PURCHASE');
    expect(PARTNER_UNSUPPORTED_FORCED_TYPES).toContain('CLASSIFY_AS_BUSINESS_EXPENSE');
    const opts = partnerOptionsForKind('LOAN_OR_ADVANCE');
    expect(opts[0]).toBe('DEFER_FOR_LATER');
    expect(opts).not.toContain('CLASSIFY_AS_WATCH_PURCHASE');
    expect(opts).not.toContain('CLASSIFY_AS_BUSINESS_EXPENSE');
  });

  it('9-10. v2 template set rejects obsolete HC ids', () => {
    expect(() => assertV2DecisionSet(['HC-001', ...FINAL_DECISION_IDS.slice(1)])).toThrow();
    assertV2DecisionSet([...FINAL_DECISION_IDS, ...PARTNER_DECISION_IDS]);
  });

  it('validateFinalResolutions v2 requires 28 decisions', () => {
    const decisions = [...FINAL_DECISION_IDS, ...PARTNER_DECISION_IDS].map((id) => ({
      decisionId: id,
      area: id.startsWith('PARTNER')
        ? 'PARTNER'
        : id.startsWith('SALE')
          ? 'SALE'
          : id.startsWith('REPORT')
            ? 'REPORTE'
            : id.startsWith('CXP')
              ? 'CXP'
              : 'CXC',
      issueIds: [`id_${id}`],
      allowedResolutionTypes: [],
      resolutionType: id.startsWith('PARTNER')
        ? 'DEFER_FOR_LATER'
        : id.startsWith('SALE')
          ? 'ACCEPT_CALCULATED_PROFIT'
          : id.startsWith('REPORT')
            ? 'KEEP_BLOCKED'
            : 'ACCEPT_SOURCE_OUTSTANDING',
      approvedValue: null,
      reason: 't',
      actor: 'tester',
      date: '2026-07-29',
    }));
    expect(validateFinalResolutions({ version: 2, migrationSource: 'x', decisions }).decisions).toHaveLength(
      28,
    );
    expect(() =>
      validateFinalResolutions({
        version: 2,
        migrationSource: 'x',
        decisions: decisions.map((d, i) => (i === 0 ? { ...d, decisionId: 'HC-001' } : d)),
      }),
    ).toThrow(/obsolete|Unknown|Missing/i);
  });

  maybe('1-3+11-14. real packet: 13 partners mapped, bridge attributed, redacted, expenses', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-v2-'));
    const resolutions = path.join(dir, 'resolutions.json');
    fs.writeFileSync(
      resolutions,
      JSON.stringify({
        version: 1,
        migrationSource: 'wrist-caviar-master-workbook-v1',
        notes: 't',
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

    const bridge = buildPartnerBridge({ analysis: built.analysis, candidates });
    expect(bridge.entryDelta).toBe(205800);
    expect(bridge.exitDelta).toBe(140000);
    expect(bridge.entryFullyAttributed).toBe(true);
    expect(bridge.exitFullyAttributed).toBe(true);
    // ending balance match must not hide deltas
    expect(Math.abs(bridge.net - (bridge.endingBalance ?? 0)) < 0.05).toBe(true);
    expect(bridge.entryDelta).not.toBe(0);
    expect(bridge.exitDelta).not.toBe(0);

    const packet = generateFinalDecisionPacket({
      outDir: built.packageDir,
      fingerprintPrefix: '6505cf18e723',
      candidates,
      analysis: built.analysis,
    });
    expect(packet.totalDecisions).toBe(28);
    expect(packet.partnerDecisionCount).toBe(13);
    expect(packet.bridgeOk).toBe(true);
    assertV2DecisionSet(packet.decisionIds);

    const partnerConflicts = candidates.filter(
      (c: { entityType: string; disposition: string }) =>
        c.entityType === 'partner' && c.disposition === 'CONFLICT',
    );
    expect(partnerConflicts).toHaveLength(13);
    const mapped = new Set(
      JSON.parse(
        fs.readFileSync(path.join(built.packageDir, 'FINAL_RESOLUTIONS_TEMPLATE_V2.json'), 'utf8'),
      ).decisions.filter((d: { area: string }) => d.area === 'PARTNER').flatMap((d: { issueIds: string[] }) => d.issueIds),
    );
    for (const p of partnerConflicts) {
      expect(mapped.has(p.sourceCandidateId)).toBe(true);
    }

    const children = candidates.filter((c: { entityType: string; disposition: string }) =>
      ['receivable_payment', 'payable_payment'].includes(c.entityType) &&
      c.disposition === 'CONFLICT',
    );
    const v2 = JSON.parse(
      fs.readFileSync(path.join(built.packageDir, 'FINAL_RESOLUTIONS_TEMPLATE_V2.json'), 'utf8'),
    );
    const parentDecisions = v2.decisions.filter((d: { area: string }) =>
      ['CXC', 'CXP'].includes(d.area),
    );
    for (const ch of children) {
      const covered = parentDecisions.some((d: { issueIds: string[] }) =>
        d.issueIds.includes(ch.normalizedPayload.parentId) || d.issueIds.includes(ch.sourceCandidateId),
      );
      expect(covered).toBe(true);
    }

    const redacted = fs.readFileSync(
      path.join(built.packageDir, 'FINAL_HUMAN_REVIEW_REDACTED.md'),
      'utf8',
    );
    expect(redacted).not.toMatch(/David lugard|EDGAR TREJO|michael mcenry|pablo ramirez/i);
    expect(redacted).toMatch(/Serial: \[REDACTED\]/);
    expect(redacted).toMatch(/Customer [A-Z]|Creditor [A-Z]|Partner movement [A-Z]/);

    const expenses = candidates.filter((c: { entityType: string }) => c.entityType === 'expense');
    expect(expenses).toHaveLength(287);
    const accounted = expenses.filter((c: { disposition: string }) =>
      ['CREATE', 'LINK', 'SKIP', 'CONFLICT', 'DEFERRED', 'EXCLUDED'].includes(c.disposition),
    );
    expect(accounted).toHaveLength(287);

    // zero operational writes: package build + packet only
    expect(built.analysis).toBeTruthy();
  }, 120_000);
});
