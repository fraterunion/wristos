'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  getCustomerLedger,
  RECEIVABLE_STATUS_LABELS,
  type CustomerLedger,
  type ReceivableStatus,
} from '@/lib/receivables-api';

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

export default function CustomerLedgerPage() {
  const params = useParams<{ customerId: string }>();
  const router = useRouter();
  const customerId = params.customerId;

  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomerLedger(customerId);
      setLedger(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el ledger.');
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !ledger) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Ledger del cliente</h1>
            <p className="ui-subtitle">Cargando…</p>
          </div>
        </header>
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.08] bg-panel/95 py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
        </div>
      </div>
    );
  }

  if (error || !ledger) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Ledger del cliente</h1>
            <p className="ui-subtitle">No se encontró el cliente.</p>
          </div>
          <button
            type="button"
            className="ui-btn-secondary px-4 py-2"
            onClick={() => router.push('/receivables')}
          >
            Volver
          </button>
        </header>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-5 py-10 text-center">
          <p className="text-sm text-rose-300">{error ?? 'Cliente no encontrado.'}</p>
          <button
            type="button"
            onClick={() => void load()}
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
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
            <Link href="/receivables" className="transition hover:text-white/60">
              Cuentas por cobrar
            </Link>
            {' / '}
            Ledger
          </p>
          <h1 className="ui-title">{ledger.customer.name}</h1>
          <p className="ui-subtitle">
            {[ledger.customer.email, ledger.customer.phone].filter(Boolean).join(' · ') ||
              'Historial de cobros del cliente'}
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.07] bg-panel px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
            Pendiente
          </p>
          <p className="mt-2.5 text-[22px] font-semibold tabular-nums text-amber-300">
            {fmtMxn(ledger.outstanding)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-panel px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
            Cobrado histórico
          </p>
          <p className="mt-2.5 text-[22px] font-semibold tabular-nums text-emerald-400">
            {fmtMxn(ledger.lifetimeCollected)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-panel px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
            Días promedio pago
          </p>
          <p className="mt-2.5 text-[22px] font-semibold tabular-nums text-white">
            {ledger.averagePaymentDays == null ? '—' : `${ledger.averagePaymentDays}d`}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
            Cuentas del cliente
          </p>
          <p className="mt-1 text-xs text-white/30">
            {ledger.receivables.length} cuenta{ledger.receivables.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.14em] text-white/35">
                <th className="px-4 py-3 font-medium">Emisión</th>
                <th className="px-3 py-3 font-medium">Deal</th>
                <th className="px-3 py-3 font-medium text-right">Original</th>
                <th className="px-3 py-3 font-medium text-right">Cobrado</th>
                <th className="px-3 py-3 font-medium text-right">Saldo</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="px-3 py-3 font-medium text-right">Pagos</th>
                <th className="px-4 py-3 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {ledger.receivables.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-white/35">
                    Este cliente no tiene cuentas por cobrar.
                  </td>
                </tr>
              ) : (
                ledger.receivables.map((row) => (
                  <tr key={row.id} className="border-b border-white/[0.04]">
                    <td className="px-4 py-3 text-white/60">{fmtDate(row.issueDate)}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-white/40">
                      {row.dealId.slice(0, 8)}…
                      {row.deal?.sourceTag ? (
                        <span className="ml-2 font-sans text-white/30">{row.deal.sourceTag}</span>
                      ) : null}
                    </td>
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
                    <td className="px-3 py-3 text-right tabular-nums text-white/40">
                      {row.payments.length}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/receivables/${row.id}`}
                        className="text-xs text-white/45 transition hover:text-white"
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
