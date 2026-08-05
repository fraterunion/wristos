/**
 * One-time Wrist Caviar opening capital backfill.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/migrations/wrist-caviar/seed-opening-capital.ts
 *   APPLY=1 npx tsx scripts/migrations/wrist-caviar/seed-opening-capital.ts
 *
 * Does NOT create TreasuryEntry, InvestorContribution, cash/bank movements,
 * or touch CXC/CXP/inventory/sales.
 */
import { PrismaClient, Currency } from '@prisma/client';

const TENANT_ID = 'cmnzph8dm0000qotapt94alxs';
const SOURCE = 'wrist-caviar-opening-capital-2025-07-29';
const EFFECTIVE_DATE = new Date('2025-07-29T12:00:00.000Z');
const NOTES =
  'Saldo inicial de capital registrado al comenzar la operación en WristOS. No representa una aportación realizada hoy.';

const OPENING = [
  {
    investorId: 'cms6f6cn404su9kfvdnh65ynb',
    name: 'CESAR',
    amount: 582000,
  },
  {
    investorId: 'cms6f6dfc04t89kfvas9x4c59',
    name: 'EDGAR',
    amount: 4530500,
  },
] as const;

async function main() {
  const apply = process.env.APPLY === '1';
  const dryRun = !apply;

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL required');
  }

  const prisma = new PrismaClient();
  try {
    const investors = await prisma.investor.findMany({
      where: {
        tenantId: TENANT_ID,
        id: { in: OPENING.map((o) => o.investorId) },
        deletedAt: null,
      },
      select: { id: true, name: true, ownershipPercent: true },
    });

    if (investors.length !== OPENING.length) {
      throw new Error(
        `Expected ${OPENING.length} investors, found ${investors.length}. Aborting.`,
      );
    }

    for (const row of OPENING) {
      const inv = investors.find((i) => i.id === row.investorId);
      if (!inv) throw new Error(`Missing investor ${row.name} (${row.investorId})`);
      if (inv.name.toUpperCase() !== row.name) {
        throw new Error(
          `Investor name mismatch for ${row.investorId}: expected ${row.name}, got ${inv.name}`,
        );
      }
    }

    const existing = await prisma.investorOpeningBalance.findMany({
      where: {
        tenantId: TENANT_ID,
        source: SOURCE,
        deletedAt: null,
      },
    });

    const planned = OPENING.map((row) => ({
      tenantId: TENANT_ID,
      investorId: row.investorId,
      investorName: row.name,
      amount: row.amount,
      currency: Currency.MXN,
      effectiveDate: EFFECTIVE_DATE.toISOString(),
      source: SOURCE,
      notes: NOTES,
      alreadyExists: existing.some((e) => e.investorId === row.investorId),
    }));

    const total = planned.reduce((s, p) => s + p.amount, 0);
    if (total !== 5112500) {
      throw new Error(`Total opening capital must be 5112500, got ${total}`);
    }

    // Snapshot KPI inputs (read-only)
    const contributionCount = await prisma.investorContribution.count({
      where: { tenantId: TENANT_ID, deletedAt: null },
    });
    const treasuryLinkedToNew = 0; // seed never writes treasury

    console.log(
      JSON.stringify(
        {
          mode: dryRun ? 'DRY_RUN' : 'APPLY',
          tenantId: TENANT_ID,
          source: SOURCE,
          effectiveDate: EFFECTIVE_DATE.toISOString(),
          planned,
          totalOpeningCapital: total,
          existingOpeningRows: existing.length,
          investorContributionCount: contributionCount,
          willCreateTreasuryEntries: treasuryLinkedToNew,
          willCreateInvestorContributions: false,
        },
        null,
        2,
      ),
    );

    if (dryRun) {
      console.log('\nDry-run only. Re-run with APPLY=1 to write.');
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const created: string[] = [];
      const skipped: string[] = [];

      for (const row of OPENING) {
        const found = await tx.investorOpeningBalance.findFirst({
          where: {
            tenantId: TENANT_ID,
            investorId: row.investorId,
            source: SOURCE,
            deletedAt: null,
          },
        });
        if (found) {
          skipped.push(found.id);
          continue;
        }

        const rec = await tx.investorOpeningBalance.create({
          data: {
            tenantId: TENANT_ID,
            investorId: row.investorId,
            amount: row.amount,
            currency: Currency.MXN,
            effectiveDate: EFFECTIVE_DATE,
            source: SOURCE,
            notes: NOTES,
            createdBy: 'seed-opening-capital',
          },
        });
        created.push(rec.id);
      }

      // Guard: never create treasury or contribution rows in this transaction.
      const treasuryCount = await tx.treasuryEntry.count({
        where: {
          tenantId: TENANT_ID,
          description: { contains: 'opening capital' },
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
      if (treasuryCount > 0) {
        throw new Error('Unexpected treasury entries detected — aborting');
      }

      return { created, skipped };
    });

    console.log(JSON.stringify({ applied: result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
