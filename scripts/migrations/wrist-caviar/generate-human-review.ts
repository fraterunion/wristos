import * as fs from 'fs';
import * as path from 'path';

import type { CanonicalCandidate } from './build-package';

type Decision = {
  id: string;
  area: string;
  sourceRef: string;
  problem: string;
  options: string[];
  recommended: string | null;
  impact: string[];
  resolutionTemplate: Record<string, unknown>;
  candidateIds: string[];
};

function moneySafe(_n: unknown): string {
  return '(see private local report)';
}

/**
 * Build grouped human decisions from remaining CONFLICT candidates only.
 * Sensitive values stay out of the markdown; private JSON may hold ids.
 */
export function generateHumanReview(opts: {
  outDir: string;
  fingerprintPrefix: string;
  candidates: CanonicalCandidate[];
}): { decisionCount: number; decisions: Decision[] } {
  const conflicts = opts.candidates.filter((c) => c.disposition === 'CONFLICT');
  const decisions: Decision[] = [];
  let seq = 1;
  const nextId = () => `HC-${String(seq++).padStart(3, '0')}`;

  // CXC parents only (not children)
  const cxcParents = conflicts.filter((c) => c.entityType === 'receivable');
  for (const card of cxcParents) {
    const children = conflicts.filter(
      (c) =>
        c.entityType === 'receivable_payment' &&
        c.normalizedPayload.parentId === card.sourceCandidateId,
    );
    const id = nextId();
    decisions.push({
      id,
      area: 'CXC',
      sourceRef: `${card.sourceSheet} row ${card.sourceRow ?? '?'} block ${card.sourceBlockId ?? card.sourceCandidateId}`,
      problem:
        card.dispositionReason === 'ambiguous_cxc'
          ? 'Receivable card is incomplete or ambiguous (principal/payments).'
          : 'Receivable declared outstanding does not equal principal − payments.',
      options: [
        'A. Accept source outstanding',
        'B. Accept calculated outstanding',
        'C. Enter corrected principal/outstanding',
        'D. Exclude invalid block',
      ],
      recommended: null,
      impact: [
        `source candidates: 1 parent + ${children.length} payments`,
        'operational: AccountEntry + AccountPayment',
        'reconciliation: CXC outstanding totals',
      ],
      resolutionTemplate: {
        id: `res_${id.toLowerCase()}`,
        entityType: 'receivable',
        sourceCandidateId: card.sourceCandidateId,
        issueCode: card.dispositionReason.toUpperCase(),
        resolutionType: '',
        reason: '',
        actor: '',
        date: '',
        resolvedValue: {},
      },
      candidateIds: [card.sourceCandidateId, ...children.map((c) => c.sourceCandidateId)],
    });
  }

  const cxpParents = conflicts.filter((c) => c.entityType === 'payable');
  for (const card of cxpParents) {
    const children = conflicts.filter(
      (c) =>
        c.entityType === 'payable_payment' &&
        c.normalizedPayload.parentId === card.sourceCandidateId,
    );
    const id = nextId();
    decisions.push({
      id,
      area: 'CXP',
      sourceRef: `${card.sourceSheet} row ${card.sourceRow ?? '?'} block ${card.sourceBlockId ?? card.sourceCandidateId}`,
      problem:
        card.dispositionReason === 'cxp_formula_error'
          ? 'Payable card has formula errors; cached/declared value needs explicit choice.'
          : 'Payable remaining does not equal principal − payments (or principal invalid).',
      options: [
        'A. Accept source remaining',
        'B. Accept calculated remaining',
        'C. Enter corrected value / FORMULA_OVERRIDE',
        'D. Exclude invalid block',
      ],
      recommended: null,
      impact: [
        `source candidates: 1 parent + ${children.length} payments`,
        'operational: AccountEntry + AccountPayment',
        'reconciliation: CXP remaining totals',
      ],
      resolutionTemplate: {
        id: `res_${id.toLowerCase()}`,
        entityType: 'payable',
        sourceCandidateId: card.sourceCandidateId,
        issueCode: card.dispositionReason.toUpperCase(),
        resolutionType: '',
        reason: '',
        actor: '',
        date: '',
        resolvedValue: {},
      },
      candidateIds: [card.sourceCandidateId, ...children.map((c) => c.sourceCandidateId)],
    });
  }

  const sales = conflicts.filter((c) => c.entityType === 'sale');
  for (const sale of sales) {
    const id = nextId();
    decisions.push({
      id,
      area: 'SALES',
      sourceRef: `${sale.sourceSheet} row ${sale.sourceRow ?? '?'} (${sale.sourceCandidateId})`,
      problem: 'Declared profit does not match salePrice − cost − extras.',
      options: [
        'A. Accept source (declared) profit',
        'B. Accept calculated profit',
        'C. Enter corrected cost/price/profit',
        'D. Exclude invalid sale row',
      ],
      recommended: null,
      impact: [
        'source candidates: 1 sale',
        'operational: Deal create',
        'reconciliation: sales profit totals',
      ],
      resolutionTemplate: {
        id: `res_${id.toLowerCase()}`,
        entityType: 'sale',
        sourceCandidateId: sale.sourceCandidateId,
        issueCode: 'SALE_PROFIT_MISMATCH',
        resolutionType: '',
        reason: '',
        actor: '',
        date: '',
        resolvedValue: {},
      },
      candidateIds: [sale.sourceCandidateId],
    });
  }

  const partner = conflicts.filter((c) => c.entityType === 'partner');
  if (partner.length) {
    const id = nextId();
    decisions.push({
      id,
      area: 'PARTNER',
      sourceRef: `CUENTA CESAR — ${partner.length} unclassified movements (entry+exit or zero both)`,
      problem:
        'Partner rows with both entry and exit amounts (or neither) cannot be auto-classified as contribution vs withdrawal.',
      options: [
        'A. Classify each as CONTRIBUTION via CORRECT_VALUE',
        'B. Classify each as WITHDRAWAL via CORRECT_VALUE',
        'C. Exclude specific rows',
        'D. Defer entire group',
      ],
      recommended: null,
      impact: [
        `source candidates: ${partner.length}`,
        'operational: TreasuryEntry CESAR',
        'reconciliation: partner ledger',
      ],
      resolutionTemplate: {
        id: `res_${id.toLowerCase()}`,
        entityType: 'partner',
        sourceCandidateId: null,
        issueCode: 'UNCLASSIFIED_PARTNER_MOVEMENT',
        resolutionType: '',
        reason: '',
        actor: '',
        date: '',
        resolvedValue: {},
      },
      candidateIds: partner.map((c) => c.sourceCandidateId),
    });
  }

  const other = conflicts.filter(
    (c) =>
      !['receivable', 'receivable_payment', 'payable', 'payable_payment', 'sale', 'partner'].includes(
        c.entityType,
      ),
  );
  if (other.length) {
    const byReason: Record<string, CanonicalCandidate[]> = {};
    for (const c of other) {
      (byReason[c.dispositionReason] ??= []).push(c);
    }
    for (const [reason, list] of Object.entries(byReason)) {
      const id = nextId();
      decisions.push({
        id,
        area: list[0]?.entityGroup ?? 'OTHER',
        sourceRef: `${list[0]?.sourceSheet ?? '?'} — ${list.length} candidates`,
        problem: `Remaining conflict code: ${reason}`,
        options: ['A. Resolve via resolutions.json', 'B. Exclude', 'C. Defer'],
        recommended: null,
        impact: [`source candidates: ${list.length}`],
        resolutionTemplate: {
          id: `res_${id.toLowerCase()}`,
          entityType: list[0]?.entityType,
          sourceCandidateId: null,
          issueCode: reason.toUpperCase(),
          resolutionType: '',
          reason: '',
          actor: '',
          date: '',
          resolvedValue: {},
        },
        candidateIds: list.map((c) => c.sourceCandidateId),
      });
    }
  }

  // Scope acknowledgements (REPORTE) — not CONFLICT candidates, but require named resolutions
  const scopeAck: Array<{ area: string; problem: string; concept: string }> = [
    {
      area: 'REPORTE',
      concept: 'DINERO_OSCAR',
      problem:
        'REPORTE DINERO_OSCAR differs from operational package because OSCAR PAPA CAMI is DEFERRED (known scope difference).',
    },
    {
      area: 'REPORTE',
      concept: 'CXC_MXN',
      problem:
        'REPORTE CXC_MXN may differ while CXC balance/profit human decisions remain open; do not insert balancing entries.',
    },
    {
      area: 'REPORTE',
      concept: 'EFECTIVO_USD',
      problem:
        'REPORTE EFECTIVO_USD mismatch remains unexplained until cash USD reconciliation is reviewed; do not force totals.',
    },
    {
      area: 'REPORTE',
      concept: 'CXP_USD / UTILIDADES',
      problem: 'REPORTE marks CXP_USD and UTILIDADES as SCOPE_REVIEW_REQUIRED (derived/scope).',
    },
  ];
  for (const s of scopeAck) {
    const id = nextId();
    decisions.push({
      id,
      area: s.area,
      sourceRef: `REPORTE / ${s.concept}`,
      problem: s.problem,
      options: [
        'A. ACKNOWLEDGE_SCOPE_DIFFERENCE (named resolution)',
        'B. Investigate parser/classification defect',
        'C. Leave open — block production until explained',
      ],
      recommended:
        s.concept === 'DINERO_OSCAR'
          ? 'A — known deferred Oscar scope'
          : null,
      impact: ['reconciliation only — no operational CREATE'],
      resolutionTemplate: {
        id: `res_${id.toLowerCase()}`,
        entityType: 'reconciliation',
        sourceCandidateId: null,
        issueCode: 'REPORTE_SCOPE',
        resolutionType: 'ACKNOWLEDGE_SCOPE_DIFFERENCE',
        reason: '',
        actor: '',
        date: '',
        resolvedValue: { concept: s.concept },
      },
      candidateIds: [],
    });
  }

  const md: string[] = [
    '# Wrist Caviar — HUMAN REVIEW',
    '',
    `Fingerprint prefix: \`${opts.fingerprintPrefix}\``,
    `Total grouped decisions required: **${decisions.length}**`,
    `Remaining CONFLICT candidates: **${conflicts.length}**`,
    '',
    'Sensitive source values (names, serials, amounts, concepts) are omitted here.',
    'Inspect the private local conflict payloads and `human-review-private.json` for ids.',
    '',
    '## Summary by area',
    '',
    '| Area | Decisions |',
    '|---|---:|',
  ];

  const byArea: Record<string, number> = {};
  for (const d of decisions) byArea[d.area] = (byArea[d.area] || 0) + 1;
  for (const [a, n] of Object.entries(byArea).sort()) {
    md.push(`| ${a} | ${n} |`);
  }
  md.push('');

  for (const d of decisions) {
    md.push(`## Decision ${d.id}`);
    md.push('');
    md.push(`Area:`);
    md.push(d.area);
    md.push('');
    md.push(`Source:`);
    md.push(d.sourceRef);
    md.push('');
    md.push(`Problem:`);
    md.push(d.problem);
    md.push('');
    md.push(`Source value:`);
    md.push(moneySafe(null));
    md.push('');
    md.push(`Calculated value:`);
    md.push(moneySafe(null));
    md.push('');
    md.push(`Options:`);
    for (const o of d.options) md.push(o);
    md.push('');
    md.push(`Recommended option:`);
    md.push(d.recommended ?? 'None — human judgment required');
    md.push('');
    md.push(`Impact:`);
    for (const i of d.impact) md.push(`- ${i}`);
    md.push('');
    md.push(`Resolution entry to add:`);
    md.push('```json');
    md.push(JSON.stringify(d.resolutionTemplate, null, 2));
    md.push('```');
    md.push('');
  }

  fs.writeFileSync(path.join(opts.outDir, 'HUMAN_REVIEW.md'), md.join('\n'));
  fs.writeFileSync(
    path.join(opts.outDir, 'human-review-private.json'),
    JSON.stringify(
      {
        fingerprintPrefix: opts.fingerprintPrefix,
        decisionCount: decisions.length,
        decisions: decisions.map((d) => ({
          id: d.id,
          area: d.area,
          sourceRef: d.sourceRef,
          problem: d.problem,
          candidateIds: d.candidateIds,
          resolutionTemplate: d.resolutionTemplate,
        })),
      },
      null,
      2,
    ),
  );

  return { decisionCount: decisions.length, decisions };
}
