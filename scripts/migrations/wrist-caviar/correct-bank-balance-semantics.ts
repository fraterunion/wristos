/**
 * Wrist Caviar — BANK Treasury semantic correction (one-time, deterministic).
 *
 * Creates additional OUTFLOW rows for:
 * 1) Deposit commissions that never reduced balance (commission stays on INFLOW for KPI)
 * 2) Withdrawals dropped on dual deposit+withdrawal workbook rows
 *
 * Idempotent via description markers:
 *   migration:{sid}; kind=commission-outflow; ...
 *   migration:{sid}; kind=withdrawal-outflow; ...
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/migrations/wrist-caviar/correct-bank-balance-semantics.ts
 *   APPLY=1 npx tsx scripts/migrations/wrist-caviar/correct-bank-balance-semantics.ts
 */
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const TENANT = 'cmnzph8dm0000qotapt94alxs';
const DRY_RUN = process.env.APPLY !== '1';

type PkgRow = {
  sourceCandidateId: string;
  sourceRow: number;
  normalizedPayload: {
    entryDate: string;
    deposit?: number | null;
    withdrawal?: number | null;
    commission?: number | null;
    reference?: string | null;
  };
};

function parseSrc(desc: string | null | undefined): string | null {
  const m = /migration:(bank_\d+)/.exec(desc || '');
  return m ? m[1]! : null;
}

