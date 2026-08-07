import {
  AccountEntryStatus,
  AccountEntryType,
  DealStage,
  OperatingExpenseCategory,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
  WatchStatus,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SaleRegistrationService } from './sale-registration.service';
import { TreasuryService } from '../treasury/treasury.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('SaleRegistrationService — canonical sale registration', () => {
  type State = {
    watches: Map<string, { id: string; tenantId: string; status: WatchStatus; deletedAt: Date | null; brand: string; model: string }>;
    clients: Map<string, { id: string; tenantId: string; name: string; deletedAt: Date | null }>;
    deals: Map<string, any>;
    payments: Map<string, any>;
    treasury: Map<string, any>;
    expenses: Map<string, any>;
    accountEntries: Map<string, any>;
    failTreasury?: boolean;
    failAccountEntry?: boolean;
    failWatch?: boolean;
  };

  function build(state: State) {
    let seq = 0;
    const id = (prefix: string) => `${prefix}-${++seq}`;

    const fxService = {
      getUsdMxn: jest.fn(async () => ({ rate: 20, stale: false, fetchedAt: new Date().toISOString() })),
    };

    const prisma: any = {
      watch: {
        findFirst: jest.fn(async ({ where }: any) => {
          const w = state.watches.get(where.id);
          if (!w || w.tenantId !== where.tenantId || w.deletedAt) return null;
          return w;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          if (state.failWatch) throw new Error('watch update failed');
          const w = state.watches.get(where.id)!;
          Object.assign(w, data);
          return w;
        }),
      },
      client: {
        findFirst: jest.fn(async ({ where }: any) => {
          const c = state.clients.get(where.id);
          if (!c || c.tenantId !== where.tenantId || c.deletedAt) return null;
          return c;
        }),
      },
      deal: {
        findFirst: jest.fn(async ({ where, include }: any) => {
          const rows = [...state.deals.values()].filter((deal) => {
            if (where.id && deal.id !== where.id) return false;
            if (where.tenantId && deal.tenantId !== where.tenantId) return false;
            if (where.registerIdempotencyKey && deal.registerIdempotencyKey !== where.registerIdempotencyKey) return false;
            if (where.watchId && deal.watchId !== where.watchId) return false;
            if (where.stage && deal.stage !== where.stage) return false;
            if (where.deletedAt === null && deal.deletedAt) return false;
            if (where.id?.not && deal.id === where.id.not) return false;
            return true;
          });
          const deal = rows[0] ?? null;
          if (!deal) return null;
          if (include?.payments) {
            return {
              ...deal,
              payments: [...state.payments.values()]
                .filter((p) => p.dealId === deal.id && !p.deletedAt)
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
            };
          }
          if (include?.client || include?.watch) {
            return {
              ...deal,
              client: state.clients.get(deal.clientId),
              watch: deal.watchId ? state.watches.get(deal.watchId) : null,
            };
          }
          return deal;
        }),
        create: jest.fn(async ({ data }: any) => {
          const dealId = id('deal');
          const tenantId = data.tenant.connect.id;
          const key = data.registerIdempotencyKey ?? null;
          if (key) {
            const clash = [...state.deals.values()].find(
              (drow) => drow.tenantId === tenantId && drow.registerIdempotencyKey === key && !drow.deletedAt,
            );
            if (clash) {
              const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: 'test',
              });
              throw err;
            }
          }
          const deal = {
            id: dealId,
            tenantId,
            clientId: data.client.connect.id,
            watchId: data.watch.connect.id,
            stage: data.stage,
            soldAt: data.soldAt,
            agreedPrice: d(data.agreedPrice),
            originalCurrency: data.originalCurrency,
            originalAmount: d(data.originalAmount),
            exchangeRate: data.exchangeRate ? d(data.exchangeRate) : null,
            notes: data.notes ?? null,
            expectedCloseAt: data.expectedCloseAt,
            registerIdempotencyKey: key,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            sourceTag: null,
          };
          state.deals.set(dealId, deal);
          return deal;
        }),
      },
      payment: {
        create: jest.fn(async ({ data }: any) => {
          const payment = {
            id: id('pay'),
            tenantId: data.tenant.connect.id,
            dealId: data.deal.connect.id,
            amount: d(data.amount),
            method: data.method,
            status: data.status,
            paidAt: data.paidAt,
            notes: data.notes ?? null,
            deletedAt: null,
            createdAt: new Date(),
          };
          state.payments.set(payment.id, payment);
          return payment;
        }),
        groupBy: jest.fn(async ({ by, where, _sum }: any) => {
          void by;
          void _sum;
          const map = new Map<string, Prisma.Decimal>();
          for (const p of state.payments.values()) {
            if (p.tenantId !== where.tenantId) continue;
            if (where.dealId?.in && !where.dealId.in.includes(p.dealId)) continue;
            if (where.dealId && typeof where.dealId === 'string' && p.dealId !== where.dealId) continue;
            if (where.status && p.status !== where.status) continue;
            if (where.deletedAt === null && p.deletedAt) continue;
            map.set(p.dealId, (map.get(p.dealId) ?? d(0)).plus(p.amount));
          }
          return [...map.entries()].map(([dealId, amount]) => ({
            dealId,
            _sum: { amount },
          }));
        }),
        aggregate: jest.fn(async ({ where }: any) => {
          let sum = d(0);
          for (const p of state.payments.values()) {
            if (p.tenantId !== where.tenantId) continue;
            if (p.dealId !== where.dealId) continue;
            if (p.status !== where.status) continue;
            if (p.deletedAt) continue;
            sum = sum.plus(p.amount);
          }
          return { _sum: { amount: sum } };
        }),
      },
      treasuryEntry: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.dealPaymentId) {
            return (
              [...state.treasury.values()].find(
                (t) => t.dealPaymentId === where.dealPaymentId && !t.deletedAt,
              ) ?? null
            );
          }
          return null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const rows = [...state.treasury.values()].filter((t) => {
            if (where.deletedAt === null && t.deletedAt) return false;
            if (where.tenantId && t.tenantId !== where.tenantId) return false;
            if (where.provenanceKey && t.provenanceKey !== where.provenanceKey) return false;
            if (where.dealPaymentId && t.dealPaymentId !== where.dealPaymentId) return false;
            if (where.OR) {
              return where.OR.some((clause: any) => {
                if (clause.dealPaymentId) return t.dealPaymentId === clause.dealPaymentId;
                if (clause.provenanceKey)
                  return (
                    t.tenantId === clause.tenantId &&
                    t.provenanceKey === clause.provenanceKey
                  );
                return false;
              });
            }
            return true;
          });
          return rows[0] ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          if (state.failTreasury) throw new Error('treasury failed');
          if (data.provenanceKey) {
            const clash = [...state.treasury.values()].find(
              (t) =>
                t.tenantId === data.tenantId &&
                t.provenanceKey === data.provenanceKey &&
                !t.deletedAt,
            );
            if (clash) {
              throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: 'test',
              });
            }
          }
          if (data.dealPaymentId) {
            const clash = [...state.treasury.values()].find(
              (t) => t.dealPaymentId === data.dealPaymentId && !t.deletedAt,
            );
            if (clash) {
              throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                code: 'P2002',
                clientVersion: 'test',
              });
            }
          }
          const entry = {
            id: id('tre'),
            deletedAt: null,
            ...data,
            amount: d(data.amount),
            amountMxn: d(data.amountMxn),
            commission:
              data.commission === null || data.commission === undefined
                ? null
                : d(data.commission),
          };
          state.treasury.set(entry.id, entry);
          return entry;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const entry = state.treasury.get(where.id);
          Object.assign(entry, data);
          return entry;
        }),
      },
      operatingExpense: {
        create: jest.fn(async () => {
          throw new Error('OpEx BANK_FEES must not be created for canonical sale fees');
        }),
        findFirst: jest.fn(async () => null),
      },
      accountEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          return (
            [...state.accountEntries.values()].find((e) => {
              if (where.tenantId && e.tenantId !== where.tenantId) return false;
              if (where.dealId && e.dealId !== where.dealId) return false;
              if (where.type && e.type !== where.type) return false;
              if (where.deletedAt === null && e.deletedAt) return false;
              return true;
            }) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          if (state.failAccountEntry) throw new Error('account entry failed');
          const row = {
            id: id('ae'),
            tenantId: data.tenant.connect.id,
            type: data.type,
            status: data.status,
            category: data.category,
            source: data.source,
            counterpartyName: data.counterpartyName,
            counterpartyType: data.counterpartyType,
            concept: data.concept,
            totalAmount: d(data.totalAmount),
            currency: data.currency,
            exchangeRate: data.exchangeRate ?? null,
            issuedAt: data.issuedAt,
            clientId: data.client.connect.id,
            dealId: data.deal.connect.id,
            watchId: data.watch?.connect?.id ?? null,
            closedAt: null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.accountEntries.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.accountEntries.get(where.id);
          Object.assign(row, data);
          return row;
        }),
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const cuentasService = {
      syncDealReceivable: jest.fn(async (dealId: string, tenantId: string, tx?: any) => {
        const db = tx ?? prisma;
        const deal = await db.deal.findFirst({
          where: { id: dealId, tenantId, deletedAt: null },
          include: { client: true, watch: true },
        });
        if (!deal) return null;
        const existing = await db.accountEntry.findFirst({
          where: { tenantId, dealId, type: AccountEntryType.RECEIVABLE, deletedAt: null },
        });
        let entry = existing;
        if (!existing) {
          entry = await db.accountEntry.create({
            data: {
              tenant: { connect: { id: tenantId } },
              type: AccountEntryType.RECEIVABLE,
              status: AccountEntryStatus.OPEN,
              category: 'SALE_BALANCE',
              source: 'DEAL_AUTO',
              counterpartyName: deal.client.name,
              counterpartyType: 'CLIENT',
              concept: `Saldo pendiente — ${deal.watch.brand} ${deal.watch.model}`,
              totalAmount: deal.agreedPrice,
              currency: 'MXN',
              issuedAt: deal.updatedAt,
              client: { connect: { id: deal.clientId } },
              deal: { connect: { id: deal.id } },
              watch: { connect: { id: deal.watchId } },
            },
          });
        }
        const paidAgg = await db.payment.groupBy({
          by: ['dealId'],
          where: {
            tenantId,
            dealId: { in: [dealId] },
            status: PaymentStatus.PAID,
            deletedAt: null,
          },
          _sum: { amount: true },
        });
        const paid = paidAgg[0]?._sum.amount ?? d(0);
        let status: AccountEntryStatus = AccountEntryStatus.OPEN;
        let closedAt: Date | null = null;
        if (paid.gte(entry.totalAmount)) {
          status = AccountEntryStatus.PAID;
          closedAt = new Date();
        } else if (paid.greaterThan(0)) {
          status = AccountEntryStatus.PARTIAL;
        }
        return db.accountEntry.update({
          where: { id: entry.id },
          data: { status, closedAt },
        });
      }),
    };

    const treasuryService = new TreasuryService(prisma);
    const service = new SaleRegistrationService(
      prisma,
      fxService as any,
      cuentasService as any,
      treasuryService,
    );

    return { service, prisma, cuentasService, treasuryService, state };
  }

  function seedTenant(state: State, tenantId = 't1') {
    state.clients.set('c1', {
      id: 'c1',
      tenantId,
      name: 'Cliente',
      deletedAt: null,
    });
    state.watches.set('w1', {
      id: 'w1',
      tenantId,
      status: WatchStatus.AVAILABLE,
      deletedAt: null,
      brand: 'Rolex',
      model: 'Batman',
    });
  }

  function emptyState(): State {
    return {
      watches: new Map(),
      clients: new Map(),
      deals: new Map(),
      payments: new Map(),
      treasury: new Map(),
      expenses: new Map(),
      accountEntries: new Map(),
    };
  }

  function bankDelta(state: State): Prisma.Decimal {
    let net = d(0);
    for (const t of state.treasury.values()) {
      if (t.account !== TreasuryAccount.BANK || t.deletedAt) continue;
      net =
        t.direction === TreasuryDirection.INFLOW
          ? net.plus(t.amountMxn)
          : net.minus(t.amountMxn);
    }
    return net;
  }

  function pnlBankFeeOnce(state: State): {
    treasuryCommission: Prisma.Decimal;
    opexBankFees: Prisma.Decimal;
  } {
    let treasuryCommission = d(0);
    for (const t of state.treasury.values()) {
      if (t.commission && d(t.commission).greaterThan(0)) {
        treasuryCommission = treasuryCommission.plus(t.commission);
      }
    }
    let opexBankFees = d(0);
    for (const e of state.expenses.values()) {
      if (e.category === OperatingExpenseCategory.BANK_FEES) {
        opexBankFees = opexBankFees.plus(e.amount);
      }
    }
    return { treasuryCommission, opexBankFees };
  }

  it('A. BANCOS without bankChannel is rejected', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    await expect(
      service.register('t1', {
        watchId: 'w1',
        clientId: 'c1',
        agreedPrice: 100000,
        currency: 'MXN',
        payment: { amountReceived: 100000, method: 'BANCOS' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('B. BANCOS fee 2k: Payment 100k, INFLOW +100k, OUTFLOW -2k, BANK +98k, P&L -2k once', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN',
      payment: {
        amountReceived: 100000,
        method: 'BANCOS',
        bankChannel: 'JOSE',
      },
    });

    expect(result.payment?.amount.toString()).toBe('100000');
    expect(result.treasuryEntry?.direction).toBe(TreasuryDirection.INFLOW);
    expect(result.treasuryEntry?.amount.toString()).toBe('100000');
    expect(result.treasuryEntry?.commission).toBeNull();
    expect(result.bankFeeTreasuryEntry?.direction).toBe(TreasuryDirection.OUTFLOW);
    expect(result.bankFeeTreasuryEntry?.amount.toString()).toBe('2000');
    expect(result.bankFeeTreasuryEntry?.commission?.toString()).toBe('2000');
    expect(result.bankFeeTreasuryEntry?.dealPaymentId).toBeNull();
    expect(result.bankFeeAmount.toString()).toBe('2000');
    expect(bankDelta(state).toString()).toBe('98000');
    expect(state.treasury.size).toBe(2);
    expect(state.expenses.size).toBe(0);

    const pnl = pnlBankFeeOnce(state);
    expect(pnl.treasuryCommission.toString()).toBe('2000');
    expect(pnl.opexBankFees.toString()).toBe('0');
    // monthly profit fee impact = commissions + opex bank fees = 2000 exactly once
    expect(pnl.treasuryCommission.plus(pnl.opexBankFees).toString()).toBe('2000');
  });

  it('PAID BANCOS: Deal CLOSED_WON, Watch SOLD, Payment, dual Treasury legs, no OpEx', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN',
      payment: {
        amountReceived: 100000,
        method: 'BANCOS',
        bankChannel: 'JOSE',
      },
    });

    expect(result.deal.stage).toBe(DealStage.CLOSED_WON);
    expect(state.watches.get('w1')!.status).toBe(WatchStatus.SOLD);
    expect(result.payment?.amount.toString()).toBe('100000');
    expect(result.receivable?.status).toBe(AccountEntryStatus.PAID);
    expect(result.computedStatus).toBe('PAGADO');
    expect(state.expenses.size).toBe(0);
    expect(state.treasury.size).toBe(2);
  });

  it('C. CASH: Payment 100k, Cash +100k, no bank fee', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN',
      payment: { amountReceived: 100000, method: 'CASH' },
    });

    expect(result.treasuryEntry?.account).toBe(TreasuryAccount.CASH);
    expect(result.treasuryEntry?.amount.toString()).toBe('100000');
    expect(result.bankFeeTreasuryEntry).toBeNull();
    expect(result.bankFeeAmount.toString()).toBe('0');
    expect(state.treasury.size).toBe(1);
    expect(bankDelta(state).toString()).toBe('0');
  });

  it('D. CESAR: Payment 100k, César +100k, no bank fee', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN',
      payment: { amountReceived: 100000, method: 'CESAR' },
    });

    expect(result.treasuryEntry?.account).toBe(TreasuryAccount.CESAR);
    expect(result.bankFeeTreasuryEntry).toBeNull();
    expect(state.treasury.size).toBe(1);
  });

  it('F. PARTIAL BANCOS: 40k received, fee on 40k, CXC 60k, net BANK +39200', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN',
      payment: {
        amountReceived: 40000,
        method: 'BANCOS',
        bankChannel: 'JOSE',
      },
    });

    expect(result.payment?.amount.toString()).toBe('40000');
    expect(result.bankFeeAmount.toString()).toBe('800');
    expect(result.pendingAmount.toString()).toBe('60000');
    expect(result.receivable?.status).toBe(AccountEntryStatus.PARTIAL);
    expect(bankDelta(state).toString()).toBe('39200');
  });

  it('G. Replay: no duplicate payment / inflow / fee / OpEx', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);
    const input = {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN' as const,
      payment: {
        amountReceived: 100000,
        method: 'BANCOS' as const,
        bankChannel: 'JOSE' as const,
      },
      registerIdempotencyKey: 'ai-action-run:fee-replay',
    };

    await service.register('t1', input);
    await service.register('t1', input);

    expect(state.deals.size).toBe(1);
    expect(state.payments.size).toBe(1);
    expect(state.treasury.size).toBe(2);
    expect(state.expenses.size).toBe(0);
    expect(bankDelta(state).toString()).toBe('98000');
  });

  it('E. CREDIT: No Payment, No Treasury, CXC +100k', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 50000,
      currency: 'MXN',
    });

    expect(result.deal.stage).toBe(DealStage.CLOSED_WON);
    expect(state.watches.get('w1')!.status).toBe(WatchStatus.SOLD);
    expect(result.payment).toBeNull();
    expect(result.treasuryEntry).toBeNull();
    expect(result.receivable?.totalAmount.toString()).toBe('50000');
    expect(result.receivable?.status).toBe(AccountEntryStatus.OPEN);
    expect(result.computedStatus).toBe('PENDIENTE');
  });

  it('PARTIAL: payment + treasury received amount + CXC remainder', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 100000,
      currency: 'MXN',
      payment: { amountReceived: 40000, method: 'CASH' },
    });

    expect(result.payment?.amount.toString()).toBe('40000');
    expect(result.treasuryEntry?.account).toBe(TreasuryAccount.CASH);
    expect(result.treasuryEntry?.amount.toString()).toBe('40000');
    expect(result.pendingAmount.toString()).toBe('60000');
    expect(result.receivable?.status).toBe(AccountEntryStatus.PARTIAL);
    expect(result.computedStatus).toBe('PARCIAL');
  });

  it('same idempotency key + same request → one Deal (replay)', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);
    const input = {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 10000,
      currency: 'MXN' as const,
      payment: { amountReceived: 10000, method: 'CESAR' as const },
      registerIdempotencyKey: 'ai-action-run:run-1',
    };

    const first = await service.register('t1', input);
    const second = await service.register('t1', input);

    expect(state.deals.size).toBe(1);
    expect(first.deal.id).toBe(second.deal.id);
    expect(second.replayed).toBe(true);
    expect(state.treasury.size).toBe(1);
  });

  it('same key + conflicting payload → conflict', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 10000,
      currency: 'MXN',
      registerIdempotencyKey: 'key-1',
      payment: { amountReceived: 10000, method: 'CASH' },
    });

    state.watches.set('w2', {
      id: 'w2',
      tenantId: 't1',
      status: WatchStatus.AVAILABLE,
      deletedAt: null,
      brand: 'AP',
      model: 'Royal',
    });

    await expect(
      service.register('t1', {
        watchId: 'w2',
        clientId: 'c1',
        agreedPrice: 10000,
        currency: 'MXN',
        registerIdempotencyKey: 'key-1',
        payment: { amountReceived: 10000, method: 'CASH' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('concurrent same key → exactly one Deal (P2002 race)', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service, prisma } = build(state);

    // Concurrent winner already committed under the unique key.
    const winner = {
      id: 'deal-winner',
      tenantId: 't1',
      clientId: 'c1',
      watchId: 'w1',
      stage: DealStage.CLOSED_WON,
      soldAt: new Date(),
      agreedPrice: d(10000),
      originalCurrency: 'MXN',
      originalAmount: d(10000),
      exchangeRate: null,
      notes: null,
      expectedCloseAt: new Date(),
      registerIdempotencyKey: 'race-key',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceTag: null,
    };
    state.deals.set(winner.id, winner);
    state.payments.set('pay-winner', {
      id: 'pay-winner',
      tenantId: 't1',
      dealId: winner.id,
      amount: d(10000),
      method: PaymentMethod.CASH,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      notes: null,
      deletedAt: null,
      createdAt: new Date(),
    });

    let idempotencyFinds = 0;
    const originalFind = prisma.deal.findFirst;
    prisma.deal.findFirst = jest.fn(async (args: any) => {
      if (args.where?.registerIdempotencyKey === 'race-key') {
        idempotencyFinds += 1;
        // Race window: first lookup misses; recovery lookup sees winner.
        if (idempotencyFinds === 1) return null;
        return {
          ...winner,
          payments: [...state.payments.values()].filter((p) => p.dealId === winner.id),
        };
      }
      // Hide winner from pre-create "already sold deal" guard (other writer won the race).
      if (args.where?.stage === DealStage.CLOSED_WON) return null;
      return originalFind(args);
    });

    prisma.deal.create = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      });
    });

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 10000,
      currency: 'MXN',
      payment: { amountReceived: 10000, method: 'CASH' },
      registerIdempotencyKey: 'race-key',
    });

    expect(result.deal.id).toBe('deal-winner');
    expect(result.replayed).toBe(true);
    expect(state.deals.size).toBe(1);
  });

  it('null idempotency key preserves legacy multi-sale behavior across watches', async () => {
    const state = emptyState();
    seedTenant(state);
    state.watches.set('w2', {
      id: 'w2',
      tenantId: 't1',
      status: WatchStatus.AVAILABLE,
      deletedAt: null,
      brand: 'Omega',
      model: 'Speed',
    });
    const { service } = build(state);

    await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 1000,
      currency: 'MXN',
      payment: { amountReceived: 1000, method: 'CASH' },
    });
    await service.register('t1', {
      watchId: 'w2',
      clientId: 'c1',
      agreedPrice: 2000,
      currency: 'MXN',
      payment: { amountReceived: 2000, method: 'CASH' },
    });

    expect(state.deals.size).toBe(2);
    expect([...state.deals.values()].every((drow) => drow.registerIdempotencyKey === null)).toBe(
      true,
    );
  });

  it('Treasury failure rolls back entire sale (no Deal)', async () => {
    const state = emptyState();
    seedTenant(state);
    state.failTreasury = true;
    const { service, prisma } = build(state);

    // Simulate transactional rollback: on failure, clear writes made in the callback.
    prisma.$transaction = jest.fn(async (fn: any) => {
      const snapshot = {
        deals: new Map(state.deals),
        payments: new Map(state.payments),
        treasury: new Map(state.treasury),
        expenses: new Map(state.expenses),
        accountEntries: new Map(state.accountEntries),
        watches: new Map(
          [...state.watches.entries()].map(([k, v]) => [k, { ...v }]),
        ),
      };
      try {
        return await fn(prisma);
      } catch (error) {
        state.deals = snapshot.deals;
        state.payments = snapshot.payments;
        state.treasury = snapshot.treasury;
        state.expenses = snapshot.expenses;
        state.accountEntries = snapshot.accountEntries;
        state.watches = snapshot.watches;
        throw error;
      }
    });

    await expect(
      service.register('t1', {
        watchId: 'w1',
        clientId: 'c1',
        agreedPrice: 10000,
        currency: 'MXN',
        payment: { amountReceived: 10000, method: 'CASH' },
      }),
    ).rejects.toThrow('treasury failed');

    expect(state.deals.size).toBe(0);
    expect(state.payments.size).toBe(0);
    expect(state.watches.get('w1')!.status).toBe(WatchStatus.AVAILABLE);
  });

  it('AccountEntry failure rolls back entire sale', async () => {
    const state = emptyState();
    seedTenant(state);
    state.failAccountEntry = true;
    const { service, prisma } = build(state);

    prisma.$transaction = jest.fn(async (fn: any) => {
      const snapshot = {
        deals: new Map(state.deals),
        payments: new Map(state.payments),
        treasury: new Map(state.treasury),
        expenses: new Map(state.expenses),
        accountEntries: new Map(state.accountEntries),
        watches: new Map(
          [...state.watches.entries()].map(([k, v]) => [k, { ...v }]),
        ),
      };
      try {
        return await fn(prisma);
      } catch (error) {
        state.deals = snapshot.deals;
        state.payments = snapshot.payments;
        state.treasury = snapshot.treasury;
        state.expenses = snapshot.expenses;
        state.accountEntries = snapshot.accountEntries;
        state.watches = snapshot.watches;
        throw error;
      }
    });

    await expect(
      service.register('t1', {
        watchId: 'w1',
        clientId: 'c1',
        agreedPrice: 10000,
        currency: 'MXN',
      }),
    ).rejects.toThrow('account entry failed');

    expect(state.deals.size).toBe(0);
    expect(state.watches.get('w1')!.status).toBe(WatchStatus.AVAILABLE);
  });

  it('Watch failure rolls back — no Deal/payment/treasury', async () => {
    const state = emptyState();
    seedTenant(state);
    state.failWatch = true;
    const { service, prisma } = build(state);

    prisma.$transaction = jest.fn(async (fn: any) => {
      const snapshot = {
        deals: new Map(state.deals),
        payments: new Map(state.payments),
        treasury: new Map(state.treasury),
        expenses: new Map(state.expenses),
        accountEntries: new Map(state.accountEntries),
      };
      try {
        return await fn(prisma);
      } catch (error) {
        state.deals = snapshot.deals;
        state.payments = snapshot.payments;
        state.treasury = snapshot.treasury;
        state.expenses = snapshot.expenses;
        state.accountEntries = snapshot.accountEntries;
        throw error;
      }
    });

    await expect(
      service.register('t1', {
        watchId: 'w1',
        clientId: 'c1',
        agreedPrice: 10000,
        currency: 'MXN',
        payment: { amountReceived: 10000, method: 'CASH' },
      }),
    ).rejects.toThrow('watch update failed');

    expect(state.deals.size).toBe(0);
    expect(state.payments.size).toBe(0);
    expect(state.treasury.size).toBe(0);
  });

  it('legacy full paymentMethod path remains supported', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 25000,
      currency: 'MXN',
      legacyFullPaymentMethod: 'CESAR',
    });

    expect(result.payment?.method).toBe(PaymentMethod.CESAR);
    expect(result.payment?.amount.toString()).toBe('25000');
    expect(result.treasuryEntry?.account).toBe(TreasuryAccount.CESAR);
    expect(result.computedStatus).toBe('PAGADO');
  });

  it('tenant isolation: cannot sell another tenant watch', async () => {
    const state = emptyState();
    seedTenant(state, 't1');
    const { service } = build(state);

    await expect(
      service.register('t2', {
        watchId: 'w1',
        clientId: 'c1',
        agreedPrice: 1000,
        currency: 'MXN',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Decimal-safe bank commission for MAYTE 1%', async () => {
    const state = emptyState();
    seedTenant(state);
    const { service } = build(state);

    const result = await service.register('t1', {
      watchId: 'w1',
      clientId: 'c1',
      agreedPrice: 33333.33,
      currency: 'MXN',
      payment: {
        amountReceived: 33333.33,
        method: 'BANCOS',
        bankChannel: 'MAYTE',
      },
    });

    expect(result.bankFeeAmount.toFixed(2)).toBe('333.33');
    expect(state.expenses.size).toBe(0);
    expect(state.treasury.size).toBe(2);
    expect(bankDelta(state).toFixed(2)).toBe('33000.00');
  });
});
