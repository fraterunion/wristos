/**
 * Deterministic backfill of TreasuryEntry.commission for migrated Wrist Caviar BANK rows.
 *
 * Usage:
 *   npx tsx scripts/migrations/wrist-caviar/backfill-treasury-commissions.ts --plan
 *   npx tsx scripts/migrations/wrist-caviar/backfill-treasury-commissions.ts --execute
 *
 * Writes ONLY TreasuryEntry.commission. Never touches amount / amountMxn / description.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  EXPECTED_BANK_COMMISSION_TOTALS,
  parseMigrationBankCommissionDescription,
  WRIST_CAVIAR_BANK_IMPORT_RUN_ID,
  WRIST_CAVIAR_TENANT_ID,
} from '../../../apps/api/src/modules/treasury/migration-bank-commission';

const ARTIFACT_DIR = path.resolve(
  '.local/migrations/wrist-caviar/066c10dab5dd',
);

type PlanRow = {
  treasuryEntryId: string;
  sourceCandidateId: string;
  commission: string;
  transactionDate: string;
  amount: string;
  description: string;
  alreadyPopulated: boolean;
  eligible: boolean;
  excludeReason?: string;
};

type BackfillPlan = {
  generatedAt: string;
  readOnly: boolean;
  tenantId: string;
  importRunId: string;
  expected: typeof EXPECTED_BANK_COMMISSION_TOTALS;
  mapCount: number;
  eligibleRowCount: number;
  nonZeroCommissionRowCount: number;
  zeroCommissionRowCount: number;
  parsedTotal: string;
  parseFailures: Array<{ treasuryEntryId: string; description: string | null; reason: string }>;
  duplicateSourceCandidates: string[];
  alreadyPopulatedRows: number;
  excluded: Array<{ treasuryEntryId?: string; sourceCandidateId?: string; reason: string }>;
  july2026: { total: string; nonZeroRows: number };
  totalsMatchExpected: boolean;
  rows: PlanRow[];
};

function round2(n: Prisma.Decimal): string {
  return n.toFixed(2);
}

async function buildPlan(prisma: PrismaClient): Promise<BackfillPlan> {
  const maps = await prisma.wristCaviarOneTimeImportMap.findMany({
    where: {
      tenantId: WRIST_CAVIAR_TENANT_ID,
      importRunId: WRIST_CAVIAR_BANK_IMPORT_RUN_ID,
      destinationEntityType: 'bank',
    },
    select: {
      sourceCandidateId: true,
      destinationId: true,
    },
  });

  const excluded: BackfillPlan['excluded'] = [];
  const parseFailures: BackfillPlan['parseFailures'] = [];
  const sourceCounts = new Map<string, number>();
  for (const m of maps) {
    sourceCounts.set(m.sourceCandidateId, (sourceCounts.get(m.sourceCandidateId) ?? 0) + 1);
  }
  const duplicateSourceCandidates = [...sourceCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([id]) => id);

  const destIds = maps.map((m) => m.destinationId);
  const entries = await prisma.treasuryEntry.findMany({
    where: { id: { in: destIds } },
    select: {
      id: true,
      tenantId: true,
      account: true,
      amount: true,
      amountMxn: true,
      commission: true,
      description: true,
      transactionDate: true,
      deletedAt: true,
    },
  });
  const byId = new Map(entries.map((e) => [e.id, e]));

  const rows: PlanRow[] = [];
  let eligibleRowCount = 0;
  let nonZeroCommissionRowCount = 0;
  let zeroCommissionRowCount = 0;
  let alreadyPopulatedRows = 0;
  let parsedTotal = new Prisma.Decimal(0);
  let julyTotal = new Prisma.Decimal(0);
  let julyNonZero = 0;

  for (const map of maps) {
    const entry = byId.get(map.destinationId);
    if (!entry) {
      excluded.push({
        sourceCandidateId: map.sourceCandidateId,
        reason: 'destination treasury entry missing',
      });
      continue;
    }
    if (entry.tenantId !== WRIST_CAVIAR_TENANT_ID) {
      excluded.push({
        treasuryEntryId: entry.id,
        sourceCandidateId: map.sourceCandidateId,
        reason: 'cross-tenant destination',
      });
      continue;
    }
    if (entry.account !== 'BANK') {
      excluded.push({
        treasuryEntryId: entry.id,
        sourceCandidateId: map.sourceCandidateId,
        reason: `account=${entry.account} (expected BANK)`,
      });
      continue;
    }
    if (entry.deletedAt) {
      excluded.push({
        treasuryEntryId: entry.id,
        sourceCandidateId: map.sourceCandidateId,
        reason: 'soft-deleted',
      });
      continue;
    }

    const parsed = parseMigrationBankCommissionDescription(entry.description);
    if (!parsed) {
      parseFailures.push({
        treasuryEntryId: entry.id,
        description: entry.description,
        reason: 'description does not match exact migration commission format',
      });
      excluded.push({
        treasuryEntryId: entry.id,
        sourceCandidateId: map.sourceCandidateId,
        reason: 'parse failure',
      });
      continue;
    }
    if (parsed.sourceCandidateId !== map.sourceCandidateId) {
      parseFailures.push({
        treasuryEntryId: entry.id,
        description: entry.description,
        reason: `sourceCandidateId mismatch map=${map.sourceCandidateId} desc=${parsed.sourceCandidateId}`,
      });
      excluded.push({
        treasuryEntryId: entry.id,
        sourceCandidateId: map.sourceCandidateId,
        reason: 'sourceCandidateId mismatch',
      });
      continue;
    }

    const alreadyPopulated = entry.commission != null;
    if (alreadyPopulated) alreadyPopulatedRows += 1;

    const eligible = !alreadyPopulated;
    if (eligible) eligibleRowCount += 1;

    if (parsed.commission.greaterThan(0)) {
      nonZeroCommissionRowCount += 1;
      parsedTotal = parsedTotal.plus(parsed.commission);
      const y = entry.transactionDate.getUTCFullYear();
      const m = entry.transactionDate.getUTCMonth();
      if (y === 2026 && m === 6) {
        julyTotal = julyTotal.plus(parsed.commission);
        julyNonZero += 1;
      }
    } else {
      zeroCommissionRowCount += 1;
    }

    rows.push({
      treasuryEntryId: entry.id,
      sourceCandidateId: map.sourceCandidateId,
      commission: parsed.commission.toFixed(2),
      transactionDate: entry.transactionDate.toISOString(),
      amount: entry.amount.toFixed(2),
      description: entry.description ?? '',
      alreadyPopulated,
      eligible,
      excludeReason: alreadyPopulated ? 'commission already populated' : undefined,
    });
  }

  const expected = EXPECTED_BANK_COMMISSION_TOTALS;
  const totalsMatchExpected =
    maps.length === expected.migratedBankRows &&
    nonZeroCommissionRowCount === expected.nonZeroRows &&
    round2(parsedTotal) === expected.allTimeTotal &&
    round2(julyTotal) === expected.july2026Total &&
    julyNonZero === expected.july2026Rows &&
    parseFailures.length === 0 &&
    duplicateSourceCandidates.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    tenantId: WRIST_CAVIAR_TENANT_ID,
    importRunId: WRIST_CAVIAR_BANK_IMPORT_RUN_ID,
    expected,
    mapCount: maps.length,
    eligibleRowCount,
    nonZeroCommissionRowCount,
    zeroCommissionRowCount,
    parsedTotal: round2(parsedTotal),
    parseFailures,
    duplicateSourceCandidates,
    alreadyPopulatedRows,
    excluded,
    july2026: { total: round2(julyTotal), nonZeroRows: julyNonZero },
    totalsMatchExpected,
    rows,
  };
}

async function executeBackfill(prisma: PrismaClient, plan: BackfillPlan) {
  if (!plan.totalsMatchExpected) {
    throw new Error('Refusing to execute: plan totals do not match expected gates');
  }
  const toWrite = plan.rows.filter((r) => r.eligible);
  if (toWrite.length !== EXPECTED_BANK_COMMISSION_TOTALS.migratedBankRows) {
    throw new Error(
      `Expected ${EXPECTED_BANK_COMMISSION_TOTALS.migratedBankRows} eligible writes, got ${toWrite.length}`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    let updated = 0;
    for (const row of toWrite) {
      const before = await tx.treasuryEntry.findUnique({
        where: { id: row.treasuryEntryId },
        select: {
          tenantId: true,
          account: true,
          amount: true,
          amountMxn: true,
          description: true,
          commission: true,
        },
      });
      if (!before) throw new Error(`Missing entry ${row.treasuryEntryId}`);
      if (before.tenantId !== WRIST_CAVIAR_TENANT_ID) {
        throw new Error(`Cross-tenant write blocked: ${row.treasuryEntryId}`);
      }
      if (before.account !== 'BANK') throw new Error(`Non-BANK blocked: ${row.treasuryEntryId}`);
      if (before.commission != null) {
        throw new Error(`Already populated during execute: ${row.treasuryEntryId}`);
      }
      if (before.description !== row.description) {
        throw new Error(`Description drift: ${row.treasuryEntryId}`);
      }
      if (before.amount.toFixed(2) !== row.amount) {
        throw new Error(`Amount drift: ${row.treasuryEntryId}`);
      }

      await tx.treasuryEntry.update({
        where: { id: row.treasuryEntryId },
        data: { commission: new Prisma.Decimal(row.commission) },
      });
      updated += 1;
    }
    return { updated };
  });

  return result;
}

async function verifyAfter(prisma: PrismaClient) {
  const rows = await prisma.treasuryEntry.findMany({
    where: {
      tenantId: WRIST_CAVIAR_TENANT_ID,
      account: 'BANK',
      deletedAt: null,
      commission: { not: null },
    },
    select: { commission: true, transactionDate: true, amount: true, description: true },
  });

  let total = new Prisma.Decimal(0);
  let nonZero = 0;
  let julyTotal = new Prisma.Decimal(0);
  let julyNonZero = 0;
  for (const r of rows) {
    const c = r.commission!;
    if (c.greaterThan(0)) {
      nonZero += 1;
      total = total.plus(c);
      if (
        r.transactionDate.getUTCFullYear() === 2026 &&
        r.transactionDate.getUTCMonth() === 6
      ) {
        julyTotal = julyTotal.plus(c);
        julyNonZero += 1;
      }
    }
  }

  // Cross-tenant check
  const otherTenantPopulated = await prisma.treasuryEntry.count({
    where: {
      tenantId: { not: WRIST_CAVIAR_TENANT_ID },
      commission: { not: null },
    },
  });

  return {
    populatedRows: rows.length,
    nonZero,
    total: total.toFixed(2),
    july2026Total: julyTotal.toFixed(2),
    july2026Rows: julyNonZero,
    otherTenantPopulated,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const doPlan = args.includes('--plan') || !args.includes('--execute');
  const doExecute = args.includes('--execute');

  const prisma = new PrismaClient();
  try {
    const plan = await buildPlan(prisma);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const planPath = path.join(ARTIFACT_DIR, 'treasury-commission-backfill-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

    console.log(
      JSON.stringify(
        {
          phase: 'plan',
          planPath,
          mapCount: plan.mapCount,
          eligibleRowCount: plan.eligibleRowCount,
          nonZeroCommissionRowCount: plan.nonZeroCommissionRowCount,
          zeroCommissionRowCount: plan.zeroCommissionRowCount,
          parsedTotal: plan.parsedTotal,
          parseFailures: plan.parseFailures.length,
          duplicateSourceCandidates: plan.duplicateSourceCandidates.length,
          alreadyPopulatedRows: plan.alreadyPopulatedRows,
          excluded: plan.excluded.length,
          july2026: plan.july2026,
          totalsMatchExpected: plan.totalsMatchExpected,
        },
        null,
        2,
      ),
    );

    if (!plan.totalsMatchExpected) {
      console.error('BLOCKED: plan totals do not match expected gates');
      process.exitCode = 2;
      return;
    }

    if (doExecute) {
      if (doPlan && !args.includes('--execute')) return;
      const execResult = await executeBackfill(prisma, plan);
      const verification = await verifyAfter(prisma);
      const result = {
        phase: 'execute',
        executedAt: new Date().toISOString(),
        execResult,
        verification,
        ok:
          verification.populatedRows === EXPECTED_BANK_COMMISSION_TOTALS.migratedBankRows &&
          verification.nonZero === EXPECTED_BANK_COMMISSION_TOTALS.nonZeroRows &&
          verification.total === EXPECTED_BANK_COMMISSION_TOTALS.allTimeTotal &&
          verification.july2026Total === EXPECTED_BANK_COMMISSION_TOTALS.july2026Total &&
          verification.july2026Rows === EXPECTED_BANK_COMMISSION_TOTALS.july2026Rows &&
          verification.otherTenantPopulated === 0,
      };
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, 'treasury-commission-backfill-result.json'),
        JSON.stringify(result, null, 2),
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exitCode = 3;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
