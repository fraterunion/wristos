'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  getFxUsdMxn,
  listClients,
  listSellableWatches,
  registerSale,
  type FxRateResult,
} from '@/lib/ventas-api';
import type { Client, SaleCurrency, VentaBankChannel, VentaPaymentMethod, Watch } from '@/types/domain';

// ─── Constants ────────────────────────────────────────────────────────────────

const SELLABLE_STATUSES = new Set(['AVAILABLE', 'IN_SERVICE']);

const PAYMENT_METHOD_OPTIONS: { value: VentaPaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'BANCOS', label: 'Bancos' },
  { value: 'CESAR', label: 'César' },
];

const BANK_CHANNEL_OPTIONS: { value: VentaBankChannel; label: string; rate: number }[] = [
  { value: 'JOSE', label: 'José', rate: 0.02 },
  { value: 'MAYTE', label: 'Mayte', rate: 0.01 },
];

const BANK_RATES: Record<VentaBankChannel, number> = { JOSE: 0.02, MAYTE: 0.01 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMxn(n: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
  }).format(n);
}

function fmtUsd(n: number) {
  return `USD ${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n)}`;
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}

// ─── PillButton ───────────────────────────────────────────────────────────────

function PillBtn({
  active, disabled = false, onClick, children,
}: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
        active
          ? 'border-white/35 bg-white/10 text-white'
          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function RegisterSaleModal({ open, onClose, onSaved }: Props) {
  // ── Reference data ─────────────────────────────────────────────────────────
  const [watches, setWatches] = useState<Watch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // ── FX ─────────────────────────────────────────────────────────────────────
  const [fxRate, setFxRate] = useState<FxRateResult | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);

  // ── Sale fields ─────────────────────────────────────────────────────────────
  const [watchId, setWatchId] = useState('');
  const [clientId, setClientId] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleCurrency, setSaleCurrency] = useState<SaleCurrency>('MXN');
  const [saleDate, setSaleDate] = useState(todayIso());
  const [notes, setNotes] = useState('');

  // ── Initial payment fields ──────────────────────────────────────────────────
  const [initAmount, setInitAmount] = useState('');
  const [initMethod, setInitMethod] = useState<VentaPaymentMethod | ''>('');
  const [initDate, setInitDate] = useState('');
  const [bankChannel, setBankChannel] = useState<VentaBankChannel | ''>('');

  // ── Submit ─────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load watches + clients once when modal opens
  useEffect(() => {
    if (!open) return;
    resetForm();
    setDataLoading(true);
    setDataError(null);
    Promise.all([listSellableWatches(), listClients()])
      .then(([ws, cs]) => {
        setWatches(ws.filter((w) => SELLABLE_STATUSES.has(w.status)));
        setClients(cs);
      })
      .catch(() => setDataError('No se pudieron cargar relojes/clientes.'))
      .finally(() => setDataLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load FX when user switches to USD
  useEffect(() => {
    if (!open || saleCurrency !== 'USD') return;
    if (fxRate) return;
    setFxLoading(true);
    setFxError(null);
    getFxUsdMxn()
      .then(setFxRate)
      .catch(() => setFxError('Tipo de cambio no disponible.'))
      .finally(() => setFxLoading(false));
  }, [open, saleCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetForm() {
    setWatchId(''); setClientId(''); setSalePrice(''); setSaleCurrency('MXN');
    setSaleDate(todayIso()); setNotes('');
    setInitAmount(''); setInitMethod(''); setInitDate(''); setBankChannel('');
    setSubmitError(null);
  }

  // Derived
  const salePriceNum = Number(salePrice) || 0;
  const previewMxn = saleCurrency === 'USD' && fxRate ? salePriceNum * fxRate.rate : salePriceNum;
  const initAmountNum = Number(initAmount) || 0;
  const isBancos = initMethod === 'BANCOS';
  const commissionRate = isBancos && bankChannel ? BANK_RATES[bankChannel] : 0;
  const bankFeePreview = initAmountNum * commissionRate;
  const netPreview = initAmountNum - bankFeePreview;
  const usdBlocked = saleCurrency === 'USD' && !fxRate;
  const needsMethod = initAmountNum > 0 && !initMethod;
  const needsChannel = isBancos && !bankChannel;
  const canSubmit =
    !submitting && watchId && clientId && salePriceNum > 0 &&
    !usdBlocked && !needsMethod && !needsChannel;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await registerSale({
        watchId,
        clientId,
        salePrice: salePriceNum,
        currency: saleCurrency,
        saleDate: saleDate || undefined,
        notes: notes.trim() || undefined,
        initialPaymentAmount: initAmountNum > 0 ? initAmountNum : undefined,
        initialPaymentMethod: initAmountNum > 0 && initMethod ? initMethod : undefined,
        initialPaymentDate: initDate || saleDate || undefined,
        bankChannel: isBancos && bankChannel ? bankChannel : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'No se pudo registrar la venta.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur sm:max-h-[90vh]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-panel/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Registrar venta</h2>
            <p className="mt-0.5 text-xs text-white/40">Nueva venta cerrada</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/8 hover:text-white transition">
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 px-5 py-5">
          {submitError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {submitError}
            </div>
          )}
          {dataError && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-sm text-amber-200">
              {dataError}
            </div>
          )}

          {/* Reloj */}
          <div>
            <label className="ui-field-label">Reloj vendido</label>
            <select
              value={watchId}
              onChange={(e) => setWatchId(e.target.value)}
              className="ui-input"
              disabled={dataLoading || submitting}
              required
            >
              <option value="">{dataLoading ? 'Cargando…' : 'Seleccionar reloj'}</option>
              {watches.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.brand} {w.model}{w.serialNumber ? ` — ${w.serialNumber}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Comprador */}
          <div>
            <label className="ui-field-label">Comprador</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="ui-input"
              disabled={dataLoading || submitting}
              required
            >
              <option value="">{dataLoading ? 'Cargando…' : 'Seleccionar comprador'}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.phone ? ` — ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Moneda */}
          <div>
            <label className="ui-field-label">Moneda</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <PillBtn active={saleCurrency === 'MXN'} disabled={submitting} onClick={() => setSaleCurrency('MXN')}>
                Pesos
              </PillBtn>
              <PillBtn
                active={saleCurrency === 'USD'}
                disabled={submitting || (!!fxError && !fxRate)}
                onClick={() => setSaleCurrency('USD')}
              >
                Dólares
              </PillBtn>
            </div>
            <div className="mt-2 min-h-[20px]">
              {fxLoading ? (
                <div className="h-3.5 w-40 animate-pulse rounded bg-white/[0.05]" />
              ) : fxRate ? (
                <span className="text-[11px] text-white/30">
                  Tipo de cambio: <span className={saleCurrency === 'USD' ? 'font-semibold text-white/60' : ''}>${fxRate.rate.toFixed(2)}</span>
                  {' · '}{timeAgo(fxRate.fetchedAt)}{fxRate.stale ? ' · desactualizado' : ''}
                </span>
              ) : fxError ? (
                <p className="text-[11px] text-rose-300/80">{fxError}</p>
              ) : null}
            </div>
          </div>

          {/* Precio total */}
          <div>
            <label className="ui-field-label">
              {saleCurrency === 'USD' ? 'Precio de venta en dólares' : 'Precio de venta'}
            </label>
            <input
              type="number" step="0.01" min="0.01"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0.00"
              className="ui-input"
              disabled={submitting}
              required
            />
            <p className="mt-1 text-[11px] text-white/30">
              {saleCurrency === 'USD'
                ? 'Se convertirá automáticamente a pesos al registrar la venta.'
                : 'Se registrará en pesos.'}
            </p>
          </div>

          {/* USD preview */}
          {saleCurrency === 'USD' && salePriceNum > 0 && fxRate && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3">
              <p className="text-[10px] uppercase tracking-widest text-white/30">Venta estimada en pesos</p>
              <p className="mt-1 text-base font-semibold text-white">{fmtMxn(previewMxn)}</p>
              <p className="text-[10px] text-white/25">{fmtUsd(salePriceNum)} × ${fxRate.rate.toFixed(2)}</p>
            </div>
          )}

          {/* Fecha de venta */}
          <div>
            <label className="ui-field-label">Fecha de venta</label>
            <input
              type="date" value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              className="ui-input" disabled={submitting}
            />
          </div>

          {/* Notas */}
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles adicionales…"
              className="ui-input resize-none"
              disabled={submitting}
            />
          </div>

          {/* ── Pago inicial ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">
              Pago inicial (opcional)
            </p>

            <div>
              <label className="ui-field-label">Monto del pago inicial</label>
              <input
                type="number" step="0.01" min="0"
                value={initAmount}
                onChange={(e) => { setInitAmount(e.target.value); if (!e.target.value || Number(e.target.value) === 0) { setInitMethod(''); setBankChannel(''); } }}
                placeholder="0.00"
                className="ui-input"
                disabled={submitting}
              />
              <p className="mt-1 text-[11px] text-white/30">
                Dejar en 0 para registrar sin pago.
              </p>
            </div>

            {initAmountNum > 0 && (
              <>
                <div>
                  <label className="ui-field-label">Método de pago inicial</label>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <PillBtn
                        key={opt.value}
                        active={initMethod === opt.value}
                        disabled={submitting}
                        onClick={() => { setInitMethod(opt.value); if (opt.value !== 'BANCOS') setBankChannel(''); }}
                      >
                        {opt.label}
                      </PillBtn>
                    ))}
                  </div>
                </div>

                {isBancos && (
                  <div className="space-y-3">
                    <div>
                      <label className="ui-field-label">Canal bancario</label>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {BANK_CHANNEL_OPTIONS.map((opt) => (
                          <PillBtn
                            key={opt.value}
                            active={bankChannel === opt.value}
                            disabled={submitting}
                            onClick={() => setBankChannel(opt.value)}
                          >
                            {opt.label} <span className="text-xs text-white/30">({(opt.rate * 100).toFixed(0)}%)</span>
                          </PillBtn>
                        ))}
                      </div>
                    </div>
                    {bankChannel && initAmountNum > 0 && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-white/30">Comisión</p>
                          <p className="mt-1 text-sm font-semibold text-amber-300">
                            {fmtMxn(bankFeePreview)}
                            <span className="ml-1 text-xs font-normal text-white/30">({(commissionRate * 100).toFixed(0)}%)</span>
                          </p>
                        </div>
                        <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-widest text-white/30">Neto</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-300">{fmtMxn(netPreview)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="ui-field-label">Fecha del pago inicial</label>
                  <input
                    type="date"
                    value={initDate || saleDate}
                    onChange={(e) => setInitDate(e.target.value)}
                    className="ui-input"
                    disabled={submitting}
                  />
                  <p className="mt-1 text-[11px] text-white/30">Por defecto usa la fecha de venta.</p>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <button type="button" onClick={onClose} disabled={submitting} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {submitting ? 'Registrando…' : 'Registrar venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
