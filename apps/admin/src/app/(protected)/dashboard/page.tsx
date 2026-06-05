'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CommercialIntelligenceSection } from '@/components/dashboard/CommercialIntelligenceSection';
import { apiGet } from '@/lib/api-client';
import { getCapitalSummary, type CapitalSummary } from '@/lib/capital-api';
import { getFxUsdMxn, type FxRateResult } from '@/lib/fx-api';
import {
  AnalyticsPeriod,
  AnalyticsSummary,
  RevenueOverTimePoint,
  SalesOverTimePoint,
} from '@/types/domain';

type DashboardData = {
  summary: AnalyticsSummary;
};

function num(value: string | number | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtMxn(value: string | number | null | undefined) {
  const n = Number(value);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function ExecutiveSectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
        {title}
      </p>
      {subtitle ? <p className="mt-1 text-sm text-white/35">{subtitle}</p> : null}
    </div>
  );
}

function FinancialPositionHero({
  summary,
  pendingToPartners,
  capitalContributed,
  capitalNeto,
}: {
  summary: AnalyticsSummary;
  pendingToPartners: string | null;
  capitalContributed: string | null;
  capitalNeto: string | null;
}) {
  const cash = num(summary.cashBalance);
  const bank = num(summary.bankBalance);
  const cesar = num(summary.cesarBalance);
  const receivable = num(summary.totalPendingBalance);
  const liquidityTotal = cash + bank + cesar;
  const pendingPartners = num(pendingToPartners);
  const investedCapital = num(capitalContributed);
  const netCapital = num(capitalNeto);

  const positions = [
    { label: 'Efectivo', value: fmtMxn(cash), tone: 'positive' as const },
    { label: 'Bancos', value: fmtMxn(bank), tone: 'default' as const },
    { label: 'César', value: fmtMxn(cesar), tone: 'default' as const },
    {
      label: 'Cuentas por cobrar',
      value: fmtMxn(receivable),
      tone: receivable > 0 ? ('negative' as const) : ('default' as const),
    },
    {
      label: 'Por pagar socios',
      value: pendingToPartners !== null ? fmtMxn(pendingPartners) : '—',
      tone: pendingToPartners !== null && pendingPartners > 0 ? ('negative' as const) : ('muted' as const),
    },
    {
      label: 'Capital invertido',
      value: capitalContributed !== null ? fmtMxn(investedCapital) : '—',
      tone: capitalContributed !== null && investedCapital > 0 ? ('positive' as const) : ('muted' as const),
    },
    {
      label: 'Capital neto',
      value: capitalNeto !== null ? fmtMxn(netCapital) : '—',
      tone:
        capitalNeto === null ? ('muted' as const) :
        netCapital > 0 ? ('positive' as const) :
        netCapital < 0 ? ('negative' as const) :
        ('muted' as const),
    },
  ];

  const toneClass = (tone: 'default' | 'positive' | 'negative' | 'muted') =>
    tone === 'positive' ? 'text-emerald-400' :
    tone === 'negative' ? 'text-rose-400' :
    tone === 'muted' ? 'text-white/40' :
    'text-white';

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
      <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-3 md:px-6">
        <ExecutiveSectionTitle title="Posición financiera" />
        <Link
          href="/capital"
          className="shrink-0 pt-0.5 text-[11px] font-medium tracking-wide text-white/30 transition-colors hover:text-emerald-400/90"
        >
          Ver módulo Capital →
        </Link>
      </div>

      <div className="grid grid-cols-2 divide-y divide-white/[0.06] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 lg:divide-x lg:divide-y-0">
        {positions.map((item) => (
          <div key={item.label} className="px-4 py-4 md:px-5 md:py-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/30">
              {item.label}
            </p>
            <p className={`mt-2 text-xl font-semibold tabular-nums leading-none md:text-2xl ${toneClass(item.tone)}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-white/[0.06] bg-black/20 px-5 py-4 sm:flex-row sm:items-end sm:justify-between md:px-6 md:py-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/35">
            Liquidez total
          </p>
          <p className="mt-1 text-[11px] text-white/25">Efectivo + Bancos + César</p>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-white md:text-3xl">
          {fmtMxn(liquidityTotal)}
        </p>
      </div>
    </article>
  );
}

function SnapshotCard({
  label,
  value,
  sub,
  tone = 'default',
  sparkline,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'positive' | 'negative';
  sparkline?: RevenueOverTimePoint[];
}) {
  const valueClass =
    tone === 'positive' ? 'text-emerald-400' :
    tone === 'negative' ? 'text-rose-400' :
    'text-white';

  return (
    <article className="flex min-h-[108px] flex-col justify-between rounded-xl border border-white/[0.07] bg-panel/90 px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/30">
            {label}
          </p>
          <p className={`mt-2 text-lg font-semibold tabular-nums leading-none md:text-xl ${valueClass}`}>
            {value}
          </p>
          {sub ? <p className="mt-1.5 truncate text-[11px] text-white/25">{sub}</p> : null}
        </div>
        {sparkline && sparkline.length > 0 ? (
          <div className="h-10 w-16 shrink-0 opacity-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#34d399"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function BusinessSnapshot({
  summary,
  revenueSparkline,
}: {
  summary: AnalyticsSummary;
  revenueSparkline: RevenueOverTimePoint[];
}) {
  const salesCount = summary.salesThisMonthCount ?? 0;
  const profit = num(summary.profitThisMonth);

  return (
    <section className="space-y-3">
      <ExecutiveSectionTitle
        title="Business snapshot"
        subtitle="Indicadores operativos del mes en curso."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SnapshotCard
          label="Inventario"
          value={fmtMxn(summary.totalInventoryValue)}
          sub="Valor de mercado (mín)"
        />
        <SnapshotCard
          label="Ventas del mes"
          value={fmtMxn(summary.salesThisMonthRevenue)}
          sub={`${salesCount} venta${salesCount !== 1 ? 's' : ''}`}
          sparkline={revenueSparkline}
        />
        <SnapshotCard
          label="Utilidad del mes"
          value={fmtMxn(summary.profitThisMonth)}
          tone={profit >= 0 ? 'positive' : 'negative'}
        />
        <SnapshotCard
          label="Comisiones bancarias"
          value={fmtMxn(summary.bankFeesThisMonth)}
          tone={num(summary.bankFeesThisMonth) > 0 ? 'negative' : 'default'}
        />
        <SnapshotCard
          label="Relojes disponibles"
          value={String(summary.availableWatches ?? '—')}
        />
      </div>
    </section>
  );
}

function CashFlowSummary({ summary }: { summary: AnalyticsSummary }) {
  const entradas =
    num(summary.cashBalance) + num(summary.bankBalance) + num(summary.cesarBalance);
  const salidas = num(summary.costOfSoldThisMonth) + num(summary.bankFeesThisMonth);
  const balance = entradas - salidas;

  return (
    <div className="flex h-full flex-col">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
        Flujo de caja (este mes)
      </h4>
      <div className="mt-5 flex flex-1 flex-col justify-center gap-5">
        <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-4">
          <span className="text-sm text-white/45">Entradas</span>
          <span className="text-xl font-semibold tabular-nums text-emerald-400">
            {fmtMxn(entradas)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-4">
          <span className="text-sm text-white/45">Salidas</span>
          <span className="text-xl font-semibold tabular-nums text-rose-400">
            {fmtMxn(salidas)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium text-white/60">Balance</span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              balance >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {fmtMxn(balance)}
          </span>
        </div>
      </div>
      <p className="mt-4 text-[10px] leading-relaxed text-white/20">
        Salidas estimadas: costo vendido + comisiones bancarias del mes.
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-64 rounded bg-white/10" />
      <div className="h-44 rounded-2xl border border-white/10 bg-white/[0.06]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-28 rounded-xl bg-white/10" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-72 rounded-xl bg-white/10" />
        ))}
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

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 2v3m8-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

function DashboardContextBar({
  rate,
  loading,
  error,
}: {
  rate: FxRateResult | null;
  loading: boolean;
  error: string | null;
}) {
  const todayLabel = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex min-h-[56px] w-full flex-col gap-3 rounded-xl border border-white/[0.07] bg-panel/90 px-4 py-3 shadow-sm shadow-black/20 backdrop-blur-sm sm:min-h-[60px] sm:flex-row sm:items-center sm:gap-0 lg:mx-2 lg:max-w-2xl lg:flex-1 xl:mx-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white/65"
          aria-hidden
        >
          $
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">
            Tipo de cambio
          </p>
          {loading ? (
            <div className="mt-1.5 h-4 w-28 animate-pulse rounded bg-white/10" />
          ) : error || !rate ? (
            <p className="mt-0.5 truncate text-sm font-medium text-white/35">No disponible</p>
          ) : (
            <>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="truncate text-sm font-semibold tabular-nums text-white">
                  ${rate.rate.toFixed(2)} USD/MXN
                </p>
                {!rate.stale ? (
                  <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/90" title="Actualizado" />
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[10px] text-white/25">
                Actualizado {timeAgo(rate.fetchedAt)}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="hidden h-10 w-px shrink-0 bg-white/10 sm:mx-4 sm:block" />
      <div className="h-px w-full bg-white/10 sm:hidden" />

      <div className="flex min-w-0 flex-1 items-center gap-3 sm:pl-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/55">
          <CalendarIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">Hoy</p>
          <p className="mt-0.5 truncate text-sm font-medium capitalize text-white/80">{todayLabel}</p>
        </div>
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

  const [capitalSummary, setCapitalSummary] = useState<CapitalSummary | null>(null);

  const [fxRate, setFxRate] = useState<FxRateResult | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const summary = await apiGet<AnalyticsSummary>('/analytics/summary', {
        authenticated: true,
      });

      setData({ summary });
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
    getCapitalSummary()
      .then((s) => setCapitalSummary(s))
      .catch(() => {});
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
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 shrink-0">
          <h2 className="ui-title">Panel de rendimiento</h2>
          <p className="ui-subtitle">
            Instantánea en vivo de inventario, pipeline e ingresos.
          </p>
        </div>

        <DashboardContextBar rate={fxRate} loading={fxLoading} error={fxError} />

        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/inventory?action=create"
            className="ui-btn-secondary px-3 py-2"
          >
            Agregar reloj
          </Link>
          <Link
            href="/crm?action=create"
            className="ui-btn-secondary px-3 py-2"
          >
            Agregar cliente
          </Link>
          <Link href="/ventas?action=create" className="ui-btn-primary px-3 py-2">
            Registrar venta
          </Link>
        </div>
      </header>

      <FinancialPositionHero
        summary={data.summary}
        pendingToPartners={capitalSummary?.totalPendingToPartners ?? null}
        capitalContributed={capitalSummary?.totalCapitalContributed ?? null}
        capitalNeto={capitalSummary?.capitalNeto ?? null}
      />

      <BusinessSnapshot
        summary={data.summary}
        revenueSparkline={revenueSeries}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ExecutiveSectionTitle
            title="Analytics"
            subtitle="Tendencias de ingresos, ventas y flujo de caja."
          />
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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <article className="ui-card min-h-[320px]">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
              Ventas en el tiempo
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
                      formatter={(value) => fmtMxn(Number(value))}
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

          <article className="ui-card min-h-[320px]">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
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
                    <YAxis stroke="#737373" tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: '#171717',
                        border: '1px solid rgba(255,255,255,0.10)',
                        borderRadius: 8,
                        color: '#FAFAFA',
                      }}
                    />
                    <Bar dataKey="count" fill="#34d399" radius={[8, 8, 0, 0]} barSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>

          <article className="ui-card min-h-[320px]">
            <CashFlowSummary summary={data.summary} />
          </article>
        </div>
      </section>

      <CommercialIntelligenceSection />
    </section>
  );
}
