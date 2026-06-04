'use client';

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type InvestorId = 'cesar' | 'edgar';
type CapitalMethod = 'CASH' | 'BANCOS' | 'CESAR';

type Aporte = {
  id: string;
  investorId: InvestorId;
  amount: number;
  method: CapitalMethod;
  date: string;    // YYYY-MM-DD
  notes: string | null;
};

type Retiro = {
  id: string;
  investorId: InvestorId;
  amount: number;
  method: CapitalMethod;
  paidAt: string;  // YYYY-MM-DD
  notes: string | null;
};

// ─── Mock business profit ─────────────────────────────────────────────────────
// In production these come from GET /history/summary

const TOTAL_REVENUE          = 2_450_000;
const TOTAL_COST_OF_SOLD     = 1_640_000;
const TOTAL_BANK_FEES        =    48_500;
const TOTAL_BUSINESS_PROFIT  = TOTAL_REVENUE - TOTAL_COST_OF_SOLD - TOTAL_BANK_FEES; // 761,500

// ─── Mock investors ───────────────────────────────────────────────────────────

const INVESTORS: Array<{ id: InvestorId; name: string; sharePercent: number }> = [
  { id: 'cesar', name: 'César', sharePercent: 75 },
  { id: 'edgar', name: 'Edgar', sharePercent: 25 },
];

// ─── Initial mock data ────────────────────────────────────────────────────────

const INITIAL_APORTES: Aporte[] = [
  { id: 'a1', investorId: 'cesar', amount: 500_000, method: 'BANCOS', date: '2026-01-15', notes: 'Capital inicial' },
  { id: 'a2', investorId: 'edgar', amount: 200_000, method: 'BANCOS', date: '2026-01-15', notes: 'Capital inicial' },
  { id: 'a3', investorId: 'cesar', amount: 200_000, method: 'CESAR',  date: '2026-02-28', notes: 'Refuerzo de capital Q1' },
  { id: 'a4', investorId: 'edgar', amount:  50_000, method: 'CASH',   date: '2026-03-05', notes: null },
  { id: 'a5', investorId: 'cesar', amount: 100_000, method: 'CASH',   date: '2026-04-10', notes: null },
];