function dec(n: number) {
  return new Prisma.Decimal(n);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');

  const bankPkg = Object.values(
    require('../../../.local/migrations/wrist-caviar/066c10dab5dd/bank.json'),
  ) as PkgRow[];

  const prisma = new PrismaClient();
  const backupDir = path.resolve(
    '.local/migrations/wrist-caviar/066c10dab5dd/backups',
    `bank-correct-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    const existing = await prisma.treasuryEntry.findMany({
      where: { tenantId: TENANT, deletedAt: null, account: 'BANK' },
    });
    fs.writeFileSync(
      path.join(backupDir, 'bank-treasury-before.json'),
      JSON.stringify(existing, null, 2),
    );

    const bySrc = new Map<string, typeof existing>();
    for (const e of existing) {
      const sid = parseSrc(e.description);
      if (!sid) continue;
      const list = bySrc.get(sid) ?? [];
      list.push(e);
      bySrc.set(sid, list);
    }

    type Action = {
      sid: string;
      workbookRow: number;
      date: string;
      kind: 'COMMISSION' | 'WITHDRAWAL';
      amountMxn: number;
      parentInflowId: string;
      deposit: number;
      withdrawal: number;
      commission: number;
    };

    const actions: Action[] = [];
    let alreadyPresent = 0;

    for (const row of bankPkg) {
      const sid = row.sourceCandidateId;
      const pl = row.normalizedPayload;
      const deposit = Number(pl.deposit ?? 0);
      const withdrawal = Number(pl.withdrawal ?? 0);
      const commission = Number(pl.commission ?? 0);
      const rows = bySrc.get(sid) ?? [];
      const inflow = rows.find((e) => e.direction === 'INFLOW');
      if (!inflow) continue;

      const hasCommOut = rows.some(
        (e) =>
          e.direction === 'OUTFLOW' &&
          (e.description || '').includes('kind=commission-outflow'),
      );
      const hasWdOut = rows.some(
        (e) =>
          e.direction === 'OUTFLOW' &&
          (e.description || '').includes('kind=withdrawal-outflow'),
      );

      // Deposit-path commission: create dedicated OUTFLOW (do not touch withdrawal-embedded commissions)
      if (deposit > 0 && commission > 0) {
        if (hasCommOut) alreadyPresent += 1;
        else {
          actions.push({
            sid,
            workbookRow: row.sourceRow,
            date: pl.entryDate,
            kind: 'COMMISSION',
            amountMxn: commission,
            parentInflowId: inflow.id,
            deposit,
            withdrawal,
            commission,
          });
        }
      }

      // Dual-row dropped withdrawal
      if (deposit > 0 && withdrawal > 0) {
        if (hasWdOut) alreadyPresent += 1;
        else {
          actions.push({
            sid,
            workbookRow: row.sourceRow,
            date: pl.entryDate,
            kind: 'WITHDRAWAL',
            amountMxn: withdrawal,
            parentInflowId: inflow.id,
            deposit,
            withdrawal,
            commission,
          });
        }
      }
    }

    const sumComm = actions
      .filter((a) => a.kind === 'COMMISSION')
      .reduce((s, a) => s + a.amountMxn, 0);
    const sumWd = actions
      .filter((a) => a.kind === 'WITHDRAWAL')
      .reduce((s, a) => s + a.amountMxn, 0);

    let currentNet = 0;
    for (const e of existing) {
      const a = Number(e.amountMxn);
      currentNet += e.direction === 'INFLOW' ? a : -a;
    }
    const expectedNet = currentNet - sumComm - sumWd;

    const julyActions = actions.filter((a) => a.date.startsWith('2026-07'));
    const julyOutAdd = julyActions.reduce((s, a) => s + a.amountMxn, 0);

    const planPath = path.join(backupDir, 'write-plan.json');
    fs.writeFileSync(
      planPath,
      JSON.stringify(
        {
          tenantId: TENANT,
          dryRun: DRY_RUN,
          currentNet,
          expectedNet,
          movementDerivedTarget: 4769759.4358,
          reporteG631: 4720789.44,
          reginaStated: 4770289,
          sumCommissionOutflows: sumComm,
          sumWithdrawalOutflows: sumWd,
          actionCount: actions.length,
          alreadyPresent,
          julyOutflowAddition: julyOutAdd,
          julyActions,
          actions,
        },
        null,
        2,
      ),
    );

    console.log(
      JSON.stringify(
        {
          backupDir,
          dryRun: DRY_RUN,
          currentNet,
          expectedNet,
          sumComm,
          sumWd,
          actionCount: actions.length,
          alreadyPresent,
          julyOutflowAddition: julyOutAdd,
          dualWithdrawalActions: actions.filter((a) => a.kind === 'WITHDRAWAL'),
        },
        null,
        2,
      ),
    );

    if (DRY_RUN) {
      console.log('DRY RUN only — set APPLY=1 to execute.');
      return;
    }

    // Safety: refuse if expected net drifts from movement-derived by > 1 MXN
    if (Math.abs(expectedNet - 4769759.4358) > 1) {
      throw new Error(
        `Refusing apply: expectedNet ${expectedNet} != movement-derived 4769759.4358`,
      );
    }

    const created = await prisma.$transaction(
      async (tx) => {
        const data = actions.map((a) => {
          const kindTag =
            a.kind === 'COMMISSION' ? 'commission-outflow' : 'withdrawal-outflow';
          return {
            tenantId: TENANT,
            account: 'BANK' as const,
            direction: 'OUTFLOW' as const,
            amount: dec(a.amountMxn),
            currency: 'MXN' as const,
            amountMxn: dec(a.amountMxn),
            commission: null,
            transactionDate: new Date(`${a.date}T00:00:00.000Z`),
            description: `migration:${a.sid}; kind=${kindTag}; parent=${a.parentInflowId}; workbookRow=${a.workbookRow}; ref=`,
          };
        });
        // Batch insert — interactive per-row create timed out at 324 rows.
        const result = await tx.treasuryEntry.createMany({ data });
        return result.count;
      },
      { maxWait: 60_000, timeout: 120_000 },
    );

    const after = await prisma.treasuryEntry.findMany({
      where: { tenantId: TENANT, deletedAt: null, account: 'BANK' },
    });
    let afterNet = 0;
    for (const e of after) {
      const a = Number(e.amountMxn);
      afterNet += e.direction === 'INFLOW' ? a : -a;
    }
    const createdOutflows = after.filter(
      (e) =>
        (e.description || '').includes('kind=commission-outflow') ||
        (e.description || '').includes('kind=withdrawal-outflow'),
    );
    fs.writeFileSync(
      path.join(backupDir, 'bank-treasury-after.json'),
      JSON.stringify(
        {
          afterNet,
          createdCount: created,
          createdOutflowCount: createdOutflows.length,
          createdIds: createdOutflows.map((e) => e.id),
        },
        null,
        2,
      ),
    );

    console.log(
      JSON.stringify(
        { applied: true, created, afterNet, createdOutflowCount: createdOutflows.length },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
