'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  getTreasuryBalances,
  registerTreasuryTransfer,
  reverseTreasuryTransfer,
  type TreasuryAccount,
  type TreasuryBalances,
} from '@/lib/treasury-api';

const ACCOUNT_LABELS: Record<TreasuryAccount, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR: 'Cuenta César',
};

const ACCOUNTS: TreasuryAccount[] = ['CASH', 'BANK', 'CESAR'];

function fmtMxn(value: string | number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

type FormState = {
  sourceAccount: TreasuryAccount | '';
  destinationAccount: TreasuryAccount | '';
  amount: string;
  transferDate: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  sourceAccount: '',
  destinationAccount: '',
  amount: '',
  transferDate: todayIso(),
  notes: '',
};

export default function TreasuryPage() {
  const [balances, setBalances] = useState<TreasuryBalances | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTransferId, setLastTransferId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBalances(await getTreasuryBalances());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar saldos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!form.sourceAccount || !form.destinationAccount) {
      setError('Selecciona cuenta origen y destino');
      return;
    }
    if (form.sourceAccount === form.destinationAccount) {
      setError('Origen y destino deben ser distintas');
      return;
    }
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('El monto debe ser mayor a 0');
      return;
    }

    setSubmitting(true);
    try {
      const result = await registerTreasuryTransfer({
        sourceAccount: form.sourceAccount,
        destinationAccount: form.destinationAccount,
        amount,
        transferDate: form.transferDate
          ? new Date(`${form.transferDate}T12:00:00.000Z`).toISOString()
          : undefined,
        notes: form.notes.trim() || undefined,
      });
      setLastTransferId(result.transferId);
      setSuccess(
        result.replayed
          ? `Transferencia ya registrada (${ACCOUNT_LABELS[result.sourceAccount]} → ${ACCOUNT_LABELS[result.destinationAccount]} ${fmtMxn(result.amount)})`
          : `Transferencia registrada: ${ACCOUNT_LABELS[result.sourceAccount]} → ${ACCOUNT_LABELS[result.destinationAccount]} ${fmtMxn(result.amount)}`,
      );
      setForm({ ...EMPTY_FORM, transferDate: todayIso() });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la transferencia');
    } finally {
      setSubmitting(false);
    }
  }

  async function onReverseLast() {
    if (!lastTransferId) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const result = await reverseTreasuryTransfer(lastTransferId);
      setSuccess(
        result.alreadyReversed
          ? 'La transferencia ya estaba revertida'
          : 'Transferencia revertida (ambos movimientos)',
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo revertir');
    } finally {
      setSubmitting(false);
    }
  }

  const total =
    balances == null
      ? null
      : Number(balances.CASH) + Number(balances.BANK) + Number(balances.CESAR);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">Tesorería</h1>
        <p className="text-sm text-muted">
          Transferencias internas entre Efectivo, Bancos y Cuenta César. La liquidez total no
          cambia. No es gasto ni ingreso.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACCOUNTS.map((account) => (
          <div key={account} className="rounded-lg border border-white/10 bg-panel px-3 py-3">
            <div className="text-xs text-muted">{ACCOUNT_LABELS[account]}</div>
            <div className="mt-1 text-lg font-medium text-white">
              {loading || !balances ? '—' : fmtMxn(balances[account])}
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-3">
          <div className="text-xs text-emerald-400/80">Liquidez total</div>
          <div className="mt-1 text-lg font-medium text-emerald-300">
            {total == null || loading ? '—' : fmtMxn(total)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-panel p-5">
        <h2 className="text-base font-medium text-white">Nueva transferencia</h2>
        <p className="mt-1 text-xs text-muted">
          Un solo registro mueve liquidez de origen a destino. Cuenta César aquí es liquidez
          interna, no una distribución de capital.
        </p>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Desde</span>
              <select
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
                value={form.sourceAccount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    sourceAccount: e.target.value as TreasuryAccount | '',
                  }))
                }
                required
              >
                <option value="">Seleccionar…</option>
                {ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {ACCOUNT_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Hacia</span>
              <select
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
                value={form.destinationAccount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    destinationAccount: e.target.value as TreasuryAccount | '',
                  }))
                }
                required
              >
                <option value="">Seleccionar…</option>
                {ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {ACCOUNT_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Monto (MXN)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Fecha</span>
              <input
                type="date"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
                value={form.transferDate}
                onChange={(e) => setForm((f) => ({ ...f, transferDate: e.target.value }))}
              />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-muted">Nota (opcional)</span>
            <input
              type="text"
              maxLength={2000}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {success ? <p className="text-sm text-emerald-400">{success}</p> : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? 'Registrando…' : 'Registrar transferencia'}
            </button>
            {lastTransferId ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onReverseLast()}
                className="rounded-md border border-white/15 px-4 py-2 text-sm text-muted hover:text-white disabled:opacity-50"
              >
                Revertir última
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
