'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FileUp, Plus } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import {
  createDataImportSession,
  listDataImportSessions,
} from '@/lib/data-onboarding-api';
import type { DataImportSession } from '@/types/data-onboarding';

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

export default function DataOnboardingPage() {
  const [sessions, setSessions] = useState<DataImportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const session = await createDataImportSession();
      window.location.href = `/data-onboarding/${session.id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la importación.');
      setCreating(false);
    }
  };

  return (
    <div className="ui-page">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Onboarding de datos</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Importa los datos de tu negocio. Sube archivos PDF, Excel, CSV o JSON. WristOS los
            analizará y preparará para revisión antes de importar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCreate()}
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

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-white/10" />
      ) : sessions.length === 0 ? (
        <article className="ui-card flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-white/5 p-4">
            <FileUp className="h-8 w-8 text-white/50" />
          </div>
          <h2 className="text-lg font-medium text-white">Importa los datos de tu negocio</h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            Sube archivos PDF, Excel, CSV o JSON. WristOS los analizará y preparará para revisión
            antes de importar.
          </p>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="ui-btn-primary mt-6"
          >
            Nueva importación
          </button>
        </article>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/data-onboarding/${session.id}`}
              className="ui-card-soft block transition hover:border-white/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-white">
                    {session.title ?? `Importación ${session.id.slice(0, 8)}`}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(session.createdAt).toLocaleString('es-MX')} · {session.totalFiles}{' '}
                    archivos · {session.totalRows} filas
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/80">
                  {statusLabel(session.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
