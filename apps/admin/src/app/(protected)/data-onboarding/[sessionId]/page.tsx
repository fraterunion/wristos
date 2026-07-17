'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, UploadCloud } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import {
  getDataImportSession,
  listDataImportRecords,
  processDataImportSession,
  uploadDataImportFile,
} from '@/lib/data-onboarding-api';
import type { DataImportFile, DataImportRecord, DataImportSessionDetail } from '@/types/data-onboarding';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </article>
  );
}

export default function DataOnboardingSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<DataImportSessionDetail | null>(null);
  const [records, setRecords] = useState<DataImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, recordPage] = await Promise.all([
        getDataImportSession(sessionId),
        listDataImportRecords(sessionId, { limit: 20 }),
      ]);
      setSession(detail);
      setRecords(recordPage.records);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la sesión.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewColumns = useMemo(() => {
    const first = records[0];
    if (!first) return [];
    return Object.keys(first.rawData).slice(0, 6);
  }, [records]);

  const onFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        await uploadDataImportFile(sessionId, file);
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al subir archivos.');
    } finally {
      setUploading(false);
    }
  };

  const onProcess = async () => {
    setProcessing(true);
    setError(null);
    try {
      await processDataImportSession(sessionId);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al procesar la sesión.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading && !session) {
    return <div className="ui-page h-40 animate-pulse rounded-xl bg-white/10" />;
  }

  if (!session) {
    return (
      <div className="ui-page">
        <p className="text-sm text-rose-200">{error ?? 'Sesión no encontrada.'}</p>
      </div>
    );
  }

  return (
    <div className="ui-page">
      <Link href="/data-onboarding" className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Volver a importaciones
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            {session.title ?? 'Importación de datos'}
          </h1>
          <p className="mt-2 text-sm text-muted">Estado: {session.status}</p>
        </div>
        <button
          type="button"
          onClick={() => void onProcess()}
          disabled={
            processing ||
            uploading ||
            session.totalFiles === 0 ||
            session.status === 'PROCESSING' ||
            session.status === 'IMPORTING' ||
            session.status === 'COMPLETED'
          }
          className="ui-btn-primary inline-flex items-center gap-2"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Procesar archivos
        </button>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Archivos" value={String(session.totalFiles)} />
        <StatCard label="Filas detectadas" value={String(session.totalRows)} />
        <StatCard label="Filas válidas" value={String(session.validRows)} />
        <StatCard label="Filas con alertas" value={String(session.invalidRows)} />
      </div>

      <p className="mb-8 text-xs text-muted">
        Fase 1: los datos se preparan en staging. Nada se importa todavía a inventario, CRM ni
        finanzas.
      </p>

      <section className="ui-card mb-8">
        <h2 className="text-sm font-medium text-white">Subir archivos</h2>
        <p className="mt-1 text-xs text-muted">PDF, XLSX, CSV, JSON · máx. 25 MB por archivo</p>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-10 transition hover:border-white/30">
          <UploadCloud className="h-8 w-8 text-white/40" />
          <span className="mt-3 text-sm text-white/80">
            {uploading ? 'Subiendo…' : 'Arrastra archivos o haz clic para seleccionar'}
          </span>
          <input
            type="file"
            multiple
            accept=".pdf,.xlsx,.csv,.json,application/pdf,application/json,text/csv"
            className="hidden"
            disabled={
              uploading ||
              processing ||
              session.status === 'PROCESSING' ||
              session.status === 'IMPORTING' ||
              session.status === 'COMPLETED'
            }
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
        </label>
      </section>

      <section className="ui-card mb-8">
        <h2 className="mb-4 text-sm font-medium text-white">Archivos</h2>
        {session.files.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay archivos en esta sesión.</p>
        ) : (
          <div className="space-y-3">
            {session.files.map((file: DataImportFile) => (
              <div
                key={file.id}
                className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">{file.originalFilename}</p>
                  <span className="text-xs text-muted">{file.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {file.fileType} · {formatBytes(file.byteSize)} · {file.detectedEntityType} ·{' '}
                  {file.rowCount} filas
                </p>
                {file.pdfPhase1Message ? (
                  <p className="mt-2 text-xs text-amber-200/90">{file.pdfPhase1Message}</p>
                ) : null}
                {file.errorMessage && !file.pdfPhase1Message ? (
                  <p className="mt-2 text-xs text-rose-200/90">{file.errorMessage}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ui-card">
        <h2 className="mb-4 text-sm font-medium text-white">Vista previa (datos crudos)</h2>
        {records.length === 0 ? (
          <p className="text-sm text-muted">
            Procesa los archivos para ver filas normalizadas en staging. No se escribe nada en
            inventario, CRM ni finanzas en esta fase.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-muted">
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">Tipo</th>
                  {previewColumns.map((col) => (
                    <th key={col} className="px-3 py-2">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b border-white/5 text-white/80">
                    <td className="px-3 py-2">{record.sourceRowNumber ?? '—'}</td>
                    <td className="px-3 py-2">{record.entityType}</td>
                    {previewColumns.map((col) => (
                      <td key={col} className="max-w-[12rem] truncate px-3 py-2" title={String(record.rawData[col] ?? '')}>
                        {String(record.rawData[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
