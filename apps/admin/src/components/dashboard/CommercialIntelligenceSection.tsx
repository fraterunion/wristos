'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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

const tooltipStyle = {
  background: '#171717',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 8,
  color: '#FAFAFA',
};

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

function ChartPanel({
  title,
  loading,
  empty,
  chartHeight,
  children,
}: {
  title: string;
  loading: boolean;
  empty: boolean;
  chartHeight: number;
  children: React.ReactNode;
}) {
  return (
    <article className="ui-card min-h-[320px]">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
        {title}
      </h4>
      <div
        className="mt-4 min-w-0 transition-opacity duration-200"
        style={{ height: chartHeight }}
      >
        {loading ? (
          <div className="h-full animate-pulse rounded-lg bg-white/10" />
        ) : empty ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 px-4">
            <p className="text-sm text-white/35">Sin datos en el período</p>
          </div>
        ) : (
          children
        )}
      </div>
    </article>
  );
}

type SalesByBrandRow = SalesByBrandPoint & { revenueNum: number };

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
      <p className="mt-1 text-white/70">{row.count} venta{row.count !== 1 ? 's' : ''}</p>
      <p className="mt-0.5 text-white/50">Ingresos: {fmtMxn(row.revenue)}</p>
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

  const inventoryChartData = useMemo(
    () =>
      inventoryByBrand.map((row) => ({
        ...row,
        inventoryValueNum: num(row.inventoryValue),
      })),
    [inventoryByBrand],
  );

  const salesChartData = useMemo<SalesByBrandRow[]>(
    () =>
      salesByBrand.map((row) => ({
        ...row,
        revenueNum: num(row.revenue),
      })),
    [salesByBrand],
  );

  const inventoryChartHeight = Math.max(256, inventoryChartData.length * 36);
  const salesChartHeight = Math.max(256, salesChartData.length * 28);
  const modelsChartHeight = Math.max(256, topModels.length * 36);

  return (
    <section className="space-y-4">
      <ExecutiveSectionTitle
        title="Inteligencia comercial"
        subtitle="Distribución de inventario, rotación por marca y modelos más vendidos."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartPanel
          title="Inventario por marca"
          loading={loading}
          empty={inventoryChartData.length === 0}
          chartHeight={inventoryChartHeight}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={inventoryChartData}
              margin={{ top: 4, right: 56, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis
                type="number"
                stroke="#737373"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => fmtMxn(Number(value))}
              />
              <YAxis
                type="category"
                dataKey="brand"
                stroke="#737373"
                tickLine={false}
                axisLine={false}
                width={72}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, _name, item) => {
                  const row = item.payload as InventoryByBrandPoint & {
                    inventoryValueNum: number;
                  };
                  return [fmtMxn(Number(value)), `${row.count} pzas`];
                }}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="inventoryValueNum" fill="#FFFFFF" barSize={14} radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="count"
                  position="right"
                  className="fill-white/40 text-[10px]"
                  formatter={(value: number) => `${value} pzas`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="Ventas por marca"
          loading={loading}
          empty={salesChartData.length === 0}
          chartHeight={salesChartHeight}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={salesChartData} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="brand"
                stroke="#737373"
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-32}
                textAnchor="end"
                height={56}
                tick={{ fontSize: 10 }}
              />
              <YAxis stroke="#737373" tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<SalesByBrandTooltip />} />
              <Bar dataKey="count" fill="#34d399" radius={[8, 8, 0, 0]} barSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="Top modelos vendidos"
          loading={loading}
          empty={topModels.length === 0}
          chartHeight={modelsChartHeight}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={topModels}
              margin={{ top: 4, right: 40, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis
                type="number"
                stroke="#737373"
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="model"
                stroke="#737373"
                tickLine={false}
                axisLine={false}
                width={88}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${value} venta${Number(value) !== 1 ? 's' : ''}`, 'Total']}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="count" fill="#34d399" barSize={14} radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="count"
                  position="right"
                  className="fill-white/40 text-[10px]"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </section>
  );
}
