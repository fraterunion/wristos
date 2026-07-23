'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  AGING_BUCKET_LABELS,
  AGING_BUCKETS,
  getReceivablesDashboard,
  listReceivables,
  RECEIVABLE_STATUS_LABELS,
  RECEIVABLE_STATUSES,
  type AgingBucket,
  type ReceivableCurrency,
  type ReceivableListItem,
  type ReceivableSort,
  type ReceivableStatus,
  type ReceivablesDashboard,
} from '@/lib/receivables-api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMxn(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function statusPillClass(status: ReceivableStatus) {
  switch (status) {
    case 'PARTIALLY_PAID':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'PAID':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'OVERDUE':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    case 'WRITTEN_OFF':
      return 'border-white/10 bg-white/[0.04] text-white/40';
    default:
      return 'border-white/15 bg-white/[0.05] text-white/60';
  }
}

const filterInputCls =
  'h-8 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition';

type ListFilters = {
  search: string;
  status: '' | ReceivableStatus;
  currency: '' | ReceivableCurrency;
  aging: '' | AgingBucket;
  sort: ReceivableSort;
};

const EMPTY_FILTERS: ListFilters = {
  search: '',
  status: '',
  currency: '',
  aging: '',
  sort: 'issueDate_desc',
};

// ─── Subcomponents ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'positive' | 'negative' | 'warn';
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel px-5 py-4 shadow-sm shadow-black/30">
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
        {label}
      </p>
      <p
        className={`mt-2.5 text-[22px] font-semibold tabular-nums leading-none ${
          highlight === 'positive'
            ? 'text-emerald-400'
            : highlight === 'negative'
              ? 'text-rose-400'
              : highlight === 'warn'
                ? 'text-amber-400'
                : 'text-white'
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11px] text-white/20">{sub}</p> : null}
    </div>
  );
}

function AgingBar({ aging }: { aging: ReceivablesDashboard['aging'] }) {
  const entries = AGING_BUCKETS.map((key) => ({
    key,
    label: AGING_BUCKET_LABELS[key],
    value: Number(aging[key]),
  }));
  const total = entries.reduce((sum, e) => sum + e.value, 0) || 1;
  const tones = [
    'bg-emerald-500/70',
    'bg-sky-500/60',
    'bg-amber-500/60',
    'bg-orange-500/60',
    'bg-rose-500/70',
  ];

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-panel/95 p-5 shadow-lg shadow-black/30">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
        Antigüedad
      </p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/[0.04]">
        {entries.map((e, i) =>
          e.value > 0 ? (
            <div
              key={e.key}
              className={tones[i]}
              style={{ width: `${(e.value / total) * 100}%` }}
              title={`${e.label}: ${fmtMxn(e.value)}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {entries.map((e, i) => (
          <div key={e.key}>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${tones[i]}`} />
              <p className="text-[10px] uppercase tracking-wide text-white/35">{e.label}</p>
            </div>
            <p className="mt-1 text-sm font-semibold tabular-nums text-white/80">
              {fmtMxn(e.value)}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceivablesPage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<ReceivablesDashboard | null>(null);
  const [items, setItems] = useState<ReceivableListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ListFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    const data = await getReceivablesDashboard();
    setDashboard(data);
  }, []);

  const loadList = useCallback(
    async (nextFilters: ListFilters, nextPage: number) => {
      setListLoading(true);
      try {
        const res = await listReceivables({
          search: nextFilters.search.trim() || undefined,
          status: nextFilters.status || undefined,
          currency: nextFilters.currency || undefined,
          aging: nextFilters.aging || undefined,
          sort: nextFilters.sort,
          page: nextPage,
          limit: 25,
        });
        setItems(res.data);
        setPage(res.page);
        setTotalPages(res.totalPages);
        setTotal(res.total);
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadDashboard(), loadList(applied, 1)]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudieron cargar las cuentas por cobrar.',
      );
    } finally {
      setLoading(false);
    }
  }, [applied, loadDashboard, loadList]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    setApplied(filters);
    setError(null);
    try {
      await loadList(filters, 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo filtrar la lista.');
    }
  }

  async function goToPage(nextPage: number) {
    setError(null);
    try {
      await loadList(applied, nextPage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar de página.');
    }
  }

  if (loading && !dashboard) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Cuentas por cobrar</h1>
            <p className="ui-subtitle">Cobranza y saldos pendientes de clientes.</p>
          </div>
        </header>
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.08] bg-panel/95 py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
        </div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Cuentas por cobrar</h1>
            <p className="ui-subtitle">Cobranza y saldos pendientes de clientes.</p>
          </div>
        </header>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-5 py-10 text-center">
          <p className="text-sm text-rose-300">{error}</p>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="mt-4 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:border-white/20 hover:text-white"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Cuentas por cobrar</h1>
          <p className="ui-subtitle">Cobranza y saldos pendientes de clientes.</p>
        </div>
      </header>

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-sm text-rose-200">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-4 shrink-0 text-sm text-rose-300 transition hover:text-white"
          >
            ✕
          </button>
        </div>
      ) : null}

      {dashboard ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <KpiCard label="AR total" value={fmtMxn(dashboard.totalAR)} />
            <KpiCard
              label="Cobrado mes"
              value={fmtMxn(dashboard.collectedThisMonth)}
              highlight="positive"
            />
            <KpiCard
              label="Pendiente"
              value={fmtMxn(dashboard.outstanding)}
              highlight="warn"
            />
            <KpiCard
              label="Vencido"
              value={fmtMxn(dashboard.overdue)}
              highlight="negative"
            />
            <KpiCard label="Al corriente" value={fmtMxn(dashboard.current)} />
            <KpiCard
              label="Días promedio"
              value={String(dashboard.averageDaysOutstanding)}
              sub="Días outstanding"
            />
            <KpiCard
              label="Tasa cobro"
              value={`${dashboard.collectionRate}%`}
              highlight="positive"
            />
          </div>

          <AgingBar aging={dashboard.aging} />

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-white/[0.08] bg-panel/95 p-5 shadow-lg shadow-black/30">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
                Mayores saldos
              </p>
              {dashboard.largestOutstandingCustomers.length === 0 ? (
                <p className="mt-4 text-sm text-white/35">Sin saldos pendientes.</p>
              ) : (
                <ul className="mt-3 divide-y divide-white/[0.06]">
                  {dashboard.largestOutstandingCustomers.map((c) => (
                    <li key={c.customerId} className="flex items-center justify-between py-2.5">
                      <Link
                        href={`/receivables/customers/${c.customerId}`}
                        className="text-sm text-white/80 transition hover:text-white"
                      >
                        {c.customerName}
                      </Link>
                      <span className="text-sm font-semibold tabular-nums text-amber-300">
                        {fmtMxn(c.outstanding)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="rounded-2xl border border-white/[0.08] bg-panel/95 p-5 shadow-lg shadow-black/30">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
                Próximos vencimientos
              </p>
              {dashboard.upcomingDue.length === 0 ? (
                <p className="mt-4 text-sm text-white/35">Nada por vencer en 14 días.</p>
              ) : (
                <ul className="mt-3 divide-y divide-white/[0.06]">
                  {dashboard.upcomingDue.slice(0, 8).map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/receivables/${u.id}`}
                          className="block truncate text-sm text-white/80 transition hover:text-white"
                        >
                          {u.customerName}
                        </Link>
                        <p className="text-[11px] text-white/30">{fmtDate(u.dueDate)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-white/70">
                        {fmtMxn(u.remaining)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </>
      ) : null}

      <section className="rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
              Lista de cobros
            </p>
            <p className="mt-1 text-xs text-white/30">
              {total} cuenta{total === 1 ? '' : 's'}
              {listLoading ? ' · Actualizando…' : ''}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => void applyFilters(e)}
          className="flex flex-wrap items-end gap-2 border-b border-white/[0.06] px-5 py-3"
        >
          <label className="flex min-w-[160px] flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Buscar</span>
            <input
              className={filterInputCls}
              placeholder="Cliente, deal, notas…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Estado</span>
            <select
              className={filterInputCls}
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  status: e.target.value as '' | ReceivableStatus,
                }))
              }
            >
              <option value="">Todos</option>
              {RECEIVABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RECEIVABLE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Moneda</span>
            <select
              className={filterInputCls}
              value={filters.currency}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  currency: e.target.value as '' | ReceivableCurrency,
                }))
              }
            >
              <option value="">Todas</option>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Antigüedad</span>
            <select
              className={filterInputCls}
              value={filters.aging}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  aging: e.target.value as '' | AgingBucket,
                }))
              }
            >
              <option value="">Todas</option>
              {AGING_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {AGING_BUCKET_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Orden</span>
            <select
              className={filterInputCls}
              value={filters.sort}
              onChange={(e) =>
                setFilters((f) => ({ ...f, sort: e.target.value as ReceivableSort }))
              }
            >
              <option value="issueDate_desc">Emisión ↓</option>
              <option value="issueDate_asc">Emisión ↑</option>
              <option value="dueDate_asc">Vencimiento ↑</option>
              <option value="dueDate_desc">Vencimiento ↓</option>
              <option value="remaining_desc">Saldo ↓</option>
              <option value="remaining_asc">Saldo ↑</option>
              <option value="amount_desc">Monto ↓</option>
              <option value="amount_asc">Monto ↑</option>
            </select>
          </label>
          <button type="submit" className="ui-btn-secondary h-8 px-3 text-xs">
            Filtrar
          </button>
          <button
            type="button"
            className="h-8 rounded-lg border border-white/10 px-3 text-xs text-white/45 transition hover:border-white/20 hover:text-white/70"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              void loadList(EMPTY_FILTERS, 1).catch((err) => {
                setError(
                  err instanceof ApiError ? err.message : 'No se pudo limpiar el filtro.',
                );
              });
            }}
          >
            Limpiar
          </button>
        </form>

        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.14em] text-white/35">
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-3 py-3 font-medium">Deal</th>
                <th className="px-3 py-3 font-medium">Emisión</th>
                <th className="px-3 py-3 font-medium">Vence</th>
                <th className="px-3 py-3 font-medium text-right">Original</th>
                <th className="px-3 py-3 font-medium text-right">Cobrado</th>
                <th className="px-3 py-3 font-medium text-right">Saldo</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="px-3 py-3 font-medium text-right">Edad</th>
                <th className="px-4 py-3 font-medium">Moneda</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-sm text-white/35">
                    No hay cuentas por cobrar con estos filtros.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-white/[0.04] transition hover:bg-white/[0.03]"
                    onClick={() => router.push(`/receivables/${row.id}`)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-white/85">
                        {row.customer?.name ?? '—'}
                      </p>
                      {row.sourceTag ? (
                        <p className="text-[11px] text-white/30">{row.sourceTag}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-white/45">
                      {row.dealId.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-3 text-white/55">{fmtDate(row.issueDate)}</td>
                    <td className="px-3 py-3 text-white/55">{fmtDate(row.dueDate)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/70">
                      {fmtMxn(row.normalizedAmount)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-400/80">
                      {fmtMxn(row.collected)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-amber-300">
                      {fmtMxn(row.remaining)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusPillClass(row.status)}`}
                      >
                        {RECEIVABLE_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-white/45">
                      {row.ageDays}d
                    </td>
                    <td className="px-4 py-3 text-white/45">{row.currency}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3">
            <p className="text-xs text-white/30">
              Página {page} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || listLoading}
                className="ui-btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void goToPage(page - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages || listLoading}
                className="ui-btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void goToPage(page + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
