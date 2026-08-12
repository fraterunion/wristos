/**
 * Isolated DB tests. Requires WRISTOS_TEST_DATABASE_URL (never DATABASE_URL).
 * Skipped when the test URL is unset so CI/unit runs cannot touch production.
 */
import { createHash } from 'node:crypto';

import {
  AccountEntryCategory,
  AccountEntryStatus,
  AccountEntryType,
  AccountEntrySource,
  AIConversationSurface,
  AssetType,
  CounterpartyType,
  Currency,
  DealStage,
  PaymentMethod,
  PrismaClient,
  ReceivableStatus,
  TenantStatus,
  UserStatus,
  WatchStatus,
} from '@prisma/client';

import { resetDemoOperationalData } from './demo-data-reset';
import { provisionDemoTenant } from './demo-tenant-provisioning';
import { DEMO_TENANT_SLUG } from './demo-tenant.constants';

const TEST_URL = process.env.WRISTOS_TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

const PROTECTED_TABLES = [
  'watches',
  'deals',
  'clients',
  'payments',
  'treasury_entries',
  'account_entries',
  'account_payments',
  'account_settlements',
  'operating_expenses',
  'investors',
  'asset_holdings',
] as const;

async function hashTenant(prisma: PrismaClient, table: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ h: string; c: string }>>(
    `SELECT COALESCE(md5(string_agg(t.x, '|' ORDER BY t.x)), 'empty') AS h, COUNT(*)::text AS c
     FROM (SELECT md5(row_to_json(s)::text) AS x FROM ${table} s WHERE s."tenantId" = $1) t`,
    tenantId,
  );
  return { count: Number(rows[0]?.c ?? 0), hash: rows[0]?.h ?? 'empty' };
}

async function snapshotTenant(prisma: PrismaClient, tenantId: string) {
  const out: Record<string, { count: number; hash: string }> = {};
  for (const table of PROTECTED_TABLES) {
    out[table] = await hashTenant(prisma, table, tenantId);
  }
  return out;
}

async function demoFingerprint(prisma: PrismaClient, tenantId: string) {
  const [watches, clients, deals, payments, investors, treasury, accounts] = await Promise.all([
    prisma.watch.findMany({
      where: { tenantId },
      select: { serialNumber: true, cost: true },
      orderBy: { serialNumber: 'asc' },
    }),
    prisma.client.findMany({
      where: { tenantId },
      select: { email: true, name: true },
      orderBy: { email: 'asc' },
    }),
    prisma.deal.aggregate({ where: { tenantId }, _count: true, _sum: { agreedPrice: true } }),
    prisma.payment.aggregate({ where: { tenantId }, _count: true, _sum: { amount: true } }),
    prisma.investor.count({ where: { tenantId } }),
    prisma.treasuryEntry.aggregate({ where: { tenantId }, _count: true, _sum: { amountMxn: true } }),
    prisma.accountEntry.aggregate({ where: { tenantId }, _count: true, _sum: { totalAmount: true } }),
  ]);
  return createHash('sha256')
    .update(
      JSON.stringify({
        watchSerials: watches.map((w) => w.serialNumber),
        watchCost: watches.map((w) => w.cost?.toString() ?? null),
        clients: clients.map((c) => `${c.email}|${c.name}`),
        deals: { count: deals._count, sum: deals._sum.agreedPrice?.toString() ?? '0' },
        payments: { count: payments._count, sum: payments._sum.amount?.toString() ?? '0' },
        investors,
        treasury: { count: treasury._count, sum: treasury._sum.amountMxn?.toString() ?? '0' },
        accounts: { count: accounts._count, sum: accounts._sum.totalAmount?.toString() ?? '0' },
      }),
    )
    .digest('hex');
}

