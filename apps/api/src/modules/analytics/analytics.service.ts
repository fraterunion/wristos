import { Injectable } from '@nestjs/common';
import {
  DealStage,
  PaymentStatus,
  Prisma,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsPeriod } from './dto/analytics-period.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRevenueOverTime(tenantId: string, period: AnalyticsPeriod) {
    const { start, end, labels, bucket } = this.buildSeriesWindow(period);
    const rows = await this.prisma.payment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: PaymentStatus.PAID,
        paidAt: {
          not: null,
          gte: start,
          lte: end,
        },
      },
      select: {
        amount: true,
        paidAt: true,
      },
    });

    const sums = new Map<string, number>();
    for (const row of rows) {
      if (!row.paidAt) continue;
      const key = this.getBucketLabel(row.paidAt, bucket);
      const current = sums.get(key) ?? 0;
      sums.set(key, current + Number(row.amount));
    }

    return labels.map((label) => ({
      label,
      revenue: Number((sums.get(label) ?? 0).toFixed(2)),
    }));
  }

  async getSalesOverTime(tenantId: string, period: AnalyticsPeriod) {
    const { start, end, labels, bucket } = this.buildSeriesWindow(period);
    const rows = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
        updatedAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        updatedAt: true,
      },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = this.getBucketLabel(row.updatedAt, bucket);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return labels.map((label) => ({
      label,
      count: counts.get(label) ?? 0,
    }));
  }

  async getSummary(tenantId: string) {
    const watchWhere: Prisma.WatchWhereInput = { tenantId, deletedAt: null };
    const dealWhere: Prisma.DealWhereInput = { tenantId, deletedAt: null };
    const paymentWhere: Prisma.PaymentWhereInput = { tenantId, deletedAt: null };

    const [
      totalWatches,
      availableWatches,
      reservedWatches,
      soldWatches,
      consignmentWatches,
      inventorySums,
      activeClients,
      totalDeals,
      dealsByStageRows,
      totalAgreedRevenueAgg,
      totalCollectedRevenueAgg,
      deals,
      paidByDealRows,
    ] = await Promise.all([
      this.prisma.watch.count({ where: watchWhere }),
      this.prisma.watch.count({
        where: { ...watchWhere, status: WatchStatus.AVAILABLE },
      }),
      this.prisma.watch.count({
        where: { ...watchWhere, status: WatchStatus.RESERVED },
      }),
      this.prisma.watch.count({
        where: { ...watchWhere, status: WatchStatus.SOLD },
      }),
      this.prisma.watch.count({
        where: { ...watchWhere, ownershipType: WatchOwnershipType.CONSIGNMENT },
      }),
      this.prisma.watch.aggregate({
        where: watchWhere,
        _sum: { priceMin: true, cost: true },
      }),
      this.prisma.client.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.deal.count({ where: dealWhere }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: dealWhere,
        _count: { _all: true },
      }),
      this.prisma.deal.aggregate({ where: dealWhere, _sum: { agreedPrice: true } }),
      this.prisma.payment.aggregate({
        where: { ...paymentWhere, status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
      this.prisma.deal.findMany({
        where: dealWhere,
        select: { id: true, agreedPrice: true },
      }),
      this.prisma.payment.groupBy({
        by: ['dealId'],
        where: {
          ...paymentWhere,
          status: PaymentStatus.PAID,
        },
        _sum: { amount: true },
      }),
    ]);

    const dealsByStage = this.buildDealStageCounts(dealsByStageRows);

    const paidMap = new Map<string, Prisma.Decimal>();
    for (const row of paidByDealRows) {
      paidMap.set(row.dealId, row._sum.amount ?? new Prisma.Decimal(0));
    }

    let totalPendingBalance = new Prisma.Decimal(0);
    for (const deal of deals) {
      const paid = paidMap.get(deal.id) ?? new Prisma.Decimal(0);
      const pending = deal.agreedPrice.minus(paid);
      if (pending.greaterThan(0)) {
        totalPendingBalance = totalPendingBalance.plus(pending);
      }
    }

    return {
      totalWatches,
      availableWatches,
      reservedWatches,
      soldWatches,
      consignmentWatches,
      totalInventoryValue: (inventorySums._sum.priceMin ?? new Prisma.Decimal(0)).toString(),
      totalInventoryCost: (inventorySums._sum.cost ?? new Prisma.Decimal(0)).toString(),
      activeClients,
      totalDeals,
      dealsByStage,
      totalAgreedRevenue: (
        totalAgreedRevenueAgg._sum.agreedPrice ?? new Prisma.Decimal(0)
      ).toString(),
      totalCollectedRevenue: (
        totalCollectedRevenueAgg._sum.amount ?? new Prisma.Decimal(0)
      ).toString(),
      totalPendingBalance: totalPendingBalance.toString(),
    };
  }

  async getInventoryAging(tenantId: string) {
    const watches = await this.prisma.watch.findMany({
      where: { tenantId, deletedAt: null },
      select: { createdAt: true },
    });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const buckets = {
      days0to30: 0,
      days31to60: 0,
      days61to90: 0,
      days90plus: 0,
    };

    for (const watch of watches) {
      const ageDays = Math.floor((now - watch.createdAt.getTime()) / dayMs);
      if (ageDays <= 30) buckets.days0to30 += 1;
      else if (ageDays <= 60) buckets.days31to60 += 1;
      else if (ageDays <= 90) buckets.days61to90 += 1;
      else buckets.days90plus += 1;
    }

    return buckets;
  }

  async getPipeline(tenantId: string) {
    const rows = await this.prisma.deal.groupBy({
      by: ['stage'],
      where: { tenantId, deletedAt: null },
      _count: { _all: true },
      _sum: { agreedPrice: true },
    });

    const countsByStage = this.buildDealStageCounts(rows);
    const agreedPriceByStage = this.buildDealStageSums(rows);

    const openStages: DealStage[] = [
      DealStage.LEAD,
      DealStage.INTERESTED,
      DealStage.NEGOTIATING,
      DealStage.PENDING_PAYMENT,
    ];

    const totalOpenDeals = openStages.reduce(
      (acc, stage) => acc + countsByStage[stage],
      0,
    );

    return {
      countsByStage,
      totalAgreedPriceByStage: agreedPriceByStage,
      totalOpenDeals,
      totalWonDeals: countsByStage[DealStage.CLOSED_WON],
      totalLostDeals: countsByStage[DealStage.CLOSED_LOST],
    };
  }

  private buildDealStageCounts(
    rows: Array<{ stage: DealStage; _count: { _all: number } }>,
  ): Record<DealStage, number> {
    const base: Record<DealStage, number> = {
      LEAD: 0,
      INTERESTED: 0,
      NEGOTIATING: 0,
      PENDING_PAYMENT: 0,
      CLOSED_WON: 0,
      CLOSED_LOST: 0,
    };

    for (const row of rows) {
      base[row.stage] = row._count._all;
    }

    return base;
  }

  private buildDealStageSums(
    rows: Array<{ stage: DealStage; _sum: { agreedPrice: Prisma.Decimal | null } }>,
  ): Record<DealStage, string> {
    const zero = new Prisma.Decimal(0);
    const base: Record<DealStage, string> = {
      LEAD: zero.toString(),
      INTERESTED: zero.toString(),
      NEGOTIATING: zero.toString(),
      PENDING_PAYMENT: zero.toString(),
      CLOSED_WON: zero.toString(),
      CLOSED_LOST: zero.toString(),
    };

    for (const row of rows) {
      base[row.stage] = (row._sum.agreedPrice ?? zero).toString();
    }

    return base;
  }

  private buildSeriesWindow(period: AnalyticsPeriod) {
    const now = new Date();
    const end = this.startOfDayUtc(now);

    if (period === AnalyticsPeriod.YEAR) {
      const labels: string[] = [];
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));

      for (let i = 0; i < 12; i += 1) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
        labels.push(this.formatMonthUtc(d));
      }

      return { start, end: now, labels, bucket: 'month' as const };
    }

    const days = period === AnalyticsPeriod.WEEK ? 7 : 30;
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (days - 1)));
    const labels: string[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
      labels.push(this.formatDayUtc(d));
    }

    return { start, end: now, labels, bucket: 'day' as const };
  }

  private getBucketLabel(date: Date, bucket: 'day' | 'month') {
    return bucket === 'day' ? this.formatDayUtc(date) : this.formatMonthUtc(date);
  }

  private formatDayUtc(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`;
  }

  private formatMonthUtc(date: Date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private startOfDayUtc(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}
