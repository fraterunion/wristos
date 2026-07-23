'use client';

import { useEffect, useState } from 'react';

import type { SoldItem } from '@/lib/ventas-api';

type SaleDetailDrawerProps = {
  sale: SoldItem | null;
  open: boolean;
  onClose: () => void;
  onAddPayment: (sale: SoldItem) => void;
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  BANCOS: 'Bancos',
  CESAR: 'César',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

const STATUS_LABELS: Record<string, string> = {
  PAGADO: 'Pagado',
  PARCIAL: 'Parcial',
  PENDIENTE: 'Pendiente',
  HISTORICO: 'Histórica',
  PAID: 'Pagado',
  PENDING: 'Pendiente',
  OVERDUE: 'Vencido',
};

function fmtMxn(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtUsd(value: string | number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `USD ${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n)}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
      {children}
    </h3>
  );
}

function KpiTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
}) {
  const toneCls =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : tone === 'muted'
          ? 'text-white/50'
          : 'text-white';

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/25">{label}</p>
      <p className={`mt-1.5 text-base font-semibold tabular-nums leading-none ${toneCls}`}>{value}</p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-white/[0.05] last:border-0">
      <span className="text-sm text-white/45">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium tabular-nums text-white">{value}</span>
        {sub ? <p className="mt-0.5 text-[11px] text-white/30">{sub}</p> : null}
      </div>
    </div>
  );
}

export function SaleDetailDrawer({ sale, open, onClose, onAddPayment }: SaleDetailDrawerProps) {
  const [showAdvancedPayment, setShowAdvancedPayment] = useState(false);

  useEffect(() => {
    setShowAdvancedPayment(false);
  }, [sale?.dealId, open]);

  if (!open || !sale) return null;

  const status = sale.computedStatus;
  const isHistorical = Boolean(sale.isHistoricalImport) || status === 'HISTORICO';
  const pendingNum = Number(sale.pendingAmount);
  const hasBankFee = !!sale.bankFee && Number(sale.bankFee) > 0;
  const sortedPayments = [...sale.payments].sort((a, b) => {
    const aTime = a.paidAt ? new Date(a.paidAt).getTime() : 0;
    const bTime = b.paidAt ? new Date(b.paidAt).getTime() : 0;
    return aTime - bTime;
  });

  const watchMeta = [sale.watch.serialNumber, sale.watch.reference].filter(Boolean);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar detalle de venta"
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-detail-title"
        className="relative flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-[#0a0a0a] shadow-2xl shadow-black/60"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-white/[0.06] px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                Detalle de venta
              </p>
              <h2 id="sale-detail-title" className="mt-2 text-xl font-semibold text-white leading-tight">
                {sale.watch.brand}
              </h2>
              <p className="mt-0.5 text-sm text-white/55">{sale.watch.model}</p>
              {watchMeta.length > 0 ? (
                <p className="mt-1.5 text-[11px] font-mono uppercase tracking-wide text-white/30">
                  {watchMeta.join(' · ')}
                </p>
              ) : null}
              <p className="mt-3 text-sm text-white/70">{sale.buyer.name}</p>
              <p className="mt-1 text-xs text-white/35">{fmtDate(sale.soldAt)}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 transition hover:border-white/20 hover:text-white"
            >
              Cerrar
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isHistorical ? (
              <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                Venta histórica
              </span>
            ) : null}
            {status === 'PAGADO' ? (
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                Liquidada
              </span>
            ) : isHistorical ? (
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                Histórica
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onAddPayment(sale)}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white transition hover:border-white/25 hover:bg-white/[0.1]"
              >
                Agregar pago
              </button>
            )}
          </div>

          {isHistorical ? (
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[11px] leading-relaxed text-white/40">
                El historial de pagos no se migró con esta importación
                {sale.paymentCount != null ? ` (referencia: ${sale.paymentCount} pago${sale.paymentCount === 1 ? '' : 's'} históricos)` : ''}.
              </p>
              {!showAdvancedPayment ? (
                <button
                  type="button"
                  onClick={() => setShowAdvancedPayment(true)}
                  className="mt-2 text-[11px] text-white/45 underline underline-offset-2 hover:text-white/70"
                >
                  Registrar pago actual (avanzado)
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] text-amber-200/80">
                    Solo usa esto si necesitas registrar un pago real hoy. No reescribe el historial importado.
                  </p>
                  <button
                    type="button"
                    onClick={() => onAddPayment(sale)}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:border-amber-500/45"
                  >
                    Continuar y registrar pago
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">
          {/* KPIs */}
          <section className="mb-6">
            <SectionTitle>Resumen</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <KpiTile label="Total venta" value={fmtMxn(sale.agreedPrice)} />
              <KpiTile label="Pagado" value={fmtMxn(sale.paidTotal)} tone="positive" />
              <KpiTile
                label="Pendiente"
                value={pendingNum > 0 ? fmtMxn(sale.pendingAmount) : '—'}
                tone={pendingNum > 0 ? 'negative' : 'muted'}
              />
              <KpiTile label="Estatus" value={STATUS_LABELS[status] ?? status} />
            </div>
          </section>

          {/* Financial summary */}
          <section className="mb-6 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <SectionTitle>Resumen financiero</SectionTitle>
            <div className="mt-3">
              <SummaryRow
                label="Comisiones bancarias"
                value={hasBankFee ? fmtMxn(sale.bankFee) : '—'}
              />
              <SummaryRow label="Neto recibido" value={fmtMxn(sale.netReceived)} />
              {sale.originalCurrency === 'USD' && sale.originalAmount && sale.exchangeRate ? (
                <>
                  <SummaryRow
                    label="Moneda original"
                    value={fmtUsd(sale.originalAmount) ?? '—'}
                  />
                  <SummaryRow
                    label="Tipo de cambio"
                    value={`$${sale.exchangeRate}`}
                  />
                </>
              ) : null}
            </div>
          </section>

          {/* Payment timeline */}
          <section className="mb-6">
            <SectionTitle>Historial de pagos</SectionTitle>
            {sortedPayments.length === 0 ? (
              <p className="mt-3 text-sm text-white/35">
                {isHistorical ? 'Sin pagos migrados.' : 'Sin pagos registrados.'}
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {sortedPayments.map((payment) => (
                  <li
                    key={payment.id}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-white/35">{fmtDateTime(payment.paidAt)}</p>
                        <p className="mt-1 text-sm font-medium text-white">
                          {METHOD_LABELS[payment.method] ?? payment.method}
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/40">
                          {STATUS_LABELS[payment.status] ?? payment.status}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-white">
                        {fmtMxn(payment.amount)}
                      </p>
                    </div>
                    {payment.notes ? (
                      <p className="mt-2 text-xs leading-relaxed text-white/45">{payment.notes}</p>
                    ) : null}
                    {payment.method === 'BANCOS' ? (
                      <p className="mt-2 text-[11px] text-white/30">Comisión bancaria aplicada</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Deal notes */}
          {sale.notes ? (
            <section>
              <SectionTitle>Notas de la venta</SectionTitle>
              <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-white/60">
                {sale.notes}
              </p>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
