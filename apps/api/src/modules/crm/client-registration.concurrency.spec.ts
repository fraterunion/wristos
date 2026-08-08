import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClientRegistrationService } from './client-registration.service';
import {
  clientPhoneIdentityKey,
  normalizeClientEmail,
  normalizeClientPhone,
} from './client-identity.util';
import { CrmService } from './crm.service';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type BuildOpts = {
  /** When false, simulates pre-fix service-layer-only (TOCTOU can create dupes). */
  enforceIdentityUnique?: boolean;
  raceWindowMs?: number;
};

/**
 * In-memory Prisma stand-in that can optionally enforce active email/phone uniqueness
 * the same way partial unique indexes would under concurrency.
 */
function buildPrisma(opts: BuildOpts = {}) {
  const enforceIdentityUnique = opts.enforceIdentityUnique !== false;
  const raceWindowMs = opts.raceWindowMs ?? 25;
  const clients = new Map<string, any>();
  let seq = 0;
  let createGate: Promise<void> | null = null;
  let createGateResolve: (() => void) | null = null;

  function emailKey(email: string | null | undefined) {
    return normalizeClientEmail(email);
  }
  function phoneKey(phone: string | null | undefined) {
    return clientPhoneIdentityKey(phone);
  }

  function assertActiveIdentityUnique(row: any, excludeId?: string) {
    if (!enforceIdentityUnique) return;
    const e = emailKey(row.email);
    const p = phoneKey(row.phone);
    for (const c of clients.values()) {
      if (excludeId && c.id === excludeId) continue;
      if (c.tenantId !== row.tenantId) continue;
      if (c.deletedAt) continue;
      if (e && emailKey(c.email) === e) {
        throw new Prisma.PrismaClientKnownRequestError('Unique email', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['clients_tenantId_email_active_key'] },
        });
      }
      if (p && phoneKey(c.phone) === p) {
        throw new Prisma.PrismaClientKnownRequestError('Unique phone', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['clients_tenantId_phone_identity_active_key'] },
        });
      }
    }
  }

  const prisma: any = {
    client: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const c of clients.values()) {
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          if (where.id && c.id !== where.id) continue;
          if (where.id?.not && c.id === where.id.not) continue;
          if (
            where.registerIdempotencyKey &&
            c.registerIdempotencyKey !== where.registerIdempotencyKey
          ) {
            continue;
          }
          if (where.deletedAt === null && c.deletedAt) continue;
          if (where.deletedAt?.not != null && !c.deletedAt) continue;
          if (where.email?.equals) {
            const mode = where.email.mode;
            const target = where.email.equals;
            const left = mode === 'insensitive' ? (c.email ?? '').toLowerCase() : c.email;
            const right = mode === 'insensitive' ? String(target).toLowerCase() : target;
            if (left !== right) continue;
          }
          return c;
        }
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        // Simulate check-then-act race window for concurrent registers
        if (raceWindowMs > 0) await sleep(raceWindowMs);
        const out: any[] = [];
        for (const c of clients.values()) {
          if (where.tenantId && c.tenantId !== where.tenantId) continue;
          if (where.deletedAt === null && c.deletedAt) continue;
          if (where.phone?.not === null && c.phone == null) continue;
          if (where.id?.not && c.id === where.id.not) continue;
          if (where.email?.equals) {
            const mode = where.email.mode;
            const target = where.email.equals;
            const left = mode === 'insensitive' ? (c.email ?? '').toLowerCase() : c.email;
            const right = mode === 'insensitive' ? String(target).toLowerCase() : target;
            if (left !== right) continue;
          }
          out.push(c);
        }
        return out.slice(0, where.take ?? out.length);
      }),
      create: jest.fn(async ({ data }: any) => {
        // Hold concurrent creates in the race window after both checks completed
        if (createGate) await createGate;
        seq += 1;
        const id = `client-${seq}`;
        const row = {
          id,
          tenantId: data.tenant.connect.id,
          name: data.name,
          email: data.email ?? null,
          phone: data.phone ?? null,
          notes: data.notes ?? null,
          tags: data.tags ?? [],
          budgetRange: data.budgetRange ?? null,
          registerIdempotencyKey: data.registerIdempotencyKey ?? null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        if (row.registerIdempotencyKey) {
          for (const existing of clients.values()) {
            if (
              existing.tenantId === row.tenantId &&
              existing.registerIdempotencyKey === row.registerIdempotencyKey
            ) {
              throw new Prisma.PrismaClientKnownRequestError('Unique', {
                code: 'P2002',
                clientVersion: 'test',
                meta: { target: ['clients_tenantId_registerIdempotencyKey_key'] },
              });
            }
          }
        }
        assertActiveIdentityUnique(row);
        clients.set(id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = clients.get(where.id);
        if (!c) throw new Error('missing');
        const next = {
          ...c,
          ...data,
          email: data.email !== undefined ? data.email : c.email,
          phone: data.phone !== undefined ? data.phone : c.phone,
          name: data.name !== undefined ? data.name : c.name,
          updatedAt: new Date(),
        };
        if (raceWindowMs > 0) await sleep(raceWindowMs);
        assertActiveIdentityUnique(next, c.id);
        clients.set(c.id, next);
        return next;
      }),
    },
  };

  /** Call before Promise.all to widen TOCTOU window after checks. */
  function armCreateBarrier() {
    createGate = new Promise<void>((resolve) => {
      createGateResolve = resolve;
    });
  }
  function releaseCreateBarrier() {
    createGateResolve?.();
    createGate = null;
    createGateResolve = null;
  }

  return { prisma, clients, armCreateBarrier, releaseCreateBarrier };
}

