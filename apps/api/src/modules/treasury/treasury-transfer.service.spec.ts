import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import {
  TreasuryTransferService,
  treasuryTransferInflowProvenanceKey,
  treasuryTransferOutflowProvenanceKey,
} from './treasury-transfer.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

type TreasRow = {
  id: string;
  tenantId: string;
  account: TreasuryAccount;
  direction: TreasuryDirection;
  amount: Prisma.Decimal;
  amountMxn: Prisma.Decimal;
  currency: Currency;
  commission: Prisma.Decimal | null;
  exchangeRate: null;
  transactionDate: Date;
  description: string | null;
  provenanceKey: string;
  deletedAt: Date | null;
  reversalIdempotencyKey?: string | null;
};

describe('TreasuryTransferService — canonical internal liquidity transfer', () => {
  function build() {
    const treasury = new Map<string, TreasRow>();
    let seq = 0;
    let txChain: Promise<unknown> = Promise.resolve();
    let failNextCreate: 'outflow' | 'inflow' | null = null;

    const prisma: any = {
      treasuryEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const t of treasury.values()) {
            if (where.tenantId && t.tenantId !== where.tenantId) continue;
            if (where.provenanceKey && t.provenanceKey !== where.provenanceKey) continue;
            if (where.id && t.id !== where.id) continue;
            if (where.deletedAt === null && t.deletedAt) continue;
            return t;
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          if (failNextCreate === 'outflow' && data.direction === TreasuryDirection.OUTFLOW) {
            failNextCreate = null;
            throw new Error('simulated outflow create failure');
          }
          if (failNextCreate === 'inflow' && data.direction === TreasuryDirection.INFLOW) {
            failNextCreate = null;
            throw new Error('simulated inflow create failure');
          }
          for (const existing of treasury.values()) {
            if (
              existing.tenantId === data.tenantId &&
              existing.provenanceKey === data.provenanceKey
            ) {
              throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: 'test',
              });
            }
          }
          seq += 1;
          const row: TreasRow = {
            id: `te-${seq}`,
            tenantId: data.tenantId,
            account: data.account,
            direction: data.direction,
            amount: d(data.amount),
            amountMxn: d(data.amountMxn),
            currency: data.currency,
            commission: data.commission ?? null,
            exchangeRate: null,
            transactionDate: data.transactionDate,
            description: data.description ?? null,
            provenanceKey: data.provenanceKey,
            deletedAt: null,
          };
          treasury.set(row.id, row);
          return { ...row };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = treasury.get(where.id);
          if (!row) throw new Error('missing');
          Object.assign(row, data);
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const t of treasury.values()) {
            if (where.id && t.id !== where.id) continue;
            if (where.tenantId && t.tenantId !== where.tenantId) continue;
            if (where.deletedAt === null && t.deletedAt) continue;
            Object.assign(t, data);
            count += 1;
          }
          return { count };
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const row = treasury.get(where.id);
          if (!row) throw new Error('missing');
          return { ...row };
        }),
      },
      $transaction: jest.fn(async (fn: any) => {
        // Snapshot for rollback on failure (approximate atomicity).
        const snapshot = new Map(
          [...treasury.entries()].map(([k, v]) => [k, { ...v }]),
        );
        const run = txChain.then(async () => {
          try {
            return await fn(prisma);
          } catch (e) {
            treasury.clear();
            for (const [k, v] of snapshot) treasury.set(k, v);
            throw e;
          }
        });
        txChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }),
    };

    const service = new TreasuryTransferService(prisma);
    return {
      service,
      prisma,
      treasury,
      setFailNextCreate(kind: 'outflow' | 'inflow' | null) {
        failNextCreate = kind;
      },
      liveLegs() {
        return [...treasury.values()].filter((t) => !t.deletedAt);
      },
      netByAccount() {
        const nets = {
          CASH: d(0),
          BANK: d(0),
          CESAR: d(0),
        };
        for (const t of treasury.values()) {
          if (t.deletedAt) continue;
          const delta =
            t.direction === TreasuryDirection.INFLOW ? t.amountMxn : t.amountMxn.neg();
          nets[t.account] = nets[t.account].plus(delta);
        }
        return nets;
      },
      totalLiquidity() {
        const n = this.netByAccount();
        return n.CASH.plus(n.BANK).plus(n.CESAR);
      },
    };
  }

  const pairs: Array<['CASH' | 'BANK' | 'CESAR', 'CASH' | 'BANK' | 'CESAR']> = [
    ['BANK', 'CASH'],
    ['CASH', 'BANK'],
    ['BANK', 'CESAR'],
    ['CESAR', 'BANK'],
    ['CASH', 'CESAR'],
    ['CESAR', 'CASH'],
  ];

  it.each(pairs)('%s → %s creates paired legs and total liquidity Δ0', async (source, dest) => {
    const ctx = build();
    const before = ctx.totalLiquidity();
    const result = await ctx.service.register('t1', {
      sourceAccount: source,
      destinationAccount: dest,
      amount: 200000,
      registerIdempotencyKey: `k-${source}-${dest}`,
      transferDate: new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(result.replayed).toBe(false);
    expect(result.outflowEntry.account).toBe(source);
    expect(result.outflowEntry.direction).toBe(TreasuryDirection.OUTFLOW);
    expect(result.inflowEntry.account).toBe(dest);
    expect(result.inflowEntry.direction).toBe(TreasuryDirection.INFLOW);
    expect(result.outflowEntry.commission).toBeNull();
    expect(result.inflowEntry.commission).toBeNull();
    expect(result.outflowEntry.provenanceKey).toBe(
      treasuryTransferOutflowProvenanceKey(result.transferId),
    );
    expect(result.inflowEntry.provenanceKey).toBe(
      treasuryTransferInflowProvenanceKey(result.transferId),
    );
    expect(ctx.liveLegs()).toHaveLength(2);
    expect(ctx.totalLiquidity().minus(before).toString()).toBe('0');
    const nets = ctx.netByAccount();
    expect(nets[source].toString()).toBe('-200000');
    expect(nets[dest].toString()).toBe('200000');
  });

  it('rejects same source and destination', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'BANK',
        amount: 1000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero / negative / non-finite amounts', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: -50,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: Number.NaN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows overdraft (no insufficient-funds gate) matching existing Treasury policy', async () => {
    const ctx = build();
    const result = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 999999,
      registerIdempotencyKey: 'overdraft-ok',
    });
    expect(result.replayed).toBe(false);
    expect(ctx.netByAccount().BANK.toString()).toBe('-999999');
    expect(ctx.totalLiquidity().toString()).toBe('0');
  });

  it('rolls back when inflow create fails — never one live leg', async () => {
    const ctx = build();
    ctx.setFailNextCreate('inflow');
    await expect(
      ctx.service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: 10000,
        registerIdempotencyKey: 'fail-in',
      }),
    ).rejects.toThrow('simulated inflow create failure');
    expect(ctx.liveLegs()).toHaveLength(0);
  });

  it('idempotent replay with same key + same payload', async () => {
    const ctx = build();
    const input = {
      sourceAccount: 'BANK' as const,
      destinationAccount: 'CASH' as const,
      amount: 50000,
      registerIdempotencyKey: 'same-key',
      transferDate: new Date('2026-07-01T00:00:00.000Z'),
    };
    const first = await ctx.service.register('t1', input);
    const second = await ctx.service.register('t1', input);
    expect(second.replayed).toBe(true);
    expect(second.transferId).toBe(first.transferId);
    expect(second.outflowEntry.id).toBe(first.outflowEntry.id);
    expect(second.inflowEntry.id).toBe(first.inflowEntry.id);
    expect(ctx.liveLegs()).toHaveLength(2);
  });

  it('same key + different amount → conflict', async () => {
    const ctx = build();
    await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 50000,
      registerIdempotencyKey: 'conflict-amt',
      transferDate: new Date('2026-07-01T00:00:00.000Z'),
    });
    await expect(
      ctx.service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: 60000,
        registerIdempotencyKey: 'conflict-amt',
        transferDate: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.liveLegs()).toHaveLength(2);
  });

  it('same key + different destination → conflict', async () => {
    const ctx = build();
    await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 50000,
      registerIdempotencyKey: 'conflict-dest',
      transferDate: new Date('2026-07-01T00:00:00.000Z'),
    });
    await expect(
      ctx.service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CESAR',
        amount: 50000,
        registerIdempotencyKey: 'conflict-dest',
        transferDate: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('concurrent same key converges to exactly two live legs', async () => {
    const ctx = build();
    const input = {
      sourceAccount: 'CASH' as const,
      destinationAccount: 'BANK' as const,
      amount: 40000,
      registerIdempotencyKey: 'concurrent-key',
      transferDate: new Date('2026-07-10T00:00:00.000Z'),
    };
    const results = await Promise.all([
      ctx.service.register('t1', input),
      ctx.service.register('t1', input),
      ctx.service.register('t1', input),
    ]);
    expect(ctx.liveLegs()).toHaveLength(2);
    const ids = new Set(results.map((r) => r.transferId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed).length).toBeLessThanOrEqual(1);
  });

  it('different keys are independent transfers', async () => {
    const ctx = build();
    await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 10000,
      registerIdempotencyKey: 'a',
    });
    await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 10000,
      registerIdempotencyKey: 'b',
    });
    expect(ctx.liveLegs()).toHaveLength(4);
    expect(ctx.netByAccount().BANK.toString()).toBe('-20000');
  });

  it('reverse soft-deletes both legs atomically and restores nets', async () => {
    const ctx = build();
    const reg = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 100000,
      registerIdempotencyKey: 'rev-1',
    });
    expect(ctx.netByAccount().BANK.toString()).toBe('-100000');
    expect(ctx.netByAccount().CASH.toString()).toBe('100000');

    const rev = await ctx.service.reverse('t1', reg.transferId);
    expect(rev.reversed).toBe(true);
    expect(rev.causality).toBe('APPLIED');
    expect(ctx.liveLegs()).toHaveLength(0);
    expect(ctx.totalLiquidity().toString()).toBe('0');

    const again = await ctx.service.reverse('t1', reg.transferId);
    expect(again.alreadyReversed).toBe(true);
    expect(again.reversed).toBe(false);
    expect(again.causality).toBe('EXTERNAL');
  });

  it('reverse causality: SAME_COMMAND vs EXTERNAL', async () => {
    const ctx = build();
    const reg = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 50000,
      registerIdempotencyKey: 'rev-causality-1',
    });
    const key = 'ai-action-run:ar-transfer-rev-1';
    const first = await ctx.service.reverse('t1', reg.transferId, {
      reversalIdempotencyKey: key,
    });
    expect(first.causality).toBe('APPLIED');
    expect(first.outflowEntry?.reversalIdempotencyKey).toBe(key);
    expect(first.inflowEntry?.reversalIdempotencyKey).toBe(key);

    const same = await ctx.service.reverse('t1', reg.transferId, {
      reversalIdempotencyKey: key,
    });
    expect(same.alreadyReversed).toBe(true);
    expect(same.causality).toBe('SAME_COMMAND');

    const other = await ctx.service.reverse('t1', reg.transferId, {
      reversalIdempotencyKey: 'ai-action-run:other',
    });
    expect(other.alreadyReversed).toBe(true);
    expect(other.causality).toBe('EXTERNAL');
  });

  it('crash recovery + manual-before-retry + mismatched keys invariant', async () => {
    const ctx = build();
    const reg = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 12000,
      registerIdempotencyKey: 'xfer-crash',
    });
    const k = 'ai-action-run:xfer-crash-1';
    await ctx.service.reverse('t1', reg.transferId, { reversalIdempotencyKey: k });
    expect((await ctx.service.classifyReversal('t1', reg.transferId, k)).kind).toBe(
      'SAME_COMMAND',
    );
    const replay = await ctx.service.reverse('t1', reg.transferId, {
      reversalIdempotencyKey: k,
    });
    expect(replay.causality).toBe('SAME_COMMAND');

    const manual = await ctx.service.register('t1', {
      sourceAccount: 'CASH',
      destinationAccount: 'CESAR',
      amount: 8000,
      registerIdempotencyKey: 'xfer-manual',
    });
    await ctx.service.reverse('t1', manual.transferId);
    expect((await ctx.service.classifyReversal('t1', manual.transferId, k)).kind).toBe(
      'EXTERNAL',
    );

    // Force mismatched keys on a reversed pair → INVARIANT
    const bad = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CESAR',
      amount: 9000,
      registerIdempotencyKey: 'xfer-mismatch',
    });
    await ctx.service.reverse('t1', bad.transferId, {
      reversalIdempotencyKey: 'ai-action-run:match-a',
    });
    for (const t of ctx.treasury.values()) {
      if (t.provenanceKey?.includes(bad.transferId) && t.direction === 'INFLOW') {
        t.reversalIdempotencyKey = 'ai-action-run:match-b';
      }
    }
    await expect(
      ctx.service.reverse('t1', bad.transferId, {
        reversalIdempotencyKey: 'ai-action-run:match-a',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await ctx.service.classifyReversal('t1', bad.transferId, k)).kind).toBe(
      'INVARIANT',
    );
  });

  it('different-key race: one APPLIED, one EXTERNAL, liquidity once', async () => {
    const ctx = build();
    const reg = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 44000,
      registerIdempotencyKey: 'xfer-race',
    });
    const [a, b] = await Promise.all([
      ctx.service.reverse('t1', reg.transferId, {
        reversalIdempotencyKey: 'ai-action-run:race-1',
      }),
      ctx.service.reverse('t1', reg.transferId, {
        reversalIdempotencyKey: 'ai-action-run:race-2',
      }),
    ]);
    const applied = [a, b].filter((r) => r.causality === 'APPLIED');
    const external = [a, b].filter((r) => r.causality === 'EXTERNAL');
    expect(applied).toHaveLength(1);
    expect(external).toHaveLength(1);
    expect(ctx.liveLegs()).toHaveLength(0);
    expect(ctx.totalLiquidity().toString()).toBe('0');
  });

  it('reverse missing transfer → NotFound', async () => {
    const { service } = build();
    await expect(service.reverse('t1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not create OpEx / Payment / AccountEntry / commission side effects', async () => {
    const ctx = build();
    await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CESAR',
      amount: 75000,
      registerIdempotencyKey: 'no-side',
    });
    // Only treasury map mutated in this harness — prove no commission / no extra rows.
    expect(ctx.treasury.size).toBe(2);
    for (const t of ctx.treasury.values()) {
      expect(t.commission).toBeNull();
      expect(t.currency).toBe(Currency.MXN);
    }
  });

  it('reversed transfer cannot be re-registered with same key', async () => {
    const ctx = build();
    const reg = await ctx.service.register('t1', {
      sourceAccount: 'BANK',
      destinationAccount: 'CASH',
      amount: 1000,
      registerIdempotencyKey: 'rev-block',
      transferDate: new Date('2026-07-01T00:00:00.000Z'),
    });
    await ctx.service.reverse('t1', reg.transferId);
    await expect(
      ctx.service.register('t1', {
        sourceAccount: 'BANK',
        destinationAccount: 'CASH',
        amount: 1000,
        registerIdempotencyKey: 'rev-block',
        transferDate: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
