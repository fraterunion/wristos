import * as fs from 'fs';
import * as path from 'path';

import type { WorkbookAnalysis } from '../../../apps/api/src/modules/platform-migrations/wrist-caviar/types/migration.types';

import type { CanonicalCandidate } from './build-package';

export type FinalDecisionId =
  | `CXC-00${1 | 2 | 3 | 4 | 5 | 6}`
  | `CXP-00${1 | 2 | 3}`
  | `SALE-00${1 | 2}`
  | `REPORT-00${1 | 2 | 3 | 4}`;

export const FINAL_DECISION_IDS = [
  'CXC-001',
  'CXC-002',
  'CXC-003',
  'CXC-004',
  'CXC-005',
  'CXC-006',
  'CXP-001',
  'CXP-002',
  'CXP-003',
  'SALE-001',
  'SALE-002',
  'REPORT-001',
  'REPORT-002',
  'REPORT-003',
  'REPORT-004',
] as const;

export const CXC_CXP_RESOLUTION_TYPES = [
  'ACCEPT_SOURCE_OUTSTANDING',
  'ACCEPT_CALCULATED_OUTSTANDING',
  'CORRECT_PRINCIPAL',
  'CORRECT_PAYMENT',
  'CORRECT_OUTSTANDING',
  'EXCLUDE_INVALID_CARD',
] as const;

export const SALE_RESOLUTION_TYPES = [
  'ACCEPT_SOURCE_PROFIT',
  'ACCEPT_CALCULATED_PROFIT',
  'CORRECT_COST',
  'CORRECT_SALE_PRICE',
  'CORRECT_EXTRAS',
  'EXCLUDE_INVALID_SALE',
] as const;

export const REPORT_RESOLUTION_TYPES = [
  'ACKNOWLEDGE_SCOPE_DIFFERENCE',
  'KEEP_BLOCKED',
  'CORRECT_UNDERLYING_RECORDS',
] as const;

