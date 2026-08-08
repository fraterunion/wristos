import { ConflictException } from '@nestjs/common';
import { ClientUpdateService } from './client-update.service';

/**
 * Proves the interactive lost-update gap when expectedUpdatedAt is omitted,
 * and that CAS closes it for the canonical manual/AI path.
 */
describe('ClientUpdateService stale full-form semantics', () => {
  function buildRow() {
    return {
      id: 'c1',
      tenantId: 't1',
      name: 'José',
      email: null as string | null,
      phone: '+525511111111',
      notes: 'OLD',
      tags: [] as string[],
      budgetRange: null as string | null,
      registerIdempotencyKey: null as string | null,
      deletedAt: null as Date | null,
      createdAt: new Date('2026-08-08T12:00:00.000Z'),
      updatedAt: new Date('2026-08-08T12:00:00.000Z'),
    };
  }

  function buildService(row: ReturnType<typeof buildRow>) {
    const prisma = {
      client: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id !== row.id || where.tenantId !== row.tenantId) return null;
          if (where.deletedAt === null && row.deletedAt) return null;
          return { ...row };
        }),
        findMany: jest.fn(async () => []),
        findFirstOrThrow: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(row, data, { updatedAt: new Date('2026-08-08T12:05:00.000Z') });
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            where.updatedAt &&
            where.updatedAt.getTime() !== row.updatedAt.getTime()
          ) {
            return { count: 0 };
          }
          Object.assign(row, data, { updatedAt: new Date('2026-08-08T12:05:00.000Z') });
          return { count: 1 };
        }),
      },
    };
    return { service: new ClientUpdateService(prisma as never), prisma, row };
  }

  it('PRE-FIX GAP: without expectedUpdatedAt, stale full-form restores OLD notes', async () => {
    const { service, row } = buildService(buildRow());
    const t1 = row.updatedAt.toISOString();

    // Editor B (fresh) updates notes
    await service.update('t1', 'c1', { notes: 'NEW' });
    expect(row.notes).toBe('NEW');
    expect(row.updatedAt.toISOString()).not.toBe(t1);

    // Editor A submits older full form without CAS (phone + stale notes)
    await service.update('t1', 'c1', { phone: '+525522222222', notes: 'OLD' });

    expect(row.phone).toBe('+525522222222');
    // Proven lost update: B's notes are clobbered
    expect(row.notes).toBe('OLD');
  });

  it('with expectedUpdatedAt from T1, stale different-field form is CLIENT_STALE', async () => {
    const { service, row } = buildService(buildRow());
    const t1 = row.updatedAt.toISOString();

    await service.update('t1', 'c1', { notes: 'NEW' });
    expect(row.notes).toBe('NEW');

    await expect(
      service.update(
        't1',
        'c1',
        { phone: '+525522222222', notes: 'OLD' },
        { expectedUpdatedAt: t1 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    try {
      await service.update(
        't1',
        'c1',
        { phone: '+525522222222', notes: 'OLD' },
        { expectedUpdatedAt: t1 },
      );
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_STALE',
      });
    }

    // Notes remain NEW; phone unchanged
    expect(row.notes).toBe('NEW');
    expect(row.phone).toBe('+525511111111');
  });

  it('appendNotes then stale phone form with CAS → CLIENT_STALE (notes preserved)', async () => {
    const { service, row } = buildService(buildRow());
    const t1 = row.updatedAt.toISOString();

    await service.appendNotes('t1', 'c1', 'prefiere AP');
    expect(row.notes).toBe('OLD\nprefiere AP');

    await expect(
      service.update(
        't1',
        'c1',
        { phone: '+525522222222' },
        { expectedUpdatedAt: t1 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row.notes).toBe('OLD\nprefiere AP');
    expect(row.phone).toBe('+525511111111');
  });

  it('addTags then stale full tag replacement with CAS → CLIENT_STALE', async () => {
    const { service, row } = buildService(buildRow());
    row.tags = ['VIP'];
    const t1 = row.updatedAt.toISOString();

    await service.addTags('t1', 'c1', ['Rolex']);
    expect(row.tags).toEqual(['VIP', 'Rolex']);

    await expect(
      service.update('t1', 'c1', { tags: ['VIP'] }, { expectedUpdatedAt: t1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row.tags).toEqual(['VIP', 'Rolex']);
  });

  it('freshness (CLIENT_STALE) precedes identity collision check', async () => {
    const row = buildRow();
    row.email = null;
    const { service, prisma } = buildService(row);
    const t1 = row.updatedAt.toISOString();

    // B bumps the row
    await service.update('t1', 'c1', { notes: 'NEW' });

    // Even if email would collide, stale token fails first
    (prisma.client.findFirst as jest.Mock).mockImplementation(async ({ where }: any) => {
      if (where.id === 'c1' && where.deletedAt === null) return { ...row };
      if (where.email && where.deletedAt === null) {
        return { id: 'other', name: 'Other' };
      }
      return null;
    });

    try {
      await service.update(
        't1',
        'c1',
        { email: 'taken@x.com' },
        { expectedUpdatedAt: t1 },
      );
      fail('expected ConflictException');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CLIENT_STALE',
      });
    }
  });

  it('fresh CAS edit of phone succeeds and preserves newer notes from same read', async () => {
    const { service, row } = buildService(buildRow());
    row.notes = 'NEW';
    row.updatedAt = new Date('2026-08-08T12:05:00.000Z');

    const result = await service.update(
      't1',
      'c1',
      { phone: '+525522222222' },
      { expectedUpdatedAt: row.updatedAt.toISOString() },
    );
    expect(result.changedFields).toEqual(['phone']);
    expect(row.phone).toBe('+525522222222');
    expect(row.notes).toBe('NEW');
  });

  it('19B recovery: post-commit third-party mutation must not be claimed as AI success', async () => {
    const { service, row } = buildService(buildRow());
    const intended = '+525522222222';
    const t1 = row.updatedAt.toISOString();

    // AI commit succeeds
    await service.update('t1', 'c1', { phone: intended }, { expectedUpdatedAt: t1 });
    expect(row.phone).toBe(intended);
    const afterAi = row.updatedAt.toISOString();

    // Operator later changes phone again
    await service.update(
      't1',
      'c1',
      { phone: '+525533333333' },
      { expectedUpdatedAt: afterAi },
    );
    expect(row.phone).toBe('+525533333333');

    // Truthful recovery gate for 19B: intended field must still equal desired values.
    // Current phone ≠ intended → do NOT reconstruct ActionRun success from entity state alone.
    expect(row.phone).not.toBe(intended);
    // Retry with original plan fingerprint is stale:
    await expect(
      service.update('t1', 'c1', { phone: intended }, { expectedUpdatedAt: t1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
