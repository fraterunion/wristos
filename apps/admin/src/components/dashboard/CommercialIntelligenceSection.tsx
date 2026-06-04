'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet } from '@/lib/api-client';
import type {
  InventoryByBrandPoint,
  SalesByBrandPoint,
  TopModelPoint,
} from '@/types/domain';

const TOP_LIMIT = 8;
const MODEL_NAME_MAX = 28;

function fmtMxn(value: string | number | null | undefined) {
  const n = Number(value);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function num(value: string | number | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function truncateLabel(text: string, max = MODEL_NAME_MAX) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500/70">
        {title}
      </p>
      {subtitle ? <p className="mt-1 text-sm text-white/35">{subtitle}</p> : null}
    </div>
  );
}

function PanelShell({
  title,
  loading,
  empty,
  children,
}: {
  title: string;
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-amber-500/25 bg-panel/95 shadow-lg shadow-black/30">
      <div className="border-b border-amber-500/15 px-5 py-3 md:px-6">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500/70">
          {title}
        </h4>
      </div>
      <div className="px-5 py-5 md:px-6 md:py-6">
        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-24 rounded-xl bg-white/10" />
            <div className="h-48 rounded-xl bg-white/[0.06]" />
          </div>
        ) : empty ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 px-4">
            <p className="text-sm text-white/35">Sin datos disponibles</p>
          </div>
        ) : (
          children
        )}
      </div>
    </article>
  );
}

function SideKpiCard({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="flex w-full shrink-0 flex-col justify-center rounded-xl border border-white/[0.08] bg-black/30 px-4 py-5 lg:w-52 xl:w-56">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tabular-nums leading-none text-emerald-400">
        {primary}
      </p>
      {secondary ? (
        <p className="mt-2 text-sm tabular-nums text-white/45">{secondary}</p>
      ) : null}
    </div>
  );
}

type SalesByBrandRow = SalesByBrandPoint;

function SalesByBrandTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SalesByBrandRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-[#171717] px-3 py-2 text-xs text-white">
      <p className="font-medium">{row.brand}</p>
      <p className="mt-1 text-white/70">
        {row.count} unidad{row.count !== 1 ? 'es' : ''} vendida{row.count !== 1 ? 's' : ''}
      </p>
      <p className="mt-0.5 text-white/50">Ingresos: {fmtMxn(row.revenue)}</p>
    </div>
  );
}

