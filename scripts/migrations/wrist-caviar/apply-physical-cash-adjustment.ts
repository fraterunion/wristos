/**
 * Wrist Caviar — record Regina/César physical CASH MXN balance adjustment.
 *
 * Requires prisma migration physical_cash_balance_adjustments.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/migrations/wrist-caviar/apply-physical-cash-adjustment.ts
 *   APPLY=1 npx tsx scripts/migrations/wrist-caviar/apply-physical-cash-adjustment.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

const TENANT = 'cmnzph8dm0000qotapt94alxs';
const DRY_RUN = process.env.APPLY !== '1';
const TARGET = 731200;
const PREVIOUS_DASHBOARD = 3920252; // system KPI Regina saw (MXN+USD converted sum)
const EFFECTIVE = new Date('2026-08-04T00:00:00.000Z');
const REASON =
  'Saldo físico confirmado por Regina/César; ajuste manual de caja';
const SOURCE = 'business-owner-confirmation';
const ACTOR = 'regina-cesar-confirmation/operator-script';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const prisma = new PrismaClient();
  const backupDir = path.resolve(
    '.local/migrations/wrist-caviar/066c10dab5dd/backups',
    `cash-adj-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    const existing = await prisma.physicalCashBalanceAdjustment.findMany({
      where: { tenantId: TENANT, deletedAt: null },
      orderBy: { effectiveDate: 'desc' },
    });
    fs.writeFileSync(
      path.join(backupDir, 'cash-adj-before.json'),
      JSON.stringify(existing, null, 2),
    );

    const duplicate = existing.find(
      (e) =>
        Number(e.resultingBalance) === TARGET &&
        e.source === SOURCE &&
        e.effectiveDate.toISOString().startsWith('2026-08-04'),
    );

    const plan = {
      tenantId: TENANT,
      previousBalance: PREVIOUS_DASHBOARD,
      adjustmentAmount: TARGET - PREVIOUS_DASHBOARD,
      resultingBalance: TARGET,
      reason: REASON,
      source: SOURCE,
      actor: ACTOR,
      effectiveDate: EFFECTIVE.toISOString(),
      action: duplicate ? 'SKIP_EXISTS' : 'CREATE',
      existingId: duplicate?.id ?? null,
    };
    fs.writeFileSync(path.join(backupDir, 'write-plan.json'), JSON.stringify(plan, null, 2));
    console.log(plan);

    if (DRY_RUN) {
      console.log('DRY_RUN — no writes');
      return;
    }
    if (duplicate) {
      console.log('Already present', duplicate.id);
      return;
    }

    const created = await prisma.physicalCashBalanceAdjustment.create({
      data: {
        tenantId: TENANT,
        currency: 'MXN',
        previousBalance: new Prisma.Decimal(PREVIOUS_DASHBOARD),
        adjustmentAmount: new Prisma.Decimal(TARGET - PREVIOUS_DASHBOARD),
        resultingBalance: new Prisma.Decimal(TARGET),
        reason: REASON,
        source: SOURCE,
        actor: ACTOR,
        effectiveDate: EFFECTIVE,
      },
    });

    fs.writeFileSync(
      path.join(backupDir, 'cash-adj-after.json'),
      JSON.stringify(created, null, 2),
    );
    console.log({ createdId: created.id, resulting: Number(created.resultingBalance) });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
