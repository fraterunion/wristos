'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, Loader2, UploadCloud, XCircle } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import {
  commitImport,
  downloadErrorReport,
  getDataImportSession,
  getImportMapping,
  listDataImportRecords,
  processDataImportSession,
  runDryRun,
  saveImportMapping,
  uploadDataImportFile,
} from '@/lib/data-onboarding-api';
import type {
  CommitResult,
  DataImportFile,
  DataImportRecord,
  DataImportSessionDetail,
  DryRunSummary,
  DuplicatePolicy,
  MappingEntry,
  MappingProposal,
  MappingResponse,
  ValidationIssue,
  WatchImportField,
} from '@/types/data-onboarding';
import { SKIP_FIELD } from '@/types/data-onboarding';

// ─── Constants ──────────────────────────────────────────────────────────────

const WATCH_FIELD_LABELS: Record<WatchImportField | typeof SKIP_FIELD, string> = {
  [SKIP_FIELD]: '— Ignorar —',
  brand: 'Marca',
  model: 'Modelo',
  reference: 'Referencia',
  serialNumber: 'Número de Serie',
  condition: 'Condición',
  ownershipType: 'Tipo de Propiedad',
  costCurrency: 'Moneda del Costo',
  cost: 'Costo',
  priceMin: 'Precio Mínimo',
  priceMax: 'Precio Máximo',
  status: 'Status',
  consignmentOwnerName: 'Propietario (Consignación)',
  consignmentSplitPercentage: 'Split % (Consignación)',
  imageUrl: 'URL de Imagen',
};

