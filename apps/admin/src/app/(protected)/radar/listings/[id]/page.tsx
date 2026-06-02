'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { DismissModal } from '@/components/radar/DismissModal';
import { ConfidenceBar, IntentBadge, ReviewStatusBadge, SourceBadge } from '@/components/radar/RadarBadges';
import { formatDate, formatDateTime, formatPrice } from '@/components/radar/utils';
import { ApiError } from '@/lib/api-client';
import {
  confirmRadarListing,
  dismissRadarListing,
  getRadarListing,
  updateRadarListing,
} from '@/lib/radar-api';
import type { RadarIntent, RadarListingDetail, UpdateRadarListingPayload } from '@/types/radar';

// ─── Edit form types ──────────────────────────────────────────────────────────

type DraftFields = {
  brand: string;
  referenceNumber: string;
  conditionNotes: string;
  priceAmount: string;
  priceCurrency: string;
  hasBox: '' | 'true' | 'false';
  hasPapers: '' | 'true' | 'false';
  year: string;
  intent: RadarIntent;
  dealerNotes: string;
};

function draftFromListing(l: RadarListingDetail): DraftFields {
  return {
    brand: l.brand ?? '',
    referenceNumber: l.referenceNumberExplicit ?? '',
    conditionNotes: l.conditionNotes ?? '',
    priceAmount: l.priceAmount ?? '',
    priceCurrency: l.priceCurrency ?? 'USD',
    hasBox: l.hasBox === true ? 'true' : l.hasBox === false ? 'false' : '',
    hasPapers: l.hasPapers === true ? 'true' : l.hasPapers === false ? 'false' : '',
    year: l.year !== null ? String(l.year) : '',
    intent: l.intent,
    dealerNotes: l.dealerNotes ?? '',
  };
}

