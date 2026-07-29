'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiBaseUrl } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';

type Props = {
  analysisId: string;
  tenantId: string;
  datasetId?: string | null;
};

type DatasetRow = {
  id: string;
  datasetVersion: string;
  fingerprintPrefix: string;
  readiness: string;
  frozenAt: string;
  entityCounts?: Record<string, number>;
  supersededByDatasetId?: string | null;
};

type DryRunSummary = {
  id: string;
  status: string;
  planReadiness: string | null;
  plannerVersion: string;
  planFingerprintPrefix: string | null;
  progressPhase: string | null;
  actionCounts: Record<string, number>;
  conflictCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  financialSummary: Record<string, unknown> | null;
  reconciliationSummary: {
    rows?: Array<Record<string, unknown>>;
    matched?: number;
    mismatch?: number;
  } | null;
  label: string;
  freshness?: {
    stale: boolean;
    affectedGroups: string[];
    message: string;
    approvable: boolean;
  };
};

type PlanItem = {
  id: string;
  entityGroup: string;
  entityType: string;
  sourceCandidateId: string;
  action: string;
  actionLabel: string;
  confidence: string | null;
  destinationId: string | null;
  dependencyKeys: string[] | null;
  conflictCode: string | null;
  conflictDetails: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
  plannedPayload: Record<string, unknown> | null;
};

const ENTITY_TABS = [
  { id: 'CUSTOMERS', label: 'Clientes' },
  { id: 'INVENTORY', label: 'Inventario' },
  { id: 'SALES', label: 'Ventas' },
  { id: 'RECEIVABLES', label: 'CXC' },
  { id: 'PAYABLES', label: 'CXP' },
  { id: 'EXPENSES', label: 'Gastos' },
  { id: 'CASH_LEDGER', label: 'Efectivo' },
  { id: 'BANK_LEDGER', label: 'Bancos' },
  { id: 'PARTNER_LEDGER', label: 'Capital/utilidades' },
  { id: 'DEFERRED', label: 'Diferidos' },
] as const;

function authHeaders(): Record<string, string> {
  const session = readSession();
  return session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {};
}

function actionClass(action: string) {
  if (action === 'CREATE') return 'text-emerald-300';
  if (action === 'LINK') return 'text-sky-300';
  if (action === 'SKIP') return 'text-zinc-400';
  if (action === 'CONFLICT') return 'text-amber-300';
  return 'text-violet-300';
}

