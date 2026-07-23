'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiGet, ApiError } from '@/lib/api-client';
import type { PaymentMethod, PaymentStatus, WatchOwnershipType, WatchStatus } from '@/types/domain';

// --- Types ---

type HistorySummary = {
  totalAcquired: number;
  totalSold: number;
  currentStock: number;
  totalRevenue: string;
  totalCostOfSold: string;
  totalBankFees?: string | number | null;
  totalProfit: string;
};

type SoldItem = {
  dealId: string;
  watch: {
    id: string;
    brand: string;
    model: string;
    serialNumber: string | null;
    condition: string;
    cost: string;
    effectiveCost: string;
    ownershipType: WatchOwnershipType;
    consignmentOwnerName: string | null;
    consignmentSplitPercentage: string | null;
  };
  buyer: { id: string; name: string; email: string | null; phone: string | null };
  agreedPrice: string;
  originalCurrency?: 'MXN' | 'USD' | null;
  originalAmount?: string | null;
  exchangeRate?: string | null;
  bankFee?: string | null;
  netReceived: string;
  notes: string | null;
  soldAt: string;
  createdAt: string;
  payments: { id: string; amount: string; method: PaymentMethod; status: PaymentStatus; paidAt: string | null }[];
};

type StockWatch = {
  id: string;
  brand: string;
  model: string;
  serialNumber: string | null;
  condition: string;
  cost: string;
  priceMin: string;
  priceMax: string;
  effectiveCost: string;
  status: WatchStatus;
  ownershipType: WatchOwnershipType;
  consignmentOwnerName: string | null;
  createdAt: string;
  deletedAt: string | null;
};