function buildPayload(draft: DraftFields): UpdateRadarListingPayload {
  const payload: UpdateRadarListingPayload = {
    brand: draft.brand || undefined,
    referenceNumber: draft.referenceNumber || undefined,
    conditionNotes: draft.conditionNotes || undefined,
    dealerNotes: draft.dealerNotes || undefined,
    priceCurrency: draft.priceCurrency || undefined,
    intent: draft.intent,
  };
  if (draft.priceAmount !== '') {
    const n = Number(draft.priceAmount);
    if (Number.isFinite(n)) payload.priceAmount = n;
  }
  if (draft.hasBox === 'true') payload.hasBox = true;
  else if (draft.hasBox === 'false') payload.hasBox = false;
  if (draft.hasPapers === 'true') payload.hasPapers = true;
  else if (draft.hasPapers === 'false') payload.hasPapers = false;
  if (draft.year !== '') {
    const n = parseInt(draft.year, 10);
    if (!Number.isNaN(n)) payload.year = n;
  }
  return payload;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RadarListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [listing, setListing] = useState<RadarListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftFields | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmLoading, setConfirmLoading] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissLoading, setDismissLoading] = useState(false);

  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadListing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRadarListing(id);
      setListing(data);
      setDraft(draftFromListing(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el listado.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadListing();
  }, [loadListing]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const setField = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await updateRadarListing(id, buildPayload(draft));
      setListing(updated);
      setDraft(draftFromListing(updated));
      setFlash({ type: 'success', message: 'Listado guardado.' });
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al guardar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setConfirmLoading(true);
    try {
      const updated = await confirmRadarListing(id);
      setListing(updated);
      setDraft(draftFromListing(updated));
      setFlash({ type: 'success', message: 'Listado confirmado.' });
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al confirmar.' });
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleDismiss = async (reason: string) => {
    setDismissLoading(true);
    try {
      await dismissRadarListing(id, reason || undefined);
      setDismissOpen(false);
      setFlash({ type: 'success', message: 'Listado descartado.' });
      void loadListing();
    } catch (err) {
      setFlash({ type: 'error', message: err instanceof ApiError ? err.message : 'Error al descartar.' });
    } finally {
      setDismissLoading(false);
    }
  };

  const anyLoading = saving || confirmLoading || dismissLoading;

  const title = listing
    ? [listing.brand, listing.rawModelMention].filter(Boolean).join(' ') || 'Listado'
    : 'Detalle del listado';

  return (
    <section className="ui-page">
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
          <h1 className="ui-title">{title}</h1>
          <p className="ui-subtitle font-mono text-xs">{id}</p>
        </div>
        <Link href="/radar" className="ui-btn-secondary px-3 py-2">
          Volver al radar
        </Link>
      </header>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-white/10" />
          ))}
        </div>
      ) : error ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadListing()}
            className="mt-3 text-sm underline text-rose-200"
          >
            Reintentar
          </button>
        </section>
      ) : listing && draft ? (
        <>
          {/* ── Status & actions ─────────────────────────────────────────── */}
          <article className="ui-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <IntentBadge intent={listing.intent} />
                <ReviewStatusBadge status={listing.reviewStatus} />
                {listing.urgencyDetected && (
                  <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-200">
                    Urgente
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <ConfidenceBar confidence={listing.feedConfidence} />
                  <span className="text-sm font-semibold tabular-nums text-white">
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

            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
              {listing.reviewStatus !== 'CONFIRMED' && (
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={anyLoading}
                  className="ui-btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {confirmLoading ? 'Confirmando…' : 'Confirmar listado'}
                </button>
              )}
              {listing.reviewStatus !== 'DISMISSED' && (
                <button
                  type="button"
                  onClick={() => setDismissOpen(true)}
                  disabled={anyLoading}
                  className="ui-btn-danger px-4 py-2 text-sm disabled:opacity-50"
                >
                  Descartar
                </button>
              )}
              {listing.confirmedAt && (
                <p className="text-xs text-muted">
                  Confirmado el {formatDate(listing.confirmedAt)}
                  {listing.confirmedBy ? ` por ${listing.confirmedBy}` : ''}
                </p>
              )}
              {listing.dismissedAt && (
                <p className="text-xs text-muted">
                  Descartado el {formatDate(listing.dismissedAt)}
                  {listing.dismissedBy ? ` por ${listing.dismissedBy}` : ''}
                </p>
              )}
            </div>
          </article>

          {/* ── AI analysis ──────────────────────────────────────────────── */}
          <article className="ui-card space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Análisis IA</h2>
            {listing.aiSummary && (
              <p className="rounded-lg border border-white/10 bg-surface/40 px-3 py-2 text-sm text-white/80 leading-relaxed">
                {listing.aiSummary}
              </p>
            )}
            {listing.watchReference && (
              <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-white/50">Coincidencia en catálogo</p>
                <p className="mt-1 text-sm text-white">
                  {listing.watchReference.brand} {listing.watchReference.model}{' '}
                  <span className="font-mono text-white/70">{listing.watchReference.reference}</span>
                </p>
                {listing.watchReference.approximateRetailUsd && (
                  <p className="mt-0.5 text-xs text-muted">
                    Precio aprox. {formatPrice(listing.watchReference.approximateRetailUsd, 'USD')}
                  </p>
                )}
              </div>
            )}
            {/* TODO: WatchReference picker not implemented — catalog match is read-only in this phase */}
          </article>

          {/* ── Edit form ────────────────────────────────────────────────── */}
          <article className="ui-card space-y-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Editar campos</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Marca</label>
                <input
                  value={draft.brand}
                  onChange={(e) => setField('brand', e.target.value)}
                  className="ui-input mt-1 w-full"
                  placeholder="ej. Rolex"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Número de referencia</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    value={draft.referenceNumber}
                    onChange={(e) => setField('referenceNumber', e.target.value)}
                    className="ui-input flex-1"
                    placeholder="ej. 126710BLNR"
                  />
                  <SourceBadge source={listing.referenceSource} />
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Tipo</label>
                <select
                  value={draft.intent}
                  onChange={(e) => setField('intent', e.target.value as RadarIntent)}
                  className="ui-input mt-1 w-full"
                >
                  <option value="SELL_OFFER">Oferta de venta</option>
                  <option value="BUY_REQUEST">Solicitud de compra</option>
                  <option value="PRICE_SIGNAL">Señal de precio</option>
                  <option value="GENERAL_INQUIRY">Consulta general</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Año</label>
                <input
                  value={draft.year}
                  onChange={(e) => setField('year', e.target.value)}
                  className="ui-input mt-1 w-full"
                  placeholder="ej. 2021"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Precio</label>
                <input
                  value={draft.priceAmount}
                  onChange={(e) => setField('priceAmount', e.target.value)}
                  className="ui-input mt-1 w-full"
                  placeholder="ej. 12500"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Moneda</label>
                <input
                  value={draft.priceCurrency}
                  onChange={(e) => setField('priceCurrency', e.target.value)}
                  className="ui-input mt-1 w-full"
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Estuche</label>
                <select
                  value={draft.hasBox}
                  onChange={(e) => setField('hasBox', e.target.value as DraftFields['hasBox'])}
                  className="ui-input mt-1 w-full"
                >
                  <option value="">Sin especificar</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Documentos</label>
                <select
                  value={draft.hasPapers}
                  onChange={(e) => setField('hasPapers', e.target.value as DraftFields['hasPapers'])}
                  className="ui-input mt-1 w-full"
                >
                  <option value="">Sin especificar</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-muted">Notas de condición</label>
              <textarea
                value={draft.conditionNotes}
                onChange={(e) => setField('conditionNotes', e.target.value)}
                rows={2}
                className="ui-input mt-1 w-full resize-none"
                placeholder="ej. Pequeños rasguños en la pulsera"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted">Notas del operador</label>
              <textarea
                value={draft.dealerNotes}
                onChange={(e) => setField('dealerNotes', e.target.value)}
                rows={2}
                className="ui-input mt-1 w-full resize-none"
                placeholder="Notas internas…"
              />
            </div>

            <div className="flex justify-end border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={anyLoading}
                className="ui-btn-primary px-5 py-2 text-sm disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </article>

          {/* ── Source & message ─────────────────────────────────────────── */}
          <article className="ui-card space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Fuente</h2>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Remitente</p>
                <p className="mt-1 text-sm text-white">
                  {listing.contact?.displayName ?? listing.message.senderRaw}
                </p>
                {listing.contact?.displayName && (
                  <p className="text-xs text-muted">{listing.message.senderRaw}</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Publicado</p>
                <p className="mt-1 text-sm text-white">{formatDateTime(listing.message.postedAt)}</p>
              </div>
              {listing.message.import.sourceGroupName && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Grupo</p>
                  <p className="mt-1 text-sm text-white">{listing.message.import.sourceGroupName}</p>
                </div>
              )}
              {listing.message.import.dateRangeStart && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Rango de importación</p>
                  <p className="mt-1 text-sm text-white">
                    {formatDate(listing.message.import.dateRangeStart)}
                    {listing.message.import.dateRangeEnd && (
                      <> – {formatDate(listing.message.import.dateRangeEnd)}</>
                    )}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Listado creado</p>
                <p className="mt-1 text-sm text-white">{formatDateTime(listing.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Confianza inicial</p>
                <p className="mt-1 text-sm text-white">
                  {Math.round(listing.initialConfidence * 100)}%
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Mensaje original</p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-surface/60 px-3 py-3 font-sans text-sm leading-relaxed text-white/70">
                {listing.message.content}
              </pre>
            </div>
          </article>

          {/* ── Contact ──────────────────────────────────────────────────── */}
          <article className="ui-card">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Contacto</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  {listing.contact?.displayName ??
                    listing.contact?.phone ??
                    listing.contact?.whatsappId ??
                    'Unknown'}
                </p>
                {listing.contact?.phone && listing.contact?.displayName && (
                  <p className="mt-0.5 text-xs text-muted">{listing.contact.phone}</p>
                )}
              </div>
              <Link
                href={`/radar/contacts/${listing.contactId}`}
                className="ui-btn-ghost px-3 py-1.5 text-xs"
              >
                Ver perfil
              </Link>
            </div>
          </article>
        </>
      ) : null}

      <DismissModal
        open={dismissOpen}
        loading={dismissLoading}
        onCancel={() => setDismissOpen(false)}
        onConfirm={(reason) => void handleDismiss(reason)}
      />
    </section>
  );
}