const INITIAL_RETIROS: Retiro[] = [
  { id: 'r1', investorId: 'cesar', amount: 100_000, method: 'CESAR',  paidAt: '2026-02-01', notes: 'Distribución enero' },
  { id: 'r2', investorId: 'edgar', amount:  60_000, method: 'BANCOS', paidAt: '2026-03-01', notes: 'Distribución Q1' },
  { id: 'r3', investorId: 'cesar', amount: 120_000, method: 'BANCOS', paidAt: '2026-03-01', notes: 'Distribución feb–mar' },
  { id: 'r4', investorId: 'cesar', amount:  80_000, method: 'CESAR',  paidAt: '2026-04-01', notes: null },
  { id: 'r5', investorId: 'edgar', amount:  35_000, method: 'CASH',   paidAt: '2026-05-10', notes: null },
  { id: 'r6', investorId: 'cesar', amount:  20_000, method: 'CASH',   paidAt: '2026-05-15', notes: 'Anticipo' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMxn(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

const METHOD_LABELS: Record<CapitalMethod, string> = {
  CASH:   'Efectivo',
  BANCOS: 'Bancos',
  CESAR:  'Cuenta César',
};

const METHOD_OPTIONS: Array<{ value: CapitalMethod; label: string }> = [
  { value: 'CASH',   label: 'Efectivo' },
  { value: 'BANCOS', label: 'Bancos' },
  { value: 'CESAR',  label: 'Cuenta César' },
];

function investorName(id: InvestorId) {
  return INVESTORS.find((i) => i.id === id)?.name ?? id;
}

// ─── PillBtn ──────────────────────────────────────────────────────────────────

function PillBtn({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
        active
          ? 'border-white/35 bg-white/10 text-white'
          : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Investor badge pill ──────────────────────────────────────────────────────

function InvestorPill({ investorId }: { investorId: InvestorId }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${
      investorId === 'cesar'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-white/15 bg-white/[0.05] text-white/60'
    }`}>
      {investorName(investorId)}
    </span>
  );
}

// ─── Method pill ──────────────────────────────────────────────────────────────

function MethodPill({ method }: { method: CapitalMethod }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-[3px] text-[10px] font-medium tracking-wide text-white/50">
      {METHOD_LABELS[method]}
    </span>
  );
}

// ─── Capital Hero ─────────────────────────────────────────────────────────────

function CapitalHero({
  totalCapitalContributed,
  totalDistributionsPaid,
  totalPendingToPartners,
  capitalNeto,
}: {
  totalCapitalContributed: number;
  totalDistributionsPaid: number;
  totalPendingToPartners: number;
  capitalNeto: number;
}) {
  const cells = [
    { label: 'Capital aportado',    value: fmtMxn(totalCapitalContributed),  tone: 'default' },
    { label: 'Utilidad acumulada',  value: fmtMxn(TOTAL_BUSINESS_PROFIT),    tone: 'positive' },
    { label: 'Retirado a socios',   value: fmtMxn(totalDistributionsPaid),   tone: 'default' },
    { label: 'Por pagar a socios',  value: fmtMxn(totalPendingToPartners),   tone: totalPendingToPartners > 0 ? 'negative' : 'default' },
    { label: 'Capital neto',        value: fmtMxn(capitalNeto),              tone: 'default' },
  ] as const;

  const toneClass = (tone: 'default' | 'positive' | 'negative') =>
    tone === 'positive' ? 'text-emerald-400' :
    tone === 'negative' ? 'text-rose-400' :
    'text-white';

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 shadow-lg shadow-black/30">
      <div className="border-b border-white/[0.06] px-5 py-3 md:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
          Posición de capital
        </p>
      </div>

      <div className="grid grid-cols-2 divide-y divide-white/[0.06] sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0">
        {cells.map((cell) => (
          <div key={cell.label} className="px-4 py-4 md:px-5 md:py-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/30">
              {cell.label}
            </p>
            <p className={`mt-2 text-xl font-semibold tabular-nums leading-none md:text-2xl ${toneClass(cell.tone)}`}>
              {cell.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-white/[0.06] bg-black/20 px-5 py-3 md:px-6">
        <p className="text-[10px] text-white/20">
          Capital neto = capital aportado + utilidad acumulada − retiros
        </p>
      </div>
    </article>
  );
}

// ─── Investor Card ────────────────────────────────────────────────────────────

function InvestorCard({
  id,
  name,
  sharePercent,
  capitalContributed,
  profitEntitlement,
  distributionsPaid,
  pendingProfit,
}: {
  id: InvestorId;
  name: string;
  sharePercent: number;
  capitalContributed: number;
  profitEntitlement: number;
  distributionsPaid: number;
  pendingProfit: number;
}) {
  const rows = [
    { label: 'Aportado',          value: fmtMxn(capitalContributed), tone: 'default' },
    { label: 'Utilidad asignada', value: fmtMxn(profitEntitlement),  tone: 'default' },
    { label: 'Retirado',          value: fmtMxn(distributionsPaid),  tone: 'default' },
  ] as const;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
            id === 'cesar'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-white/15 bg-white/[0.06] text-white/60'
          }`}>
            {name[0]}
          </div>
          <div>
            <p className="text-base font-semibold text-white">{name}</p>
            <p className="text-[11px] text-white/35">Socio · {sharePercent}%</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white/40">
          {sharePercent}%
        </span>
      </div>

      {/* Metrics */}
      <div className="space-y-0 divide-y divide-white/[0.04]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-white/45">{row.label}</span>
            <span className="text-sm font-semibold tabular-nums text-white">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Por cobrar footer */}
      <div className="border-t border-white/[0.06] bg-black/20 flex items-center justify-between px-5 py-4">
        <span className="text-sm font-medium text-white/60">Por cobrar</span>
        <span className={`text-xl font-semibold tabular-nums ${
          pendingProfit > 0 ? 'text-emerald-400' : pendingProfit < 0 ? 'text-rose-400' : 'text-white/30'
        }`}>
          {fmtMxn(pendingProfit)}
        </span>
      </div>
    </article>
  );
}

// ─── Aportes table ────────────────────────────────────────────────────────────

function AportesTable({
  aportes,
  deletingId,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  aportes: Aporte[];
  deletingId: string | null;
  onEdit: (a: Aporte) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (aportes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-panel/50 px-4 py-16 text-center">
        <p className="text-sm font-medium text-white/40">Sin aportes registrados.</p>
        <p className="mt-1.5 text-xs text-white/20">
          Los aportes de capital de los socios aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="w-[100px] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Fecha</th>
              <th className="w-[110px] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Socio</th>
              <th className="w-[120px] px-4 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Monto</th>
              <th className="w-[120px] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Cuenta</th>
              <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Notas</th>
              <th className="w-[120px] px-4 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {aportes.map((row) => (
              <tr key={row.id} className="group transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3.5 text-xs tabular-nums text-white/35 whitespace-nowrap">
                  {fmtDate(row.date)}
                </td>
                <td className="px-4 py-3.5">
                  <InvestorPill investorId={row.investorId} />
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white whitespace-nowrap">
                  {fmtMxn(row.amount)}
                </td>
                <td className="px-4 py-3.5">
                  <MethodPill method={row.method} />
                </td>
                <td className="px-4 py-3.5 text-sm text-white/35 max-w-[180px] truncate">
                  {row.notes ?? <span className="text-white/20">—</span>}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {deletingId === row.id ? (
                    <span className="flex items-center justify-end gap-2 text-xs">
                      <span className="text-white/40">¿Eliminar?</span>
                      <button
                        type="button"
                        onClick={() => onDeleteConfirm(row.id)}
                        className="text-rose-400 hover:text-rose-300 font-medium transition"
                      >
                        Sí
                      </button>
                      <button
                        type="button"
                        onClick={onDeleteCancel}
                        className="text-white/30 hover:text-white/60 transition"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/8 hover:text-white transition"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(row.id)}
                        className="rounded px-2 py-1 text-xs text-rose-400/70 hover:bg-rose-400/10 hover:text-rose-300 transition"
                      >
                        Eliminar
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Retiros table ────────────────────────────────────────────────────────────

function RetirosTable({
  retiros,
  deletingId,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  retiros: Retiro[];
  deletingId: string | null;
  onEdit: (r: Retiro) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (retiros.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-panel/50 px-4 py-16 text-center">
        <p className="text-sm font-medium text-white/40">Sin retiros registrados.</p>
        <p className="mt-1.5 text-xs text-white/20">
          Los retiros y distribuciones de utilidades aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="w-[100px] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Fecha</th>
              <th className="w-[110px] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Socio</th>
              <th className="w-[120px] px-4 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Monto</th>
              <th className="w-[120px] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Cuenta</th>
              <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Notas</th>
              <th className="w-[120px] px-4 py-3 text-right text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {retiros.map((row) => (
              <tr key={row.id} className="group transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3.5 text-xs tabular-nums text-white/35 whitespace-nowrap">
                  {fmtDate(row.paidAt)}
                </td>
                <td className="px-4 py-3.5">
                  <InvestorPill investorId={row.investorId} />
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white whitespace-nowrap">
                  {fmtMxn(row.amount)}
                </td>
                <td className="px-4 py-3.5">
                  <MethodPill method={row.method} />
                </td>
                <td className="px-4 py-3.5 text-sm text-white/35 max-w-[180px] truncate">
                  {row.notes ?? <span className="text-white/20">—</span>}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {deletingId === row.id ? (
                    <span className="flex items-center justify-end gap-2 text-xs">
                      <span className="text-white/40">¿Eliminar?</span>
                      <button
                        type="button"
                        onClick={() => onDeleteConfirm(row.id)}
                        className="text-rose-400 hover:text-rose-300 font-medium transition"
                      >
                        Sí
                      </button>
                      <button
                        type="button"
                        onClick={onDeleteCancel}
                        className="text-white/30 hover:text-white/60 transition"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/8 hover:text-white transition"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(row.id)}
                        className="rounded px-2 py-1 text-xs text-rose-400/70 hover:bg-rose-400/10 hover:text-rose-300 transition"
                      >
                        Eliminar
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Aporte Modal ─────────────────────────────────────────────────────────────

type AporteForm = {
  investorId: InvestorId | '';
  amount: string;
  method: CapitalMethod | '';
  date: string;
  notes: string;
};

const EMPTY_APORTE_FORM: AporteForm = {
  investorId: '',
  amount: '',
  method: '',
  date: todayIso(),
  notes: '',
};

function AporteModal({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: Aporte | null;
  onClose: () => void;
  onSave: (data: Omit<Aporte, 'id'>) => void;
}) {
  const [form, setForm] = useState<AporteForm>(EMPTY_APORTE_FORM);
  const [error, setError] = useState<string | null>(null);

  // Sync form when modal opens
  if (open && editing && form.amount === '' && !form.investorId) {
    setForm({
      investorId: editing.investorId,
      amount: String(editing.amount),
      method: editing.method,
      date: editing.date,
      notes: editing.notes ?? '',
    });
  }

  function reset() {
    setForm(EMPTY_APORTE_FORM);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.investorId) { setError('Selecciona un socio.'); return; }
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    if (!form.method) { setError('Selecciona una cuenta.'); return; }
    if (!form.date) { setError('Selecciona una fecha.'); return; }
    onSave({
      investorId: form.investorId,
      amount,
      method: form.method,
      date: form.date,
      notes: form.notes.trim() || null,
    });
    reset();
  }

  if (!open) return null;

  const isEdit = editing !== null;
  const canSubmit = !!form.investorId && Number(form.amount) > 0 && !!form.method && !!form.date;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {isEdit ? 'Editar aporte' : 'Registrar aporte de capital'}
            </h2>
            {!isEdit && (
              <p className="mt-0.5 text-xs text-white/40">
                Registra el dinero que un socio aporta al negocio.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/8 hover:text-white transition"
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

          {/* Socio */}
          <div>
            <label className="ui-field-label">Socio</label>
            <div className="mt-1.5 flex gap-2">
              {INVESTORS.map((inv) => (
                <PillBtn
                  key={inv.id}
                  active={form.investorId === inv.id}
                  disabled={isEdit}
                  onClick={() => setForm((f) => ({ ...f, investorId: inv.id }))}
                >
                  {inv.name}
                </PillBtn>
              ))}
            </div>
            {isEdit && (
              <p className="mt-1.5 text-[11px] text-white/25">
                El socio no se puede cambiar. Elimina y crea un nuevo aporte si es necesario.
              </p>
            )}
          </div>

          {/* Monto */}
          <div>
            <label className="ui-field-label">Monto</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="ui-input mt-1.5"
              required
            />
          </div>

          {/* Cuenta destino */}
          <div>
            <label className="ui-field-label">Cuenta destino</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {METHOD_OPTIONS.map((opt) => (
                <PillBtn
                  key={opt.value}
                  active={form.method === opt.value}
                  onClick={() => setForm((f) => ({ ...f, method: opt.value }))}
                >
                  {opt.label}
                </PillBtn>
              ))}
            </div>
          </div>

          {/* Fecha */}
          <div>
            <label className="ui-field-label">Fecha</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="ui-input mt-1.5"
            />
          </div>

          {/* Notas */}
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              rows={2}
              placeholder="Descripción del aporte…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="ui-input mt-1.5 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-white/[0.06] pt-4">
            <button type="button" onClick={handleClose} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {isEdit ? 'Guardar cambios' : 'Registrar aporte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Retiro Modal ─────────────────────────────────────────────────────────────

type RetiroForm = {
  investorId: InvestorId | '';
  amount: string;
  method: CapitalMethod | '';
  paidAt: string;
  notes: string;
};

const EMPTY_RETIRO_FORM: RetiroForm = {
  investorId: '',
  amount: '',
  method: '',
  paidAt: todayIso(),
  notes: '',
};

function RetiroModal({
  open,
  editing,
  pendingByInvestor,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: Retiro | null;
  pendingByInvestor: Record<InvestorId, number>;
  onClose: () => void;
  onSave: (data: Omit<Retiro, 'id'>) => void;
}) {
  const [form, setForm] = useState<RetiroForm>(EMPTY_RETIRO_FORM);
  const [error, setError] = useState<string | null>(null);

  if (open && editing && form.amount === '' && !form.investorId) {
    setForm({
      investorId: editing.investorId,
      amount: String(editing.amount),
      method: editing.method,
      paidAt: editing.paidAt,
      notes: editing.notes ?? '',
    });
  }

  function reset() {
    setForm(EMPTY_RETIRO_FORM);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.investorId) { setError('Selecciona un socio.'); return; }
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    if (!form.method) { setError('Selecciona una cuenta.'); return; }
    if (!form.paidAt) { setError('Selecciona una fecha.'); return; }
    onSave({
      investorId: form.investorId,
      amount,
      method: form.method,
      paidAt: form.paidAt,
      notes: form.notes.trim() || null,
    });
    reset();
  }

  if (!open) return null;

  const isEdit = editing !== null;
  const amountNum = Number(form.amount) || 0;
  const pending = form.investorId ? (pendingByInvestor[form.investorId] ?? 0) : null;
  const overage = pending !== null && amountNum > pending ? amountNum - pending : 0;
  const canSubmit = !!form.investorId && amountNum > 0 && !!form.method && !!form.paidAt;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {isEdit ? 'Editar retiro' : 'Registrar retiro'}
            </h2>
            {!isEdit && (
              <p className="mt-0.5 text-xs text-white/40">
                Registra un pago o retiro de utilidades a un socio.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/8 hover:text-white transition"
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

          {/* Socio */}
          <div>
            <label className="ui-field-label">Socio</label>
            <div className="mt-1.5 flex gap-2">
              {INVESTORS.map((inv) => (
                <PillBtn
                  key={inv.id}
                  active={form.investorId === inv.id}
                  disabled={isEdit}
                  onClick={() => setForm((f) => ({ ...f, investorId: inv.id }))}
                >
                  {inv.name}
                </PillBtn>
              ))}
            </div>
            {/* Pending context */}
            {pending !== null && form.investorId && !isEdit && (
              <p className="mt-1.5 text-[11px] text-white/30">
                Por cobrar: <span className="text-emerald-400/80">{fmtMxn(pending)}</span>
              </p>
            )}
          </div>

          {/* Monto */}
          <div>
            <label className="ui-field-label">Monto</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="ui-input mt-1.5"
              required
            />
            {/* Overpayment warning */}
            {overage > 0 && (
              <p className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-200/80">
                ⚠ Este retiro supera la utilidad pendiente de {investorName(form.investorId as InvestorId)} por {fmtMxn(overage)}.
              </p>
            )}
          </div>

          {/* Cuenta origen */}
          <div>
            <label className="ui-field-label">Cuenta origen</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {METHOD_OPTIONS.map((opt) => (
                <PillBtn
                  key={opt.value}
                  active={form.method === opt.value}
                  onClick={() => setForm((f) => ({ ...f, method: opt.value }))}
                >
                  {opt.label}
                </PillBtn>
              ))}
            </div>
          </div>

          {/* Fecha */}
          <div>
            <label className="ui-field-label">Fecha del retiro</label>
            <input
              type="date"
              value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
              className="ui-input mt-1.5"
            />
          </div>

          {/* Notas */}
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              rows={2}
              placeholder="Descripción del retiro…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="ui-input mt-1.5 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-white/[0.06] pt-4">
            <button type="button" onClick={handleClose} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {isEdit ? 'Guardar cambios' : 'Registrar retiro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CapitalPage() {
  // ── State ───────────────────────────────────────────────────────────────────
  const [aportes, setAportes] = useState<Aporte[]>(INITIAL_APORTES);
  const [retiros, setRetiros] = useState<Retiro[]>(INITIAL_RETIROS);
  const [activeTab, setActiveTab] = useState<'aportes' | 'retiros'>('aportes');

  const [aporteModal, setAporteModal] = useState<{ open: boolean; editing: Aporte | null }>({
    open: false, editing: null,
  });
  const [retiroModal, setRetiroModal] = useState<{ open: boolean; editing: Retiro | null }>({
    open: false, editing: null,
  });

  const [deletingAporteId, setDeletingAporteId] = useState<string | null>(null);
  const [deletingRetiroId, setDeletingRetiroId] = useState<string | null>(null);

  // ── Computed values ─────────────────────────────────────────────────────────
  const totalCapitalContributed = aportes.reduce((sum, a) => sum + a.amount, 0);
  const totalDistributionsPaid  = retiros.reduce((sum, r) => sum + r.amount, 0);

  const investorBalances = INVESTORS.map((inv) => {
    const capitalContributed = aportes
      .filter((a) => a.investorId === inv.id)
      .reduce((sum, a) => sum + a.amount, 0);
    const profitEntitlement = TOTAL_BUSINESS_PROFIT * inv.sharePercent / 100;
    const distributionsPaid = retiros
      .filter((r) => r.investorId === inv.id)
      .reduce((sum, r) => sum + r.amount, 0);
    const pendingProfit = profitEntitlement - distributionsPaid;
    return { ...inv, capitalContributed, profitEntitlement, distributionsPaid, pendingProfit };
  });

  const totalPendingToPartners = investorBalances.reduce((sum, inv) => sum + inv.pendingProfit, 0);
  const capitalNeto = totalCapitalContributed + TOTAL_BUSINESS_PROFIT - totalDistributionsPaid;

  const pendingByInvestor: Record<InvestorId, number> = {
    cesar: investorBalances.find((i) => i.id === 'cesar')?.pendingProfit ?? 0,
    edgar: investorBalances.find((i) => i.id === 'edgar')?.pendingProfit ?? 0,
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleSaveAporte(data: Omit<Aporte, 'id'>) {
    if (aporteModal.editing) {
      setAportes((prev) => prev.map((a) =>
        a.id === aporteModal.editing!.id ? { ...a, ...data } : a,
      ));
    } else {
      setAportes((prev) => [
        { id: `a${Date.now()}`, ...data },
        ...prev,
      ]);
    }
    setAporteModal({ open: false, editing: null });
  }

  function handleSaveRetiro(data: Omit<Retiro, 'id'>) {
    if (retiroModal.editing) {
      setRetiros((prev) => prev.map((r) =>
        r.id === retiroModal.editing!.id ? { ...r, ...data } : r,
      ));
    } else {
      setRetiros((prev) => [
        { id: `r${Date.now()}`, ...data },
        ...prev,
      ]);
    }
    setRetiroModal({ open: false, editing: null });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="ui-page">
      {/* Header */}
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Capital de socios</h1>
          <p className="ui-subtitle">
            Aportes, retiros y utilidades de los socios del negocio.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="ui-btn-secondary px-4 py-2"
            onClick={() => setAporteModal({ open: true, editing: null })}
          >
            + Registrar aporte
          </button>
          <button
            type="button"
            className="ui-btn-primary px-4 py-2"
            onClick={() => setRetiroModal({ open: true, editing: null })}
          >
            + Registrar retiro
          </button>
        </div>
      </header>

      {/* Summary hero */}
      <CapitalHero
        totalCapitalContributed={totalCapitalContributed}
        totalDistributionsPaid={totalDistributionsPaid}
        totalPendingToPartners={totalPendingToPartners}
        capitalNeto={capitalNeto}
      />

      {/* Investor cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {investorBalances.map((inv) => (
          <InvestorCard key={inv.id} {...inv} />
        ))}
      </div>

      {/* Tabs + Tables */}
      <div className="space-y-4">
        {/* Tab bar */}
        <div className="border-b border-white/10">
          <nav className="-mb-px flex gap-1">
            {([
              { id: 'aportes' as const, label: 'Aportes', count: aportes.length },
              { id: 'retiros' as const, label: 'Retiros', count: retiros.length },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-transparent text-muted hover:text-white'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-2 text-[10px] text-white/25">{tab.count}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Aportes tab */}
        {activeTab === 'aportes' && (
          <AportesTable
            aportes={aportes}
            deletingId={deletingAporteId}
            onEdit={(a) => setAporteModal({ open: true, editing: a })}
            onDeleteRequest={setDeletingAporteId}
            onDeleteConfirm={(id) => {
              setAportes((prev) => prev.filter((a) => a.id !== id));
              setDeletingAporteId(null);
            }}
            onDeleteCancel={() => setDeletingAporteId(null)}
          />
        )}

        {/* Retiros tab */}
        {activeTab === 'retiros' && (
          <RetirosTable
            retiros={retiros}
            deletingId={deletingRetiroId}
            onEdit={(r) => setRetiroModal({ open: true, editing: r })}
            onDeleteRequest={setDeletingRetiroId}
            onDeleteConfirm={(id) => {
              setRetiros((prev) => prev.filter((r) => r.id !== id));
              setDeletingRetiroId(null);
            }}
            onDeleteCancel={() => setDeletingRetiroId(null)}
          />
        )}
      </div>

      {/* Modals */}
      <AporteModal
        open={aporteModal.open}
        editing={aporteModal.editing}
        onClose={() => setAporteModal({ open: false, editing: null })}
        onSave={handleSaveAporte}
      />

      <RetiroModal
        open={retiroModal.open}
        editing={retiroModal.editing}
        pendingByInvestor={pendingByInvestor}
        onClose={() => setRetiroModal({ open: false, editing: null })}
        onSave={handleSaveRetiro}
      />
    </div>
  );
}
