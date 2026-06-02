'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Client, MatchSuggestion, Watch } from '@/types/domain';

type Mode = 'watch' | 'client';

function scoreTone(score: number) {
  if (score >= 85) return 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10';
  if (score >= 70) return 'text-white/80 border-white/25 bg-white/8';
  if (score >= 55) return 'text-amber-200 border-amber-500/35 bg-amber-500/10';
  return 'text-muted border-white/15 bg-white/5';
}

function scoreLabel(score: number) {
  if (score >= 85) return 'Muy compatible';
  if (score >= 70) return 'Compatible';
  if (score >= 55) return 'Posible';
  return 'Baja compatibilidad';
}

export default function MatchingPage() {
  const [mode, setMode] = useState<Mode>('watch');
  const [watches, setWatches] = useState<Watch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedWatchId, setSelectedWatchId] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [includeDismissed, setIncludeDismissed] = useState(false);

  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [recalculating, setRecalculating] = useState<'all' | 'watch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const watchesById = useMemo(() => new Map(watches.map((watch) => [watch.id, watch])), [watches]);
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  const loadSelectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [watchData, clientData] = await Promise.all([
        apiGet<Watch[]>('/inventory', { authenticated: true }),
        apiGet<Client[]>('/crm/clients', { authenticated: true }),
      ]);
      setWatches(watchData);
      setClients(clientData);
      if (!selectedWatchId && watchData.length > 0) {
        setSelectedWatchId(watchData[0].id);
      }
      if (!selectedClientId && clientData.length > 0) {
        setSelectedClientId(clientData[0].id);
      }
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'No se pudieron cargar los datos.');
    } finally {
      setLoading(false);
    }
  }, [selectedClientId, selectedWatchId]);

  const loadSuggestions = useCallback(async () => {
    const activeWatchId = selectedWatchId;
    const activeClientId = selectedClientId;

    if (mode === 'watch' && !activeWatchId) {
      setSuggestions([]);
      return;
    }
    if (mode === 'client' && !activeClientId) {
      setSuggestions([]);
      return;
    }

    setSuggestionsLoading(true);
    setError(null);
    try {
      const query = includeDismissed ? { includeDismissed: true } : undefined;
      const data =
        mode === 'watch'
          ? await apiGet<MatchSuggestion[]>(`/matching/watches/${activeWatchId}/suggestions`, {
              authenticated: true,
              query,
            })
          : await apiGet<MatchSuggestion[]>(`/matching/clients/${activeClientId}/suggestions`, {
              authenticated: true,
              query,
            });

      const sorted = [...data].sort((a, b) => b.score - a.score);
      setSuggestions(sorted);
      if (mode === 'watch') {
        void queryKeys.matching.watchSuggestions(activeWatchId);
      } else {
        void queryKeys.matching.clientSuggestions(activeClientId);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : 'No se pudieron cargar las sugerencias.',
      );
    } finally {
      setSuggestionsLoading(false);
    }
  }, [includeDismissed, mode, selectedClientId, selectedWatchId]);

  useEffect(() => {
    void loadSelectors();
  }, [loadSelectors]);

  useEffect(() => {
    if (!loading) {
      void loadSuggestions();
    }
  }, [loading, loadSuggestions]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const recalculateAll = async () => {
    setRecalculating('all');
    try {
      await apiPost('/matching/recalculate', {}, { authenticated: true });
      setFlash({ type: 'success', message: 'Coincidencias recalculadas para todos los relojes.' });
      await loadSuggestions();
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message:
          caughtError instanceof ApiError ? caughtError.message : 'El recálculo falló.',
      });
    } finally {
      setRecalculating(null);
    }
  };

  const recalculateSelectedWatch = async () => {
    if (!selectedWatchId) return;
    setRecalculating('watch');
    try {
      await apiPost('/matching/recalculate', { watchId: selectedWatchId }, { authenticated: true });
      setFlash({ type: 'success', message: 'Coincidencias recalculadas para el reloj seleccionado.' });
      await loadSuggestions();
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message:
          caughtError instanceof ApiError ? caughtError.message : 'El recálculo del reloj falló.',
      });
    } finally {
      setRecalculating(null);
    }
  };

  const dismissSuggestion = async (suggestionId: string) => {
    try {
      await apiPatch(`/matching/suggestions/${suggestionId}/dismiss`, {}, { authenticated: true });
      setFlash({ type: 'success', message: 'Sugerencia descartada.' });
      await loadSuggestions();
    } catch (caughtError) {
      setFlash({
        type: 'error',
        message:
          caughtError instanceof ApiError ? caughtError.message : 'No se pudo descartar la sugerencia.',
      });
    }
  };

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Inteligencia de coincidencias</h1>
          <p className="ui-subtitle">
            Descubre las mejores oportunidades comprador-reloj en segundos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void recalculateAll()}
            disabled={recalculating !== null}
            className="ui-btn-secondary px-3 py-2"
          >
            {recalculating === 'all' ? 'Recalculando…' : 'Recalcular todo'}
          </button>
          <button
            type="button"
            onClick={() => void recalculateSelectedWatch()}
            disabled={recalculating !== null || !selectedWatchId}
            className="ui-btn-primary px-3 py-2"
          >
            {recalculating === 'watch' ? 'Recalculando…' : 'Recalcular reloj seleccionado'}
          </button>
        </div>
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

      <section className="ui-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="rounded-lg border border-white/10 p-1">
            <button
              type="button"
              onClick={() => setMode('watch')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === 'watch' ? 'bg-accent text-black font-semibold' : 'text-muted hover:bg-white/5 hover:text-white'
              }`}
            >
              Por reloj
            </button>
            <button
              type="button"
              onClick={() => setMode('client')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === 'client' ? 'bg-accent text-black font-semibold' : 'text-muted hover:bg-white/5 hover:text-white'
              }`}
            >
              Por cliente
            </button>
          </div>

          {mode === 'watch' ? (
            <label className="min-w-0 w-full flex-1 basis-full sm:min-w-[240px] sm:basis-auto">
              <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
                Seleccionar reloj
              </span>
              <select
                value={selectedWatchId}
                onChange={(event) => setSelectedWatchId(event.target.value)}
                className="ui-input"
              >
                {watches.map((watch) => (
                  <option key={watch.id} value={watch.id}>
                    {watch.brand} {watch.model}{watch.serialNumber ? ` · ${watch.serialNumber}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="min-w-0 w-full flex-1 basis-full sm:min-w-[240px] sm:basis-auto">
              <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
                Seleccionar cliente
              </span>
              <select
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                className="ui-input"
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(event) => setIncludeDismissed(event.target.checked)}
              className="h-4 w-4 rounded border-white/30 bg-surface"
            />
            Mostrar descartadas
          </label>
        </div>
      </section>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-12 rounded-xl bg-white/10" />
          <div className="h-20 rounded-xl bg-white/10" />
          <div className="h-20 rounded-xl bg-white/10" />
        </div>
      ) : error ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            type="button"
            onClick={() => void (loading ? loadSelectors() : loadSuggestions())}
            className="mt-3 underline"
          >
            Reintentar
          </button>
        </section>
      ) : (
        <section className="space-y-3">
          {suggestionsLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-24 rounded-xl bg-white/10" />
              <div className="h-24 rounded-xl bg-white/10" />
              <div className="h-24 rounded-xl bg-white/10" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-panel/60 p-12 text-center">
              <h2 className="text-lg font-semibold">Sin sugerencias por ahora</h2>
              <p className="mt-2 text-sm text-muted">
                Recalcula coincidencias o selecciona otro {mode === 'watch' ? 'reloj' : 'cliente'} para descubrir oportunidades.
              </p>
            </div>
          ) : (
            suggestions.map((suggestion) => {
              const client = clientsById.get(suggestion.clientId);
              const watch = watchesById.get(suggestion.watchId);
              return (
                <article key={suggestion.id} className="ui-card-soft transition hover:border-white/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        {client?.name ?? 'Unknown client'} ↔ {watch ? `${watch.brand} ${watch.model}` : 'Unknown watch'}
                      </h3>
                      <p className="mt-1 text-xs text-muted">
                        {watch?.serialNumber ? `S/N ${watch.serialNumber}` : 'Sin número de serie'} ·{' '}
                        {client?.budgetRange ?? 'Sin perfil de presupuesto'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${scoreTone(
                          suggestion.score,
                        )}`}
                      >
                        {suggestion.score} · {scoreLabel(suggestion.score)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void dismissSuggestion(suggestion.id)}
                        className="ui-btn-danger px-2 py-1 text-xs"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 rounded-lg border border-white/10 bg-surface/40 px-3 py-2 text-sm text-white/90">
                    {suggestion.reason}
                  </p>
                </article>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
