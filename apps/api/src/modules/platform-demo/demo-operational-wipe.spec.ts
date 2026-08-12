import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { wipeDemoOperationalData } from './demo-operational-wipe';
import { resetDemoOperationalData, DemoResetRefusedError } from './demo-data-reset';

describe('wipeDemoOperationalData scoping', () => {
  it('scopes every deleteMany by tenantId (direct or nested)', async () => {
    const calls: Array<{ model: string; where: Record<string, unknown> }> = [];
    const tx = new Proxy(
      {},
      {
        get(_target, model: string) {
          return {
            deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
              calls.push({ model, where });
              return { count: 0 };
            },
          };
        },
      },
    );

    await wipeDemoOperationalData(tx as never, 'demo-tenant');
    expect(calls.length).toBeGreaterThan(20);
    for (const call of calls) {
      const where = call.where;
      const direct = where.tenantId === 'demo-tenant';
      const nested =
        where.conversation !== undefined &&
        typeof where.conversation === 'object' &&
        where.conversation !== null &&
        (where.conversation as { tenantId?: string }).tenantId === 'demo-tenant';
      expect(direct || nested).toBe(true);
    }
  });

  it('deletes Restrict children before parents', async () => {
    const order: string[] = [];
    const tx = new Proxy(
      {},
      {
        get(_target, model: string) {
          return {
            deleteMany: async () => {
              order.push(model);
              return { count: 0 };
            },
          };
        },
      },
    );
    await wipeDemoOperationalData(tx as never, 'demo-tenant');
    expect(order.indexOf('accountSettlement')).toBeLessThan(order.indexOf('accountPayment'));
    expect(order.indexOf('accountPayment')).toBeLessThan(order.indexOf('accountEntry'));
    expect(order.indexOf('storefrontReservation')).toBeLessThan(order.indexOf('watch'));
    expect(order.indexOf('receivablePayment')).toBeLessThan(order.indexOf('receivable'));
    expect(order.indexOf('receivable')).toBeLessThan(order.indexOf('deal'));
    expect(order.indexOf('payment')).toBeLessThan(order.indexOf('deal'));
  });
});

describe('resetDemoOperationalData identity isolation (unit)', () => {
  it('refuses when isDemo is false and never opens a transaction', async () => {
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'x', slug: 'wristos-demo', isDemo: false }) },
      $transaction: jest.fn(),
      user: { upsert: jest.fn(), update: jest.fn(), create: jest.fn() },
      tenantUser: { upsert: jest.fn(), create: jest.fn() },
    };
    await expect(resetDemoOperationalData(prisma as never)).rejects.toBeInstanceOf(DemoResetRefusedError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(prisma.tenantUser.upsert).not.toHaveBeenCalled();
  });
});

describe('demo reset source guards', () => {
  const dir = __dirname;

  it('does not shell out and does not accept a request tenant', () => {
    const service = readFileSync(join(dir, 'demo-reset.service.ts'), 'utf8');
    const controller = readFileSync(join(dir, 'demo-reset.controller.ts'), 'utf8');
    const reset = readFileSync(join(dir, 'demo-data-reset.ts'), 'utf8');
    const wipe = readFileSync(join(dir, 'demo-operational-wipe.ts'), 'utf8');

    for (const src of [service, controller, reset, wipe]) {
      expect(src).not.toMatch(/\bexecFile\b|\bexec\(|\bspawn\b|\bnpx\b|\btsx\b/);
      expect(src).not.toMatch(/deleteMany\(\s*\)/);
      expect(src).not.toMatch(/SEED_ALLOW_NONDEMO/);
      expect(src).not.toMatch(/SEED_USER_EMAIL|SEED_USER_PASSWORD/);
    }

    expect(controller).not.toMatch(/@Body|@Query|@Param/);
    expect(reset).toMatch(/slug: DEMO_TENANT_SLUG/);
    expect(wipe).not.toMatch(/user\.|tenantUser\.|passwordHash/);
  });
});
