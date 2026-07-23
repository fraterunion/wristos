'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  addReceivablePayment,
  AGING_BUCKET_LABELS,
  deleteReceivablePayment,
  getReceivable,
  RECEIVABLE_PAYMENT_METHOD_LABELS,
  RECEIVABLE_PAYMENT_METHODS,
  RECEIVABLE_STATUS_LABELS,
  reverseReceivablePayment,
  writeOffReceivable,
  type AddReceivablePaymentPayload,
  type ReceivableCurrency,
  type ReceivableDetail,
  type ReceivablePayment,
  type ReceivablePaymentMethod,
  type ReceivableStatus,
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

function fmtMoney(value: string | number, currency: ReceivableCurrency = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
  }).format(Number(value));
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

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
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

const inputCls =
  'h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/20 transition';

type TimelineEvent = {
  id: string;
  at: string;
  label: string;
  detail?: string;
  tone: 'neutral' | 'positive' | 'negative' | 'warn';
};

function buildTimeline(detail: ReceivableDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (detail.deal?.soldAt) {
    events.push({
      id: 'sale',
      at: detail.deal.soldAt,
      label: 'Venta registrada',
      detail: detail.deal.sourceTag ?? undefined,
      tone: 'neutral',
    });
  }

  events.push({
    id: 'created',
    at: detail.createdAt,
    label: 'Cuenta por cobrar creada',
    detail: `Original ${fmtMxn(detail.normalizedAmount)}`,
    tone: 'neutral',
  });

  for (const payment of detail.payments) {
    if (payment.reversesPaymentId) {
      events.push({
        id: `rev-${payment.id}`,
        at: payment.paymentDate,
        label: 'Pago revertido',
        detail: `${fmtMxn(payment.normalizedAmount)} · ${RECEIVABLE_PAYMENT_METHOD_LABELS[payment.method]}`,
        tone: 'warn',
      });
    } else {
      events.push({
        id: `pay-${payment.id}`,
        at: payment.paymentDate,
        label: 'Pago recibido',
        detail: `${fmtMxn(payment.normalizedAmount)} · ${RECEIVABLE_PAYMENT_METHOD_LABELS[payment.method]}`,
        tone: 'positive',
      });
    }
  }

  if (detail.status === 'PAID') {
    const lastPositive = [...detail.payments]
      .filter((p) => Number(p.normalizedAmount) > 0)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))[0];
    events.push({
      id: 'paid',
      at: lastPositive?.paymentDate ?? detail.updatedAt,
      label: 'Cuenta saldada',
      tone: 'positive',
    });
  }

  if (detail.writtenOffAt) {
    events.push({
      id: 'writeoff',
      at: detail.writtenOffAt,
      label: 'Castigada / dada de baja',
      detail: detail.writtenOffReason ?? undefined,
      tone: 'negative',
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

// ─── Payment modal ────────────────────────────────────────────────────────────

type PaymentForm = {
  amount: string;
  currency: ReceivableCurrency;
  method: ReceivablePaymentMethod;
  paymentDate: string;
  reference: string;
  notes: string;
  allowOverpayment: boolean;
};

function PaymentModal({
  open,
  remaining,
  onClose,
  onSave,
}: {
  open: boolean;
  remaining: string;
  onClose: () => void;
  onSave: (payload: AddReceivablePaymentPayload) => Promise<void>;
}) {
  const [form, setForm] = useState<PaymentForm>({
    amount: '',
    currency: 'MXN',
    method: 'BANK_TRANSFER',
    paymentDate: todayIso(),
    reference: '',
    notes: '',
    allowOverpayment: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      amount: '',
      currency: 'MXN',
      method: 'BANK_TRANSFER',
      paymentDate: todayIso(),
      reference: '',
      notes: '',
      allowOverpayment: false,
    });
    setError(null);
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        amount,
        currency: form.currency,
        method: form.method,
        paymentDate: form.paymentDate,
        reference: form.reference.trim() || undefined,
        notes: form.notes.trim() || undefined,
        allowOverpayment: form.allowOverpayment || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar el pago.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.1] bg-panel p-5 shadow-2xl shadow-black/50"
      >
        <h2 className="text-lg font-semibold text-white">Registrar pago</h2>
        <p className="mt-1 text-xs text-white/35">
          Saldo pendiente: {fmtMxn(remaining)}
        </p>

        <div className="mt-4 grid gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Monto</span>
            <input
              className={inputCls}
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-white/30">Moneda</span>
              <select
                className={inputCls}
                value={form.currency}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    currency: e.target.value as ReceivableCurrency,
                  }))
                }
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-white/30">Método</span>
              <select
                className={inputCls}
                value={form.method}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    method: e.target.value as ReceivablePaymentMethod,
                  }))
                }
              >
                {RECEIVABLE_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {RECEIVABLE_PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Fecha</span>
            <input
              className={inputCls}
              type="date"
              required
              value={form.paymentDate}
              onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Referencia</span>
            <input
              className={inputCls}
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Notas</span>
            <textarea
              className={`${inputCls} h-20 resize-none py-2`}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input
              type="checkbox"
              checked={form.allowOverpayment}
              onChange={(e) =>
                setForm((f) => ({ ...f, allowOverpayment: e.target.checked }))
              }
            />
            Permitir sobrepago
          </label>
        </div>

        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="ui-btn-secondary px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="ui-btn-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Write-off modal ──────────────────────────────────────────────────────────

function WriteOffModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Indica el motivo del castigo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo castigar la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.1] bg-panel p-5 shadow-2xl shadow-black/50"
      >
        <h2 className="text-lg font-semibold text-white">Castigar cuenta</h2>
        <p className="mt-1 text-xs text-white/35">
          Esta acción marca la cuenta como no cobrable. No se puede deshacer.
        </p>
        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-white/30">Motivo</span>
          <textarea
            className={`${inputCls} h-24 resize-none py-2`}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Cliente inubicable, pérdida comercial…"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="ui-btn-secondary px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Confirmar castigo'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceivableDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [detail, setDetail] = useState<ReceivableDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReceivable(id);
      setDetail(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la cuenta.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeline = useMemo(() => (detail ? buildTimeline(detail) : []), [detail]);

  const canPay =
    detail &&
    !detail.writtenOffAt &&
    detail.status !== 'WRITTEN_OFF' &&
    detail.status !== 'PAID' &&
    Number(detail.remaining) > 0;

  const canWriteOff =
    detail && !detail.writtenOffAt && detail.status !== 'WRITTEN_OFF' && detail.status !== 'PAID';

  async function handleAddPayment(payload: AddReceivablePaymentPayload) {
    await addReceivablePayment(id, payload);
    setPaymentOpen(false);
    setActionError(null);
    await load();
  }

  async function handleWriteOff(reason: string) {
    await writeOffReceivable(id, reason);
    setWriteOffOpen(false);
    setActionError(null);
    await load();
  }

  async function handleDeletePayment(payment: ReceivablePayment) {
    const confirmed = window.confirm(
      `¿Eliminar el pago de ${fmtMxn(payment.normalizedAmount)}? Se quitará del saldo.`,
    );
    if (!confirmed) return;
    setBusyPaymentId(payment.id);
    setActionError(null);
    try {
      await deleteReceivablePayment(id, payment.id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'No se pudo eliminar el pago.');
    } finally {
      setBusyPaymentId(null);
    }
  }

  async function handleReversePayment(payment: ReceivablePayment) {
    const confirmed = window.confirm(
      `¿Revertir el pago de ${fmtMxn(payment.normalizedAmount)}? Se creará un asiento inverso.`,
    );
    if (!confirmed) return;
    setBusyPaymentId(payment.id);
    setActionError(null);
    try {
      await reverseReceivablePayment(id, payment.id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'No se pudo revertir el pago.');
    } finally {
      setBusyPaymentId(null);
    }
  }

  if (loading && !detail) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Detalle de cobro</h1>
            <p className="ui-subtitle">Cargando…</p>
          </div>
        </header>
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.08] bg-panel/95 py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Detalle de cobro</h1>
            <p className="ui-subtitle">No se encontró la cuenta.</p>
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
          <p className="text-sm text-rose-300">{error ?? 'Cuenta no encontrada.'}</p>
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

  const reversedIds = new Set(
    detail.payments.filter((p) => p.reversesPaymentId).map((p) => p.reversesPaymentId!),
  );

  return (
    <div className="ui-page">
      <header className="ui-page-header">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
            <Link href="/receivables" className="transition hover:text-white/60">
              Cuentas por cobrar
            </Link>
            {' / '}
            Detalle
          </p>
          <h1 className="ui-title">{detail.customer?.name ?? 'Cliente'}</h1>
          <p className="ui-subtitle">
            Deal {detail.dealId.slice(0, 8)}… · {AGING_BUCKET_LABELS[detail.aging]} ·{' '}
            {detail.ageDays} días
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/receivables/customers/${detail.customerId}`}
            className="ui-btn-secondary px-4 py-2 text-sm"
          >
            Ledger del cliente
          </Link>
          {canPay ? (
            <button
              type="button"
              className="ui-btn-primary px-4 py-2 text-sm"
              onClick={() => setPaymentOpen(true)}
            >
              Registrar pago
            </button>
          ) : null}
          {canWriteOff ? (
            <button
              type="button"
              className="rounded-lg border border-rose-500/30 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10"
              onClick={() => setWriteOffOpen(true)}
            >
              Castigar
            </button>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-sm text-rose-200">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-4 shrink-0 text-sm text-rose-300 transition hover:text-white"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <article className="ui-card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                Resumen
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusPillClass(detail.status)}`}
                >
                  {RECEIVABLE_STATUS_LABELS[detail.status]}
                </span>
                <span className="text-xs text-white/35">{detail.currency}</span>
                {detail.sourceTag ? (
                  <span className="text-xs text-white/35">{detail.sourceTag}</span>
                ) : null}
              </div>
            </div>
            {detail.customer?.email || detail.customer?.phone ? (
              <div className="text-right text-xs text-white/40">
                {detail.customer.email ? <p>{detail.customer.email}</p> : null}
                {detail.customer.phone ? <p>{detail.customer.phone}</p> : null}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/30">Original</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-white">
                {fmtMxn(detail.normalizedAmount)}
              </p>
              {detail.currency !== 'MXN' ? (
                <p className="text-[11px] text-white/30">
                  Orig. {fmtMoney(detail.originalAmount, detail.currency)}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/30">Cobrado</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-400">
                {fmtMxn(detail.collected)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/30">Saldo</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-amber-300">
                {fmtMxn(detail.remaining)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/30">Fechas</p>
              <p className="mt-1 text-sm text-white/70">Emisión {fmtDate(detail.issueDate)}</p>
              <p className="text-sm text-white/45">Vence {fmtDate(detail.dueDate)}</p>
            </div>
          </div>

          {detail.notes || detail.writtenOffReason ? (
            <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4">
              {detail.notes ? (
                <p className="text-sm text-white/50">
                  <span className="text-white/30">Notas: </span>
                  {detail.notes}
                </p>
              ) : null}
              {detail.writtenOffReason ? (
                <p className="text-sm text-rose-300/80">
                  <span className="text-rose-300/40">Motivo castigo: </span>
                  {detail.writtenOffReason}
                </p>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="ui-card p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
            Línea de tiempo
          </p>
          <ol className="mt-4 space-y-3">
            {timeline.map((ev) => (
              <li key={ev.id} className="flex gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    ev.tone === 'positive'
                      ? 'bg-emerald-400'
                      : ev.tone === 'negative'
                        ? 'bg-rose-400'
                        : ev.tone === 'warn'
                          ? 'bg-amber-400'
                          : 'bg-white/30'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm text-white/80">{ev.label}</p>
                  {ev.detail ? (
                    <p className="text-[11px] text-white/35">{ev.detail}</p>
                  ) : null}
                  <p className="text-[11px] text-white/25">{fmtDateTime(ev.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </div>

      <section className="rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
            Historial de pagos
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.14em] text-white/35">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-3 py-3 font-medium">Método</th>
                <th className="px-3 py-3 font-medium text-right">Monto</th>
                <th className="px-3 py-3 font-medium text-right">MXN</th>
                <th className="px-3 py-3 font-medium">Referencia</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {detail.payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-white/35">
                    Aún no hay pagos registrados.
                  </td>
                </tr>
              ) : (
                detail.payments.map((payment) => {
                  const isReversal = Boolean(payment.reversesPaymentId);
                  const wasReversed = reversedIds.has(payment.id);
                  const canAct = !isReversal && !wasReversed;
                  return (
                    <tr
                      key={payment.id}
                      className="border-b border-white/[0.04] text-white/70"
                    >
                      <td className="px-4 py-3">{fmtDate(payment.paymentDate)}</td>
                      <td className="px-3 py-3">
                        {RECEIVABLE_PAYMENT_METHOD_LABELS[payment.method]}
                        {isReversal ? (
                          <span className="ml-2 text-[10px] uppercase text-amber-300/70">
                            Reversión
                          </span>
                        ) : null}
                        {wasReversed ? (
                          <span className="ml-2 text-[10px] uppercase text-white/30">
                            Revertido
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {fmtMoney(payment.amount, payment.currency)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {fmtMxn(payment.normalizedAmount)}
                      </td>
                      <td className="px-3 py-3 text-white/40">
                        {payment.reference ?? payment.notes ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canAct ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              disabled={busyPaymentId === payment.id}
                              className="text-xs text-white/40 transition hover:text-amber-300 disabled:opacity-40"
                              onClick={() => void handleReversePayment(payment)}
                            >
                              Revertir
                            </button>
                            <button
                              type="button"
                              disabled={busyPaymentId === payment.id}
                              className="text-xs text-white/40 transition hover:text-rose-300 disabled:opacity-40"
                              onClick={() => void handleDeletePayment(payment)}
                            >
                              Eliminar
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-white/20">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PaymentModal
        open={paymentOpen}
        remaining={detail.remaining}
        onClose={() => setPaymentOpen(false)}
        onSave={handleAddPayment}
      />
      <WriteOffModal
        open={writeOffOpen}
        onClose={() => setWriteOffOpen(false)}
        onConfirm={handleWriteOff}
      />
    </div>
  );
}
