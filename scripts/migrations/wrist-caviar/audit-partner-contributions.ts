/**
 * READ-ONLY audit of partner contribution sources in the Wrist Caviar package.
 * Does NOT write to production. Produces a migration plan artifact only.
 *
 *   npx tsx scripts/migrations/wrist-caviar/audit-partner-contributions.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const TENANT = 'cmnzph8dm0000qotapt94alxs';
const PKG = path.resolve('.local/migrations/wrist-caviar/066c10dab5dd');

async function main() {
  const partner = JSON.parse(
    fs.readFileSync(path.join(PKG, 'partner-ledger.json'), 'utf8'),
  ) as any[];
  const profit = JSON.parse(
    fs.readFileSync(path.join(PKG, 'profit-distributions.json'), 'utf8'),
  ) as any[];

  const contributions = partner.filter(
    (r) => r.normalizedPayload?.classification === 'CONTRIBUTION',
  );
  const withdrawals = partner.filter(
    (r) => r.normalizedPayload?.classification === 'WITHDRAWAL',
  );

  const prisma = new PrismaClient();
  try {
    const investorContribCount = await prisma.investorContribution.count({
      where: { tenantId: TENANT, deletedAt: null },
    });
    const cesarTreasuryInflows = await prisma.treasuryEntry.count({
      where: {
        tenantId: TENANT,
        account: 'CESAR',
        direction: 'INFLOW',
        deletedAt: null,
        description: { startsWith: 'migration:cesar_' },
      },
    });

    const planRows = contributions.map((r) => ({
      sourceSheet: r.sourceSheet,
      sourceRow: r.sourceRow,
      sourceCandidateId: r.sourceCandidateId,
      partner: 'CESAR',
      date: r.normalizedPayload.entryDate,
      amount: Number(r.normalizedPayload.entryAmount ?? 0),
      currency: 'MXN',
      kind: 'contribution',
      destinationModelIfMigrated: 'InvestorContribution (CESAR investor)',
      alreadyInTreasuryCesar: true,
      doubleCountRisk:
        'YES — already imported as TreasuryEntry CESAR INFLOW. Creating InvestorContribution without excluding treasury would double-count capital vs César liquidity.',
    }));

    const report = {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      finding:
        'CUENTA CESAR partner ledger contains CONTRIBUTION rows already represented as CESAR Treasury inflows. InvestorContribution table is empty. Do NOT invent invested capital without a separate approved migration that chooses one ledger as source of truth.',
      package: {
        contributionRows: contributions.length,
        contributionSumMxn: contributions.reduce(
          (s, r) => s + Number(r.normalizedPayload.entryAmount ?? 0),
          0,
        ),
        withdrawalRows: withdrawals.length,
        withdrawalSumMxn: withdrawals.reduce(
          (s, r) => s + Number(r.normalizedPayload.exitAmount ?? 0),
          0,
        ),
        profitDistributionRows: profit.length,
      },
      production: {
        investorContributionRows: investorContribCount,
        cesarMigrationInflowRows: cesarTreasuryInflows,
      },
      recommendation:
        investorContribCount === 0
          ? 'Leave Capital invertido = 0 and ROI unavailable. UI must show "Sin aportaciones registradas". Optional future migration plan below requires explicit approval.'
          : 'InvestorContribution already populated — review for double-count vs CESAR treasury.',
      migrationPlanOnly: {
        approvedForExecution: false,
        steps: [
          'Decide source of truth: InvestorContribution vs CESAR treasury inflows.',
          'If InvestorContribution: create rows from CONTRIBUTION classifications for CESAR investor only; do NOT adjust treasury amounts.',
          'Edgar/other partners: verify whether contributions exist outside CUENTA CESAR.',
          'Recompute capital invertido / ROI after approval.',
        ],
        sampleRows: planRows.slice(0, 10),
        allContributionRowCount: planRows.length,
      },
    };

    const out = path.join(PKG, 'partner-contribution-source-audit.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Wrote', out);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
