'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  createAccountEntry,
  createAccountPayment,
  deleteAccountEntry,
  getCuentasSummary,
  listAccountEntries,
  updateAccountEntry,
  updateAccountPayment,
  type AccountEntry,
  type AccountEntryCategory,
  type AccountEntrySource,
  type AccountEntryStatus,
  type AccountEntryType,
  type AccountPayment,
  type CounterpartyType,
  type Currency,
  type CuentasSummary,
} from '@/lib/cuentas-api';
import type { PaymentMethod } from '@/types/domain';

// ─── Constants & labels ───────────────────────────────────────────────────────

const STATUS_LABELS: Record<AccountEntryStatus, string> = {
  OPEN: 'Abierta',
  PARTIAL: 'Parcial',
  PAID: 'Pagada',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada',
};

const CATEGORY_LABELS: Record<AccountEntryCategory, string> = {
  SALE_BALANCE: 'Saldo de venta',
  PURCHASE: 'Compra',
  SERVICE: 'Servicio',
  COMMISSION: 'Comisión',
  REFUND: 'Reembolso',
  LOAN: 'Préstamo',
  OTHER: 'Otro',
};

const COUNTERPARTY_LABELS: Record<CounterpartyType, string> = {
  CLIENT: 'Cliente',
  SUPPLIER: 'Proveedor',
  DEALER: 'Distribuidor',
  BROKER: 'Broker',
  WORKSHOP: 'Taller',
  LOGISTICS: 'Logística',
  OTHER: 'Otro',
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
  BANCOS: 'Bancos',
  CESAR: 'César',
};

const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = [
  'TRANSFER',
  'CASH',
  'CARD',
  'BANCOS',
  'CESAR',
  'OTHER',
];

const CATEGORY_OPTIONS: AccountEntryCategory[] = [
  'SALE_BALANCE',
  'PURCHASE',
  'SERVICE',
  'COMMISSION',
  'REFUND',
  'LOAN',
  'OTHER',
];

