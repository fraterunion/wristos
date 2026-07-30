'use client';

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
import type { SalesTimelineBucket } from '@/types/domain';

function fmtMxn(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function fmtAxisMxn(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function bucketRangeLabel(b: SalesTimelineBucket) {
  if (b.startDate === b.endDate) {
    return b.label.includes(String(new Date(b.startDate).getUTCFullYear()))
      ? b.label
      : `${b.label} ${b.startDate.slice(0, 4)}`;
  }
  return `${b.label}`;
}

function TimelineTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload: SalesTimelineBucket }>;
  mode: 'revenue' | 'count';
}) {
  if (!active || !payload?.[0]) return null;
  const b = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-[#171717] px-3 py-2.5 text-xs text-[#FAFAFA] shadow-lg">
      <p className="font-medium text-white/90">{bucketRangeLabel(b)}</p>
      {mode === 'revenue' ? (
        <>
          <p className="mt-1.5 tabular-nums text-white/80">Ventas: {fmtMxn(b.revenue)}</p>
          <p className="tabular-nums text-white/55">Relojes: {b.salesCount}</p>
          <p className="tabular-nums text-white/55">
            Ticket promedio: {b.salesCount > 0 ? fmtMxn(b.averageTicket) : '—'}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 tabular-nums text-white/80">
            Relojes vendidos: {b.salesCount}
          </p>
          <p className="tabular-nums text-white/55">Ingresos: {fmtMxn(b.revenue)}</p>
        </>
      )}
    </div>
  );
}

export function RevenueAreaPlot({
  data,
  animate,
}: {
  data: SalesTimelineBucket[];
  animate: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueTimelineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FFFFFF" stopOpacity={0.18} />
            <stop offset="95%" stopColor="#FFFFFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="#737373"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          stroke="#737373"
          tickLine={false}
          axisLine={false}
          width={48}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => fmtAxisMxn(Number(v))}
        />
        <Tooltip
          cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1 }}
          content={<TimelineTooltip mode="revenue" />}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#FFFFFF"
          strokeWidth={1.5}
          fill="url(#revenueTimelineGradient)"
          activeDot={{ r: 4, fill: '#fff', stroke: '#0A0A0A', strokeWidth: 2 }}
          isAnimationActive={animate}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SoldWatchesBarPlot({
  data,
  animate,
  barSize,
}: {
  data: SalesTimelineBucket[];
  animate: boolean;
  barSize: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="#737373"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          stroke="#737373"
          tickLine={false}
          axisLine={false}
          width={36}
          allowDecimals={false}
          tick={{ fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'rgba(52, 211, 153, 0.08)' }}
          content={<TimelineTooltip mode="count" />}
        />
        <Bar
          dataKey="salesCount"
          fill="#34d399"
          radius={[6, 6, 0, 0]}
          barSize={barSize}
          isAnimationActive={animate}
          animationDuration={600}
          activeBar={{ fill: '#6ee7b7' }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
