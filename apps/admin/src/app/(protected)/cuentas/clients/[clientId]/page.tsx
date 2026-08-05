'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  getCustomerLedger,
  type AccountEntry,
  type CustomerLedger,
} from '@/lib/cuentas-api';

function fmtMoney(value: string, currency: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : 'MXN',
    maximumFractionDigits: 2,
  }).format(n);
}

function EntryTable({
  title,
  rows,
}: {
  title: string;
  rows: AccountEntry[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/50">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-white/40">Sin movimientos.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-3 py-2">Concepto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Original</th>
                <th className="px-3 py-2">Pagado</th>
                <th className="px-3 py-2">Saldo</th>
                <th className="px-3 py-2">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/5 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-white/90">{row.concept}</div>
                    <div className="text-xs text-white/40">
                      {row.issuedAt?.slice(0, 10) ?? row.createdAt.slice(0, 10)}
                      {row.notes ? ` · ${row.notes}` : ''}
                    </div>
                    {row.payments.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-xs text-white/45">
                        {row.payments.map((p) => (
                          <li key={p.id}>
                            Pago {fmtMoney(p.amount, p.currency)} ·{' '}
                            {p.paidAt.slice(0, 10)}
                            {p.notes ? ` · ${p.notes}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-white/70">{row.status}</td>
                  <td className="px-3 py-2">
                    {fmtMoney(row.totalAmount, row.currency)}
                  </td>
                  <td className="px-3 py-2">
                    {fmtMoney(row.paidTotal, row.currency)}
                  </td>
                  <td className="px-3 py-2 font-medium text-emerald-300/90">
                    {fmtMoney(row.balance, row.currency)}
                  </td>
                  <td className="px-3 py-2 text-white/50">{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function CuentasCustomerLedgerPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;
  const [data, setData] = useState<CustomerLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomerLedger(clientId)
      .then((ledger) => {
        if (!cancelled) setData(ledger);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : 'No se pudo cargar el ledger',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loading) {
    return <div className="ui-page text-sm text-white/50">Cargando ledger…</div>;
  }

  if (error || !data) {
    return (
      <div className="ui-page space-y-3">
        <p className="text-sm text-rose-300">{error ?? 'No encontrado'}</p>
        <Link href="/cuentas" className="text-sm text-emerald-400 hover:underline">
          ← Volver a Cuentas
        </Link>
      </div>
    );
  }

  return (
    <div className="ui-page space-y-6">
      <header className="ui-page-header space-y-2">
        <Link href="/cuentas" className="text-xs text-white/40 hover:text-emerald-400">
          ← Cuentas
        </Link>
        <h1 className="text-xl font-semibold text-white">{data.customer.name}</h1>
        <p className="text-sm text-white/45">
          {[data.customer.email, data.customer.phone].filter(Boolean).join(' · ') ||
            'Ledger de cuentas del cliente'}
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-white/50">
          <span>
            Por cobrar MXN{' '}
            {fmtMoney(data.receivableOutstandingByCurrency.MXN, 'MXN')}
          </span>
          <span>
            Por cobrar USD{' '}
            {fmtMoney(data.receivableOutstandingByCurrency.USD, 'USD')}
          </span>
          <span>
            Por pagar MXN {fmtMoney(data.payableOutstandingByCurrency.MXN, 'MXN')}
          </span>
          <span>
            Por pagar USD {fmtMoney(data.payableOutstandingByCurrency.USD, 'USD')}
          </span>
        </div>
        <Link
          href={`/crm/${data.customer.id}`}
          className="inline-block text-xs text-emerald-400 hover:underline"
        >
          Abrir en CRM →
        </Link>
      </header>

      <EntryTable title="Por cobrar" rows={data.receivables} />
      <EntryTable title="Por pagar" rows={data.payables} />
    </div>
  );
}