const COUNTERPARTY_OPTIONS: CounterpartyType[] = [
  'CLIENT',
  'SUPPLIER',
  'DEALER',
  'BROKER',
  'WORKSHOP',
  'LOGISTICS',
  'OTHER',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(value: string | number, currency: Currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function fmtSummaryAmount(value: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function isoToDateInput(iso: string | null) {
  return iso ? iso.split('T')[0] : '';
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function isDealLinked(entry: AccountEntry) {
  return entry.source === 'DEAL_AUTO' || entry.dealId !== null;
}

function isManualEntry(entry: AccountEntry) {
  return entry.source === 'MANUAL' && entry.dealId === null;
}

function statusPillClass(status: AccountEntryStatus) {
  switch (status) {
    case 'PARTIAL':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'PAID':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'OVERDUE':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
    case 'CANCELLED':
      return 'border-white/10 bg-white/[0.04] text-white/40';
    default:
      return 'border-white/15 bg-white/[0.05] text-white/60';
  }
}

function sourcePillClass(source: AccountEntrySource) {
  return source === 'DEAL_AUTO'
    ? 'border-sky-500/25 bg-sky-500/10 text-sky-300'
    : 'border-white/15 bg-white/[0.05] text-white/60';
}

function sourceLabel(source: AccountEntrySource) {
  return source === 'DEAL_AUTO' ? 'Venta' : 'Manual';
}

function amountToneClass(value: string, positive: 'emerald' | 'amber' | 'rose' | 'muted') {
  const n = Number(value);
  if (positive === 'muted') return n === 0 ? 'text-white/50' : 'text-white';
  if (n === 0) return 'text-white/50';
  if (positive === 'emerald') return 'text-emerald-400';
  if (positive === 'amber') return 'text-amber-400';
  return 'text-rose-400';
}

function netFlowTone(value: number) {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-rose-400';
  return 'text-white/50';
}

// ─── PillBtn ──────────────────────────────────────────────────────────────────

function PillBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
        active
          ? 'border-white/35 bg-white/10 text-white'
          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
      }`}
    >
      {children}
    </button>
  );
}

// ─── SummaryStrip ─────────────────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: CuentasSummary }) {
  const netFlow = Number(summary.totalReceivable) - Number(summary.totalPayable);

  const cells = [
    {
      label: 'Por cobrar total',
      value: fmtSummaryAmount(summary.totalReceivable),
      tone: amountToneClass(summary.totalReceivable, 'emerald'),
      sub: undefined,
    },
    {
      label: 'Por pagar total',
      value: fmtSummaryAmount(summary.totalPayable),
      tone: amountToneClass(summary.totalPayable, 'amber'),
      sub: undefined,
    },
    {
      label: 'Vencido por cobrar',
      value: fmtSummaryAmount(summary.overdueReceivableAmount),
      tone: amountToneClass(summary.overdueReceivableAmount, 'rose'),
      sub: `${summary.overdueReceivableCount} cuenta${summary.overdueReceivableCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Vencido por pagar',
      value: fmtSummaryAmount(summary.overduePayableAmount),
      tone: amountToneClass(summary.overduePayableAmount, 'rose'),
      sub: `${summary.overduePayableCount} cuenta${summary.overduePayableCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Flujo neto esperado',
      value: fmtSummaryAmount(String(netFlow)),
      tone: netFlowTone(netFlow),
      sub: undefined,
    },
  ];

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
      <div className="border-b border-white/[0.06] px-5 py-3 md:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
          Posición operativa
        </p>
      </div>
      <div className="grid grid-cols-2 divide-y divide-white/[0.06] sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0">
        {cells.map((cell) => (
          <div key={cell.label} className="px-4 py-4 md:px-5 md:py-5">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              {cell.label}
            </p>
            <p className={`mt-2 text-xl font-semibold tabular-nums md:text-2xl ${cell.tone}`}>
              {cell.value}
            </p>
            {cell.sub ? (
              <p className="mt-1 text-[11px] text-white/35">{cell.sub}</p>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

// ─── EntryModal ───────────────────────────────────────────────────────────────

type EntryForm = {
  type: AccountEntryType;
  category: AccountEntryCategory;
  counterpartyType: CounterpartyType;
  counterpartyName: string;
  concept: string;
  totalAmount: string;
  currency: Currency;
  exchangeRate: string;
  reference: string;
  issuedAt: string;
  dueDate: string;
  notes: string;
};

const EMPTY_ENTRY_FORM = (type: AccountEntryType): EntryForm => ({
  type,
  category: 'OTHER',
  counterpartyType: 'OTHER',
  counterpartyName: '',
  concept: '',
  totalAmount: '',
  currency: 'MXN',
  exchangeRate: '',
  reference: '',
  issuedAt: '',
  dueDate: '',
  notes: '',
});

function EntryModal({
  open,
  editing,
  defaultType,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: AccountEntry | null;
  defaultType: AccountEntryType;
  onClose: () => void;
  onSave: (form: EntryForm) => Promise<void>;
}) {
  const [form, setForm] = useState<EntryForm>(EMPTY_ENTRY_FORM(defaultType));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dealLinked = editing ? isDealLinked(editing) : false;

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_ENTRY_FORM(defaultType));
      setError(null);
      return;
    }
    if (editing) {
      setForm({
        type: editing.type,
        category: editing.category,
        counterpartyType: editing.counterpartyType,
        counterpartyName: editing.counterpartyName,
        concept: editing.concept,
        totalAmount: editing.totalAmount,
        currency: editing.currency,
        exchangeRate: editing.exchangeRate ?? '',
        reference: editing.reference ?? '',
        issuedAt: isoToDateInput(editing.issuedAt),
        dueDate: isoToDateInput(editing.dueDate),
        notes: editing.notes ?? '',
      });
    } else {
      setForm(EMPTY_ENTRY_FORM(defaultType));
    }
  }, [open, editing, defaultType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.counterpartyName.trim()) {
      setError('La contraparte es obligatoria.');
      return;
    }
    if (!form.concept.trim()) {
      setError('El concepto es obligatorio.');
      return;
    }
    const amount = Number(form.totalAmount);
    if (!dealLinked && (!form.totalAmount || !Number.isFinite(amount) || amount <= 0)) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const isEdit = editing !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {isEdit ? 'Editar cuenta' : 'Nueva cuenta'}
            </h2>
            {!isEdit && (
              <p className="mt-0.5 text-xs text-white/40">
                Registra un cobro o pago operativo manual.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/8 hover:text-white"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}
          {dealLinked && (
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              Esta cuenta está ligada a una venta.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-field-label">Tipo</label>
              <select
                className="ui-input mt-1.5 w-full"
                value={form.type}
                disabled={isEdit}
                onChange={(e) => setForm({ ...form, type: e.target.value as AccountEntryType })}
              >
                <option value="RECEIVABLE">Por cobrar</option>
                <option value="PAYABLE">Por pagar</option>
              </select>
            </div>
            <div>
              <label className="ui-field-label">Categoría</label>
              <select
                className="ui-input mt-1.5 w-full"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as AccountEntryCategory })
                }
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-field-label">Tipo de contraparte</label>
              <select
                className="ui-input mt-1.5 w-full"
                value={form.counterpartyType}
                onChange={(e) =>
                  setForm({ ...form, counterpartyType: e.target.value as CounterpartyType })
                }
              >
                {COUNTERPARTY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {COUNTERPARTY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-field-label">Contraparte</label>
              <input
                className="ui-input mt-1.5 w-full"
                value={form.counterpartyName}
                onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })}
                placeholder="Nombre"
              />
            </div>
          </div>
          <div>
            <label className="ui-field-label">Concepto</label>
            <input
              className="ui-input mt-1.5 w-full"
              value={form.concept}
              onChange={(e) => setForm({ ...form, concept: e.target.value })}
              placeholder="Descripción del movimiento"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-field-label">Monto total</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="ui-input mt-1.5 w-full"
                value={form.totalAmount}
                disabled={dealLinked}
                onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
              />
            </div>
            <div>
              <label className="ui-field-label">Moneda</label>
              <select
                className="ui-input mt-1.5 w-full"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div>
            <label className="ui-field-label">Tipo de cambio (opcional)</label>
            <input
              type="number"
              step="0.000001"
              min="0"
              className="ui-input mt-1.5 w-full"
              value={form.exchangeRate}
              onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
              placeholder="Solo si aplica"
            />
          </div>
          <div>
            <label className="ui-field-label">Referencia (opcional)</label>
            <input
              className="ui-input mt-1.5 w-full"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="ui-field-label">Fecha de emisión (opcional)</label>
              <input
                type="date"
                className="ui-input mt-1.5 w-full"
                value={form.issuedAt}
                onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
              />
            </div>
            <div>
              <label className="ui-field-label">Fecha de vencimiento (opcional)</label>
              <input
                type="date"
                className="ui-input mt-1.5 w-full"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              className="ui-input mt-1.5 w-full resize-none"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button type="button" className="ui-btn-ghost px-4 py-2" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="ui-btn-primary px-4 py-2" disabled={saving}>
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

type PaymentForm = {
  amount: string;
  method: PaymentMethod | '';
  paidAt: string;
  notes: string;
};

const EMPTY_PAYMENT_FORM: PaymentForm = {
  amount: '',
  method: '',
  paidAt: todayIso(),
  notes: '',
};

function PaymentModal({
  open,
  editing,
  entry,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: AccountPayment | null;
  entry: AccountEntry | null;
  onClose: () => void;
  onSave: (form: PaymentForm) => Promise<void>;
}) {
  const [form, setForm] = useState<PaymentForm>(EMPTY_PAYMENT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PAYMENT_FORM);
      setError(null);
      return;
    }
    if (editing) {
      setForm({
        amount: editing.amount,
        method: editing.method as PaymentMethod,
        paidAt: isoToDateInput(editing.paidAt),
        notes: editing.notes ?? '',
      });
    } else {
      setForm(EMPTY_PAYMENT_FORM);
    }
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    if (!form.method) {
      setError('Selecciona un método de pago.');
      return;
    }
    if (!form.paidAt) {
      setError('Selecciona una fecha.');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  if (!open || !entry) return null;

  const isEdit = editing !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {isEdit ? 'Editar pago' : 'Registrar pago'}
            </h2>
            <p className="mt-0.5 text-xs text-white/40">
              Moneda: {entry.currency} · Pendiente: {fmtMoney(entry.balance, entry.currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/8 hover:text-white"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}
          <div>
            <label className="ui-field-label">Monto</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="ui-input mt-1.5 w-full"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-field-label">Método</label>
            <select
              className="ui-input mt-1.5 w-full"
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
            >
              <option value="">Seleccionar…</option>
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-field-label">Fecha de pago</label>
            <input
              type="date"
              className="ui-input mt-1.5 w-full"
              value={form.paidAt}
              onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              className="ui-input mt-1.5 w-full resize-none"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button type="button" className="ui-btn-ghost px-4 py-2" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="ui-btn-primary px-4 py-2" disabled={saving}>
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── EntryDrawer ──────────────────────────────────────────────────────────────

function EntryDrawer({
  entry,
  onClose,
  onEdit,
  onPayment,
  onDelete,
}: {
  entry: AccountEntry | null;
  onClose: () => void;
  onEdit: () => void;
  onPayment: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    if (!entry) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const dealLinked = isDealLinked(entry);
  const manual = isManualEntry(entry);
  const payments = [...(entry.payments ?? [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const metrics = [
    { label: 'Monto total', value: fmtMoney(entry.totalAmount, entry.currency) },
    { label: 'Pagado', value: fmtMoney(entry.paidTotal, entry.currency) },
    {
      label: 'Pendiente',
      value: fmtMoney(entry.balance, entry.currency),
      tone:
        Number(entry.balance) > 0 && entry.status === 'OVERDUE'
          ? 'rose'
          : Number(entry.balance) > 0
            ? 'amber'
            : 'neutral',
    },
    { label: 'Vence', value: fmtDate(entry.dueDate) },
  ];

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
            <p className="truncate text-base font-semibold text-white">{entry.counterpartyName}</p>
            <p className="mt-0.5 truncate text-sm text-white/40">{entry.concept}</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/8 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-6">
          <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-5 py-3">
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${statusPillClass(entry.status)}`}
            >
              {STATUS_LABELS[entry.status]}
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${sourcePillClass(entry.source)}`}
            >
              {sourceLabel(entry.source)}
            </span>
            <span className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs text-white/50">
              {CATEGORY_LABELS[entry.category]}
            </span>
          </div>

          <div className="divide-y divide-white/[0.06] border-b border-white/[0.06]">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm text-white/45">{metric.label}</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    metric.tone === 'rose'
                      ? 'text-rose-400'
                      : metric.tone === 'amber'
                        ? 'text-amber-400'
                        : 'text-white'
                  }`}
                >
                  {metric.value}
                </span>
              </div>
            ))}
          </div>

          {entry.notes ? (
            <section className="border-b border-white/[0.06] px-5 py-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
                Notas
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{entry.notes}</p>
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-2 border-b border-white/[0.06] px-5 py-4 sm:grid-cols-3">
            <button type="button" onClick={onEdit} className="ui-btn-secondary px-3 py-2 text-sm">
              Editar
            </button>
            {manual ? (
              <button type="button" onClick={onPayment} className="ui-btn-primary px-3 py-2 text-sm">
                Registrar pago
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="ui-btn-primary px-3 py-2 text-sm opacity-40"
                title="Esta cuenta se liquida desde Ventas"
              >
                Registrar pago
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="ui-btn-ghost px-3 py-2 text-sm text-rose-300 hover:text-rose-200"
            >
              Eliminar
            </button>
          </div>

          <section className="px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Pagos
            </p>
            {dealLinked ? (
              <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-4 text-center">
                <p className="text-xs leading-relaxed text-sky-200/70">
                  Esta cuenta se liquida desde Ventas.
                </p>
              </div>
            ) : payments.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-white/[0.08] bg-black/15 px-4 py-5 text-center">
                <p className="text-xs leading-relaxed text-white/30">
                  Aún no hay pagos registrados para esta cuenta.
                </p>
              </div>
            ) : (
              <ul className="mt-3 space-y-0 divide-y divide-white/[0.04]">
                {payments.map((payment) => (
                  <li key={payment.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs tabular-nums text-white/35">{fmtDate(payment.paidAt)}</p>
                        <p className="mt-1 text-xs text-white/40">
                          {PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] ?? payment.method}
                        </p>
                        {payment.notes ? (
                          <p className="mt-1 truncate text-sm text-white/40">{payment.notes}</p>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300">
                        {fmtMoney(payment.amount, payment.currency as Currency)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CuentasPage() {
  const [tab, setTab] = useState<AccountEntryType>('RECEIVABLE');
  const [summary, setSummary] = useState<CuentasSummary | null>(null);
  const [entries, setEntries] = useState<AccountEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerEntry, setDrawerEntry] = useState<AccountEntry | null>(null);
  const [entryModal, setEntryModal] = useState<{ open: boolean; editing: AccountEntry | null }>({
    open: false,
    editing: null,
  });
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    entry: AccountEntry | null;
    editing: AccountPayment | null;
  }>({ open: false, entry: null, editing: null });
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async (type: AccountEntryType) => {
    setLoading(true);
    setError(null);
    try {
      const [sum, list] = await Promise.all([
        getCuentasSummary(),
        listAccountEntries({ type }),
      ]);
      setSummary(sum);
      setEntries(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las cuentas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(tab);
  }, [tab, loadData]);

  async function handleSaveEntry(form: EntryForm) {
    const payload = {
      type: form.type,
      category: form.category,
      counterpartyType: form.counterpartyType,
      counterpartyName: form.counterpartyName.trim(),
      concept: form.concept.trim(),
      totalAmount: Number(form.totalAmount),
      currency: form.currency,
      exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : undefined,
      reference: form.reference.trim() || undefined,
      issuedAt: form.issuedAt || undefined,
      dueDate: form.dueDate || undefined,
      notes: form.notes.trim() || undefined,
    };

    if (entryModal.editing) {
      const { type: _type, totalAmount, ...updatePayload } = payload;
      const editing = entryModal.editing;
      if (isDealLinked(editing)) {
        await updateAccountEntry(editing.id, updatePayload);
      } else {
        await updateAccountEntry(editing.id, payload);
      }
    } else {
      await createAccountEntry(payload);
    }

    const editingId = entryModal.editing?.id;
    setEntryModal({ open: false, editing: null });
    setActionError(null);

    const [sum, list] = await Promise.all([
      getCuentasSummary(),
      listAccountEntries({ type: tab }),
    ]);
    setSummary(sum);
    setEntries(list);
    if (editingId) {
      const refreshed = list.find((e) => e.id === editingId);
      setDrawerEntry(refreshed ?? null);
    }
  }

  async function handleSavePayment(form: PaymentForm) {
    const entry = paymentModal.entry;
    if (!entry) return;

    const body = {
      amount: Number(form.amount),
      method: form.method as PaymentMethod,
      paidAt: form.paidAt,
      notes: form.notes.trim() || undefined,
    };

    if (paymentModal.editing) {
      await updateAccountPayment(entry.id, paymentModal.editing.id, body);
    } else {
      await createAccountPayment(entry.id, body);
    }

    const entryId = entry.id;
    setPaymentModal({ open: false, entry: null, editing: null });
    setActionError(null);

    const [sum, list] = await Promise.all([
      getCuentasSummary(),
      listAccountEntries({ type: tab }),
    ]);
    setSummary(sum);
    setEntries(list);
    const refreshed = list.find((e) => e.id === entryId);
    setDrawerEntry(refreshed ?? null);
  }

  async function handleDeleteEntry(entry: AccountEntry) {
    const confirmed = window.confirm(
      `¿Eliminar la cuenta de ${entry.counterpartyName}? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    try {
      await deleteAccountEntry(entry.id);
      setDrawerEntry(null);
      setActionError(null);
      await loadData(tab);
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 400
          ? 'No se puede eliminar una cuenta ya pagada.'
          : e instanceof ApiError
            ? e.message
            : 'No se pudo eliminar la cuenta.';
      setActionError(message);
    }
  }

  if (loading && !summary) {
    return (
      <div className="ui-page">
        <div className="flex items-center justify-center py-32">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Cuentas</h1>
            <p className="ui-subtitle">Control de cobros y pagos operativos.</p>
          </div>
        </header>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-5 py-10 text-center">
          <p className="text-sm text-rose-300">{error}</p>
          <button
            type="button"
            onClick={() => void loadData(tab)}
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
          <h1 className="ui-title">Cuentas</h1>
          <p className="ui-subtitle">Control de cobros y pagos operativos.</p>
        </div>
        <button
          type="button"
          className="ui-btn-primary px-4 py-2"
          onClick={() => setEntryModal({ open: true, editing: null })}
        >
          Nueva cuenta
        </button>
      </header>

      {summary ? <SummaryStrip summary={summary} /> : null}

      {actionError ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {actionError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <PillBtn active={tab === 'RECEIVABLE'} onClick={() => setTab('RECEIVABLE')}>
          Por cobrar
        </PillBtn>
        <PillBtn active={tab === 'PAYABLE'} onClick={() => setTab('PAYABLE')}>
          Por pagar
        </PillBtn>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-white/40">
              {tab === 'RECEIVABLE'
                ? 'Aún no hay cuentas por cobrar registradas.'
                : 'Aún no hay cuentas por pagar registradas.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  <th className="px-4 py-3 font-semibold">Contraparte</th>
                  <th className="px-4 py-3 font-semibold">Concepto</th>
                  <th className="px-4 py-3 font-semibold text-right">Monto</th>
                  <th className="px-4 py-3 font-semibold text-right">Pagado</th>
                  <th className="px-4 py-3 font-semibold text-right">Pendiente</th>
                  <th className="px-4 py-3 font-semibold">Vence</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Fuente</th>
                  <th className="px-4 py-3 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="cursor-pointer transition hover:bg-white/[0.03]"
                    onClick={() => setDrawerEntry(entry)}
                  >
                    <td className="px-4 py-3.5 font-medium text-white">{entry.counterpartyName}</td>
                    <td className="max-w-[200px] truncate px-4 py-3.5 text-white/60">
                      {entry.concept}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white">
                      {fmtMoney(entry.totalAmount, entry.currency)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white/60">
                      {fmtMoney(entry.paidTotal, entry.currency)}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-right tabular-nums ${
                        entry.status === 'OVERDUE' && Number(entry.balance) > 0
                          ? 'text-rose-400'
                          : Number(entry.balance) > 0
                            ? 'text-amber-400'
                            : 'text-white/50'
                      }`}
                    >
                      {fmtMoney(entry.balance, entry.currency)}
                    </td>
                    <td className="px-4 py-3.5 text-white/50">{fmtDate(entry.dueDate)}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusPillClass(entry.status)}`}
                      >
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${sourcePillClass(entry.source)}`}
                      >
                        {sourceLabel(entry.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/50 transition hover:border-white/20 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerEntry(entry);
                        }}
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
      </div>

      <EntryDrawer
        entry={drawerEntry}
        onClose={() => setDrawerEntry(null)}
        onEdit={() => {
          if (drawerEntry) setEntryModal({ open: true, editing: drawerEntry });
        }}
        onPayment={() => {
          if (drawerEntry && isManualEntry(drawerEntry)) {
            setPaymentModal({ open: true, entry: drawerEntry, editing: null });
          }
        }}
        onDelete={() => {
          if (drawerEntry) void handleDeleteEntry(drawerEntry);
        }}
      />

      <EntryModal
        open={entryModal.open}
        editing={entryModal.editing}
        defaultType={tab}
        onClose={() => setEntryModal({ open: false, editing: null })}
        onSave={handleSaveEntry}
      />

      <PaymentModal
        open={paymentModal.open}
        editing={paymentModal.editing}
        entry={paymentModal.entry}
        onClose={() => setPaymentModal({ open: false, entry: null, editing: null })}
        onSave={handleSavePayment}
      />
    </div>
  );
}
