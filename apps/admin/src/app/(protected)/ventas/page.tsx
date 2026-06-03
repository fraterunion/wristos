'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet } from '@/lib/api-client';
import {
  getFxUsdMxn,
  listClients,
  listRecentSales,
  listSellableWatches,
  registerSale,
  type FxRateResult,
  type SoldItem,
} from '@/lib/ventas-api';
import type {
  Client,
  SaleCurrency,
  VentaBankChannel,
  VentaPaymentMethod,
  Watch,
} from '@/types/domain';

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

type SaleFilters = {
  dateFrom: string;
  dateTo: string;
  paymentMethod: string;
  currency: string;
  buyer: string;
  watchSearch: string;
  minAmount: string;
  maxAmount: string;
};

const EMPTY_FILTERS: SaleFilters = {
  dateFrom: '',
  dateTo: '',
  paymentMethod: '',
  currency: '',
  buyer: '',
  watchSearch: '',
  minAmount: '',
  maxAmount: '',
};

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────

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
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatUsd(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `USD ${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n)}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'hace un momento';
  if (diffMin === 1) return 'hace 1 min';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  return diffHr === 1 ? 'hace 1 hora' : `hace ${diffHr} horas`;
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
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">{label}</p>
      <p className={`mt-2.5 text-[22px] font-semibold tabular-nums leading-none ${valueClass}`}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11px] text-white/20">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VentasPage() {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [watches, setWatches] = useState<Watch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recentSales, setRecentSales] = useState<SoldItem[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // ── FX state ───────────────────────────────────────────────────────────────
  const [fxRate, setFxRate] = useState<FxRateResult | null>(null);
  const [fxLoading, setFxLoading] = useState(true);
  const [fxError, setFxError] = useState<string | null>(null);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [watchId, setWatchId] = useState('');
  const [clientId, setClientId] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleCurrency, setSaleCurrency] = useState<SaleCurrency>('MXN');
  const [paymentMethod, setPaymentMethod] = useState<VentaPaymentMethod>('CASH');
  const [bankChannel, setBankChannel] = useState<VentaBankChannel | ''>('');
  const [saleDate, setSaleDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Filter state ───────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<SaleFilters>(EMPTY_FILTERS);

  // ── Flash ──────────────────────────────────────────────────────────────────
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

  const loadFx = useCallback(async () => {
    setFxLoading(true);
    setFxError(null);
    try {
      const rate = await getFxUsdMxn();
      setFxRate(rate);
    } catch {
      setFxError('No se pudo obtener el tipo de cambio. Intenta de nuevo más tarde.');
    } finally {
      setFxLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { void loadFx(); }, [loadFx]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 7000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ── Derived calculations ───────────────────────────────────────────────────

  const salePriceNum = Number(salePrice) || 0;
  const previewMxn = saleCurrency === 'USD' && fxRate ? salePriceNum * fxRate.rate : salePriceNum;
  const commissionRate = paymentMethod === 'BANCOS' && bankChannel ? BANK_RATES[bankChannel] : 0;
  const bankFeeAmt = previewMxn * commissionRate;
  const netReceivedAmt = previewMxn - bankFeeAmt;
  const isBancos = paymentMethod === 'BANCOS';
  const usdBlocked = saleCurrency === 'USD' && !fxRate;
  const isDisabled =
    submitting || !watchId || !clientId || salePriceNum <= 0 ||
    !salePrice.trim() || (isBancos && !bankChannel) || usdBlocked;

  // ── KPI derivation ─────────────────────────────────────────────────────────

  const now = new Date();
  const salesThisMonth = recentSales.filter((s) => {
    const d = new Date(s.soldAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const revenueThisMonth = salesThisMonth.reduce((sum, s) => sum + Number(s.agreedPrice), 0);
  const monthName = now.toLocaleDateString('es-MX', { month: 'long' });
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  // ── Client-side filtering ──────────────────────────────────────────────────

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v !== '').length,
    [filters],
  );

  const filteredSales = useMemo(() => {
    return recentSales.filter((sale) => {
      const saleDay = sale.soldAt.slice(0, 10); // YYYY-MM-DD
      if (filters.dateFrom && saleDay < filters.dateFrom) return false;
      if (filters.dateTo && saleDay > filters.dateTo) return false;
      if (filters.paymentMethod) {
        const method = sale.payments[0]?.method ?? '';
        if (method !== filters.paymentMethod) return false;
      }
      if (filters.currency) {
        // Legacy records (null) are treated as MXN
        const cur = sale.originalCurrency ?? 'MXN';
        if (cur !== filters.currency) return false;
      }
      if (filters.buyer.trim()) {
        const q = filters.buyer.trim().toLowerCase();
        if (!sale.buyer.name.toLowerCase().includes(q)) return false;
      }
      if (filters.watchSearch.trim()) {
        const q = filters.watchSearch.trim().toLowerCase();
        const hit =
          sale.watch.brand.toLowerCase().includes(q) ||
          sale.watch.model.toLowerCase().includes(q) ||
          (sale.watch.serialNumber?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      if (filters.minAmount.trim()) {
        const min = Number(filters.minAmount);
        if (Number.isFinite(min) && Number(sale.agreedPrice) < min) return false;
      }
      if (filters.maxAmount.trim()) {
        const max = Number(filters.maxAmount);
        if (Number.isFinite(max) && Number(sale.agreedPrice) > max) return false;
      }
      return true;
    });
  }, [recentSales, filters]);

  // ── Form handlers ──────────────────────────────────────────────────────────

  const handlePaymentMethodChange = (m: VentaPaymentMethod) => {
    setPaymentMethod(m);
    if (m !== 'BANCOS') setBankChannel('');
  };

  const handleCurrencyChange = (c: SaleCurrency) => {
    setSaleCurrency(c);
    if (c === 'USD' && !fxRate) void loadFx();
  };

  const setFilter = (field: keyof SaleFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [field]: value }));

  const resetForm = () => {
    setWatchId(''); setClientId(''); setSalePrice(''); setSaleCurrency('MXN');
    setPaymentMethod('CASH'); setBankChannel(''); setSaleDate(todayIso());
    setNotes(''); setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await registerSale({
        watchId, clientId, salePrice: salePriceNum, paymentMethod,
        bankChannel: isBancos && bankChannel ? bankChannel : undefined,
        saleDate: saleDate || undefined,
        notes: notes.trim() || undefined,
        currency: saleCurrency,
      });

      if (saleCurrency === 'USD' && response.originalAmount && response.exchangeRate) {
        const rate = Number(response.exchangeRate).toFixed(2);
        setFlash({
          type: 'success',
          message: `Venta registrada. ${formatUsd(response.originalAmount)} convertido a ${formatMoney(response.salePrice)} con tipo de cambio $${rate}.`,
        });
      } else {
        setFlash({ type: 'success', message: 'Venta registrada correctamente.' });
      }

      resetForm();
      void loadData();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'No se pudo registrar la venta.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const filterInputClass =
    'h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition';

  return (
    <section className="ui-page">

      {/* Flash */}
      {flash && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          flash.type === 'success'
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100'
            : 'border-rose-500/35 bg-rose-500/10 text-rose-100'
        }`}>
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
          highlight={summary ? (Number(summary.totalProfit) >= 0 ? 'positive' : 'negative') : undefined}
        />
      </div>

      {/* Body */}
      {dataError ? (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{dataError}</p>
          <button type="button" onClick={() => void loadData()} className="mt-3 text-sm underline text-rose-200">
            Reintentar
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[400px_minmax(0,1fr)]">

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

              <div>
                <label className="ui-field-label">Reloj vendido</label>
                <select value={watchId} onChange={(e) => setWatchId(e.target.value)} className="ui-input" disabled={dataLoading || submitting} required>
                  <option value="">{dataLoading ? 'Cargando...' : 'Seleccionar reloj'}</option>
                  {watches.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.brand} {w.model}{w.serialNumber ? ` — ${w.serialNumber}` : ''}{' '}
                      ({formatMoney(w.priceMin)}–{formatMoney(w.priceMax)})
                    </option>
                  ))}
                </select>
                {!dataLoading && watches.length === 0 && (
                  <p className="mt-1 text-xs text-muted/70">No hay relojes disponibles en inventario.</p>
                )}
              </div>

              <div>
                <label className="ui-field-label">Comprador</label>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="ui-input" disabled={dataLoading || submitting} required>
                  <option value="">{dataLoading ? 'Cargando...' : 'Seleccionar comprador'}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Currency selector */}
              <div>
                <label className="ui-field-label">Moneda</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => handleCurrencyChange('MXN')} disabled={submitting}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${saleCurrency === 'MXN' ? 'border-white/35 bg-white/10 font-semibold text-white' : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'}`}>
                    Pesos
                  </button>
                  <button type="button" onClick={() => handleCurrencyChange('USD')} disabled={submitting || (fxError !== null && !fxRate)}
                    title={fxError && !fxRate ? fxError : undefined}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      saleCurrency === 'USD' ? 'border-white/35 bg-white/10 font-semibold text-white' :
                      fxError && !fxRate ? 'border-white/5 text-white/20 cursor-not-allowed' :
                      'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
                    }`}>
                    Dólares
                  </button>
                </div>
                <div className="mt-2 min-h-[28px]">
                  {fxLoading ? (
                    <div className="h-4 w-48 rounded bg-white/[0.05] animate-pulse" />
                  ) : fxRate ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs text-white/50">
                        Tipo de cambio:{' '}
                        <span className={`font-semibold ${saleCurrency === 'USD' ? 'text-white/80' : 'text-white/40'}`}>
                          ${fxRate.rate.toFixed(2)}
                        </span>
                      </span>
                      <span className="text-[10px] text-white/25">
                        {fxRate.source} · {timeAgo(fxRate.fetchedAt)}
                        {fxRate.stale && ' · desactualizado'}
                      </span>
                    </div>
                  ) : fxError ? (
                    <p className="text-[11px] text-rose-300/80">{fxError}</p>
                  ) : null}
                </div>
              </div>

              {/* Sale price */}
              <div>
                <label className="ui-field-label">
                  {saleCurrency === 'USD' ? 'Precio de venta en dólares' : 'Precio de venta'}
                </label>
                <input type="number" step="0.01" min="0.01" value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)} placeholder="0.00"
                  className="ui-input" disabled={submitting} required />
                <p className="mt-1 text-[11px] text-white/30">
                  {saleCurrency === 'USD'
                    ? 'Se convertirá automáticamente a pesos al registrar la venta.'
                    : 'Se registrará en pesos.'}
                </p>
              </div>

              {/* USD conversion preview */}
              {saleCurrency === 'USD' && salePriceNum > 0 && fxRate && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-white/30">Venta estimada en pesos</p>
                  <p className="text-base font-semibold text-white">{formatMoney(previewMxn)}</p>
                  <p className="text-[10px] text-white/25">
                    {formatUsd(salePriceNum)} × ${fxRate.rate.toFixed(2)}
                  </p>
                </div>
              )}

              {/* Payment method */}
              <div>
                <label className="ui-field-label">Método de pago</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHOD_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => handlePaymentMethodChange(opt.value)}
                      disabled={submitting}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${
                        paymentMethod === opt.value
                          ? 'border-white/35 bg-white/10 font-semibold text-white'
                          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
                      }`}>
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
                        <button key={opt.value} type="button" onClick={() => setBankChannel(opt.value)}
                          disabled={submitting}
                          className={`rounded-lg border px-3 py-2 text-sm transition ${
                            bankChannel === opt.value
                              ? 'border-white/35 bg-white/10 font-semibold text-white'
                              : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
                          }`}>
                          {opt.label}
                          <span className="ml-1 text-xs text-white/30">
                            ({(opt.rate * 100).toFixed(0)}%)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {bankChannel && salePriceNum > 0 && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-widest text-white/30">Comisión bancaria</p>
                        <p className="mt-1.5 text-sm font-semibold text-amber-300">
                          {formatMoney(bankFeeAmt)}
                          <span className="ml-1 text-xs font-normal text-white/30">({(commissionRate * 100).toFixed(0)}%)</span>
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-widest text-white/30">Neto recibido</p>
                        <p className="mt-1.5 text-sm font-semibold text-emerald-300">{formatMoney(netReceivedAmt)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="ui-field-label">Fecha de venta</label>
                <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="ui-input" disabled={submitting} />
              </div>

              <div>
                <label className="ui-field-label">Notas (opcional)</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalles adicionales de la venta…" className="ui-input resize-none" disabled={submitting} />
              </div>

              {saleCurrency === 'USD' && fxError && !fxRate && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.08] px-3 py-2.5 text-xs text-rose-300/90">
                  {fxError}
                </div>
              )}

              <button type="submit" disabled={isDisabled} className="ui-btn-primary w-full py-2.5 disabled:opacity-50">
                {submitting ? 'Registrando…' : 'Registrar venta'}
              </button>
            </form>
          </article>

          {/* ── Recent sales table ───────────────────────────────────────── */}
          <article className="rounded-2xl border border-white/[0.07] bg-panel shadow-sm shadow-black/20 min-w-0 overflow-hidden">

            <div className="px-4 py-4 border-b border-white/[0.05] space-y-3">
              <h2 className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Ventas recientes
              </h2>

              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date" value={filters.dateFrom}
                  onChange={(e) => setFilter('dateFrom', e.target.value)}
                  title="Desde"
                  className={`${filterInputClass} w-36`}
                />
                <input
                  type="date" value={filters.dateTo}
                  onChange={(e) => setFilter('dateTo', e.target.value)}
                  title="Hasta"
                  className={`${filterInputClass} w-36`}
                />
                <select
                  value={filters.paymentMethod}
                  onChange={(e) => setFilter('paymentMethod', e.target.value)}
                  className={`${filterInputClass} w-36`}
                >
                  <option value="">Método: Todos</option>
                  <option value="CASH">Efectivo</option>
                  <option value="BANCOS">Bancos</option>
                  <option value="CESAR">César</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="TRANSFER">Transferencia</option>
                </select>
                <select
                  value={filters.currency}
                  onChange={(e) => setFilter('currency', e.target.value)}
                  className={`${filterInputClass} w-32`}
                >
                  <option value="">Moneda: Todas</option>
                  <option value="MXN">Pesos</option>
                  <option value="USD">Dólares</option>
                </select>
                <input
                  type="text" value={filters.buyer}
                  onChange={(e) => setFilter('buyer', e.target.value)}
                  placeholder="Comprador…"
                  className={`${filterInputClass} w-28`}
                />
                <input
                  type="text" value={filters.watchSearch}
                  onChange={(e) => setFilter('watchSearch', e.target.value)}
                  placeholder="Reloj, marca…"
                  className={`${filterInputClass} w-28`}
                />
                <input
                  type="number" value={filters.minAmount}
                  onChange={(e) => setFilter('minAmount', e.target.value)}
                  placeholder="$ Mín"
                  className={`${filterInputClass} w-20`}
                />
                <input
                  type="number" value={filters.maxAmount}
                  onChange={(e) => setFilter('maxAmount', e.target.value)}
                  placeholder="$ Máx"
                  className={`${filterInputClass} w-20`}
                />
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/40 hover:text-white/70 hover:border-white/20 transition whitespace-nowrap"
                  >
                    Limpiar ({activeFilterCount})
                  </button>
                )}
              </div>

              {/* Result count — only when filters active */}
              {activeFilterCount > 0 && !dataLoading && (
                <p className="text-[10px] text-white/25">
                  {filteredSales.length} de {recentSales.length} ventas
                </p>
              )}
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
                <p className="mt-1.5 text-xs text-white/20">Las ventas registradas aparecerán aquí.</p>
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-white/40">Sin resultados para los filtros aplicados.</p>
                <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}
                  className="mt-2 text-xs underline text-white/30 hover:text-white/60 transition">
                  Limpiar filtros
                </button>
              </div>
            ) : (
              /* table-fixed: columns use th widths; Reloj column absorbs remaining space */
              <div className="overflow-x-auto">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="w-[88px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">Fecha</th>
                      <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">Reloj</th>
                      <th className="w-[118px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 hidden 2xl:table-cell">Comprador</th>
                      <th className="w-[108px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40">Precio</th>
                      <th className="w-[128px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 hidden md:table-cell">Método</th>
                      <th className="w-[88px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 hidden lg:table-cell">Comisión</th>
                      <th className="w-[132px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/40 hidden lg:table-cell">Neto recibido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {filteredSales.map((sale) => {
                      const method = sale.payments[0]?.method ?? null;
                      const hasFee = !!sale.bankFee && Number(sale.bankFee) > 0;
                      const hasUsdMeta =
                        sale.originalCurrency === 'USD' &&
                        !!sale.originalAmount &&
                        !!sale.exchangeRate;
                      return (
                        <tr key={sale.dealId} className="transition-colors duration-150 hover:bg-white/[0.02]">
                          <td className="px-3 py-4 text-xs tabular-nums text-white/35 whitespace-nowrap align-top pt-[18px]">
                            {formatDate(sale.soldAt)}
                          </td>
                          <td className="px-3 py-4 align-middle overflow-hidden">
                            <p className="text-sm font-semibold text-white leading-tight truncate">{sale.watch.brand}</p>
                            <p className="mt-0.5 text-xs text-white/50 truncate">{sale.watch.model}</p>
                            {sale.watch.serialNumber && (
                              <p className="mt-0.5 text-[10px] font-mono tracking-[0.14em] text-white/25 uppercase truncate">
                                {sale.watch.serialNumber}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-4 align-middle hidden 2xl:table-cell overflow-hidden">
                            <p className="text-sm text-white/55 truncate">{sale.buyer.name}</p>
                          </td>
                          <td className="px-3 py-4 text-right align-middle">
                            <span className="text-sm font-bold tabular-nums text-white whitespace-nowrap">
                              {formatMoney(sale.agreedPrice)}
                            </span>
                            {hasUsdMeta && (
                              <p className="mt-0.5 text-[10px] text-white/25 tabular-nums">
                                {formatUsd(sale.originalAmount)} @ ${Number(sale.exchangeRate).toFixed(2)}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-4 align-middle hidden md:table-cell">
                            <PaymentBadge method={method} />
                          </td>
                          <td className="px-3 py-4 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                            {hasFee ? (
                              <span className="text-xs tabular-nums text-amber-400/75">
                                {formatMoney(sale.bankFee)}
                              </span>
                            ) : (
                              <span className="text-xs text-white/20">—</span>
                            )}
                          </td>
                          <td className="px-3 py-4 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                            <span className="text-base font-semibold tabular-nums text-emerald-400">
                              {formatMoney(sale.netReceived)}
                            </span>
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