export type FinalDecisionTemplate = {
  decisionId: (typeof FINAL_DECISION_IDS)[number];
  area: 'CXC' | 'CXP' | 'SALE' | 'REPORTE';
  issueIds: string[];
  allowedResolutionTypes: readonly string[];
  resolutionType: string;
  approvedValue: unknown;
  reason: string;
  actor: string;
  date: string;
};

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return 'null';
  return String(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Final human decision packet: exactly 15 stable IDs.
 * Local-only file may include sensitive business values.
 */
export function generateHumanReview(opts: {
  outDir: string;
  fingerprintPrefix: string;
  candidates: CanonicalCandidate[];
  analysis: WorkbookAnalysis;
}): { decisionCount: number; decisions: FinalDecisionTemplate[]; unmappedConflicts: string[] } {
  const conflicts = opts.candidates.filter((c) => c.disposition === 'CONFLICT');
  const cxcParents = conflicts
    .filter((c) => c.entityType === 'receivable')
    .sort((a, b) => a.sourceCandidateId.localeCompare(b.sourceCandidateId));
  const cxpParents = conflicts
    .filter((c) => c.entityType === 'payable')
    .sort((a, b) => a.sourceCandidateId.localeCompare(b.sourceCandidateId));
  const sales = conflicts
    .filter((c) => c.entityType === 'sale')
    .sort((a, b) => a.sourceCandidateId.localeCompare(b.sourceCandidateId));

  const isFinalPacketShape =
    cxcParents.length === 6 && cxpParents.length === 3 && sales.length === 2;

  if (!isFinalPacketShape) {
    // Synthetic / partial packages: write a lightweight stub, do not enforce the 15-ID packet.
    const stub = [
      '# Wrist Caviar — HUMAN REVIEW (stub)',
      '',
      `Fingerprint prefix: \`${opts.fingerprintPrefix}\``,
      `CXC parents: ${cxcParents.length} · CXP parents: ${cxpParents.length} · Sales: ${sales.length}`,
      'Final 15-decision packet is generated only for the real workbook conflict shape (6/3/2).',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), stub);
    fs.writeFileSync(
      path.join(opts.outDir, 'FINAL_RESOLUTIONS_TEMPLATE.json'),
      JSON.stringify(
        {
          version: 1,
          migrationSource: 'wrist-caviar-master-workbook-v1',
          workbookFingerprintPrefix: opts.fingerprintPrefix,
          notes: 'Stub — real packet requires 6 CXC + 3 CXP + 2 SALE conflicts',
          decisions: [],
        },
        null,
        2,
      ),
    );
    return { decisionCount: 0, decisions: [], unmappedConflicts: [] };
  }

  const mappedIssueIds = new Set<string>();
  const md: string[] = [
    '# Wrist Caviar — FINAL HUMAN DECISION PACKET',
    '',
    `Fingerprint prefix: \`${opts.fingerprintPrefix}\``,
    `Grouped decisions: **15** (CXC 6 · CXP 3 · SALE 2 · REPORTE 4)`,
    '',
    'Fill `FINAL_RESOLUTIONS_TEMPLATE.json` → save as `FINAL_RESOLUTIONS.json` → run `migrate:wrist-caviar:apply-resolutions`.',
    '',
    'Child CXC/CXP payment conflicts inherit the parent card decision — do not decide them separately.',
    '',
  ];

  const templates: FinalDecisionTemplate[] = [];

  const cxcIds = ['CXC-001', 'CXC-002', 'CXC-003', 'CXC-004', 'CXC-005', 'CXC-006'] as const;
  cxcParents.forEach((card, idx) => {
    const decisionId = cxcIds[idx]!;
    const src = opts.analysis.receivables.find((r) => r.id === card.sourceCandidateId);
    const children = conflicts.filter(
      (c) =>
        c.entityType === 'receivable_payment' &&
        c.normalizedPayload.parentId === card.sourceCandidateId,
    );
    const issueIds = [card.sourceCandidateId, ...children.map((c) => c.sourceCandidateId)];
    issueIds.forEach((id) => mappedIssueIds.add(id));

    const principal = src?.principal ?? (card.normalizedPayload.principal as number | null);
    const declared =
      src?.declaredOutstanding ?? (card.normalizedPayload.outstanding as number | null);
    const calculated = src?.calculatedOutstanding ?? null;
    const paid = (src?.payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
    const diff =
      declared != null && calculated != null ? round2(declared - calculated) : null;

    md.push(`## ${decisionId}`);
    md.push('');
    md.push('Area: CXC');
    md.push('');
    md.push(`Source sheet: ${card.sourceSheet}`);
    md.push(`Source block/row range: ${card.sourceBlockId ?? `row ${card.sourceRow}`}`);
    md.push(`Customer: ${src?.customerName ?? card.normalizedPayload.customerName}`);
    md.push(`Concept/watch: ${src?.watchOrConcept ?? card.normalizedPayload.watchOrConcept}`);
    md.push(`Principal: ${money(principal)}`);
    md.push(`Parsed payments (${src?.payments.length ?? 0}):`);
    for (const p of src?.payments ?? []) {
      md.push(
        `- ${p.paymentDate ?? 'no-date'} · ${money(p.amount)} · ${p.label ?? '(no label)'}`,
      );
    }
    if (!(src?.payments.length ?? 0)) md.push('- (none)');
    md.push(`Payments total: ${money(paid)}`);
    md.push(`Source outstanding: ${money(declared)}`);
    md.push(`Calculated outstanding (principal − payments): ${money(calculated)}`);
    md.push(`Exact difference (source − calculated): ${money(diff)}`);
    md.push(`Downstream child records affected: ${children.length}`);
    md.push(
      'Effect on REPORTE: CXC_MXN / CXC_USD outstanding totals until card is resolved or excluded',
    );
    md.push(
      `Source cell references: ${(src?.source.sourceCellCoordinates ?? []).join(', ') || 'n/a'}`,
    );
    md.push('');
    md.push('Allowed options:');
    md.push('A. ACCEPT_SOURCE_OUTSTANDING');
    md.push('B. ACCEPT_CALCULATED_OUTSTANDING');
    md.push('C. CORRECT_PRINCIPAL');
    md.push('D. CORRECT_PAYMENT');
    md.push('E. CORRECT_OUTSTANDING');
    md.push('F. EXCLUDE_INVALID_CARD');
    md.push('');
    md.push('Recommended: none (human judgment required)');
    md.push('');

    templates.push({
      decisionId,
      area: 'CXC',
      issueIds,
      allowedResolutionTypes: CXC_CXP_RESOLUTION_TYPES,
      resolutionType: '',
      approvedValue: null,
      reason: '',
      actor: '',
      date: '',
    });
  });

  const cxpIds = ['CXP-001', 'CXP-002', 'CXP-003'] as const;
  cxpParents.forEach((card, idx) => {
    const decisionId = cxpIds[idx]!;
    const src = opts.analysis.payables.find((r) => r.id === card.sourceCandidateId);
    const children = conflicts.filter(
      (c) =>
        c.entityType === 'payable_payment' &&
        c.normalizedPayload.parentId === card.sourceCandidateId,
    );
    const issueIds = [card.sourceCandidateId, ...children.map((c) => c.sourceCandidateId)];
    issueIds.forEach((id) => mappedIssueIds.add(id));

    const principal = src?.principal ?? (card.normalizedPayload.principal as number | null);
    const declared = src?.declaredRemaining ?? (card.normalizedPayload.remaining as number | null);
    const calculated = src?.calculatedRemaining ?? null;
    const paid = (src?.payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
    const diff =
      declared != null && calculated != null ? round2(declared - calculated) : null;

    md.push(`## ${decisionId}`);
    md.push('');
    md.push('Area: CXP');
    md.push('');
    md.push(`Source sheet: ${card.sourceSheet}`);
    md.push(`Source block/row range: ${card.sourceBlockId ?? `row ${card.sourceRow}`}`);
    md.push(`Creditor: ${src?.creditorName ?? card.normalizedPayload.creditorName}`);
    md.push(`Concept/watch: ${src?.watchOrConcept ?? card.normalizedPayload.watchOrConcept}`);
    md.push(`Principal: ${money(principal)}`);
    md.push(`Parsed payments (${src?.payments.length ?? 0}):`);
    for (const p of src?.payments ?? []) {
      md.push(
        `- ${p.paymentDate ?? 'no-date'} · ${money(p.amount)} · ${p.label ?? '(no label)'}`,
      );
    }
    if (!(src?.payments.length ?? 0)) md.push('- (none)');
    md.push(`Payments total: ${money(paid)}`);
    md.push(`Source remaining: ${money(declared)}`);
    md.push(`Calculated remaining (principal − payments): ${money(calculated)}`);
    md.push(`Exact difference (source − calculated): ${money(diff)}`);
    md.push(`Formula errors: ${(src?.formulaErrors ?? []).join(', ') || 'none'}`);
    md.push(`Downstream child records affected: ${children.length}`);
    md.push('Effect on REPORTE: CXP_MXN / CXP_USD remaining totals');
    md.push(
      `Source cell references: ${(src?.source.sourceCellCoordinates ?? []).join(', ') || 'n/a'}`,
    );
    md.push('');
    md.push('Allowed options:');
    md.push('A. ACCEPT_SOURCE_OUTSTANDING');
    md.push('B. ACCEPT_CALCULATED_OUTSTANDING');
    md.push('C. CORRECT_PRINCIPAL');
    md.push('D. CORRECT_PAYMENT');
    md.push('E. CORRECT_OUTSTANDING');
    md.push('F. EXCLUDE_INVALID_CARD');
    md.push('');
    md.push('Recommended: none (human judgment required)');
    md.push('');

    templates.push({
      decisionId,
      area: 'CXP',
      issueIds,
      allowedResolutionTypes: CXC_CXP_RESOLUTION_TYPES,
      resolutionType: '',
      approvedValue: null,
      reason: '',
      actor: '',
      date: '',
    });
  });

  const saleIds = ['SALE-001', 'SALE-002'] as const;
  sales.forEach((sale, idx) => {
    const decisionId = saleIds[idx]!;
    const src = opts.analysis.sales.find((s) => s.id === sale.sourceCandidateId)!;
    mappedIssueIds.add(sale.sourceCandidateId);
    const diff =
      src.declaredProfit != null && src.calculatedProfit != null
        ? round2(src.declaredProfit - src.calculatedProfit)
        : null;

    md.push(`## ${decisionId}`);
    md.push('');
    md.push('Area: SALE');
    md.push('');
    md.push(`Source row: VENTAS row ${src.source.sourceRow}`);
    md.push(`Sale date: ${src.saleDate ?? 'null'}`);
    md.push(
      `Watch snapshot: ${src.brand ?? ''} ${src.model ?? ''} · ref ${src.reference ?? 'null'} · serial ${src.serial ?? 'null'}`,
    );
    md.push(`Cost: ${money(src.cost)}`);
    md.push(`Sale price: ${money(src.salePrice)}`);
    md.push(`Extras: ${money(src.extras)}`);
    md.push(`Workbook profit: ${money(src.declaredProfit)}`);
    md.push(`Calculated profit (price − cost − extras): ${money(src.calculatedProfit)}`);
    md.push(`Exact difference (workbook − calculated): ${money(diff)}`);
    md.push(
      `Source cells: ${(src.source.sourceCellCoordinates ?? []).join(', ') || 'n/a'}`,
    );
    md.push('');
    md.push('Allowed options:');
    md.push('A. ACCEPT_SOURCE_PROFIT');
    md.push('B. ACCEPT_CALCULATED_PROFIT');
    md.push('C. CORRECT_COST');
    md.push('D. CORRECT_SALE_PRICE');
    md.push('E. CORRECT_EXTRAS');
    md.push('F. EXCLUDE_INVALID_SALE');
    md.push('');
    md.push('Recommended: none (human judgment required)');
    md.push('');

    templates.push({
      decisionId,
      area: 'SALE',
      issueIds: [sale.sourceCandidateId],
      allowedResolutionTypes: SALE_RESOLUTION_TYPES,
      resolutionType: '',
      approvedValue: null,
      reason: '',
      actor: '',
      date: '',
    });
  });

  const reportSpecs: Array<{
    id: (typeof FINAL_DECISION_IDS)[number];
    concept: string;
    explanation: string;
    recommended: string | null;
  }> = [
    {
      id: 'REPORT-001',
      concept: 'EFECTIVO_USD',
      explanation:
        'Unexplained mismatch between REPORTE cash USD and package cash USD ledger total. Not a known deferred-scope difference.',
      recommended: null,
    },
    {
      id: 'REPORT-002',
      concept: 'CXC_MXN',
      explanation:
        'Mismatch likely tied to open CXC card decisions (excluded/conflict cards change outstanding). Resolve CXC decisions first; acknowledge only if residual is known scope.',
      recommended: null,
    },
    {
      id: 'REPORT-003',
      concept: 'DINERO_OSCAR',
      explanation:
        'Known scope difference: OSCAR PAPA CAMI is DEFERRED from operational import; REPORTE still shows Oscar money.',
      recommended: 'A. ACKNOWLEDGE_SCOPE_DIFFERENCE',
    },
    {
      id: 'REPORT-004',
      concept: 'CXP_USD / UTILIDADES',
      explanation:
        'SCOPE_REVIEW_REQUIRED: declared or calculated unavailable / matrix-derived utilities. Scope acknowledgement or keep blocked — do not invent balancing entries.',
      recommended: null,
    },
  ];

  for (const spec of reportSpecs) {
    const rows = opts.analysis.reconciliation.filter((r) => {
      if (spec.concept.includes('/')) {
        return spec.concept.split('/').some((p) => r.concept.includes(p.trim()));
      }
      return r.concept === spec.concept;
    });
    md.push(`## ${spec.id}`);
    md.push('');
    md.push('Area: REPORTE');
    md.push('');
    md.push(`Concept: ${spec.concept}`);
    for (const r of rows.length ? rows : [{ concept: spec.concept } as never]) {
      const row = r as {
        concept?: string;
        declaredValue?: number | null;
        calculatedValue?: number | null;
        difference?: number | null;
        status?: string;
        sourceCells?: string[];
      };
      md.push(`REPORTE value (${row.concept ?? spec.concept}): ${money(row.declaredValue)}`);
      md.push(`Canonical package / calculated value: ${money(row.calculatedValue)}`);
      md.push(`Planned destination value: same as package operational total for included groups`);
      md.push(`Exact difference: ${money(row.difference)}`);
      md.push(`Status: ${row.status ?? 'n/a'}`);
      md.push(`Source cells: ${(row.sourceCells ?? []).join(', ') || 'n/a'}`);
    }
    md.push('Included groups: operational sheets in package CREATE/LINK');
    md.push('Excluded groups: blank/template cards, hidden cash rows, EXCLUDED dispositions');
    md.push('Deferred groups: CRIPTO CESAR, OSCAR PAPA CAMI');
    md.push(`Explanation: ${spec.explanation}`);
    md.push('');
    md.push('Allowed options:');
    md.push('A. ACKNOWLEDGE_SCOPE_DIFFERENCE');
    md.push('B. KEEP_BLOCKED');
    md.push('C. CORRECT_UNDERLYING_RECORDS');
    md.push('');
    md.push(
      `Recommended: ${spec.recommended ?? 'none — do not treat acknowledgement as permission to alter source records'}`,
    );
    md.push('');

    templates.push({
      decisionId: spec.id,
      area: 'REPORTE',
      issueIds: rows.map((r) => `reporte:${r.concept}`),
      allowedResolutionTypes: REPORT_RESOLUTION_TYPES,
      resolutionType: '',
      approvedValue: null,
      reason: '',
      actor: '',
      date: '',
    });
  }

  const unmappedConflicts = conflicts
    .filter((c) => !mappedIssueIds.has(c.sourceCandidateId))
    .filter((c) => !['receivable_payment', 'payable_payment'].includes(c.entityType) || !mappedIssueIds.has(String(c.normalizedPayload.parentId)))
    .map((c) => `${c.entityType}:${c.sourceCandidateId}:${c.dispositionReason}`);

  // Child payments whose parent was mapped are considered mapped
  const trulyUnmapped = conflicts.filter((c) => {
    if (mappedIssueIds.has(c.sourceCandidateId)) return false;
    if (
      (c.entityType === 'receivable_payment' || c.entityType === 'payable_payment') &&
      mappedIssueIds.has(String(c.normalizedPayload.parentId))
    ) {
      return false;
    }
    // REPORTE decisions don't map candidate conflicts
    return true;
  });

  md.push('## Coverage');
  md.push('');
  md.push(`Conflict candidates: ${conflicts.length}`);
  md.push(`Mapped to CXC/CXP/SALE decisions: ${mappedIssueIds.size}`);
  md.push(
    `Unmapped conflict candidates (e.g. partner suspicious): ${trulyUnmapped.length}`,
  );
  if (trulyUnmapped.length) {
    md.push('');
    md.push(
      'See `partner-classification-audit.md` for partner conflicts outside this 15-decision packet.',
    );
    for (const c of trulyUnmapped.slice(0, 50)) {
      md.push(`- ${c.entityType} \`${c.sourceCandidateId}\` — ${c.dispositionReason}`);
    }
  }
  md.push('');

  fs.writeFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), md.join('\n'));
  fs.writeFileSync(
    path.join(opts.outDir, 'FINAL_RESOLUTIONS_TEMPLATE.json'),
    JSON.stringify(
      {
        version: 1,
        migrationSource: 'wrist-caviar-master-workbook-v1',
        workbookFingerprintPrefix: opts.fingerprintPrefix,
        notes:
          'Fill resolutionType, approvedValue (when required), reason, actor, date. Do not invent balancing entries.',
        decisions: templates,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(opts.outDir, 'human-review-private.json'),
    JSON.stringify(
      {
        fingerprintPrefix: opts.fingerprintPrefix,
        decisionCount: templates.length,
        decisions: templates,
        unmappedConflicts: trulyUnmapped.map((c) => ({
          id: c.sourceCandidateId,
          entityType: c.entityType,
          reason: c.dispositionReason,
        })),
      },
      null,
      2,
    ),
  );

  return {
    decisionCount: templates.length,
    decisions: templates,
    unmappedConflicts: trulyUnmapped.map(
      (c) => `${c.entityType}:${c.sourceCandidateId}:${c.dispositionReason}`,
    ),
  };
}
