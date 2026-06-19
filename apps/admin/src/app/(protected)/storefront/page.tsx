'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api-client';
import {
  convertStorefrontReservation,
  listStorefrontReservations,
  type StorefrontReservation,
  type StorefrontReservationStatus,
} from '@/lib/storefront-api';

// ─── Labels & helpers ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<StorefrontReservationStatus, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagado',
  CANCELLED: 'Cancelado',
  PROCESSED: 'Procesado',
};

function statusPillClass(status: StorefrontReservationStatus) {
  switch (status) {
    case 'PAID':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'PENDING':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'CANCELLED':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    case 'PROCESSED':
      return 'border-white/10 bg-white/[0.04] text-white/50';
  }
}

function fmtMoney(value: string | number, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dash(value: string | null | undefined) {
  if (!value?.trim()) return '—';
  return value;
}

function watchLabel(watch: StorefrontReservation['watch']) {
  return `${watch.brand} ${watch.model}`;
}

type ReservationFilters = {
  search: string;
  status: '' | StorefrontReservationStatus;
};

const EMPTY_FILTERS: ReservationFilters = {
  search: '',
  status: '',
};

function filterReservations(
  reservations: StorefrontReservation[],
  filters: ReservationFilters,
) {
  const search = filters.search.trim().toLowerCase();

  return reservations.filter((reservation) => {
    if (filters.status && reservation.status !== filters.status) return false;

    if (search) {
      const haystack = [
        reservation.customerName,
        reservation.customerEmail,
        reservation.customerPhone,
        reservation.watch.brand,
        reservation.watch.model,
        reservation.watch.reference,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

function computeKpis(reservations: StorefrontReservation[]) {
  const activeCount = reservations.filter(
    (r) => r.status === 'PENDING' || r.status === 'PAID',
  ).length;

  const paidTotal = reservations
    .filter((r) => r.status === 'PAID')
    .reduce((sum, r) => sum + Number(r.reservationAmount), 0);

  const pendingProcessCount = reservations.filter((r) => r.status === 'PAID').length;

  const cancelledCount = reservations.filter((r) => r.status === 'CANCELLED').length;

  return { activeCount, paidTotal, pendingProcessCount, cancelledCount };
}

// ─── KPI strip ────────────────────────────────────────────────────────────────

function KpiStrip({
  activeCount,
  paidTotal,
  pendingProcessCount,
  cancelledCount,
}: ReturnType<typeof computeKpis>) {
  const cells = [
    {
      label: 'Apartados activos',
      value: String(activeCount),
      tone: 'text-white',
      sub: 'Pendiente + pagado',
    },
    {
      label: 'Apartados pagados',
      value: fmtMoney(paidTotal),
      tone: 'text-emerald-400',
      sub: 'Suma de montos PAID',
    },
    {
      label: 'Pendientes de procesar',
      value: String(pendingProcessCount),
      tone: 'text-amber-400',
      sub: 'Pagados sin convertir',
    },
    {
      label: 'Cancelados',
      value: String(cancelledCount),
      tone: 'text-rose-400',
      sub: 'Sesiones expiradas',
    },
  ];

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
      <div className="border-b border-white/[0.06] px-5 py-3 md:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
          Resumen tienda
        </p>
      </div>
      <div className="grid grid-cols-2 divide-y divide-white/[0.06] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        {cells.map((cell) => (
          <div key={cell.label} className="px-4 py-4 md:px-5 md:py-5">
            <p className="text-[10px] font-medium uppercase leading-snug tracking-[0.14em] text-white/40">
              {cell.label}
            </p>
            <p className={`mt-2 text-lg font-semibold tabular-nums md:text-2xl ${cell.tone}`}>
              {cell.value}
            </p>
            <p className="mt-1 text-[11px] text-white/35">{cell.sub}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

// ─── Convert modal ────────────────────────────────────────────────────────────

function ConvertConfirmModal({
  reservation,
  open,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  reservation: StorefrontReservation | null;
  open: boolean;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || !reservation) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !loading && onCancel()}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-panel p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Convertir a venta</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Se creará un deal para{' '}
          <span className="text-white">{reservation.customerName}</span> con el reloj{' '}
          <span className="text-white">{watchLabel(reservation.watch)}</span>. El apartado de{' '}
          {fmtMoney(reservation.reservationAmount, reservation.currency)} se registrará como pago
          inicial.
        </p>
        {error ? (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="ui-btn-ghost px-4 py-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="ui-btn-primary px-5 py-2"
          >
            {loading ? 'Convirtiendo…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function ReservationDrawer({
  reservation,
  converting,
  onClose,
  onRequestConvert,
}: {
  reservation: StorefrontReservation | null;
  converting: boolean;
  onClose: () => void;
  onRequestConvert: () => void;
}) {
  useEffect(() => {
    if (!reservation) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [reservation, onClose]);

  if (!reservation) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar panel"
        className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/[0.07] bg-[#0f0f0f] shadow-2xl sm:max-w-md">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">
              {reservation.customerName}
            </p>
            <p className="mt-0.5 truncate text-sm text-white/40">{watchLabel(reservation.watch)}</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="ml-3 shrink-0 rounded-lg p-1.5 text-white/50 transition hover:bg-white/8 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain pb-6">
          <div className="border-b border-white/[0.06] px-5 py-3">
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${statusPillClass(reservation.status)}`}
            >
              {STATUS_LABELS[reservation.status]}
            </span>
          </div>

          <section className="border-b border-white/[0.06] px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Cliente
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-white">{reservation.customerName}</p>
              <p className="text-white/55">{reservation.customerEmail}</p>
              <p className="text-white/55">{dash(reservation.customerPhone)}</p>
              {reservation.client ? (
                <Link
                  href={`/crm/${reservation.client.id}`}
                  className="inline-flex text-xs font-medium text-emerald-400 underline-offset-4 transition hover:text-white hover:underline"
                >
                  Cliente CRM: {reservation.client.name} →
                </Link>
              ) : (
                <p className="text-xs text-white/35">Sin cliente CRM vinculado aún.</p>
              )}
            </div>
          </section>

          <section className="border-b border-white/[0.06] px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Reloj
            </p>
            <div className="mt-3 space-y-2 text-sm">
              <p className="font-medium text-white">{watchLabel(reservation.watch)}</p>
              {reservation.watch.reference ? (
                <p className="font-mono text-xs text-white/45">
                  Ref. {reservation.watch.reference}
                </p>
              ) : null}
              <p className="text-white/55">Estado inventario: {reservation.watch.status}</p>
              {reservation.watch.publicSlug ? (
                <p className="font-mono text-xs text-white/40">/{reservation.watch.publicSlug}</p>
              ) : null}
              <Link
                href="/inventory"
                className="inline-flex text-xs font-medium text-emerald-400 underline-offset-4 transition hover:text-white hover:underline"
              >
                Ver inventario →
              </Link>
            </div>
          </section>

          <section className="border-b border-white/[0.06] px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Pago / Stripe
            </p>
            <div className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Apartado</span>
                <span className="font-semibold tabular-nums text-emerald-300">
                  {fmtMoney(reservation.reservationAmount, reservation.currency)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Moneda</span>
                <span className="uppercase text-white/70">{reservation.currency}</span>
              </div>
              <div>
                <p className="text-white/45">Checkout session</p>
                <p className="mt-1 break-all font-mono text-[11px] text-white/35">
                  {reservation.stripeCheckoutSessionId}
                </p>
              </div>
              {reservation.stripePaymentIntentId ? (
                <div>
                  <p className="text-white/45">Payment intent</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-white/35">
                    {reservation.stripePaymentIntentId}
                  </p>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Creado</span>
                <span className="text-white/70">{fmtDateTime(reservation.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-white/45">Reserva hasta</span>
                <span className="text-white/70">
                  {fmtDateTime(reservation.reservationExpiresAt)}
                </span>
              </div>
            </div>
          </section>

          <section className="px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Acciones
            </p>
            {reservation.dealId ? (
              <Link
                href="/deals"
                className="ui-btn-secondary mt-3 inline-flex w-full justify-center px-4 py-2.5 text-sm"
              >
                Ver ventas →
              </Link>
            ) : (
              <button
                type="button"
                disabled={reservation.status !== 'PAID' || converting}
                title={
                  reservation.status === 'PAID'
                    ? 'Crear deal y registrar el apartado como pago inicial'
                    : reservation.status === 'PROCESSED'
                      ? 'Este apartado ya fue convertido'
                      : 'Solo apartados pagados pueden convertirse a venta.'
                }
                onClick={onRequestConvert}
                className="ui-btn-primary mt-3 w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                {converting ? 'Convirtiendo…' : 'Convertir a venta'}
              </button>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StorefrontPage() {
  const [reservations, setReservations] = useState<StorefrontReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReservationFilters>(EMPTY_FILTERS);
  const [drawerReservation, setDrawerReservation] = useState<StorefrontReservation | null>(
    null,
  );
  const [convertTarget, setConvertTarget] = useState<StorefrontReservation | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listStorefrontReservations();
      setReservations(data);
      return data;
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'No se pudieron cargar los apartados.',
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!drawerReservation) return;
    const fresh = reservations.find((r) => r.id === drawerReservation.id);
    if (fresh && fresh.updatedAt !== drawerReservation.updatedAt) {
      setDrawerReservation(fresh);
    }
  }, [reservations, drawerReservation]);

  const handleConvert = async () => {
    if (!convertTarget) return;
    setConverting(true);
    setConvertError(null);
    try {
      const result = await convertStorefrontReservation(convertTarget.id);
      setConvertTarget(null);
      setDrawerReservation(result.reservation);
      setReservations((prev) =>
        prev.map((r) => (r.id === result.reservation.id ? result.reservation : r)),
      );
      setFlash({
        type: 'success',
        message: 'Apartado convertido a venta correctamente.',
      });
    } catch (caught) {
      setConvertError(
        caught instanceof ApiError
          ? caught.message
          : 'No se pudo convertir este apartado.',
      );
    } finally {
      setConverting(false);
    }
  };

  const filteredReservations = useMemo(
    () => filterReservations(reservations, filters),
    [reservations, filters],
  );

  const kpis = useMemo(() => computeKpis(reservations), [reservations]);

  const activeFilters = filters.search.trim() !== '' || filters.status !== '';

  useEffect(() => {
    if (!drawerReservation) return;
    const stillVisible = filteredReservations.some((r) => r.id === drawerReservation.id);
    if (!stillVisible) setDrawerReservation(null);
  }, [drawerReservation, filteredReservations]);

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Tienda</h1>
          <p className="ui-subtitle max-w-2xl">
            Apartados y solicitudes generadas desde el storefront.
          </p>
        </div>
      </header>

      <KpiStrip {...kpis} />

      {flash ? (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            flash.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          {flash.message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5">
          <p className="text-sm text-rose-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadReservations()}
            className="ui-btn-danger mt-3 px-4 py-2 text-sm"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
        <div className="border-b border-white/[0.06] px-4 py-4 md:px-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
              Filtros
            </span>
            {activeFilters ? (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="ui-btn-ghost px-2 py-1 text-xs"
              >
                Restablecer
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Buscar cliente, email, teléfono o reloj…"
              className="ui-input sm:col-span-2"
            />
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  status: e.target.value as ReservationFilters['status'],
                }))
              }
              className="ui-input"
            >
              <option value="">Todos</option>
              {(Object.keys(STATUS_LABELS) as StorefrontReservationStatus[]).map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 px-5 py-8 animate-pulse md:px-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-white/5" />
            ))}
          </div>
        ) : filteredReservations.length === 0 ? (
          <div className="px-5 py-12 md:px-6">
            <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/15 px-4 py-10 text-center">
              <p className="text-sm text-white/55">
                {reservations.length === 0
                  ? 'Aún no hay apartados desde el storefront.'
                  : 'No encontramos apartados con esos filtros.'}
              </p>
              {activeFilters ? (
                <button
                  type="button"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="ui-btn-ghost mt-4 px-3 py-1.5 text-xs"
                >
                  Restablecer filtros
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-black/20 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Teléfono</th>
                  <th className="px-4 py-3 font-semibold">Reloj</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">
                    Apartado
                  </th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredReservations.map((reservation) => (
                  <tr
                    key={reservation.id}
                    className="group cursor-pointer transition hover:bg-white/[0.03]"
                    onClick={() => setDrawerReservation(reservation)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-white/55">
                      {fmtDate(reservation.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">
                      {reservation.client ? (
                        <Link
                          href={`/crm/${reservation.client.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-white/80 underline-offset-4 transition hover:text-white hover:underline"
                        >
                          {reservation.customerName}
                        </Link>
                      ) : (
                        reservation.customerName
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/55">{reservation.customerEmail}</td>
                    <td className="px-4 py-3 text-white/55">
                      {dash(reservation.customerPhone)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{watchLabel(reservation.watch)}</div>
                      {reservation.watch.reference ? (
                        <div className="font-mono text-xs text-white/35">
                          {reservation.watch.reference}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-white">
                      {fmtMoney(reservation.reservationAmount, reservation.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusPillClass(reservation.status)}`}
                      >
                        {STATUS_LABELS[reservation.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerReservation(reservation);
                        }}
                        className="text-xs font-medium text-emerald-400 hover:underline"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ReservationDrawer
        reservation={drawerReservation}
        converting={converting}
        onClose={() => setDrawerReservation(null)}
        onRequestConvert={() => {
          if (drawerReservation) {
            setConvertError(null);
            setConvertTarget(drawerReservation);
          }
        }}
      />

      <ConvertConfirmModal
        reservation={convertTarget}
        open={Boolean(convertTarget)}
        loading={converting}
        error={convertError}
        onCancel={() => {
          if (!converting) {
            setConvertTarget(null);
            setConvertError(null);
          }
        }}
        onConfirm={() => void handleConvert()}
      />
    </div>
  );
}
