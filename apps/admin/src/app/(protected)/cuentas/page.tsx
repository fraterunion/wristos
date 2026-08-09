'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  createAccountEntry,
  createAccountPayment,
  deleteAccountEntry,
  getCuentasSummary,
  getTopDebtors,
  listAccountEntries,
  listClients,
  updateAccountEntry,
  updateAccountPayment,
  type AccountEntry,
  type AccountEntryCategory,
  type AccountEntrySource,
  type AccountEntryStatus,
  type AccountEntryType,
  type AccountPayment,
  type AccountPaymentDestination,
  type CounterpartyType,
  type Currency,
  type CuentasSummary,
  type TopDebtor,
  type TreasuryAccount,
} from '@/lib/cuentas-api';
import { getFxUsdMxn } from '@/lib/fx-api';
import type { Client, PaymentMethod } from '@/types/domain';

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
  SETTLEMENT: 'Compensación',
};

const PAYMENT_DESTINATION_OPTIONS: { value: AccountPaymentDestination; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'BANK', label: 'Bancos' },
  { value: 'CESAR', label: 'Cuenta César' },
  { value: 'APPLY_TO_PAYABLE', label: 'Aplicar a cuenta por pagar' },
];

const TREASURY_ACCOUNT_LABELS: Record<TreasuryAccount, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR: 'Cuenta César',
};

function treasuryAccountToPaymentMethod(account: TreasuryAccount): PaymentMethod {
  switch (account) {
    case 'CASH':
      return 'CASH';
    case 'BANK':
      return 'BANCOS';
    case 'CESAR':
      return 'CESAR';
  }
}

function paymentSourceLabel(payment: AccountPayment, entryType: AccountEntryType): string {
  if (payment.settlement || payment.method === 'SETTLEMENT') {
    if (entryType === 'RECEIVABLE' || payment.settlement?.role === 'RECEIVABLE_SIDE') {
      return 'Aplicado a cuenta por pagar';
    }
    return 'Pago recibido por compensación';
  }
  if (payment.cashAccount) {
    return TREASURY_ACCOUNT_LABELS[payment.cashAccount];
  }
  return PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] ?? payment.method;
}

function settlementShortId(id: string): string {
  return id.slice(0, 8);
}

