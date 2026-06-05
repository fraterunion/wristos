'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  createCapitalContribution,
  createCapitalDistribution,
  createCapitalInvestor,
  deleteCapitalContribution,
  deleteCapitalDistribution,
  getCapitalSummary,
  listCapitalContributions,
  listCapitalDistributions,
  updateCapitalContribution,
  updateCapitalDistribution,
  updateCapitalInvestor,
  type CapitalAccount,
  type CapitalContribution,
  type CapitalDistribution,
  type CapitalInvestorBalance,
  type CapitalSummary,
} from '@/lib/capital-api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMxn(value: string | number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtRoiPct(roi: number) {
  return `${new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(roi)}%`;
}

function calcRoi(totalBusinessProfit: string, totalCapitalContributed: string): number | null {
  const contributed = Number(totalCapitalContributed);
  if (contributed <= 0) return null;
  return (Number(totalBusinessProfit) / contributed) * 100;
}

function isoToDateInput(iso: string) {
  return iso.split('T')[0];
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

const ACCOUNT_LABELS: Record<CapitalAccount, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR_ACCOUNT: 'Cuenta César',
};

const ACCOUNT_OPTIONS: Array<{ value: CapitalAccount; label: string }> = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'BANK', label: 'Bancos' },
  { value: 'CESAR_ACCOUNT', label: 'Cuenta César' },
];

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

// ─── InvestorPill ─────────────────────────────────────────────────────────────

function InvestorPill({ name, isPrimary = false }: { name: string; isPrimary?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${
        isPrimary
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-white/15 bg-white/[0.05] text-white/60'
      }`}
    >
      {name}
    </span>
  );
}

// ─── AccountPill ──────────────────────────────────────────────────────────────

function AccountPill({ account }: { account: CapitalAccount }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-[3px] text-[10px] font-medium tracking-wide text-white/50">
      {ACCOUNT_LABELS[account]}
    </span>
  );
}

// ─── CapitalHero ──────────────────────────────────────────────────────────────

function CapitalHero({
  totalCapitalContributed,
  totalBusinessProfit,
  totalDistributionsPaid,
  totalPendingToPartners,
  capitalNeto,
}: {
  totalCapitalContributed: string;
  totalBusinessProfit: string;
  totalDistributionsPaid: string;
  totalPendingToPartners: string;
  capitalNeto: string;
}) {
  const cells = [
    { label: 'Capital aportado',   value: fmtMxn(totalCapitalContributed), tone: 'default' },
    { label: 'Utilidad acumulada', value: fmtMxn(totalBusinessProfit),     tone: 'positive' },
    { label: 'Retirado a socios',  value: fmtMxn(totalDistributionsPaid),  tone: 'default' },
    {
      label: 'Por pagar a socios',
      value: fmtMxn(totalPendingToPartners),
      tone: Number(totalPendingToPartners) > 0 ? 'negative' : 'default',
    },
    { label: 'Capital neto', value: fmtMxn(capitalNeto), tone: 'default' },
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

// ─── FinancialInsightStrip ────────────────────────────────────────────────────

function FinancialInsightStrip({
  totalBusinessProfit,
  totalDistributionsPaid,
  totalPendingToPartners,
  totalCapitalContributed,
}: Pick<
  CapitalSummary,
  | 'totalBusinessProfit'
  | 'totalDistributionsPaid'
  | 'totalPendingToPartners'
  | 'totalCapitalContributed'
>) {
  const profit = Number(totalBusinessProfit);
  const pending = Number(totalPendingToPartners);
  const roi = calcRoi(totalBusinessProfit, totalCapitalContributed);

  const toneClass = (tone: 'neutral' | 'positive' | 'warning' | 'negative') =>
    tone === 'positive' ? 'text-emerald-400' :
    tone === 'warning' ? 'text-amber-400' :
    tone === 'negative' ? 'text-rose-400' :
    'text-white/80';

  const metrics = [
    {
      label: 'Utilidad acumulada',
      value: fmtMxn(totalBusinessProfit),
      tone: profit > 0 ? ('positive' as const) : ('neutral' as const),
    },
    {
      label: 'Distribuido a socios',
      value: fmtMxn(totalDistributionsPaid),
      tone: 'neutral' as const,
    },
    {
      label: 'Pendiente por distribuir',
      value: fmtMxn(totalPendingToPartners),
      tone: pending > 0 ? ('warning' as const) : ('neutral' as const),
    },
    {
      label: 'Rentabilidad',
      value: roi !== null ? fmtRoiPct(roi) : '—',
      tone:
        roi === null ? ('neutral' as const) :
        roi > 0 ? ('positive' as const) :
        roi < 0 ? ('negative' as const) :
        ('neutral' as const),
    },
  ];

  return (
    <div className="flex flex-wrap items-stretch divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.07] bg-black/30 sm:flex-nowrap sm:divide-x sm:divide-y-0">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="flex min-w-0 flex-1 basis-1/2 flex-col justify-center px-4 py-3 sm:basis-0 md:px-5"
        >
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
            {metric.label}
          </p>
          <p
            className={`mt-1 text-base font-semibold tabular-nums leading-none md:text-lg ${toneClass(metric.tone)}`}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── InvestorCard ─────────────────────────────────────────────────────────────

function InvestorCard({
  investor,
  isPrimary,
  onClick,
}: {
  investor: CapitalInvestorBalance;
  isPrimary: boolean;
  onClick?: () => void;
}) {
  const rows = [
    { label: 'Aportado',          value: fmtMxn(investor.capitalContributed) },
    { label: 'Utilidad asignada', value: fmtMxn(investor.profitEntitlement) },
    { label: 'Retirado',          value: fmtMxn(investor.distributionsPaid) },
  ];
  const pending = Number(investor.pendingProfit);

  return (
    <article
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/95 ${
        onClick ? 'cursor-pointer transition hover:border-white/20' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
              isPrimary
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-white/15 bg-white/[0.06] text-white/60'
            }`}
          >
            {investor.name[0]}
          </div>
          <div>
            <p className="text-base font-semibold text-white">{investor.name}</p>
            <p className="text-[11px] text-white/35">Socio · {investor.ownershipPercent}%</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white/40">
          {investor.ownershipPercent}%
        </span>
      </div>
      <div className="space-y-0 divide-y divide-white/[0.04]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-white/45">{row.label}</span>
            <span className="text-sm font-semibold tabular-nums text-white">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/20 px-5 py-4">
        <span className="text-sm font-medium text-white/60">Por cobrar</span>
        <span
          className={`text-xl font-semibold tabular-nums ${
            pending > 0 ? 'text-emerald-400' : pending < 0 ? 'text-rose-400' : 'text-white/30'
          }`}
        >
          {fmtMxn(investor.pendingProfit)}
        </span>
      </div>
    </article>
  );
}

