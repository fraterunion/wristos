'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import {
  AnalyticsPeriod,
  AnalyticsSummary,
  InventoryAgingSummary,
  PipelineSummary,
  RevenueOverTimePoint,
  SalesOverTimePoint,
} from '@/types/domain';

type DashboardData = {
  summary: AnalyticsSummary;
  inventoryAging: InventoryAgingSummary;
  pipeline: PipelineSummary;
};

function formatCurrency(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function normalizePipeline(raw: unknown): PipelineSummary {
  const object = (raw ?? {}) as Record<string, unknown>;
  const countsByStage =
    (object.countsByStage as Record<string, number>) ??
    (object.counts as Record<string, number>) ??
    {};
  const totalAgreedByStage =
    (object.totalAgreedByStage as Record<string, string>) ??
    (object.totalsByStage as Record<string, string>) ??
    {};

  const openDeals =
    typeof object.openDeals === 'number'
      ? object.openDeals
      : Object.entries(countsByStage)
          .filter(([stage]) => !stage.startsWith('CLOSED_'))
          .reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
  const wonDeals =
    typeof object.wonDeals === 'number'
      ? object.wonDeals
      : Number(countsByStage.CLOSED_WON ?? 0);
  const lostDeals =
    typeof object.lostDeals === 'number'
      ? object.lostDeals
      : Number(countsByStage.CLOSED_LOST ?? 0);

  return {
    countsByStage,
    totalAgreedByStage,
    openDeals,
    wonDeals,
    lostDeals,
  };
}

function normalizeInventoryAging(raw: unknown): InventoryAgingSummary {
  const object = (raw ?? {}) as Record<string, unknown>;
  return {
    days0to30: Number(object.days0to30 ?? 0),
    days31to60: Number(object.days31to60 ?? 0),
    days61to90: Number(object.days61to90 ?? 0),
    days90plus: Number(object.days90plus ?? 0),
  };
}

function KpiCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success';
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-5">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-3 text-2xl font-semibold ${
          tone === 'success' ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {value}
      </p>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-64 rounded bg-white/10" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-28 rounded-xl bg-white/10" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="h-64 rounded-xl bg-white/10" />
        <div className="h-64 rounded-xl bg-white/10" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [revenueSeries, setRevenueSeries] = useState<RevenueOverTimePoint[]>([]);
  const [salesSeries, setSalesSeries] = useState<SalesOverTimePoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  const fetchDashboard = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [summary, inventoryAging, pipelineRaw] = await Promise.all([
        apiGet<AnalyticsSummary>('/analytics/summary', {
          authenticated: true,
        }),
        apiGet<InventoryAgingSummary>('/analytics/inventory-aging', {
          authenticated: true,
        }),
        apiGet<unknown>('/analytics/pipeline', {
          authenticated: true,
        }),
      ]);

      setData({
        summary,
        inventoryAging: normalizeInventoryAging(inventoryAging),
        pipeline: normalizePipeline(pipelineRaw),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load dashboard data.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
  }, []);

  useEffect(() => {
    const fetchChartData = async () => {
      setChartLoading(true);
      try {
        const [revenueData, salesData] = await Promise.all([
          apiGet<RevenueOverTimePoint[]>('/analytics/revenue-over-time', {
            authenticated: true,
            query: { period },
          }),
          apiGet<SalesOverTimePoint[]>('/analytics/sales-over-time', {
            authenticated: true,
            query: { period },
          }),
        ]);
        setRevenueSeries(revenueData);
        setSalesSeries(salesData);
      } catch {
        setRevenueSeries([]);
        setSalesSeries([]);
      } finally {
        setChartLoading(false);
      }
    };

    void fetchChartData();
  }, [period]);

  const kpis = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Total Watches', value: String(data.summary.totalWatches) },
      { label: 'Available Watches', value: String(data.summary.availableWatches) },
      { label: 'Sold Watches', value: String(data.summary.soldWatches) },
      { label: 'Active Clients', value: String(data.summary.activeClients) },
      {
        label: 'Total Agreed Revenue',
        value: formatCurrency(data.summary.totalAgreedRevenue),
      },
      {
        label: 'Total Collected Revenue',
        value: formatCurrency(data.summary.totalCollectedRevenue),
        tone: 'success' as const,
      },
    ];
  }, [data]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
        <h2 className="text-lg font-semibold text-red-100">Dashboard unavailable</h2>
        <p className="mt-2 text-sm text-red-200/90">{error}</p>
        <button
          type="button"
          onClick={() => void fetchDashboard()}
          className="mt-4 rounded-md border border-red-400/50 px-3 py-2 text-sm text-red-100 hover:bg-red-400/20"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-xl border border-white/10 bg-panel p-6">
        <h2 className="text-lg font-semibold">No dashboard data yet</h2>
        <p className="mt-2 text-sm text-muted">
          Add inventory and deals to unlock real-time business insights.
        </p>
      </section>
    );
  }

  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h2 className="ui-title">Performance Dashboard</h2>
          <p className="ui-subtitle">
            Live snapshot of inventory, pipeline, and revenue health.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inventory"
            className="ui-btn-secondary px-3 py-2"
          >
            Add Watch
          </Link>
          <Link
            href="/crm"
            className="ui-btn-secondary px-3 py-2"
          >
            Add Client
          </Link>
          <Link href="/deals" className="ui-btn-primary px-3 py-2">
            Create Deal
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            tone={kpi.tone}
          />
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Performance Trends</h3>
            <p className="mt-1 text-sm text-muted">
              Revenue and sales momentum over the selected period.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-panel p-1">
            {(['week', 'month', 'year'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  period === option
                    ? 'bg-accent text-black font-semibold'
                    : 'text-muted hover:bg-white/5 hover:text-white'
                }`}
              >
                {option[0].toUpperCase()}
                {option.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className="ui-card">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Revenue Over Time
            </h4>
            <div className="mt-4 h-64 transition-opacity duration-200">
              {chartLoading ? (
                <div className="h-full animate-pulse rounded-lg bg-white/10" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueSeries}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#d4af37" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#d4af37" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="label"
                      stroke="#8c95a3"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#8c95a3"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${Number(value) / 1000}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#171a20',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10,
                        color: '#fff',
                      }}
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#d4af37"
                      strokeWidth={2.5}
                      fill="url(#revenueGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>

          <article className="ui-card">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Watches Sold Over Time
            </h4>
            <div className="mt-4 h-64 transition-opacity duration-200">
              {chartLoading ? (
                <div className="h-full animate-pulse rounded-lg bg-white/10" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis
                      dataKey="label"
                      stroke="#8c95a3"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis stroke="#8c95a3" tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: '#171a20',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10,
                        color: '#fff',
                      }}
                    />
                    <Bar dataKey="count" fill="#22c55e" radius={[8, 8, 0, 0]} barSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="ui-card">
          <h3 className="text-lg font-semibold">Pipeline Summary</h3>
          <p className="mt-1 text-sm text-muted">
            Deal movement and stage distribution for your active pipeline.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Open</p>
              <p className="mt-2 text-xl font-semibold">{data.pipeline.openDeals}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Won</p>
              <p className="mt-2 text-xl font-semibold text-emerald-300">
                {data.pipeline.wonDeals}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Lost</p>
              <p className="mt-2 text-xl font-semibold text-rose-300">
                {data.pipeline.lostDeals}
              </p>
            </div>
          </div>

          <div
            className="mt-5 space-y-2"
            data-query-key={queryKeys.analytics.pipeline.join(':')}
          >
            {Object.keys(data.pipeline.countsByStage).length === 0 ? (
              <p className="text-sm text-muted">No pipeline records yet.</p>
            ) : (
              Object.entries(data.pipeline.countsByStage).map(([stage, count]) => (
                <div
                  key={stage}
                  className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2"
                >
                  <span className="text-sm text-muted">{stage.replaceAll('_', ' ')}</span>
                  <span className="text-sm font-semibold">{count}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="ui-card">
          <h3 className="text-lg font-semibold">Inventory Aging</h3>
          <p className="mt-1 text-sm text-muted">
            Watches grouped by time in inventory to highlight stale stock.
          </p>

          <div
            className="mt-5 grid grid-cols-2 gap-3"
            data-query-key={queryKeys.analytics.inventoryAging.join(':')}
          >
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">0-30 days</p>
              <p className="mt-2 text-xl font-semibold">{data.inventoryAging.days0to30}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">31-60 days</p>
              <p className="mt-2 text-xl font-semibold">{data.inventoryAging.days31to60}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">61-90 days</p>
              <p className="mt-2 text-xl font-semibold">{data.inventoryAging.days61to90}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">90+ days</p>
              <p className="mt-2 text-xl font-semibold text-amber-300">
                {data.inventoryAging.days90plus}
              </p>
            </div>
          </div>
        </article>
      </section>
    </section>
  );
}