describe('Client identity concurrency — pre-fix gap proof', () => {
  it('PROVES: concurrent different keys + same phone can create TWO clients without DB unique', async () => {
    const { prisma, clients, armCreateBarrier, releaseCreateBarrier } = buildPrisma({
      enforceIdentityUnique: false,
      raceWindowMs: 30,
    });
    const service = new ClientRegistrationService(prisma);

    armCreateBarrier();
    const pending = Promise.all([
      service.register('t1', {
        name: 'José',
        phone: '55 1234 5678',
        registerIdempotencyKey: 'key-a',
      }),
      service.register('t1', {
        name: 'Jose',
        phone: '+52 55 1234 5678',
        registerIdempotencyKey: 'key-b',
      }),
    ]);
    await sleep(80); // both past assertNoExactDuplicate
    releaseCreateBarrier();
    const results = await pending;

    const activePhones = [...clients.values()].filter(
      (c) => !c.deletedAt && clientPhoneIdentityKey(c.phone) === '525512345678',
    );
    // Exact proven gap for Commit 18A final gate:
    expect(results).toHaveLength(2);
    expect(activePhones.length).toBe(2);
    expect(new Set(results.map((r) => r.client.id)).size).toBe(2);
  });

  it('PROVES: concurrent different keys + same email can create TWO clients without DB unique', async () => {
    const { prisma, clients, armCreateBarrier, releaseCreateBarrier } = buildPrisma({
      enforceIdentityUnique: false,
      raceWindowMs: 30,
    });
    const service = new ClientRegistrationService(prisma);

    armCreateBarrier();
    const pending = Promise.all([
      service.register('t1', {
        name: 'Ana',
        email: 'ana@email.com',
        registerIdempotencyKey: 'e-a',
      }),
      service.register('t1', {
        name: 'Ana L',
        email: '  ANA@Email.com ',
        registerIdempotencyKey: 'e-b',
      }),
    ]);
    await sleep(80);
    releaseCreateBarrier();
    await pending;

    const activeEmails = [...clients.values()].filter(
      (c) => !c.deletedAt && normalizeClientEmail(c.email) === 'ana@email.com',
    );
    expect(activeEmails.length).toBe(2);
  });
});

