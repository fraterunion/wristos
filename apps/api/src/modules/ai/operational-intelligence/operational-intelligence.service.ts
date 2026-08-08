import { Injectable } from '@nestjs/common';
import {
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  DealStage,
  Prisma,
  WatchStatus,
} from '@prisma/client';
import { dealEffectiveSaleDateRangeWhere, effectiveSaleDate } from '../../../common/utils/effective-sale-date';
import { PrismaService } from '../../../prisma/prisma.service';
import { CuentasService } from '../../cuentas/cuentas.service';
import {
  ATTENTION_POLICY,
  ATTENTION_RULE_CATEGORY,
  AttentionCategory,
  AttentionRuleId,
  AttentionSeverity,
} from './attention-policy';
import { AnalyticsService } from '../../analytics/analytics.service';
import { InventoryService } from '../../inventory/inventory.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const ZERO = new Prisma.Decimal(0);

type ActiveWatchRow = {
  id: string;
  brand: string | null;
  model: string | null;
  reference: string | null;
  cost: Prisma.Decimal | null;
  status: WatchStatus;
  createdAt: Date;
  acquiredAt: Date | null;
};

function inventoryAgeAnchor(w: { acquiredAt?: Date | null; createdAt: Date }): Date {
  return w.acquiredAt ?? w.createdAt;
}

type DealMarginRow = {
  id?: string;
  agreedPrice: Prisma.Decimal;
  historicalCost: Prisma.Decimal | null;
  soldAt?: Date | null;
  updatedAt?: Date;
  createdAt?: Date | null;
  client?: { name: string };
  watch: {
    brand: string | null;
    model?: string | null;
    reference?: string | null;
    cost: Prisma.Decimal | null;
    expenses: { amount: Prisma.Decimal }[];
  } | null;
};


function money(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

function ageDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
}

function watchLabel(w: {
  brand: string | null;
  model?: string | null;
  reference?: string | null;
}): string {
  const parts = [w.brand, w.model, w.reference].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(' ') : 'Sin etiqueta';
}

function brandKey(brand: string | null | undefined): string {
  const raw = (brand ?? '').trim();
  return raw ? raw.toUpperCase() : 'SIN MARCA';
}

function brandLabel(brand: string | null | undefined): string {
  const raw = (brand ?? '').trim();
  return raw || 'Sin marca';
}

function periodBounds(
  now: Date,
  period: 'CURRENT_MONTH' | 'YEAR' | 'ALL' | 'CUSTOM',
  year?: number,
  month?: number,
): { start: Date | null; end: Date | null; label: string } {
  if (period === 'ALL') return { start: null, end: null, label: 'all-time' };
  if (period === 'YEAR') {
    const y = year ?? now.getUTCFullYear();
    return {
      start: new Date(Date.UTC(y, 0, 1)),
      end: new Date(Date.UTC(y + 1, 0, 1)),
      label: String(y),
    };
  }
  if (period === 'CUSTOM' && year != null && month != null) {
    return {
      start: new Date(Date.UTC(year, month - 1, 1)),
      end: new Date(Date.UTC(year, month, 1)),
      label: `${year}-${String(month).padStart(2, '0')}`,
    };
  }
  // CURRENT_MONTH (default)
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
    label: `${y}-${String(m).padStart(2, '0')}`,
  };
}

function dealCogs(deal: {
  historicalCost: Prisma.Decimal | null;
  watch: { cost: Prisma.Decimal | null; expenses: { amount: Prisma.Decimal }[] } | null;
}): Prisma.Decimal {
  if (!deal.watch) return new Prisma.Decimal(deal.historicalCost ?? 0);
  const expenses = deal.watch.expenses.reduce((s, e) => s.plus(e.amount), ZERO);
  return new Prisma.Decimal(deal.watch.cost ?? 0).plus(expenses);
}

export type SalesSortBy = 'GROSS_PROFIT' | 'AGREED_PRICE' | 'GROSS_MARGIN_PERCENT';

export interface AttentionItem {
  type: AttentionRuleId;
  category: AttentionCategory;
  severity: AttentionSeverity;
  title: string;
  explanation: string;
  evidence: Record<string, string | number | null>;
  suggestedReadAction?: string;
}