const ALL_TARGET_FIELDS: Array<WatchImportField | typeof SKIP_FIELD> = [
  SKIP_FIELD, 'brand', 'model', 'reference', 'serialNumber', 'condition',
  'ownershipType', 'costCurrency', 'cost', 'priceMin', 'priceMax', 'status',
  'consignmentOwnerName', 'consignmentSplitPercentage', 'imageUrl',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function confidenceBadge(confidence: MappingProposal['confidence']) {
  if (confidence === 'HIGH') return <span className="ml-2 rounded px-1 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-300">AUTO</span>;
  if (confidence === 'MEDIUM') return <span className="ml-2 rounded px-1 py-0.5 text-[10px] bg-amber-500/20 text-amber-300">SUGERIDO</span>;
  return null;
}

function rowStateBadge(state: string) {
  if (state === 'VALID') return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-emerald-500/15 text-emerald-300"><CheckCircle2 className="h-3 w-3" />VÁLIDO</span>;
  if (state === 'WARNING') return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-amber-500/15 text-amber-300"><AlertTriangle className="h-3 w-3" />ADVERTENCIA</span>;
  return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-rose-500/15 text-rose-300"><XCircle className="h-3 w-3" />INVÁLIDO</span>;
}

function deriveRowState(record: DataImportRecord): 'VALID' | 'WARNING' | 'INVALID' {
  if (!record.isValid) return 'INVALID';
  if (record.validationWarnings && Array.isArray(record.validationWarnings) && (record.validationWarnings as ValidationIssue[]).length > 0) return 'WARNING';
  return 'VALID';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'amber' | 'red' }) {
  const color = accent === 'green' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : accent === 'red' ? 'text-rose-300' : 'text-white';
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${color}`}>{value}</p>
    </article>
  );
}

// ─── Step: Upload ─────────────────────────────────────────────────────────────

function UploadStep({
  session, onFilesSelected, onProcess, uploading, processing,
}: {
  session: DataImportSessionDetail;
  onFilesSelected: (files: FileList | null) => Promise<void>;
  onProcess: () => Promise<void>;
  uploading: boolean;
  processing: boolean;
}) {
  const canProcess = session.totalFiles > 0 && !uploading && !processing &&
    session.status !== 'PROCESSING' && session.status !== 'IMPORTING' && session.status !== 'COMPLETED';
  const hasFile = session.totalFiles >= 1;
  const uploadDisabled = uploading || processing || hasFile ||
    session.status === 'PROCESSING' || session.status === 'IMPORTING' || session.status === 'COMPLETED';

  return (
    <>
      <section className="ui-card mb-8">
        <h2 className="text-sm font-medium text-white">1 · Subir archivo</h2>
        <p className="mt-1 text-xs text-muted">
          XLSX, CSV · máx. 25 MB · máx. 5,000 filas · un archivo por sesión
        </p>
        <label className={`mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-10 transition ${uploadDisabled ? 'opacity-40' : 'cursor-pointer hover:border-white/30'}`}>
          <UploadCloud className="h-8 w-8 text-white/40" />
          <span className="mt-3 text-sm text-white/80">
            {uploading
              ? 'Subiendo…'
              : hasFile
                ? 'Esta sesión ya tiene un archivo. Crea una nueva sesión para importar otro.'
                : 'Arrastra un archivo o haz clic para seleccionar'}
          </span>
          <input
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            disabled={uploadDisabled}
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
        </label>
      </section>

      {session.files.length > 0 && (
        <section className="ui-card mb-8">
          <h2 className="mb-4 text-sm font-medium text-white">Archivos</h2>
          <div className="space-y-3">
            {session.files.map((file: DataImportFile) => (
              <div key={file.id} className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">{file.originalFilename}</p>
                  <span className="text-xs text-muted">{file.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {file.fileType} · {formatBytes(file.byteSize)} · {file.detectedEntityType} · {file.rowCount} filas
                </p>
                {file.errorMessage && <p className="mt-2 text-xs text-rose-200/90">{file.errorMessage}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => void onProcess()}
        disabled={!canProcess}
        className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
      >
        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {processing ? 'Procesando…' : '2 · Analizar archivo'}
      </button>
    </>
  );
}

// ─── Step: Mapping ────────────────────────────────────────────────────────────

function MappingStep({
  session, onMappingDone,
}: {
  session: DataImportSessionDetail;
  onMappingDone: () => Promise<void>;
}) {
  const inventoryFile = session.files.find((f) => f.detectedEntityType === 'INVENTORY') ?? session.files[0];
  const [mappingResp, setMappingResp] = useState<MappingResponse | null>(null);
  const [localMapping, setLocalMapping] = useState<MappingEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inventoryFile) return;
    void (async () => {
      try {
        const resp = await getImportMapping(session.id, inventoryFile.id);
        setMappingResp(resp);
        setLocalMapping(resp.mapping);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Error cargando el mapping.');
      }
    })();
  }, [session.id, inventoryFile]);

  const proposalByColumn = useMemo(() => {
    const map = new Map<string, MappingProposal>();
    for (const p of mappingResp?.proposals ?? []) {
      map.set(p.sourceColumn, p);
    }
    return map;
  }, [mappingResp]);

  const updateEntry = (sourceColumn: string, targetField: WatchImportField | typeof SKIP_FIELD) => {
    setLocalMapping((prev) =>
      prev.map((e) => e.sourceColumn === sourceColumn ? { ...e, targetField } : e),
    );
  };

  const handleSaveAndValidate = async () => {
    if (!inventoryFile) return;
    setSaving(true);
    setError(null);
    try {
      await saveImportMapping(session.id, inventoryFile.id, localMapping);
      await runDryRun(session.id);
      await onMappingDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al guardar el mapping o ejecutar validación.');
    } finally {
      setSaving(false);
    }
  };

  if (!inventoryFile) {
    return <p className="text-sm text-muted">No hay archivos de inventario en esta sesión.</p>;
  }
  if (!mappingResp) {
    return <div className="h-40 animate-pulse rounded-xl bg-white/10" />;
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Mapeo de columnas</h2>
        <p className="mt-1 text-sm text-muted">
          Asigna cada columna del archivo a un campo de inventario. Las columnas marcadas{' '}
          <span className="rounded bg-emerald-500/20 px-1 text-emerald-300 text-xs">AUTO</span>{' '}
          fueron detectadas automáticamente.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <section className="ui-card mb-8">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-muted">
                <th className="px-4 py-3">Columna del archivo</th>
                <th className="px-4 py-3">Ejemplos</th>
                <th className="px-4 py-3">Campo destino</th>
              </tr>
            </thead>
            <tbody>
              {localMapping.map((entry) => {
                const proposal = proposalByColumn.get(entry.sourceColumn);
                const samples = proposal?.sampleValues.slice(0, 2).filter(Boolean) ?? [];
                return (
                  <tr key={entry.sourceColumn} className="border-b border-white/5">
                    <td className="px-4 py-3 font-medium text-white">
                      {entry.sourceColumn}
                      {proposal && proposal.confidence !== 'NONE' && confidenceBadge(proposal.confidence)}
                    </td>
                    <td className="px-4 py-3 text-muted max-w-[14rem] truncate">
                      {samples.join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <select
                          value={entry.targetField}
                          onChange={(e) => updateEntry(entry.sourceColumn, e.target.value as WatchImportField | typeof SKIP_FIELD)}
                          className="w-full appearance-none rounded-lg border border-white/15 bg-surface px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:border-white/30"
                        >
                          {ALL_TARGET_FIELDS.map((f) => (
                            <option key={f} value={f}>{WATCH_FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <button
        type="button"
        onClick={() => void handleSaveAndValidate()}
        disabled={saving}
        className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {saving ? 'Guardando y validando…' : 'Guardar mapeo y ejecutar validación'}
      </button>
    </>
  );
}

// ─── Step: Dry-run preview ─────────────────────────────��──────────────────────

function DryRunStep({
  session, onEditMapping, onConfirm, onRunDryRun,
}: {
  session: DataImportSessionDetail;
  onEditMapping: () => void;
  onConfirm: () => void;
  onRunDryRun: () => Promise<void>;
}) {
  const [records, setRecords] = useState<DataImportRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rowFilter, setRowFilter] = useState<'ALL' | 'VALID' | 'WARNING' | 'INVALID'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reRunning, setReRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadRecords = useCallback(async (p: number, filter: typeof rowFilter) => {
    setLoading(true);
    try {
      const q: Record<string, string | number> = { page: p, limit: 30, entityType: 'INVENTORY' };
      if (filter !== 'ALL') q.rowStatus = filter;
      const result = await listDataImportRecords(session.id, q);
      setRecords(result.records);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error cargando registros.');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadRecords(page, rowFilter);
  }, [loadRecords, page, rowFilter]);

  const handleFilter = (f: typeof rowFilter) => {
    setPage(1);
    setRowFilter(f);
  };

  const handleReRun = async () => {
    setReRunning(true);
    try {
      await onRunDryRun();
    } finally {
      setReRunning(false);
    }
  };

  const handleDownloadReport = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadErrorReport(session.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error de red al descargar el reporte de errores.');
    } finally {
      setDownloading(false);
    }
  };

  const previewColumns = useMemo(() => {
    const first = records[0];
    if (!first) return [];
    const norm = first.normalizedData as Record<string, unknown> | null;
    if (norm) return Object.keys(norm).filter((k) => !['costOriginalAmount', 'costExchangeRate'].includes(k)).slice(0, 6);
    return Object.keys(first.rawData).slice(0, 6);
  }, [records]);

  const totalPages = Math.ceil(total / 30);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Resultados de validación</h2>
          <p className="mt-1 text-sm text-muted">Revisa los errores antes de importar.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onEditMapping} className="ui-btn-secondary text-xs">
            Editar mapeo
          </button>
          <button type="button" onClick={() => void handleReRun()} disabled={reRunning} className="ui-btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-40">
            {reRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Re-validar
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total de filas" value={String(session.totalRows)} />
        <StatCard label="Válidas" value={String(session.validRows)} accent="green" />
        <StatCard label="Con advertencias" value={String(session.warningRows)} accent="amber" />
        <StatCard label="Inválidas" value={String(session.invalidRows)} accent="red" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['ALL', 'VALID', 'WARNING', 'INVALID'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => handleFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${rowFilter === f ? 'bg-white/20 text-white' : 'text-muted hover:text-white'}`}
          >
            {f === 'ALL' ? 'Todas' : f === 'VALID' ? 'Válidas' : f === 'WARNING' ? 'Con advertencias' : 'Inválidas'}
          </button>
        ))}
        {session.invalidRows > 0 && (
          <button
            type="button"
            onClick={() => void handleDownloadReport()}
            disabled={downloading}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-white disabled:opacity-40"
          >
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {downloading ? 'Descargando…' : 'Descargar reporte de errores'}
          </button>
        )}
      </div>

      <section className="ui-card mb-8">
        {loading ? (
          <div className="h-40 animate-pulse rounded-xl bg-white/10" />
        ) : records.length === 0 ? (
          <p className="text-sm text-muted">No hay filas en este filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-muted">
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">Estado</th>
                  {previewColumns.map((col) => (
                    <th key={col} className="px-3 py-2">{col}</th>
                  ))}
                  <th className="px-3 py-2">Errores / Advertencias</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const state = deriveRowState(record);
                  const dataSource = (record.normalizedData as Record<string, unknown> | null) ?? record.rawData;
                  const errors = (record.validationErrors as ValidationIssue[] | null) ?? [];
                  const warnings = (record.validationWarnings as ValidationIssue[] | null) ?? [];
                  return (
                    <tr key={record.id} className="border-b border-white/5 text-white/80 align-top">
                      <td className="px-3 py-2">{record.sourceRowNumber ?? '—'}</td>
                      <td className="px-3 py-2">{rowStateBadge(state)}</td>
                      {previewColumns.map((col) => (
                        <td key={col} className="max-w-[10rem] truncate px-3 py-2" title={String(dataSource[col] ?? '')}>
                          {String(dataSource[col] ?? '')}
                        </td>
                      ))}
                      <td className="px-3 py-2 max-w-[20rem]">
                        {errors.length > 0 && (
                          <ul className="space-y-0.5">
                            {errors.slice(0, 3).map((e, i) => (
                              <li key={i} className="text-rose-300">{e.message}</li>
                            ))}
                          </ul>
                        )}
                        {warnings.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {warnings.slice(0, 2).map((w, i) => (
                              <li key={i} className="text-amber-300/80">{w.message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="hover:text-white disabled:opacity-30">← Anterior</button>
            <span>Página {page} de {totalPages}</span>
            <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="hover:text-white disabled:opacity-30">Siguiente →</button>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Hasta{' '}
          <span className="text-white font-medium">{session.validRows + session.warningRows}</span>{' '}
          filas elegibles ({session.validRows} válidas + {session.warningRows} con advertencias).{' '}
          <span className="text-rose-300">{session.invalidRows} inválidas</span> serán omitidas.
          Los números de serie que ya existen en el inventario siempre se omiten.
        </p>
        <button
          type="button"
          onClick={onConfirm}
          disabled={session.validRows + session.warningRows === 0}
          className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
        >
          Confirmar importación →
        </button>
      </div>
    </>
  );
}

// ─── Step: Confirm ────────────────────────────────────────────────────────────

function ConfirmStep({
  session, onBack, onCommit,
}: {
  session: DataImportSessionDetail;
  onBack: () => void;
  onCommit: (policy: DuplicatePolicy) => Promise<void>;
}) {
  const [policy, setPolicy] = useState<DuplicatePolicy>('SKIP_DUPLICATES');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      await onCommit(policy);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al importar.');
      setCommitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="mb-6 text-lg font-semibold text-white">Confirmar importación</h2>

      {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Válidas" value={String(session.validRows)} accent="green" />
        <StatCard label="Con advertencias" value={String(session.warningRows)} accent="amber" />
        <StatCard label="Inválidas (omitidas)" value={String(session.invalidRows)} accent="red" />
      </div>

      <section className="ui-card mb-6">
        <h3 className="mb-4 text-sm font-medium text-white">Política de duplicados</h3>
        <p className="mb-4 text-xs text-muted">
          Los números de serie que ya existen en el inventario nunca se importan; esas filas
          siempre se omiten, sin importar la política elegida.
        </p>
        <div className="space-y-3">
          {([
            { value: 'SKIP_DUPLICATES', label: 'Omitir duplicados', desc: 'Omite las series ya existentes en el inventario y también las filas marcadas como posible duplicado.' },
            { value: 'IMPORT_AS_NEW', label: 'Importar posibles duplicados', desc: 'Importa las filas marcadas como posible duplicado (por ejemplo, series repetidas dentro del archivo). Las series que ya existen en el inventario se omiten igualmente.' },
          ] as const).map((opt) => (
            <label key={opt.value} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${policy === opt.value ? 'border-white/30 bg-white/[0.04]' : 'border-white/10 hover:border-white/20'}`}>
              <input
                type="radio"
                name="duplicatePolicy"
                value={opt.value}
                checked={policy === opt.value}
                onChange={() => setPolicy(opt.value)}
                className="mt-0.5 accent-white"
              />
              <div>
                <p className="text-sm font-medium text-white">{opt.label}</p>
                <p className="mt-0.5 text-xs text-muted">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="ui-btn-secondary">
          ← Volver
        </button>
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={committing}
          className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
        >
          {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {committing ? 'Importando…' : 'Importar ahora'}
        </button>
      </div>
    </div>
  );
}

// ─── Step: Completed ──────────────────────────────────────────────────────────

function CompletedStep({ result, session }: { result: CommitResult | null; session: DataImportSessionDetail }) {
  const imported = result?.importedCount ?? session.importedRows;
  const skipped = result?.skippedCount ?? 0;
  const failed = result?.failedCount ?? 0;

  return (
    <div className="text-center py-12">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
      <h2 className="mt-4 text-xl font-semibold text-white">Importación completada</h2>
      <p className="mt-2 text-sm text-muted">Los relojes han sido creados en el inventario.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3 text-left max-w-sm mx-auto">
        <StatCard label="Importados" value={String(imported)} accent="green" />
        <StatCard label="Omitidos" value={String(skipped)} />
        <StatCard label="Fallidos" value={String(failed)} accent={failed > 0 ? 'red' : undefined} />
      </div>
      <Link href="/inventory" className="mt-8 inline-block text-sm text-muted hover:text-white">
        Ver inventario →
      </Link>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type UIStep = 'upload' | 'mapping' | 'dryrun' | 'confirm' | 'importing' | 'completed';

export default function DataOnboardingSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<DataImportSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStep, setLocalStep] = useState<'dryrun' | 'confirm' | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await getDataImportSession(sessionId);
      setSession(detail);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la sesión.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const step: UIStep = useMemo(() => {
    if (!session) return 'upload';
    if (session.status === 'COMPLETED') return 'completed';
    if (session.status === 'IMPORTING') return 'importing';
    if (session.status === 'READY_FOR_REVIEW') {
      if (localStep === 'confirm') return 'confirm';
      if (localStep === 'dryrun' || session.dryRunVersion) return 'dryrun';
      return 'mapping';
    }
    return 'upload';
  }, [session, localStep]);

  const onFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      // V1: one file per session (backend enforces this too).
      await uploadDataImportFile(sessionId, fileList[0]);
      if (fileList.length > 1) {
        setError('Esta versión permite un solo archivo por sesión; se subió únicamente el primero.');
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

  const onMappingDone = async () => {
    await load();
    setLocalStep('dryrun');
  };

  const onRunDryRun = async () => {
    await runDryRun(sessionId);
    await load();
    setLocalStep('dryrun');
  };

  const onCommit = async (policy: DuplicatePolicy) => {
    const result = await commitImport(sessionId, policy);
    setCommitResult(result);
    await load();
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

  const stepLabels: Record<UIStep, string> = {
    upload: 'Subir y procesar',
    mapping: 'Mapeo de columnas',
    dryrun: 'Validación',
    confirm: 'Confirmar importación',
    importing: 'Importando…',
    completed: 'Completado',
  };

  return (
    <div className="ui-page">
      <Link href="/data-onboarding" className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Volver a importaciones
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">
          {session.title ?? 'Importación de inventario'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {stepLabels[step]}
          {' · '}
          <span className="font-medium text-white/70">{session.status}</span>
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {step === 'upload' && (
        <UploadStep
          session={session}
          onFilesSelected={onFilesSelected}
          onProcess={onProcess}
          uploading={uploading}
          processing={processing}
        />
      )}

      {step === 'mapping' && (
        <MappingStep session={session} onMappingDone={onMappingDone} />
      )}

      {step === 'dryrun' && (
        <DryRunStep
          session={session}
          onEditMapping={() => { setLocalStep(null); }}
          onConfirm={() => setLocalStep('confirm')}
          onRunDryRun={onRunDryRun}
        />
      )}

      {step === 'confirm' && (
        <ConfirmStep
          session={session}
          onBack={() => setLocalStep('dryrun')}
          onCommit={onCommit}
        />
      )}

      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-white/40" />
          <p className="text-sm text-muted">Importando relojes…</p>
        </div>
      )}

      {step === 'completed' && (
        <CompletedStep result={commitResult} session={session} />
      )}
    </div>
  );
}
