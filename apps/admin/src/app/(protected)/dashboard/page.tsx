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
import { getFxUsdMxn, type FxRateResult } from '@/lib/fx-api';
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

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'hace un momento';
  if (diffMin === 1) return 'hace 1 min';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  return diffHr === 1 ? 'hace 1 hora' : `hace ${diffHr} horas`;
}

function FxRateCard({
  rate,
  loading,
  error,
}: {
  rate: FxRateResult | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-5">
      <p className="text-xs uppercase tracking-wide text-muted">Tipo de cambio</p>

      {loading ? (
        <div className="mt-3 space-y-2 animate-pulse">
          <div className="h-8 w-28 rounded bg-white/10" />
          <div className="h-3 w-16 rounded bg-white/10" />
          <div className="h-3 w-44 rounded bg-white/[0.06]" />
        </div>
      ) : !rate ? (
        <>
          <p className="mt-3 text-2xl font-semibold text-white/25">No disponible</p>
          <p className="mt-1 text-xs text-muted/60">USD/MXN</p>
        </>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <p className="text-2xl font-semibold text-white tabular-nums">
              ${rate.rate.toFixed(2)}
            </p>
            {rate.stale && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400/80">
                Dato en caché
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">USD/MXN</p>
          <p className="mt-3 text-[11px] text-muted/60">
            Fuente: {rate.source}
            <span className="mx-1 opacity-40">·</span>
            Actualizado {timeAgo(rate.fetchedAt)}
          </p>
        </>
      )}
    </article>
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

  const [fxRate, setFxRate] = useState<FxRateResult | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

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
          : 'No se pudieron cargar los datos del panel.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
  }, []);

  useEffect(() => {
    getFxUsdMxn()
      .then((r) => { setFxRate(r); setFxLoading(false); })
      .catch(() => { setFxError('No disponible'); setFxLoading(false); });
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
      { label: 'Total de relojes', value: String(data.summary.totalWatches) },
      { label: 'Relojes disponibles', value: String(data.summary.availableWatches) },
      { label: 'Relojes vendidos', value: String(data.summary.soldWatches) },
      { label: 'Clientes activos', value: String(data.summary.activeClients) },
      {
        label: 'Ingresos acordados totales',
        value: formatCurrency(data.summary.totalAgreedRevenue),
      },
      {
        label: 'Ingresos cobrados totales',
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
        <h2 className="text-lg font-semibold text-red-100">Panel no disponible</h2>
        <p className="mt-2 text-sm text-red-200/90">{error}</p>
        <button
          type="button"
          onClick={() => void fetchDashboard()}
          className="mt-4 rounded-md border border-red-400/50 px-3 py-2 text-sm text-red-100 hover:bg-red-400/20"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-xl border border-white/10 bg-panel p-6">
        <h2 className="text-lg font-semibold">Aún no hay datos en el panel</h2>
        <p className="mt-2 text-sm text-muted">
          Agrega inventario y oportunidades para ver análisis en tiempo real.
        </p>
      </section>
    );
  }

  return (
    <section className="ui-page">
      <header className="ui-page-header">
        <div>
          <h2 className="ui-title">Panel de rendimiento</h2>
          <p className="ui-subtitle">
            Instantánea en vivo de inventario, pipeline e ingresos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inventory"
            className="ui-btn-secondary px-3 py-2"
          >
            Agregar reloj
          </Link>
          <Link
            href="/crm"
            className="ui-btn-secondary px-3 py-2"
          >
            Agregar cliente
          </Link>
          <Link href="/deals" className="ui-btn-primary px-3 py-2">
            Crear oportunidad
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
        <FxRateCard rate={fxRate} loading={fxLoading} error={fxError} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Tendencias de rendimiento</h3>
            <p className="mt-1 text-sm text-muted">
              Impulso de ingresos y ventas en el período seleccionado.
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
                {{ week: 'Semana', month: 'Mes', year: 'Año' }[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className="ui-card">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Ingresos en el tiempo
            </h4>
            <div className="mt-4 h-64 min-w-0 transition-opacity duration-200">
              {chartLoading ? (
                <div className="h-full animate-pulse rounded-lg bg-white/10" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueSeries}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FFFFFF" stopOpacity={0.20} />
                        <stop offset="95%" stopColor="#FFFFFF" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="label"
                      stroke="#737373"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#737373"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${Number(value) / 1000}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#171717',
                        border: '1px solid rgba(255,255,255,0.10)',
                        borderRadius: 8,
                        color: '#FAFAFA',
                      }}
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                      fill="url(#revenueGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>

          <article className="ui-card">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Relojes vendidos en el tiempo
            </h4>
            <div className="mt-4 h-64 min-w-0 transition-opacity duration-200">
              {chartLoading ? (
                <div className="h-full animate-pulse rounded-lg bg-white/10" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="label"
                      stroke="#737373"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis stroke="#737373" tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: '#171717',
                        border: '1px solid rgba(255,255,255,0.10)',
                        borderRadius: 8,
                        color: '#FAFAFA',
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
          <h3 className="text-lg font-semibold">Resumen del pipeline</h3>
          <p className="mt-1 text-sm text-muted">
            Movimiento de oportunidades y distribución por etapa en tu pipeline activo.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Abiertas</p>
              <p className="mt-2 text-xl font-semibold">{data.pipeline.openDeals}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Ganadas</p>
              <p className="mt-2 text-xl font-semibold text-emerald-300">
                {data.pipeline.wonDeals}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Perdidas</p>
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
              <p className="text-sm text-muted">Aún no hay registros en el pipeline.</p>
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
          <h3 className="text-lg font-semibold">Antigüedad del inventario</h3>
          <p className="mt-1 text-sm text-muted">
            Relojes agrupados por tiempo en inventario para identificar stock sin movimiento.
          </p>

          <div
            className="mt-5 grid grid-cols-2 gap-3"
            data-query-key={queryKeys.analytics.inventoryAging.join(':')}
          >
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">0-30 días</p>
              <p className="mt-2 text-xl font-semibold">{data.inventoryAging.days0to30}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">31-60 días</p>
              <p className="mt-2 text-xl font-semibold">{data.inventoryAging.days31to60}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">61-90 días</p>
              <p className="mt-2 text-xl font-semibold">{data.inventoryAging.days61to90}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface p-3">
              <p className="text-xs uppercase tracking-wide text-muted">90+ días</p>
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
