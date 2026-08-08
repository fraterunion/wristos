import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ClientUpdateService,
  resolveNotesPatch,
  resolveTagsPatch,
} from './client-update.service';

function clientRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-08T12:00:00.000Z');
  return {
    id: 'c1',
    tenantId: 't1',
    name: 'José Hernández',
    email: null as string | null,
    phone: null as string | null,
    notes: null as string | null,
    tags: [] as string[],
    budgetRange: null as string | null,
    registerIdempotencyKey: null as string | null,
    deletedAt: null as Date | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('resolveNotesPatch / resolveTagsPatch', () => {
  it('replaces and appends notes without inventing a history table', () => {
    expect(resolveNotesPatch('old', { replace: '  new  ' })).toBe('new');
    expect(resolveNotesPatch('old', { replace: '   ' })).toBeNull();
    expect(resolveNotesPatch('base', { append: 'extra' })).toBe('base\nextra');
    expect(resolveNotesPatch(null, { append: 'extra' })).toBe('extra');
    expect(resolveNotesPatch('base', { append: '  ' })).toBeUndefined();
    expect(() => resolveNotesPatch('x', { replace: 'a', append: 'b' })).toThrow(BadRequestException);
  });

  it('adds/removes tags case-insensitively on a full-array replace model', () => {
    expect(resolveTagsPatch(['VIP', 'AP'], { add: ['vip', 'Rolex'] })).toEqual(['VIP', 'AP', 'Rolex']);
    expect(resolveTagsPatch(['VIP', 'AP'], { remove: ['vip'] })).toEqual(['AP']);
    expect(resolveTagsPatch(['a'], { replace: ['b', 'c'] })).toEqual(['b', 'c']);
    expect(() => resolveTagsPatch(['a'], { replace: [], add: ['b'] })).toThrow(BadRequestException);
  });
});

describe('ClientUpdateService', () => {
  function build() {
    const row = clientRow();
    const prisma = {
      client: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.deletedAt === null && row.deletedAt) return null;
          if (where.id && where.id !== row.id) return null;
          if (where.tenantId && where.tenantId !== row.tenantId) return null;
          if (where.id?.not === row.id) return null;
          if (where.email && row.email) {
            const eq = where.email.equals?.toLowerCase?.() ?? where.email;
            if (String(row.email).toLowerCase() !== String(eq).toLowerCase()) return null;
          }
          return { ...row };
        }),
        findMany: jest.fn(async () => []),
        findFirstOrThrow: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(row, data, { updatedAt: new Date('2026-08-08T12:01:00.000Z') });
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            where.updatedAt &&
            where.updatedAt.getTime() !== row.updatedAt.getTime()
          ) {
            return { count: 0 };
          }
          Object.assign(row, data, { updatedAt: new Date('2026-08-08T12:01:00.000Z') });
          return { count: 1 };
        }),
      },
    };
    const service = new ClientUpdateService(prisma as never);
    return { service, prisma, row };
  }

  it('updates name with canonical trim/collapse and preserves accents', async () => {
    const { service, row } = build();
    row.name = 'Ana';
    const result = await service.update('t1', 'c1', { name: '  José   Hernández  ' });
    expect(result.changedFields).toEqual(['name']);
    expect(result.client.name).toBe('José Hernández');
    expect(row.name).toBe('José Hernández');
  });

  it('normalizes email and phone; clears optional fields with null/blank', async () => {
    const { service, row } = build();
    row.email = 'old@x.com';
    row.phone = '+525511111111';
    await service.update('t1', 'c1', {
      email: 'Ana@Example.COM',
      phone: '55 1234 5678',
    });
    expect(row.email).toBe('ana@example.com');
    expect(row.phone).toBe('+525512345678');

    await service.update('t1', 'c1', { email: '', phone: null, notes: '  ', budgetRange: '' });
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.budgetRange).toBeNull();
  });

  it('leaves omitted fields unchanged', async () => {
    const { service, row } = build();
    row.email = 'keep@x.com';
    row.phone = '+525500000000';
    row.notes = 'keep';
    row.tags = ['VIP'];
    await service.update('t1', 'c1', { name: 'Manuel' });
    expect(row.email).toBe('keep@x.com');
    expect(row.phone).toBe('+525500000000');
    expect(row.notes).toBe('keep');
    expect(row.tags).toEqual(['VIP']);
    expect(row.name).toBe('Manuel');
  });

  it('rejects empty name and invalid contacts', async () => {
    const { service } = build();
    await expect(service.update('t1', 'c1', { name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('t1', 'c1', { email: 'bad' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('t1', 'c1', { phone: '12' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects soft-deleted Client (no hidden restore)', async () => {
    const { service, row } = build();
    row.deletedAt = new Date();
    await expect(service.update('t1', 'c1', { notes: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects active email/phone identity collisions with typed codes', async () => {
    const { service, prisma } = build();
    (prisma.client.findFirst as jest.Mock) = jest.fn(async ({ where }: any) => {
      if (where.id === 'c1' && where.deletedAt === null) {
        return clientRow({ id: 'c1', email: null, phone: null });
      }
      if (where.email && where.deletedAt === null) {
        return { id: 'other', name: 'Other' };
      }
      return null;
    });
    await expect(service.update('t1', 'c1', { email: 'taken@x.com' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    try {
      await service.update('t1', 'c1', { email: 'taken@x.com' });
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_EXACT_DUPLICATE',
        matchField: 'email',
      });
    }

    (prisma.client.findFirst as jest.Mock) = jest.fn(async ({ where }: any) => {
      if (where.id === 'c1' && where.deletedAt === null) {
        return clientRow({ id: 'c1' });
      }
      return null;
    });
    (prisma.client.findMany as jest.Mock) = jest.fn(async () => [
      {
        id: 'other',
        name: 'Other',
        phone: '+525512345678',
        deletedAt: null,
      },
    ]);
    await expect(service.update('t1', 'c1', { phone: '55 1234 5678' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    try {
      await service.update('t1', 'c1', { phone: '55 1234 5678' });
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_EXACT_DUPLICATE',
        matchField: 'phone',
      });
    }
  });

  it('rejects deleted identity match without reassignment', async () => {
    const { service, prisma } = build();
    (prisma.client.findFirst as jest.Mock) = jest.fn(async ({ where }: any) => {
      if (where.id === 'c1' && where.deletedAt === null) return clientRow();
      if (where.email && where.deletedAt?.not === null) {
        return { id: 'deleted', name: 'Deleted' };
      }
      return null;
    });
    try {
      await service.update('t1', 'c1', { email: 'ghost@x.com' });
      fail('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_DELETED_MATCH',
      });
    }
  });

  it('maps P2002 to typed CLIENT_EXACT_DUPLICATE (no raw unique error)', async () => {
    const { service, prisma } = build();
    (prisma.client.update as jest.Mock) = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['clients_tenantId_phone_identity_active_key'] },
      });
    });
    await expect(
      service.update('t1', 'c1', { phone: '5512345678' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces expectedUpdatedAt CAS (CLIENT_STALE)', async () => {
    const { service, row } = build();
    try {
      await service.update(
        't1',
        'c1',
        { notes: 'n' },
        { expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      );
      fail('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_STALE',
      });
    }

    const ok = await service.update(
      't1',
      'c1',
      { notes: 'n' },
      { expectedUpdatedAt: row.updatedAt.toISOString() },
    );
    expect(ok.noop).toBe(false);
    expect(ok.changedFields).toEqual(['notes']);
  });

  it('appendNotes and tag helpers are deterministic', async () => {
    const { service, row } = build();
    row.notes = 'hola';
    row.tags = ['VIP'];
    const appended = await service.appendNotes('t1', 'c1', 'prefiere AP');
    expect(appended.client.notes).toBe('hola\nprefiere AP');
    const tagged = await service.addTags('t1', 'c1', ['Rolex']);
    expect(tagged.client.tags).toEqual(['VIP', 'Rolex']);
    const removed = await service.removeTags('t1', 'c1', ['vip']);
    expect(removed.client.tags).toEqual(['Rolex']);
  });

  it('noop when patch equals current canonical values', async () => {
    const { service, row, prisma } = build();
    row.name = 'José Hernández';
    const result = await service.update('t1', 'c1', { name: '  José Hernández  ' });
    expect(result.noop).toBe(true);
    expect(prisma.client.update).not.toHaveBeenCalled();
    expect(prisma.client.updateMany).not.toHaveBeenCalled();
  });

  it('noop does not bump updatedAt when email already matches', async () => {
    const { service, row, prisma } = build();
    row.email = 'ana@x.com';
    const before = row.updatedAt.toISOString();
    const result = await service.update(
      't1',
      'c1',
      { email: 'Ana@X.com' },
      { expectedUpdatedAt: before },
    );
    expect(result.noop).toBe(true);
    expect(row.updatedAt.toISOString()).toBe(before);
    expect(prisma.client.updateMany).not.toHaveBeenCalled();
  });
});
