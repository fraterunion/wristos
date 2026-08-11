/**
 * Read-only WC / DEMO watch-intelligence dry run.
 * Does NOT mutate any rows. Prints UNIQUE | AMBIGUOUS | NO_MATCH (no serials).
 *
 * Live DB: DATABASE_URL must point at readable Postgres.
 * Offline: DRY_RUN_FIXTURE=1 uses sanitized brand/model fixtures.
 */
import { PrismaClient, WatchStatus } from '@prisma/client';
import { DEMO_FIXTURE_ROWS, WC_FIXTURE_ROWS } from './dry-run-fixtures';
import { expandWatchKnowledge, normalizeWatchQuery } from './expand';
import { rankAndResolveCandidates, scoreWatchCandidate, type InventoryWatchRow } from './score';

const WC = 'cmnzph8dm0000qotapt94alxs';
const DEMO = 'cmp1rirpk0000qt4a2t6rsitb';
const USE_FIXTURE = process.env.DRY_RUN_FIXTURE === '1';

const QUERIES = [
  'Batman',
  'Bruce Wayne',
  'Pepsi',
  'Sprite',
  'Panda',
  'Elephant',
  'AP Elephant',
  'AP Panda',
  'Rolex Panda',
  'PP Nautilus',
  'VC Overseas',
  'Pikachu',
  '126710BLRO',
  '126710 BLNR',
];

async function load(prisma: PrismaClient, tenantId: string): Promise<InventoryWatchRow[]> {
  const watches = await prisma.watch.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: [WatchStatus.AVAILABLE, WatchStatus.RESERVED] },
    },
    select: { id: true, brand: true, model: true, reference: true, status: true },
    take: 500,
  });
  return watches.map((w) => ({
    id: w.id,
    brand: w.brand ?? '',
    model: w.model ?? '',
    referenceNumber: w.reference,
    status: w.status,
  }));
}

function run(query: string, rows: InventoryWatchRow[]) {
  const q = normalizeWatchQuery(query);
  const concept = expandWatchKnowledge(q);
  const scored = rows
    .map((r) => scoreWatchCandidate(r, q, concept))
    .filter(Boolean) as NonNullable<ReturnType<typeof scoreWatchCandidate>>[];
  const { unique, picker } = rankAndResolveCandidates(scored);
  if (unique) {
    return {
      outcome: 'UNIQUE' as const,
      label: `${unique.brand} ${unique.model}${unique.reference ? ` (${unique.reference})` : ''}`,
      scoreKind: unique.scoreKind,
    };
  }
  if (picker.length) {
    return {
      outcome: 'AMBIGUOUS' as const,
      labels: picker.map(
        (c) => `${c.brand} ${c.model}${c.reference ? ` (${c.reference})` : ''}`,
      ),
    };
  }
  return { outcome: 'NO_MATCH' as const };
}

function printTenant(name: string, rows: InventoryWatchRow[]) {
  console.log(`\n=== ${name} (sale-eligible n=${rows.length}) ===`);
  for (const q of QUERIES) {
    const r = run(q, rows);
    if (r.outcome === 'UNIQUE') {
      console.log(`${q.padEnd(16)} UNIQUE     ${r.label} [${r.scoreKind}]`);
    } else if (r.outcome === 'AMBIGUOUS') {
      console.log(`${q.padEnd(16)} AMBIGUOUS  ${r.labels.join(' | ')}`);
    } else {
      console.log(`${q.padEnd(16)} NO_MATCH`);
    }
  }
}

async function main() {
  if (USE_FIXTURE) {
    console.log('(DRY_RUN_FIXTURE=1 — offline sanitized shape, no live DB)');
    printTenant('Wrist Caviar fixture', WC_FIXTURE_ROWS);
    printTenant('DEMO fixture', DEMO_FIXTURE_ROWS);
    return;
  }

  const prisma = new PrismaClient();
  try {
    for (const [name, tenantId] of [
      ['Wrist Caviar', WC],
      ['DEMO', DEMO],
    ] as const) {
      const rows = await load(prisma, tenantId);
      printTenant(name, rows);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
