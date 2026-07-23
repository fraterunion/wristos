import { Injectable } from '@nestjs/common';
import {
  DealStage,
  OperatingExpenseCategory,
  PaymentStatus,
  Prisma,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TreasuryService } from '../treasury/treasury.service';
import { AnalyticsPeriod } from './dto/analytics-period.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryService: TreasuryService,
  ) {}

  async getRevenueOverTime(tenantId: string, period: AnalyticsPeriod) {
    const { start, end, labels, bucket, weekBuckets } = this.buildSeriesWindow(period);
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
      const key = this.getBucketLabel(row.paidAt, bucket, weekBuckets);
      const current = sums.get(key) ?? 0;
      sums.set(key, current + Number(row.amount));
    }

    return labels.map((label) => ({
      label,
      revenue: Number((sums.get(label) ?? 0).toFixed(2)),
    }));
  }

  async getSalesOverTime(tenantId: string, period: AnalyticsPeriod) {
    const { start, end, labels, bucket, weekBuckets } = this.buildSeriesWindow(period);
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
      const key = this.getBucketLabel(row.updatedAt, bucket, weekBuckets);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return labels.map((label) => ({
      label,
      count: counts.get(label) ?? 0,
    }));
  }

  async getSummary(tenantId: string) {
    const now = new Date();
    // First day of the current calendar month in UTC — used for all "this month" KPIs.
    // Mirrors the soldAt field used by /history/sold, which is deal.updatedAt.
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const watchWhere: Prisma.WatchWhereInput = { tenantId, deletedAt: null };
    const dealWhere: Prisma.DealWhereInput = { tenantId, deletedAt: null };
    const paymentWhere: Prisma.PaymentWhereInput = { tenantId, deletedAt: null };
    // Revenue aggregate must include only closed sales — not open or lost pipeline.
    const wonDealWhere: Prisma.DealWhereInput = { ...dealWhere, stage: DealStage.CLOSED_WON };
    // Active inventory: everything a dealer still holds (excludes SOLD).
    const activeInventoryWhere: Prisma.WatchWhereInput = {
      ...watchWhere,
      status: { not: WatchStatus.SOLD },
    };

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
      receivableDeals,
      paidByDealRows,
      treasuryBalances,
      // ── New: this-month KPIs ─────────────────────────────────────────────
      salesThisMonthCountAgg,
      salesThisMonthRevenueAgg,
      dealsThisMonth,
      bankFeesThisMonthAgg,
    ] = await Promise.all([
      this.prisma.watch.count({ where: watchWhere }),
      this.prisma.watch.count({ where: { ...watchWhere, status: WatchStatus.AVAILABLE } }),
      this.prisma.watch.count({ where: { ...watchWhere, status: WatchStatus.RESERVED } }),
      this.prisma.watch.count({ where: { ...watchWhere, status: WatchStatus.SOLD } }),
      this.prisma.watch.count({
        where: { ...watchWhere, ownershipType: WatchOwnershipType.CONSIGNMENT },
      }),
      // Active inventory value: sum priceMin for watches not yet SOLD.
      this.prisma.watch.aggregate({
        where: activeInventoryWhere,
        _sum: { priceMin: true, cost: true },
      }),
      this.prisma.client.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.deal.count({ where: dealWhere }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: dealWhere,
        _count: { _all: true },
      }),
      // All-time agreed revenue: CLOSED_WON deals only
      this.prisma.deal.aggregate({ where: wonDealWhere, _sum: { agreedPrice: true } }),
      // All-time collected revenue: all PAID payments
      this.prisma.payment.aggregate({
        where: { ...paymentWhere, status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
      // Accounts receivable: CLOSED_WON + PENDING_PAYMENT deals with outstanding balance
      this.prisma.deal.findMany({
        where: {
          ...dealWhere,
          stage: { in: [DealStage.CLOSED_WON, DealStage.PENDING_PAYMENT] },
        },
        select: { id: true, agreedPrice: true },
      }),
      this.prisma.payment.groupBy({
        by: ['dealId'],
        where: { ...paymentWhere, status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
      this.treasuryService.getAccountBalances(tenantId),
      // ── Sales this month: count ───────────────────────────────────────────
      // deal.updatedAt is used as soldAt by /history/sold, so we match that field.
      this.prisma.deal.count({
        where: { ...wonDealWhere, updatedAt: { gte: monthStart } },
      }),
      // ── Sales this month: revenue ─────────────────────────────────────────
      this.prisma.deal.aggregate({
        where: { ...wonDealWhere, updatedAt: { gte: monthStart } },
        _sum: { agreedPrice: true },
      }),
      // ── Cost of sold this month: need watch.cost + watch expenses ─────────
      // Same effective-cost pattern as history.service.ts getSummary().
      this.prisma.deal.findMany({
        where: { ...wonDealWhere, updatedAt: { gte: monthStart } },
        select: {
          watch: {
            select: {
              cost: true,
              expenses: { select: { amount: true } },
            },
          },
        },
      }),
      // ── Bank fees this month ──────────────────────────────────────────────
      this.prisma.operatingExpense.aggregate({
        where: {
          tenantId,
          category: OperatingExpenseCategory.BANK_FEES,
          expenseDate: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
    ]);

    // ── Accounts receivable: pending balance across all real-receivable deals ──
    const dealsByStage = this.buildDealStageCounts(dealsByStageRows);

    const paidMap = new Map<string, Prisma.Decimal>();
    for (const row of paidByDealRows) {
      paidMap.set(row.dealId, row._sum.amount ?? new Prisma.Decimal(0));
    }

    let totalPendingBalance = new Prisma.Decimal(0);
    for (const deal of receivableDeals) {
      const paid = paidMap.get(deal.id) ?? new Prisma.Decimal(0);
      const pending = deal.agreedPrice.minus(paid);
      if (pending.greaterThan(0)) {
        totalPendingBalance = totalPendingBalance.plus(pending);
      }
    }

    // ── Treasury ledger balances ──────────────────────────────────────────────
    const cashBalance = treasuryBalances.CASH;
    const bankBalance = treasuryBalances.BANK;
    const cesarBalance = treasuryBalances.CESAR;

    const zero = new Prisma.Decimal(0);

    // ── This-month sales KPIs ─────────────────────────────────────────────────
    const salesThisMonthRevenue = (
      salesThisMonthRevenueAgg._sum.agreedPrice ?? zero
    );

    const costOfSoldThisMonth = dealsThisMonth.reduce((sum, deal) => {
      const watchCost = Number(deal.watch.cost);
      const expenseSum = deal.watch.expenses.reduce(
        (es, e) => es + Number(e.amount),
        0,
      );
      return sum + watchCost + expenseSum;
    }, 0);

    const bankFeesThisMonthDecimal = bankFeesThisMonthAgg._sum.amount ?? zero;

    const profitThisMonth = salesThisMonthRevenue
      .minus(new Prisma.Decimal(costOfSoldThisMonth))
      .minus(bankFeesThisMonthDecimal);

    return {
      // ── Existing fields (backwards-compatible) ──────────────────────────────
      totalWatches,
      availableWatches,
      reservedWatches,
      soldWatches,
      consignmentWatches,
      // totalInventoryValue now reflects active (non-SOLD) inventory only
      totalInventoryValue: (inventorySums._sum.priceMin ?? zero).toString(),
      totalInventoryCost:  (inventorySums._sum.cost    ?? zero).toString(),
      activeClients,
      totalDeals,
      dealsByStage,
      totalAgreedRevenue: (
        totalAgreedRevenueAgg._sum.agreedPrice ?? zero
      ).toString(),
      totalCollectedRevenue: (
        totalCollectedRevenueAgg._sum.amount ?? zero
      ).toString(),
      totalPendingBalance: totalPendingBalance.toString(),
      // ── Treasury ledger balances (MXN) ─────────────────────────────────────
      cashBalance,
      bankBalance,
      cesarBalance,
      // ── New: accounts payable — no schema yet; placeholder ─────────────────
      accountsPayable: '0',
      // ── New: this-month KPIs ───────────────────────────────────────────────
      salesThisMonthCount:   salesThisMonthCountAgg,
      salesThisMonthRevenue: salesThisMonthRevenue.toString(),
      costOfSoldThisMonth:   costOfSoldThisMonth.toFixed(2),
      bankFeesThisMonth:     bankFeesThisMonthDecimal.toString(),
      profitThisMonth:       profitThisMonth.toString(),
    };
  }

  async getInventoryByBrand(tenantId: string) {
    const watches = await this.prisma.watch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { not: WatchStatus.SOLD },
      },
      select: {
        brand: true,
        priceMin: true,
      },
    });

    const byBrand = new Map<string, { count: number; value: Prisma.Decimal }>();
    const zero = new Prisma.Decimal(0);

    for (const watch of watches) {
      const brand = watch.brand ?? '—';
      const current = byBrand.get(brand) ?? { count: 0, value: zero };
      current.count += 1;
      current.value = current.value.plus(watch.priceMin ?? 0);
      byBrand.set(brand, current);
    }

    return Array.from(byBrand.entries())
      .map(([brand, { count, value }]) => ({
        brand,
        count,
        inventoryValue: value.toString(),
      }))
      .sort((a, b) => Number(b.inventoryValue) - Number(a.inventoryValue));
  }

  async getSalesByBrand(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
      },
      select: {
        agreedPrice: true,
        watch: { select: { brand: true } },
      },
    });

    const byBrand = new Map<string, { count: number; revenue: Prisma.Decimal }>();
    const zero = new Prisma.Decimal(0);

    for (const deal of deals) {
      const brand = deal.watch.brand ?? '—';
      const current = byBrand.get(brand) ?? { count: 0, revenue: zero };
      current.count += 1;
      current.revenue = current.revenue.plus(deal.agreedPrice);
      byBrand.set(brand, current);
    }

    return Array.from(byBrand.entries())
      .map(([brand, { count, revenue }]) => ({
        brand,
        count,
        revenue: revenue.toString(),
      }))
      .sort((a, b) => b.count - a.count);
  }

  async getTopModels(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
      },
      select: {
        watch: { select: { model: true } },
      },
    });

    const byModel = new Map<string, number>();
    for (const deal of deals) {
      const model = deal.watch.model ?? '—';
      byModel.set(model, (byModel.get(model) ?? 0) + 1);
    }

    return Array.from(byModel.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
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

  private buildSeriesWindow(period: AnalyticsPeriod): {
    start: Date;
    end: Date;
    labels: string[];
    bucket: 'day' | 'week' | 'month';
    weekBuckets?: Array<{ label: string; from: Date; to: Date }>;
  } {
    const now = new Date();
    const today = this.startOfDayUtc(now);

    if (period === AnalyticsPeriod.YEAR) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
      const labels: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
        labels.push(this.formatMonthUtc(d));
      }
      return { start, end: now, labels, bucket: 'month' };
    }

    if (period === AnalyticsPeriod.MONTH) {
      // 30-day window split into up to 5 weekly buckets
      const days = 30;
      const start = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - (days - 1),
      ));

      const weekBuckets: Array<{ label: string; from: Date; to: Date }> = [];
      for (let w = 0; w < 5; w++) {
        const fromDate = new Date(Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate() + w * 7,
        ));
        // Last week may be shorter than 7 days
        const toRaw = new Date(Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate() + Math.min((w + 1) * 7 - 1, days - 1),
        ));
        // Cap to end of that day (inclusive)
        const toDate = new Date(Date.UTC(
          toRaw.getUTCFullYear(),
          toRaw.getUTCMonth(),
          toRaw.getUTCDate(),
          23, 59, 59, 999,
        ));

        weekBuckets.push({
          label: this.formatWeekLabel(fromDate, toRaw),
          from: fromDate,
          to: toDate,
        });
      }

      return {
        start,
        end: now,
        labels: weekBuckets.map((w) => w.label),
        bucket: 'week',
        weekBuckets,
      };
    }

    // WEEK: last 7 days, one bucket per day
    const start = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - 6,
    ));
    const labels: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate() + i,
      ));
      labels.push(this.formatDayUtc(d));
    }
    return { start, end: now, labels, bucket: 'day' };
  }

  private getBucketLabel(
    date: Date,
    bucket: 'day' | 'week' | 'month',
    weekBuckets?: Array<{ label: string; from: Date; to: Date }>,
  ): string {
    if (bucket === 'day') return this.formatDayUtc(date);
    if (bucket === 'month') return this.formatMonthUtc(date);
    // week: find which bucket this date falls into
    const wb = weekBuckets?.find((w) => date >= w.from && date <= w.to);
    return wb?.label ?? (weekBuckets?.[weekBuckets.length - 1]?.label ?? this.formatDayUtc(date));
  }

  private formatWeekLabel(from: Date, to: Date): string {
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const fromMonth = MONTHS[from.getUTCMonth()];
    const toMonth   = MONTHS[to.getUTCMonth()];
    const fromDay   = from.getUTCDate();
    const toDay     = to.getUTCDate();
    if (fromMonth === toMonth) {
      return `${fromMonth} ${fromDay}–${toDay}`;
    }
    return `${fromMonth} ${fromDay}–${toMonth} ${toDay}`;
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
