'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { addPaymentToSale, type SoldItem } from '@/lib/ventas-api';
import type { VentaBankChannel, VentaPaymentMethod } from '@/types/domain';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHOD_OPTIONS: { value: VentaPaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'BANCOS', label: 'Bancos' },
  { value: 'CESAR', label: 'César' },
];

const BANK_CHANNEL_OPTIONS: { value: VentaBankChannel; label: string; rate: number }[] = [
  { value: 'JOSE', label: 'José', rate: 0.02 },
  { value: 'MAYTE', label: 'Mayte', rate: 0.01 },
];

const BANK_RATES: Record<VentaBankChannel, number> = { JOSE: 0.02, MAYTE: 0.01 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMxn(n: number | string) {
  const v = Number(n);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
  }).format(Number.isFinite(v) ? v : 0);
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// ─── PillBtn ─────────────────────────────────────────────────────────────────

function PillBtn({
  active, disabled = false, onClick, children,
}: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
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

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  sale: SoldItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AddPaymentModal({ sale, open, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<VentaPaymentMethod | ''>('');
  const [bankChannel, setBankChannel] = useState<VentaBankChannel | ''>('');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pre-fill amount with pendingAmount when modal opens
  const defaultAmount = sale ? Number(sale.pendingAmount) : 0;

  function handleOpen() {
    setAmount(defaultAmount > 0 ? String(defaultAmount) : '');
    setMethod('');
    setBankChannel('');
    setPaidAt(todayIso());
    setNotes('');
    setSubmitError(null);
  }

  // Call handleOpen when sale changes (modal re-opens for different sale)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  if (open && !submitting && !amount && sale) {
    handleOpen();
  }

  const amountNum = Number(amount) || 0;
  const isBancos = method === 'BANCOS';
  const commissionRate = isBancos && bankChannel ? BANK_RATES[bankChannel] : 0;
  const bankFeePreview = amountNum * commissionRate;
  const netPreview = amountNum - bankFeePreview;
  const canSubmit = !submitting && amountNum > 0 && !!method && (!isBancos || !!bankChannel);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !sale) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await addPaymentToSale(sale.dealId, {
        amount: amountNum,
        method: method as VentaPaymentMethod,
        paidAt: paidAt || undefined,
        bankChannel: isBancos && bankChannel ? bankChannel : undefined,
        notes: notes.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'No se pudo registrar el pago.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !sale) return null;

  const paidTotal = Number(sale.paidTotal);
  const pendingAmount = Number(sale.pendingAmount);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel/95 shadow-2xl backdrop-blur sm:max-h-[88vh]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-panel/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Agregar pago</h2>
            <p className="mt-0.5 text-xs text-white/40">
              {sale.watch.brand} {sale.watch.model}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/8 hover:text-white transition">
            ✕
          </button>
        </div>

        {/* Context summary */}
        <div className="border-b border-white/[0.06] px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">Total</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-white">{fmtMxn(sale.agreedPrice)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">Pagado</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-emerald-400">{fmtMxn(paidTotal)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.15em] text-white/30">Pendiente</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-rose-400">{fmtMxn(pendingAmount)}</p>
            </div>
          </div>
          <div className="mt-2 text-xs text-white/30">
            Comprador: {sale.buyer.name}
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 px-5 py-5">
          {submitError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {submitError}
            </div>
          )}

          {/* Monto */}
          <div>
            <label className="ui-field-label">Monto del pago</label>
            <input
              type="number" step="0.01" min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="ui-input"
              disabled={submitting}
              required
            />
            {pendingAmount > 0 && (
              <p className="mt-1 text-[11px] text-white/30">
                Pendiente: {fmtMxn(pendingAmount)}
              </p>
            )}
          </div>

          {/* Método */}
          <div>
            <label className="ui-field-label">Método de pago</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {PAYMENT_METHOD_OPTIONS.map((opt) => (
                <PillBtn
                  key={opt.value}
                  active={method === opt.value}
                  disabled={submitting}
                  onClick={() => { setMethod(opt.value); if (opt.value !== 'BANCOS') setBankChannel(''); }}
                >
                  {opt.label}
                </PillBtn>
              ))}
            </div>
          </div>

          {/* Canal bancario */}
          {isBancos && (
            <div className="space-y-3">
              <div>
                <label className="ui-field-label">Canal bancario</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {BANK_CHANNEL_OPTIONS.map((opt) => (
                    <PillBtn
                      key={opt.value}
                      active={bankChannel === opt.value}
                      disabled={submitting}
                      onClick={() => setBankChannel(opt.value)}
                    >
                      {opt.label} <span className="text-xs text-white/30">({(opt.rate * 100).toFixed(0)}%)</span>
                    </PillBtn>
                  ))}
                </div>
              </div>
              {bankChannel && amountNum > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-widest text-white/30">Comisión</p>
                    <p className="mt-1 text-sm font-semibold text-amber-300">
                      {fmtMxn(bankFeePreview)}
                      <span className="ml-1 text-xs font-normal text-white/30">({(commissionRate * 100).toFixed(0)}%)</span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/[0.04] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-widest text-white/30">Neto</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-300">{fmtMxn(netPreview)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fecha */}
          <div>
            <label className="ui-field-label">Fecha del pago</label>
            <input
              type="date" value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="ui-input" disabled={submitting}
            />
          </div>

          {/* Notas */}
          <div>
            <label className="ui-field-label">Notas (opcional)</label>
            <textarea
              rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descripción del pago…"
              className="ui-input resize-none"
              disabled={submitting}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <button type="button" onClick={onClose} disabled={submitting} className="ui-btn-ghost px-4 py-2">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="ui-btn-primary px-5 py-2 disabled:opacity-50"
            >
              {submitting ? 'Registrando…' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