describeDb('demo reset isolation (test database)', () => {
  let prisma: PrismaClient;
  let wcId: string;
  let demoId: string;
  let userId: string;
  const passwordHash = 'test-hash-must-not-change';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    const user = await prisma.user.upsert({
      where: { email: 'demo-isolation@wristos.test' },
      update: { passwordHash, status: UserStatus.ACTIVE },
      create: {
        email: 'demo-isolation@wristos.test',
        passwordHash,
        status: UserStatus.ACTIVE,
        displayName: 'Isolation User',
      },
    });
    userId = user.id;

    const wc = await prisma.tenant.upsert({
      where: { slug: 'wc-isolation-fixture' },
      update: { isDemo: false, status: TenantStatus.ACTIVE, name: 'WC Isolation Fixture' },
      create: {
        slug: 'wc-isolation-fixture',
        name: 'WC Isolation Fixture',
        status: TenantStatus.ACTIVE,
        isDemo: false,
      },
    });
    wcId = wc.id;

    const wcRole = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: wcId, name: 'OWNER' } },
      update: {},
      create: { tenantId: wcId, name: 'OWNER' },
    });
    await prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: wcId, userId } },
      update: {},
      create: { tenantId: wcId, userId, roleId: wcRole.id },
    });

    await prisma.watch.deleteMany({ where: { tenantId: wcId, serialNumber: 'WC-ISOLATION-MARKER' } });
    await prisma.watch.create({
      data: {
        tenantId: wcId,
        brand: 'Rolex',
        model: 'Isolation Marker',
        serialNumber: 'WC-ISOLATION-MARKER',
        status: WatchStatus.AVAILABLE,
        cost: 123456,
      },
    });

    const provisioned = await provisionDemoTenant(prisma, { tenantName: 'Meridian Timepieces' });
    demoId = provisioned.tenantId;
    const demoRole = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: demoId, name: 'OWNER' } },
      update: {},
      create: { tenantId: demoId, name: 'OWNER' },
    });
    await prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: demoId, userId } },
      update: {},
      create: { tenantId: demoId, userId, roleId: demoRole.id },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('refuses reset when isDemo is false, then succeeds when true', async () => {
    await prisma.tenant.update({ where: { id: demoId }, data: { isDemo: false } });
    await expect(resetDemoOperationalData(prisma)).rejects.toThrow(/isDemo/);
    await prisma.tenant.update({ where: { id: demoId }, data: { isDemo: true } });
    const first = await resetDemoOperationalData(prisma);
    expect(first.tenantSlug).toBe(DEMO_TENANT_SLUG);
    expect(first.counts.watches).toBeGreaterThan(10);
  });

  it('restores canonical demo state, ignores FK-heavy runtime rows, and never mutates WC or users', async () => {
    await prisma.tenant.update({ where: { id: demoId }, data: { isDemo: true } });
    await resetDemoOperationalData(prisma);

    const wcBefore = await snapshotTenant(prisma, wcId);
    const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const membershipsBefore = await prisma.tenantUser.findMany({
      where: { userId },
      orderBy: { tenantId: 'asc' },
    });
    const baseline = await demoFingerprint(prisma, demoId);

    const extraWatch = await prisma.watch.create({
      data: {
        tenantId: demoId,
        brand: 'Runtime',
        model: 'Extra',
        serialNumber: 'DEMO-RUNTIME-WATCH',
        status: WatchStatus.AVAILABLE,
        cost: 1,
      },
    });
    const extraClient = await prisma.client.create({
      data: {
        tenantId: demoId,
        name: 'Runtime Client',
        email: 'runtime-demo@wristos.test',
        tags: [],
      },
    });
    const extraDeal = await prisma.deal.create({
      data: {
        tenantId: demoId,
        clientId: extraClient.id,
        watchId: extraWatch.id,
        stage: DealStage.PENDING_PAYMENT,
        agreedPrice: 9999,
      },
    });
    await prisma.receivable.create({
      data: {
        tenantId: demoId,
        dealId: extraDeal.id,
        customerId: extraClient.id,
        originalAmount: 9999,
        normalizedAmount: 9999,
        currency: Currency.MXN,
        issueDate: new Date(),
        status: ReceivableStatus.PENDING,
      },
    });
    await prisma.storefrontReservation.create({
      data: {
        tenantId: demoId,
        watchId: extraWatch.id,
        customerName: 'Runtime Buyer',
        customerEmail: 'runtime-buyer@wristos.test',
        stripeCheckoutSessionId: `cs_demo_${Date.now()}`,
        reservationAmount: 1000,
      },
    });

    const ar = await prisma.accountEntry.create({
      data: {
        tenantId: demoId,
        type: AccountEntryType.RECEIVABLE,
        status: AccountEntryStatus.OPEN,
        category: AccountEntryCategory.SALE_BALANCE,
        source: AccountEntrySource.MANUAL,
        counterpartyName: 'Runtime AR',
        counterpartyType: CounterpartyType.CLIENT,
        concept: 'Runtime receivable',
        totalAmount: 3000,
        currency: Currency.MXN,
      },
    });
    const ap = await prisma.accountEntry.create({
      data: {
        tenantId: demoId,
        type: AccountEntryType.PAYABLE,
        status: AccountEntryStatus.OPEN,
        category: AccountEntryCategory.PURCHASE,
        source: AccountEntrySource.MANUAL,
        counterpartyName: 'Runtime AP',
        counterpartyType: CounterpartyType.SUPPLIER,
        concept: 'Runtime payable',
        totalAmount: 3000,
        currency: Currency.MXN,
      },
    });
    const arPay = await prisma.accountPayment.create({
      data: {
        tenantId: demoId,
        entryId: ar.id,
        amount: 3000,
        currency: Currency.MXN,
        method: PaymentMethod.TRANSFER,
        paidAt: new Date(),
      },
    });
    const apPay = await prisma.accountPayment.create({
      data: {
        tenantId: demoId,
        entryId: ap.id,
        amount: 3000,
        currency: Currency.MXN,
        method: PaymentMethod.TRANSFER,
        paidAt: new Date(),
      },
    });
    await prisma.accountSettlement.create({
      data: {
        tenantId: demoId,
        receivableEntryId: ar.id,
        payableEntryId: ap.id,
        receivablePaymentId: arPay.id,
        payablePaymentId: apPay.id,
        amount: 3000,
        currency: Currency.MXN,
        effectiveDate: new Date(),
      },
    });

    await prisma.aIConversation.create({
      data: {
        tenantId: demoId,
        userId,
        surface: AIConversationSurface.DESKTOP,
        title: 'runtime',
      },
    });
    await prisma.assetHolding.create({
      data: {
        tenantId: demoId,
        assetType: AssetType.CRYPTO,
        ticker: 'BTC',
        name: 'Bitcoin',
        quantity: 1,
        location: 'test-wallet',
      },
    });

    expect(await prisma.watch.findFirst({ where: { tenantId: demoId, serialNumber: 'DEMO-RUNTIME-WATCH' } })).toBeTruthy();

    const afterRuntime = await resetDemoOperationalData(prisma);
    expect(afterRuntime.tenantSlug).toBe(DEMO_TENANT_SLUG);
    expect(
      await prisma.watch.findFirst({ where: { tenantId: demoId, serialNumber: 'DEMO-RUNTIME-WATCH' } }),
    ).toBeNull();
    expect(await prisma.accountSettlement.count({ where: { tenantId: demoId } })).toBe(0);
    expect(await prisma.storefrontReservation.count({ where: { tenantId: demoId } })).toBe(0);
    expect(await prisma.receivable.count({ where: { tenantId: demoId } })).toBe(0);
    expect(await prisma.aIConversation.count({ where: { tenantId: demoId } })).toBe(0);
    expect(await prisma.assetHolding.count({ where: { tenantId: demoId } })).toBe(0);

    const afterFirst = await demoFingerprint(prisma, demoId);
    expect(afterFirst).toBe(baseline);

    const wcAfter = await snapshotTenant(prisma, wcId);
    expect(wcAfter).toEqual(wcBefore);

    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(userAfter.passwordHash).toBe(passwordHash);
    expect(userAfter.passwordHash).toBe(userBefore.passwordHash);
    const membershipsAfter = await prisma.tenantUser.findMany({
      where: { userId },
      orderBy: { tenantId: 'asc' },
    });
    expect(membershipsAfter.map((m) => `${m.tenantId}:${m.roleId}`)).toEqual(
      membershipsBefore.map((m) => `${m.tenantId}:${m.roleId}`),
    );

    const second = await resetDemoOperationalData(prisma);
    expect(second.counts).toEqual(afterRuntime.counts);
    expect(await demoFingerprint(prisma, demoId)).toBe(baseline);
  });
});