type Movement = {
  dealId: string;
  stage: string;
  watch: { id: string; brand: string; model: string; serialNumber: string | null; status: WatchStatus };
  client: { id: string; name: string; email: string | null; phone: string | null };
  agreedPrice: string;
  notes: string | null;
  expectedCloseAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SoldFilters = {
  dateFrom: string;
  dateTo: string;
  watchSearch: string;
  buyer: string;
  paymentMethod: string;
  currency: string;
  minAmount: string;
  maxAmount: string;
};

const EMPTY_SOLD_FILTERS: SoldFilters = {
  dateFrom: '', dateTo: '', watchSearch: '', buyer: '',
  paymentMethod: '', currency: '', minAmount: '', maxAmount: '',
};

// --- Helpers ---

function formatMoney(value: string | number) {
  const n = Number(value);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatUsd(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `USD ${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function dash(value: string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  return value;
}

const STAGE_LABELS: Record<string, string> = {
  LEAD: 'Prospecto',
  INTERESTED: 'Interesado',
  NEGOTIATING: 'Negociando',
  PENDING_PAYMENT: 'Pago pendiente',
  CLOSED_WON: 'Cerrado ganado',
  CLOSED_LOST: 'Cerrado perdido',
};

const STAGE_COLORS: Record<string, string> = {
  LEAD: 'bg-white/8 text-white/50',
  INTERESTED: 'bg-white/8 text-white/60',
  NEGOTIATING: 'bg-amber-500/20 text-amber-300',
  PENDING_PAYMENT: 'bg-amber-500/20 text-amber-300',
  CLOSED_WON: 'bg-emerald-500/20 text-emerald-300',
  CLOSED_LOST: 'bg-rose-500/20 text-rose-300',
};

const STATUS_COLORS: Record<WatchStatus, string> = {
  AVAILABLE: 'bg-emerald-500/20 text-emerald-300',
  RESERVED: 'bg-amber-500/20 text-amber-300',
  SOLD: 'bg-white/8 text-white/50',
  IN_TRANSIT: 'bg-white/8 text-white/60',
  IN_SERVICE: 'bg-white/8 text-white/60',
};

type Tab = 'movements' | 'sold' | 'stock' | 'acquired';

const TABS: { id: Tab; label: string }[] = [
  { id: 'movements', label: 'Movimientos' },
  { id: 'sold', label: 'Vendidos' },
  { id: 'stock', label: 'En stock' },
  { id: 'acquired', label: 'Adquiridos' },
];

const filterInputClass =
  'h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition';

// --- Page ---

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('movements');

  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [sold, setSold] = useState<SoldItem[]>([]);
  const [stock, setStock] = useState<StockWatch[]>([]);
  const [acquired, setAcquired] = useState<StockWatch[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-tab search/filter state
  const [soldFilters, setSoldFilters] = useState<SoldFilters>(EMPTY_SOLD_FILTERS);
  const [movementsSearch, setMovementsSearch] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [acquiredSearch, setAcquiredSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, soldData, stockData, acquiredData, movementsData] = await Promise.all([
        apiGet<HistorySummary>('/history/summary', { authenticated: true }),
        apiGet<SoldItem[]>('/history/sold', { authenticated: true }),
        apiGet<StockWatch[]>('/history/stock', { authenticated: true }),
        apiGet<StockWatch[]>('/history/acquired', { authenticated: true }),
        apiGet<Movement[]>('/history/movements', { authenticated: true }),
      ]);
      setSummary(summaryData);
      setSold(soldData);
      setStock(stockData);
      setAcquired(acquiredData);
      setMovements(movementsData);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // --- Client-side filtering ---

  const setSoldFilter = (field: keyof SoldFilters, value: string) =>
    setSoldFilters((prev) => ({ ...prev, [field]: value }));

  const soldActiveFilters = useMemo(
    () => Object.values(soldFilters).filter((v) => v !== '').length,
    [soldFilters],
  );

  const filteredSold = useMemo(() => {
    return sold.filter((item) => {
      const saleDay = item.soldAt.slice(0, 10);
      if (soldFilters.dateFrom && saleDay < soldFilters.dateFrom) return false;
      if (soldFilters.dateTo && saleDay > soldFilters.dateTo) return false;
      if (soldFilters.watchSearch.trim()) {
        const q = soldFilters.watchSearch.trim().toLowerCase();
        if (
          !item.watch.brand?.toLowerCase().includes(q) &&
          !item.watch.model?.toLowerCase().includes(q) &&
          !(item.watch.serialNumber?.toLowerCase().includes(q) ?? false)
        ) return false;
      }
      if (soldFilters.buyer.trim()) {
        if (!item.buyer.name.toLowerCase().includes(soldFilters.buyer.trim().toLowerCase()))
          return false;
      }
      if (soldFilters.paymentMethod) {
        const method = item.payments[0]?.method ?? '';
        if (method !== soldFilters.paymentMethod) return false;
      }
      if (soldFilters.currency) {
        const cur = item.originalCurrency ?? 'MXN';
        if (cur !== soldFilters.currency) return false;
      }
      if (soldFilters.minAmount.trim()) {
        const min = Number(soldFilters.minAmount);
        if (Number.isFinite(min) && Number(item.agreedPrice) < min) return false;
      }
      if (soldFilters.maxAmount.trim()) {
        const max = Number(soldFilters.maxAmount);
        if (Number.isFinite(max) && Number(item.agreedPrice) > max) return false;
      }
      return true;
    });
  }, [sold, soldFilters]);

  const filteredMovements = useMemo(() => {
    if (!movementsSearch.trim()) return movements;
    const q = movementsSearch.trim().toLowerCase();
    return movements.filter(
      (m) =>
        m.watch.brand?.toLowerCase().includes(q) ||
        m.watch.model?.toLowerCase().includes(q) ||
        m.client.name.toLowerCase().includes(q),
    );
  }, [movements, movementsSearch]);

  const filteredStock = useMemo(() => {
    if (!stockSearch.trim()) return stock;
    const q = stockSearch.trim().toLowerCase();
    return stock.filter(
      (w) =>
        w.brand.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q) ||
        (w.serialNumber?.toLowerCase().includes(q) ?? false),
    );
  }, [stock, stockSearch]);

  const filteredAcquired = useMemo(() => {
    if (!acquiredSearch.trim()) return acquired;
    const q = acquiredSearch.trim().toLowerCase();
    return acquired.filter(
      (w) =>
        w.brand.toLowerCase().includes(q) ||
        w.model.toLowerCase().includes(q) ||
        (w.serialNumber?.toLowerCase().includes(q) ?? false),
    );
  }, [acquired, acquiredSearch]);

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Historial</h1>
          <p className="ui-subtitle max-w-2xl">
            Registro completo de cada reloj adquirido, vendido y en movimiento — tu negocio de un vistazo.
          </p>
        </div>
      </header>

      {/* Summary cards — 7 cards: 3 counts + 4 financials */}
      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Adquiridos" value={String(summary.totalAcquired)} />
          <StatCard label="Vendidos" value={String(summary.totalSold)} />
          <StatCard label="En stock" value={String(summary.currentStock)} />
          <StatCard label="Ingresos" value={formatMoney(summary.totalRevenue)} />
          <StatCard label="Costo de ventas" value={formatMoney(summary.totalCostOfSold)} />
          <StatCard
            label="Comisiones bancarias"
            value={summary.totalBankFees != null ? formatMoney(summary.totalBankFees) : '—'}
          />
          <StatCard
            label="Utilidad bruta"
            value={formatMoney(summary.totalProfit)}
            highlight={Number(summary.totalProfit) >= 0 ? 'positive' : 'negative'}
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-6">
          <h3 className="text-sm font-semibold text-rose-100">No se pudo cargar el historial</h3>
          <p className="mt-2 text-sm text-rose-100/90">{error}</p>
          <button type="button" onClick={() => void load()} className="ui-btn-danger mt-4 px-4 py-2 text-rose-50">
            Intentar de nuevo
          </button>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="border-b border-white/10">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-12 rounded-xl bg-white/10" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-white/5" />
          ))}
        </div>
      ) : null}

      {/* Movements tab */}
      {!loading && !error && activeTab === 'movements' ? (
        <>
          {/* Simple search */}
          <div className="flex items-center gap-2">
            <input
              type="text" value={movementsSearch}
              onChange={(e) => setMovementsSearch(e.target.value)}
              placeholder="Buscar por reloj o cliente…"
              className={`${filterInputClass} w-56`}
            />
            {movementsSearch && (
              <button type="button" onClick={() => setMovementsSearch('')}
                className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/40 hover:text-white/70 transition">
                Limpiar
              </button>
            )}
            {movementsSearch.trim() && (
              <span className="text-[10px] text-white/25">
                {filteredMovements.length} de {movements.length}
              </span>
            )}
          </div>
          {filteredMovements.length === 0 ? (
            <EmptyState message="Sin resultados." />
          ) : (
            <TableWrapper>
              <table className="min-w-[900px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Reloj</th>
                    <th className="px-4 py-3 font-medium">Serie</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Etapa</th>
                    <th className="px-4 py-3 font-medium text-right">Precio acordado</th>
                    <th className="px-4 py-3 font-medium">Última actualización</th>
                    <th className="px-4 py-3 font-medium">Creado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((m) => (
                    <tr key={m.dealId} className="border-b border-white/5 hover:bg-white/[0.05] transition duration-150">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{m.watch.brand}</div>
                        <div className="text-xs text-muted">{m.watch.model}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted">{dash(m.watch.serialNumber)}</td>
                      <td className="px-4 py-3">
                        <div className="text-white">{m.client.name}</div>
                        <div className="text-xs text-muted">{dash(m.client.email)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_COLORS[m.stage] ?? 'bg-zinc-500/20 text-zinc-300'}`}>
                          {STAGE_LABELS[m.stage] ?? m.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                        {formatMoney(m.agreedPrice)}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(m.updatedAt)}</td>
                      <td className="px-4 py-3 text-muted">{formatDate(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
          )}
        </>
      ) : null}

      {/* Sold tab */}
      {!loading && !error && activeTab === 'sold' ? (
        <>
          {/* Filter bar */}
          <div className="ui-card p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={soldFilters.dateFrom}
                onChange={(e) => setSoldFilter('dateFrom', e.target.value)}
                title="Desde" className={`${filterInputClass} w-36`} />
              <input type="date" value={soldFilters.dateTo}
                onChange={(e) => setSoldFilter('dateTo', e.target.value)}
                title="Hasta" className={`${filterInputClass} w-36`} />
              <input type="text" value={soldFilters.watchSearch}
                onChange={(e) => setSoldFilter('watchSearch', e.target.value)}
                placeholder="Reloj, marca…" className={`${filterInputClass} w-28`} />
              <input type="text" value={soldFilters.buyer}
                onChange={(e) => setSoldFilter('buyer', e.target.value)}
                placeholder="Comprador…" className={`${filterInputClass} w-28`} />
              <select value={soldFilters.paymentMethod}
                onChange={(e) => setSoldFilter('paymentMethod', e.target.value)}
                className={`${filterInputClass} w-36`}>
                <option value="">Método: Todos</option>
                <option value="CASH">Efectivo</option>
                <option value="BANCOS">Bancos</option>
                <option value="CESAR">César</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
              </select>
              <select value={soldFilters.currency}
                onChange={(e) => setSoldFilter('currency', e.target.value)}
                className={`${filterInputClass} w-32`}>
                <option value="">Moneda: Todas</option>
                <option value="MXN">Pesos</option>
                <option value="USD">Dólares</option>
              </select>
              <input type="number" value={soldFilters.minAmount}
                onChange={(e) => setSoldFilter('minAmount', e.target.value)}
                placeholder="$ Mín" className={`${filterInputClass} w-20`} />
              <input type="number" value={soldFilters.maxAmount}
                onChange={(e) => setSoldFilter('maxAmount', e.target.value)}
                placeholder="$ Máx" className={`${filterInputClass} w-20`} />
              {soldActiveFilters > 0 && (
                <button type="button" onClick={() => setSoldFilters(EMPTY_SOLD_FILTERS)}
                  className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/40 hover:text-white/70 hover:border-white/20 transition whitespace-nowrap">
                  Limpiar ({soldActiveFilters})
                </button>
              )}
            </div>
            {soldActiveFilters > 0 && (
              <p className="text-[10px] text-white/25">
                {filteredSold.length} de {sold.length} ventas
              </p>
            )}
          </div>

          {filteredSold.length === 0 ? (
            <EmptyState message={sold.length === 0 ? 'Aún no hay relojes vendidos.' : 'Sin resultados para los filtros aplicados.'} />
          ) : (
            <TableWrapper>
              {/* 9 columns: Reloj · Comprador · Propiedad · Costo · Precio · Comisión · Neto · Margen · Vendido */}
              <table className="min-w-[1160px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Reloj</th>
                    <th className="px-4 py-3 font-medium">Comprador</th>
                    <th className="px-4 py-3 font-medium">Propiedad</th>
                    <th className="px-4 py-3 font-medium text-right">Costo efectivo</th>
                    <th className="px-4 py-3 font-medium text-right">Precio de venta</th>
                    <th className="px-4 py-3 font-medium text-right">Comisión</th>
                    <th className="px-4 py-3 font-medium text-right">Neto recibido</th>
                    <th className="px-4 py-3 font-medium text-right">Margen</th>
                    <th className="px-4 py-3 font-medium">Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSold.map((item) => {
                    const effectiveCost = Number(item.watch.effectiveCost);
                    const bankFeeNum = Number(item.bankFee ?? 0);
                    const agreedPriceNum = Number(item.agreedPrice);
                    // Corrected margin deducts bank fee; percentage is margin / sale price
                    const margin = agreedPriceNum - effectiveCost - bankFeeNum;
                    const marginPct = agreedPriceNum > 0
                      ? ((margin / agreedPriceNum) * 100).toFixed(1)
                      : '—';
                    const hasUsdMeta =
                      item.originalCurrency === 'USD' &&
                      !!item.originalAmount &&
                      !!item.exchangeRate;
                    return (
                      <tr key={item.dealId} className="border-b border-white/5 hover:bg-white/[0.05] transition duration-150">
                        <td className="px-4 py-3">
                          <div className="font-medium text-white">{item.watch.brand}</div>
                          <div className="text-xs text-muted">{item.watch.model}</div>
                          <div className="font-mono text-xs text-muted/60">{dash(item.watch.serialNumber)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-white">{item.buyer.name}</div>
                          <div className="text-xs text-muted">{dash(item.buyer.email)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted">
                            {item.watch.ownershipType === 'CONSIGNMENT'
                              ? `Consignación${item.watch.consignmentOwnerName ? ` · ${item.watch.consignmentOwnerName}` : ''}`
                              : 'Propio'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted">
                          {formatMoney(item.watch.effectiveCost)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-medium tabular-nums text-white">
                            {formatMoney(item.agreedPrice)}
                          </div>
                          {hasUsdMeta && (
                            <div className="mt-0.5 text-[10px] tabular-nums text-white/30">
                              {formatUsd(item.originalAmount)} @ ${Number(item.exchangeRate).toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {bankFeeNum > 0 ? (
                            <span className="text-amber-400/80">{formatMoney(bankFeeNum)}</span>
                          ) : (
                            <span className="text-muted/50">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-400">
                          {formatMoney(item.netReceived)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {formatMoney(margin)}
                            {marginPct !== '—' ? (
                              <span className="ml-1 text-xs opacity-70">({marginPct}%)</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted">{formatDate(item.soldAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrapper>
          )}
        </>
      ) : null}

      {/* In Stock tab */}
      {!loading && !error && activeTab === 'stock' ? (
        <>
          <div className="flex items-center gap-2">
            <input type="text" value={stockSearch}
              onChange={(e) => setStockSearch(e.target.value)}
              placeholder="Buscar por marca o modelo…"
              className={`${filterInputClass} w-56`} />
            {stockSearch && (
              <button type="button" onClick={() => setStockSearch('')}
                className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/40 hover:text-white/70 transition">
                Limpiar
              </button>
            )}
            {stockSearch.trim() && (
              <span className="text-[10px] text-white/25">
                {filteredStock.length} de {stock.length}
              </span>
            )}
          </div>
          {filteredStock.length === 0 ? (
            <EmptyState message={stock.length === 0 ? 'Actualmente no hay relojes en stock.' : 'Sin resultados.'} />
          ) : (
            <TableWrapper>
              <table className="min-w-[880px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Reloj</th>
                    <th className="px-4 py-3 font-medium">Condición</th>
                    <th className="px-4 py-3 font-medium">Propiedad</th>
                    <th className="px-4 py-3 font-medium text-right">Costo efectivo</th>
                    <th className="px-4 py-3 font-medium text-right">Rango de precio</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Adquirido</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((w) => (
                    <tr key={w.id} className="border-b border-white/5 hover:bg-white/[0.05] transition duration-150">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{w.brand}</div>
                        <div className="text-xs text-muted">{w.model}</div>
                        <div className="font-mono text-xs text-muted/60">{dash(w.serialNumber)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted">{w.condition}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted">
                          {w.ownershipType === 'CONSIGNMENT'
                            ? `Consignación${w.consignmentOwnerName ? ` · ${w.consignmentOwnerName}` : ''}`
                            : 'Propio'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{formatMoney(w.effectiveCost)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                        {w.priceMin === w.priceMax
                          ? formatMoney(w.priceMin)
                          : `${formatMoney(w.priceMin)} – ${formatMoney(w.priceMax)}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[w.status]}`}>
                          {w.status.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
          )}
        </>
      ) : null}

      {/* Acquired tab */}
      {!loading && !error && activeTab === 'acquired' ? (
        <>
          <div className="flex items-center gap-2">
            <input type="text" value={acquiredSearch}
              onChange={(e) => setAcquiredSearch(e.target.value)}
              placeholder="Buscar por marca o modelo…"
              className={`${filterInputClass} w-56`} />
            {acquiredSearch && (
              <button type="button" onClick={() => setAcquiredSearch('')}
                className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/40 hover:text-white/70 transition">
                Limpiar
              </button>
            )}
            {acquiredSearch.trim() && (
              <span className="text-[10px] text-white/25">
                {filteredAcquired.length} de {acquired.length}
              </span>
            )}
          </div>
          {filteredAcquired.length === 0 ? (
            <EmptyState message={acquired.length === 0 ? 'Aún no hay relojes adquiridos.' : 'Sin resultados.'} />
          ) : (
            <TableWrapper>
              <table className="min-w-[880px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-surface/80 text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Reloj</th>
                    <th className="px-4 py-3 font-medium">Condición</th>
                    <th className="px-4 py-3 font-medium">Propiedad</th>
                    <th className="px-4 py-3 font-medium text-right">Costo efectivo</th>
                    <th className="px-4 py-3 font-medium text-right">Rango de precio</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Adquirido</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAcquired.map((w) => (
                    <tr
                      key={w.id}
                      className={`border-b border-white/5 transition duration-150 hover:bg-white/[0.05] ${w.deletedAt ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{w.brand}</div>
                        <div className="text-xs text-muted">{w.model}</div>
                        <div className="font-mono text-xs text-muted/60">{dash(w.serialNumber)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted">{w.condition}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted">
                          {w.ownershipType === 'CONSIGNMENT'
                            ? `Consignación${w.consignmentOwnerName ? ` · ${w.consignmentOwnerName}` : ''}`
                            : 'Propio'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{formatMoney(w.effectiveCost)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-white">
                        {w.priceMin === w.priceMax
                          ? formatMoney(w.priceMin)
                          : `${formatMoney(w.priceMin)} – ${formatMoney(w.priceMax)}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[w.status]}`}>
                          {w.status.replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
          )}
        </>
      ) : null}
    </div>
  );
}

// --- Sub-components ---

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'positive' | 'negative';
}) {
  return (
    <div className="ui-card py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums ${
          highlight === 'positive'
            ? 'text-emerald-400'
            : highlight === 'negative'
              ? 'text-rose-400'
              : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="ui-card overflow-hidden p-0">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-panel/50 px-4 py-12 text-center">
      <p className="text-base font-medium text-white">{message}</p>
      <p className="mt-2 text-sm text-muted">Los datos aparecerán aquí una vez que se registre actividad.</p>
    </div>
  );
}
