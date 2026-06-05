'use client';

import Link from 'next/link';
import {
  Landmark,
  PieChart,
  Receipt,
  ShieldCheck,
  TrendingUp,
  User,
  Users,
  Wallet,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
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
import { getCuentasSummary, type CuentasSummary } from '@/lib/cuentas-api';
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

function calcRoi(capitalNeto: string | null, totalCapitalContributed: string | null): number | null {
  if (capitalNeto === null || totalCapitalContributed === null) return null;
  const net = Number(capitalNeto);
  const contributed = Number(totalCapitalContributed);
  if (!Number.isFinite(net) || !Number.isFinite(contributed) || contributed <= 0) return null;
  return ((net - contributed) / contributed) * 100;
}

function fmtRoiPct(roi: number) {
  return `${Math.round(roi)}%`;
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

type FinancialTone = 'default' | 'positive' | 'negative' | 'muted' | 'warning';
type FinancialGroup = 'liquidity' | 'operations' | 'partners' | 'performance';

function financialToneClass(tone: FinancialTone) {
  return tone === 'positive'
    ? 'text-emerald-400'
    : tone === 'warning'
      ? 'text-amber-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : tone === 'muted'
          ? 'text-white/40'
          : 'text-white';
}

function financialGroupSurfaceClass(group: FinancialGroup) {
  return group === 'liquidity'
    ? 'bg-emerald-500/[0.022]'
    : group === 'operations'
      ? 'bg-white/[0.016]'
      : group === 'partners'
        ? 'bg-amber-500/[0.018]'
        : 'bg-white/[0.012]';
}

function FinancialKpiCard({
  label,
  value,
  helper,
  tone,
  group,
  iconBubbleClass,
  valueType = 'monetary',
  Icon,
}: {
  label: string;
  value: string;
  helper: string;
  tone: FinancialTone;
  group: FinancialGroup;
  iconBubbleClass: string;
  valueType?: 'monetary' | 'percentage';
  Icon: LucideIcon;
}) {
  const valueClass =
    valueType === 'percentage'
      ? 'text-lg font-semibold tabular-nums leading-none xl:text-[1.45rem]'
      : 'text-xl font-semibold tabular-nums leading-none tracking-[-0.02em] xl:text-[1.65rem]';

  return (
    <div
      className={`flex min-h-[145px] min-w-0 flex-col rounded-xl border border-white/[0.04] bg-gradient-to-b from-white/[0.03] to-transparent p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:bg-white/[0.03] ${financialGroupSurfaceClass(group)}`}
    >
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${iconBubbleClass}`}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </div>
      <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white/50">
        {label}
      </p>
      <p className={`mt-2 ${valueClass} ${financialToneClass(tone)}`}>
        {value}
      </p>
      <p className="mt-2 text-xs text-white/35">{helper}</p>
    </div>
  );
}

function FinancialPositionHero({
  summary,
  cuentasReceivable,
  cuentasPayable,
  pendingToPartners,
  capitalContributed,
  capitalNeto,
}: {
  summary: AnalyticsSummary;
  cuentasReceivable: string | null;
  cuentasPayable: string | null;
  pendingToPartners: string | null;
  capitalContributed: string | null;
  capitalNeto: string | null;
}) {
  const cash = num(summary.cashBalance);
  const bank = num(summary.bankBalance);
  const cesar = num(summary.cesarBalance);
  const receivable = cuentasReceivable !== null ? num(cuentasReceivable) : null;
  const payable = cuentasPayable !== null ? num(cuentasPayable) : null;
  const liquidityTotal = cash + bank + cesar;
  const pendingPartners = num(pendingToPartners);
  const investedCapital = num(capitalContributed);
  const netCapital = num(capitalNeto);
  const roi = calcRoi(capitalNeto, capitalContributed);

  const positions: Array<{
    label: string;
    value: string;
    helper: string;
    tone: FinancialTone;
    group: FinancialGroup;
    iconBubbleClass: string;
    valueType?: 'monetary' | 'percentage';
    Icon: LucideIcon;
  }> = [
    {
      label: 'Efectivo',
      value: fmtMxn(cash),
      helper: 'Disponible',
      tone: 'positive',
      group: 'liquidity',
      iconBubbleClass: 'bg-emerald-500/15 text-emerald-400',
      Icon: Wallet,
    },
    {
      label: 'Bancos',
      value: fmtMxn(bank),
      helper: 'Saldo total',
      tone: 'default',
      group: 'liquidity',
      iconBubbleClass: 'bg-violet-500/15 text-violet-400',
      Icon: Landmark,
    },
    {
      label: 'Cuenta César',
      value: fmtMxn(cesar),
      helper: 'Cuenta personal',
      tone: 'default',
      group: 'liquidity',
      iconBubbleClass: 'bg-blue-500/15 text-blue-400',
      Icon: User,
    },
    {
      label: 'Cuentas por cobrar',
      value: receivable !== null ? fmtMxn(receivable) : '—',
      helper: 'Pendiente de cobro',
      group: 'operations',
      iconBubbleClass: 'bg-rose-500/15 text-rose-400',
      tone:
        receivable === null ? 'muted' :
        receivable > 0 ? 'negative' :
        'default',
      Icon: Receipt,
    },
    {
      label: 'Cuentas por pagar',
      value: payable !== null ? fmtMxn(payable) : '—',
      helper: 'Obligaciones operativas',
      group: 'operations',
      iconBubbleClass: 'bg-orange-500/15 text-orange-400',
      tone:
        payable === null ? 'muted' :
        payable > 0 ? 'warning' :
        'muted',
      Icon: WalletCards,
    },
    {
      label: 'Por pagar socios',
      value: pendingToPartners !== null ? fmtMxn(pendingPartners) : '—',
      helper: 'Obligaciones con socios',
      group: 'partners',
      iconBubbleClass: 'bg-yellow-500/15 text-yellow-400',
      tone: pendingToPartners !== null && pendingPartners > 0 ? 'warning' : 'muted',
      Icon: Users,
    },
    {
      label: 'Capital invertido',
      value: capitalContributed !== null ? fmtMxn(investedCapital) : '—',
      helper: 'Aportado por socios',
      group: 'partners',
      iconBubbleClass: 'bg-emerald-500/15 text-emerald-400',
      tone: capitalContributed !== null && investedCapital > 0 ? 'positive' : 'muted',
      Icon: TrendingUp,
    },
    {
      label: 'ROI',
      value: roi !== null ? fmtRoiPct(roi) : '—',
      helper: 'Retorno sobre capital',
      group: 'performance',
      valueType: 'percentage',
      iconBubbleClass: 'bg-purple-500/15 text-purple-400',
      tone:
        roi === null ? 'muted' :
        roi > 0 ? 'positive' :
        roi < 0 ? 'negative' :
        'muted',
      Icon: PieChart,
    },
    {
      label: 'Capital neto',
      value: capitalNeto !== null ? fmtMxn(netCapital) : '—',
      helper: 'Patrimonio neto',
      group: 'performance',
      iconBubbleClass: 'bg-cyan-500/15 text-cyan-400',
      tone:
        capitalNeto === null ? 'muted' :
        netCapital > 0 ? 'positive' :
        netCapital < 0 ? 'negative' :
        'muted',
      Icon: ShieldCheck,
    },
  ];

  return (
    <article className="relative overflow-hidden rounded-[24px] border border-white/[0.04] bg-gradient-to-b from-white/[0.04] to-white/[0.012] shadow-2xl shadow-black/40">
      <div
        className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-emerald-500/[0.05] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-12 top-1/4 h-40 w-40 rounded-full bg-white/[0.02] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(16,185,129,0.07),transparent_55%)]"
        aria-hidden
      />

      <div className="relative border-b border-white/[0.04] px-4 py-3 md:px-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/15 to-transparent" />
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400/90">
                <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                Posición financiera
              </p>
            </div>
            <p className="mt-0.5 pl-9 text-xs text-white/35">Resumen financiero consolidado</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
            <Link
              href="/cuentas"
              className="text-[11px] font-medium tracking-wide text-white/30 underline-offset-4 transition-colors hover:text-emerald-400 hover:underline"
            >
              Ver cuentas →
            </Link>
            <span className="hidden text-white/12 sm:inline" aria-hidden>
              ·
            </span>
            <Link
              href="/capital"
              className="text-[11px] font-medium tracking-wide text-white/30 underline-offset-4 transition-colors hover:text-emerald-400 hover:underline"
            >
              Ver capital →
            </Link>
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9 md:p-5">
        {positions.map((item) => (
          <FinancialKpiCard
            key={item.label}
            label={item.label}
            value={item.value}
            helper={item.helper}
            tone={item.tone}
            group={item.group}
            iconBubbleClass={item.iconBubbleClass}
            valueType={item.valueType}
            Icon={item.Icon}
          />
        ))}
      </div>

      <div className="relative border-t border-white/[0.04]">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_120%_at_85%_50%,rgba(16,185,129,0.14),transparent_62%)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-500/[0.05] via-transparent to-emerald-500/[0.03]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-5 md:py-6">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
              Liquidez total
            </p>
            <p className="mt-1 text-xs text-white/35">Efectivo + Bancos + César</p>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <p className="text-4xl font-semibold tabular-nums tracking-tight text-emerald-400 xl:text-5xl">
              {fmtMxn(liquidityTotal)}
            </p>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400/80">
              <TrendingUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </div>
          </div>
        </div>
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
  const [cuentasSummary, setCuentasSummary] = useState<CuentasSummary | null>(null);

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
    getCuentasSummary()
      .then((s) => setCuentasSummary(s))
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
        cuentasReceivable={cuentasSummary?.totalReceivable ?? null}
        cuentasPayable={cuentasSummary?.totalPayable ?? null}
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
