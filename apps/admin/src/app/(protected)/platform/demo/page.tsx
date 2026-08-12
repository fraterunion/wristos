'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { readSession, writeSession } from '@/lib/auth-storage';
import type { LoginResponse } from '@/types/auth';

type TenantMembership = {
  tenantId: string;
  name: string;
  slug: string;
  isDemo: boolean;
};

type ResetResult = {
  tenantId: string;
  tenantSlug: string;
  durationMs: number;
};

export default function PlatformDemoPage() {
  const [tenants, setTenants] = useState<TenantMembership[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const currentTenantId = readSession()?.user.tenantId ?? null;

  const loadTenants = useCallback(async () => {
    try {
      const data = await apiGet<TenantMembership[]>('/auth/tenants', { authenticated: true });
      setTenants(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'No se pudieron cargar los tenants (requiere PLATFORM_ADMIN).',
      );
      setTenants(null);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const onSwitchTenant = async (tenantId: string) => {
    setSwitching(tenantId);
    try {
      const session = await apiPost<LoginResponse, { tenantId: string }>(
        '/auth/switch-tenant',
        { tenantId },
        { authenticated: true },
      );
      writeSession(session);
      window.location.href = '/dashboard';
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'No se pudo cambiar de tenant.');
      setSwitching(null);
    }
  };

  const onReset = async () => {
    setResetting(true);
    setResetError(null);
    setResetResult(null);
    try {
      const result = await apiPost<ResetResult>('/platform/demo/reset', undefined, { authenticated: true });
      setResetResult(result);
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : 'No se pudo reiniciar el tenant demo (requiere PLATFORM_ADMIN).',
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-0">
      <header className="mb-8 border-b border-white/10 pb-6">
        <div className="mb-2 flex items-center gap-2 text-emerald-400/90">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          <span className="text-xs uppercase tracking-[0.2em]">Demo</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">WristOS Demo</h1>
        <p className="mt-2 max-w-xl text-sm text-white/55">
          Cambia entre tenants a los que tienes acceso y reinicia el tenant demo a su estado
          base. Solo PLATFORM_ADMIN.
        </p>
      </header>

      <section className="mb-10 space-y-3 border-b border-white/10 pb-8">
        <h2 className="text-sm font-medium text-white/70">Cambiar de tenant</h2>
        {loadError && <p className="text-sm text-rose-400">{loadError}</p>}
        {!tenants && !loadError && <p className="text-sm text-white/50">Cargando…</p>}
        {tenants && (
          <ul className="space-y-2">
            {tenants.map((t) => {
              const isCurrent = t.tenantId === currentTenantId;
              return (
                <li
                  key={t.tenantId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{t.name}</span>
                      {t.isDemo && (
                        <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                          Demo
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-white/40">{t.slug}</span>
                  </div>
                  {isCurrent ? (
                    <span className="shrink-0 text-xs text-emerald-400">Activo</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onSwitchTenant(t.tenantId)}
                      disabled={switching === t.tenantId}
                      className="ui-btn-ghost shrink-0 px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {switching === t.tenantId ? 'Cambiando…' : 'Cambiar'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-white/70">Reiniciar tenant demo</h2>
        <p className="text-sm text-white/55">
          Elimina únicamente los datos operativos del tenant demo y vuelve a ejecutar el seed
          determinístico. No afecta a ningún otro tenant.
        </p>
        <button
          type="button"
          onClick={() => void onReset()}
          disabled={resetting}
          className="ui-btn-ghost flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${resetting ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          {resetting ? 'Reiniciando…' : 'Reset Demo'}
        </button>
        {resetError && <p className="text-sm text-rose-400">{resetError}</p>}
        {resetResult && (
          <p className="text-sm text-emerald-400">
            Listo — tenant {resetResult.tenantSlug} reiniciado en {resetResult.durationMs} ms.
          </p>
        )}
      </section>
    </div>
  );
}
