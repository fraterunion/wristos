'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from '@/lib/api-client';
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

// ─── Types ────────────────────────────────────────────────────────────────────

type HistorySummary = {
  totalSold: number;
  totalRevenue: string;
  totalCostOfSold: string;
  totalBankFees: string;
  totalProfit: string;
};

// ─── Icons (inline SVG — no external dependency) ─────────────────────────────

function IconBanknote() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 22V9l9-7 9 7v13H3z" />
      <path d="M9 22v-7h6v7" />
      <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function IconArrows() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 17 4-4-4-4" />
      <path d="M20 13H4" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PaymentBadge({ method }: { method: string | null }) {
  if (!method) return <span className="text-white/20">—</span>;
  const label = ALL_PAYMENT_LABELS[method] ?? method;

  if (method === 'CASH') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-[5px] text-[11px] font-semibold tracking-wide border border-emerald-700/50 bg-emerald-950 text-emerald-300">
        <IconBanknote />
        {label}
      </span>
    );
  }

  const icon =
    method === 'BANCOS' ? <IconBuilding /> :
    method === 'CESAR' ? <IconUser /> :
    method === 'CARD' ? <IconCreditCard /> :
    method === 'TRANSFER' ? <IconArrows /> :
    null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-[5px] text-[11px] font-medium tracking-wide border border-white/[0.07] bg-white/[0.03] text-white/50">
      {icon}
      {label}
    </span>
  );
}

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

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'positive' | 'negative';
}) {
  const valueClass =
    highlight === 'positive' ? 'text-emerald-400' :
    highlight === 'negative' ? 'text-rose-400' :
    'text-white';

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel px-5 py-4 shadow-sm shadow-black/30">
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">{label}</p>
      <p className={`mt-2.5 text-[22px] font-semibold tabular-nums leading-none ${valueClass}`}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11px] text-white/20">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VentasPage() {
  // Data
  const [watches, setWatches] = useState<Watch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recentSales, setRecentSales] = useState<SoldItem[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
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

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [allWatches, allClients, sales, summaryData] = await Promise.all([
        listSellableWatches(),
        listClients(),
        listRecentSales(),
        apiGet<HistorySummary>('/history/summary', { authenticated: true }),
      ]);
      setWatches(allWatches.filter((w) => SELLABLE_STATUSES.has(w.status)));
      setClients(allClients);
      setRecentSales(sales);
      setSummary(summaryData);
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

  // ── Derived calculations ───────────────────────────────────────────────────

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

  // ── KPI derivation from loaded sales ──────────────────────────────────────

  const now = new Date();
  const salesThisMonth = recentSales.filter((s) => {
    const d = new Date(s.soldAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const revenueThisMonth = salesThisMonth.reduce((sum, s) => sum + Number(s.agreedPrice), 0);
  const monthName = now.toLocaleDateString('es-MX', { month: 'long' });
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  // ── Form handlers ──────────────────────────────────────────────────────────

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
          <h1 className="ui-title">Ventas</h1>
          <p className="ui-subtitle">
            Registra ventas cerradas, pagos y comisiones automáticamente.
          </p>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`Ventas · ${monthLabel}`}
          value={dataLoading ? '—' : String(salesThisMonth.length)}
          sub="Cierres este mes"
        />
        <KpiCard
          label={`Ingresos · ${monthLabel}`}
          value={dataLoading ? '—' : formatMoney(revenueThisMonth)}
          sub="Precio acordado, mes actual"
        />
        <KpiCard
          label="Total ingresos"
          value={dataLoading || !summary ? '—' : formatMoney(summary.totalRevenue)}
          sub="Acumulado histórico"
        />
        <KpiCard
          label="Utilidad bruta"
          value={dataLoading || !summary ? '—' : formatMoney(summary.totalProfit)}
          sub="Ingresos menos costo de ventas"
          highlight={
            summary
              ? Number(summary.totalProfit) >= 0 ? 'positive' : 'negative'
              : undefined
          }
        />
      </div>

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
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">

          {/* ── Registration form ────────────────────────────────────────── */}
          <article className="rounded-2xl border border-white/[0.07] bg-panel p-5 shadow-sm shadow-black/20 space-y-5">
            <h2 className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">
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
                          ? 'border-white/35 bg-white/10 font-semibold text-white'
                          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bank channel (conditional) */}
              {isBancos && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
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
                              ? 'border-white/35 bg-white/10 font-semibold text-white'
                              : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
                          }`}
                        >
                          {opt.label}
                          <span className="ml-1 text-xs text-white/30">
                            ({(opt.rate * 100).toFixed(0)}%)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Commission preview */}
                  {bankChannel && salePriceNum > 0 && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-widest text-white/30">
                          Comisión bancaria
                        </p>
                        <p className="mt-1.5 text-sm font-semibold text-amber-300">
                          {formatMoney(bankFeeAmt)}
                          <span className="ml-1 text-xs font-normal text-white/30">
                            ({(commissionRate * 100).toFixed(0)}%)
                          </span>
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-widest text-white/30">
                          Neto recibido
                        </p>
                        <p className="mt-1.5 text-sm font-semibold text-emerald-300">
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

          {/* ── Recent sales table ───────────────────────────────────────── */}
          <article className="rounded-2xl border border-white/[0.07] bg-panel shadow-sm shadow-black/20 min-w-0 overflow-hidden">

            <div className="px-6 py-4 border-b border-white/[0.05]">
              <h2 className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Ventas recientes
              </h2>
            </div>

            {dataLoading ? (
              <div className="space-y-px p-3 animate-pulse">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[68px] rounded-xl bg-white/[0.03]" />
                ))}
              </div>
            ) : recentSales.length === 0 ? (
              <div className="px-6 py-20 text-center">
                <p className="text-sm text-white/40">Aún no hay ventas registradas.</p>
                <p className="mt-1.5 text-xs text-white/20">
                  Las ventas registradas aparecerán aquí.
                </p>
              </div>
            ) : (
              /* min-w forces the scroll trigger at a known size; overflow-x-auto scrolls
                 within the card without leaking into the page layout */
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <colgroup>
                    <col style={{ width: '96px' }} />
                    {/* Reloj column is flexible — takes remaining space */}
                    <col />
                    <col style={{ width: '130px' }} className="hidden sm:table-column-group" />
                    <col style={{ width: '116px' }} />
                    <col style={{ width: '132px' }} className="hidden md:table-column-group" />
                    <col style={{ width: '110px' }} className="hidden lg:table-column-group" />
                    <col style={{ width: '148px' }} className="hidden lg:table-column-group" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 whitespace-nowrap">
                        Fecha
                      </th>
                      <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">
                        Reloj
                      </th>
                      <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 hidden sm:table-cell">
                        Comprador
                      </th>
                      <th className="px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 whitespace-nowrap">
                        Precio
                      </th>
                      <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 hidden md:table-cell">
                        Método
                      </th>
                      <th className="px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 whitespace-nowrap hidden lg:table-cell">
                        Comisión
                      </th>
                      <th className="px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 whitespace-nowrap hidden lg:table-cell">
                        Neto recibido
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {recentSales.map((sale) => {
                      const method = sale.payments[0]?.method ?? null;
                      // Bank fee is stored as OperatingExpense.BANK_FEES and is not currently
                      // returned by /history/sold. Do not infer it from payments.
                      const isBancosRow = method === 'BANCOS';
                      return (
                        <tr
                          key={sale.dealId}
                          className="transition-colors duration-150 hover:bg-white/[0.025]"
                        >
                          <td className="px-3 py-4 text-xs tabular-nums text-white/35 whitespace-nowrap align-middle">
                            {formatDate(sale.soldAt)}
                          </td>
                          <td className="px-3 py-4 align-middle overflow-hidden">
                            <p className="text-sm font-semibold text-white leading-snug truncate">
                              {sale.watch.brand} {sale.watch.model}
                            </p>
                            {sale.watch.serialNumber && (
                              <p className="mt-0.5 text-[10px] font-mono tracking-[0.16em] text-white/30 uppercase truncate">
                                {sale.watch.serialNumber}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-4 align-middle hidden sm:table-cell overflow-hidden">
                            <p className="text-sm text-white/55 truncate">{sale.buyer.name}</p>
                          </td>
                          <td className="px-3 py-4 text-right align-middle whitespace-nowrap">
                            <span className="text-sm font-bold tabular-nums text-white">
                              {formatMoney(sale.agreedPrice)}
                            </span>
                          </td>
                          <td className="px-3 py-4 align-middle hidden md:table-cell">
                            <PaymentBadge method={method} />
                          </td>
                          <td className="px-3 py-4 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                            <span className="text-xs text-white/20">—</span>
                          </td>
                          <td className="px-3 py-4 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                            {isBancosRow ? (
                              <span className="text-xs italic text-white/30">Pendiente</span>
                            ) : (
                              <span className="text-base font-semibold tabular-nums text-emerald-400">
                                {formatMoney(sale.agreedPrice)}
                              </span>
                            )}
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