// ─── InvestorDrawer ───────────────────────────────────────────────────────────

function InvestorDrawer({
  investor,
  primaryInvestorId,
  contributions,
  distributions,
  onClose,
  onAporte,
  onRetiro,
  onConfigure,
}: {
  investor: CapitalInvestorBalance | null;
  primaryInvestorId: string | undefined;
  contributions: CapitalContribution[];
  distributions: CapitalDistribution[];
  onClose: () => void;
  onAporte: (investorId: string) => void;
  onRetiro: (investorId: string) => void;
  onConfigure: () => void;
}) {
  useEffect(() => {
    if (!investor) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [investor, onClose]);

  if (!investor) return null;

  const isPrimary = investor.id === primaryInvestorId;
  const pending = Number(investor.pendingProfit);
  const investorAportes = contributions
    .filter((c) => c.investorId === investor.id)
    .sort((a, b) => b.contributedAt.localeCompare(a.contributedAt));
  const investorRetiros = distributions
    .filter((d) => d.investorId === investor.id)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const metrics = [
    { label: 'Aportado', value: fmtMxn(investor.capitalContributed), tone: 'neutral' as const },
    { label: 'Utilidad asignada', value: fmtMxn(investor.profitEntitlement), tone: 'neutral' as const },
    { label: 'Retirado', value: fmtMxn(investor.distributionsPaid), tone: 'neutral' as const },
    {
      label: 'Por cobrar',
      value: fmtMxn(investor.pendingProfit),
      tone:
        pending > 0 ? ('warning' as const) :
        pending < 0 ? ('negative' as const) :
        ('neutral' as const),
    },
  ];

  const toneClass = (tone: 'neutral' | 'warning' | 'negative') =>
    tone === 'warning' ? 'text-amber-400' :
    tone === 'negative' ? 'text-rose-400' :
    'text-white';

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
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${
                isPrimary
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/15 bg-white/[0.06] text-white/60'
              }`}
            >
              {investor.name[0]}
            </div>
            <div>
              <p className="text-base font-semibold text-white">{investor.name}</p>
              <p className="text-[11px] text-white/35">Socio · {investor.ownershipPercent}%</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/8 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-white/[0.06] border-b border-white/[0.06]">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm text-white/45">{metric.label}</span>
                <span className={`text-sm font-semibold tabular-nums ${toneClass(metric.tone)}`}>
                  {metric.value}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-5 py-4">
            <button
              type="button"
              onClick={() => onAporte(investor.id)}
              className="ui-btn-secondary min-w-0 flex-1 px-3 py-2 text-sm"
            >
              + Aporte
            </button>
            <button
              type="button"
              onClick={() => onRetiro(investor.id)}
              className="ui-btn-primary min-w-0 flex-1 px-3 py-2 text-sm"
            >
              + Retiro
            </button>
            <button
              type="button"
              onClick={onConfigure}
              className="ui-btn-ghost min-w-0 flex-1 px-3 py-2 text-sm"
            >
              Configurar
            </button>
          </div>

          <section className="px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Aportes
            </p>
            {investorAportes.length === 0 ? (
              <p className="mt-3 text-sm text-white/30">Sin aportes.</p>
            ) : (
              <ul className="mt-3 space-y-0 divide-y divide-white/[0.04]">
                {investorAportes.map((item) => (
                  <li key={item.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs tabular-nums text-white/35">{fmtDate(item.contributedAt)}</p>
                        {item.notes ? (
                          <p className="mt-1 truncate text-sm text-white/40">{item.notes}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-white">
                          {fmtMxn(item.amount)}
                        </p>
                        <div className="mt-1.5 flex justify-end">
                          <AccountPill account={item.account} />
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-white/[0.06] px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Retiros
            </p>
            {investorRetiros.length === 0 ? (
              <p className="mt-3 text-sm text-white/30">Sin retiros.</p>
            ) : (
              <ul className="mt-3 space-y-0 divide-y divide-white/[0.04]">
                {investorRetiros.map((item) => (
                  <li key={item.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs tabular-nums text-white/35">{fmtDate(item.paidAt)}</p>
                        {item.notes ? (
                          <p className="mt-1 truncate text-sm text-white/40">{item.notes}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-white">
                          {fmtMxn(item.amount)}
                        </p>
                        <div className="mt-1.5 flex justify-end">
                          <AccountPill account={item.account} />
                        </div>
                      </div>
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

// ─── AportesTable ─────────────────────────────────────────────────────────────

function AportesTable({
  contributions,
  primaryInvestorId,
  deletingId,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  contributions: CapitalContribution[];
  primaryInvestorId: string | undefined;
  deletingId: string | null;
  onEdit: (c: CapitalContribution) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (contributions.length === 0) {
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
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-panel">
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
            {contributions.map((row) => (
              <tr key={row.id} className="group transition-colors hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-4 py-3.5 text-xs tabular-nums text-white/35">
                  {fmtDate(row.contributedAt)}
                </td>
                <td className="px-4 py-3.5">
                  <InvestorPill
                    name={row.investorName}
                    isPrimary={row.investorId === primaryInvestorId}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                  {fmtMxn(row.amount)}
                </td>
                <td className="px-4 py-3.5">
                  <AccountPill account={row.account} />
                </td>
                <td className="max-w-[180px] truncate px-4 py-3.5 text-sm text-white/35">
                  {row.notes ?? <span className="text-white/20">—</span>}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {deletingId === row.id ? (
                    <span className="flex items-center justify-end gap-2 text-xs">
                      <span className="text-white/40">¿Eliminar?</span>
                      <button
                        type="button"
                        onClick={() => onDeleteConfirm(row.id)}
                        className="font-medium text-rose-400 transition hover:text-rose-300"
                      >
                        Sí
                      </button>
                      <button
                        type="button"
                        onClick={onDeleteCancel}
                        className="text-white/30 transition hover:text-white/60"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="rounded px-2 py-1 text-xs text-white/40 transition hover:bg-white/8 hover:text-white"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(row.id)}
                        className="rounded px-2 py-1 text-xs text-rose-400/70 transition hover:bg-rose-400/10 hover:text-rose-300"
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

// ─── RetirosTable ─────────────────────────────────────────────────────────────

function RetirosTable({
  distributions,
  primaryInvestorId,
  deletingId,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  distributions: CapitalDistribution[];
  primaryInvestorId: string | undefined;
  deletingId: string | null;
  onEdit: (d: CapitalDistribution) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (distributions.length === 0) {
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
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-panel">
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
            {distributions.map((row) => (
              <tr key={row.id} className="group transition-colors hover:bg-white/[0.02]">
                <td className="whitespace-nowrap px-4 py-3.5 text-xs tabular-nums text-white/35">
                  {fmtDate(row.paidAt)}
                </td>
                <td className="px-4 py-3.5">
                  <InvestorPill
                    name={row.investorName}
                    isPrimary={row.investorId === primaryInvestorId}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                  {fmtMxn(row.amount)}
                </td>
                <td className="px-4 py-3.5">
                  <AccountPill account={row.account} />
                </td>
                <td className="max-w-[180px] truncate px-4 py-3.5 text-sm text-white/35">
                  {row.notes ?? <span className="text-white/20">—</span>}
                </td>
                <td className="px-4 py-3.5 text-right">
                  {deletingId === row.id ? (
                    <span className="flex items-center justify-end gap-2 text-xs">
                      <span className="text-white/40">¿Eliminar?</span>
                      <button
                        type="button"
                        onClick={() => onDeleteConfirm(row.id)}
                        className="font-medium text-rose-400 transition hover:text-rose-300"
                      >
                        Sí
                      </button>
                      <button
                        type="button"
                        onClick={onDeleteCancel}
                        className="text-white/30 transition hover:text-white/60"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="rounded px-2 py-1 text-xs text-white/40 transition hover:bg-white/8 hover:text-white"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(row.id)}
                        className="rounded px-2 py-1 text-xs text-rose-400/70 transition hover:bg-rose-400/10 hover:text-rose-300"
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

// ─── InvestorSetupModal ───────────────────────────────────────────────────────

type SetupForm = { name: string; ownershipPercent: string; notes: string };
const EMPTY_SETUP: SetupForm = { name: '', ownershipPercent: '', notes: '' };

function InvestorSetupModal({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing?: CapitalInvestorBalance | null;
  onClose: () => void;
  onSave: (data: SetupForm) => Promise<void>;
}) {
  const [form, setForm] = useState<SetupForm>(EMPTY_SETUP);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEdit = editing != null;

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_SETUP);
      setError(null);
      return;
    }
    if (editing) {
      setForm({
        name: editing.name,
        ownershipPercent: editing.ownershipPercent,
        notes: '',
      });
    } else {
      setForm(EMPTY_SETUP);
    }
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Ingresa el nombre del socio.'); return; }
    const pct = Number(form.ownershipPercent);
    if (!form.ownershipPercent || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError('El porcentaje debe ser un número entre 0 y 100.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateCapitalInvestor(editing.id, {
          name: form.name.trim(),
          ownershipPercent: pct,
          notes: form.notes.trim() || undefined,
        });
      }
      await onSave(form);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : isEdit
            ? 'Error guardando socio.'
            : 'Error creando socio.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {isEdit ? 'Editar socio' : 'Configurar socio'}
            </h2>
            {!isEdit ? (
              <p className="mt-0.5 text-xs text-white/40">Agrega un socio del negocio.</p>
            ) : null}
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
          <div>
            <label className="ui-field-label">Nombre</label>
            <input
              type="text"
              placeholder="Ej: César"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="ui-input mt-1.5"
              autoFocus
            />
          </div>
          <div>
            <label className="ui-field-label">Porcentaje de utilidad (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="Ej: 75"
              value={form.ownershipPercent}
              onChange={(e) => setForm((f) => ({ ...f, ownershipPercent: e.target.value }))}
              className="ui-input mt-1.5"
            />
          </div>
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              rows={2}
              placeholder="Descripción…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="ui-input mt-1.5 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 border-t border-white/[0.06] pt-4">
            <button type="button" onClick={onClose} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim() || !form.ownershipPercent}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar socio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── AporteModal ──────────────────────────────────────────────────────────────

type AporteForm = {
  investorId: string;
  amount: string;
  account: CapitalAccount | '';
  contributedAt: string;
  notes: string;
};

const EMPTY_APORTE: AporteForm = {
  investorId: '',
  amount: '',
  account: '',
  contributedAt: todayIso(),
  notes: '',
};

function AporteModal({
  open,
  editing,
  defaultInvestorId,
  investors,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: CapitalContribution | null;
  defaultInvestorId?: string;
  investors: CapitalInvestorBalance[];
  onClose: () => void;
  onSave: (form: AporteForm) => Promise<void>;
}) {
  const [form, setForm] = useState<AporteForm>(EMPTY_APORTE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_APORTE);
      setError(null);
      return;
    }
    if (editing) {
      setForm({
        investorId: editing.investorId,
        amount: editing.amount,
        account: editing.account,
        contributedAt: isoToDateInput(editing.contributedAt),
        notes: editing.notes ?? '',
      });
    } else if (defaultInvestorId) {
      setForm({ ...EMPTY_APORTE, investorId: defaultInvestorId });
    } else {
      setForm(EMPTY_APORTE);
    }
  }, [open, editing, defaultInvestorId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.investorId) { setError('Selecciona un socio.'); return; }
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    if (!form.account) { setError('Selecciona una cuenta.'); return; }
    if (!form.contributedAt) { setError('Selecciona una fecha.'); return; }
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
  const canSubmit =
    !!form.investorId && Number(form.amount) > 0 && !!form.account && !!form.contributedAt;

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
          <div>
            <label className="ui-field-label">Socio</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {investors
                .filter((i) => i.isActive || form.investorId === i.id)
                .map((inv) => (
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
          <div>
            <label className="ui-field-label">Cuenta destino</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ACCOUNT_OPTIONS.map((opt) => (
                <PillBtn
                  key={opt.value}
                  active={form.account === opt.value}
                  onClick={() => setForm((f) => ({ ...f, account: opt.value }))}
                >
                  {opt.label}
                </PillBtn>
              ))}
            </div>
          </div>
          <div>
            <label className="ui-field-label">Fecha</label>
            <input
              type="date"
              value={form.contributedAt}
              onChange={(e) => setForm((f) => ({ ...f, contributedAt: e.target.value }))}
              className="ui-input mt-1.5"
            />
          </div>
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
            <button type="button" onClick={onClose} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Registrar aporte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── RetiroModal ──────────────────────────────────────────────────────────────

type RetiroForm = {
  investorId: string;
  amount: string;
  account: CapitalAccount | '';
  paidAt: string;
  notes: string;
};

const EMPTY_RETIRO: RetiroForm = {
  investorId: '',
  amount: '',
  account: '',
  paidAt: todayIso(),
  notes: '',
};

function RetiroModal({
  open,
  editing,
  defaultInvestorId,
  investors,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: CapitalDistribution | null;
  defaultInvestorId?: string;
  investors: CapitalInvestorBalance[];
  onClose: () => void;
  onSave: (form: RetiroForm) => Promise<void>;
}) {
  const [form, setForm] = useState<RetiroForm>(EMPTY_RETIRO);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_RETIRO);
      setError(null);
      return;
    }
    if (editing) {
      setForm({
        investorId: editing.investorId,
        amount: editing.amount,
        account: editing.account,
        paidAt: isoToDateInput(editing.paidAt),
        notes: editing.notes ?? '',
      });
    } else if (defaultInvestorId) {
      setForm({ ...EMPTY_RETIRO, investorId: defaultInvestorId });
    } else {
      setForm(EMPTY_RETIRO);
    }
  }, [open, editing, defaultInvestorId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.investorId) { setError('Selecciona un socio.'); return; }
    const amount = Number(form.amount);
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
      setError('Ingresa un monto válido mayor a 0.');
      return;
    }
    if (!form.account) { setError('Selecciona una cuenta.'); return; }
    if (!form.paidAt) { setError('Selecciona una fecha.'); return; }
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
  const amountNum = Number(form.amount) || 0;
  const selectedInvestor = investors.find((i) => i.id === form.investorId);
  const pending = selectedInvestor ? Number(selectedInvestor.pendingProfit) : null;
  const overage = pending !== null && amountNum > pending ? amountNum - pending : 0;
  const canSubmit = !!form.investorId && amountNum > 0 && !!form.account && !!form.paidAt;

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
          <div>
            <label className="ui-field-label">Socio</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {investors
                .filter((i) => i.isActive || form.investorId === i.id)
                .map((inv) => (
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
            {pending !== null && form.investorId && !isEdit && (
              <p className="mt-1.5 text-[11px] text-white/30">
                Por cobrar:{' '}
                <span className="text-emerald-400/80">{fmtMxn(String(pending))}</span>
              </p>
            )}
            {isEdit && (
              <p className="mt-1.5 text-[11px] text-white/25">
                El socio no se puede cambiar. Elimina y crea un nuevo retiro si es necesario.
              </p>
            )}
          </div>
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
            {overage > 0 && (
              <p className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-200/80">
                ⚠ Este retiro supera la utilidad pendiente de {selectedInvestor?.name ?? ''} por{' '}
                {fmtMxn(overage)}.
              </p>
            )}
          </div>
          <div>
            <label className="ui-field-label">Cuenta origen</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ACCOUNT_OPTIONS.map((opt) => (
                <PillBtn
                  key={opt.value}
                  active={form.account === opt.value}
                  onClick={() => setForm((f) => ({ ...f, account: opt.value }))}
                >
                  {opt.label}
                </PillBtn>
              ))}
            </div>
          </div>
          <div>
            <label className="ui-field-label">Fecha del retiro</label>
            <input
              type="date"
              value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
              className="ui-input mt-1.5"
            />
          </div>
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
            <button type="button" onClick={onClose} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Registrar retiro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CapitalPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CapitalSummary | null>(null);
  const [contributions, setContributions] = useState<CapitalContribution[]>([]);
  const [distributions, setDistributions] = useState<CapitalDistribution[]>([]);
  const [activeTab, setActiveTab] = useState<'aportes' | 'retiros'>('aportes');

  const [aporteModal, setAporteModal] = useState<{
    open: boolean;
    editing: CapitalContribution | null;
    defaultInvestorId?: string;
  }>({ open: false, editing: null });
  const [retiroModal, setRetiroModal] = useState<{
    open: boolean;
    editing: CapitalDistribution | null;
    defaultInvestorId?: string;
  }>({ open: false, editing: null });
  const [setupModal, setSetupModal] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState<CapitalInvestorBalance | null>(null);
  const [selectedInvestor, setSelectedInvestor] = useState<CapitalInvestorBalance | null>(null);
  const [deletingAporteId, setDeletingAporteId] = useState<string | null>(null);
  const [deletingRetiroId, setDeletingRetiroId] = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, contribData, distroData] = await Promise.all([
        getCapitalSummary(),
        listCapitalContributions(),
        listCapitalDistributions(),
      ]);
      setSummary(summaryData);
      setContributions(contribData);
      setDistributions(distroData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error cargando datos de capital.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const investors = summary?.investors ?? [];
  const primaryInvestorId = investors[0]?.id;
  const activeOwnershipSum = investors
    .filter((i) => i.isActive)
    .reduce((sum, i) => sum + Number(i.ownershipPercent), 0);
  const showOwnershipWarning =
    investors.length > 0 && Math.abs(activeOwnershipSum - 100) > 0.01;

  // ── Mutation handlers ────────────────────────────────────────────────────────

  async function handleSaveAporte(form: AporteForm) {
    if (aporteModal.editing) {
      await updateCapitalContribution(aporteModal.editing.id, {
        amount: Number(form.amount),
        account: form.account as CapitalAccount,
        contributedAt: form.contributedAt,
        notes: form.notes.trim() || undefined,
      });
    } else {
      await createCapitalContribution({
        investorId: form.investorId,
        amount: Number(form.amount),
        account: form.account as CapitalAccount,
        contributedAt: form.contributedAt,
        notes: form.notes.trim() || undefined,
      });
    }
    setAporteModal({ open: false, editing: null });
    await loadData();
  }

  async function handleSaveRetiro(form: RetiroForm) {
    if (retiroModal.editing) {
      await updateCapitalDistribution(retiroModal.editing.id, {
        amount: Number(form.amount),
        account: form.account as CapitalAccount,
        paidAt: form.paidAt,
        notes: form.notes.trim() || undefined,
      });
    } else {
      await createCapitalDistribution({
        investorId: form.investorId,
        amount: Number(form.amount),
        account: form.account as CapitalAccount,
        paidAt: form.paidAt,
        notes: form.notes.trim() || undefined,
      });
    }
    setRetiroModal({ open: false, editing: null });
    await loadData();
  }

  async function handleDeleteAporte(id: string) {
    try {
      await deleteCapitalContribution(id);
      setDeletingAporteId(null);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error eliminando aporte.');
      setDeletingAporteId(null);
    }
  }

  async function handleDeleteRetiro(id: string) {
    try {
      await deleteCapitalDistribution(id);
      setDeletingRetiroId(null);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error eliminando retiro.');
      setDeletingRetiroId(null);
    }
  }

  function closeSetupModal() {
    setSetupModal(false);
    setEditingInvestor(null);
  }

  async function handleSaveInvestor(form: SetupForm) {
    if (!editingInvestor) {
      await createCapitalInvestor({
        name: form.name.trim(),
        ownershipPercent: Number(form.ownershipPercent),
        notes: form.notes.trim() || undefined,
      });
    }
    setSetupModal(false);
    setEditingInvestor(null);
    await loadData();
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  if (loading && !summary) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Capital de socios</h1>
            <p className="ui-subtitle">Aportes, retiros y utilidades de los socios del negocio.</p>
          </div>
        </header>
        <div className="flex items-center justify-center py-32">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />
        </div>
      </div>
    );
  }

  // ── Fatal error state ────────────────────────────────────────────────────────

  if (error && !summary) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Capital de socios</h1>
            <p className="ui-subtitle">Aportes, retiros y utilidades de los socios del negocio.</p>
          </div>
        </header>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-5 py-10 text-center">
          <p className="text-sm text-rose-300">{error}</p>
          <button
            type="button"
            onClick={loadData}
            className="mt-4 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:border-white/20 hover:text-white"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // ── First-run empty state ────────────────────────────────────────────────────

  if (!loading && summary && investors.length === 0) {
    return (
      <div className="ui-page">
        <header className="ui-page-header">
          <div>
            <h1 className="ui-title">Capital de socios</h1>
            <p className="ui-subtitle">Aportes, retiros y utilidades de los socios del negocio.</p>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-panel/50 px-6 py-24 text-center">
          <p className="text-lg font-semibold text-white/60">Sin socios configurados</p>
          <p className="mt-2 max-w-sm text-sm text-white/35">
            Configura los socios del negocio para empezar a registrar aportes, retiros y calcular
            utilidades.
          </p>
          <button
            type="button"
            onClick={() => setSetupModal(true)}
            className="ui-btn-primary mt-6 px-5 py-2"
          >
            Configurar socios
          </button>
        </div>
        <InvestorSetupModal
          open={setupModal}
          editing={editingInvestor}
          onClose={closeSetupModal}
          onSave={handleSaveInvestor}
        />
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────

  const s = summary!;

  return (
    <div className="ui-page">
      {/* Header */}
      <header className="ui-page-header">
        <div>
          <h1 className="ui-title">Capital de socios</h1>
          <p className="ui-subtitle">Aportes, retiros y utilidades de los socios del negocio.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="ui-btn-ghost px-3 py-2 text-sm"
            onClick={() => {
              setEditingInvestor(null);
              setSetupModal(true);
            }}
          >
            + Socio
          </button>
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

      {/* Inline error banner (mutation errors) */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="text-sm text-rose-200">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-4 text-sm text-rose-300 transition hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Ownership sum warning */}
      {showOwnershipWarning && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <p className="text-[12px] text-amber-200/80">
            Los porcentajes activos suman {activeOwnershipSum.toFixed(2)}%. Para asignar el 100%
            de las utilidades deben sumar 100%.
          </p>
        </div>
      )}

      {/* Summary hero */}
      <CapitalHero
        totalCapitalContributed={s.totalCapitalContributed}
        totalBusinessProfit={s.totalBusinessProfit}
        totalDistributionsPaid={s.totalDistributionsPaid}
        totalPendingToPartners={s.totalPendingToPartners}
        capitalNeto={s.capitalNeto}
      />

      <FinancialInsightStrip
        totalBusinessProfit={s.totalBusinessProfit}
        totalDistributionsPaid={s.totalDistributionsPaid}
        totalPendingToPartners={s.totalPendingToPartners}
        totalCapitalContributed={s.totalCapitalContributed}
      />

      {/* Investor cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {investors.map((inv, idx) => (
          <InvestorCard
            key={inv.id}
            investor={inv}
            isPrimary={idx === 0}
            onClick={() => setSelectedInvestor(inv)}
          />
        ))}
      </div>

      <InvestorDrawer
        investor={selectedInvestor}
        primaryInvestorId={primaryInvestorId}
        contributions={contributions}
        distributions={distributions}
        onClose={() => setSelectedInvestor(null)}
        onAporte={(investorId) => {
          setSelectedInvestor(null);
          setAporteModal({ open: true, editing: null, defaultInvestorId: investorId });
        }}
        onRetiro={(investorId) => {
          setSelectedInvestor(null);
          setRetiroModal({ open: true, editing: null, defaultInvestorId: investorId });
        }}
        onConfigure={() => {
          if (!selectedInvestor) return;
          const investor = selectedInvestor;
          setSelectedInvestor(null);
          setEditingInvestor(investor);
          setSetupModal(true);
        }}
      />

      {/* Tabs + Tables */}
      <div className="space-y-4">
        <div className="border-b border-white/10">
          <nav className="-mb-px flex gap-1">
            {(
              [
                { id: 'aportes' as const, label: 'Aportes', count: contributions.length },
                { id: 'retiros' as const, label: 'Retiros', count: distributions.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
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

        {activeTab === 'aportes' && (
          <AportesTable
            contributions={contributions}
            primaryInvestorId={primaryInvestorId}
            deletingId={deletingAporteId}
            onEdit={(c) => setAporteModal({ open: true, editing: c })}
            onDeleteRequest={setDeletingAporteId}
            onDeleteConfirm={handleDeleteAporte}
            onDeleteCancel={() => setDeletingAporteId(null)}
          />
        )}

        {activeTab === 'retiros' && (
          <RetirosTable
            distributions={distributions}
            primaryInvestorId={primaryInvestorId}
            deletingId={deletingRetiroId}
            onEdit={(d) => setRetiroModal({ open: true, editing: d })}
            onDeleteRequest={setDeletingRetiroId}
            onDeleteConfirm={handleDeleteRetiro}
            onDeleteCancel={() => setDeletingRetiroId(null)}
          />
        )}
      </div>

      {/* Modals */}
      <AporteModal
        open={aporteModal.open}
        editing={aporteModal.editing}
        defaultInvestorId={aporteModal.defaultInvestorId}
        investors={investors}
        onClose={() => setAporteModal({ open: false, editing: null })}
        onSave={handleSaveAporte}
      />

      <RetiroModal
        open={retiroModal.open}
        editing={retiroModal.editing}
        defaultInvestorId={retiroModal.defaultInvestorId}
        investors={investors}
        onClose={() => setRetiroModal({ open: false, editing: null })}
        onSave={handleSaveRetiro}
      />

      <InvestorSetupModal
        open={setupModal}
        editing={editingInvestor}
        onClose={closeSetupModal}
        onSave={handleSaveInvestor}
      />
    </div>
  );
}
