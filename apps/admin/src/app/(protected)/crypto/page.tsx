'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { readSession } from '@/lib/auth-storage';
import {
  createCryptoHolding,
  createCryptoPrice,
  deleteCryptoHolding,
  getCryptoSummary,
  listCryptoHoldings,
  updateCryptoHolding,
  type CryptoHolding,
  type CryptoPriceStatus,
  type CryptoSummary,
} from '@/lib/crypto-api';

/** Wrist Caviar production tenant — custodian default only applies here. */
const WRIST_CAVIAR_TENANT_ID = 'cmnzph8dm0000qotapt94alxs';

function fmtMxn(value: string | number | null | undefined, digits = 2) {
  const n = Number(value);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtQty(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: 8,
  }).format(n);
}

function fmtWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function priceStatusLabel(status: CryptoPriceStatus) {
  switch (status) {
    case 'FRESH':
      return 'Fresco';
    case 'STALE':
      return 'Desactualizado';
    case 'VERY_STALE':
      return 'Muy desactualizado';
    default:
      return 'Sin precio';
  }
}

function priceStatusClass(status: CryptoPriceStatus) {
  switch (status) {
    case 'FRESH':
      return 'text-emerald-400';
    case 'STALE':
      return 'text-amber-300';
    case 'VERY_STALE':
      return 'text-orange-400';
    default:
      return 'text-rose-400';
  }
}

function pnlClass(value: string | null) {
  if (value == null) return 'text-white/40';
  const n = Number(value);
  if (n > 0) return 'text-emerald-400';
  if (n < 0) return 'text-rose-400';
  return 'text-white/60';
}

type HoldingForm = {
  ticker: string;
  name: string;
  quantity: string;
  averageCostMxn: string;
  location: string;
  custodian: string;
  notes: string;
};

type PriceForm = {
  ticker: string;
  priceMxn: string;
  capturedAt: string;
  source: string;
  notes: string;
};

function emptyHoldingForm(defaultCustodian: string): HoldingForm {
  return {
    ticker: '',
    name: '',
    quantity: '',
    averageCostMxn: '',
    location: '',
    custodian: defaultCustodian,
    notes: '',
  };
}

function emptyPriceForm(ticker = ''): PriceForm {
  const local = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const capturedAt = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
  return {
    ticker,
    priceMxn: '',
    capturedAt,
    source: '',
    notes: '',
  };
}

function resolveDefaultCustodian(): string {
  const session = readSession();
  return session?.user?.tenantId === WRIST_CAVIAR_TENANT_ID ? 'César' : '';
}