@Injectable()
export class OperationalIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cuentas: CuentasService,
    private readonly analytics: AnalyticsService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Inventory age for attention / aging.
   *
   * Prefer Watch.acquiredAt (canonical purchase date from REGISTER_PURCHASE).
   * Fallback: Watch.createdAt for legacy / inventory-only creates.
   *
   * Active inventory only: deletedAt null AND status ≠ SOLD.
   */
  async getInventoryAging(
    tenantId: string,
    args: { minAgeDays?: number; limit?: number; now?: Date } = {},
  ) {
    const now = args.now ?? new Date();
    const minAgeDays = Math.max(0, args.minAgeDays ?? 0);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

    const watches = (await this.prisma.watch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { not: WatchStatus.SOLD },
      },
      select: {
        id: true,
        brand: true,
        model: true,
        reference: true,
        cost: true,
        status: true,
        createdAt: true,
        acquiredAt: true,
      },
    })) as ActiveWatchRow[];

    const items = watches
      .map((w) => {
        const days = ageDays(inventoryAgeAnchor(w), now);
        const cost = new Prisma.Decimal(w.cost ?? 0);
        return {
          watchId: w.id,
          label: watchLabel(w),
          brand: w.brand,
          reference: w.reference,
          cost: money(cost),
          ageDays: days,
          status: w.status,
          _cost: cost,
        };
      })
      .filter((row) => row.ageDays >= minAgeDays)
      .sort((a, b) => {
        if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
        const costCmp = b._cost.comparedTo(a._cost);
        if (costCmp !== 0) return costCmp;
        return a.watchId.localeCompare(b.watchId);
      });

    const sliced = items.slice(0, limit);
    const totalCapitalAtRisk = items.reduce((s, row) => s.plus(row._cost), ZERO);

    return {
      asOf: now.toISOString(),
      ageSource: 'Watch.acquiredAt|createdAt' as const,
      ageMetric: 'inventory_acquisition_age' as const,
      ageSourceNote:
        'Prefer Watch.acquiredAt (canonical purchase date). Fallback Watch.createdAt for legacy inventory-only rows.',
      minAgeDays,
      items: sliced.map((row) => { const { _cost, ...rest } = row; void _cost; return rest; }),
      totalCapitalAtRisk: money(totalCapitalAtRisk),
      count: items.length,
    };
  }

  async getTopInventoryCapital(
    tenantId: string,
    args: { limit?: number; now?: Date } = {},
  ) {
    const now = args.now ?? new Date();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);

    const watches = (await this.prisma.watch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { not: WatchStatus.SOLD },
      },
      select: {
        id: true,
        brand: true,
        model: true,
        reference: true,
        cost: true,
        status: true,
        createdAt: true,
        acquiredAt: true,
      },
    })) as ActiveWatchRow[];

    const totalCapital = watches.reduce(
      (s, w) => s.plus(w.cost ?? 0),
      ZERO,
    );

    const ranked = watches
      .map((w) => {
        const cost = new Prisma.Decimal(w.cost ?? 0);
        const pct = totalCapital.gt(0)
          ? cost.div(totalCapital).mul(100)
          : ZERO;
        return {
          watchId: w.id,
          label: watchLabel(w),
          brand: w.brand,
          reference: w.reference,
          cost: money(cost),
          percentOfActiveInventoryCapital: pct.toFixed(2),
          ageDays: ageDays(inventoryAgeAnchor(w), now),
          status: w.status,
          _cost: cost,
        };
      })
      .sort((a: { _cost: Prisma.Decimal; watchId: string }, b: { _cost: Prisma.Decimal; watchId: string }) => {
        const cmp = b._cost.comparedTo(a._cost);
        if (cmp !== 0) return cmp;
        return a.watchId.localeCompare(b.watchId);
      })
      .slice(0, limit)
      .map((row) => { const { _cost, ...rest } = row; void _cost; return rest; });

    return {
      asOf: now.toISOString(),
      totalActiveInventoryCapital: money(totalCapital),
      items: ranked,
      count: ranked.length,
      concentrationFormula: 'item cost / total active inventory cost',
    };
  }

  /**
   * Currency-separated top debtors via canonical CuentasService.
   * Never mixes MXN + USD without FX.
   */
  async getTopDebtors(tenantId: string, args: { limit?: number } = {}) {
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const rows = await this.cuentas.getTopDebtors(tenantId, limit * 2);

    const currencies: Record<'MXN' | 'USD', Array<{
      clientId: string | null;
      clientLabel: string;
      outstanding: string;
      openAccountCount: number;
    }>> = { MXN: [], USD: [] };

    for (const row of rows) {
      const currency = row.currency === 'USD' ? 'USD' : 'MXN';
      currencies[currency].push({
        clientId: row.clientId,
        clientLabel: row.counterpartyName,
        outstanding: row.outstanding,
        openAccountCount: row.openAccounts,
      });
    }

    currencies.MXN = currencies.MXN.slice(0, limit);
    currencies.USD = currencies.USD.slice(0, limit);

    const totals = {
      MXN: money(currencies.MXN.reduce((s, r) => s.plus(r.outstanding), ZERO)),
      USD: money(currencies.USD.reduce((s, r) => s.plus(r.outstanding), ZERO)),
    };

    return { currencies, totals, limit };
  }

  /**
   * AccountEntry / AccountPayment only — never legacy Receivable.
   * No aging buckets (date policy not validated for CXC aging in V1).
   */
  async getReceivableSummary(tenantId: string) {
    const entries = await this.prisma.accountEntry.findMany({
      where: {
        tenantId,
        deletedAt: null,
        type: AccountEntryType.RECEIVABLE,
      },
      include: {
        payments: { where: { deletedAt: null } },
        deal: {
          select: {
            id: true,
            payments: {
              where: { deletedAt: null, status: 'PAID' },
              select: { amount: true },
            },
          },
        },
      },
    });

    const byCurrency: Record<
      'MXN' | 'USD',
      {
        originalTotal: Prisma.Decimal;
        paidTotal: Prisma.Decimal;
        outstanding: Prisma.Decimal;
        openCount: number;
        partialCount: number;
        paidCount: number;
        activeAccountCount: number;
      }
    > = {
      MXN: {
        originalTotal: ZERO,
        paidTotal: ZERO,
        outstanding: ZERO,
        openCount: 0,
        partialCount: 0,
        paidCount: 0,
        activeAccountCount: 0,
      },
      USD: {
        originalTotal: ZERO,
        paidTotal: ZERO,
        outstanding: ZERO,
        openCount: 0,
        partialCount: 0,
        paidCount: 0,
        activeAccountCount: 0,
      },
    };

    for (const entry of entries) {
      const currency = entry.currency === Currency.USD ? 'USD' : 'MXN';
      const bucket = byCurrency[currency];
      const total = new Prisma.Decimal(entry.totalAmount);

      // Deal-linked: Σ Deal.Payment + Σ AccountPayment (no double-write of one event).
      const accountPaid = entry.payments.reduce(
        (s: Prisma.Decimal, p: { amount: Prisma.Decimal }) => s.plus(p.amount),
        ZERO,
      );
      const dealPaid =
        entry.dealId && entry.deal
          ? entry.deal.payments.reduce(
              (s: Prisma.Decimal, p: { amount: Prisma.Decimal }) => s.plus(p.amount),
              ZERO,
            )
          : ZERO;
      const paid = dealPaid.plus(accountPaid);
      const outstanding = total.minus(paid);
      if (outstanding.lt(0)) continue;

      bucket.originalTotal = bucket.originalTotal.plus(total);
      bucket.paidTotal = bucket.paidTotal.plus(Prisma.Decimal.min(paid, total));
      bucket.outstanding = bucket.outstanding.plus(outstanding);

      if (entry.status === AccountEntryStatus.CANCELLED) continue;

      if (outstanding.lte(0) || entry.status === AccountEntryStatus.PAID) {
        bucket.paidCount += 1;
        continue;
      }

      bucket.activeAccountCount += 1;
      if (paid.gt(0) || entry.status === AccountEntryStatus.PARTIAL) {
        bucket.partialCount += 1;
      } else {
        bucket.openCount += 1;
      }
    }

    const serialize = (b: (typeof byCurrency)['MXN']) => ({
      originalTotal: money(b.originalTotal),
      paidTotal: money(b.paidTotal),
      outstanding: money(b.outstanding),
      openCount: b.openCount,
      partialCount: b.partialCount,
      paidCount: b.paidCount,
      activeAccountCount: b.activeAccountCount,
    });

    return {
      currencies: {
        MXN: serialize(byCurrency.MXN),
        USD: serialize(byCurrency.USD),
      },
      source: 'AccountEntry+AccountPayment' as const,
      agingIncluded: false,
    };
  }

  /**
   * Gross margin = revenue − COGS (watch cost + WatchExpense, or historicalCost).
   * Does NOT subtract bank commissions or OpEx — that is GET_MONTHLY_PROFIT (net).
   */
  async getSalesMarginSummary(
    tenantId: string,
    args: {
      period?: 'CURRENT_MONTH' | 'YEAR' | 'ALL' | 'CUSTOM';
      year?: number;
      month?: number;
      brand?: string;
      now?: Date;
    } = {},
  ) {
    const now = args.now ?? new Date();
    const period = args.period ?? 'CURRENT_MONTH';
    const bounds = periodBounds(now, period, args.year, args.month);
    const brandFilter = args.brand ? brandKey(args.brand) : null;

    const where: Prisma.DealWhereInput = {
      tenantId,
      deletedAt: null,
      stage: DealStage.CLOSED_WON,
      ...(bounds.start && bounds.end
        ? { AND: [dealEffectiveSaleDateRangeWhere(bounds.start, bounds.end)] }
        : {}),
    };

    const deals = await this.prisma.deal.findMany({
      where,
      select: {
        id: true,
        agreedPrice: true,
        historicalCost: true,
        soldAt: true,
        updatedAt: true,
        createdAt: true,
        watch: {
          select: {
            brand: true,
            cost: true,
            expenses: { select: { amount: true } },
          },
        },
      },
    });

    let filtered: DealMarginRow[] = deals as DealMarginRow[];
    if (brandFilter) {
      filtered = filtered.filter((d: DealMarginRow) => brandKey(d.watch?.brand) === brandFilter);
    }

    let revenue = ZERO;
    let cogs = ZERO;
    for (const deal of filtered) {
      revenue = revenue.plus(deal.agreedPrice);
      cogs = cogs.plus(dealCogs(deal));
    }
    const unitsSold = filtered.length;
    const grossProfit = revenue.minus(cogs);
    const grossMarginPercent = revenue.gt(0)
      ? grossProfit.div(revenue).mul(100)
      : ZERO;

    return {
      period: bounds.label,
      brand: args.brand ? brandLabel(args.brand) : null,
      revenue: money(revenue),
      cogs: money(cogs),
      grossProfit: money(grossProfit),
      grossMarginPercent: grossMarginPercent.toFixed(2),
      unitsSold,
      averageSalePrice: unitsSold > 0 ? money(revenue.div(unitsSold)) : money(0),
      averageGrossProfit: unitsSold > 0 ? money(grossProfit.div(unitsSold)) : money(0),
      definition:
        'Gross margin = sale revenue − COGS. Excludes bank commissions and operating expenses. For net profit use GET_MONTHLY_PROFIT.',
    };
  }

  /**
   * Gross profit by brand from canonical realized sales only:
   * - Deal.stage = CLOSED_WON
   * - revenue = Deal.agreedPrice (actual agreed sale price)
   * - COGS = watch.cost + WatchExpense, else historicalCost
   *
   * Must NOT use asking price, inventory market value, crypto/FX assumptions,
   * estimated future sale value, or unsold inventory. Unsold watches never
   * appear because the query is deal-scoped CLOSED_WON only.
   */
  async getProfitByBrand(
    tenantId: string,
    args: {
      period?: 'CURRENT_MONTH' | 'YEAR' | 'ALL' | 'CUSTOM';
      year?: number;
      month?: number;
      brand?: string;
      limit?: number;
      now?: Date;
    } = {},
  ) {
    const now = args.now ?? new Date();
    const period = args.period ?? 'CURRENT_MONTH';
    const bounds = periodBounds(now, period, args.year, args.month);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const brandFilter = args.brand ? brandKey(args.brand) : null;

    const where: Prisma.DealWhereInput = {
      tenantId,
      deletedAt: null,
      stage: DealStage.CLOSED_WON,
      ...(bounds.start && bounds.end
        ? { AND: [dealEffectiveSaleDateRangeWhere(bounds.start, bounds.end)] }
        : {}),
    };

    const deals = await this.prisma.deal.findMany({
      where,
      select: {
        agreedPrice: true,
        historicalCost: true,
        watch: {
          select: {
            brand: true,
            cost: true,
            expenses: { select: { amount: true } },
          },
        },
      },
    });

    type Bucket = {
      brand: string;
      unitsSold: number;
      revenue: Prisma.Decimal;
      cogs: Prisma.Decimal;
    };
    const map = new Map<string, Bucket>();

    for (const deal of deals) {
      const key = brandKey(deal.watch?.brand);
      if (brandFilter && key !== brandFilter) continue;
      const label = brandLabel(deal.watch?.brand);
      const bucket = map.get(key) ?? {
        brand: label,
        unitsSold: 0,
        revenue: ZERO,
        cogs: ZERO,
      };
      bucket.unitsSold += 1;
      bucket.revenue = bucket.revenue.plus(deal.agreedPrice);
      bucket.cogs = bucket.cogs.plus(dealCogs(deal));
      map.set(key, bucket);
    }

    const items = [...map.values()]
      .map((b) => {
        const grossProfit = b.revenue.minus(b.cogs);
        const grossMarginPercent = b.revenue.gt(0)
          ? grossProfit.div(b.revenue).mul(100)
          : ZERO;
        return {
          brand: b.brand,
          unitsSold: b.unitsSold,
          revenue: money(b.revenue),
          cogs: money(b.cogs),
          grossProfit: money(grossProfit),
          grossMarginPercent: grossMarginPercent.toFixed(2),
          averageProfitPerWatch:
            b.unitsSold > 0 ? money(grossProfit.div(b.unitsSold)) : money(0),
          _grossProfit: grossProfit,
        };
      })
      .sort((a: { _grossProfit: Prisma.Decimal; brand: string }, b: { _grossProfit: Prisma.Decimal; brand: string }) => {
        const cmp = b._grossProfit.comparedTo(a._grossProfit);
        if (cmp !== 0) return cmp;
        return a.brand.localeCompare(b.brand);
      })
      .slice(0, limit)
      .map((row: { _grossProfit: Prisma.Decimal; brand: string; unitsSold: number; revenue: string; cogs: string; grossProfit: string; grossMarginPercent: string; averageProfitPerWatch: string }) => {
        const { _grossProfit, ...rest } = row;
        void _grossProfit;
        return rest;
      });

    return {
      period: bounds.label,
      items,
      count: items.length,
      definition:
        'Gross profit by brand from CLOSED_WON realized sales only: agreedPrice − canonical COGS. Not net profit (excludes commissions/OpEx). Unsold inventory never included.',
    };
  }

  async getTopSales(
    tenantId: string,
    args: {
      period?: 'CURRENT_MONTH' | 'YEAR' | 'ALL' | 'CUSTOM';
      year?: number;
      month?: number;
      sortBy?: SalesSortBy;
      limit?: number;
      includeCustomerLabel?: boolean;
      now?: Date;
    } = {},
  ) {
    const now = args.now ?? new Date();
    const period = args.period ?? 'CURRENT_MONTH';
    const bounds = periodBounds(now, period, args.year, args.month);
    const sortBy = args.sortBy ?? 'GROSS_PROFIT';
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const includeCustomer = args.includeCustomerLabel === true;

    const where: Prisma.DealWhereInput = {
      tenantId,
      deletedAt: null,
      stage: DealStage.CLOSED_WON,
      ...(bounds.start && bounds.end
        ? { AND: [dealEffectiveSaleDateRangeWhere(bounds.start, bounds.end)] }
        : {}),
    };

    const deals = await this.prisma.deal.findMany({
      where,
      select: {
        id: true,
        agreedPrice: true,
        historicalCost: true,
        soldAt: true,
        updatedAt: true,
        createdAt: true,
        client: { select: { name: true } },
        watch: {
          select: {
            brand: true,
            model: true,
            reference: true,
            cost: true,
            expenses: { select: { amount: true } },
          },
        },
      },
    });

    const ranked = deals
      .map((deal: DealMarginRow & { id: string; client: { name: string } }) => {
        const revenue = new Prisma.Decimal(deal.agreedPrice);
        const cogs = dealCogs(deal);
        const grossProfit = revenue.minus(cogs);
        const grossMarginPercent = revenue.gt(0)
          ? grossProfit.div(revenue).mul(100)
          : ZERO;
        const sold = effectiveSaleDate({
          soldAt: deal.soldAt,
          updatedAt: deal.updatedAt ?? now,
          createdAt: deal.createdAt,
        });
        return {
          dealId: deal.id,
          watchLabel: deal.watch
            ? watchLabel(deal.watch)
            : 'Venta sin reloj vinculado',
          customerLabel: includeCustomer ? deal.client.name : null,
          saleAmount: money(revenue),
          cost: money(cogs),
          grossProfit: money(grossProfit),
          grossMarginPercent: grossMarginPercent.toFixed(2),
          date: sold.toISOString(),
          _grossProfit: grossProfit,
          _saleAmount: revenue,
          _margin: grossMarginPercent,
        };
      })
      .sort((a: { _saleAmount: Prisma.Decimal; _margin: Prisma.Decimal; _grossProfit: Prisma.Decimal; dealId: string }, b: { _saleAmount: Prisma.Decimal; _margin: Prisma.Decimal; _grossProfit: Prisma.Decimal; dealId: string }) => {
        let cmp = 0;
        if (sortBy === 'AGREED_PRICE') cmp = b._saleAmount.comparedTo(a._saleAmount);
        else if (sortBy === 'GROSS_MARGIN_PERCENT') cmp = b._margin.comparedTo(a._margin);
        else cmp = b._grossProfit.comparedTo(a._grossProfit);
        if (cmp !== 0) return cmp;
        return a.dealId.localeCompare(b.dealId);
      })
      .slice(0, limit)
      .map((row: {
        dealId: string;
        watchLabel: string;
        customerLabel: string | null;
        saleAmount: string;
        cost: string;
        grossProfit: string;
        grossMarginPercent: string;
        date: string;
        _grossProfit: Prisma.Decimal;
        _saleAmount: Prisma.Decimal;
        _margin: Prisma.Decimal;
      }) => {
        const { _grossProfit, _saleAmount, _margin, ...rest } = row;
        void _grossProfit;
        void _saleAmount;
        void _margin;
        return rest;
      });

    return {
      period: bounds.label,
      sortBy,
      items: ranked,
      count: ranked.length,
    };
  }

  /**
   * Deterministic attention rules. No LLM diagnosis.
   * Phrasing is observational only — never prescriptive financial advice.
   */
  async getAttentionItems(
    tenantId: string,
    args: { now?: Date; limit?: number } = {},
  ) {
    const now = args.now ?? new Date();
    const limit = Math.min(
      Math.max(args.limit ?? ATTENTION_POLICY.MAX_ITEMS, 1),
      ATTENTION_POLICY.MAX_ITEMS,
    );
    const items: AttentionItem[] = [];

    // A + C: aged high-value inventory + concentration
    const aging = await this.getInventoryAging(tenantId, {
      minAgeDays: ATTENTION_POLICY.AGED_INVENTORY_DAYS,
      limit: 50,
      now,
    });
    const capital = await this.getTopInventoryCapital(tenantId, { limit: 5, now });

    for (const row of aging.items.slice(0, 3)) {
      const cost = new Prisma.Decimal(row.cost);
      if (cost.gte(ATTENTION_POLICY.HIGH_VALUE_INVENTORY_MXN)) {
        items.push({
          type: 'AGED_HIGH_VALUE_INVENTORY',
          category: ATTENTION_RULE_CATEGORY.AGED_HIGH_VALUE_INVENTORY,
          severity: cost.gte(ATTENTION_POLICY.HIGH_VALUE_INVENTORY_MXN * 2)
            ? 'IMPORTANT'
            : 'WATCH',
          title: 'Inventario registrado antiguo de alto valor',
          explanation: `Este reloj (${row.label}) lleva ${row.ageDays} días registrado en el inventario de WristOS con costo ${row.cost} MXN.`,
          evidence: {
            watchIdHash: row.watchId.slice(0, 8),
            ageDays: row.ageDays,
            costMxn: row.cost,
            thresholdDays: ATTENTION_POLICY.AGED_INVENTORY_DAYS,
            ageMetric: 'inventory_record_age',
          },
          suggestedReadAction: 'GET_INVENTORY_AGING',
        });
      }
    }

    for (const row of capital.items.slice(0, 2)) {
      const pct = Number(row.percentOfActiveInventoryCapital);
      if (pct >= ATTENTION_POLICY.CONCENTRATION_PERCENT) {
        items.push({
          type: 'INVENTORY_CONCENTRATION',
          category: ATTENTION_RULE_CATEGORY.INVENTORY_CONCENTRATION,
          severity: pct >= ATTENTION_POLICY.CONCENTRATION_PERCENT * 2 ? 'IMPORTANT' : 'WATCH',
          title: 'Concentración de capital en inventario',
          explanation: `Este reloj (${row.label}) concentra ${row.percentOfActiveInventoryCapital}% del capital activo en inventario y lleva ${row.ageDays} días registrado.`,
          evidence: {
            watchIdHash: row.watchId.slice(0, 8),
            percentOfActiveInventoryCapital: row.percentOfActiveInventoryCapital,
            costMxn: row.cost,
            ageDays: row.ageDays,
            thresholdPercent: ATTENTION_POLICY.CONCENTRATION_PERCENT,
          },
          suggestedReadAction: 'GET_TOP_INVENTORY_CAPITAL',
        });
      }
    }

    // B + F: large receivables / concentration
    const debtors = await this.getTopDebtors(tenantId, { limit: 10 });
    const mxnTotal = new Prisma.Decimal(debtors.totals.MXN);
    for (const row of debtors.currencies.MXN.slice(0, 3)) {
      const outstanding = new Prisma.Decimal(row.outstanding);
      if (outstanding.gte(ATTENTION_POLICY.LARGE_RECEIVABLE_MXN)) {
        items.push({
          type: 'LARGE_RECEIVABLE',
          category: ATTENTION_RULE_CATEGORY.LARGE_RECEIVABLE,
          severity: outstanding.gte(ATTENTION_POLICY.LARGE_RECEIVABLE_MXN * 3)
            ? 'IMPORTANT'
            : 'WATCH',
          title: 'Saldo CXC relevante',
          explanation: `Este cliente (${row.clientLabel}) tiene ${row.outstanding} MXN pendientes en ${row.openAccountCount} cuenta(s).`,
          evidence: {
            clientIdHash: row.clientId ? row.clientId.slice(0, 8) : null,
            outstandingMxn: row.outstanding,
            openAccountCount: row.openAccountCount,
            thresholdMxn: ATTENTION_POLICY.LARGE_RECEIVABLE_MXN,
          },
          suggestedReadAction: 'GET_TOP_DEBTORS',
        });
      }
      if (mxnTotal.gt(0)) {
        const share = outstanding.div(mxnTotal).mul(100);
        if (share.gte(ATTENTION_POLICY.CONCENTRATION_PERCENT * 1.5)) {
          items.push({
            type: 'RECEIVABLE_CONCENTRATION',
            category: ATTENTION_RULE_CATEGORY.RECEIVABLE_CONCENTRATION,
            severity: 'INFO',
            title: 'Concentración de CXC',
            explanation: `Este cliente (${row.clientLabel}) concentra ${share.toFixed(2)}% de las CXC en MXN.`,
            evidence: {
              clientIdHash: row.clientId ? row.clientId.slice(0, 8) : null,
              sharePercent: share.toFixed(2),
              outstandingMxn: row.outstanding,
            },
            suggestedReadAction: 'GET_RECEIVABLE_SUMMARY',
          });
        }
      }
    }

    // D: stale crypto valuation
    const cryptoPriceRows = await this.prisma.assetPriceSnapshot.findMany({
      where: { tenantId, assetType: 'CRYPTO' },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
      select: { ticker: true, capturedAt: true },
    });
    const latestByTicker = new Map<string, Date>();
    for (const row of cryptoPriceRows) {
      if (!latestByTicker.has(row.ticker)) latestByTicker.set(row.ticker, row.capturedAt);
    }
    const holdings = await this.prisma.assetHolding.count({
      where: { tenantId, assetType: 'CRYPTO', deletedAt: null },
    });
    if (holdings > 0) {
      const staleHours = ATTENTION_POLICY.CRYPTO_STALE_HOURS;
      const stale = [...latestByTicker.entries()].filter(
        ([, capturedAt]) => now.getTime() - capturedAt.getTime() > staleHours * 3600 * 1000,
      );
      if (latestByTicker.size === 0 || stale.length > 0) {
        items.push({
          type: 'STALE_CRYPTO_VALUATION',
          category: ATTENTION_RULE_CATEGORY.STALE_CRYPTO_VALUATION,
          severity: latestByTicker.size === 0 ? 'WATCH' : 'INFO',
          title: 'Valuación crypto desactualizada',
          explanation:
            latestByTicker.size === 0
              ? `Hay ${holdings} posición(es) crypto sin precio registrado.`
              : `${stale.length} ticker(s) tienen precio con más de ${staleHours}h de antigüedad.`,
          evidence: {
            holdingCount: holdings,
            staleTickerCount: latestByTicker.size === 0 ? holdings : stale.length,
            thresholdHours: staleHours,
          },
        });
      }
    }

    // G: recent low-margin sales
    const lookbackStart = new Date(
      now.getTime() - ATTENTION_POLICY.LOW_MARGIN_LOOKBACK_DAYS * DAY_MS,
    );
    const recentDeals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: DealStage.CLOSED_WON,
        AND: [dealEffectiveSaleDateRangeWhere(lookbackStart, now)],
      },
      select: {
        id: true,
        agreedPrice: true,
        historicalCost: true,
        soldAt: true,
        updatedAt: true,
        createdAt: true,
        watch: {
          select: {
            brand: true,
            model: true,
            reference: true,
            cost: true,
            expenses: { select: { amount: true } },
          },
        },
      },
      take: 100,
    });
    const lowMargin = recentDeals
      .map((deal: DealMarginRow & { id: string }) => {
        const revenue = new Prisma.Decimal(deal.agreedPrice);
        const cogs = dealCogs(deal);
        const grossProfit = revenue.minus(cogs);
        const grossMarginPercent = revenue.gt(0)
          ? grossProfit.div(revenue).mul(100)
          : ZERO;
        return {
          dealId: deal.id,
          watchLabel: deal.watch ? watchLabel(deal.watch) : 'Venta sin reloj vinculado',
          saleAmount: money(revenue),
          grossMarginPercent: grossMarginPercent.toFixed(2),
          _margin: grossMarginPercent,
        };
      })
      .filter((row: { _margin: Prisma.Decimal }) => row._margin.lt(ATTENTION_POLICY.LOW_MARGIN_PERCENT))
      .sort((a: { _margin: Prisma.Decimal }, b: { _margin: Prisma.Decimal }) => a._margin.comparedTo(b._margin))
      .slice(0, 2);

    for (const row of lowMargin) {
      items.push({
        type: 'LOW_MARGIN_RECENT_SALE',
        category: ATTENTION_RULE_CATEGORY.LOW_MARGIN_RECENT_SALE,
        severity: 'INFO',
        title: 'Venta reciente con margen bruto bajo',
        explanation: `${row.watchLabel} se vendió con margen bruto ${row.grossMarginPercent}% (umbral ${ATTENTION_POLICY.LOW_MARGIN_PERCENT}%).`,
        evidence: {
          dealIdHash: row.dealId.slice(0, 8),
          grossMarginPercent: row.grossMarginPercent,
          saleAmount: row.saleAmount,
          thresholdPercent: ATTENTION_POLICY.LOW_MARGIN_PERCENT,
        },
        suggestedReadAction: 'GET_TOP_SALES',
      });
    }

    const severityRank: Record<AttentionSeverity, number> = {
      IMPORTANT: 0,
      WATCH: 1,
      INFO: 2,
    };
    const typeRank: Record<AttentionRuleId, number> = {
      AGED_HIGH_VALUE_INVENTORY: 0,
      INVENTORY_CONCENTRATION: 1,
      LARGE_RECEIVABLE: 2,
      RECEIVABLE_CONCENTRATION: 3,
      STALE_CRYPTO_VALUATION: 4,
      LOW_MARGIN_RECENT_SALE: 5,
    };

    const deduped: AttentionItem[] = [];
    const seen = new Set<string>();
    for (const item of items.sort((a, b) => {
      const s = severityRank[a.severity] - severityRank[b.severity];
      if (s !== 0) return s;
      return typeRank[a.type] - typeRank[b.type];
    })) {
      const key = `${item.type}:${JSON.stringify(item.evidence)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    return {
      asOf: now.toISOString(),
      items: deduped.slice(0, limit),
      count: Math.min(deduped.length, limit),
      policyVersion: '1.0.0',
      note: 'Observaciones operativas deterministas. No son órdenes de venta ni consejos financieros automáticos.',
    };
  }

  /**
   * Small composition of existing canonical intelligence — no new financial formulas.
   * Default period: current UTC calendar month (same deterministic policy as GET_MONTHLY_PROFIT defaults).
   */
  async getBusinessSummary(tenantId: string, args: { now?: Date } = {}) {
    const now = args.now ?? new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const [liquidity, inventorySummary, receivables, monthlyPerformance, attention] =
      await Promise.all([
        this.analytics.getLiquidity(tenantId, now),
        this.inventory.getSummary(tenantId),
        this.getReceivableSummary(tenantId),
        this.analytics.getMonthlyProfit(tenantId, year, month),
        this.getAttentionItems(tenantId, { now }),
      ]);

    return {
      asOf: now.toISOString(),
      liquidity: {
        totalLiquidityMxn: liquidity.totalLiquidityMxn,
        cashMxn: liquidity.cashMxn,
        bankMxn: liquidity.bankMxn,
        cryptoMxn: liquidity.cryptoMxn,
        cesarMxn: liquidity.cesarMxn,
        warnings: liquidity.warnings,
      },
      inventory: {
        activeItemCount: inventorySummary.activeItemCount,
        activeCapital: inventorySummary.totalInventoryValue,
      },
      receivables: {
        MXN: receivables.currencies.MXN.outstanding,
        USD: receivables.currencies.USD.outstanding,
      },
      monthlyPerformance: {
        period: monthlyPerformance.period,
        netProfit: monthlyPerformance.netProfitMxn,
        saleCount: monthlyPerformance.saleCount,
      },
      attentionItems: attention.items,
      composition: [
        'AnalyticsService.getLiquidity',
        'InventoryService.getSummary',
        'OperationalIntelligenceService.getReceivableSummary',
        'AnalyticsService.getMonthlyProfit',
        'OperationalIntelligenceService.getAttentionItems',
      ],
      note: 'Hechos + observaciones deterministas. Sin recomendaciones generadas ni conversión FX.',
    };
  }
}
