'use client';

import { useEffect, useMemo, useState } from 'react';

import { getApiBaseUrl } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';

type Props = {
  analysisId: string;
  tenantId: string;
  onReadinessChange?: (r: string) => void;
};

type ReviewSummary = {
  reviewVersion: number;
  readiness: string;
  unresolvedCritical: number;
  unresolvedBlocking: number;
  unresolvedManual: number;
  acknowledgedWarnings: number;
  activeResolutionCount: number;
  approvedEntityGroups: number;
  deferredEntityGroups: number;
  approvals: Array<{
    entityGroup: string;
    status: string;
    reason: string | null;
  }>;
  latestDataset: {
    id: string;
    datasetVersion: string;
    fingerprintPrefix: string;
  } | null;
  recommendations: { DEFERRED: string[] };
};

const QUEUES = [
  { id: 'cxc', label: 'Cuentas por cobrar' },
  { id: 'cxp', label: 'Cuentas por pagar' },
  { id: 'customers', label: 'Clientes' },
  { id: 'serials', label: 'Series' },
  { id: 'financial', label: 'Finanzas' },
  { id: 'deferred', label: 'Diferidos' },
] as const;

const ENTITY_GROUPS = [
  'CUSTOMERS',
  'INVENTORY',
  'SALES',
  'RECEIVABLES',
  'PAYABLES',
  'EXPENSES',
  'CASH_LEDGER',
  'BANK_LEDGER',
  'PARTNER_LEDGER',
  'PROFIT_DISTRIBUTIONS',
  'DEFERRED',
] as const;

function authHeaders(): Record<string, string> {
  const session = readSession();
  return session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {};
}

