'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { apiGet } from '@/lib/api-client';

type AssistantHealthReport = {
  generatedAt: string;
  eventCount: number;
  passive?: boolean;
  note?: string;
  kpis: {
    successRate: number;
    failureRate: number;
    clarificationRate: number;
    confirmationRate: number;
    cancellationRate: number;
    recoveryRate: number;
    replayRate: number;
    unknownIntentRate: number;
    avgProviderLatencyMs: number | null;
    avgPlannerLatencyMs: number | null;
    avgExecutionLatencyMs: number | null;
  };
  topFailedIntents: Array<{ intent: string; count: number }>;
  topClarifications: Array<{ type: string; count: number }>;
  topCapabilities: Array<{ capability: string; count: number }>;
  topRecoveryCauses: Array<{ reason: string; count: number }>;
  topSlowQueries: Array<{ capability: string; avgTotalLatencyMs: number; count: number }>;
  dangerousWriteVerification: {
    ok: boolean;
    violations: Array<{ capability?: string; detail: string }>;
  };
  latencyBreakdown: {
    provider: { avg: number | null; p95: number | null; count: number };
    planner: { avg: number | null; p95: number | null; count: number };
    domain: { avg: number | null; p95: number | null; count: number };
    total: { avg: number | null; p95: number | null; count: number };
  };
  outcomes: Record<string, number>;
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number | null) {
  return n == null ? '—' : `${n.toFixed(0)} ms`;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-3">
      <div className="text-xs uppercase tracking-wide text-white/45">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

function RankList({
  title,
  rows,
  labelKey,
}: {
  title: string;
  rows: Array<Record<string, string | number>>;
  labelKey: string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-white/70">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-white/40">Sin datos todavía.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, i) => (
            <li key={`${row[labelKey]}-${i}`} className="flex justify-between gap-4 text-sm">
              <span className="truncate text-white/80">{String(row[labelKey])}</span>
              <span className="shrink-0 tabular-nums text-white/50">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AssistantHealthPage() {
  const [report, setReport] = useState<AssistantHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<AssistantHealthReport>('/ai/telemetry/health', {
        authenticated: true,
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la telemetría');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-0">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-emerald-400/90">
            <Activity className="h-4 w-4" strokeWidth={1.75} />
            <span className="text-xs uppercase tracking-[0.2em]">Observabilidad</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Assistant Health</h1>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Telemetría pasiva del Asistente. No altera el comportamiento de producción.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/5"
        >
          Actualizar
        </button>
      </header>

      {loading && <p className="text-sm text-white/50">Cargando…</p>}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      {report && (
        <div className="space-y-10">
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi label="Success rate" value={pct(report.kpis.successRate)} />
            <Kpi label="Failure rate" value={pct(report.kpis.failureRate)} />
            <Kpi label="Clarification rate" value={pct(report.kpis.clarificationRate)} />
            <Kpi label="Confirmation rate" value={pct(report.kpis.confirmationRate)} />
            <Kpi label="Cancellation rate" value={pct(report.kpis.cancellationRate)} />
            <Kpi label="Recovery rate" value={pct(report.kpis.recoveryRate)} />
            <Kpi label="Replay rate" value={pct(report.kpis.replayRate)} />
            <Kpi label="Unknown intent %" value={pct(report.kpis.unknownIntentRate)} />
            <Kpi label="Avg provider latency" value={ms(report.kpis.avgProviderLatencyMs)} />
            <Kpi label="Avg planner latency" value={ms(report.kpis.avgPlannerLatencyMs)} />
            <Kpi label="Avg execution latency" value={ms(report.kpis.avgExecutionLatencyMs)} />
            <Kpi label="Events (replica)" value={String(report.eventCount)} />
          </div>

          <section className="space-y-3 border-t border-white/10 pt-6">
            <h2 className="text-sm font-medium text-white/70">Latency breakdown</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              {(
                [
                  ['Provider', report.latencyBreakdown.provider],
                  ['Planner', report.latencyBreakdown.planner],
                  ['Domain', report.latencyBreakdown.domain],
                  ['Total', report.latencyBreakdown.total],
                ] as const
              ).map(([label, slice]) => (
                <div key={label} className="space-y-1">
                  <div className="text-white/45">{label}</div>
                  <div className="text-white">
                    avg {ms(slice.avg)} · p95 {ms(slice.p95)} · n={slice.count}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-8 border-t border-white/10 pt-6 lg:grid-cols-2">
            <RankList title="Top failed intents" rows={report.topFailedIntents} labelKey="intent" />
            <RankList title="Top clarifications" rows={report.topClarifications} labelKey="type" />
            <RankList title="Top capabilities" rows={report.topCapabilities} labelKey="capability" />
            <RankList title="Top recovery causes" rows={report.topRecoveryCauses} labelKey="reason" />
          </div>

          <section className="space-y-2 border-t border-white/10 pt-6">
            <h2 className="text-sm font-medium text-white/70">Top slow queries</h2>
            {report.topSlowQueries.length === 0 ? (
              <p className="text-sm text-white/40">Sin datos todavía.</p>
            ) : (
              <ul className="space-y-1.5">
                {report.topSlowQueries.map((row) => (
                  <li key={row.capability} className="flex justify-between gap-4 text-sm">
                    <span className="text-white/80">{row.capability}</span>
                    <span className="tabular-nums text-white/50">
                      {row.avgTotalLatencyMs.toFixed(0)} ms · n={row.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2 border-t border-white/10 pt-6">
            <h2 className="text-sm font-medium text-white/70">Dangerous write verification</h2>
            <p className={`text-sm ${report.dangerousWriteVerification.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
              {report.dangerousWriteVerification.ok
                ? 'OK — SALE / RECEIVABLE_PAYMENT / EXPENSE show preview → confirmation before execution.'
                : `${report.dangerousWriteVerification.violations.length} reporting violation(s) (no behavior change).`}
            </p>
          </section>

          <p className="text-xs text-white/35">
            Generated {report.generatedAt}
            {report.passive ? ' · passive' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
