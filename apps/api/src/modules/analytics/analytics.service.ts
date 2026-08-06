import { Injectable } from '@nestjs/common';
import {
  DealStage,
  PaymentStatus,
  Prisma,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import {
  dealEffectiveSaleDateRangeWhere,
  effectiveSaleDate,
} from '../../common/utils/effective-sale-date';
import { PrismaService } from '../../prisma/prisma.service';
import { isSettledHistoricalSaleSnapshot } from '../history/historical-watch-snapshot';
import {
  resolveBrandAggregationLabel,
  resolveDealWatchIdentity,
  resolveModelAggregationLabel,
  watchLabelGroupKey,
} from '../history/historical-watch-snapshot';
import { CryptoService } from '../crypto/crypto.service';
import { TreasuryService } from '../treasury/treasury.service';
import {
  buildCalendarPeriodWindow,
  getCalendarBucketLabel,
  startOfDayUtc,
} from './calendar-period';
import { AnalyticsPeriod } from './dto/analytics-period.dto';
import { TimelineGranularityParam } from './dto/sales-timeline.dto';
import {
  aggregateSalesTimeline,
  alignRangeForGranularity,
  bucketContaining,
  parseUtcDateOnly,
  shiftBucketStart,
  type TimelineGranularity,
} from './sales-timeline';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly treasuryService: TreasuryService,
    private readonly cryptoService: CryptoService,
  ) {}

  /**
   * Shared sales timeline for revenue + sold-watch charts.
   * CLOSED_WON deals only; buckets by effectiveSaleDate (UTC). No Payment dependency.
   *
   * Complexity: O(D + B) where D = deals in range, B = buckets.
   * Single tenant-scoped findMany — acceptable for current migrated volume (~469).
   */
  async getSalesTimeline(
    tenantId: string,
    granularity: TimelineGranularityParam | TimelineGranularity,
    from?: string,
    to?: string,
  ) {
    const g = granularity as TimelineGranularity;
    const now = new Date();
    const today = startOfDayUtc(now);
    const tomorrow = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1),
    );

    const parsedFrom = from ? parseUtcDateOnly(from) : null;
    const parsedToInclusive = to ? parseUtcDateOnly(to) : null;

    // Load CLOSED_WON deals once (full history when range omitted; filtered when provided).
    const rangeStartHint = parsedFrom ?? new Date(Date.UTC(2000, 0, 1));
    const rangeEndHint = parsedToInclusive
      ? new Date(
          Date.UTC(
            parsedToInclusive.getUTCFullYear(),
            parsedToInclusive.getUTCMonth(),
            parsedToInclusive.getUTCDate() + 1,
          ),
        )
      : tomorrow;

    const rows = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
        AND: [dealEffectiveSaleDateRangeWhere(rangeStartHint, rangeEndHint)],
      },
      select: {
        agreedPrice: true,
        soldAt: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const deals = rows.map((row) => ({
      agreedPrice: row.agreedPrice,
      saleDate: effectiveSaleDate(row),
    }));

    let fromInclusive: Date;
    let toExclusive: Date;

    if (parsedFrom && parsedToInclusive) {
      const aligned = alignRangeForGranularity(
        g,
        parsedFrom,
        new Date(
          Date.UTC(
            parsedToInclusive.getUTCFullYear(),
            parsedToInclusive.getUTCMonth(),
            parsedToInclusive.getUTCDate() + 1,
          ),
        ),
      );
      fromInclusive = aligned.fromInclusive;
      toExclusive = aligned.toExclusive;
    } else if (deals.length === 0) {
      // Empty tenant — return a default recent window of empty buckets
      const latest = bucketContaining(today, g);
      const defaultCount =
        g === 'day' ? 30 : g === 'week' ? 16 : g === 'month' ? 12 : 6;
      fromInclusive = shiftBucketStart(latest.startDate, g, -(defaultCount - 1));
      toExclusive = latest.endExclusive;
    } else {
      let minDate = deals[0]!.saleDate;
      let maxDate = deals[0]!.saleDate;
      for (const d of deals) {
        if (d.saleDate < minDate) minDate = d.saleDate;
        if (d.saleDate > maxDate) maxDate = d.saleDate;
      }
      const earliest = bucketContaining(minDate, g).startDate;
      const latestEnd = bucketContaining(
        maxDate > today ? maxDate : today,
        g,
      ).endExclusive;
      fromInclusive = earliest;
      toExclusive = latestEnd;
    }

    return aggregateSalesTimeline({
      granularity: g,
      fromInclusive,
      toExclusive,
      deals,
    });
  }

  /**
   * Sales revenue over time — Deal.agreedPrice by effectiveSaleDate.
   * Does NOT use Payment rows (migrated historical sales have none).
   */
  async getRevenueOverTime(tenantId: string, period: AnalyticsPeriod) {
    const { start, endExclusive, labels, bucket, weekBuckets } =
      buildCalendarPeriodWindow(period);

    const rows = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
        AND: [dealEffectiveSaleDateRangeWhere(start, endExclusive)],
      },
      select: {
        agreedPrice: true,
        soldAt: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const sums = new Map<string, number>();
    for (const row of rows) {
      const saleDate = effectiveSaleDate(row);
      if (saleDate < start || saleDate >= endExclusive) continue;
      const key = getCalendarBucketLabel(saleDate, bucket, weekBuckets);
      sums.set(key, (sums.get(key) ?? 0) + Number(row.agreedPrice));
    }

    return labels.map((label) => ({
      label,
      revenue: Number((sums.get(label) ?? 0).toFixed(2)),
    }));
  }

  /**
   * Sold-watch counts over time — same Deal population / calendar windows as revenue.
   */
  async getSalesOverTime(tenantId: string, period: AnalyticsPeriod) {
    const { start, endExclusive, labels, bucket, weekBuckets } =
      buildCalendarPeriodWindow(period);

    const rows = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
        AND: [dealEffectiveSaleDateRangeWhere(start, endExclusive)],
      },
      select: {
        soldAt: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const saleDate = effectiveSaleDate(row);
      if (saleDate < start || saleDate >= endExclusive) continue;
      const key = getCalendarBucketLabel(saleDate, bucket, weekBuckets);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return labels.map((label) => ({
      label,
      count: counts.get(label) ?? 0,
    }));
  }

  /**
   * Period Treasury cash flow (CASH + BANK + CESAR).
   * Uses amountMxn only — commission is already embedded in OUTFLOW amounts and
   * is informational on INFLOW (gross deposit); never added separately.
   */
  async getCashFlow(tenantId: string, period: AnalyticsPeriod) {
    const { start, endExclusive, periodLabel } = buildCalendarPeriodWindow(period);

    const groups = await this.prisma.treasuryEntry.groupBy({
      by: ['direction'],
      where: {
        tenantId,
        deletedAt: null,
        account: { in: ['CASH', 'BANK', 'CESAR'] },
        transactionDate: { gte: start, lt: endExclusive },
      },
      _sum: { amountMxn: true },
    });

    let inflows = new Prisma.Decimal(0);
    let outflows = new Prisma.Decimal(0);
    for (const row of groups) {
      const sum = row._sum.amountMxn ?? new Prisma.Decimal(0);
      if (row.direction === 'INFLOW') inflows = inflows.plus(sum);
      else outflows = outflows.plus(sum);
    }
    const net = inflows.minus(outflows);

    return {
      period,
      periodLabel,
      periodStart: start.toISOString(),
      periodEndExclusive: endExclusive.toISOString(),
      inflows: inflows.toFixed(2),
      outflows: outflows.toFixed(2),
      net: net.toFixed(2),
    };
  }

  async getSummary(tenantId: string) {
    const now = new Date();
    // First day of the current calendar month in UTC — used for all "this month" KPIs.
    // Attribution uses effectiveSaleDate = soldAt ?? updatedAt ?? createdAt.
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const soldThisMonthWhere = dealEffectiveSaleDateRangeWhere(monthStart, nextMonthStart);

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
      bankCommissionsThisMonthAgg,
      bankCommissionMovementCountThisMonth,
      bankCommissionsAllTimeAgg,
      bankCommissionMovementCountAllTime,
      operatingExpensesThisMonthAgg,
      cryptoValuation,
    ] = await Promise.all([
      this.prisma.watch.count({ where: watchWhere }),
      this.prisma.watch.count({ where: { ...watchWhere, status: WatchStatus.AVAILABLE } }),
      this.prisma.watch.count({ where: { ...watchWhere, status: WatchStatus.RESERVED } }),
      this.prisma.watch.count({ where: { ...watchWhere, status: WatchStatus.SOLD } }),
      this.prisma.watch.count({
        where: { ...watchWhere, ownershipType: WatchOwnershipType.CONSIGNMENT },
      }),
      // Active inventory value: SUM(acquisition cost) for watches not yet SOLD.
      this.prisma.watch.aggregate({
        where: activeInventoryWhere,
        _sum: { cost: true },
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
      // Accounts receivable: CLOSED_WON + PENDING_PAYMENT deals with outstanding balance.
      // Workbook historical snapshots (no Payment rows) are excluded in the loop below —
      // open AR for those tenants lives in CXC / AccountEntry RECEIVABLE, not on Deal.
      this.prisma.deal.findMany({
        where: {
          ...dealWhere,
          stage: { in: [DealStage.CLOSED_WON, DealStage.PENDING_PAYMENT] },
        },
        select: {
          id: true,
          agreedPrice: true,
          sourceTag: true,
          importSessionId: true,
          _count: { select: { payments: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.payment.groupBy({
        by: ['dealId'],
        where: { ...paymentWhere, status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
      this.treasuryService.getAccountBalances(tenantId),
      // ── Sales this month: count ───────────────────────────────────────────
      this.prisma.deal.count({
        where: { ...wonDealWhere, AND: [soldThisMonthWhere] },
      }),
      // ── Sales this month: revenue ─────────────────────────────────────────
      this.prisma.deal.aggregate({
        where: { ...wonDealWhere, AND: [soldThisMonthWhere] },
        _sum: { agreedPrice: true },
      }),
      // ── Cost of sold this month: need watch.cost + watch expenses ─────────
      // Same effective-cost pattern as history.service.ts getSummary().
      // Historical sales without a watch use deal.historicalCost.
      this.prisma.deal.findMany({
        where: { ...wonDealWhere, AND: [soldThisMonthWhere] },
        select: {
          historicalCost: true,
          watch: {
            select: {
              cost: true,
              expenses: { select: { amount: true } },
            },
          },
        },
      }),
      // ── Bank commissions this month (structured TreasuryEntry.commission) ──
      this.prisma.treasuryEntry.aggregate({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
          transactionDate: { gte: monthStart, lt: nextMonthStart },
        },
        _sum: { commission: true },
      }),
      this.prisma.treasuryEntry.count({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
          transactionDate: { gte: monthStart, lt: nextMonthStart },
        },
      }),
      this.prisma.treasuryEntry.aggregate({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
        },
        _sum: { commission: true },
      }),
      this.prisma.treasuryEntry.count({
        where: {
          tenantId,
          account: 'BANK',
          deletedAt: null,
          commission: { gt: 0 },
        },
      }),
      // ── Operating expenses this month (GASTOS) — all categories by expenseDate ──
      // Includes OpEx COMMISSIONS (e.g. agent/Lafaurie). Distinct from Treasury
      // bank commissions (CONTROL BANCOS), which are subtracted separately above.
      this.prisma.operatingExpense.aggregate({
        where: {
          tenantId,
          expenseDate: { gte: monthStart, lt: nextMonthStart },
        },
        _sum: { amount: true },
      }),
      // Crypto mark-to-market (priced holdings only). Does not touch Treasury.
      this.cryptoService.getPortfolioValuation(tenantId, now),
    ]);

    // ── Accounts receivable: pending balance across all real-receivable deals ──
    const dealsByStage = this.buildDealStageCounts(dealsByStageRows);

    const paidMap = new Map<string, Prisma.Decimal>();
    for (const row of paidByDealRows) {
      paidMap.set(row.dealId, row._sum.amount ?? new Prisma.Decimal(0));
    }

    let totalPendingBalance = new Prisma.Decimal(0);
    for (const deal of receivableDeals) {
      // Settled historical snapshots are not live receivables (CXC owns open AR).
      if (
        isSettledHistoricalSaleSnapshot({
          sourceTag: deal.sourceTag,
          importSessionId: deal.importSessionId,
          paymentCount: deal._count.payments,
        })
      ) {
        continue;
      }
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
      if (!deal.watch) {
        return sum + Number(deal.historicalCost ?? 0);
      }
      const watchCost = Number(deal.watch.cost);
      const expenseSum = deal.watch.expenses.reduce(
        (es, e) => es + Number(e.amount),
        0,
      );
      return sum + watchCost + expenseSum;
    }, 0);

    const bankCommissionsThisMonthDecimal =
      bankCommissionsThisMonthAgg._sum.commission ?? zero;
    const bankCommissionsAllTimeDecimal =
      bankCommissionsAllTimeAgg._sum.commission ?? zero;
    const operatingExpensesThisMonthDecimal =
      operatingExpensesThisMonthAgg._sum.amount ?? zero;

    // Utilidad del mes = revenue − COGS − treasury bank commissions − OpEx (same UTC month).
    const profitThisMonth = salesThisMonthRevenue
      .minus(new Prisma.Decimal(costOfSoldThisMonth))
      .minus(bankCommissionsThisMonthDecimal)
      .minus(operatingExpensesThisMonthDecimal);

    return {
      // ── Existing fields (backwards-compatible) ──────────────────────────────
      totalWatches,
      availableWatches,
      reservedWatches,
      soldWatches,
      consignmentWatches,
      // Inventory value = SUM(watch.cost) for active (non-SOLD) inventory only.
      // cost is already stored in MXN; null cost contributes 0 via Prisma _sum.
      totalInventoryValue: (inventorySums._sum.cost ?? zero).toString(),
      totalInventoryCost: (inventorySums._sum.cost ?? zero).toString(),
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
      // ── Crypto (mark-to-market; excluded from profit / cash flow) ──────────
      cryptoValueMxn: cryptoValuation.totalCurrentValueMxn,
      cryptoCostBasisMxn: cryptoValuation.totalCostBasisMxn,
      cryptoUnrealizedPnlMxn: cryptoValuation.unrealizedPnlMxn,
      cryptoUnrealizedPnlPercent: cryptoValuation.unrealizedPnlPercent,
      cryptoPriceStatus: cryptoValuation.cryptoPriceStatus,
      cryptoOldestPriceCapturedAt: cryptoValuation.oldestPriceCapturedAt,
      cryptoNewestPriceCapturedAt: cryptoValuation.newestPriceCapturedAt,
      cryptoMissingPriceTickers: cryptoValuation.missingPriceTickers,
      cryptoActiveHoldingCount: cryptoValuation.activeHoldingCount,
      cryptoUnpricedHoldingCount: cryptoValuation.unpricedHoldingCount,
      // ── New: accounts payable — no schema yet; placeholder ─────────────────
      accountsPayable: '0',
      // ── New: this-month KPIs ───────────────────────────────────────────────
      salesThisMonthCount:   salesThisMonthCountAgg,
      salesThisMonthRevenue: salesThisMonthRevenue.toString(),
      costOfSoldThisMonth:   costOfSoldThisMonth.toFixed(2),
      // bankFeesThisMonth kept for backwards compat — now Treasury commissions.
      bankFeesThisMonth: bankCommissionsThisMonthDecimal.toFixed(2),
      bankCommissionsThisMonth: bankCommissionsThisMonthDecimal.toFixed(2),
      bankCommissionMovementCountThisMonth,
      bankCommissionsAllTime: bankCommissionsAllTimeDecimal.toFixed(2),
      bankCommissionMovementCountAllTime,
      operatingExpensesThisMonth: operatingExpensesThisMonthDecimal.toFixed(2),
      profitThisMonth: profitThisMonth.toString(),
    };
  }

  async getLiquidity(tenantId: string, now: Date) {
    const [treasury, crypto] = await Promise.all([
      this.treasuryService.getAccountBalances(tenantId),
      this.cryptoService.getPortfolioValuation(tenantId, now),
    ]);
    const cash = new Prisma.Decimal(treasury.CASH);
    const bank = new Prisma.Decimal(treasury.BANK);
    const cesar = new Prisma.Decimal(treasury.CESAR);
    const cryptoValue = new Prisma.Decimal(crypto.totalCurrentValueMxn);
    const warnings: string[] = [];
    if (crypto.cryptoPriceStatus !== 'FRESH') warnings.push(`Crypto price status: ${crypto.cryptoPriceStatus}`);
    if (crypto.missingPriceTickers.length) warnings.push('Some crypto holdings have no current price');
    return {
      cashMxn: cash.toFixed(2), bankMxn: bank.toFixed(2), cryptoMxn: cryptoValue.toFixed(2), cesarMxn: cesar.toFixed(2),
      totalLiquidityMxn: cash.plus(bank).plus(cryptoValue).plus(cesar).toFixed(2),
      cryptoPriceStatus: crypto.cryptoPriceStatus,
      cryptoOldestPriceCapturedAt: crypto.oldestPriceCapturedAt,
      warnings,
    };
  }

  async getMonthlyProfit(tenantId: string, year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const range = dealEffectiveSaleDateRangeWhere(start, end);
    const [saleAgg, deals, commissionAgg, expenseAgg] = await Promise.all([
      this.prisma.deal.aggregate({ where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON, AND: [range] }, _sum: { agreedPrice: true }, _count: { _all: true } }),
      this.prisma.deal.findMany({ where: { tenantId, deletedAt: null, stage: DealStage.CLOSED_WON, AND: [range] }, select: { historicalCost: true, watch: { select: { cost: true, expenses: { select: { amount: true } } } } } }),
      this.prisma.treasuryEntry.aggregate({ where: { tenantId, account: 'BANK', deletedAt: null, commission: { gt: 0 }, transactionDate: { gte: start, lt: end } }, _sum: { commission: true } }),
      this.prisma.operatingExpense.aggregate({ where: { tenantId, expenseDate: { gte: start, lt: end } }, _sum: { amount: true } }),
    ]);
    const sales = saleAgg._sum.agreedPrice ?? new Prisma.Decimal(0);
    const cogs = deals.reduce((sum, deal) => {
      if (!deal.watch) return sum.plus(deal.historicalCost ?? 0);
      const watchExpenses = deal.watch.expenses.reduce(
        (expenseSum, expense) => expenseSum.plus(expense.amount),
        new Prisma.Decimal(0),
      );
      return sum.plus(deal.watch.cost ?? 0).plus(watchExpenses);
    }, new Prisma.Decimal(0));
    const commissions = commissionAgg._sum.commission ?? new Prisma.Decimal(0);
    const expenses = expenseAgg._sum.amount ?? new Prisma.Decimal(0);
    return { period: `${year}-${String(month).padStart(2, '0')}`, salesMxn: sales.toFixed(2), cogsMxn: cogs.toFixed(2), bankCommissionsMxn: commissions.toFixed(2), operatingExpensesMxn: expenses.toFixed(2), netProfitMxn: sales.minus(cogs).minus(commissions).minus(expenses).toFixed(2), saleCount: saleAgg._count._all };
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
        cost: true,
      },
    });

    const byBrand = new Map<string, { count: number; value: Prisma.Decimal }>();
    const zero = new Prisma.Decimal(0);

    for (const watch of watches) {
      const brand = watch.brand ?? '—';
      const current = byBrand.get(brand) ?? { count: 0, value: zero };
      current.count += 1;
      // Inventory value = SUM(cost); null cost contributes 0.
      current.value = current.value.plus(watch.cost ?? 0);
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

  /**
   * All-time CLOSED_WON sales by brand (accumulated histórico).
   * Uses linked Watch brand when present; otherwise historical notes snapshot.
   * Never emits "Histórico" as a brand.
   */
  async getSalesByBrand(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
      },
      select: {
        agreedPrice: true,
        notes: true,
        watch: { select: { brand: true, model: true } },
      },
    });

    type Bucket = { count: number; revenue: Prisma.Decimal; label: string };
    const byBrand = new Map<string, Bucket>();
    const zero = new Prisma.Decimal(0);

    for (const deal of deals) {
      const identity = resolveDealWatchIdentity(deal);
      const label = resolveBrandAggregationLabel(identity);
      const key = watchLabelGroupKey(label);
      const current = byBrand.get(key) ?? { count: 0, revenue: zero, label };
      current.count += 1;
      current.revenue = current.revenue.plus(deal.agreedPrice);
      byBrand.set(key, current);
    }

    return Array.from(byBrand.values())
      .map(({ label, count, revenue }) => ({
        brand: label,
        count,
        revenue: revenue.toString(),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * All-time top models sold (accumulated histórico).
   * Linked Watch model first; historical snapshot second; else "Sin modelo".
   */
  async getTopModels(tenantId: string) {
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
      },
      select: {
        notes: true,
        watch: { select: { brand: true, model: true } },
      },
    });

    const byModel = new Map<string, { count: number; label: string }>();
    for (const deal of deals) {
      const identity = resolveDealWatchIdentity(deal);
      const label = resolveModelAggregationLabel(identity);
      const key = watchLabelGroupKey(label);
      const current = byModel.get(key) ?? { count: 0, label };
      current.count += 1;
      byModel.set(key, current);
    }

    const total = deals.length;
    return Array.from(byModel.values())
      .map(({ label, count }) => ({
        model: label,
        count,
        percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
        totalSales: total,
      }))
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
}