export function WristCaviarSimulationPanel({ analysisId, tenantId, datasetId }: Props) {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(datasetId ?? null);
  const [dryRun, setDryRun] = useState<DryRunSummary | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [tab, setTab] = useState<(typeof ENTITY_TABS)[number]['id']>('CUSTOMERS');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [selected, setSelected] = useState<PlanItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  const base = useMemo(
    () => `${getApiBaseUrl()}/platform/migrations/wrist-caviar`,
    [],
  );

  const loadDatasets = useCallback(async () => {
    const res = await fetch(
      `${base}/${analysisId}/datasets?tenantId=${encodeURIComponent(tenantId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error(`datasets ${res.status}`);
    const json = (await res.json()) as DatasetRow[] | { items: DatasetRow[] };
    const list = Array.isArray(json) ? json : json.items ?? [];
    const ready = list.filter(
      (d) => d.readiness === 'READY_FOR_DRY_RUN' && !d.supersededByDatasetId,
    );
    setDatasets(ready.length ? ready : list.filter((d) => !d.supersededByDatasetId));
    if (!selectedDatasetId && ready[0]) setSelectedDatasetId(ready[0].id);
  }, [analysisId, base, selectedDatasetId, tenantId]);

  useEffect(() => {
    loadDatasets().catch((e) => setError(String(e)));
  }, [loadDatasets]);

  useEffect(() => {
    if (datasetId) setSelectedDatasetId(datasetId);
  }, [datasetId]);

  async function loadItems(dryRunId: string, entityGroup: string, action?: string) {
    const qs = new URLSearchParams({
      tenantId,
      entityGroup,
      page: '1',
      pageSize: '50',
    });
    if (action) qs.set('action', action);
    const res = await fetch(`${base}/dry-runs/${dryRunId}/items?${qs}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`items ${res.status}`);
    const json = (await res.json()) as { items: PlanItem[] };
    setItems(json.items);
  }

  async function generate() {
    if (!selectedDatasetId) {
      setError('Seleccione un dataset congelado.');
      return;
    }
    setBusy(true);
    setError(null);
    setPhase('Validando dataset');
    try {
      const phases = [
        'Validando dataset',
        'Comparando clientes',
        'Comparando inventario',
        'Preparando ventas históricas',
        'Simulando cuentas',
        'Calculando impacto financiero',
        'Conciliando contra REPORTE',
      ];
      let i = 0;
      const tick = setInterval(() => {
        i = Math.min(i + 1, phases.length - 1);
        setPhase(phases[i]);
      }, 400);

      const res = await fetch(
        `${base}/datasets/${selectedDatasetId}/dry-runs?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST', headers: authHeaders() },
      );
      clearInterval(tick);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `dry-run ${res.status}`);
      }
      const json = (await res.json()) as DryRunSummary;
      const full = await fetch(
        `${base}/dry-runs/${json.id}?tenantId=${encodeURIComponent(tenantId)}`,
        { headers: authHeaders() },
      );
      const detail = (await full.json()) as DryRunSummary;
      setDryRun(detail);
      setPhase(null);
      await loadItems(detail.id, tab, actionFilter || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function onTab(id: (typeof ENTITY_TABS)[number]['id']) {
    setTab(id);
    setSelected(null);
    if (dryRun) await loadItems(dryRun.id, id, actionFilter || undefined);
  }

  async function validateFreshness() {
    if (!dryRun) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${base}/dry-runs/${dryRun.id}/validate-freshness?tenantId=${encodeURIComponent(tenantId)}`,
        { method: 'POST', headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`freshness ${res.status}`);
      const freshness = await res.json();
      setDryRun((prev) => (prev ? { ...prev, freshness } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId) ?? null;
  const fs = (dryRun?.financialSummary ?? null) as Record<string, unknown> | null;
  const current = (fs?.current ?? {}) as Record<string, number>;
  const projected = (fs?.projected ?? {}) as Record<string, number>;

  const groupRows = ENTITY_TABS.map((t) => {
    const groupItems = items; // loaded per tab; summary from actionCounts overall
    void groupItems;
    return t;
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-sm text-zinc-300">
          Simulación; ningún dato ha sido modificado.
        </p>
        <h2 className="mt-2 text-lg font-medium text-white">8. Simulación</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Genera un plan determinístico CREATE / LINK / SKIP / CONFLICT / DEFERRED sin
          escribir registros operativos.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-zinc-400">Dataset congelado</span>
          <select
            className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-white"
            value={selectedDatasetId ?? ''}
            onChange={(e) => setSelectedDatasetId(e.target.value || null)}
          >
            <option value="">Seleccionar…</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.datasetVersion} · {d.fingerprintPrefix} · {d.readiness}
              </option>
            ))}
          </select>
        </label>
        {selectedDataset && (
          <div className="rounded-md border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
            <div>Versión: {selectedDataset.datasetVersion}</div>
            <div>Huella: {selectedDataset.fingerprintPrefix}…</div>
            <div>
              Congelado:{' '}
              {selectedDataset.frozenAt
                ? new Date(selectedDataset.frozenAt).toLocaleString('es-MX')
                : '—'}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !selectedDatasetId}
          onClick={() => void generate()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Generar simulación
        </button>
        {dryRun && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void validateFreshness()}
            className="rounded-md border border-white/20 px-4 py-2 text-sm text-zinc-200"
          >
            Validar vigencia
          </button>
        )}
      </div>

      {(busy || phase) && (
        <div className="text-sm text-amber-200">{phase ?? 'Procesando…'}</div>
      )}

      {dryRun?.freshness?.stale && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Plan desactualizado. Grupos afectados:{' '}
          {dryRun.freshness.affectedGroups.join(', ') || '—'}. Regenere la simulación.
        </div>
      )}

      {dryRun && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ['CREATE', 'Crear'],
                ['LINK', 'Vincular'],
                ['SKIP', 'Omitir'],
                ['CONFLICT', 'Conflictos'],
                ['DEFERRED', 'Diferidos'],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className="rounded-md border border-white/10 bg-black/30 p-3 text-center"
              >
                <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
                <div className={`mt-1 text-2xl font-semibold ${actionClass(key)}`}>
                  {dryRun.actionCounts?.[key] ?? 0}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-white/10">
            <table className="min-w-full text-left text-sm text-zinc-300">
              <thead className="bg-white/5 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Entidad</th>
                  <th className="px-3 py-2">Origen</th>
                  <th className="px-3 py-2">Estado plan</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((g) => (
                  <tr key={g.id} className="border-t border-white/5">
                    <td className="px-3 py-2">{g.label}</td>
                    <td className="px-3 py-2">
                      {typeof dryRun.sourceCounts?.[g.id.toLowerCase()] === 'number'
                        ? dryRun.sourceCounts[g.id.toLowerCase()]
                        : '—'}
                    </td>
                    <td className="px-3 py-2">{dryRun.planReadiness ?? dryRun.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fs && (
            <div className="rounded-md border border-white/10 bg-black/20 p-4">
              <h3 className="text-sm font-medium text-white">Impacto financiero (simulado)</h3>
              <p className="mt-1 text-xs text-zinc-500">{dryRun.label}</p>
              <div className="mt-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-3">
                {[
                  ['Clientes', current.clients, projected.clients],
                  ['Inventario', current.watches, projected.watches],
                  ['Ventas', current.deals, projected.deals],
                  ['Efectivo MXN', current.cashMxn, projected.cashMxn],
                  ['Efectivo USD', current.cashUsd, projected.cashUsd],
                  ['Bancos', current.bank, projected.bank],
                ].map(([label, cur, proj]) => (
                  <div key={String(label)} className="rounded border border-white/5 p-2">
                    <div className="text-xs text-zinc-500">{label}</div>
                    <div>
                      Actual {String(cur ?? 0)} + simulado = proyectado {String(proj ?? 0)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dryRun.reconciliationSummary?.rows && (
            <div className="overflow-x-auto rounded-md border border-white/10">
              <h3 className="bg-white/5 px-3 py-2 text-sm font-medium text-white">
                Conciliación REPORTE vs plan
              </h3>
              <table className="min-w-full text-left text-sm text-zinc-300">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2">REPORTE</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.reconciliationSummary.rows.map((r) => (
                    <tr key={String(r.concept)} className="border-t border-white/5">
                      <td className="px-3 py-2">{String(r.concept)}</td>
                      <td className="px-3 py-2">{String(r.approvedReporteValue ?? '—')}</td>
                      <td className="px-3 py-2">{String(r.dryRunPlannedValue ?? '—')}</td>
                      <td className="px-3 py-2">{String(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {ENTITY_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void onTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  tab === t.id
                    ? 'bg-white/15 text-white'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {['', 'CREATE', 'LINK', 'SKIP', 'CONFLICT', 'DEFERRED'].map((a) => (
              <button
                key={a || 'all'}
                type="button"
                onClick={() => {
                  setActionFilter(a);
                  if (dryRun) void loadItems(dryRun.id, tab, a || undefined);
                }}
                className={`rounded-md px-2 py-1 text-xs ${
                  actionFilter === a ? 'bg-white/15 text-white' : 'bg-white/5 text-zinc-400'
                }`}
              >
                {a || 'Todos'}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Acción</th>
                  <th className="px-3 py-2">Candidato</th>
                  <th className="px-3 py-2">Destino</th>
                  <th className="px-3 py-2">Conflicto</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                    onClick={() => setSelected(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelected(item);
                    }}
                    tabIndex={0}
                  >
                    <td className={`px-3 py-2 ${actionClass(item.action)}`}>
                      {item.actionLabel}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{item.sourceCandidateId}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {item.destinationId ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{item.conflictCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/50"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-zinc-950 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="mb-3 text-sm text-zinc-400"
              onClick={() => setSelected(null)}
            >
              Cerrar
            </button>
            <h3 className="text-lg text-white">{selected.actionLabel}</h3>
            <dl className="mt-4 space-y-2 text-sm text-zinc-300">
              <div>
                <dt className="text-zinc-500">Tipo</dt>
                <dd>{selected.entityType}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Candidato</dt>
                <dd className="font-mono text-xs">{selected.sourceCandidateId}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Dependencias</dt>
                <dd className="font-mono text-xs">
                  {(selected.dependencyKeys ?? []).join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Conflicto</dt>
                <dd>
                  {selected.conflictCode ?? '—'}
                  {selected.conflictDetails?.explanationEs
                    ? ` — ${String(selected.conflictDetails.explanationEs)}`
                    : ''}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Provenance</dt>
                <dd className="font-mono text-xs">
                  {JSON.stringify(selected.provenance)}
                </dd>
              </div>
            </dl>
            <p className="mt-6 text-xs text-zinc-500">
              Simulación; ningún dato ha sido modificado. No hay botón de importar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
