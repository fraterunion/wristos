/**
 * Reclassify two mis-mapped internet OperatingExpense rows from BANK_FEES → OTHER.
 *
 * Usage:
 *   npx tsx scripts/migrations/wrist-caviar/reclassify-internet-expenses.ts --plan
 *   npx tsx scripts/migrations/wrist-caviar/reclassify-internet-expenses.ts --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { WRIST_CAVIAR_TENANT_ID } from '../../../apps/api/src/modules/treasury/migration-bank-commission';

const TARGET_IDS = [
  'cms6f4kz502d39kfvj14ogxmp',
  'cms6f4r6802kr9kfvhxc2p7gt',
] as const;

const ARTIFACT_DIR = path.resolve('.local/migrations/wrist-caviar/066c10dab5dd');

async function main() {
  const doExecute = process.argv.includes('--execute');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.operatingExpense.findMany({
      where: { id: { in: [...TARGET_IDS] } },
    });

    const plan = {
      generatedAt: new Date().toISOString(),
      tenantId: WRIST_CAVIAR_TENANT_ID,
      targetIds: TARGET_IDS,
      found: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        category: r.category,
        amount: r.amount.toFixed(2),
        expenseDate: r.expenseDate.toISOString(),
        notes: r.notes,
      })),
      expectedCategory: 'BANK_FEES',
      targetCategory: 'OTHER',
      ok:
        rows.length === 2 &&
        rows.every(
          (r) =>
            r.tenantId === WRIST_CAVIAR_TENANT_ID &&
            r.category === 'BANK_FEES' &&
            Number(r.amount) === 1000,
        ),
    };

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'internet-expense-reclassify-plan.json'),
      JSON.stringify(plan, null, 2),
    );
    console.log(JSON.stringify({ phase: 'plan', ...plan }, null, 2));

    if (!plan.ok) {
      console.error('BLOCKED: unexpected drift on internet expense rows');
      process.exitCode = 2;
      return;
    }

    if (!doExecute) return;

    const result = await prisma.$transaction(async (tx) => {
      const updated = [];
      for (const id of TARGET_IDS) {
        const before = await tx.operatingExpense.findUnique({ where: { id } });
        if (!before || before.category !== 'BANK_FEES') {
          throw new Error(`Drift on ${id}`);
        }
        if (before.tenantId !== WRIST_CAVIAR_TENANT_ID) {
          throw new Error(`Cross-tenant blocked ${id}`);
        }
        const after = await tx.operatingExpense.update({
          where: { id },
          data: { category: 'OTHER' },
        });
        updated.push({
          id,
          beforeCategory: before.category,
          afterCategory: after.category,
          amount: after.amount.toFixed(2),
          notes: after.notes,
          expenseDate: after.expenseDate.toISOString(),
        });
      }
      return updated;
    });

    // Operating totals check
    const opEx = await prisma.operatingExpense.findMany({
      where: { tenantId: WRIST_CAVIAR_TENANT_ID },
      select: { category: true, amount: true },
    });
    let operating = 0;
    let commissions = 0;
    let bankFees = 0;
    for (const r of opEx) {
      const amt = Number(r.amount);
      if (r.category === 'COMMISSIONS') commissions += amt;
      else if (r.category === 'BANK_FEES') bankFees += amt;
      else operating += amt;
    }

    const out = {
      phase: 'execute',
      executedAt: new Date().toISOString(),
      updated: result,
      totals: {
        operating: operating.toFixed(2),
        commissions: commissions.toFixed(2),
        bankFeesOpEx: bankFees.toFixed(2),
        expectedOperating: '2227167.74',
      },
      ok: operating.toFixed(2) === '2227167.74' && bankFees === 0,
    };
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'internet-expense-reclassify-result.json'),
      JSON.stringify(out, null, 2),
    );
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exitCode = 3;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
