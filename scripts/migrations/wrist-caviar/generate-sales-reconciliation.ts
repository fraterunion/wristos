import * as fs from 'fs';
import * as path from 'path';

import type { CanonicalCandidate } from './build-package';

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Prove 469 historical sales accounting. Local report may include totals;
 * do not commit sensitive totals to git-tracked docs.
 */
export function generateSalesReconciliation(opts: {
  outDir: string;
  fingerprintPrefix: string;
  candidates: CanonicalCandidate[];
  includeSensitiveTotals: boolean;
}): {
  sourceSaleCount: number;
  plannedDealCount: number;
  excludedSaleCount: number;
  conflictedSaleCount: number;
  allAccounted: boolean;
} {
  const sales = opts.candidates.filter((c) => c.entityType === 'sale');
  const byDisp: Record<string, number> = {};
  for (const s of sales) byDisp[s.disposition] = (byDisp[s.disposition] || 0) + 1;

  const sourceSaleCount = sales.length;
  const plannedDealCount =
    (byDisp.CREATE || 0) + (byDisp.LINK || 0) + (byDisp.SKIP || 0);
  const excludedSaleCount = byDisp.EXCLUDED || 0;
  const conflictedSaleCount = byDisp.CONFLICT || 0;
  const deferredSaleCount = byDisp.DEFERRED || 0;
  const accounted =
    (byDisp.CREATE || 0) +
    (byDisp.LINK || 0) +
    (byDisp.SKIP || 0) +
    (byDisp.CONFLICT || 0) +
    (byDisp.DEFERRED || 0) +
    (byDisp.EXCLUDED || 0);

  let sourceSalePrice = 0;
  let plannedSalePrice = 0;
  let sourceCost = 0;
  let plannedCost = 0;
  let sourceExtras = 0;
  let plannedExtras = 0;
  let sourceProfit = 0;
  let plannedProfit = 0;

  for (const s of sales) {
    const p = s.normalizedPayload;
    const salePrice = num(p.salePrice);
    const cost = num(p.cost);
    const extras = num(p.extras);
    const profit = num(p.approvedProfit);
    sourceSalePrice += salePrice;
    sourceCost += cost;
    sourceExtras += extras;
    sourceProfit += profit;
    if (s.disposition === 'CREATE' || s.disposition === 'LINK' || s.disposition === 'SKIP') {
      plannedSalePrice += salePrice;
      plannedCost += cost;
      plannedExtras += extras;
      plannedProfit += profit;
    }
  }

  const allAccounted = accounted === sourceSaleCount && sourceSaleCount === 469;

  const lines = [
    '# Wrist Caviar — Sales Reconciliation',
    '',
    `Fingerprint prefix: \`${opts.fingerprintPrefix}\``,
    '',
    '## Record accounting',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Source sale count | ${sourceSaleCount} |`,
    `| Planned Deal count (CREATE+LINK+SKIP) | ${plannedDealCount} |`,
    `| Excluded sale count | ${excludedSaleCount} |`,
    `| Conflicted sale count | ${conflictedSaleCount} |`,
    `| Deferred sale count | ${deferredSaleCount} |`,
    `| Accounted (all dispositions) | ${accounted} |`,
    `| Identity: source = accounted | ${accounted === sourceSaleCount ? 'PASS' : 'FAIL'} |`,
    `| Expected 469 source sales | ${sourceSaleCount === 469 ? 'PASS' : 'FAIL'} |`,
    `| No silent loss | ${allAccounted && conflictedSaleCount >= 0 ? 'PASS (conflicts explicit)' : 'FAIL'} |`,
    '',
    '## Disposition breakdown',
    '',
    '| Disposition | Count |',
    '|---|---:|',
    ...Object.entries(byDisp)
      .sort()
      .map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Financial proof',
    '',
  ];

  if (opts.includeSensitiveTotals) {
    lines.push(
      '| Metric | Source | Planned | Difference |',
      '|---|---:|---:|---:|',
      `| Total sale price | ${sourceSalePrice} | ${plannedSalePrice} | ${sourceSalePrice - plannedSalePrice} |`,
      `| Total cost | ${sourceCost} | ${plannedCost} | ${sourceCost - plannedCost} |`,
      `| Total extras | ${sourceExtras} | ${plannedExtras} | ${sourceExtras - plannedExtras} |`,
      `| Approved profit | ${sourceProfit} | ${plannedProfit} | ${sourceProfit - plannedProfit} |`,
      '',
      'Note: Planned excludes CONFLICT/EXCLUDED/DEFERRED rows by design.',
      '',
    );
  } else {
    lines.push(
      'Sensitive totals omitted from this view. See local `sales-reconciliation.md` with totals enabled.',
      '',
    );
  }

  lines.push(
    '## Rules',
    '',
    '- Historical sales do not create/mutate current Watch inventory (`mutatesInventory: false`).',
    '- Missing/polluted serials do not block Deal creation.',
    '- Missing reference does not block Deal creation.',
    '',
  );

  fs.writeFileSync(path.join(opts.outDir, 'sales-reconciliation.md'), lines.join('\n'));
  fs.writeFileSync(
    path.join(opts.outDir, 'sales-reconciliation.json'),
    JSON.stringify(
      {
        fingerprintPrefix: opts.fingerprintPrefix,
        sourceSaleCount,
        plannedDealCount,
        excludedSaleCount,
        conflictedSaleCount,
        deferredSaleCount,
        accounted,
        allAccounted,
        dispositions: byDisp,
        financial: opts.includeSensitiveTotals
          ? {
              sourceSalePrice,
              plannedSalePrice,
              sourceCost,
              plannedCost,
              sourceExtras,
              plannedExtras,
              sourceProfit,
              plannedProfit,
            }
          : undefined,
      },
      null,
      2,
    ),
  );

  return {
    sourceSaleCount,
    plannedDealCount,
    excludedSaleCount,
    conflictedSaleCount,
    allAccounted,
  };
}
