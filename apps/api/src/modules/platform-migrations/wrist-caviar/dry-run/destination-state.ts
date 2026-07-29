import type { PrismaService } from '../../../../prisma/prisma.service';
import { normalizeCustomerName } from '../normalization/customer-normalize';
import { sha256Hex } from './hash';
import type { DestinationState } from './plan-types';

function dec(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

/**
 * Load tenant destination state for planning. Uses batched finds (no N+1).
 * Does not open a long transaction.
 */
export async function loadDestinationState(
  prisma: PrismaService,
  tenantId: string,
  datasetId: string,
): Promise<DestinationState> {
  const [
    clients,
    watches,
    deals,
    accountEntries,
    accountPayments,
    expenses,
    treasury,
    investors,
    distributions,
    maps,
  ] = await Promise.all([
    prisma.client.findMany({
      where: { tenantId },
      select: { id: true, name: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
    prisma.watch.findMany({
      where: { tenantId },
      select: {
        id: true,
        brand: true,
        model: true,
        reference: true,
        serialNumber: true,
        status: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.deal.findMany({
      where: { tenantId },
      select: {
        id: true,
        clientId: true,
        importFingerprint: true,
        soldAt: true,
        agreedPrice: true,
        historicalCost: true,
        extrasAmount: true,
        reportedProfit: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.accountEntry.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        type: true,
        counterpartyName: true,
        concept: true,
        totalAmount: true,
        currency: true,
        notes: true,
        deletedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.accountPayment.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        entryId: true,
        amount: true,
        paidAt: true,
        notes: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.operatingExpense.findMany({
      where: { tenantId },
      select: {
        id: true,
        category: true,
        amount: true,
        expenseDate: true,
        notes: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.treasuryEntry.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        account: true,
        direction: true,
        amount: true,
        currency: true,
        transactionDate: true,
        description: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.investor.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, ownershipPercent: true },
      orderBy: { id: 'asc' },
    }),
    prisma.investorDistribution.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        investorId: true,
        amount: true,
        paidAt: true,
        notes: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.wristCaviarMigrationDestinationMap.findMany({
      where: { tenantId, datasetId },
      select: {
        sourceCandidateId: true,
        entityType: true,
        destinationId: true,
        sourceFingerprint: true,
      },
      orderBy: [{ entityType: 'asc' }, { sourceCandidateId: 'asc' }],
    }),
  ]);

  const paymentsByEntry = new Map<string, typeof accountPayments>();
  for (const p of accountPayments) {
    const list = paymentsByEntry.get(p.entryId) ?? [];
    list.push(p);
    paymentsByEntry.set(p.entryId, list);
  }

  const destEntries = accountEntries.map((e) => {
    const pays = paymentsByEntry.get(e.id) ?? [];
    return {
      id: e.id,
      type: e.type as 'RECEIVABLE' | 'PAYABLE',
      counterpartyName: e.counterpartyName,
      concept: e.concept,
      totalAmount: dec(e.totalAmount),
      currency: e.currency,
      notes: e.notes,
      deletedAt: e.deletedAt,
      paymentFingerprints: pays.map((p) =>
        sha256Hex({
          amount: dec(p.amount),
          paidAt: p.paidAt.toISOString().slice(0, 10),
          notes: p.notes ?? '',
        }),
      ),
      paymentsSum: pays.reduce((s, p) => s + dec(p.amount), 0),
    };
  });

  const cashMxn = treasury.filter((t) => t.account === 'CASH' && t.currency === 'MXN');
  const cashUsd = treasury.filter((t) => t.account === 'CASH' && t.currency === 'USD');
  const bank = treasury.filter((t) => t.account === 'BANK');

  const sumDir = (
    rows: typeof treasury,
    dir: string,
  ) => rows.filter((r) => r.direction === dir).reduce((s, r) => s + dec(r.amount), 0);

  const balances = {
    cashMxn:
      sumDir(cashMxn, 'IN') - sumDir(cashMxn, 'OUT'),
    cashUsd:
      sumDir(cashUsd, 'IN') - sumDir(cashUsd, 'OUT'),
    bank:
      sumDir(bank, 'IN') - sumDir(bank, 'OUT'),
    receivableOutstanding: destEntries
      .filter((e) => e.type === 'RECEIVABLE')
      .reduce((s, e) => s + (e.totalAmount - e.paymentsSum), 0),
    payableOutstanding: destEntries
      .filter((e) => e.type === 'PAYABLE')
      .reduce((s, e) => s + (e.totalAmount - e.paymentsSum), 0),
    expenses: expenses.reduce((s, e) => s + dec(e.amount), 0),
    dealRevenue: deals
      .filter((d) => !d.deletedAt)
      .reduce((s, d) => s + dec(d.agreedPrice), 0),
  };

  const counts = {
    clients: clients.filter((c) => !c.deletedAt).length,
    watches: watches.filter((w) => !w.deletedAt).length,
    deals: deals.filter((d) => !d.deletedAt).length,
    receivables: destEntries.filter((e) => e.type === 'RECEIVABLE').length,
    payables: destEntries.filter((e) => e.type === 'PAYABLE').length,
    accountPayments: accountPayments.length,
    expenses: expenses.length,
    treasury: treasury.length,
    investors: investors.length,
    distributions: distributions.length,
    maps: maps.length,
  };

  const fingerprintsByGroup: Record<string, string> = {
    CUSTOMERS: sha256Hex(
      clients.map((c) => ({
        id: c.id,
        name: normalizeCustomerName(c.name),
        deleted: Boolean(c.deletedAt),
      })),
    ),
    INVENTORY: sha256Hex(
      watches.map((w) => ({
        id: w.id,
        serial: w.serialNumber,
        status: w.status,
        deleted: Boolean(w.deletedAt),
      })),
    ),
    SALES: sha256Hex(
      deals.map((d) => ({
        id: d.id,
        fp: d.importFingerprint,
        price: dec(d.agreedPrice),
        deleted: Boolean(d.deletedAt),
      })),
    ),
    RECEIVABLES: sha256Hex(
      destEntries
        .filter((e) => e.type === 'RECEIVABLE')
        .map((e) => ({
          id: e.id,
          total: e.totalAmount,
          paid: e.paymentsSum,
          pays: e.paymentFingerprints,
        })),
    ),
    PAYABLES: sha256Hex(
      destEntries
        .filter((e) => e.type === 'PAYABLE')
        .map((e) => ({
          id: e.id,
          total: e.totalAmount,
          paid: e.paymentsSum,
          pays: e.paymentFingerprints,
        })),
    ),
    EXPENSES: sha256Hex(
      expenses.map((e) => ({
        id: e.id,
        cat: e.category,
        amt: dec(e.amount),
        date: e.expenseDate.toISOString().slice(0, 10),
      })),
    ),
    CASH_LEDGER: sha256Hex(
      treasury
        .filter((t) => t.account === 'CASH')
        .map((t) => ({
          id: t.id,
          cur: t.currency,
          dir: t.direction,
          amt: dec(t.amount),
          date: t.transactionDate.toISOString().slice(0, 10),
        })),
    ),
    BANK_LEDGER: sha256Hex(
      treasury
        .filter((t) => t.account === 'BANK')
        .map((t) => ({
          id: t.id,
          dir: t.direction,
          amt: dec(t.amount),
          date: t.transactionDate.toISOString().slice(0, 10),
        })),
    ),
    PARTNER_LEDGER: sha256Hex(
      treasury
        .filter((t) => t.account === 'CESAR')
        .map((t) => ({
          id: t.id,
          dir: t.direction,
          amt: dec(t.amount),
          date: t.transactionDate.toISOString().slice(0, 10),
        })),
    ),
    PROFIT_DISTRIBUTIONS: sha256Hex(
      distributions.map((d) => ({
        id: d.id,
        investorId: d.investorId,
        amt: dec(d.amount),
        paidAt: d.paidAt.toISOString().slice(0, 10),
      })),
    ),
  };

  const overallFingerprint = sha256Hex(fingerprintsByGroup);

  return {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      normalizedName: normalizeCustomerName(c.name),
      deletedAt: c.deletedAt,
    })),
    watches: watches.map((w) => ({
      ...w,
      brand: w.brand,
      model: w.model,
      reference: w.reference,
      serialNumber: w.serialNumber,
      status: w.status,
    })),
    deals: deals.map((d) => ({
      id: d.id,
      clientId: d.clientId,
      importFingerprint: d.importFingerprint,
      soldAt: d.soldAt,
      agreedPrice: dec(d.agreedPrice),
      historicalCost: d.historicalCost == null ? null : dec(d.historicalCost),
      extrasAmount: d.extrasAmount == null ? null : dec(d.extrasAmount),
      reportedProfit: d.reportedProfit == null ? null : dec(d.reportedProfit),
      deletedAt: d.deletedAt,
    })),
    accountEntries: destEntries,
    expenses: expenses.map((e) => ({
      id: e.id,
      category: e.category,
      amount: dec(e.amount),
      expenseDate: e.expenseDate.toISOString().slice(0, 10),
      notes: e.notes,
    })),
    treasury: treasury.map((t) => ({
      id: t.id,
      account: t.account,
      direction: t.direction,
      amount: dec(t.amount),
      currency: t.currency,
      transactionDate: t.transactionDate.toISOString().slice(0, 10),
      description: t.description,
    })),
    investors: investors.map((i) => ({
      id: i.id,
      name: i.name,
      ownershipPercent: dec(i.ownershipPercent),
    })),
    distributions: distributions.map((d) => ({
      id: d.id,
      investorId: d.investorId,
      amount: dec(d.amount),
      paidAt: d.paidAt.toISOString().slice(0, 10),
      notes: d.notes,
    })),
    maps,
    counts,
    balances,
    fingerprintsByGroup,
    overallFingerprint,
  };
}