export default function CryptoPage() {
  const [summary, setSummary] = useState<CryptoSummary | null>(null);
  const [holdings, setHoldings] = useState<CryptoHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [holdingModal, setHoldingModal] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [holdingForm, setHoldingForm] = useState<HoldingForm>(() =>
    emptyHoldingForm(''),
  );
  const [priceModal, setPriceModal] = useState(false);
  const [priceForm, setPriceForm] = useState<PriceForm>(() => emptyPriceForm());
  const [defaultCustodian, setDefaultCustodian] = useState('');

  useEffect(() => {
    const custodian = resolveDefaultCustodian();
    setDefaultCustodian(custodian);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, h] = await Promise.all([getCryptoSummary(), listCryptoHoldings()]);
      setSummary(s);
      setHoldings(h);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar crypto');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const preview = useMemo(() => {
    const qty = Number(holdingForm.quantity);
    const avg = Number(holdingForm.averageCostMxn);
    const cost =
      Number.isFinite(qty) && Number.isFinite(avg) ? qty * avg : null;
    const ticker = holdingForm.ticker.trim().toUpperCase();
    const match = holdings.find((h) => h.ticker === ticker && h.latestPriceMxn);
    const price = match?.latestPriceMxn ? Number(match.latestPriceMxn) : null;
    const value =
      cost != null && price != null && Number.isFinite(qty) ? qty * price : null;
    const pnl = value != null && cost != null ? value - cost : null;
    return { cost, value, pnl, price };
  }, [holdingForm, holdings]);

  function openCreateHolding() {
    setEditingId(null);
    setHoldingForm(emptyHoldingForm(defaultCustodian));
    setHoldingModal('create');
  }

  function openEditHolding(h: CryptoHolding) {
    setEditingId(h.id);
    setHoldingForm({
      ticker: h.ticker,
      name: h.name,
      quantity: h.quantity,
      averageCostMxn: h.averageCostMxn,
      location: h.location,
      custodian: h.custodian ?? '',
      notes: h.notes ?? '',
    });
    setHoldingModal('edit');
  }

  function openPrice(ticker?: string) {
    setPriceForm(emptyPriceForm(ticker ?? ''));
    setPriceModal(true);
  }

  async function submitHolding(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        ticker: holdingForm.ticker.trim(),
        name: holdingForm.name.trim(),
        quantity: Number(holdingForm.quantity),
        averageCostMxn: Number(holdingForm.averageCostMxn),
        location: holdingForm.location.trim(),
        custodian: holdingForm.custodian.trim() || undefined,
        notes: holdingForm.notes.trim() || undefined,
      };
      if (holdingModal === 'edit' && editingId) {
        await updateCryptoHolding(editingId, body);
      } else {
        await createCryptoHolding(body);
      }
      setHoldingModal(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la posición');
    } finally {
      setBusy(false);
    }
  }

  async function submitPrice(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const local = priceForm.capturedAt;
      const capturedAt = new Date(local).toISOString();
      await createCryptoPrice({
        ticker: priceForm.ticker.trim(),
        priceMxn: Number(priceForm.priceMxn),
        capturedAt,
        source: priceForm.source.trim(),
        notes: priceForm.notes.trim() || undefined,
      });
      setPriceModal(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar el precio');
    } finally {
      setBusy(false);
    }
  }

  async function deactivateHolding(h: CryptoHolding) {
    if (
      !window.confirm(
        `¿Desactivar posición ${h.ticker} en ${h.location}? El historial de precios se conserva.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteCryptoHolding(h.id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo desactivar');
    } finally {
      setBusy(false);
    }
  }

  const kpis = [
    {
      label: 'Valor actual',
      value: summary ? fmtMxn(summary.totalCurrentValueMxn) : '—',
      tone: 'text-emerald-400',
    },
    {
      label: 'Costo base',
      value: summary ? fmtMxn(summary.totalCostBasisMxn) : '—',
      tone: 'text-white',
    },
    {
      label: 'P&L no realizado',
      value: summary
        ? `${Number(summary.unrealizedPnlMxn) >= 0 ? '+' : ''}${fmtMxn(summary.unrealizedPnlMxn)}${
            summary.unrealizedPnlPercent != null
              ? ` (${summary.unrealizedPnlPercent}%)`
              : ''
          }`
        : '—',
      tone: summary ? pnlClass(summary.unrealizedPnlMxn) : 'text-white/50',
    },
    {
      label: 'Posiciones',
      value: summary ? String(summary.activeHoldingCount) : '—',
      tone: 'text-white',
    },
    {
      label: 'Última actualización',
      value: summary?.newestPriceCapturedAt
        ? fmtWhen(summary.newestPriceCapturedAt)
        : 'Sin precios',
      tone: 'text-white/70',
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Crypto</h1>
          <p className="mt-1 text-sm text-white/45">
            Activos digitales de Wrist Caviar
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openPrice()}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.06]"
          >
            Registrar precio
          </button>
          <button
            type="button"
            onClick={openCreateHolding}
            className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black transition hover:bg-emerald-400"
          >
            Agregar posición
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {summary && summary.unpricedHoldingCount > 0 ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100/90">
          Liquidez parcial: {summary.unpricedHoldingCount} activo
          {summary.unpricedHoldingCount === 1 ? '' : 's'} sin precio (
          {summary.missingPriceTickers.join(', ')}). No se incluyen en el valor de crypto.
        </div>
      ) : null}

      {summary &&
      (summary.cryptoPriceStatus === 'STALE' ||
        summary.cryptoPriceStatus === 'VERY_STALE') ? (
        <div className="rounded-xl border border-orange-400/20 bg-orange-500/[0.08] px-4 py-3 text-sm text-orange-100/90">
          Crypto valuado con precios desactualizados (
          {priceStatusLabel(summary.cryptoPriceStatus)}).
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <article
            key={k.label}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              {k.label}
            </p>
            <p className={`mt-2 text-lg font-semibold tabular-nums ${k.tone}`}>
              {loading ? '…' : k.value}
            </p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015]">
        <div className="border-b border-white/[0.05] px-4 py-3">
          <h2 className="text-sm font-medium text-white/80">Posiciones</h2>
          <p className="text-xs text-white/35">
            La propiedad es de Wrist Caviar. César puede figurar como custodio.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.02] text-[11px] uppercase tracking-wide text-white/35">
              <tr>
                <th className="px-3 py-2.5 font-medium">Activo</th>
                <th className="px-3 py-2.5 font-medium">Nombre</th>
                <th className="px-3 py-2.5 font-medium">Cantidad</th>
                <th className="px-3 py-2.5 font-medium">Costo promedio</th>
                <th className="px-3 py-2.5 font-medium">Costo base</th>
                <th className="px-3 py-2.5 font-medium">Precio actual</th>
                <th className="px-3 py-2.5 font-medium">Valor actual</th>
                <th className="px-3 py-2.5 font-medium">P&L</th>
                <th className="px-3 py-2.5 font-medium">Exchange / Wallet</th>
                <th className="px-3 py-2.5 font-medium">Custodio</th>
                <th className="px-3 py-2.5 font-medium">Actualización</th>
                <th className="px-3 py-2.5 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-white/40">
                    Cargando…
                  </td>
                </tr>
              ) : holdings.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-white/40">
                    Sin posiciones crypto. Agrega la primera posición confirmada por el
                    negocio.
                  </td>
                </tr>
              ) : (
                holdings.map((h) => (
                  <tr
                    key={h.id}
                    className="border-t border-white/[0.04] text-white/80 hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2.5 font-medium text-white">{h.ticker}</td>
                    <td className="px-3 py-2.5">{h.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtQty(h.quantity)}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {fmtMxn(h.averageCostMxn, 2)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtMxn(h.costBasisMxn)}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {h.latestPriceMxn != null ? fmtMxn(h.latestPriceMxn) : '—'}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {h.currentValueMxn != null ? fmtMxn(h.currentValueMxn) : '—'}
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums ${pnlClass(h.unrealizedPnlMxn)}`}>
                      {h.unrealizedPnlMxn != null
                        ? `${Number(h.unrealizedPnlMxn) >= 0 ? '+' : ''}${fmtMxn(h.unrealizedPnlMxn)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5">{h.location}</td>
                    <td className="px-3 py-2.5">{h.custodian ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className={priceStatusClass(h.priceStatus)}>
                        {priceStatusLabel(h.priceStatus)}
                      </div>
                      <div className="text-[11px] text-white/35">
                        {fmtWhen(h.priceCapturedAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-1 text-xs">
                        <button
                          type="button"
                          className="text-left text-emerald-400/90 hover:underline"
                          onClick={() => openEditHolding(h)}
                          disabled={busy}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="text-left text-white/60 hover:underline"
                          onClick={() => openPrice(h.ticker)}
                          disabled={busy}
                        >
                          Precio
                        </button>
                        <button
                          type="button"
                          className="text-left text-rose-300/80 hover:underline"
                          onClick={() => void deactivateHolding(h)}
                          disabled={busy}
                        >
                          Desactivar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {holdingModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={(e) => void submitHolding(e)}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-panel p-5 shadow-2xl"
          >
            <h3 className="text-lg font-medium text-white">
              {holdingModal === 'create' ? 'Agregar posición' : 'Editar posición'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-1 space-y-1 text-xs text-white/50">
                Ticker
                <input
                  required
                  value={holdingForm.ticker}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, ticker: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="BTC"
                />
              </label>
              <label className="col-span-1 space-y-1 text-xs text-white/50">
                Nombre
                <input
                  required
                  value={holdingForm.name}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Bitcoin"
                />
              </label>
              <label className="space-y-1 text-xs text-white/50">
                Cantidad
                <input
                  required
                  type="number"
                  step="any"
                  min="0"
                  value={holdingForm.quantity}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, quantity: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="space-y-1 text-xs text-white/50">
                Costo promedio (MXN / unidad)
                <input
                  required
                  type="number"
                  step="any"
                  min="0"
                  value={holdingForm.averageCostMxn}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, averageCostMxn: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="col-span-2 space-y-1 text-xs text-white/50">
                Exchange / Wallet
                <input
                  required
                  value={holdingForm.location}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, location: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="Binance, Ledger…"
                />
              </label>
              <label className="col-span-2 space-y-1 text-xs text-white/50">
                Custodio
                <input
                  value={holdingForm.custodian}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, custodian: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  placeholder="César"
                />
                <span className="block text-[11px] leading-snug text-white/35">
                  Persona que administra o resguarda el activo. La propiedad continúa
                  siendo de Wrist Caviar.
                </span>
              </label>
              <label className="col-span-2 space-y-1 text-xs text-white/50">
                Notas
                <textarea
                  value={holdingForm.notes}
                  onChange={(e) =>
                    setHoldingForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  className="min-h-[72px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-white/55">
              <p>
                Costo base:{' '}
                <span className="tabular-nums text-white">
                  {preview.cost != null ? fmtMxn(preview.cost) : '—'}
                </span>
              </p>
              <p>
                Valor actual:{' '}
                <span className="tabular-nums text-white">
                  {preview.value != null ? fmtMxn(preview.value) : '—'}
                </span>
                {preview.price == null ? (
                  <span className="text-white/35"> (sin precio para este ticker)</span>
                ) : null}
              </p>
              <p>
                P&L no realizado:{' '}
                <span className={`tabular-nums ${pnlClass(preview.pnl?.toFixed(2) ?? null)}`}>
                  {preview.pnl != null ? fmtMxn(preview.pnl) : '—'}
                </span>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHoldingModal(null)}
                className="rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {priceModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={(e) => void submitPrice(e)}
            className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-panel p-5 shadow-2xl"
          >
            <h3 className="text-lg font-medium text-white">Registrar precio</h3>
            <label className="block space-y-1 text-xs text-white/50">
              Ticker
              <input
                required
                value={priceForm.ticker}
                onChange={(e) =>
                  setPriceForm((f) => ({ ...f, ticker: e.target.value }))
                }
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block space-y-1 text-xs text-white/50">
              Precio MXN por unidad
              <input
                required
                type="number"
                step="any"
                min="0.00000001"
                value={priceForm.priceMxn}
                onChange={(e) =>
                  setPriceForm((f) => ({ ...f, priceMxn: e.target.value }))
                }
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block space-y-1 text-xs text-white/50">
              Fecha / hora de captura
              <input
                required
                type="datetime-local"
                value={priceForm.capturedAt}
                onChange={(e) =>
                  setPriceForm((f) => ({ ...f, capturedAt: e.target.value }))
                }
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block space-y-1 text-xs text-white/50">
              Fuente
              <input
                required
                list="crypto-price-sources"
                value={priceForm.source}
                onChange={(e) =>
                  setPriceForm((f) => ({ ...f, source: e.target.value }))
                }
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                placeholder="Binance, Coinbase…"
              />
              <datalist id="crypto-price-sources">
                <option value="Binance" />
                <option value="Coinbase" />
                <option value="CoinMarketCap" />
                <option value="Manual review" />
              </datalist>
            </label>
            <label className="block space-y-1 text-xs text-white/50">
              Notas
              <textarea
                value={priceForm.notes}
                onChange={(e) =>
                  setPriceForm((f) => ({ ...f, notes: e.target.value }))
                }
                className="min-h-[64px] w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPriceModal(false)}
                className="rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                Registrar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
