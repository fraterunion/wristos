'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { AutomationRule, AutomationRuleType, DealStage, WatchStatus } from '@/types/domain';

type RuleDraft = Record<string, { isEnabled: boolean; thresholdDays: string }>;

type AutomationRunResult = {
  staleDeals: Array<{ id: string; stage: DealStage; updatedAt: string; daysSinceUpdate: number }>;
  overduePayments: Array<{ id: string; dealId: string; amount: string; dueDate: string }>;
  agingInventory: Array<{
    id: string;
    brand: string;
    model: string;
    status: WatchStatus;
    createdAt: string;
    ageDays: number;
  }>;
  summary: {
    staleDealsCount: number;
    overduePaymentsCount: number;
    agingInventoryCount: number;
  };
};

function prettyRuleType(type: AutomationRuleType) {
  const labels: Record<AutomationRuleType, string> = {
    STALE_DEAL: 'Stale Deals',
    OVERDUE_PAYMENT: 'Overdue Payments',
    AGING_INVENTORY: 'Aging Inventory',
  };
  return labels[type];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(date);
}

function money(value: string) {
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [drafts, setDrafts] = useState<RuleDraft>({});
  const [runResult, setRunResult] = useState<AutomationRunResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const sortedRules = useMemo(
    () =>
      [...rules].sort((a, b) => {
        const order: AutomationRuleType[] = ['STALE_DEAL', 'OVERDUE_PAYMENT', 'AGING_INVENTORY'];
        return order.indexOf(a.type) - order.indexOf(b.type);
      }),
    [rules],
  );

  const hydrateDrafts = useCallback((nextRules: AutomationRule[]) => {
    const next: RuleDraft = {};
    nextRules.forEach((rule) => {
      next[rule.id] = {
        isEnabled: rule.isEnabled,
        thresholdDays: String(rule.thresholdDays),
      };
    });
    setDrafts(next);
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<AutomationRule[]>('/automations/rules', { authenticated: true });
      void queryKeys.automations.rules;
      setRules(data);
      hydrateDrafts(data);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Could not load automation rules.');
    } finally {
      setLoading(false);
    }
  }, [hydrateDrafts]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const updateDraft = (ruleId: string, patch: Partial<{ isEnabled: boolean; thresholdDays: string }>) => {
    setDrafts((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] ?? { isEnabled: true, thresholdDays: '1' }),
        ...patch,
      },
    }));
  };

  const saveRule = async (rule: AutomationRule) => {
    const draft = drafts[rule.id];
    if (!draft) return;
    const threshold = Number(draft.thresholdDays);
    if (!Number.isFinite(threshold) || threshold < 1 || !Number.isInteger(threshold)) {
      setFlash({
        type: 'error',
        message: `${prettyRuleType(rule.type)} threshold must be an integer >= 1.`,
      });
      return;
    }

    setSavingRuleId(rule.id);
    try {
      await apiPatch<AutomationRule>(
        `/automations/rules/${rule.id}`,
        {
          isEnabled: draft.isEnabled,
          thresholdDays: threshold,
        },
        { authenticated: true },
      );
      setFlash({ type: 'success', message: `${prettyRuleType(rule.type)} rule updated.` });
      await loadRules();
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message: caughtError instanceof ApiError ? caughtError.message : 'Could not update rule.',
      });
    } finally {
      setSavingRuleId(null);
    }
  };

  const runAutomations = async () => {
    setRunning(true);
    try {
      const result = await apiPost<AutomationRunResult>('/automations/run', {}, { authenticated: true });
      setRunResult(result);
      setFlash({ type: 'success', message: 'Automations run completed.' });
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message: caughtError instanceof ApiError ? caughtError.message : 'Automation run failed.',
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Automations</h1>
          <p className="ui-subtitle">
            Configure operational alerts and execute a manual intelligence sweep.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runAutomations()}
          disabled={running}
          className="ui-btn-primary px-4 py-2"
        >
          {running ? 'Running…' : 'Run Automations'}
        </button>
      </header>

      {flash ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            flash.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-100'
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      <section className="ui-card">
        <h2 className="text-lg font-semibold">Rule Configuration</h2>
        <p className="mt-1 text-sm text-muted">
          Tune thresholds and toggles for stale deals, overdue payments, and aging inventory.
        </p>

        {loading ? (
          <div className="mt-4 space-y-3 animate-pulse">
            <div className="h-16 rounded-lg bg-white/10" />
            <div className="h-16 rounded-lg bg-white/10" />
            <div className="h-16 rounded-lg bg-white/10" />
          </div>
        ) : error ? (
          <div className="mt-4 rounded-lg border border-rose-500/35 bg-rose-500/10 p-4 text-sm text-rose-100">
            <p>{error}</p>
            <button type="button" onClick={() => void loadRules()} className="mt-2 underline">
              Retry
            </button>
          </div>
        ) : rules.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/15 p-10 text-center">
            <p className="text-lg font-medium">No automation rules found</p>
            <p className="mt-2 text-sm text-muted">
              Seeded demo data normally includes all V1 rules. Verify your seed run if this is empty.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {sortedRules.map((rule) => {
              const draft = drafts[rule.id] ?? {
                isEnabled: rule.isEnabled,
                thresholdDays: String(rule.thresholdDays),
              };
              return (
                <article key={rule.id} className="ui-card-soft">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold">{prettyRuleType(rule.type)}</p>
                      <p className="mt-1 text-xs text-muted">Type: {rule.type}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-muted">
                        <input
                          type="checkbox"
                          checked={draft.isEnabled}
                          onChange={(event) =>
                            updateDraft(rule.id, { isEnabled: event.target.checked })
                          }
                          className="h-4 w-4 rounded border-white/30 bg-surface"
                        />
                        Enabled
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm text-muted">
                        Threshold days
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={draft.thresholdDays}
                          onChange={(event) =>
                            updateDraft(rule.id, { thresholdDays: event.target.value })
                          }
                          className="ui-input w-24 px-2 py-1.5"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void saveRule(rule)}
                        disabled={savingRuleId === rule.id}
                        className="ui-btn-secondary px-3 py-2"
                      >
                        {savingRuleId === rule.id ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="ui-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Latest Run Results</h2>
            <p className="mt-1 text-sm text-muted">
              Execute a manual run to surface immediate operational alerts.
            </p>
          </div>
          {runResult ? (
            <div className="rounded-lg border border-white/10 bg-surface/50 px-3 py-2 text-xs text-muted">
              Stale: {runResult.summary.staleDealsCount} · Overdue:{' '}
              {runResult.summary.overduePaymentsCount} · Aging:{' '}
              {runResult.summary.agingInventoryCount}
            </div>
          ) : null}
        </div>

        {!runResult ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/15 p-10 text-center">
            <p className="text-lg font-medium">No run results yet</p>
            <p className="mt-2 text-sm text-muted">
              Click <span className="font-medium text-white">Run Automations</span> to generate
              the latest operational signals.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <article className="ui-card-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Stale Deals</h3>
              <p className="mt-1 text-xs text-muted">Open deals with no recent updates.</p>
              <div className="mt-3 space-y-2">
                {runResult.staleDeals.length === 0 ? (
                  <p className="text-sm text-muted">No stale deals detected.</p>
                ) : (
                  runResult.staleDeals.map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/10 p-3">
                      <p className="text-sm font-medium">{item.stage.replaceAll('_', ' ')}</p>
                      <p className="mt-1 text-xs text-muted">
                        {item.daysSinceUpdate} days since update · {formatDate(item.updatedAt)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="ui-card-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Overdue Payments
              </h3>
              <p className="mt-1 text-xs text-muted">Pending payments past due date.</p>
              <div className="mt-3 space-y-2">
                {runResult.overduePayments.length === 0 ? (
                  <p className="text-sm text-muted">No overdue payments detected.</p>
                ) : (
                  runResult.overduePayments.map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/10 p-3">
                      <p className="text-sm font-medium">{money(item.amount)}</p>
                      <p className="mt-1 text-xs text-muted">
                        Deal {item.dealId.slice(0, 8)} · Due {formatDate(item.dueDate)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="ui-card-soft">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Aging Inventory
              </h3>
              <p className="mt-1 text-xs text-muted">Unsold watches beyond threshold.</p>
              <div className="mt-3 space-y-2">
                {runResult.agingInventory.length === 0 ? (
                  <p className="text-sm text-muted">No aging inventory detected.</p>
                ) : (
                  runResult.agingInventory.map((item) => (
                    <div key={item.id} className="rounded-lg border border-white/10 p-3">
                      <p className="text-sm font-medium">
                        {item.brand} {item.model}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {item.ageDays} days old · {item.status.replaceAll('_', ' ')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>
        )}
      </section>
    </div>
  );
}
