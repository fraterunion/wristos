'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { AssistantMessage } from '@/components/assistant/conversation-message';

export function ConversationPreview({
  intro,
  title,
  fields,
  effects,
  ctaLabel,
  ctaKind,
  ctaHref,
  onConfirm,
  onEdit,
  onCancel,
  busy,
  showAvatar,
  delayMs = 0,
  ctaTone = 'primary',
}: {
  intro: string;
  title?: string;
  fields: Array<{ label: string; value: string }>;
  effects: string[];
  ctaLabel: string;
  ctaKind:
    | 'CONFIRM_SALE'
    | 'CONFIRM_PAYMENT'
    | 'CONFIRM_TRANSFER'
    | 'CONFIRM_CONTRIBUTION'
    | 'CONFIRM_DISTRIBUTION'
    | 'CONFIRM_EXPENSE'
    | 'CONFIRM_REVERSE_EXPENSE'
    | 'CONFIRM_PURCHASE'
    | 'CONFIRM_CLIENT'
    | 'CONFIRM_CLIENT_UPDATE'
    | 'CONFIRM_RECEIVABLE'
    | 'CONFIRM_PAYABLE'
    | 'MANUAL_MODULE';
  ctaHref?: string;
  /** Reserved for future contextual destructive actions (e.g. Revertir gasto). */
  ctaTone?: 'primary' | 'destructive';
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  busy?: boolean;
  showAvatar?: boolean;
  delayMs?: number;
}) {
  const confirmable =
    ctaKind === 'CONFIRM_SALE' ||
    ctaKind === 'CONFIRM_PAYMENT' ||
    ctaKind === 'CONFIRM_TRANSFER' ||
    ctaKind === 'CONFIRM_CONTRIBUTION' ||
    ctaKind === 'CONFIRM_DISTRIBUTION' ||
    ctaKind === 'CONFIRM_EXPENSE' ||
    ctaKind === 'CONFIRM_REVERSE_EXPENSE' ||
    ctaKind === 'CONFIRM_CLIENT' ||
    ctaKind === 'CONFIRM_CLIENT_UPDATE' ||
    ctaKind === 'CONFIRM_PURCHASE' ||
    ctaKind === 'CONFIRM_RECEIVABLE' ||
    ctaKind === 'CONFIRM_PAYABLE';

  const effectiveTone =
    ctaTone === 'destructive' || ctaKind === 'CONFIRM_REVERSE_EXPENSE'
      ? 'destructive'
      : ctaTone;

  const titleField = fields.find((f) => /reloj|concepto|cliente|inversión|cuenta/i.test(f.label));
  const amountField = fields.find((f) => /precio|monto|importe|cantidad/i.test(f.label));
  const otherFields = fields.filter((f) => f !== titleField && f !== amountField);

  return (
    <AssistantMessage showAvatar={showAvatar} delayMs={delayMs}>
      <div className="space-y-4">
        <p className="text-white/90">{intro}</p>
        {fields.length ? (
          <div className="space-y-3 border-l border-white/10 pl-3.5">
            {title ? (
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
                {title}
              </p>
            ) : null}
            {titleField ? (
              <p className="text-[15px] font-medium leading-snug text-white">{titleField.value}</p>
            ) : null}
            {amountField ? (
              <p className="text-[22px] font-semibold tracking-tight text-white">
                {amountField.value}
              </p>
            ) : null}
            {otherFields.length ? (
              <dl className="space-y-2">
                {otherFields.map((field) => (
                  <div key={field.label} className="grid grid-cols-[7.5rem_1fr] gap-3 text-[13px]">
                    <dt className="text-white/40">{field.label}</dt>
                    <dd className="text-right font-medium text-white/85 sm:text-left">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}
        {effects.length ? (
          <ul className="space-y-1">
            {effects.map((effect) => (
              <li key={effect} className="text-[12.5px] leading-5 text-white/45">
                {effect}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {confirmable && onConfirm ? (
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={
                effectiveTone === 'destructive'
                  ? 'inline-flex min-h-10 items-center rounded-full bg-rose-500/90 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50'
                  : 'inline-flex min-h-10 items-center rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black disabled:opacity-50'
              }
            >
              {busy
                ? ctaKind === 'CONFIRM_REVERSE_EXPENSE'
                  ? 'Revirtiendo…'
                  : ctaKind === 'CONFIRM_CLIENT' ||
                  ctaKind === 'CONFIRM_RECEIVABLE' ||
                  ctaKind === 'CONFIRM_PAYABLE'
                  ? 'Creando…'
                  : ctaKind === 'CONFIRM_CLIENT_UPDATE'
                    ? 'Guardando…'
                    : 'Registrando…'
                : ctaLabel}
            </button>
          ) : ctaHref ? (
            <Link
              href={ctaHref}
              className="inline-flex min-h-10 items-center rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black"
            >
              {ctaLabel}
            </Link>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              disabled={busy}
              onClick={onEdit}
              className="min-h-10 rounded-full px-3.5 py-2 text-[13px] font-medium text-white/55 transition hover:text-white/80 disabled:opacity-50"
            >
              Corregir
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="min-h-10 rounded-full px-3.5 py-2 text-[13px] font-medium text-white/35 transition hover:text-white/55 disabled:opacity-50"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </div>
    </AssistantMessage>
  );
}

function receiptLinkLabel(href: string): string {
  if (href.startsWith('/expenses')) return 'Ver gastos';
  if (href.startsWith('/treasury')) return 'Ver Tesorería';
  if (href.startsWith('/capital')) return 'Ver Capital';
  if (href.startsWith('/cuentas')) return 'Ver en Cuentas';
  if (href.startsWith('/inventory')) return 'Ver reloj';
  if (href.startsWith('/crm')) return 'Ver cliente';
  return 'Ver venta';
}

function correctLinkLabel(href: string): string {
  if (href.startsWith('/expenses')) return 'Corregir en Gastos';
  if (href.startsWith('/treasury')) return 'Corregir en Tesorería';
  if (href.startsWith('/capital')) return 'Corregir en Capital';
  if (href.startsWith('/cuentas')) return 'Corregir en Cuentas';
  if (href.startsWith('/inventory')) return 'Corregir en Inventario';
  if (href.startsWith('/crm')) return 'Corregir en CRM';
  return 'Corregir en Ventas';
}

export function ConversationReceipt({
  message,
  lines,
  dealHref,
  correctHref,
  showAvatar,
  delayMs = 0,
}: {
  message: string;
  lines: string[];
  dealHref?: string;
  correctHref?: string;
  showAvatar?: boolean;
  delayMs?: number;
}) {
  return (
    <AssistantMessage showAvatar={showAvatar} delayMs={delayMs}>
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"
            aria-hidden
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="font-medium text-white">{message}</p>
            {lines.length ? (
              <div className="space-y-1 text-[13.5px] leading-5 text-white/65">
                {lines.slice(0, 3).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {dealHref || correctHref ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pl-7">
            {dealHref ? (
              <Link
                href={dealHref}
                className="inline-flex min-h-8 items-center text-[13px] font-medium text-white/45 transition hover:text-white/75"
              >
                {receiptLinkLabel(dealHref)}
              </Link>
            ) : null}
            {correctHref ? (
              <Link
                href={correctHref}
                className="inline-flex min-h-8 items-center text-[13px] font-medium text-white/35 transition hover:text-white/60"
              >
                {correctLinkLabel(correctHref)}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </AssistantMessage>
  );
}
