'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, Loader2, RefreshCw, Trash2, UploadCloud, XCircle } from 'lucide-react';

import { SalesExtractionReviewStep } from '@/components/data-onboarding/SalesExtractionReviewStep';
import { ApiError } from '@/lib/api-client';
import {
  commitImport,
  downloadErrorReport,
  fetchPdfFileBlob,
  getDataImportSession,
  getDocumentExtraction,
  getImportMapping,
  listDataImportRecords,
  processDataImportSession,
  processDocument,
  reprocessDocument,
  runDryRun,
  saveImportMapping,
  updateDocumentExtraction,
  uploadDataImportFile,
} from '@/lib/data-onboarding-api';
import {
  IMPORT_FILE_ACCEPT,
  IMPORT_FILE_HELPER_TEXT,
  IMPORT_FILE_REJECT_MESSAGE,
  isAcceptedImportFile,
  isPdfImportSession,
} from '@/lib/import-file-validation';
import { entityTypeForSession, SALES_IMPORT_FIELD_OPTIONS } from '@/lib/sales-onboarding-helpers';
import type {
  CommitResult,
  DataImportFile,
  DataImportRecord,
  DataImportSessionDetail,
  DocumentExtractionResponse,
  DuplicatePolicy,
  ExtractedWatch,
  InventoryInvoiceExtraction,
  MappingEntry,
  MappingProposal,
  MappingResponse,
  SalesImportField,
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

// ─── Extraction error UX ─────────────────────────────────────────────────────

type ExtractionErrorUX = { title: string; description: string; action: string };

function parseExtractionError(errorJson: string | null): { code: string; safeMessage: string } | null {
  if (!errorJson) return null;
  try {
    const parsed = JSON.parse(errorJson) as { code?: unknown; safeMessage?: unknown };
    if (typeof parsed.code === 'string') {
      return {
        code: parsed.code,
        safeMessage: typeof parsed.safeMessage === 'string' ? parsed.safeMessage : 'Error de extracción.',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getExtractionErrorUX(code: string, safeMessage: string): ExtractionErrorUX {
  switch (code) {
    case 'EXTRACTION_OUTPUT_TRUNCATED':
      return {
        title: 'Factura demasiado extensa',
        description: 'La factura tiene más información de la que el sistema puede procesar en una extracción.',
        action: 'Divide la factura en partes más pequeñas (menos relojes por página) y vuelve a intentarlo.',
      };
    case 'EXTRACTION_PDF_ENCRYPTED':
      return {
        title: 'PDF protegido con contraseña',
        description: 'Este PDF está protegido con contraseña y no puede ser leído por el sistema.',
        action: 'Descarga o guarda una copia sin protección de contraseña y vuelve a subirla.',
      };
    case 'EXTRACTION_PDF_CORRUPT':
      return {
        title: 'Archivo PDF dañado',
        description: 'El archivo PDF no se puede abrir o está incompleto.',
        action: 'Verifica el archivo original y sube una copia nueva.',
      };
    case 'EXTRACTION_TIMEOUT':
      return {
        title: 'Tiempo de espera agotado',
        description: 'El servicio de extracción con IA tardó demasiado en responder.',
        action: 'Espera un momento e intenta extraer de nuevo.',
      };
    case 'EXTRACTION_RATE_LIMITED':
      return {
        title: 'Límite de solicitudes alcanzado',
        description: 'Se han realizado demasiadas solicitudes en poco tiempo.',
        action: 'Espera unos minutos e intenta de nuevo.',
      };
    case 'EXTRACTION_PROVIDER_UNAVAILABLE':
      return {
        title: 'Servicio no disponible',
        description: 'El servicio de inteligencia artificial no está disponible temporalmente.',
        action: 'Intenta de nuevo más tarde.',
      };
    case 'EXTRACTION_SCHEMA_INVALID':
    case 'EXTRACTION_NO_TOOL_RESPONSE':
      return {
        title: 'Formato de respuesta inesperado',
        description: 'El modelo de IA devolvió una respuesta con un formato incorrecto.',
        action: 'Intenta extraer de nuevo. Si el problema persiste, contacta a soporte.',
      };
    case 'EXTRACTION_PAGE_LIMIT_EXCEEDED':
      return {
        title: 'PDF con demasiadas páginas',
        description: 'El PDF supera el número máximo de páginas permitido por extracción.',
        action: 'Divide el PDF en documentos más cortos y vuelve a intentarlo.',
      };
    default:
      return {
        title: 'Error al procesar el PDF',
        description: safeMessage,
        action: 'Intenta extraer de nuevo.',
      };
  }
}

function ExtractionErrorBanner({ errorJson }: { errorJson: string | null }) {
  const parsed = parseExtractionError(errorJson);
  if (!parsed) return null;
  const ux = getExtractionErrorUX(parsed.code, parsed.safeMessage);
  return (
    <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-rose-200">{ux.title}</p>
          <p className="mt-1 text-sm text-rose-200/80">{ux.description}</p>
          <p className="mt-2 text-xs text-rose-300/70">{ux.action}</p>
        </div>
      </div>
    </div>
  );
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

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceDot({ score }: { score?: number }) {
  if (score === undefined) return null;
  const color = score >= 0.9 ? 'bg-emerald-400' : score >= 0.5 ? 'bg-amber-400' : 'bg-rose-400';
  return <span title={`Confianza: ${Math.round(score * 100)}%`} className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

// ─── Step: PDF Upload ─────────────────────────────────────────────────────────

function PdfUploadStep({
  session,
  onFilesSelected,
  onExtract,
  uploading,
  extracting,
}: {
  session: DataImportSessionDetail;
  onFilesSelected: (files: FileList | null) => Promise<void>;
  onExtract: () => Promise<void>;
  uploading: boolean;
  extracting: boolean;
}) {
  const hasFile = session.totalFiles >= 1;
  const pdfFile = session.files.find((f) => f.fileType === 'PDF');
  const uploadDisabled = uploading || extracting || hasFile;
  const canExtract = hasFile && !uploading && !extracting;

  return (
    <>
      <section className="ui-card mb-8">
        <h2 className="text-sm font-medium text-white">1 · Subir factura PDF</h2>
        <p className="mt-1 text-xs text-muted">
          PDF · máx. 25 MB · un archivo por sesión
        </p>
        <label className={`mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-6 py-10 transition ${uploadDisabled ? 'opacity-40' : 'cursor-pointer hover:border-white/30'}`}>
          <UploadCloud className="h-8 w-8 text-white/40" />
          <span className="mt-3 text-sm text-white/80">
            {uploading
              ? 'Subiendo…'
              : hasFile
                ? 'Esta sesión ya tiene un archivo. Crea una nueva sesión para importar otro.'
                : 'Arrastra un PDF o haz clic para seleccionar'}
          </span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            disabled={uploadDisabled}
            onChange={(e) => void onFilesSelected(e.target.files)}
          />
        </label>
      </section>

      {pdfFile && (
        <section className="ui-card mb-8">
          <h2 className="mb-4 text-sm font-medium text-white">Archivo</h2>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-white">{pdfFile.originalFilename}</p>
              <span className="text-xs text-muted">{pdfFile.status}</span>
            </div>
            <p className="mt-1 text-xs text-muted">PDF · {(pdfFile.byteSize / 1024 / 1024).toFixed(1)} MB</p>
            <ExtractionErrorBanner errorJson={pdfFile.extractionError} />
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => void onExtract()}
        disabled={!canExtract}
        className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
      >
        {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {extracting ? 'Extrayendo con IA…' : '2 · Extraer datos con IA'}
      </button>
    </>
  );
}

// ─── Confirm Reprocess Modal ─────────────────────────────────────────────────

function ConfirmReprocessModal({ onConfirm, onCancel }: { onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
          <h2 className="text-base font-semibold text-white">¿Descartar ediciones manuales?</h2>
        </div>
        <p className="mb-6 text-sm text-muted">
          Has editado manualmente la extracción. Al re-extraer el PDF se sobrescribirán esos cambios y no podrán recuperarse.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="ui-btn-secondary disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={confirming}
            className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirming ? 'Re-extrayendo…' : 'Sí, re-extraer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step: Extraction Review ──────────────────────────────────────────────────

function isInventoryExtraction(
  extraction: DocumentExtractionResponse['extraction'] | undefined,
): extraction is InventoryInvoiceExtraction {
  return Boolean(extraction && 'watches' in extraction);
}

function ExtractionReviewStep({
  session,
  onValidate,
  onReprocess,
}: {
  session: DataImportSessionDetail;
  onValidate: () => Promise<void>;
  onReprocess: () => Promise<void>;
}) {
  const pdfFile = session.files.find((f) => f.fileType === 'PDF');
  const [extraction, setExtraction] = useState<DocumentExtractionResponse | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const resp = await getDocumentExtraction(session.id);
        setExtraction(resp);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Error cargando la extracción.');
      }
    })();
  }, [session.id]);

  useEffect(() => {
    if (!pdfFile) return;
    void (async () => {
      try {
        const blob = await fetchPdfFileBlob(session.id, pdfFile.id);
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPdfUrl(url);
      } catch {
        // PDF preview optional — extraction review still usable without it
      }
    })();
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, [session.id, pdfFile]);

  const handleDeleteWatch = async (index: number) => {
    if (!isInventoryExtraction(extraction?.extraction)) return;
    const updated: InventoryInvoiceExtraction = {
      ...extraction!.extraction,
      watches: extraction!.extraction.watches.filter((_, i) => i !== index),
    };
    setSaving(true);
    setError(null);
    try {
      await updateDocumentExtraction(session.id, updated);
      setExtraction((prev) => prev ? { ...prev, extraction: updated, watchCount: updated.watches.length } : prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al actualizar la extracción.');
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    try {
      await onValidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al validar.');
      setValidating(false);
    }
  };

  const handleReprocess = async () => {
    setReprocessing(true);
    setError(null);
    try {
      await onReprocess();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al re-extraer.');
      setReprocessing(false);
    }
  };

  if (!extraction) {
    return <div className="h-40 animate-pulse rounded-xl bg-white/10" />;
  }

  const inv = isInventoryExtraction(extraction.extraction) ? extraction.extraction : null;
  const watches = inv?.watches ?? [];
  const invoice = inv?.invoice;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Revisión de extracción IA</h2>
          <p className="mt-1 text-sm text-muted">
            {watches.length} {watches.length === 1 ? 'reloj extraído' : 'relojes extraídos'} ·{' '}
            {extraction.extractionProvider && (
              <span className="text-white/60">{extraction.extractionProvider} / {extraction.extractionModel}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleReprocess()}
          disabled={reprocessing || saving}
          className="ui-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-40"
        >
          {reprocessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Re-extraer PDF
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      <ExtractionErrorBanner errorJson={extraction.extractionError} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: PDF preview */}
        <div>
          {pdfUrl ? (
            <div className="aspect-[3/4] rounded-xl border border-white/10 overflow-hidden">
              <object data={pdfUrl} type="application/pdf" className="h-full w-full">
                <p className="p-4 text-xs text-muted">No se puede mostrar el PDF en este navegador.</p>
              </object>
            </div>
          ) : (
            <div className="aspect-[3/4] flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02]">
              <p className="text-xs text-muted">Cargando previsualización…</p>
            </div>
          )}
        </div>

        {/* Right: Invoice metadata + watch cards */}
        <div className="space-y-4 overflow-y-auto max-h-[70vh] pr-1">
          {invoice && (
            <section className="ui-card">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Factura</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {invoice.supplierName && (
                  <><dt className="text-muted">Proveedor</dt><dd className="text-white">{invoice.supplierName}</dd></>
                )}
                {invoice.invoiceNumber && (
                  <><dt className="text-muted">No. factura</dt><dd className="text-white">{invoice.invoiceNumber}</dd></>
                )}
                {invoice.invoiceDate && (
                  <><dt className="text-muted">Fecha</dt><dd className="text-white">{invoice.invoiceDate}</dd></>
                )}
                {invoice.currency && (
                  <><dt className="text-muted">Moneda</dt><dd className="text-white">{invoice.currency}</dd></>
                )}
              </dl>
              {invoice.notes && <p className="mt-2 text-xs text-muted/80 italic">{invoice.notes}</p>}
            </section>
          )}

          {watches.length === 0 ? (
            <p className="text-sm text-muted">No se extrajeron relojes. Puedes re-extraer el PDF.</p>
          ) : (
            watches.map((watch, i) => (
              <WatchExtractionCard
                key={i}
                watch={watch}
                index={i}
                onDelete={() => void handleDeleteWatch(i)}
                disabled={saving}
              />
            ))
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleValidate()}
          disabled={validating || watches.length === 0}
          className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-40"
        >
          {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {validating ? 'Validando…' : 'Validar y continuar →'}
        </button>
        <p className="text-xs text-muted">
          {watches.length} reloj{watches.length !== 1 ? 'es' : ''} · las filas con errores se marcan en el paso siguiente
        </p>
      </div>
    </>
  );
}

function WatchExtractionCard({
  watch, index, onDelete, disabled,
}: {
  watch: ExtractedWatch;
  index: number;
  onDelete: () => void;
  disabled: boolean;
}) {
  const c = watch.confidence ?? {};
  const formatPrice = (v?: number) => v !== undefined ? `$${v.toLocaleString('es-MX')}` : '—';

  return (
    <section className="ui-card relative">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">Reloj #{index + 1}</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-rose-300 disabled:opacity-40"
          title="Eliminar este reloj"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted flex items-center">Marca<ConfidenceDot score={c.brand} /></dt>
        <dd className="text-white font-medium">{watch.brand ?? '—'}</dd>
        <dt className="text-muted flex items-center">Modelo<ConfidenceDot score={c.model} /></dt>
        <dd className="text-white">{watch.model ?? '—'}</dd>
        {watch.referenceNumber && (
          <>
            <dt className="text-muted flex items-center">Referencia<ConfidenceDot score={c.referenceNumber} /></dt>
            <dd className="text-white">{watch.referenceNumber}</dd>
          </>
        )}
        {watch.serialNumber && (
          <>
            <dt className="text-muted flex items-center">Serie<ConfidenceDot score={c.serialNumber} /></dt>
            <dd className="text-white">{watch.serialNumber}</dd>
          </>
        )}
        {watch.condition && (
          <>
            <dt className="text-muted">Condición</dt>
            <dd className="text-white">{watch.condition}</dd>
          </>
        )}
        <dt className="text-muted flex items-center">Costo<ConfidenceDot score={c.purchasePrice} /></dt>
        <dd className="text-white">{watch.costCurrency ?? ''} {formatPrice(watch.purchasePrice)}</dd>
        <dt className="text-muted flex items-center">Precio<ConfidenceDot score={c.askingPriceMin} /></dt>
        <dd className="text-white">{formatPrice(watch.askingPriceMin)} – {formatPrice(watch.askingPriceMax)}</dd>
      </dl>
    </section>
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
          {IMPORT_FILE_HELPER_TEXT}
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
            accept={IMPORT_FILE_ACCEPT}
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
  const isSales = session.importTarget === 'SALES';
  const spreadsheetFile =
    (isSales
      ? session.files.find((f) => f.detectedEntityType === 'SALES')
      : session.files.find((f) => f.detectedEntityType === 'INVENTORY')) ??
    session.files.find((f) => f.fileType === 'XLSX' || f.fileType === 'CSV') ??
    session.files[0];
  const [mappingResp, setMappingResp] = useState<MappingResponse | null>(null);
  const [localMapping, setLocalMapping] = useState<MappingEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spreadsheetFile) return;
    void (async () => {
      try {
        const resp = await getImportMapping(session.id, spreadsheetFile.id);
        setMappingResp(resp);
        setLocalMapping(resp.mapping);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Error cargando el mapping.');
      }
    })();
  }, [session.id, spreadsheetFile]);

  const proposalByColumn = useMemo(() => {
    const map = new Map<string, MappingProposal>();
    for (const p of mappingResp?.proposals ?? []) {
      map.set(p.sourceColumn, p);
    }
    return map;
  }, [mappingResp]);

  const updateEntry = (
    sourceColumn: string,
    targetField: WatchImportField | SalesImportField | typeof SKIP_FIELD,
  ) => {
    setLocalMapping((prev) =>
      prev.map((e) => (e.sourceColumn === sourceColumn ? { ...e, targetField } : e)),
    );
  };

  const handleSaveAndValidate = async () => {
    if (!spreadsheetFile) return;
    setSaving(true);
    setError(null);
    try {
      await saveImportMapping(session.id, spreadsheetFile.id, localMapping);
      await runDryRun(session.id);
      await onMappingDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al guardar el mapping o ejecutar validación.');
    } finally {
      setSaving(false);
    }
  };

  if (!spreadsheetFile) {
    return (
      <p className="text-sm text-muted">
        {isSales
          ? 'No hay archivos de ventas en esta sesión.'
          : 'No hay archivos de inventario en esta sesión.'}
      </p>
    );
  }
  if (!mappingResp) {
    return <div className="h-40 animate-pulse rounded-xl bg-white/10" />;
  }

  const fieldOptions = isSales
    ? SALES_IMPORT_FIELD_OPTIONS
    : ALL_TARGET_FIELDS.map((f) => ({ value: f, label: WATCH_FIELD_LABELS[f] }));

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Mapeo de columnas</h2>
        <p className="mt-1 text-sm text-muted">
          {isSales ? (
            <>
              Asigna cada columna del archivo a un campo de ventas históricas. Las columnas marcadas{' '}
              <span className="rounded bg-emerald-500/20 px-1 text-emerald-300 text-xs">AUTO</span>{' '}
              fueron detectadas automáticamente.
            </>
          ) : (
            <>
              Asigna cada columna del archivo a un campo de inventario. Las columnas marcadas{' '}
              <span className="rounded bg-emerald-500/20 px-1 text-emerald-300 text-xs">AUTO</span>{' '}
              fueron detectadas automáticamente.
            </>
          )}
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
                          onChange={(e) =>
                            updateEntry(
                              entry.sourceColumn,
                              e.target.value as WatchImportField | SalesImportField | typeof SKIP_FIELD,
                            )
                          }
                          className="w-full appearance-none rounded-lg border border-white/15 bg-surface px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:border-white/30"
                        >
                          {fieldOptions.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
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
  const isSales = session.importTarget === 'SALES';
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
      const q: Record<string, string | number> = {
        page: p,
        limit: 30,
        entityType: entityTypeForSession(session.importTarget),
      };
      if (filter !== 'ALL') q.rowStatus = filter;
      const result = await listDataImportRecords(session.id, q);
      setRecords(result.records);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error cargando registros.');
    } finally {
      setLoading(false);
    }
  }, [session.id, session.importTarget]);

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
    if (norm) {
      const preferSales = [
        'saleDate', 'customerName', 'brand', 'model', 'reference', 'salePrice',
        'cost', 'calculatedProfit', 'reportedProfit', 'matchedClientId', 'matchedWatchId',
      ];
      if (isSales) {
        const cols = preferSales.filter((k) => k in norm);
        if (cols.length > 0) return cols.slice(0, 7);
      }
      return Object.keys(norm).filter((k) => !['costOriginalAmount', 'costExchangeRate'].includes(k)).slice(0, 6);
    }
    return Object.keys(first.rawData).slice(0, 6);
  }, [records, isSales]);

  const totalPages = Math.ceil(total / 30);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Resultados de validación</h2>
          <p className="mt-1 text-sm text-muted">
            {isSales
              ? 'Revisa coincidencias de cliente/reloj y errores antes de importar ventas históricas.'
              : 'Revisa los errores antes de importar.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onEditMapping} className="ui-btn-secondary text-xs">
            {isSales && session.files.every((f) => f.fileType === 'PDF') ? 'Volver a revisión' : 'Editar mapeo'}
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
                  const salesHints = isSales
                    ? [
                        dataSource.matchedClientId ? `Cliente: ${String(dataSource.matchedClientId)}` : null,
                        dataSource.matchedWatchId ? `Reloj: ${String(dataSource.matchedWatchId)}` : null,
                        dataSource.calculatedProfit != null
                          ? `Util. calc: ${String(dataSource.calculatedProfit)}`
                          : null,
                        dataSource.reportedProfit != null
                          ? `Util. rep: ${String(dataSource.reportedProfit)}`
                          : null,
                      ].filter(Boolean)
                    : [];
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
                              <li key={i} className="text-rose-300">
                                {e.code ? <span className="opacity-70">{e.code}: </span> : null}
                                {e.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {warnings.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {warnings.slice(0, 2).map((w, i) => (
                              <li key={i} className="text-amber-300/80">
                                {w.code ? <span className="opacity-70">{w.code}: </span> : null}
                                {w.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {salesHints.length > 0 ? (
                          <p className="mt-1 text-[10px] text-muted">{salesHints.join(' · ')}</p>
                        ) : null}
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
          {isSales
            ? ' Se crearán clientes mínimos cuando no haya coincidencia; no se inventan pagos ni se altera el inventario activo.'
            : ' Los números de serie que ya existen en el inventario siempre se omiten.'}
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
  session, onBack, onCommit, salesMode = false,
}: {
  session: DataImportSessionDetail;
  onBack: () => void;
  onCommit: (policy?: DuplicatePolicy) => Promise<void>;
  salesMode?: boolean;
}) {
  const [policy, setPolicy] = useState<DuplicatePolicy>('SKIP_DUPLICATES');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      await onCommit(salesMode ? undefined : policy);
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

      {salesMode ? (
        <section className="ui-card mb-6">
          <h3 className="mb-2 text-sm font-medium text-white">Ventas históricas</h3>
          <p className="text-xs text-muted">
            Se crearán clientes mínimos cuando no haya coincidencia exacta de nombre, y deals
            CLOSED_WON sin inventar pagos ni alterar el inventario activo.
          </p>
        </section>
      ) : (
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
      )}

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
      <p className="mt-2 text-sm text-muted">
        {session.importTarget === 'SALES'
          ? 'Las ventas históricas están en Ventas / Historial / Analytics.'
          : 'Los relojes han sido creados en el inventario.'}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3 text-left max-w-sm mx-auto">
        <StatCard label="Importados" value={String(imported)} accent="green" />
        <StatCard label="Omitidos" value={String(skipped)} />
        <StatCard label="Fallidos" value={String(failed)} accent={failed > 0 ? 'red' : undefined} />
      </div>
      <Link
        href={session.importTarget === 'SALES' ? '/ventas' : '/inventory'}
        className="mt-8 inline-block text-sm text-muted hover:text-white"
      >
        {session.importTarget === 'SALES' ? 'Ver ventas →' : 'Ver inventario →'}
      </Link>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type UIStep = 'upload' | 'pdf-upload' | 'pdf-extracting' | 'pdf-review' | 'mapping' | 'dryrun' | 'confirm' | 'importing' | 'completed';

export default function DataOnboardingSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<DataImportSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStep, setLocalStep] = useState<'dryrun' | 'confirm' | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [showReprocessConfirm, setShowReprocessConfirm] = useState(false);

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

  // Detect if this session is PDF-based (Sprint 3 extraction / review)
  const isPdfSession = useMemo(() => {
    if (!session) return false;
    return isPdfImportSession(session.files);
  }, [session]);

  const isSalesSession = session?.importTarget === 'SALES';

  const step: UIStep = useMemo(() => {
    if (!session) return 'upload';
    if (session.status === 'COMPLETED') return 'completed';
    if (session.status === 'IMPORTING') return 'importing';

    if (isPdfSession) {
      if (session.status === 'PROCESSING') return 'pdf-extracting';
      if (session.status === 'READY_FOR_REVIEW') {
        if (localStep === 'confirm') return 'confirm';
        if (localStep === 'dryrun' || session.dryRunVersion) return 'dryrun';
        return 'pdf-review';
      }
      return 'pdf-upload';
    }

    // CSV/XLSX workflow (inventory mapping or sales mapping)
    if (session.status === 'READY_FOR_REVIEW') {
      if (localStep === 'confirm') return 'confirm';
      if (localStep === 'dryrun' || session.dryRunVersion) return 'dryrun';
      return 'mapping';
    }
    if (session.status === 'PROCESSING') return 'upload';
    return 'upload';
  }, [session, localStep, isPdfSession]);

  const onFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    if (!isAcceptedImportFile(file)) {
      setError(IMPORT_FILE_REJECT_MESSAGE);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadDataImportFile(sessionId, file);
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
    // Never send PDFs into spreadsheet parsing / header detection.
    if (isPdfSession) {
      setError('Los archivos PDF se procesan con extracción de documentos, no con análisis de hojas de cálculo.');
      return;
    }
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

  const onExtract = async () => {
    setExtracting(true);
    setError(null);
    try {
      await processDocument(sessionId);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al extraer el PDF.');
    } finally {
      setExtracting(false);
    }
  };

  const onReprocessDocument = async () => {
    try {
      await reprocessDocument(sessionId);
      await load();
      setLocalStep(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const payload = e.payload as { code?: string } | null;
        if (payload && typeof payload === 'object' && (payload as { code?: string }).code === 'MANUAL_EDITS_WOULD_BE_DISCARDED') {
          setShowReprocessConfirm(true);
          return;
        }
      }
      throw e;
    }
  };

  const onConfirmReprocess = async () => {
    setShowReprocessConfirm(false);
    try {
      await reprocessDocument(sessionId, { confirmDiscardEdits: true });
      await load();
      setLocalStep(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al re-extraer.');
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

  const onCommit = async (policy?: DuplicatePolicy) => {
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
    'pdf-upload': isSalesSession ? 'Subir PDF de ventas' : 'Subir factura PDF',
    'pdf-extracting': 'Extrayendo con IA…',
    'pdf-review': isSalesSession ? 'Revisión de ventas' : 'Revisión de extracción',
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
          {session.title ?? (isSalesSession ? 'Importación de ventas históricas' : 'Importación de inventario')}
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

      {step === 'pdf-upload' && (
        <PdfUploadStep
          session={session}
          onFilesSelected={onFilesSelected}
          onExtract={onExtract}
          uploading={uploading}
          extracting={extracting}
        />
      )}

      {step === 'pdf-extracting' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-white/40" />
          <p className="text-sm text-muted">Extrayendo datos con IA…</p>
          <p className="text-xs text-muted/60">Esto puede tomar 20–60 segundos</p>
        </div>
      )}

      {step === 'pdf-review' && (
        isSalesSession ? (
          <SalesExtractionReviewStep
            session={session}
            onValidate={onRunDryRun}
            onReprocess={onReprocessDocument}
          />
        ) : (
          <ExtractionReviewStep
            session={session}
            onValidate={onRunDryRun}
            onReprocess={onReprocessDocument}
          />
        )
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
          salesMode={isSalesSession}
        />
      )}

      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-white/40" />
          <p className="text-sm text-muted">
            {session.importTarget === 'SALES' ? 'Importando ventas históricas…' : 'Importando relojes…'}
          </p>
        </div>
      )}

      {step === 'completed' && (
        <CompletedStep result={commitResult} session={session} />
      )}

      {showReprocessConfirm && (
        <ConfirmReprocessModal
          onConfirm={onConfirmReprocess}
          onCancel={() => setShowReprocessConfirm(false)}
        />
      )}
    </div>
  );
}
