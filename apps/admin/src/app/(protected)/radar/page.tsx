'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DismissModal } from '@/components/radar/DismissModal';
import { ConfidenceBar, IntentBadge, ReviewStatusBadge, SourceBadge } from '@/components/radar/RadarBadges';
import { ApiError } from '@/lib/api-client';
import {
  classifyRadarImport,
  confirmRadarListing,
  dismissRadarListing,
  getRadarReviewQueue,
  listRadarListings,
  uploadRadarImport,
} from '@/lib/radar-api';
import type {
  ListRadarListingsParams,
  RadarImportStatus,
  RadarImportSummary,
  RadarIntent,
  RadarListingCard,
  RadarReviewStatus,
} from '@/types/radar';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(amount: string | null, currency: string | null): string {
  if (!amount) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency ?? 'USD'} ${n.toLocaleString()}`;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function importStatusColor(status: RadarImportStatus): string {
  if (status === 'COMPLETED') return 'text-emerald-300';
  if (status === 'PARTIAL') return 'text-amber-300';
  if (status === 'FAILED') return 'text-rose-300';
  if (status === 'CLASSIFYING' || status === 'PARSING') return 'text-white/60';
  return 'text-muted';
}

// ─── Local sub-components ────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-white/10 bg-panel p-5">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </article>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 rounded-xl bg-white/10" />
      ))}
    </div>
  );
}

function ListingCard({
  listing,
  confirmLoading,
  onConfirm,
  onDismiss,
}: {
  listing: RadarListingCard;
  confirmLoading: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className="ui-card-soft transition hover:border-white/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <IntentBadge intent={listing.intent} />
          <ReviewStatusBadge status={listing.reviewStatus} />
          {listing.urgencyDetected && (
            <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-200">
              Urgente
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-right">
          <div className="flex items-center gap-2">
            <ConfidenceBar confidence={listing.feedConfidence} />
            <span className="text-xs tabular-nums text-muted">
              {Math.round(listing.feedConfidence * 100)}%
            </span>
          </div>
          {listing.priceAmount && (
            <span className="text-sm font-semibold text-white">
              {formatPrice(listing.priceAmount, listing.priceCurrency)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {listing.brand && (
            <span className="text-sm font-semibold text-white">{listing.brand}</span>
          )}
          {listing.rawModelMention && (
            <span className="text-sm text-white/70">{listing.rawModelMention}</span>
          )}
          {listing.referenceNumberExplicit && (
            <>
              <span className="font-mono text-xs text-white/60">
                {listing.referenceNumberExplicit}
              </span>
              <SourceBadge source={listing.referenceSource} />
            </>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>{listing.contact?.displayName ?? 'Contacto desconocido'}</span>
          {listing.message.import.sourceGroupName && (
            <span>{listing.message.import.sourceGroupName}</span>
          )}
          <span>{formatDate(listing.message.postedAt)}</span>
        </div>
      </div>

      {listing.aiSummary && (
        <p className="mt-3 rounded-lg border border-white/10 bg-surface/40 px-3 py-2 text-sm text-white/80 leading-relaxed">
          {listing.aiSummary}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Link
          href={`/radar/listings/${listing.id}`}
          className="ui-btn-ghost px-3 py-1.5 text-xs"
        >
          Ver
        </Link>
        {listing.reviewStatus !== 'DISMISSED' && (
          <button
            type="button"
            onClick={onDismiss}
            className="ui-btn-danger px-3 py-1.5 text-xs"
          >
            Descartar
          </button>
        )}
        {listing.reviewStatus !== 'CONFIRMED' && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmLoading}
            className="ui-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {confirmLoading ? 'Confirmando…' : 'Confirmar'}
          </button>
        )}
      </div>
    </article>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RadarPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastImport, setLastImport] = useState<RadarImportSummary | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Listings
  const [listings, setListings] = useState<RadarListingCard[]>([]);
  const [listingsTotal, setListingsTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [intent, setIntent] = useState<RadarIntent | ''>('');
  const [reviewStatus, setReviewStatus] = useState<RadarReviewStatus | ''>('');
  const [sort, setSort] = useState<'newest' | 'confidence' | 'price'>('newest');

  // Actions
  const [confirmLoading, setConfirmLoading] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [dismissLoading, setDismissLoading] = useState(false);

  // Flash
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const hasFilters = Boolean(q || intent || reviewStatus);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ListRadarListingsParams = { sort };
      if (q) params.q = q;
      if (intent) params.intent = intent;
      if (reviewStatus) params.reviewStatus = reviewStatus;
      const data = await listRadarListings(params);
      setListings(data.listings);
      setListingsTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los listados.');
    } finally {
      setLoading(false);
    }
  }, [q, intent, reviewStatus, sort]);

  const loadPendingCount = useCallback(async () => {
    try {
      const data = await getRadarReviewQueue({ limit: 1 });
      setPendingCount(data.total);
    } catch {
      // not critical — pending count is a convenience display
    }
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  useEffect(() => {
    void loadPendingCount();
  }, [loadPendingCount]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ── Upload & classify ──────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setUploadFile(file);
    setLastImport(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.txt')) {
      setUploadFile(file);
      setLastImport(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setFlash(null);
    try {
      const summary = await uploadRadarImport(uploadFile);
      setLastImport(summary);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFlash({
        type: 'success',
        message: `Se cargaron ${summary.validMessagesStored} mensajes de "${summary.sourceGroupName ?? 'grupo'}". Listos para clasificar.`,
      });
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al subir el archivo.' });
    } finally {
      setUploading(false);
    }
  };

  const handleClassify = async () => {
    if (!lastImport) return;
    setClassifying(true);
    setFlash(null);
    try {
      const result = await classifyRadarImport(lastImport.importId);
      setLastImport(result);
      setFlash({
        type: 'success',
        message: `Clasificación completa — ${result.listingsCreated} listados creados.`,
      });
      void loadListings();
      void loadPendingCount();
    } catch (err) {
      setFlash({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'La clasificación falló.',
      });
    } finally {
      setClassifying(false);
    }
  };

  // ── Listing actions ────────────────────────────────────────────────────────

  const handleConfirm = async (id: string) => {
    setConfirmLoading(id);
    try {
      await confirmRadarListing(id);
      setFlash({ type: 'success', message: 'Listado confirmado.' });
      void loadListings();
      void loadPendingCount();
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al confirmar.' });
    } finally {
      setConfirmLoading(null);
    }
  };

  const handleDismiss = async (reason: string) => {
    if (!dismissTarget) return;
    setDismissLoading(true);
    try {
      await dismissRadarListing(dismissTarget, reason || undefined);
      setFlash({ type: 'success', message: 'Listado descartado.' });
      setDismissTarget(null);
      void loadListings();
      void loadPendingCount();
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al descartar.' });
    } finally {
      setDismissLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="ui-page">
      {/* Flash */}
      {flash && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            flash.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-100'
          }`}
        >
          {flash.message}
        </div>
      )}

      {/* Header */}
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Radar de mercado IA</h1>
          <p className="ui-subtitle">Memoria de mercado a partir de conversaciones de WhatsApp.</p>
        </div>
        <Link
          href="/radar/review"
          className="ui-btn-secondary px-3 py-2"
        >
          Cola de revisión{pendingCount !== null && pendingCount > 0 ? ` (${pendingCount})` : ''}
        </Link>
      </header>

      {/* Upload card */}
      <article className="ui-card">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Subir exportación de WhatsApp
        </h2>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-4 flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            isDragging ? 'border-accent bg-accent/5' : 'border-white/15'
          }`}
        >
          <p className="text-sm text-muted">Arrastra un archivo .txt aquí, o</p>
          <label className="mt-3 cursor-pointer">
            <span className="ui-btn-secondary px-4 py-2 text-sm">Seleccionar archivo</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              className="sr-only"
              onChange={handleFileChange}
            />
          </label>
          {uploadFile && (
            <p className="mt-3 text-sm text-white/80">
              {uploadFile.name} · {formatBytes(uploadFile.size)}
            </p>
          )}
        </div>

        {uploadFile && !uploading && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={uploading}
              className="ui-btn-primary px-4 py-2"
            >
              Upload
            </button>
          </div>
        )}

        {uploading && (
          <p className="mt-4 text-center text-sm text-muted">Subiendo…</p>
        )}

        {/* Import summary */}
        {lastImport && (
          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">
                  {lastImport.sourceGroupName ?? 'Import'}{' '}
                  <span className={importStatusColor(lastImport.status)}>
                    · {lastImport.status}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  {lastImport.totalMessagesParsed} procesados · {lastImport.validMessagesStored} almacenados
                  {lastImport.mediaMessagesSkipped > 0 &&
                    ` · ${lastImport.mediaMessagesSkipped} media skipped`}
                  {lastImport.systemMessagesSkipped > 0 &&
                    ` · ${lastImport.systemMessagesSkipped} system skipped`}
                </p>
                {lastImport.listingsCreated > 0 && (
                  <p className="mt-1 text-xs text-emerald-300">
                    {lastImport.listingsCreated} listados creados
                    {lastImport.skippedPrefilter > 0 &&
                      ` · ${lastImport.skippedPrefilter} pre-filtered`}
                  </p>
                )}
                {lastImport.classificationFailed > 0 && (
                  <p className="mt-1 text-xs text-rose-300">
                    {lastImport.classificationFailed} fallidos — reintenta la clasificación
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleClassify()}
                disabled={classifying}
                className="ui-btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {classifying
                  ? 'Clasificando…'
                  : lastImport.listingsCreated > 0
                  ? 'Reclasificar'
                  : 'Clasificar con IA'}
              </button>
            </div>
          </div>
        )}
      </article>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Listados" value={loading ? '…' : String(listingsTotal)} />
        <StatCard
          label="Pendiente de revisión"
          value={pendingCount !== null ? String(pendingCount) : '—'}
        />
        <StatCard
          label="Última importación"
          value={lastImport?.status ?? '—'}
        />
        <StatCard label="Confirmados" value="—" />
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 basis-full gap-1 sm:basis-auto">
          <input
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQ(draftQ.trim());
            }}
            placeholder="Buscar listados…"
            className="ui-input flex-1"
          />
          <button
            type="button"
            onClick={() => setQ(draftQ.trim())}
            className="ui-btn-secondary shrink-0 px-3 py-2 text-xs"
          >
            Buscar
          </button>
          {q && (
            <button
              type="button"
              onClick={() => { setQ(''); setDraftQ(''); }}
              className="ui-btn-ghost shrink-0 px-3 py-2 text-xs"
            >
              Limpiar
            </button>
          )}
        </div>

        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value as RadarIntent | '')}
          className="ui-input w-auto"
        >
          <option value="">Todos los tipos</option>
          <option value="SELL_OFFER">Venta</option>
          <option value="BUY_REQUEST">Compra</option>
          <option value="PRICE_SIGNAL">Señal de precio</option>
          <option value="GENERAL_INQUIRY">Consulta</option>
        </select>

        <select
          value={reviewStatus}
          onChange={(e) => setReviewStatus(e.target.value as RadarReviewStatus | '')}
          className="ui-input w-auto"
        >
          <option value="">Todos los estados</option>
          <option value="PENDING_REVIEW">Pendiente</option>
          <option value="CONFIRMED">Confirmado</option>
          <option value="DISMISSED">Descartado</option>
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'newest' | 'confidence' | 'price')}
          className="ui-input w-auto"
        >
          <option value="newest">Más recientes</option>
          <option value="confidence">Por confianza</option>
          <option value="price">Por precio</option>
        </select>
      </div>

      {/* Feed */}
      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadListings()}
            className="mt-3 text-sm underline text-rose-200"
          >
            Retry
          </button>
        </section>
      ) : listings.length === 0 ? (
        <article className="rounded-2xl border border-dashed border-white/15 bg-panel/60 px-6 py-16 text-center">
          <p className="text-base font-medium text-white/80">
            {hasFilters ? 'Ningún listado coincide con los filtros.' : 'Aún no hay datos en el radar.'}
          </p>
          <p className="mt-2 text-sm text-muted">
            {hasFilters
              ? 'Intenta ajustar tu búsqueda o limpiar los filtros.'
              : 'Sube una exportación .txt de WhatsApp para comenzar a construir tu memoria de mercado.'}
          </p>
        </article>
      ) : (
        <section className="space-y-3">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              confirmLoading={confirmLoading === listing.id}
              onConfirm={() => void handleConfirm(listing.id)}
              onDismiss={() => setDismissTarget(listing.id)}
            />
          ))}
          {listingsTotal > listings.length && (
            <p className="pt-2 text-center text-xs text-muted">
              Mostrando {listings.length} de {listingsTotal} listados
            </p>
          )}
        </section>
      )}

      {/* Dismiss modal — keyed by target to reset reason between targets */}
      <DismissModal
        key={dismissTarget ?? '__none__'}
        open={dismissTarget !== null}
        loading={dismissLoading}
        onCancel={() => setDismissTarget(null)}
        onConfirm={(reason) => void handleDismiss(reason)}
      />
    </section>
  );
}
