import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClientRegistrationService } from './client-registration.service';
import {
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from './client-identity.util';

describe('ClientRegistrationService — canonical Client create', () => {
  function build() {
    const clients = new Map<string, any>();
    let seq = 0;

    const prisma: any = {
      client: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const c of clients.values()) {
            if (where.tenantId && c.tenantId !== where.tenantId) continue;
            if (where.id && c.id !== where.id) continue;
            if (
              where.registerIdempotencyKey &&
              c.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            if (where.deletedAt === null && c.deletedAt) continue;
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
          // Simulate unique (tenantId, registerIdempotencyKey)
          if (row.registerIdempotencyKey) {
            for (const existing of clients.values()) {
              if (
                existing.tenantId === row.tenantId &&
                existing.registerIdempotencyKey === row.registerIdempotencyKey
              ) {
                const err = new Prisma.PrismaClientKnownRequestError('Unique', {
                  code: 'P2002',
                  clientVersion: 'test',
                });
                throw err;
              }
            }
          }
          clients.set(id, row);
          return row;
        }),
      },
    };

    const service = new ClientRegistrationService(prisma);
    return { service, prisma, clients };
  }

  it('creates name-only client', async () => {
    const { service } = build();
    const result = await service.register('t1', { name: '  Manuel  ' });
    expect(result.replayed).toBe(false);
    expect(result.client.name).toBe('Manuel');
    expect(result.client.email).toBeNull();
    expect(result.client.phone).toBeNull();
  });

  it('normalizes name + phone + email', async () => {
    const { service } = build();
    const result = await service.register('t1', {
      name: 'José Hernández',
      phone: '55 1234 5678',
      email: 'Jose@Email.COM',
    });
    expect(result.client.name).toBe('José Hernández');
    expect(result.client.phone).toBe('+525512345678');
    expect(result.client.email).toBe('jose@email.com');
  });

  it('blocks exact email duplicate', async () => {
    const { service, clients } = build();
    clients.set('c1', {
      id: 'c1',
      tenantId: 't1',
      name: 'Ana',
      email: 'ana@email.com',
      phone: null,
      deletedAt: null,
      tags: [],
    });
    await expect(
      service.register('t1', { name: 'Ana López', email: 'ANA@email.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks exact phone duplicate across formats', async () => {
    const { service, clients } = build();
    clients.set('c1', {
      id: 'c1',
      tenantId: 't1',
      name: 'José Hernández',
      email: null,
      phone: '+525512345678',
      deletedAt: null,
      tags: [],
    });
    await expect(
      service.register('t1', { name: 'José Hernández', phone: '5512345678' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('same name only does not silently merge', async () => {
    const { service, clients } = build();
    clients.set('c1', {
      id: 'c1',
      tenantId: 't1',
      name: 'José Hernández',
      email: null,
      phone: null,
      deletedAt: null,
      tags: [],
    });
    const result = await service.register('t1', { name: 'Jose Hernandez' });
    expect(result.client.id).not.toBe('c1');
    expect(result.probableDuplicates.some((d) => d.id === 'c1')).toBe(true);
  });

  it('deleted email match rejects without resurrection', async () => {
    const { service, clients } = build();
    clients.set('c1', {
      id: 'c1',
      tenantId: 't1',
      name: 'Ana',
      email: 'ana@email.com',
      phone: null,
      deletedAt: new Date(),
      tags: [],
    });
    try {
      await service.register('t1', { name: 'Ana Nueva', email: 'ana@email.com' });
      fail('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_DELETED_MATCH',
      });
    }
  });

  it('replays same idempotency key + payload', async () => {
    const { service } = build();
    const a = await service.register('t1', {
      name: 'Pepe',
      registerIdempotencyKey: 'ai-action-run:run-1',
    });
    const b = await service.register('t1', {
      name: 'Pepe',
      registerIdempotencyKey: 'ai-action-run:run-1',
    });
    expect(b.replayed).toBe(true);
    expect(b.client.id).toBe(a.client.id);
  });

  it('conflicts on same key with changed payload', async () => {
    const { service } = build();
    await service.register('t1', {
      name: 'Pepe',
      registerIdempotencyKey: 'k1',
    });
    await expect(
      service.register('t1', {
        name: 'Otro',
        registerIdempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('concurrent same key yields one client', async () => {
    const { service, clients } = build();
    const results = await Promise.all([
      service.register('t1', { name: 'Concurrent', registerIdempotencyKey: 'race-k' }),
      service.register('t1', { name: 'Concurrent', registerIdempotencyKey: 'race-k' }),
      service.register('t1', { name: 'Concurrent', registerIdempotencyKey: 'race-k' }),
    ]);
    const ids = new Set(results.map((r) => r.client.id));
    expect(ids.size).toBe(1);
    expect([...clients.values()].filter((c) => c.registerIdempotencyKey === 'race-k')).toHaveLength(
      1,
    );
  });

  it('rejects empty name', async () => {
    const { service } = build();
    await expect(service.register('t1', { name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('tenant isolation: other tenant email not a duplicate', async () => {
    const { service, clients } = build();
    clients.set('c1', {
      id: 'c1',
      tenantId: 'other',
      name: 'Ana',
      email: 'ana@email.com',
      phone: null,
      deletedAt: null,
      tags: [],
    });
    const result = await service.register('t1', {
      name: 'Ana',
      email: 'ana@email.com',
    });
    expect(result.client.tenantId).toBe('t1');
  });

  it('stores normalized helpers consistently', () => {
    expect(normalizeClientName(' A ')).toBe('A');
    expect(normalizeClientEmail('X@Y.Z')).toBe('x@y.z');
    expect(normalizeClientPhone('5512345678')).toBe('+525512345678');
  });
});