function InventoryByBrandPanel({
  rows,
  totalValue,
  totalPieces,
}: {
  rows: Array<InventoryByBrandPoint & { inventoryValueNum: number }>;
  totalValue: number;
  totalPieces: number;
}) {
  const maxValue = rows[0]?.inventoryValueNum ?? 1;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
      <SideKpiCard
        label="Inventario activo"
        primary={fmtMxn(totalValue)}
        secondary={`${totalPieces} pieza${totalPieces !== 1 ? 's' : ''}`}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-3 hidden gap-3 border-b border-white/[0.06] pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/25 sm:grid sm:grid-cols-[minmax(88px,1fr)_minmax(0,2.2fr)_72px_56px]">
          <span>Marca</span>
          <span className="sm:pl-2">Valor de inventario</span>
          <span className="text-right">Valor</span>
          <span className="text-right">Piezas</span>
        </div>

        <ul className="space-y-3">
          {rows.map((row) => {
            const widthPct = maxValue > 0 ? (row.inventoryValueNum / maxValue) * 100 : 0;
            return (
              <li
                key={row.brand}
                className="grid grid-cols-1 gap-2 border-b border-white/[0.04] pb-3 last:border-0 last:pb-0 sm:grid-cols-[minmax(88px,1fr)_minmax(0,2.2fr)_72px_56px] sm:items-center sm:gap-3"
              >
                <span
                  className="truncate text-sm font-medium text-white/85"
                  title={row.brand}
                >
                  {row.brand}
                </span>
                <div className="relative h-7 overflow-hidden rounded-md border border-white/[0.06] bg-black/40 sm:col-span-1">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md bg-white/85"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-semibold tabular-nums text-black/80 mix-blend-difference sm:hidden">
                    {fmtMxn(row.inventoryValueNum)}
                  </span>
                </div>
                <span className="hidden text-right text-sm font-semibold tabular-nums text-white sm:block">
                  {fmtMxn(row.inventoryValueNum)}
                </span>
                <span className="text-right text-sm tabular-nums text-white/40 sm:block">
                  {row.count}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SalesByBrandPanel({
  rows,
  totalSold,
}: {
  rows: SalesByBrandRow[];
  totalSold: number;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
      <SideKpiCard
        label="Relojes vendidos"
        primary={String(totalSold)}
        secondary="Histórico acumulado"
      />

      <div className="min-h-[300px] min-w-0 flex-1 lg:min-h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="brand"
              stroke="#737373"
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-28}
              textAnchor="end"
              height={64}
              tick={{ fontSize: 11, fill: '#a3a3a3' }}
            />
            <YAxis
              stroke="#737373"
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#737373' }}
            />
            <Tooltip content={<SalesByBrandTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="count" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TopModelsPanel({
  rows,
  totalSold,
}: {
  rows: TopModelPoint[];
  totalSold: number;
}) {
  const maxCount = rows[0]?.count ?? 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="border-b border-white/[0.08] text-[9px] font-semibold uppercase tracking-[0.14em] text-white/25">
            <th className="pb-3 pr-3 w-10">#</th>
            <th className="pb-3 pr-4 min-w-[140px]">Modelo</th>
            <th className="pb-3 pr-4">Participación</th>
            <th className="pb-3 pr-4 w-20 text-right">Vendidos</th>
            <th className="pb-3 w-16 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const sharePct = totalSold > 0 ? (row.count / totalSold) * 100 : 0;
            const barPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
            return (
              <tr
                key={`${row.model}-${index}`}
                className="border-b border-white/[0.04] last:border-0"
              >
                <td className="py-3.5 pr-3 text-sm tabular-nums text-white/35">
                  {index + 1}
                </td>
                <td className="py-3.5 pr-4">
                  <span
                    className="text-sm font-medium text-white/85"
                    title={row.model}
                  >
                    {truncateLabel(row.model)}
                  </span>
                </td>
                <td className="py-3.5 pr-4">
                  <div className="h-2 overflow-hidden rounded-full border border-white/[0.06] bg-black/40">
                    <div
                      className="h-full rounded-full bg-emerald-500/80"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </td>
                <td className="py-3.5 pr-4 text-right text-sm font-semibold tabular-nums text-emerald-400">
                  {row.count}
                </td>
                <td className="py-3.5 text-right text-sm tabular-nums text-white/45">
                  {sharePct.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CommercialIntelligenceSection() {
  const [inventoryByBrand, setInventoryByBrand] = useState<InventoryByBrandPoint[]>([]);
  const [salesByBrand, setSalesByBrand] = useState<SalesByBrandPoint[]>([]);
  const [topModels, setTopModels] = useState<TopModelPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchCommercial = async () => {
      setLoading(true);
      try {
        const [inventory, sales, models] = await Promise.all([
          apiGet<InventoryByBrandPoint[]>('/analytics/inventory-by-brand', {
            authenticated: true,
          }),
          apiGet<SalesByBrandPoint[]>('/analytics/sales-by-brand', {
            authenticated: true,
          }),
          apiGet<TopModelPoint[]>('/analytics/top-models', {
            authenticated: true,
          }),
        ]);
        if (cancelled) return;
        setInventoryByBrand(inventory);
        setSalesByBrand(sales);
        setTopModels(models);
      } catch {
        if (cancelled) return;
        setInventoryByBrand([]);
        setSalesByBrand([]);
        setTopModels([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchCommercial();
    return () => {
      cancelled = true;
    };
  }, []);

  const topInventory = useMemo(() => {
    return inventoryByBrand
      .map((row) => ({
        ...row,
        inventoryValueNum: num(row.inventoryValue),
      }))
      .sort((a, b) => b.inventoryValueNum - a.inventoryValueNum)
      .slice(0, TOP_LIMIT);
  }, [inventoryByBrand]);

  const inventoryTotals = useMemo(() => {
    const totalValue = inventoryByBrand.reduce(
      (sum, row) => sum + num(row.inventoryValue),
      0,
    );
    const totalPieces = inventoryByBrand.reduce((sum, row) => sum + row.count, 0);
    return { totalValue, totalPieces };
  }, [inventoryByBrand]);

  const topSalesByBrand = useMemo(
    () =>
      [...salesByBrand]
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_LIMIT),
    [salesByBrand],
  );

  const totalWatchesSold = useMemo(
    () => salesByBrand.reduce((sum, row) => sum + row.count, 0),
    [salesByBrand],
  );

  const topModelsEight = useMemo(
    () => [...topModels].sort((a, b) => b.count - a.count).slice(0, TOP_LIMIT),
    [topModels],
  );

  return (
    <section className="space-y-6">
      <ExecutiveSectionTitle
        title="Inteligencia comercial"
        subtitle="Concentración de capital, rotación por marca y modelos con mayor salida."
      />

      <PanelShell
        title="Inventario por marca"
        loading={loading}
        empty={topInventory.length === 0}
      >
        <InventoryByBrandPanel
          rows={topInventory}
          totalValue={inventoryTotals.totalValue}
          totalPieces={inventoryTotals.totalPieces}
        />
      </PanelShell>

      <PanelShell
        title="Ventas por marca"
        loading={loading}
        empty={topSalesByBrand.length === 0}
      >
        <SalesByBrandPanel rows={topSalesByBrand} totalSold={totalWatchesSold} />
      </PanelShell>

      <PanelShell
        title="Top modelos vendidos"
        loading={loading}
        empty={topModelsEight.length === 0}
      >
        <TopModelsPanel rows={topModelsEight} totalSold={totalWatchesSold} />
      </PanelShell>
    </section>
  );
}
