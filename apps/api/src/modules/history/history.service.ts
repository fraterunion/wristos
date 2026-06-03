import { Injectable } from '@nestjs/common';
import { DealStage, OperatingExpenseCategory, Prisma, Watch, WatchExpense, WatchStatus } from '@prisma/client';
import { computeEffectiveCost } from '../../common/utils/effective-cost';
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
      orderBy: { updatedAt: 'desc' },
    });

    return deals.map((deal) => {
      // Sum BANK_FEES linked to this deal via FK (dealId).
      // Existing rows with no dealId will contribute zero (empty array).
      const bankFeeDecimal = deal.operatingExpenses.reduce(
        (acc, e) => acc.plus(e.amount),
        new Prisma.Decimal(0),
      );
      const netReceivedDecimal = deal.agreedPrice.minus(bankFeeDecimal);

      return {
        dealId: deal.id,
        watch: this.serializeWatch(deal.watch),
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
        notes: deal.notes,
        soldAt: deal.updatedAt.toISOString(),
        createdAt: deal.createdAt.toISOString(),
        payments: deal.payments.map((p) => ({
          id: p.id,
          amount: p.amount.toString(),
          method: p.method,
          status: p.status,
          paidAt: p.paidAt?.toISOString() ?? null,
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

    return deals.map((deal) => ({
      dealId: deal.id,
      stage: deal.stage,
      watch: {
        id: deal.watch.id,
        brand: deal.watch.brand,
        model: deal.watch.model,
        serialNumber: deal.watch.serialNumber,
        status: deal.watch.status,
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
    }));
  }

  private serializeWatch(watch: WatchWithExpenses) {
    return {
      id: watch.id,
      brand: watch.brand,
      model: watch.model,
      serialNumber: watch.serialNumber,
      condition: watch.condition,
      cost: watch.cost.toString(),
      priceMin: watch.priceMin.toString(),
      priceMax: watch.priceMax.toString(),
      effectiveCost: computeEffectiveCost(watch.cost, watch.expenses),
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
