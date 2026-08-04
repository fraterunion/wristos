/**
 * Wrist Caviar — import 13 deferred CUENTA CESAR movements as neutral Treasury CESAR rows.
 *
 * Idempotent via description marker:
 *   migration:{cesar_id}; kind=partner-neutral; decision=PARTNER-XXX
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/migrations/wrist-caviar/apply-cesar-neutral-rows.ts
 *   APPLY=1 npx tsx scripts/migrations/wrist-caviar/apply-cesar-neutral-rows.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

const TENANT = 'cmnzph8dm0000qotapt94alxs';
const DRY_RUN = process.env.APPLY !== '1';

const ROWS: Array<{
  id: string;
  decision: string;
  sourceRow: number;
  date: string;
  concept: string;
  entry: number;
  exit: number;
}> = [
  {
    id: 'cesar_000001',
    decision: 'PARTNER-001',
    sourceRow: 4,
    date: '2025-10-13',
    concept: 'PAGO ANTICIPO JOEL FAJARDO SPRITE 2025',
    entry: 50000,
    exit: 0,
  },
  {
    id: 'cesar_000002',
    decision: 'PARTNER-002',
    sourceRow: 5,
    date: '2025-10-13',
    concept: 'PAGO PRESTAMO CESAR',
    entry: 0,
    exit: 50000,
  },
  {
    id: 'cesar_000030',
    decision: 'PARTNER-003',
    sourceRow: 33,
    date: '2025-12-25',
    concept: 'UTILIDAD NACHO DE LA VEGA',
    entry: 18000,
    exit: 0,
  },
  {
    id: 'cesar_000106',
    decision: 'PARTNER-004',
    sourceRow: 109,
    date: '2026-03-24',
    concept: 'ANTICIPO SANTOS JUAN MANUEL REJON',
    entry: 10000,
    exit: 0,
  },
  {
    id: 'cesar_000109',
    decision: 'PARTNER-005',
    sourceRow: 112,
    date: '2026-03-27',
    concept: 'REEMBOLSO ANTICIPO OP36mm azul',
    entry: 0,
    exit: 15000,
  },
  {
    id: 'cesar_000123',
    decision: 'PARTNER-006',
    sourceRow: 126,
    date: '2026-04-10',
    concept: 'ANTICIPO AP Offshore Carbon ceramic',
    entry: 10000,
    exit: 0,
  },
  {
    id: 'cesar_000136',
    decision: 'PARTNER-007',
    sourceRow: 139,
    date: '2026-04-22',
    concept: 'UTILIDAD GMT MASTER',
    entry: 13000,
    exit: 0,
  },
  {
    id: 'cesar_000156',
    decision: 'PARTNER-008',
    sourceRow: 159,
    date: '2026-05-28',
    concept: 'reembolso',
    entry: 75000,
    exit: 0,
  },
  {
    id: 'cesar_000158',
    decision: 'PARTNER-009',
    sourceRow: 161,
    date: '2026-06-01',
    concept: 'utilidad anillo compromiso',
    entry: 14800,
    exit: 0,
  },
  {
    id: 'cesar_000170',
    decision: 'PARTNER-010',
    sourceRow: 173,
    date: '2026-06-05',
    concept: 'cobro utilidad César',
    entry: 0,
    exit: 50000,
  },
  {
    id: 'cesar_000173',
    decision: 'PARTNER-011',
    sourceRow: 176,
    date: '2026-06-10',
    concept: 'Anticipo ghost Roberto cxc',
    entry: 10000,
    exit: 0,
  },
  {
    id: 'cesar_000180',
    decision: 'PARTNER-012',
    sourceRow: 183,
    date: '2026-06-21',
    concept: 'DAVID BOSQUES ANTICIPO',
    entry: 5000,
    exit: 0,
  },
  {
    id: 'cesar_000207',
    decision: 'PARTNER-013',
    sourceRow: 210,
    date: '2026-07-15',
    concept: 'anticipo balón',
    entry: 0,
    exit: 25000,
  },
];

function desc(row: (typeof ROWS)[number]) {
  return `migration:${row.id}; kind=partner-neutral; decision=${row.decision}; sheet=CUENTA CESAR; row=${row.sourceRow}; concept=${row.concept}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const prisma = new PrismaClient();
  const backupDir = path.resolve(
    '.local/migrations/wrist-caviar/066c10dab5dd/backups',
    `cesar-neutral-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    const before = await prisma.treasuryEntry.findMany({
      where: { tenantId: TENANT, account: 'CESAR', deletedAt: null },
    });
    fs.writeFileSync(
      path.join(backupDir, 'cesar-before.json'),
      JSON.stringify(before, null, 2),
    );

    const existingNeutral = before.filter((e) =>
      (e.description || '').includes('kind=partner-neutral'),
    );
    const bySid = new Set(
      existingNeutral
        .map((e) => /migration:(cesar_\d+)/.exec(e.description || '')?.[1])
        .filter(Boolean) as string[],
    );

    const plan = [];
    for (const row of ROWS) {
      if (bySid.has(row.id)) {
        plan.push({ ...row, action: 'SKIP_EXISTS' });
        continue;
      }
      // Also skip if a non-neutral migration row already exists for this candidate
      const already = before.some((e) =>
        (e.description || '').includes(`migration:${row.id}`),
      );
      if (already) {
        plan.push({ ...row, action: 'SKIP_OTHER_MIGRATION_ROW' });
        continue;
      }
      const amount = row.entry > 0 ? row.entry : row.exit;
      const direction = row.entry > 0 ? 'INFLOW' : 'OUTFLOW';
      plan.push({
        ...row,
        action: 'CREATE',
        direction,
        amount,
        description: desc(row),
      });
    }

    fs.writeFileSync(path.join(backupDir, 'write-plan.json'), JSON.stringify(plan, null, 2));
    const netCreate = plan
      .filter((p) => p.action === 'CREATE')
      .reduce((s, p) => s + (p.direction === 'INFLOW' ? p.amount! : -p.amount!), 0);
    console.log({
      dryRun: DRY_RUN,
      create: plan.filter((p) => p.action === 'CREATE').length,
      skip: plan.filter((p) => p.action.startsWith('SKIP')).length,
      netCreate,
      expectedNet: 65800,
    });

    if (DRY_RUN) {
      console.log('DRY_RUN — no writes');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const p of plan) {
        if (p.action !== 'CREATE') continue;
        await tx.treasuryEntry.create({
          data: {
            tenantId: TENANT,
            account: 'CESAR',
            direction: p.direction as 'INFLOW' | 'OUTFLOW',
            amount: new Prisma.Decimal(p.amount!),
            currency: 'MXN',
            amountMxn: new Prisma.Decimal(p.amount!),
            exchangeRate: null,
            commission: null,
            transactionDate: new Date(`${p.date}T12:00:00.000Z`),
            description: p.description!,
          },
        });
      }
    });

    const after = await prisma.treasuryEntry.findMany({
      where: { tenantId: TENANT, account: 'CESAR', deletedAt: null },
    });
    const net = after.reduce(
      (s, e) => s + (e.direction === 'INFLOW' ? 1 : -1) * Number(e.amountMxn),
      0,
    );
    fs.writeFileSync(path.join(backupDir, 'cesar-after.json'), JSON.stringify(after, null, 2));
    fs.writeFileSync(
      path.join(backupDir, 'cesar-after-meta.json'),
      JSON.stringify({ net, expected: 80869.26, count: after.length }, null, 2),
    );
    console.log({ cesarNet: net, expected: 80869.26, ok: Math.abs(net - 80869.26) < 0.01 });
    if (Math.abs(net - 80869.26) >= 0.01) {
      throw new Error(`César net ${net} != 80869.26`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