function StatusChip({ status }: { status: AccountEntryStatus }) {
  const tone =
    status === 'OVERDUE'
      ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
      : status === 'PARTIAL'
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
        : status === 'OPEN'
          ? 'border-sky-400/30 bg-sky-500/10 text-sky-100'
          : 'border-white/15 bg-white/5 text-white/60';
  return (
    <span
      className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${tone}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function InfoIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-4a1 1 0 100 2 1 1 0 000-2zm1 4a1 1 0 10-2 0v4a1 1 0 102 0V10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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

function fmtEntryMoney(value: string | number, currency: Currency = 'MXN') {
  const amount = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
  return `$${amount} ${currency}`;
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

/** MANUAL + PURCHASE_AUTO CXP/CXC cash payment (not deal-linked). */
function canCashPayEntry(entry: AccountEntry) {
  return (
    !isDealLinked(entry) &&
    (entry.source === 'MANUAL' || entry.source === 'PURCHASE_AUTO') &&
    entry.status !== 'PAID' &&
    Number(entry.balance) > 0
  );
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
  if (source === 'DEAL_AUTO') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  }
  if (source === 'PURCHASE_AUTO') {
    return 'border-sky-500/25 bg-sky-500/10 text-sky-300';
  }
  return 'border-white/15 bg-white/[0.05] text-white/60';
}

function sourceLabel(source: AccountEntrySource) {
  if (source === 'DEAL_AUTO') return 'Venta';
  if (source === 'PURCHASE_AUTO') return 'Compra';
  return 'Manual';
}

type EntryFilters = {
  search: string;
  currency: '' | Currency;
  status: '' | AccountEntryStatus;
  source: '' | AccountEntrySource;
  minBalance: string;
  maxBalance: string;
};

const EMPTY_ENTRY_FILTERS: EntryFilters = {
  search: '',
  currency: '',
  status: '',
  source: '',
  minBalance: '',
  maxBalance: '',
};

function hasActiveEntryFilters(filters: EntryFilters) {
  return Boolean(
    filters.search.trim() ||
      filters.currency ||
      filters.status ||
      filters.source ||
      filters.minBalance.trim() ||
      filters.maxBalance.trim(),
  );
}

function filterAccountEntries(entries: AccountEntry[], filters: EntryFilters) {
  const search = filters.search.trim().toLowerCase();
  const minBalance = filters.minBalance.trim() ? Number(filters.minBalance) : null;
  const maxBalance = filters.maxBalance.trim() ? Number(filters.maxBalance) : null;

  return entries.filter((entry) => {
    if (search) {
      const matchesSearch =
        entry.counterpartyName.toLowerCase().includes(search) ||
        entry.concept.toLowerCase().includes(search) ||
        (entry.reference ?? '').toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }
    if (filters.currency && entry.currency !== filters.currency) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (filters.source && entry.source !== filters.source) return false;
    const balance = Number(entry.balance);
    if (minBalance !== null && Number.isFinite(minBalance) && balance < minBalance) return false;
    if (maxBalance !== null && Number.isFinite(maxBalance) && balance > maxBalance) return false;
    return true;
  });
}

function buildClientOptions(clients: Client[]) {
  return clients
    .map((client) => ({
      value: client.id,
      label: client.name,
      subLabel: [client.email, client.phone].filter(Boolean).join(' · ') || null,
      searchText: [client.name, client.email, client.phone].filter(Boolean).join(' '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
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
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
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

function currencyBreakdownLines(totals: { MXN: string; USD: string }) {
  return [
    `MXN: ${fmtEntryMoney(totals.MXN, 'MXN')}`,
    `USD: ${fmtEntryMoney(totals.USD, 'USD')}`,
  ];
}

function SummaryStrip({ summary }: { summary: CuentasSummary }) {
  const netFlow = Number(summary.expectedNetFlow ?? Number(summary.totalReceivable) - Number(summary.totalPayable));
  const rx = summary.receivableStatusCounts;
  const px = summary.payableStatusCounts;

  const cells = [
    {
      label: 'Por cobrar total',
      value: fmtSummaryAmount(summary.totalReceivable),
      tone: amountToneClass(summary.totalReceivable, 'emerald'),
      subLines: [
        ...currencyBreakdownLines(summary.totalReceivableByCurrency),
        ...(rx
          ? [
              `Abiertas ${rx.OPEN} · Parciales ${rx.PARTIAL} · Pagadas ${rx.PAID}`,
            ]
          : []),
      ],
    },
    {
      label: 'Por pagar total',
      value: fmtSummaryAmount(summary.totalPayable),
      tone: amountToneClass(summary.totalPayable, 'amber'),
      subLines: [
        ...currencyBreakdownLines(summary.totalPayableByCurrency),
        ...(px
          ? [
              `Abiertas ${px.OPEN} · Parciales ${px.PARTIAL} · Pagadas ${px.PAID}`,
            ]
          : []),
      ],
    },
    {
      label: 'Vencido por cobrar',
      value: fmtSummaryAmount(summary.overdueReceivableAmount),
      tone: amountToneClass(summary.overdueReceivableAmount, 'rose'),
      subLines: [
        `${summary.overdueReceivableCount} cuenta${summary.overdueReceivableCount === 1 ? '' : 's'}`,
        ...currencyBreakdownLines(summary.overdueReceivableByCurrency),
      ],
    },
    {
      label: 'Vencido por pagar',
      value: fmtSummaryAmount(summary.overduePayableAmount),
      tone: amountToneClass(summary.overduePayableAmount, 'rose'),
      subLines: [
        `${summary.overduePayableCount} cuenta${summary.overduePayableCount === 1 ? '' : 's'}`,
        ...currencyBreakdownLines(summary.overduePayableByCurrency),
      ],
    },
    {
      label: 'Flujo neto esperado',
      value: fmtSummaryAmount(String(netFlow)),
      tone: netFlowTone(netFlow),
      subLines: [
        'Consolidado en MXN',
        ...(summary.exchangeRateUsed ? [`TC: ${summary.exchangeRateUsed}`] : []),
      ],
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
            <p className="text-[10px] font-medium uppercase leading-snug tracking-[0.14em] text-white/40">
              {cell.label}
            </p>
            <p className={`mt-2 text-lg font-semibold tabular-nums md:text-2xl ${cell.tone}`}>
              {cell.value}
            </p>
            {cell.subLines?.map((line) => (
              <p key={line} className="mt-1 text-[11px] text-white/35">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}

function TopDebtorsSection({ debtors }: { debtors: TopDebtor[] }) {
  if (debtors.length === 0) return null;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/20">
      <div className="border-b border-white/[0.06] px-5 py-3 md:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
          Principales deudores
        </p>
        <p className="mt-1 text-xs text-white/35">
          Saldos por cobrar abiertos — MXN y USD se muestran por separado.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
              <th className="px-5 py-2.5">Cliente</th>
              <th className="px-4 py-2.5 text-right">Saldo</th>
              <th className="px-4 py-2.5">Moneda</th>
              <th className="px-4 py-2.5 text-right">Cuentas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {debtors.map((row) => (
              <tr key={`${row.currency}:${row.clientId ?? row.counterpartyName}`}>
                <td className="px-5 py-3 font-medium text-white/85">
                  {row.clientId ? (
                    <Link
                      href={`/cuentas/clients/${row.clientId}`}
                      className="underline-offset-4 transition hover:text-white hover:underline"
                    >
                      {row.counterpartyName}
                    </Link>
                  ) : (
                    row.counterpartyName
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-300">
                  {fmtEntryMoney(row.outstanding, row.currency)}
                </td>
                <td className="px-4 py-3 text-white/50">{row.currency}</td>
                <td className="px-4 py-3 text-right text-white/50">{row.openAccounts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

// ─── EntryModal ───────────────────────────────────────────────────────────────

type CounterpartyMode = 'client' | 'manual';

type EntryForm = {
  type: AccountEntryType;
  category: AccountEntryCategory;
  counterpartyMode: CounterpartyMode;
  clientId: string;
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
  counterpartyMode: 'manual',
  clientId: '',
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
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  const dealLinked = editing ? isDealLinked(editing) : false;
  const clientOptions = useMemo(() => buildClientOptions(clients), [clients]);

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
        counterpartyMode: editing.clientId ? 'client' : 'manual',
        clientId: editing.clientId ?? '',
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

  useEffect(() => {
    if (!open || dealLinked) return;
    setClientsLoading(true);
    listClients()
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false));
  }, [open, dealLinked]);

  function handleClientChange(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    setForm((current) => ({
      ...current,
      clientId,
      counterpartyName: client?.name ?? current.counterpartyName,
      counterpartyType: 'CLIENT',
    }));
  }

  function switchCounterpartyMode(mode: CounterpartyMode) {
    if (mode === 'client') {
      setForm((current) => ({
        ...current,
        counterpartyMode: 'client',
        counterpartyType: 'CLIENT',
        clientId: current.clientId,
      }));
      return;
    }
    setForm((current) => ({
      ...current,
      counterpartyMode: 'manual',
      clientId: '',
      counterpartyType: current.counterpartyType === 'CLIENT' ? 'OTHER' : current.counterpartyType,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.counterpartyMode === 'client') {
      if (!form.clientId) {
        setError('Selecciona un cliente.');
        return;
      }
    } else if (!form.counterpartyName.trim()) {
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
        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}
          {dealLinked && (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/55">
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
          {dealLinked ? (
            <div>
              <label className="ui-field-label">Contraparte</label>
              <div className="mt-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <p className="text-sm text-white/70">{form.counterpartyName}</p>
                {editing?.clientId ? (
                  <Link
                    href={`/crm/${editing.clientId}`}
                    className="mt-1 inline-flex text-xs font-medium text-emerald-400 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    Ver cliente en CRM →
                  </Link>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="ui-field-label">Contraparte</label>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <PillBtn
                    active={form.counterpartyMode === 'client'}
                    onClick={() => switchCounterpartyMode('client')}
                  >
                    Cliente existente
                  </PillBtn>
                  <PillBtn
                    active={form.counterpartyMode === 'manual'}
                    onClick={() => switchCounterpartyMode('manual')}
                  >
                    Manual
                  </PillBtn>
                </div>
              </div>
              {form.counterpartyMode === 'client' ? (
                <div>
                  <label className="ui-field-label" htmlFor="entry-client-select">
                    Cliente
                  </label>
                  {clients.length === 0 && !clientsLoading ? (
                    <p className="mt-1.5 text-xs text-white/35">No hay clientes registrados.</p>
                  ) : (
                    <SearchableSelect
                      id="entry-client-select"
                      value={form.clientId}
                      onChange={handleClientChange}
                      options={clientOptions}
                      placeholder="Seleccionar cliente"
                      disabled={saving}
                      loading={clientsLoading}
                    />
                  )}
                  {form.clientId ? (
                    <p className="mt-1.5 text-xs text-white/35">
                      {form.counterpartyName}
                    </p>
                  ) : null}
                </div>
              ) : (
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
                    <label className="ui-field-label">Nombre</label>
                    <input
                      className="ui-input mt-1.5 w-full"
                      value={form.counterpartyName}
                      onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })}
                      placeholder="Nombre"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
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
  paidAt: string;
  notes: string;
  destination: AccountPaymentDestination;
  cashAccount: TreasuryAccount;
  payableEntryId: string;
  exchangeRateUsed: string;
  confirmedSettlement: boolean;
  idempotencyKey: string;
};

const EMPTY_PAYMENT_FORM: PaymentForm = {
  amount: '',
  paidAt: todayIso(),
  notes: '',
  destination: 'BANK',
  cashAccount: 'BANK',
  payableEntryId: '',
  exchangeRateUsed: '',
  confirmedSettlement: false,
  idempotencyKey: '',
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
  const [fxLoading, setFxLoading] = useState(false);
  const [payableOptions, setPayableOptions] = useState<AccountEntry[]>([]);
  const [payableSearch, setPayableSearch] = useState('');
  const [payableLoading, setPayableLoading] = useState(false);

  const isSettlement =
    entry?.type === 'RECEIVABLE' && form.destination === 'APPLY_TO_PAYABLE';
  const selectedPayable = payableOptions.find((p) => p.id === form.payableEntryId) ?? null;

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PAYMENT_FORM);
      setError(null);
      setPayableOptions([]);
      setPayableSearch('');
      return;
    }
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `stl-${Date.now()}`;
    if (editing) {
      const cashAccount = editing.cashAccount ?? 'BANK';
      setForm({
        amount: editing.amount,
        paidAt: isoToDateInput(editing.paidAt),
        notes: editing.notes ?? '',
        destination: cashAccount,
        cashAccount,
        payableEntryId: '',
        exchangeRateUsed: editing.exchangeRateUsed ?? '',
        confirmedSettlement: false,
        idempotencyKey: key,
      });
    } else {
      setForm({ ...EMPTY_PAYMENT_FORM, idempotencyKey: key });
    }
  }, [open, editing]);

  useEffect(() => {
    if (!open || !entry || entry.currency !== 'USD') return;
    setFxLoading(true);
    getFxUsdMxn()
      .then((fx) => {
        setForm((current) => ({
          ...current,
          exchangeRateUsed: current.exchangeRateUsed || String(fx.rate),
        }));
      })
      .catch(() => {})
      .finally(() => setFxLoading(false));
  }, [open, entry]);

  useEffect(() => {
    if (!open || !entry || !isSettlement) return;
    let cancelled = false;
    setPayableLoading(true);
    listAccountEntries({ type: 'PAYABLE', q: payableSearch || undefined, pageSize: 50 })
      .then((rows) => {
        if (cancelled) return;
        const filtered = rows.filter(
          (row) =>
            row.currency === entry.currency &&
            row.status !== 'PAID' &&
            row.status !== 'CANCELLED' &&
            Number(row.balance) > 0,
        );
        setPayableOptions(filtered);
      })
      .catch(() => {
        if (!cancelled) setPayableOptions([]);
      })
      .finally(() => {
        if (!cancelled) setPayableLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entry, isSettlement, payableSearch]);

  useEffect(() => {
    if (!isSettlement || !entry || !selectedPayable) return;
    const recvBal = Number(entry.balance);
    const payBal = Number(selectedPayable.balance);
    if (!Number.isFinite(recvBal) || !Number.isFinite(payBal)) return;
    const suggested = Math.min(recvBal, payBal);
    setForm((current) => ({
      ...current,
      amount: current.amount || String(suggested),
    }));
  }, [isSettlement, entry, selectedPayable?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    if (!form.paidAt) {
      setError('Selecciona una fecha.');
      return;
    }
    if (isSettlement) {
      if (!form.payableEntryId) {
        setError('Selecciona la cuenta por pagar a compensar.');
        return;
      }
      if (!form.confirmedSettlement) {
        setError('Confirma la compensación para continuar.');
        return;
      }
    } else if (!form.cashAccount) {
      setError('Selecciona el destino del pago.');
      return;
    }
    if (entry?.currency === 'USD' && !isSettlement) {
      const rate = Number(form.exchangeRateUsed);
      if (!form.exchangeRateUsed || !Number.isFinite(rate) || rate <= 0) {
        setError('Ingresa un tipo de cambio válido para pagos en USD.');
        return;
      }
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
  const destinationOptions =
    entry.type === 'RECEIVABLE'
      ? PAYMENT_DESTINATION_OPTIONS
      : PAYMENT_DESTINATION_OPTIONS.filter((o) => o.value !== 'APPLY_TO_PAYABLE');

  const recvAfter =
    isSettlement && selectedPayable
      ? Math.max(0, Number(entry.balance) - Number(form.amount || 0))
      : null;
  const payAfter =
    isSettlement && selectedPayable
      ? Math.max(0, Number(selectedPayable.balance) - Number(form.amount || 0))
      : null;

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
              Pendiente: {fmtEntryMoney(entry.balance, entry.currency)}
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
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}
          <div>
            <label className="ui-field-label">Monto</label>
            <p className="mt-0.5 text-[11px] text-white/35">Moneda: {entry.currency}</p>
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
            <label className="ui-field-label">
              {entry.type === 'RECEIVABLE' ? 'Destino del pago' : '¿De dónde salió el dinero?'}
            </label>
            <div
              className={`mt-1.5 grid gap-2 ${
                entry.type === 'RECEIVABLE' ? 'grid-cols-2' : 'grid-cols-3'
              }`}
            >
              {destinationOptions.map((option) => (
                <PillBtn
                  key={option.value}
                  active={form.destination === option.value}
                  onClick={() => {
                    if (option.value === 'APPLY_TO_PAYABLE') {
                      setForm({
                        ...form,
                        destination: option.value,
                        payableEntryId: '',
                        confirmedSettlement: false,
                        amount: '',
                      });
                    } else {
                      setForm({
                        ...form,
                        destination: option.value,
                        cashAccount: option.value,
                        payableEntryId: '',
                        confirmedSettlement: false,
                      });
                    }
                  }}
                >
                  {option.label}
                </PillBtn>
              ))}
            </div>
          </div>

          {isSettlement ? (
            <div className="space-y-3 rounded-xl border border-sky-400/25 bg-sky-500/[0.06] p-3">
              <div className="flex items-start gap-2 text-sky-100/90">
                <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                <p className="text-[11px] leading-relaxed">
                  Compensación entre cuentas: no ingresa dinero a la empresa.
                </p>
              </div>

              <div>
                <label className="ui-field-label">Cuenta por pagar</label>
                <input
                  type="search"
                  className="ui-input mt-1.5 w-full"
                  placeholder="Buscar contraparte o concepto…"
                  value={payableSearch}
                  onChange={(e) => setPayableSearch(e.target.value)}
                />
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                  {payableLoading ? (
                    <p className="px-1 py-2 text-xs text-white/35">Buscando…</p>
                  ) : payableOptions.length === 0 ? (
                    <div className="rounded-lg border border-sky-400/20 bg-black/20 px-3 py-3">
                      <p className="text-xs font-medium text-white/75">
                        No existen cuentas por pagar compatibles.
                      </p>
                      <p className="mt-2 text-[11px] text-white/45">Las cuentas deben:</p>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-white/45">
                        <li>• pertenecer al mismo tenant</li>
                        <li>• estar en la misma moneda</li>
                        <li>• tener saldo pendiente.</li>
                      </ul>
                    </div>
                  ) : (
                    payableOptions.map((option) => {
                      const selected = form.payableEntryId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              payableEntryId: option.id,
                              confirmedSettlement: false,
                              amount: '',
                            })
                          }
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                            selected
                              ? 'border-sky-400/45 bg-sky-500/15 ring-1 ring-sky-400/20'
                              : 'border-white/10 bg-white/[0.03] hover:border-sky-400/25 hover:bg-white/[0.06]'
                          }`}
                        >
                          <p className="text-sm font-semibold text-white/90">
                            {option.counterpartyName}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-white/45">
                            {option.concept || 'Sin concepto'}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <StatusChip status={option.status} />
                            <p className="text-xs font-medium tabular-nums text-white/75">
                              {fmtEntryMoney(option.balance, option.currency)}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedPayable ? (
                <div className="space-y-3 rounded-lg border border-sky-400/25 bg-black/25 px-3 py-3">
                  <div className="flex items-center gap-2 text-sky-100">
                    <InfoIcon className="h-4 w-4 text-sky-300" />
                    <p className="text-[11px] font-semibold tracking-wide">
                      Vista previa de la compensación
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                        Cuenta por cobrar
                      </p>
                      <p className="mt-1 text-sm font-semibold text-sky-100">
                        {entry.counterpartyName}
                      </p>
                      <p className="mt-2 text-sm tabular-nums text-white/70">
                        {fmtEntryMoney(entry.balance, entry.currency)}
                      </p>
                      <p className="my-1 text-center text-xs text-sky-300/80">↓</p>
                      <p className="text-sm font-semibold tabular-nums text-white/90">
                        {fmtEntryMoney(String(recvAfter ?? 0), entry.currency)}
                      </p>
                    </div>

                    <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                        Cuenta por pagar
                      </p>
                      <p className="mt-1 text-sm font-semibold text-sky-100">
                        {selectedPayable.counterpartyName}
                      </p>
                      <p className="mt-2 text-sm tabular-nums text-white/70">
                        {fmtEntryMoney(selectedPayable.balance, selectedPayable.currency)}
                      </p>
                      <p className="my-1 text-center text-xs text-sky-300/80">↓</p>
                      <p className="text-sm font-semibold tabular-nums text-white/90">
                        {fmtEntryMoney(String(payAfter ?? 0), selectedPayable.currency)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-sky-400/20 bg-sky-500/[0.08] px-3 py-2.5">
                    <p className="text-[11px] font-medium text-sky-100/90">
                      No se registrará movimiento en:
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[11px] text-white/65">
                      <li className="flex items-center gap-1.5">
                        <span className="text-sky-300">✓</span> Efectivo
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="text-sky-300">✓</span> Bancos
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="text-sky-300">✓</span> Cuenta César
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="text-sky-300">✓</span> Crypto
                      </li>
                    </ul>
                  </div>

                  <label className="flex items-start gap-2 text-xs text-white/75">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.confirmedSettlement}
                      onChange={(e) =>
                        setForm({ ...form, confirmedSettlement: e.target.checked })
                      }
                    />
                    Confirmo aplicar esta compensación entre ambas cuentas.
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {entry.currency === 'USD' && !isSettlement && (
            <div>
              <label className="ui-field-label">Tipo de cambio MXN/USD</label>
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                className="ui-input mt-1.5 w-full"
                value={form.exchangeRateUsed}
                onChange={(e) => setForm({ ...form, exchangeRateUsed: e.target.value })}
                placeholder={fxLoading ? 'Cargando…' : '0.00'}
                disabled={fxLoading && !form.exchangeRateUsed}
              />
              <p className="mt-1 text-[11px] text-white/35">
                Necesario para reflejar el movimiento en MXN.
              </p>
            </div>
          )}
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
              {saving
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : isSettlement
                    ? 'Aplicar compensación'
                    : 'Registrar pago'}
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
  const canRegisterPayment = canCashPayEntry(entry);
  const canDelete = entry.status !== 'PAID';
  const payments = [...(entry.payments ?? [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const metrics = [
    { label: 'Monto total', value: fmtEntryMoney(entry.totalAmount, entry.currency) },
    { label: 'Pagado', value: fmtEntryMoney(entry.paidTotal, entry.currency) },
    {
      label: 'Pendiente',
      value: fmtEntryMoney(entry.balance, entry.currency),
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
            {entry.clientId ? (
              <Link
                href={`/cuentas/clients/${entry.clientId}`}
                className="mt-2 inline-flex text-xs font-medium text-emerald-400 underline-offset-4 transition hover:text-white hover:underline"
              >
                Ver ledger del cliente →
              </Link>
            ) : null}
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
            {canRegisterPayment ? (
              <button type="button" onClick={onPayment} className="ui-btn-primary px-3 py-2 text-sm">
                Registrar pago
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="ui-btn-primary px-3 py-2 text-sm opacity-40"
                title={
                  dealLinked
                    ? 'Esta cuenta se liquida desde Ventas'
                    : entry.status === 'PAID'
                      ? 'Esta cuenta ya está pagada'
                      : 'No hay saldo pendiente'
                }
              >
                Registrar pago
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              disabled={!canDelete}
              className="ui-btn-ghost px-3 py-2 text-sm text-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
              title={canDelete ? undefined : 'No se puede eliminar una cuenta ya pagada'}
            >
              Eliminar
            </button>
          </div>

          <section className="px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Pagos
            </p>
            {dealLinked ? (
              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 text-center">
                <p className="text-xs leading-relaxed text-white/45">
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
                {payments.map((payment) => {
                  const isSettlementPayment =
                    Boolean(payment.settlement) ||
                    payment.method === 'SETTLEMENT' ||
                    Boolean(payment.settlementId);
                  return (
                    <li key={payment.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs tabular-nums text-white/35">
                            {fmtDate(payment.paidAt)}
                          </p>
                          {isSettlementPayment ? (
                            <div className="mt-1.5 rounded-lg border border-sky-400/20 bg-sky-500/[0.07] px-2.5 py-2">
                              <div className="flex items-start gap-1.5">
                                <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-sky-100/95">
                                    {paymentSourceLabel(payment, entry.type)}
                                  </p>
                                  {payment.settlement?.counterpartName ? (
                                    <p className="mt-1 text-sm font-semibold text-sky-50">
                                      {payment.settlement.counterpartName}
                                    </p>
                                  ) : null}
                                  {payment.settlementId ? (
                                    <p className="mt-1 text-[10px] tabular-nums text-sky-200/55">
                                      Settlement #{settlementShortId(payment.settlementId)}
                                    </p>
                                  ) : null}
                                  {payment.settlement ? (
                                    <button
                                      type="button"
                                      className="mt-1.5 text-[11px] font-medium text-sky-300 underline-offset-2 hover:underline"
                                      onClick={() => {
                                        window.location.href = `/cuentas?type=${
                                          payment.settlement?.role === 'RECEIVABLE_SIDE'
                                            ? 'PAYABLE'
                                            : 'RECEIVABLE'
                                        }`;
                                      }}
                                    >
                                      Ver contraparte →
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-white/40">
                              {paymentSourceLabel(payment, entry.type)}
                            </p>
                          )}
                          {payment.notes ? (
                            <p className="mt-1 truncate text-sm text-white/40">{payment.notes}</p>
                          ) : null}
                        </div>
                        <p
                          className={`shrink-0 text-sm font-semibold tabular-nums ${
                            isSettlementPayment ? 'text-sky-200' : 'text-emerald-300'
                          }`}
                        >
                          {fmtEntryMoney(payment.amount, payment.currency as Currency)}
                        </p>
                      </div>
                    </li>
                  );
                })}
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const clientIdFilter = searchParams.get('clientId')?.trim() || null;
  const typeParam = searchParams.get('type');

  const initialTab: AccountEntryType =
    typeParam === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE';

  const [tab, setTab] = useState<AccountEntryType>(initialTab);
  const [summary, setSummary] = useState<CuentasSummary | null>(null);
  const [topDebtors, setTopDebtors] = useState<TopDebtor[]>([]);
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
  const [filters, setFilters] = useState<EntryFilters>(EMPTY_ENTRY_FILTERS);

  // Legacy ?clientId= → canonical customer ledger
  useEffect(() => {
    if (!clientIdFilter) return;
    router.replace(`/cuentas/clients/${clientIdFilter}`);
  }, [clientIdFilter, router]);

  useEffect(() => {
    if (typeParam === 'PAYABLE' || typeParam === 'RECEIVABLE') {
      setTab(typeParam);
    }
  }, [typeParam]);

  const entriesQuery = useMemo(
    () => ({
      type: tab,
    }),
    [tab],
  );

  const filteredEntries = useMemo(
    () => filterAccountEntries(entries, filters),
    [entries, filters],
  );

  const activeFilters = hasActiveEntryFilters(filters);

  const loadData = useCallback(async (query: { type: AccountEntryType }) => {
    setLoading(true);
    setError(null);
    try {
      const [sum, list, debtors] = await Promise.all([
        getCuentasSummary(),
        listAccountEntries(query),
        getTopDebtors(10).catch(() => [] as TopDebtor[]),
      ]);
      setSummary(sum);
      setEntries(list);
      setTopDebtors(debtors);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las cuentas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(entriesQuery);
  }, [entriesQuery, loadData]);

  function setTabAndUrl(next: AccountEntryType) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', next);
    params.delete('clientId');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function resetFilters() {
    setFilters(EMPTY_ENTRY_FILTERS);
  }

  useEffect(() => {
    setDrawerEntry(null);
  }, [tab]);

  useEffect(() => {
    if (!drawerEntry) return;

    const stillVisible = filteredEntries.some((entry) => entry.id === drawerEntry.id);
    if (!stillVisible) {
      setDrawerEntry(null);
      return;
    }

    const fresh = entries.find((entry) => entry.id === drawerEntry.id);
    if (!fresh) {
      setDrawerEntry(null);
      return;
    }
    if (
      fresh.updatedAt !== drawerEntry.updatedAt ||
      fresh.paidTotal !== drawerEntry.paidTotal ||
      fresh.balance !== drawerEntry.balance ||
      fresh.status !== drawerEntry.status
    ) {
      setDrawerEntry(fresh);
    }
  }, [entries, drawerEntry, filteredEntries]);

  async function handleSaveEntry(form: EntryForm) {
    const editingId = entryModal.editing?.id ?? null;
    const counterpartyPayload =
      form.counterpartyMode === 'client' && form.clientId
        ? {
            clientId: form.clientId,
            counterpartyType: 'CLIENT' as CounterpartyType,
            counterpartyName: form.counterpartyName.trim(),
          }
        : {
            clientId: null as string | null,
            counterpartyType: form.counterpartyType,
            counterpartyName: form.counterpartyName.trim(),
          };

    const payload = {
      type: form.type,
      category: form.category,
      ...counterpartyPayload,
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
      const editing = entryModal.editing;
      if (isDealLinked(editing)) {
        const {
          type: _type,
          totalAmount: _totalAmount,
          clientId: _clientId,
          counterpartyType: _counterpartyType,
          counterpartyName: _counterpartyName,
          ...dealSafePayload
        } = payload;
        await updateAccountEntry(editing.id, dealSafePayload);
      } else {
        await updateAccountEntry(editing.id, payload);
      }
    } else {
      const { clientId, ...createPayload } = payload;
      await createAccountEntry({
        ...createPayload,
        ...(form.counterpartyMode === 'client' && clientId ? { clientId } : {}),
      });
    }

    const [sum, list] = await Promise.all([
      getCuentasSummary(),
      listAccountEntries(entriesQuery),
    ]);
    setSummary(sum);
    setEntries(list);
    if (editingId) {
      const refreshed = list.find((e) => e.id === editingId);
      setDrawerEntry(refreshed ?? null);
    }
    setEntryModal({ open: false, editing: null });
    setActionError(null);
  }

  async function handleSavePayment(form: PaymentForm) {
    const entry = paymentModal.entry;
    if (!entry) return;

    const isSettlement =
      entry.type === 'RECEIVABLE' && form.destination === 'APPLY_TO_PAYABLE';

    if (paymentModal.editing) {
      if (isSettlement || paymentModal.editing.settlementId) {
        throw new Error('Las compensaciones no se editan; reviértelas desde el pago.');
      }
      await updateAccountPayment(entry.id, paymentModal.editing.id, {
        amount: Number(form.amount),
        method: treasuryAccountToPaymentMethod(form.cashAccount),
        paidAt: form.paidAt,
        notes: form.notes.trim() || undefined,
        cashAccount: form.cashAccount,
        ...(entry.currency === 'USD'
          ? { exchangeRateUsed: Number(form.exchangeRateUsed) }
          : {}),
      });
    } else if (isSettlement) {
      await createAccountPayment(entry.id, {
        amount: Number(form.amount),
        paidAt: form.paidAt,
        notes: form.notes.trim() || undefined,
        destination: 'APPLY_TO_PAYABLE',
        payableEntryId: form.payableEntryId,
        idempotencyKey: form.idempotencyKey || undefined,
      });
    } else {
      await createAccountPayment(entry.id, {
        amount: Number(form.amount),
        method: treasuryAccountToPaymentMethod(form.cashAccount),
        paidAt: form.paidAt,
        notes: form.notes.trim() || undefined,
        cashAccount: form.cashAccount,
        destination: form.destination as TreasuryAccount,
        ...(entry.currency === 'USD'
          ? { exchangeRateUsed: Number(form.exchangeRateUsed) }
          : {}),
      });
    }

    const entryId = entry.id;
    const [sum, list] = await Promise.all([
      getCuentasSummary(),
      listAccountEntries(entriesQuery),
    ]);
    setSummary(sum);
    setEntries(list);
    const refreshed = list.find((e) => e.id === entryId);
    setDrawerEntry(refreshed ?? null);
    setPaymentModal({ open: false, entry: null, editing: null });
    setActionError(null);
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
      await loadData(entriesQuery);
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
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Cuentas</h1>
            <p className="ui-subtitle">Control de cobros y pagos operativos.</p>
          </div>
        </header>
        <div className="flex items-center justify-center rounded-2xl border border-white/[0.08] bg-panel/95 py-24">
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
            onClick={() => void loadData(entriesQuery)}
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

      {topDebtors.length > 0 ? <TopDebtorsSection debtors={topDebtors} /> : null}

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

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <PillBtn active={tab === 'RECEIVABLE'} onClick={() => setTabAndUrl('RECEIVABLE')}>
            Por cobrar
          </PillBtn>
          <PillBtn active={tab === 'PAYABLE'} onClick={() => setTabAndUrl('PAYABLE')}>
            Por pagar
          </PillBtn>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/20">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-12 md:px-6">
            <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/15 px-4 py-10 text-center">
              <p className="text-sm text-white/35">
                {tab === 'RECEIVABLE'
                  ? 'Aún no hay cuentas por cobrar registradas.'
                  : 'Aún no hay cuentas por pagar registradas.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-white/[0.06] px-4 py-3 md:px-5">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
                  Filtros
                </span>
                {activeFilters ? (
                  <button type="button" onClick={resetFilters} className="ui-btn-ghost px-2 py-1 text-xs">
                    Restablecer
                  </button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <input
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Buscar contraparte o concepto…"
                  className="ui-input sm:col-span-2 xl:col-span-2"
                />
                <select
                  value={filters.currency}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, currency: e.target.value as EntryFilters['currency'] }))
                  }
                  className="ui-input"
                >
                  <option value="">Todas</option>
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                </select>
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, status: e.target.value as EntryFilters['status'] }))
                  }
                  className="ui-input"
                >
                  <option value="">Todos</option>
                  {(Object.keys(STATUS_LABELS) as AccountEntryStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.source}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, source: e.target.value as EntryFilters['source'] }))
                  }
                  className="ui-input"
                >
                  <option value="">Todas</option>
                  <option value="MANUAL">Manual</option>
                  <option value="DEAL_AUTO">Venta</option>
                  <option value="PURCHASE_AUTO">Compra</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={filters.minBalance}
                  onChange={(e) => setFilters((prev) => ({ ...prev, minBalance: e.target.value }))}
                  placeholder="Monto mínimo"
                  className="ui-input"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={filters.maxBalance}
                  onChange={(e) => setFilters((prev) => ({ ...prev, maxBalance: e.target.value }))}
                  placeholder="Monto máximo"
                  className="ui-input"
                />
              </div>
              </div>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="px-5 py-12 md:px-6">
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/15 px-4 py-10 text-center">
                  <p className="text-sm text-white/55">No encontramos cuentas con esos filtros.</p>
                  <button type="button" onClick={resetFilters} className="ui-btn-ghost mt-4 px-3 py-1.5 text-xs">
                    Restablecer filtros
                  </button>
                </div>
              </div>
            ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-black/20 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  <th className="sticky left-0 z-20 bg-[#121212] px-4 py-3 font-semibold shadow-[4px_0_10px_-6px_rgba(0,0,0,0.65)]">
                    Contraparte
                  </th>
                  <th className="px-4 py-3 font-semibold">Concepto</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Monto</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Pagado</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold text-right">Pendiente</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">Vence</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Fuente</th>
                  <th className="px-4 py-3 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="group cursor-pointer transition hover:bg-white/[0.03]"
                    onClick={() => setDrawerEntry(entry)}
                  >
                    <td className="sticky left-0 z-10 bg-panel/95 px-4 py-3 font-medium text-white shadow-[4px_0_10px_-6px_rgba(0,0,0,0.65)] group-hover:bg-[#141414]">
                      {entry.clientId ? (
                        <Link
                          href={`/cuentas/clients/${entry.clientId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-white/80 underline-offset-4 transition hover:text-white hover:underline"
                        >
                          {entry.counterpartyName}
                        </Link>
                      ) : (
                        entry.counterpartyName
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-white/60">
                      {entry.concept}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-white">
                      {fmtEntryMoney(entry.totalAmount, entry.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-white/60">
                      {fmtEntryMoney(entry.paidTotal, entry.currency)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${
                        entry.status === 'OVERDUE' && Number(entry.balance) > 0
                          ? 'text-rose-400'
                          : Number(entry.balance) > 0
                            ? 'text-amber-400'
                            : 'text-white/50'
                      }`}
                    >
                      {fmtEntryMoney(entry.balance, entry.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-white/50">{fmtDate(entry.dueDate)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusPillClass(entry.status)}`}
                      >
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${sourcePillClass(entry.source)}`}
                      >
                        {sourceLabel(entry.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/50 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
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
          </>
        )}
        </div>
      </div>

      <EntryDrawer
        entry={drawerEntry}
        onClose={() => setDrawerEntry(null)}
        onEdit={() => {
          if (drawerEntry) setEntryModal({ open: true, editing: drawerEntry });
        }}
        onPayment={() => {
          if (drawerEntry && canCashPayEntry(drawerEntry)) {
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
