'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DismissModal } from '@/components/radar/DismissModal';
import { ConfidenceBar, IntentBadge, SourceBadge } from '@/components/radar/RadarBadges';
import { ApiError } from '@/lib/api-client';
import {
  confirmRadarListing,
  dismissRadarListing,
  getRadarReviewQueue,
} from '@/lib/radar-api';
import type { RadarListingDetail } from '@/types/radar';

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
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function Field({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-sm text-white">{value}</p>
        {badge}
      </div>
    </div>
  );
}

// ─── Review card ─────────────────────────────────────────────────────────────

function ReviewCard({
  listing,
  confirmLoading,
  dismissLoading,
  onConfirm,
  onDismiss,
}: {
  listing: RadarListingDetail;
  confirmLoading: boolean;
  dismissLoading: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const hasExtraction =
    listing.brand ??
    listing.rawModelMention ??
    listing.referenceNumberExplicit ??
    listing.priceAmount ??
    listing.conditionNotes ??
    listing.year;

  const boxPapers = [
    listing.hasBox === true ? 'Estuche ✓' : listing.hasBox === false ? 'Sin estuche' : null,
    listing.hasPapers === true ? 'Documentos ✓' : listing.hasPapers === false ? 'Sin documentos' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="ui-card space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <IntentBadge intent={listing.intent} />
          {listing.urgencyDetected && (
            <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-200">
              Urgente
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceBar confidence={listing.feedConfidence} />
          <span className="text-sm font-semibold tabular-nums text-white">
            {Math.round(listing.feedConfidence * 100)}%
          </span>
        </div>
      </div>

      {/* AI extraction fields */}
      {hasExtraction && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {listing.brand && <Field label="Marca" value={listing.brand} />}
          {listing.rawModelMention && (
            <Field label="Modelo" value={listing.rawModelMention} />
          )}
          {listing.referenceNumberExplicit && (
            <Field
              label="Referencia"
              value={listing.referenceNumberExplicit}
              badge={<SourceBadge source={listing.referenceSource} />}
            />
          )}
          {listing.priceAmount && (
            <Field
              label="Precio"
              value={formatPrice(listing.priceAmount, listing.priceCurrency)}
            />
          )}
          {listing.conditionNotes && (
            <Field label="Condición" value={listing.conditionNotes} />
          )}
          {boxPapers && <Field label="Estuche / Documentos" value={boxPapers} />}
          {listing.year && <Field label="Año" value={String(listing.year)} />}
        </div>
      )}

      {/* Watch reference match */}
      {listing.watchReference && (
        <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-white/50">Coincidencia en catálogo</p>
          <p className="mt-1 text-sm text-white">
            {listing.watchReference.brand} {listing.watchReference.model}{' '}
            <span className="font-mono text-white/70">{listing.watchReference.reference}</span>
          </p>
          {listing.watchReference.approximateRetailUsd && (
            <p className="mt-0.5 text-xs text-muted">
              Precio aprox.{' '}
              {formatPrice(listing.watchReference.approximateRetailUsd, 'USD')}
            </p>
          )}
        </div>
      )}

      {/* AI summary */}
      {listing.aiSummary && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Resumen IA</p>
          <p className="mt-2 rounded-lg border border-white/10 bg-surface/40 px-3 py-2 text-sm text-white/80 leading-relaxed">
            {listing.aiSummary}
          </p>
        </div>
      )}

      {/* Original message */}
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">
          Mensaje original ·{' '}
          <span className="normal-case text-white/60">
            {listing.contact?.displayName ?? listing.message.senderRaw}
          </span>{' '}
          · {formatDate(listing.message.postedAt)}
          {listing.message.import.sourceGroupName && (
            <> · {listing.message.import.sourceGroupName}</>
          )}
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-surface/60 px-3 py-3 font-sans text-sm leading-relaxed text-white/70">
          {listing.message.content}
        </pre>
      </div>

      {/* Dealer notes (if any) */}
      {listing.dealerNotes && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Notas del operador</p>
          <p className="mt-1 text-sm text-white/70">{listing.dealerNotes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4">
        <Link
          href={`/radar/listings/${listing.id}`}
          className="ui-btn-ghost px-3 py-1.5 text-xs"
        >
          Ver detalle completo
        </Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={dismissLoading}
            className="ui-btn-danger px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmLoading}
            className="ui-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {confirmLoading ? 'Confirmando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RadarReviewPage() {
  const [listings, setListings] = useState<RadarListingDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmLoading, setConfirmLoading] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [dismissLoading, setDismissLoading] = useState(false);

  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRadarReviewQueue({ limit: 20 });
      setListings(data.listings);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la cola de revisión.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const handleConfirm = async (id: string) => {
    setConfirmLoading(id);
    try {
      await confirmRadarListing(id);
      setFlash({ type: 'success', message: 'Listado confirmado.' });
      void loadQueue();
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
      void loadQueue();
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al descartar.' });
    } finally {
      setDismissLoading(false);
    }
  };

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

      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Cola de revisión</h1>
          <p className="ui-subtitle">
            {loading
              ? 'Cargando…'
              : total > 0
              ? `${total} listado${total === 1 ? '' : 's'} pendiente${total === 1 ? '' : 's'} de revisión — ordenados por confianza.`
              : 'Listados detectados por IA pendientes de confirmación.'}
          </p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Volver al radar
        </Link>
      </header>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 rounded-xl bg-white/10" />
          ))}
        </div>
      ) : error ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadQueue()}
            className="mt-3 text-sm underline text-rose-200"
          >
            Retry
          </button>
        </section>
      ) : listings.length === 0 ? (
        <article className="rounded-2xl border border-dashed border-white/15 bg-panel/60 px-6 py-16 text-center">
          <p className="text-base font-medium text-white/80">No hay listados pendientes de revisión.</p>
          <p className="mt-2 text-sm text-muted">
            Sube una exportación de WhatsApp y clasifícala para llenar la cola.
          </p>
          <div className="mt-6">
            <Link href="/radar" className="ui-btn-primary px-5 py-2.5">
              Ir al radar
            </Link>
          </div>
        </article>
      ) : (
        <section className="space-y-4">
          {listings.map((listing) => (
            <ReviewCard
              key={listing.id}
              listing={listing}
              confirmLoading={confirmLoading === listing.id}
              dismissLoading={dismissLoading}
              onConfirm={() => void handleConfirm(listing.id)}
              onDismiss={() => setDismissTarget(listing.id)}
            />
          ))}
          {total > listings.length && (
            <p className="pt-2 text-center text-xs text-muted">
              Mostrando {listings.length} de {total} — confirma o descarta para avanzar en la cola.
            </p>
          )}
        </section>
      )}

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