export function WristCaviarReviewPanel({ analysisId, tenantId, onReadinessChange }: Props) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [queue, setQueue] = useState<(typeof QUEUES)[number]['id']>('cxc');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'review' | 'approval'>('review');

  const base = useMemo(
    () =>
      `${getApiBaseUrl()}/platform/migrations/wrist-caviar/${analysisId}`,
    [analysisId],
  );

  async function refreshSummary() {
    const res = await fetch(`${base}/review-summary?tenantId=${tenantId}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`review-summary ${res.status}`);
    const json = (await res.json()) as ReviewSummary;
    setSummary(json);
    onReadinessChange?.(json.readiness);
  }

  async function loadQueue(id: (typeof QUEUES)[number]['id']) {
    setQueue(id);
    setSelected(null);
    const path =
      id === 'cxc'
        ? 'review/cxc'
        : id === 'cxp'
          ? 'review/cxp'
          : id === 'customers'
            ? 'review/customers'
            : id === 'serials'
              ? 'review/serials'
              : id === 'financial'
                ? 'review/financial'
                : 'review/financial';
    const res = await fetch(`${base}/${path}?tenantId=${tenantId}&pageSize=50`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`queue ${res.status}`);
    const json = await res.json();
    if (id === 'serials' || id === 'financial' || id === 'deferred') {
      setItems(json.issues ?? json.reconciliation ?? []);
    } else {
      setItems(json.items ?? []);
    }
  }

  useEffect(() => {
    refreshSummary()
      .then(() => loadQueue('cxc'))
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId, tenantId]);

  async function resolve(payload: Record<string, unknown>) {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/resolutions?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedReviewVersion: summary.reviewVersion,
          reason: reason || undefined,
          ...payload,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `resolution ${res.status}`);
      }
      setReason('');
      setSelected(null);
      await refreshSummary();
      await loadQueue(queue);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo resolver');
    } finally {
      setBusy(false);
    }
  }

  async function approve(group: string, status: 'APPROVED' | 'DEFERRED') {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${base}/entity-approvals/${group}?tenantId=${tenantId}`,
        {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedReviewVersion: summary.reviewVersion,
            status,
            reason:
              status === 'DEFERRED'
                ? reason || `Deferred pending WristOS destination (${group})`
                : reason || undefined,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.message === 'string'
            ? body.message
            : JSON.stringify(body.message ?? body),
        );
      }
      await refreshSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar');
    } finally {
      setBusy(false);
    }
  }

  async function freeze() {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/freeze?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedReviewVersion: summary.reviewVersion }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.message === 'string'
            ? body.message
            : JSON.stringify(body.message ?? body),
        );
      }
      await refreshSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo congelar');
    } finally {
      setBusy(false);
    }
  }

  if (!summary) {
    return <p className="text-sm text-zinc-400">Cargando revisión…</p>;
  }

  return (
    <div className="space-y-4" data-testid="review-panel">
      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Críticos sin resolver', value: summary.unresolvedCritical, tone: 'text-red-300' },
          { label: 'Bloqueantes', value: summary.unresolvedBlocking, tone: 'text-red-300' },
          { label: 'Manual', value: summary.unresolvedManual, tone: 'text-amber-300' },
          { label: 'Resueltos/ack', value: summary.acknowledgedWarnings, tone: 'text-emerald-300' },
          { label: 'Grupos aprobados', value: summary.approvedEntityGroups, tone: 'text-emerald-300' },
          { label: 'Resoluciones', value: summary.activeResolutionCount, tone: 'text-zinc-200' },
        ].map((c) => (
          <div key={c.label} className="rounded-lg bg-zinc-950 p-3 ring-1 ring-zinc-800">
            <div className="text-xs text-zinc-500">{c.label}</div>
            <div className={`mt-1 text-xl font-semibold ${c.tone}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs ${mode === 'review' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}
          onClick={() => setMode('review')}
        >
          Colas de revisión
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs ${mode === 'approval' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'}`}
          onClick={() => setMode('approval')}
          data-testid="approvals-tab"
        >
          Aprobación de entidades
        </button>
      </div>

      {mode === 'review' ? (
        <>
          <div className="flex flex-wrap gap-2">
            {QUEUES.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => loadQueue(q.id).catch((e) => setError(String(e)))}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  queue === q.id ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="max-h-[28rem] space-y-2 overflow-y-auto" data-testid="review-queue">
              {items.map((item, idx) => (
                <button
                  key={String(item.id ?? idx)}
                  type="button"
                  onClick={() => setSelected(item)}
                  className="block w-full rounded-md bg-zinc-950 px-3 py-2 text-left text-sm ring-1 ring-zinc-800 hover:ring-zinc-600"
                >
                  <div className="text-xs text-zinc-500">
                    {String(
                      item.sourceLabel ??
                        item.sourceSheet ??
                        item.taxonomyCode ??
                        item.concept ??
                        'item',
                    )}
                  </div>
                  <div className="mt-1 text-zinc-200">
                    {String(
                      item.customerName ??
                        item.creditorName ??
                        item.displayName ??
                        item.message ??
                        item.concept ??
                        item.id ??
                        'Registro',
                    )}
                  </div>
                </button>
              ))}
              {!items.length ? (
                <p className="text-sm text-zinc-500">Sin elementos en esta cola.</p>
              ) : null}
            </div>

            <aside
              className="rounded-xl bg-zinc-950 p-4 ring-1 ring-zinc-800"
              data-testid="resolution-drawer"
            >
              <h3 className="text-sm font-medium text-white">Resolución</h3>
              {!selected ? (
                <p className="mt-2 text-xs text-zinc-500">Selecciona un ítem.</p>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-zinc-500">Dato del Excel · </span>
                      <span className="text-zinc-300">
                        {String(
                          selected.declaredOutstanding ??
                            selected.declaredRemaining ??
                            selected.principal ??
                            selected.declaredProfit ??
                            '—',
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Calculado por WristOS · </span>
                      <span className="text-zinc-300">
                        {String(
                          selected.calculatedOutstanding ??
                            selected.calculatedRemaining ??
                            selected.calculatedProfit ??
                            '—',
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-emerald-400">Valor aprobado · </span>
                      <span className="text-emerald-200">pendiente de acción</span>
                    </div>
                  </div>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Motivo / notas"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                    rows={3}
                  />
                  <div className="flex flex-col gap-2">
                    {queue === 'cxc' || queue === 'cxp' ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                          onClick={() =>
                            resolve({
                              issueId: Array.isArray(selected.issues)
                                ? (selected.issues[0] as { id?: string })?.id
                                : undefined,
                              entityType: queue === 'cxc' ? 'receivable' : 'payable',
                              candidateId: selected.id,
                              resolutionType: 'ACCEPT_AS_IS',
                            })
                          }
                        >
                          Aceptar parseo
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 disabled:opacity-40"
                          onClick={() =>
                            resolve({
                              issueId: Array.isArray(selected.issues)
                                ? (selected.issues[0] as { id?: string })?.id
                                : undefined,
                              entityType: queue === 'cxc' ? 'receivable' : 'payable',
                              candidateId: selected.id,
                              resolutionType: 'EXCLUDE_FROM_MIGRATION',
                              reason: reason || 'Excluded non-record / empty block',
                            })
                          }
                        >
                          Excluir de migración
                        </button>
                        {queue === 'cxp' ? (
                          <button
                            type="button"
                            disabled={busy || !reason.trim()}
                            className="rounded-md bg-amber-600/80 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                            onClick={() =>
                              resolve({
                                issueId: Array.isArray(selected.issues)
                                  ? (selected.issues[0] as { id?: string })?.id
                                  : undefined,
                                entityType: 'payable',
                                candidateId: selected.id,
                                resolutionType: 'CONFIRM_FORMULA_OVERRIDE',
                                reason,
                                resolvedValue: {
                                  declaredRemaining: selected.calculatedRemaining,
                                },
                              })
                            }
                          >
                            Override de fórmula (requiere motivo)
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {queue === 'customers' ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100"
                          onClick={() =>
                            resolve({
                              entityType: 'customer',
                              candidateId: selected.id,
                              resolutionType: 'KEEP_SEPARATE',
                            })
                          }
                        >
                          Mantener separado
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white"
                          onClick={() =>
                            resolve({
                              entityType: 'customer',
                              resolutionType: 'CHOOSE_CANONICAL_NAME',
                              candidateId: selected.id,
                              resolvedValue: {
                                canonicalName: selected.displayName,
                              },
                            })
                          }
                        >
                          Usar nombre canónico
                        </button>
                      </>
                    ) : null}
                    {queue === 'serials' || queue === 'financial' ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-md bg-amber-600/80 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        onClick={() =>
                          resolve({
                            issueId: selected.id,
                            resolutionType:
                              String(selected.taxonomyCode) === 'CXP_FORMULA_ERROR'
                                ? 'CONFIRM_FORMULA_OVERRIDE'
                                : String(selected.taxonomyCode)?.includes('SCOPE') ||
                                    String(selected.concept)
                                  ? 'CONFIRM_SCOPE_DIFFERENCE'
                                  : 'ACKNOWLEDGE_WARNING',
                            reason:
                              reason ||
                              (String(selected.taxonomyCode) === 'CXP_FORMULA_ERROR'
                                ? 'Verified cached residual; formula ignored'
                                : 'Acknowledged during review'),
                            resolvedValue: selected.concept
                              ? { concept: selected.concept }
                              : undefined,
                            entityType: selected.concept ? 'reconciliation' : undefined,
                          })
                        }
                      >
                        Resolver / acusar recibo
                      </button>
                    ) : null}
                    {queue === 'deferred' || queue === 'financial' ? (
                      <button
                        type="button"
                        disabled={busy || !reason.trim()}
                        className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 disabled:opacity-40"
                        onClick={() =>
                          resolve({
                            issueId: selected.id,
                            resolutionType: 'DEFER',
                            reason,
                            candidateId: selected.id,
                          })
                        }
                      >
                        Diferir
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : (
        <div className="space-y-3" data-testid="approvals-panel">
          <p className="text-xs text-zinc-500">
            Recomendación: diferir CRIPTO CESAR y OSCAR PAPA CAMI ({summary.recommendations.DEFERRED.join(', ')}).
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de diferido / notas de aprobación"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
            rows={2}
          />
          <div className="space-y-2">
            {ENTITY_GROUPS.map((g) => {
              const a = summary.approvals.find((x) => x.entityGroup === g);
              return (
                <div
                  key={g}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-zinc-950 px-3 py-2 ring-1 ring-zinc-800"
                >
                  <div>
                    <div className="text-sm text-zinc-100">{g}</div>
                    <div className="text-xs text-zinc-500">{a?.status ?? 'NOT_REVIEWED'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-40"
                      onClick={() => approve(g, 'APPROVED')}
                    >
                      Aprobar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md bg-zinc-700 px-2 py-1 text-xs text-zinc-100 disabled:opacity-40"
                      onClick={() => approve(g, 'DEFERRED')}
                    >
                      Diferir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={busy}
            data-testid="freeze-button"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            onClick={() => freeze()}
          >
            Congelar dataset para dry-run
          </button>
          {summary.latestDataset ? (
            <p className="text-xs text-emerald-300" data-testid="frozen-dataset">
              Congelado: {summary.latestDataset.datasetVersion} · fingerprint{' '}
              {summary.latestDataset.fingerprintPrefix}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