describe('Client identity concurrency — durable uniqueness (post-fix)', () => {
  it('3 concurrent different keys + same phone → one active Client', async () => {
    const { prisma, clients, armCreateBarrier, releaseCreateBarrier } = buildPrisma({
      enforceIdentityUnique: true,
      raceWindowMs: 20,
    });
    const service = new ClientRegistrationService(prisma);

    armCreateBarrier();
    const pending = Promise.allSettled([
      service.register('t1', { name: 'A', phone: '5512345678', registerIdempotencyKey: 'p1' }),
      service.register('t1', { name: 'B', phone: '+525512345678', registerIdempotencyKey: 'p2' }),
      service.register('t1', { name: 'C', phone: '55 1234 5678', registerIdempotencyKey: 'p3' }),
    ]);
    await sleep(70);
    releaseCreateBarrier();
    const settled = await pending;

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(((r as PromiseRejectedResult).reason as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_EXACT_DUPLICATE',
        matchField: 'phone',
      });
    }
    expect(
      [...clients.values()].filter(
        (c) => !c.deletedAt && clientPhoneIdentityKey(c.phone) === '525512345678',
      ),
    ).toHaveLength(1);
  });

  it('3 concurrent different keys + same email → one active Client', async () => {
    const { prisma, clients, armCreateBarrier, releaseCreateBarrier } = buildPrisma({
      enforceIdentityUnique: true,
      raceWindowMs: 20,
    });
    const service = new ClientRegistrationService(prisma);

    armCreateBarrier();
    const pending = Promise.allSettled([
      service.register('t1', { name: 'A', email: 'x@y.z', registerIdempotencyKey: 'e1' }),
      service.register('t1', { name: 'B', email: 'X@Y.Z', registerIdempotencyKey: 'e2' }),
      service.register('t1', { name: 'C', email: ' x@y.z ', registerIdempotencyKey: 'e3' }),
    ]);
    await sleep(70);
    releaseCreateBarrier();
    const settled = await pending;

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(2);
    expect(
      [...clients.values()].filter((c) => !c.deletedAt && normalizeClientEmail(c.email) === 'x@y.z'),
    ).toHaveLength(1);
  });

  it('3 concurrent same idempotency key → one Client (replay)', async () => {
    const { prisma, clients, armCreateBarrier, releaseCreateBarrier } = buildPrisma({
      enforceIdentityUnique: true,
      raceWindowMs: 15,
    });
    const service = new ClientRegistrationService(prisma);

    armCreateBarrier();
    const pending = Promise.all([
      service.register('t1', { name: 'Pepe', registerIdempotencyKey: 'same-k' }),
      service.register('t1', { name: 'Pepe', registerIdempotencyKey: 'same-k' }),
      service.register('t1', { name: 'Pepe', registerIdempotencyKey: 'same-k' }),
    ]);
    await sleep(50);
    releaseCreateBarrier();
    const results = await pending;
    expect(new Set(results.map((r) => r.client.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed).length).toBeGreaterThanOrEqual(1);
    expect([...clients.values()]).toHaveLength(1);
  });

  it('different keys + same phone sequential → CLIENT_EXACT_DUPLICATE', async () => {
    const { prisma } = buildPrisma({ enforceIdentityUnique: true, raceWindowMs: 0 });
    const service = new ClientRegistrationService(prisma);
    await service.register('t1', { name: 'José', phone: '5512345678', registerIdempotencyKey: 'k1' });
    try {
      await service.register('t1', {
        name: 'José 2',
        phone: '+52 55 1234 5678',
        registerIdempotencyKey: 'k2',
      });
      fail('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_EXACT_DUPLICATE',
        matchField: 'phone',
      });
    }
  });

  it('name-only concurrent different keys may create multiple (intentional)', async () => {
    const { prisma, clients, armCreateBarrier, releaseCreateBarrier } = buildPrisma({
      enforceIdentityUnique: true,
      raceWindowMs: 15,
    });
    const service = new ClientRegistrationService(prisma);
    armCreateBarrier();
    const pending = Promise.all([
      service.register('t1', { name: 'José', registerIdempotencyKey: 'n1' }),
      service.register('t1', { name: 'José', registerIdempotencyKey: 'n2' }),
      service.register('t1', { name: 'José', registerIdempotencyKey: 'n3' }),
    ]);
    await sleep(50);
    releaseCreateBarrier();
    const results = await pending;
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.client.id)).size).toBe(3);
    expect(clients.size).toBe(3);
    expect(results.every((r) => r.probableDuplicates.length >= 0)).toBe(true);
  });

  it('update-vs-update same phone → at most one owner', async () => {
    const { prisma, clients } = buildPrisma({
      enforceIdentityUnique: true,
      raceWindowMs: 0,
    });
    const base = {
      tenantId: 't1',
      email: null as string | null,
      phone: null as string | null,
      deletedAt: null as Date | null,
      tags: [] as string[],
      notes: null,
      budgetRange: null,
      registerIdempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    clients.set('a', { ...base, id: 'a', name: 'A' });
    clients.set('b', { ...base, id: 'b', name: 'B' });
    const crm = new CrmService(prisma, new ClientRegistrationService(prisma));

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const originalUpdate = prisma.client.update.getMockImplementation()!;
    prisma.client.update = jest.fn(async (args: any) => {
      await gate;
      return originalUpdate(args);
    });

    const pending = Promise.allSettled([
      crm.updateClient('a', 't1', { phone: '5512345678' }),
      crm.updateClient('b', 't1', { phone: '+525512345678' }),
    ]);
    await sleep(20);
    release();
    const settled = await pending;

    const owners = [...clients.values()].filter(
      (c) => !c.deletedAt && clientPhoneIdentityKey(c.phone) === '525512345678',
    );
    expect(owners).toHaveLength(1);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1);
    const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
  });

  it('storefront reservation key still replays', async () => {
    const { prisma } = buildPrisma({ enforceIdentityUnique: true, raceWindowMs: 0 });
    const service = new ClientRegistrationService(prisma);
    const key = 'storefront-reservation:res-1';
    const a = await service.register('t1', {
      name: 'Buyer',
      email: 'buyer@x.com',
      phone: '5511111111',
      registerIdempotencyKey: key,
      allowProbableDuplicate: true,
    });
    const b = await service.register('t1', {
      name: 'Buyer',
      email: 'buyer@x.com',
      phone: '5511111111',
      registerIdempotencyKey: key,
      allowProbableDuplicate: true,
    });
    expect(b.replayed).toBe(true);
    expect(b.client.id).toBe(a.client.id);
  });
});

describe('clientPhoneIdentityKey ↔ normalize equivalence', () => {
  it('formatting variants share identity key', () => {
    const variants = ['5512345678', '55 1234 5678', '+52 55 1234 5678', '525512345678'];
    const keys = variants.map((v) => clientPhoneIdentityKey(normalizeClientPhone(v) ?? v));
    expect(new Set(keys)).toEqual(new Set(['525512345678']));
  });
});
