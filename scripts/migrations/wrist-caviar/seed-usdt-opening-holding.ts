/**
 * Wrist Caviar — seed confirmed USDT opening crypto holding (idempotent).
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/migrations/wrist-caviar/seed-usdt-opening-holding.ts
 *   APPLY=1  npx tsx scripts/migrations/wrist-caviar/seed-usdt-opening-holding.ts
 *
 * Aborts if an active USDT AssetHolding already exists for the tenant.
 * Does NOT write Treasury / AccountEntry / Capital / Profit.
 */
import { Prisma, PrismaClient } from '@prisma/client';

const TENANT = 'cmnzph8dm0000qotapt94alxs';
const ACTOR_USER_ID = 'cmo0lo0ad0004qtfbo7mbggi7'; // cesar.trejo@wristcaviar.com
const APPLY = process.env.APPLY === '1';
const QUANTITY = '170949.66';
const TICKER = 'USDT';
const SOURCE_KEY = 'wrist-caviar-usdt-opening-2026-08-05';

async function getUsdMxn(jwtSecret: string): Promise<{ rate: number; fetchedAt: string }> {
  if (process.env.OVERRIDE_USD_MXN) {
    return { rate: Number(process.env.OVERRIDE_USD_MXN), fetchedAt: new Date().toISOString() };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const token = jwt.sign(
    { userId: ACTOR_USER_ID, email: 'cesar.trejo@wristcaviar.com', tenantId: TENANT },
    jwtSecret,
    { expiresIn: '10m' },
  );
  const base =
    process.env.API_BASE_URL ?? 'https://wristos-api-prod-production.up.railway.app/api';
  const res = await fetch(`${base}/fx/usd-mxn`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`FX fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { rate: number; fetchedAt: string };
  return { rate: body.rate, fetchedAt: body.fetchedAt };
}

async function treasuryBalances(prisma: PrismaClient) {
  // Mirror TreasuryService: BANK/CESAR net amountMxn; CASH via physical adjustment
  const groups = await prisma.treasuryEntry.groupBy({
    by: ['account', 'direction'],
    where: { tenantId: TENANT, deletedAt: null },
    _sum: { amountMxn: true },
  });
  let bank = new Prisma.Decimal(0);
  let cesar = new Prisma.Decimal(0);
  for (const row of groups) {
    if (row.account === 'CASH') continue;
    const sum = row._sum.amountMxn ?? new Prisma.Decimal(0);
    const delta = row.direction === 'INFLOW' ? sum : sum.negated();
    if (row.account === 'BANK') bank = bank.plus(delta);
    if (row.account === 'CESAR') cesar = cesar.plus(delta);
  }
  const adj = await prisma.physicalCashBalanceAdjustment.findFirst({
    where: { tenantId: TENANT, deletedAt: null, currency: 'MXN' },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });
  let cash = new Prisma.Decimal(0);
  if (adj) {
    cash = adj.resultingBalance;
    const after = await prisma.treasuryEntry.groupBy({
      by: ['direction'],
      where: {
        tenantId: TENANT,
        account: 'CASH',
        deletedAt: null,
        currency: 'MXN',
        transactionDate: { gt: adj.effectiveDate },
      },
      _sum: { amountMxn: true },
    });
    for (const row of after) {
      const sum = row._sum.amountMxn ?? new Prisma.Decimal(0);
      cash = row.direction === 'INFLOW' ? cash.plus(sum) : cash.minus(sum);
    }
  }
  return { cash: cash.toFixed(2), bank: bank.toFixed(2), cesar: cesar.toFixed(2) };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  if (!process.env.JWT_SECRET && !process.env.OVERRIDE_USD_MXN) {
    throw new Error('JWT_SECRET or OVERRIDE_USD_MXN required');
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.assetHolding.findFirst({
      where: {
        tenantId: TENANT,
        assetType: 'CRYPTO',
        ticker: TICKER,
        deletedAt: null,
      },
    });
    if (existing) {
      console.error(
        JSON.stringify(
          {
            aborted: true,
            reason: 'Active USDT holding already exists — refusing duplicate',
            existingId: existing.id,
            quantity: existing.quantity.toString(),
            location: existing.location,
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }

    const fx = await getUsdMxn(process.env.JWT_SECRET ?? 'unused');
    const priceMxn = new Prisma.Decimal(fx.rate.toFixed(8));
    const quantity = new Prisma.Decimal(QUANTITY);
    const cryptoValue = quantity.mul(priceMxn);
    const before = await treasuryBalances(prisma);
    const liqBefore =
      Number(before.cash) + Number(before.bank) + Number(before.cesar) + 0;
    const liqAfter = liqBefore + Number(cryptoValue.toFixed(2));

    const plan = {
      mode: APPLY ? 'APPLY' : 'DRY_RUN',
      tenantId: TENANT,
      holding: {
        ticker: TICKER,
        name: 'Tether USD',
        quantity: QUANTITY,
        averageCostMxn: null,
        location: 'Cuenta Crypto César',
        custodian: 'César',
        notes: `Opening balance confirmed by Regina [${SOURCE_KEY}]`,
      },
      price: {
        ticker: TICKER,
        priceMxn: priceMxn.toFixed(8),
        capturedAt: new Date().toISOString(),
        source: 'Manual opening balance',
        notes: `Stablecoin/USD-equivalent valuation via WristOS USD/MXN ${fx.rate} (fetchedAt ${fx.fetchedAt})`,
        createdByUserId: ACTOR_USER_ID,
      },
      valuation: {
        cryptoCurrentValueMxn: cryptoValue.toFixed(2),
        liquidityBefore: liqBefore.toFixed(2),
        liquidityAfter: liqAfter.toFixed(2),
        cash: before.cash,
        bank: before.bank,
        cesar: before.cesar,
      },
    };
    console.log(JSON.stringify(plan, null, 2));

    if (!APPLY) {
      console.log('DRY_RUN complete — no writes.');
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const again = await tx.assetHolding.findFirst({
        where: {
          tenantId: TENANT,
          assetType: 'CRYPTO',
          ticker: TICKER,
          deletedAt: null,
        },
      });
      if (again) {
        throw new Error(`Abort in transaction: USDT holding ${again.id} already exists`);
      }

      const holding = await tx.assetHolding.create({
        data: {
          tenantId: TENANT,
          assetType: 'CRYPTO',
          ticker: TICKER,
          name: 'Tether USD',
          quantity,
          averageCostMxn: null,
          location: 'Cuenta Crypto César',
          custodian: 'César',
          notes: `Opening balance confirmed by Regina [${SOURCE_KEY}]`,
        },
      });

      const capturedAt = new Date();
      const snapshot = await tx.assetPriceSnapshot.create({
        data: {
          tenantId: TENANT,
          assetType: 'CRYPTO',
          ticker: TICKER,
          priceMxn,
          capturedAt,
          source: 'Manual opening balance',
          notes: `Stablecoin/USD-equivalent valuation via WristOS USD/MXN ${fx.rate} (fetchedAt ${fx.fetchedAt})`,
          createdByUserId: ACTOR_USER_ID,
        },
      });

      // Sanity: no treasury writes in this transaction
      return { holding, snapshot };
    });

    const afterBal = await treasuryBalances(prisma);
    const holdings = await prisma.assetHolding.findMany({
      where: { tenantId: TENANT, deletedAt: null },
    });
    const snaps = await prisma.assetPriceSnapshot.count({
      where: { tenantId: TENANT, ticker: TICKER },
    });

    console.log(
      JSON.stringify(
        {
          applied: true,
          holdingId: result.holding.id,
          snapshotId: result.snapshot.id,
          quantity: result.holding.quantity.toString(),
          averageCostMxn: result.holding.averageCostMxn,
          priceMxn: result.snapshot.priceMxn.toFixed(8),
          capturedAt: result.snapshot.capturedAt.toISOString(),
          cryptoCurrentValueMxn: cryptoValue.toFixed(2),
          liquidityBefore: liqBefore.toFixed(2),
          liquidityAfter: (
            Number(afterBal.cash) +
            Number(afterBal.bank) +
            Number(afterBal.cesar) +
            Number(cryptoValue.toFixed(2))
          ).toFixed(2),
          cashAfter: afterBal.cash,
          bankAfter: afterBal.bank,
          cesarAfter: afterBal.cesar,
          activeHoldings: holdings.length,
          usdtSnapshots: snaps,
          treasuryUnchanged:
            afterBal.cash === before.cash &&
            afterBal.bank === before.bank &&
            afterBal.cesar === before.cesar,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
