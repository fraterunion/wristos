'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet } from '@/lib/api-client';
import { listRecentSales, type SoldItem } from '@/lib/ventas-api';
import { AddPaymentModal } from '@/components/ventas/AddPaymentModal';
import { RegisterSaleModal } from '@/components/ventas/RegisterSaleModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type HistorySummary = {
  totalSold: number;
  totalRevenue: string;
  totalCostOfSold: string;
  totalBankFees: string;
  totalProfit: string;
};

type ComputedStatus = 'PAGADO' | 'PARCIAL' | 'PENDIENTE';

type SaleFilters = {
  dateFrom: string;
  dateTo: string;
  paymentMethod: string;
  currency: string;
  buyer: string;
  watchSearch: string;
  minAmount: string;
  maxAmount: string;
  status: string;
};

const EMPTY_FILTERS: SaleFilters = {
  dateFrom: '', dateTo: '', paymentMethod: '', currency: '',
  buyer: '', watchSearch: '', minAmount: '', maxAmount: '', status: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMxn(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
  }).format(n);
}

function fmtUsd(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `USD ${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n)}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

const now = new Date();

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, highlight }: {
  label: string; value: string; sub?: string; highlight?: 'positive' | 'negative';
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel px-5 py-4 shadow-sm shadow-black/30">
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">{label}</p>
      <p className={`mt-2.5 text-[22px] font-semibold tabular-nums leading-none ${
        highlight === 'positive' ? 'text-emerald-400' :
        highlight === 'negative' ? 'text-rose-400' : 'text-white'
      }`}>{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-white/20">{sub}</p>}
    </div>
  );
}

const STATUS_CONFIG: Record<ComputedStatus, { label: string; cls: string }> = {
  PAGADO:   { label: 'Pagado',   cls: 'bg-emerald-500/20 text-emerald-300' },
  PARCIAL:  { label: 'Parcial',  cls: 'bg-amber-500/20 text-amber-300' },
  PENDIENTE:{ label: 'Pendiente',cls: 'bg-rose-500/20 text-rose-300' },
};

function StatusBadge({ status }: { status: ComputedStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

const NEUTRAL_METHOD_PILL_CLS = 'border-white/[0.07] bg-white/[0.03] text-white/50';

const METHOD_CONFIG: Record<string, { label: string; cls: string }> = {
  CASH:     { label: 'Efectivo',  cls: NEUTRAL_METHOD_PILL_CLS },
  BANCOS:   { label: 'Bancos',    cls: NEUTRAL_METHOD_PILL_CLS },
  CESAR:    { label: 'César',     cls: NEUTRAL_METHOD_PILL_CLS },
  TRANSFER: { label: 'Transfer',  cls: NEUTRAL_METHOD_PILL_CLS },
  CARD:     { label: 'Tarjeta',   cls: NEUTRAL_METHOD_PILL_CLS },
};

function MethodPill({ method }: { method: string }) {
  const cfg = METHOD_CONFIG[method] ?? { label: method, cls: NEUTRAL_METHOD_PILL_CLS };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-[3px] text-[10px] font-medium tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

const filterInputCls =
  'h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VentasPage() {
  const [sales, setSales] = useState<SoldItem[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [filters, setFilters] = useState<SaleFilters>(EMPTY_FILTERS);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [addPaymentSale, setAddPaymentSale] = useState<SoldItem | null>(null);

  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [salesData, summaryData] = await Promise.all([
        listRecentSales(),
        apiGet<HistorySummary>('/history/summary', { authenticated: true }),
      ]);
      setSales(salesData);
      setSummary(summaryData);
    } catch (err) {
      setDataError(err instanceof ApiError ? err.message : 'No se pudieron cargar los datos.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── KPI derivations ────────────────────────────────────────────────────────

  const salesThisMonth = sales.filter((s) => {
    const d = new Date(s.soldAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const revenueThisMonth = salesThisMonth.reduce((sum, s) => sum + Number(s.agreedPrice), 0);
  const monthLabel = now.toLocaleDateString('es-MX', { month: 'long' }).replace(/^\w/, (c) => c.toUpperCase());

  // ── Filtering ──────────────────────────────────────────────────────────────

  const setFilter = (field: keyof SaleFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [field]: value }));

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v !== '').length,
    [filters],
  );

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const saleDay = sale.soldAt.slice(0, 10);
      if (filters.dateFrom && saleDay < filters.dateFrom) return false;
      if (filters.dateTo && saleDay > filters.dateTo) return false;
      if (filters.status && sale.computedStatus !== filters.status) return false;
      if (filters.paymentMethod && !sale.paymentMethods.includes(filters.paymentMethod)) return false;
      if (filters.currency) {
        if ((sale.originalCurrency ?? 'MXN') !== filters.currency) return false;
      }
      if (filters.buyer.trim()) {
        if (!sale.buyer.name.toLowerCase().includes(filters.buyer.trim().toLowerCase())) return false;
      }
      if (filters.watchSearch.trim()) {
        const q = filters.watchSearch.trim().toLowerCase();
        if (
          !sale.watch.brand.toLowerCase().includes(q) &&
          !sale.watch.model.toLowerCase().includes(q) &&
          !(sale.watch.serialNumber?.toLowerCase().includes(q) ?? false)
        ) return false;
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
  }, [sales, filters]);

  // ── Render ─────────────────────────────────────────────────────────────────

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
          <p className="ui-subtitle">Libro mayor de ventas cerradas, pagos y comisiones.</p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterOpen(true)}
          className="ui-btn-primary shrink-0 px-4 py-2.5 text-sm"
        >
          + Registrar venta
        </button>
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
          value={dataLoading ? '—' : fmtMxn(revenueThisMonth)}
          sub="Precio acordado, mes actual"
        />
        <KpiCard
          label="Total ingresos"
          value={dataLoading || !summary ? '—' : fmtMxn(summary.totalRevenue)}
          sub="Acumulado histórico"
        />
        <KpiCard
          label="Utilidad bruta"
          value={dataLoading || !summary ? '—' : fmtMxn(summary.totalProfit)}
          sub="Ingresos menos costo de ventas"
          highlight={summary ? (Number(summary.totalProfit) >= 0 ? 'positive' : 'negative') : undefined}
        />
      </div>

      {/* Error state */}
      {dataError && (
        <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{dataError}</p>
          <button type="button" onClick={() => void loadData()} className="mt-3 text-sm underline text-rose-200">
            Reintentar
          </button>
        </section>
      )}

      {/* Table card */}
      {!dataError && (
        <div className="rounded-2xl border border-white/[0.07] bg-panel shadow-sm shadow-black/20 overflow-hidden">

          {/* Filter bar */}
          <div className="border-b border-white/[0.05] px-4 py-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={filters.dateFrom}
                onChange={(e) => setFilter('dateFrom', e.target.value)}
                title="Desde" className={`${filterInputCls} w-36`} />
              <input type="date" value={filters.dateTo}
                onChange={(e) => setFilter('dateTo', e.target.value)}
                title="Hasta" className={`${filterInputCls} w-36`} />

              <select value={filters.status}
                onChange={(e) => setFilter('status', e.target.value)}
                className={`${filterInputCls} w-32`}>
                <option value="">Estatus: Todos</option>
                <option value="PAGADO">Pagado</option>
                <option value="PARCIAL">Parcial</option>
                <option value="PENDIENTE">Pendiente</option>
              </select>

              <select value={filters.paymentMethod}
                onChange={(e) => setFilter('paymentMethod', e.target.value)}
                className={`${filterInputCls} w-36`}>
                <option value="">Método: Todos</option>
                <option value="CASH">Efectivo</option>
                <option value="BANCOS">Bancos</option>
                <option value="CESAR">César</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
              </select>

              <select value={filters.currency}
                onChange={(e) => setFilter('currency', e.target.value)}
                className={`${filterInputCls} w-32`}>
                <option value="">Moneda: Todas</option>
                <option value="MXN">Pesos</option>
                <option value="USD">Dólares</option>
              </select>

              <input type="text" value={filters.buyer}
                onChange={(e) => setFilter('buyer', e.target.value)}
                placeholder="Comprador…" className={`${filterInputCls} w-28`} />

              <input type="text" value={filters.watchSearch}
                onChange={(e) => setFilter('watchSearch', e.target.value)}
                placeholder="Reloj, marca…" className={`${filterInputCls} w-28`} />

              <input type="number" value={filters.minAmount}
                onChange={(e) => setFilter('minAmount', e.target.value)}
                placeholder="$ Mín" className={`${filterInputCls} w-20`} />
              <input type="number" value={filters.maxAmount}
                onChange={(e) => setFilter('maxAmount', e.target.value)}
                placeholder="$ Máx" className={`${filterInputCls} w-20`} />

              {activeFilterCount > 0 && (
                <button type="button"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/40 hover:text-white/70 hover:border-white/20 transition whitespace-nowrap">
                  Limpiar ({activeFilterCount})
                </button>
              )}
            </div>
            {activeFilterCount > 0 && !dataLoading && (
              <p className="text-[10px] text-white/25">
                {filteredSales.length} de {sales.length} ventas
              </p>
            )}
          </div>

          {/* Table */}
          {dataLoading ? (
            <div className="space-y-px p-3 animate-pulse">
              {[0,1,2,3,4].map((i) => (
                <div key={i} className="h-[60px] rounded-xl bg-white/[0.03]" />
              ))}
            </div>
          ) : sales.length === 0 ? (
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="w-[86px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Fecha</th>
                    <th className="px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Reloj</th>
                    <th className="w-[120px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 hidden md:table-cell">Comprador</th>
                    <th className="w-[100px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Total</th>
                    <th className="w-[88px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 hidden lg:table-cell">Pagado</th>
                    <th className="w-[88px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 hidden lg:table-cell">Pendiente</th>
                    <th className="w-[86px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Estatus</th>
                    <th className="w-[120px] px-3 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 hidden md:table-cell">Métodos</th>
                    <th className="w-[76px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 hidden xl:table-cell">Comisión</th>
                    <th className="w-[100px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 hidden lg:table-cell">Neto</th>
                    <th className="w-[80px] px-3 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredSales.map((sale) => {
                    const status = sale.computedStatus as ComputedStatus;
                    const hasFee = !!sale.bankFee && Number(sale.bankFee) > 0;
                    const usdSub = sale.originalCurrency === 'USD' && sale.originalAmount && sale.exchangeRate
                      ? fmtUsd(sale.originalAmount)
                      : null;
                    const pendingNum = Number(sale.pendingAmount);

                    return (
                      <tr key={sale.dealId} className="transition-colors duration-150 hover:bg-white/[0.02]">

                        {/* Fecha */}
                        <td className="px-3 py-3.5 align-top pt-4">
                          <span className="text-xs tabular-nums text-white/35 whitespace-nowrap">
                            {fmtDate(sale.soldAt)}
                          </span>
                        </td>

                        {/* Reloj */}
                        <td className="px-3 py-3.5 align-middle overflow-hidden">
                          <p className="text-sm font-semibold text-white leading-tight truncate">{sale.watch.brand}</p>
                          <p className="mt-0.5 text-xs text-white/50 truncate">{sale.watch.model}</p>
                          {sale.watch.serialNumber && (
                            <p className="mt-0.5 text-[10px] font-mono text-white/25 uppercase truncate">
                              {sale.watch.serialNumber}
                            </p>
                          )}
                        </td>

                        {/* Comprador */}
                        <td className="px-3 py-3.5 align-middle hidden md:table-cell overflow-hidden">
                          <p className="text-sm text-white/55 truncate">{sale.buyer.name}</p>
                        </td>

                        {/* Total */}
                        <td className="px-3 py-3.5 text-right align-middle">
                          <span className="text-sm font-bold tabular-nums text-white whitespace-nowrap">
                            {fmtMxn(sale.agreedPrice)}
                          </span>
                          {usdSub && (
                            <p className="mt-0.5 text-[10px] text-white/25 tabular-nums">
                              {usdSub}
                            </p>
                          )}
                        </td>

                        {/* Pagado */}
                        <td className="px-3 py-3.5 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                          <span className="text-sm tabular-nums text-emerald-400">
                            {fmtMxn(sale.paidTotal)}
                          </span>
                        </td>

                        {/* Pendiente */}
                        <td className="px-3 py-3.5 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                          {pendingNum > 0 ? (
                            <span className="text-sm tabular-nums text-rose-400">
                              {fmtMxn(pendingNum)}
                            </span>
                          ) : (
                            <span className="text-xs text-white/20">—</span>
                          )}
                        </td>

                        {/* Estatus */}
                        <td className="px-3 py-3.5 align-middle">
                          <StatusBadge status={status} />
                        </td>

                        {/* Métodos */}
                        <td className="px-3 py-3.5 align-middle hidden md:table-cell">
                          {sale.paymentMethods.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {sale.paymentMethods.map((m) => (
                                <MethodPill key={m} method={m} />
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-white/20">Sin pagos</span>
                          )}
                        </td>

                        {/* Comisión */}
                        <td className="px-3 py-3.5 text-right align-middle whitespace-nowrap hidden xl:table-cell">
                          {hasFee ? (
                            <span className="text-xs tabular-nums text-amber-400/80">
                              {fmtMxn(sale.bankFee)}
                            </span>
                          ) : (
                            <span className="text-xs text-white/20">—</span>
                          )}
                        </td>

                        {/* Neto */}
                        <td className="px-3 py-3.5 text-right align-middle whitespace-nowrap hidden lg:table-cell">
                          <span className="text-sm font-semibold tabular-nums text-emerald-400">
                            {fmtMxn(sale.netReceived)}
                          </span>
                        </td>

                        {/* Acciones */}
                        <td className="px-3 py-3.5 text-right align-middle">
                          <div className="flex items-center justify-end gap-1">
                            {status !== 'PAGADO' && (
                              <button
                                type="button"
                                onClick={() => setAddPaymentSale(sale)}
                                className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-white/60 hover:border-white/20 hover:text-white transition whitespace-nowrap"
                              >
                                + Pago
                              </button>
                            )}
                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <RegisterSaleModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSaved={() => {
          setFlash({ type: 'success', message: 'Venta registrada correctamente.' });
          void loadData();
        }}
      />

      <AddPaymentModal
        sale={addPaymentSale}
        open={!!addPaymentSale}
        onClose={() => setAddPaymentSale(null)}
        onSaved={() => {
          setFlash({ type: 'success', message: 'Pago registrado correctamente.' });
          setAddPaymentSale(null);
          void loadData();
        }}
      />
    </section>
  );
}
