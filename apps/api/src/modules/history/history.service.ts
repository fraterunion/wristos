import { Injectable } from '@nestjs/common';
import { DealStage, OperatingExpenseCategory, PaymentStatus, Prisma, Watch, WatchExpense, WatchStatus } from '@prisma/client';
import { computeEffectiveCost } from '../../common/utils/effective-cost';
import { effectiveSaleDate } from '../../common/utils/effective-sale-date';
import { PrismaService } from '../../prisma/prisma.service';

type WatchWithExpenses = Watch & { expenses: WatchExpense[] };

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string) {
    const [totalAcquired, currentStock, soldDeals, bankFeeAgg] = await Promise.all([
      this.prisma.watch.count({ where: { tenantId } }),
      this.prisma.watch.count({
        where: { tenantId, deletedAt: null, status: { not: WatchStatus.SOLD } },
      }),
      this.prisma.deal.findMany({
        where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON },
        select: {
          agreedPrice: true,
          historicalCost: true,
          watch: {
            select: {
              cost: true,
              expenses: { select: { amount: true } },
            },
          },
        },
      }),
      // Sum all bank fee expenses to deduct from gross profit
      this.prisma.operatingExpense.aggregate({
        where: { tenantId, category: OperatingExpenseCategory.BANK_FEES },
        _sum: { amount: true },
      }),
    ]);

    const totalRevenue = soldDeals.reduce((sum, d) => sum + Number(d.agreedPrice), 0);
    const totalCostOfSold = soldDeals.reduce((sum, d) => {
      if (!d.watch) {
        return sum + Number(d.historicalCost ?? 0);
      }
      const expenseSum = d.watch.expenses.reduce((es, e) => es + Number(e.amount), 0);
      return sum + Number(d.watch.cost) + expenseSum;
    }, 0);
    const totalBankFees = Number(bankFeeAgg._sum.amount ?? 0);

    return {
      totalAcquired,
      totalSold: soldDeals.length,
      currentStock,
      totalRevenue: totalRevenue.toFixed(2),
      totalCostOfSold: totalCostOfSold.toFixed(2),
      totalBankFees: totalBankFees.toFixed(2),
      totalProfit: (totalRevenue - totalCostOfSold - totalBankFees).toFixed(2),
    };
  }

  async getSold(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON },
      include: {
        watch: { include: { expenses: { orderBy: { createdAt: 'asc' } } } },
        client: true,
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
        operatingExpenses: { where: { category: OperatingExpenseCategory.BANK_FEES } },
      },
      orderBy: [{ soldAt: 'desc' }, { updatedAt: 'desc' }],
    });

    return deals.map((deal) => {
      // Bank fees: sum BANK_FEES expenses linked to this deal via dealId FK.
      const bankFeeDecimal = deal.operatingExpenses.reduce(
        (acc, e) => acc.plus(e.amount),
        new Prisma.Decimal(0),
      );
      const netReceivedDecimal = deal.agreedPrice.minus(bankFeeDecimal);

      // Payment summary computed from the payments already loaded.
      // The payments query has `where: { deletedAt: null }` so all are active.
      const paidTotal = deal.payments
        .filter((p) => p.status === PaymentStatus.PAID)
        .reduce((acc, p) => acc.plus(p.amount), new Prisma.Decimal(0));
      const rawPending = deal.agreedPrice.minus(paidTotal);
      const pendingAmount = rawPending.lessThan(0) ? new Prisma.Decimal(0) : rawPending;
      const computedStatus: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' =
        paidTotal.gte(deal.agreedPrice) ? 'PAGADO' :
        paidTotal.greaterThan(0) ? 'PARCIAL' :
        'PENDIENTE';
      const paymentMethods = [...new Set(deal.payments.map((p) => p.method as string))];
      const saleDate = effectiveSaleDate(deal);
      const isHistoricalImport = deal.sourceTag === 'HISTORICAL_SALES_IMPORT' || deal.importSessionId != null;

      return {
        dealId: deal.id,
        watch: this.serializeWatch(deal.watch, deal.historicalCost, isHistoricalImport),
        buyer: {
          id: deal.client.id,
          name: deal.client.name,
          email: deal.client.email,
          phone: deal.client.phone,
        },
        agreedPrice: deal.agreedPrice.toString(),
        originalCurrency: deal.originalCurrency,
        originalAmount: deal.originalAmount?.toString() ?? null,
        exchangeRate: deal.exchangeRate?.toString() ?? null,
        bankFee: bankFeeDecimal.greaterThan(0) ? bankFeeDecimal.toString() : null,
        netReceived: netReceivedDecimal.toString(),
        paidTotal: paidTotal.toString(),
        pendingAmount: pendingAmount.toString(),
        computedStatus: isHistoricalImport && deal.payments.length === 0 ? 'HISTORICO' as const : computedStatus,
        paymentMethods,
        notes: deal.notes,
        soldAt: saleDate.toISOString(),
        createdAt: deal.createdAt.toISOString(),
        isHistoricalImport,
        sourceTag: deal.sourceTag ?? null,
        paymentCount: deal.paymentCount ?? null,
        payments: deal.payments.map((p) => ({
          id: p.id,
          amount: p.amount.toString(),
          method: p.method,
          status: p.status,
          paidAt: p.paidAt?.toISOString() ?? null,
          notes: p.notes ?? null,
        })),
      };
    });
  }

  async getStock(tenantId: string) {
    const watches = await this.prisma.watch.findMany({
      where: { tenantId, deletedAt: null },
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return watches.map((w) => this.serializeWatch(w));
  }

  async getAcquired(tenantId: string) {
    const watches = await this.prisma.watch.findMany({
      where: { tenantId },
      include: { expenses: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return watches.map((w) => this.serializeWatch(w));
  }

  async getMovements(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: { tenantId, deletedAt: null },
      include: { watch: true, client: true },
      orderBy: { updatedAt: 'desc' },
    });

    return deals.map((deal) => {
      const isHistoricalImport = deal.sourceTag === 'HISTORICAL_SALES_IMPORT' || deal.importSessionId != null;
      return {
      dealId: deal.id,
      stage: deal.stage,
      watch: deal.watch
        ? {
            id: deal.watch.id,
            brand: deal.watch.brand,
            model: deal.watch.model,
            serialNumber: deal.watch.serialNumber,
            status: deal.watch.status,
          }
        : {
            id: null,
            brand: isHistoricalImport ? 'Venta histórica' : 'Histórico',
            model: '—',
            serialNumber: null,
            status: null,
          },
      client: {
        id: deal.client.id,
        name: deal.client.name,
        email: deal.client.email,
        phone: deal.client.phone,
      },
      agreedPrice: deal.agreedPrice.toString(),
      notes: deal.notes,
      expectedCloseAt: deal.expectedCloseAt?.toISOString() ?? null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
      soldAt: effectiveSaleDate(deal).toISOString(),
      isHistoricalImport,
    };
    });
  }

  private serializeWatch(
    watch: WatchWithExpenses | null,
    historicalCost?: Prisma.Decimal | null,
    isHistoricalImport = false,
  ) {
    if (!watch) {
      const cost = historicalCost?.toString() ?? null;
      return {
        id: null,
        brand: isHistoricalImport ? 'Venta histórica' : 'Histórico',
        model: '—',
        reference: null,
        serialNumber: null,
        condition: null,
        cost,
        priceMin: null,
        priceMax: null,
        effectiveCost: cost ?? '0',
        status: null,
        ownershipType: null,
        consignmentOwnerName: null,
        consignmentSplitPercentage: null,
        createdAt: null,
        updatedAt: null,
        deletedAt: null,
      };
    }

    return {
      id: watch.id,
      brand: watch.brand,
      model: watch.model,
      reference: watch.reference ?? null,
      serialNumber: watch.serialNumber,
      condition: watch.condition,
      cost: watch.cost?.toString() ?? null,
      priceMin: watch.priceMin?.toString() ?? null,
      priceMax: watch.priceMax?.toString() ?? null,
      effectiveCost: computeEffectiveCost(watch.cost ?? 0, watch.expenses),
      status: watch.status,
      ownershipType: watch.ownershipType,
      consignmentOwnerName: watch.consignmentOwnerName,
      consignmentSplitPercentage: watch.consignmentSplitPercentage?.toString() ?? null,
      createdAt: watch.createdAt.toISOString(),
      updatedAt: watch.updatedAt.toISOString(),
      deletedAt: watch.deletedAt?.toISOString() ?? null,
    };
  }
}
