import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyBusinessOwnerOverrides } from '../../../../../../../scripts/migrations/wrist-caviar/business-owner-overrides';
import { parseEdgarCxpWorkbook } from '../../../../../../../scripts/migrations/wrist-caviar/edgar-cxp-parser';
import {
  buildV3CardOverrides,
  buildV3PartnerDefers,
  EDGAR_ORIGINAL_EXCLUDE_IDS,
} from '../../../../../../../scripts/migrations/wrist-caviar/v3-resolutions-data';
import { isEdgarCreditor } from '../../../../../../../scripts/migrations/wrist-caviar/business-owner-overrides';
import { PARTNER_DECISION_IDS } from '../../../../../../../scripts/migrations/wrist-caviar/generate-final-packet';
import { sha256Hex, prefix } from '../../../../../../../scripts/migrations/wrist-caviar/hash';

const ROOT = path.resolve(process.cwd(), '../..');
const REAL_WB = path.resolve(ROOT, 'RELOJES CESAR ADMIN.xlsx');
const EDGAR_WB = path.resolve(ROOT, 'HOJA CXP EDGAR.xlsx');
const hasReal = fs.existsSync(REAL_WB);
const hasEdgar = fs.existsSync(EDGAR_WB);
const maybe = hasReal && hasEdgar ? it : it.skip;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('wrist-caviar resolved V3 overrides + Edgar replacement', () => {
  it('CXC-001 corrected principal/outstanding', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-001')!;
    expect(ov.resolved.principal).toBe(368000);
    expect(ov.resolved.outstanding).toBe(368000);
    expect(ov.resolved.payments).toEqual([]);
    expect(ov.resolved.watchOrConcept).toMatch(/Land-Dweller/i);
  });

  it('CXC-002 multi-watch principal', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-002')!;
    expect(ov.resolved.chargeLines?.map((c) => c.amount)).toEqual([980000, 978000]);
    expect(ov.resolved.principal).toBe(1958000);
    expect(ov.resolved.outstanding).toBe(1958000);
  });

  it('CXC-003 missing payment correction', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-003')!;
    expect(ov.resolved.principal).toBe(375000);
    expect(ov.resolved.payments?.[0]?.amount).toBe(150000);
    expect(ov.resolved.outstanding).toBe(225000);
  });

  it('CXC-004 multiple charges and payments', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-004')!;
    expect(ov.resolved.chargeLines).toHaveLength(4);
    expect(ov.resolved.payments).toHaveLength(6);
    const charges = ov.resolved.chargeLines!.reduce((s, c) => s + c.amount, 0);
    const pays = ov.resolved.payments!.reduce((s, p) => s + p.amount, 0);
    expect(charges).toBe(1732000);
    expect(pays).toBe(1137000);
    expect(ov.resolved.outstanding).toBe(595000);
  });

  it('CXC-005 Aquanaut classified as MONTO', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-005')!;
    const aqua = ov.resolved.chargeLines!.find((c) => /Aquanaut/i.test(c.concept));
    expect(aqua?.amount).toBe(1196000);
    expect(ov.resolved.payments!.some((p) => p.amount === 1196000)).toBe(false);
  });

  it('CXC-005 exact totals', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-005')!;
    const charges = ov.resolved.chargeLines!.reduce((s, c) => s + c.amount, 0);
    const pays = ov.resolved.payments!.reduce((s, p) => s + p.amount, 0);
    expect(charges).toBe(3254500);
    expect(pays).toBe(2650000);
    expect(ov.resolved.outstanding).toBe(604500);
  });

  it('CXC-006 final payment closes balance', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXC-006')!;
    const pays = ov.resolved.payments!.reduce((s, p) => s + p.amount, 0);
    expect(ov.resolved.principal).toBe(49500);
    expect(pays).toBe(49500);
    expect(ov.resolved.outstanding).toBe(0);
  });

  it('CXP-002 rows recognized as payments', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'CXP-002')!;
    expect(ov.resolved.payments).toHaveLength(4);
    const pays = ov.resolved.payments!.reduce((s, p) => s + p.amount, 0);
    expect(pays).toBe(192100);
    expect(ov.resolved.remaining).toBe(201900);
    expect(ov.resolved.principal).toBe(394000);
  });

  it('SALE-001 USD handling / zero cost / realized MXN profit', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'SALE-001')!;
    expect(ov.resolved.originalCurrency).toBe('USD');
    expect(ov.resolved.originalAmount).toBe(1450);
    expect(ov.resolved.cost).toBe(0);
    expect(ov.resolved.declaredProfit).toBe(27042);
    expect(ov.resolved.salePrice).toBe(27042);
    expect(ov.resolved.exchangeRate).toBeCloseTo(27042 / 1450, 10);
  });

  it('SALE-002 FX adjustment and realized profit', () => {
    const ov = buildV3CardOverrides().find((o) => o.decisionId === 'SALE-002')!;
    expect(ov.resolved.cost).toBe(712000);
    expect(ov.resolved.salePrice).toBe(918000);
    expect(ov.resolved.extras).toBe(6000);
    expect(ov.resolved.declaredProfit).toBe(200000);
    expect(ov.resolved.extrasNote).toMatch(/FX timing/i);
  });

  it('all 13 partner decisions are DEFER_FOR_LATER', () => {
    const defers = buildV3PartnerDefers();
    expect(defers).toHaveLength(13);
    expect(defers.map((d) => d.decisionId)).toEqual([...PARTNER_DECISION_IDS]);
    expect(defers.every((d) => d.resolutionType === 'DEFER_FOR_LATER')).toBe(true);
  });

  it('combined fingerprint changes when Edgar + resolutions included', () => {
    const primary = '6505cf18e723f7228a002f14651b1ef4c29d19f97b4fcc9fbbc47a2657c3cec7';
    const edgar = 'd3f5284cbfbaf654515fe20bc78c72e1ab651f2185a52128e5fe3411e64a6fb8';
    const resHash = sha256Hex({ version: 3, cardOverrides: buildV3CardOverrides().length });
    const combined = sha256Hex({
      primaryWorkbookSha256: primary,
      edgarWorkbookSha256: edgar,
      resolutionPackageHash: resHash,
      resolutionVersion: 3,
    });
    expect(prefix(combined)).not.toBe('6505cf18e723');
  });

  maybe('Edgar CXP replacement parses CXP-001 and CXP-003 totals exactly once', async () => {
    const parsed = await parseEdgarCxpWorkbook(EDGAR_WB);
    expect(parsed.payables.length).toBeGreaterThanOrEqual(2);
    const cxp001 = parsed.audits.find((a) => a.decisionIds.includes('CXP-001'));
    const cxp003 = parsed.audits.find((a) => a.decisionIds.includes('CXP-003'));
    expect(cxp001).toBeTruthy();
    expect(cxp001!.principal).toBe(5392000);
    expect(cxp001!.paymentsTotal).toBe(1882285);
    expect(cxp001!.outstanding).toBe(3509715);
    expect(cxp003).toBeTruthy();
    expect(cxp003!.principal).toBe(1055000);
    expect(cxp003!.paymentsTotal).toBe(0);
    expect(cxp003!.outstanding).toBe(1055000);
    // no append duplication of decision cards
    expect(parsed.audits.filter((a) => a.decisionIds.includes('CXP-001'))).toHaveLength(1);
    expect(parsed.audits.filter((a) => a.decisionIds.includes('CXP-003'))).toHaveLength(1);
  });

  maybe('Edgar original records are excluded/superseded; replacements imported once', async () => {
    const { analyzeWorkbookFile } = await import(
      '../../../../../../../scripts/migrations/wrist-caviar/build-package'
    );
    const { buildResolvedV3 } = await import(
      '../../../../../../../scripts/migrations/wrist-caviar/build-resolved-v3'
    );
    const analysis = await analyzeWorkbookFile(REAL_WB);
    const originals = analysis.payables.filter(
      (p) =>
        EDGAR_ORIGINAL_EXCLUDE_IDS.includes(p.id as (typeof EDGAR_ORIGINAL_EXCLUDE_IDS)[number]) ||
        isEdgarCreditor(p.creditorName),
    );
    expect(originals.length).toBeGreaterThanOrEqual(2);

    const built = await buildResolvedV3({
      workbookPath: REAL_WB,
      edgarPath: EDGAR_WB,
      tenantId: 'test-tenant-no-db',
      outRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'wc-v3-')),
      runDryRun: false,
    });
    const candidates = JSON.parse(
      fs.readFileSync(path.join(built.packageDir, 'candidates.json'), 'utf8'),
    ) as Array<{ sourceCandidateId: string; entityType: string; disposition: string }>;

    for (const id of originals.map((o) => o.id)) {
      expect(candidates.some((c) => c.sourceCandidateId === id && c.entityType === 'payable')).toBe(
        false,
      );
    }
    const edgarParents = candidates.filter(
      (c) => c.entityType === 'payable' && c.sourceCandidateId.startsWith('edgar_cxp_'),
    );
    expect(edgarParents.length).toBeGreaterThanOrEqual(2);
    expect(new Set(edgarParents.map((c) => c.sourceCandidateId)).size).toBe(edgarParents.length);
    expect(built.conflictCount).toBe(0);
    expect(candidates.filter((c) => c.disposition === 'CONFLICT')).toHaveLength(0);
    expect(
      candidates.filter((c) => c.entityType === 'partner' && c.disposition === 'DEFERRED'),
    ).toHaveLength(13);

    const recon = fs.readFileSync(path.join(built.packageDir, 'FINAL_RECONCILIATION.md'), 'utf8');
    expect(recon).toMatch(/DINERO_OSCAR/);
    expect(recon).toMatch(/ACKNOWLEDGE_SCOPE_DIFFERENCE|MATCHED/);

    const redacted = fs.readFileSync(
      path.join(built.packageDir, 'FINAL_RESOLUTION_SUMMARY_REDACTED.md'),
      'utf8',
    );
    expect(redacted).not.toMatch(/EDGAR TREJO/i);
  });

  maybe('applyBusinessOwnerOverrides enforces CXC invariants on real analysis', async () => {
    const { analyzeWorkbookFile } = await import(
      '../../../../../../../scripts/migrations/wrist-caviar/build-package'
    );
    const analysis = await analyzeWorkbookFile(REAL_WB);
    const next = applyBusinessOwnerOverrides(analysis, buildV3CardOverrides());
    const cxc001 = next.receivables.find((r) => r.id === 'cxc_000002')!;
    expect(cxc001.principal).toBe(368000);
    expect(cxc001.declaredOutstanding).toBe(368000);
    expect(cxc001.balanceMismatch).toBe(false);
    const cxc005 = next.receivables.find((r) => r.id === 'cxc_000041')!;
    expect(round2(cxc005.payments.reduce((s, p) => s + (p.amount ?? 0), 0))).toBe(2650000);
    expect(cxc005.principal).toBe(3254500);
    const sale1 = next.sales.find((s) => s.id === 'sale_000041')!;
    expect(sale1.cost).toBe(0);
    expect(sale1.declaredProfit).toBe(27042);
    expect((sale1 as { originalCurrency?: string }).originalCurrency).toBe('USD');
  });
});
