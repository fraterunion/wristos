'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  listClients,
  listRecentSales,
  listSellableWatches,
  registerSale,
  type SoldItem,
} from '@/lib/ventas-api';
import type { Client, VentaBankChannel, VentaPaymentMethod, Watch } from '@/types/domain';

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

const ALL_PAYMENT_LABELS: Record<string, string> = {
  TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
  BANCOS: 'Bancos',
  CESAR: 'César',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VentasPage() {
  // Data
  const [watches, setWatches] = useState<Watch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recentSales, setRecentSales] = useState<SoldItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Form state
  const [watchId, setWatchId] = useState('');
  const [clientId, setClientId] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<VentaPaymentMethod>('CASH');
  const [bankChannel, setBankChannel] = useState<VentaBankChannel | ''>('');
  const [saleDate, setSaleDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Flash
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [allWatches, allClients, sales] = await Promise.all([
        listSellableWatches(),
        listClients(),
        listRecentSales(),
      ]);
      setWatches(allWatches.filter((w) => SELLABLE_STATUSES.has(w.status)));
      setClients(allClients);
      setRecentSales(sales);
    } catch (err) {
      setDataError(err instanceof ApiError ? err.message : 'No se pudieron cargar los datos.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ── Derived calculations ──────────────────────────────────────────────────

  const salePriceNum = Number(salePrice) || 0;
  const commissionRate =
    paymentMethod === 'BANCOS' && bankChannel ? BANK_RATES[bankChannel] : 0;
  const bankFeeAmt = salePriceNum * commissionRate;
  const netReceivedAmt = salePriceNum - bankFeeAmt;

  const isBancos = paymentMethod === 'BANCOS';
  const isDisabled =
    submitting ||
    !watchId ||
    !clientId ||
    salePriceNum <= 0 ||
    !salePrice.trim() ||
    (isBancos && !bankChannel);

  // ── Form handlers ─────────────────────────────────────────────────────────

  const handlePaymentMethodChange = (m: VentaPaymentMethod) => {
    setPaymentMethod(m);
    if (m !== 'BANCOS') setBankChannel('');
  };

  const resetForm = () => {
    setWatchId('');
    setClientId('');
    setSalePrice('');
    setPaymentMethod('CASH');
    setBankChannel('');
    setSaleDate(todayIso());
    setNotes('');
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await registerSale({
        watchId,
        clientId,
        salePrice: salePriceNum,
        paymentMethod,
        bankChannel: isBancos && bankChannel ? bankChannel : undefined,
        saleDate: saleDate || undefined,
        notes: notes.trim() || undefined,
      });
      setFlash({ type: 'success', message: 'Venta registrada correctamente.' });
      resetForm();
      void loadData();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No se pudo registrar la venta.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

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
          <h1 className="ui-title">Ventas</h1>
          <p className="ui-subtitle">
            Registra ventas cerradas, pagos y comisiones automáticamente.
          </p>
        </div>
      </header>

      {/* Body */}
      {dataError ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{dataError}</p>
          <button
            type="button"
            onClick={() => void loadData()}
            className="mt-3 text-sm underline text-rose-200"
          >
            Reintentar
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[480px_1fr]">

          {/* ── Registration form ───────────────────────────────────────── */}
          <article className="ui-card space-y-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Nueva venta
            </h2>

            {submitError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {submitError}
              </div>
            )}

            <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>

              {/* Watch selector */}
              <div>
                <label className="ui-field-label">Reloj vendido</label>
                <select
                  value={watchId}
                  onChange={(e) => setWatchId(e.target.value)}
                  className="ui-input"
                  disabled={dataLoading || submitting}
                  required
                >
                  <option value="">
                    {dataLoading ? 'Cargando...' : 'Seleccionar reloj'}
                  </option>
                  {watches.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.brand} {w.model}
                      {w.serialNumber ? ` — ${w.serialNumber}` : ''}
                      {' '}({formatMoney(w.priceMin)}–{formatMoney(w.priceMax)})
                    </option>
                  ))}
                </select>
                {!dataLoading && watches.length === 0 && (
                  <p className="mt-1 text-xs text-muted/70">
                    No hay relojes disponibles en inventario.
                  </p>
                )}
              </div>

              {/* Client selector */}
              <div>
                <label className="ui-field-label">Comprador</label>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="ui-input"
                  disabled={dataLoading || submitting}
                  required
                >
                  <option value="">
                    {dataLoading ? 'Cargando...' : 'Seleccionar comprador'}
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sale price */}
              <div>
                <label className="ui-field-label">Precio de venta (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder="0.00"
                  className="ui-input"
                  disabled={submitting}
                  required
                />
              </div>

              {/* Payment method */}
              <div>
                <label className="ui-field-label">Método de pago</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handlePaymentMethodChange(opt.value)}
                      disabled={submitting}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${
                        paymentMethod === opt.value
                          ? 'border-white/40 bg-white/15 font-semibold text-white'
                          : 'border-white/15 text-muted hover:border-white/25 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bank channel (conditional) */}
              {isBancos && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                  <div>
                    <label className="ui-field-label">Canal bancario</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {BANK_CHANNEL_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBankChannel(opt.value)}
                          disabled={submitting}
                          className={`rounded-lg border px-3 py-2 text-sm transition ${
                            bankChannel === opt.value
                              ? 'border-white/40 bg-white/15 font-semibold text-white'
                              : 'border-white/15 text-muted hover:border-white/25 hover:text-white'
                          }`}
                        >
                          {opt.label}
                          <span className="ml-1 text-xs text-muted/70">
                            ({(opt.rate * 100).toFixed(0)}%)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Commission preview */}
                  {bankChannel && salePriceNum > 0 && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-muted">
                          Comisión bancaria
                        </p>
                        <p className="mt-1 text-sm font-semibold text-amber-300">
                          {formatMoney(bankFeeAmt)}
                          <span className="ml-1 text-xs font-normal text-muted">
                            ({(commissionRate * 100).toFixed(0)}%)
                          </span>
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-muted">
                          Neto recibido
                        </p>
                        <p className="mt-1 text-sm font-semibold text-emerald-300">
                          {formatMoney(netReceivedAmt)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sale date */}
              <div>
                <label className="ui-field-label">Fecha de venta</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="ui-input"
                  disabled={submitting}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="ui-field-label">Notas (opcional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalles adicionales de la venta…"
                  className="ui-input resize-none"
                  disabled={submitting}
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isDisabled}
                className="ui-btn-primary w-full py-2.5 disabled:opacity-50"
              >
                {submitting ? 'Registrando…' : 'Registrar venta'}
              </button>
            </form>
          </article>

          {/* ── Recent sales table ──────────────────────────────────────── */}
          <article className="ui-card space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ventas recientes
            </h2>

            {dataLoading ? (
              <div className="space-y-2 animate-pulse">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-white/10" />
                ))}
              </div>
            ) : recentSales.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 px-6 py-10 text-center">
                <p className="text-sm text-muted">Aún no hay ventas registradas.</p>
                <p className="mt-1 text-xs text-muted/60">
                  Las ventas registradas aparecerán aquí.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="pb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        Fecha
                      </th>
                      <th className="pb-2 text-xs font-medium uppercase tracking-wide text-muted">
                        Reloj
                      </th>
                      <th className="pb-2 text-xs font-medium uppercase tracking-wide text-muted hidden sm:table-cell">
                        Comprador
                      </th>
                      <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted">
                        Precio
                      </th>
                      <th className="pb-2 text-xs font-medium uppercase tracking-wide text-muted hidden md:table-cell">
                        Método
                      </th>
                      <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted hidden lg:table-cell">
                        Comisión
                      </th>
                      <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted hidden lg:table-cell">
                        Neto recibido
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {recentSales.map((sale) => {
                      const method = sale.payments[0]?.method ?? null;
                      const methodLabel = method ? (ALL_PAYMENT_LABELS[method] ?? method) : '—';
                      return (
                        <tr
                          key={sale.dealId}
                          className="transition hover:bg-white/[0.03]"
                        >
                          <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">
                            {formatDate(sale.soldAt)}
                          </td>
                          <td className="py-3 pr-4">
                            <p className="font-medium text-white">
                              {sale.watch.brand} {sale.watch.model}
                            </p>
                            {sale.watch.serialNumber && (
                              <p className="text-xs text-muted font-mono">
                                {sale.watch.serialNumber}
                              </p>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-white/80 hidden sm:table-cell">
                            {sale.buyer.name}
                          </td>
                          <td className="py-3 pr-4 text-right font-semibold text-white whitespace-nowrap">
                            {formatMoney(sale.agreedPrice)}
                          </td>
                          <td className="py-3 pr-4 text-muted hidden md:table-cell">
                            {methodLabel}
                          </td>
                          <td className="py-3 pr-4 text-right text-muted hidden lg:table-cell">
                            —
                          </td>
                          <td className="py-3 text-right text-muted hidden lg:table-cell">
                            —
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>

        </div>
      )}
    </section>
  );
}
