'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FileUp, Plus, ShoppingBag, Boxes } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import {
  createDataImportSession,
  listDataImportSessions,
} from '@/lib/data-onboarding-api';
import type { DataImportSession, DataImportTarget } from '@/types/data-onboarding';

function statusLabel(status: DataImportSession['status']) {
  const map: Record<DataImportSession['status'], string> = {
    CREATED: 'Creada',
    UPLOADING: 'Subiendo archivos',
    PROCESSING: 'Procesando',
    READY_FOR_REVIEW: 'Lista para revisión',
    IMPORTING: 'Importando',
    COMPLETED: 'Completada',
    FAILED: 'Fallida',
    CANCELLED: 'Cancelada',
  };
  return map[status] ?? status;
}

function targetLabel(target: DataImportTarget | undefined) {
  return target === 'SALES' ? 'Ventas históricas' : 'Inventario';
}

export default function DataOnboardingPage() {
  const [sessions, setSessions] = useState<DataImportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await listDataImportSessions());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las importaciones.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (importTarget: DataImportTarget) => {
    setCreating(true);
    setError(null);
    try {
      const title = importTarget === 'SALES' ? 'Ventas históricas' : 'Inventario';
      const session = await createDataImportSession({ title, importTarget });
      window.location.href = `/data-onboarding/${session.id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la importación.');
      setCreating(false);
      setChooserOpen(false);
    }
  };

  return (
    <div className="ui-page">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Onboarding de datos</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Migra datos históricos en bloque. Las ventas diarias futuras siguen usándose desde Ventas.
            Elige inventario o ventas históricas, sube PDF/Excel/CSV y revisa antes de importar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setChooserOpen(true)}
          disabled={creating}
          className="ui-btn-primary inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          {creating ? 'Creando…' : 'Nueva importación'}
        </button>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {chooserOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-white">Tipo de importación</h2>
            <p className="mt-2 text-sm text-muted">
              Selecciona el flujo. Inventario y ventas históricas no se mezclan en la misma sesión.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate('INVENTORY')}
                className="rounded-xl border border-white/15 bg-white/[0.03] p-4 text-left transition hover:border-white/30"
              >
                <Boxes className="h-5 w-5 text-white/60" />
                <p className="mt-3 text-sm font-medium text-white">Inventario</p>
                <p className="mt-1 text-xs text-muted">Stock actual · PDF facturas / CSV / XLSX</p>
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate('SALES')}
                className="rounded-xl border border-white/15 bg-white/[0.03] p-4 text-left transition hover:border-white/30"
              >
                <ShoppingBag className="h-5 w-5 text-white/60" />
                <p className="mt-3 text-sm font-medium text-white">Ventas históricas</p>
                <p className="mt-1 text-xs text-muted">Migración del histórico · hoja VENTAS / PDF</p>
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="ui-btn-secondary"
                disabled={creating}
                onClick={() => setChooserOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-white/10" />
      ) : sessions.length === 0 ? (
        <article className="ui-card flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-white/5 p-4">
            <FileUp className="h-8 w-8 text-white/50" />
          </div>
          <h2 className="text-lg font-medium text-white">Importa los datos de tu negocio</h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            Sube archivos PDF, Excel o CSV. WristOS los analizará y preparará para revisión antes de
            importar.
          </p>
          <button
            type="button"
            onClick={() => setChooserOpen(true)}
            disabled={creating}
            className="ui-btn-primary mt-6 inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Nueva importación
          </button>
        </article>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/data-onboarding/${session.id}`}
              className="ui-card flex items-center justify-between gap-4 transition hover:border-white/25"
            >
              <div>
                <p className="font-medium text-white">{session.title ?? 'Importación'}</p>
                <p className="mt-1 text-xs text-muted">
                  {targetLabel(session.importTarget)} · {statusLabel(session.status)} ·{' '}
                  {session.totalRows} filas · {new Date(session.createdAt).toLocaleString()}
                </p>
              </div>
              <span className="text-xs text-accent">Abrir →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
