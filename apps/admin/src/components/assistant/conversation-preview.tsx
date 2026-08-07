'use client';

import Link from 'next/link';
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
}: {
  intro: string;
  title?: string;
  fields: Array<{ label: string; value: string }>;
  effects: string[];
  ctaLabel: string;
  ctaKind: 'CONFIRM_SALE' | 'MANUAL_MODULE';
  ctaHref?: string;
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  busy?: boolean;
  showAvatar?: boolean;
  delayMs?: number;
}) {
  return (
    <AssistantMessage showAvatar={showAvatar} delayMs={delayMs}>
      <div className="space-y-3">
        <p className="font-medium text-white">{intro}</p>
        {fields.length ? (
          <div className="space-y-1.5 rounded-xl bg-black/20 p-3">
            {title ? <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">{title}</p> : null}
            {fields.map((field) => (
              <div key={field.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-white/50">{field.label}</span>
                <span className="text-right font-medium text-white">{field.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        {effects.length ? (
          <ul className="space-y-1">
            {effects.map((effect) => (
              <li key={effect} className="text-[12px] leading-5 text-white/55">
                · {effect}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {ctaKind === 'CONFIRM_SALE' && onConfirm ? (
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="inline-flex min-h-9 items-center rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
            >
              {busy ? 'Registrando…' : ctaLabel}
            </button>
          ) : ctaHref ? (
            <Link href={ctaHref} className="inline-flex min-h-9 items-center rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">
              {ctaLabel}
            </Link>
          ) : null}
          {onEdit ? (
            <button type="button" disabled={busy} onClick={onEdit} className="min-h-9 rounded-full border border-white/15 px-4 py-1.5 text-[13px] font-medium text-white/75 disabled:opacity-50">
              Editar
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" disabled={busy} onClick={onCancel} className="min-h-9 rounded-full px-4 py-1.5 text-[13px] font-medium text-white/45 disabled:opacity-50">
              Cancelar
            </button>
          ) : null}
        </div>
      </div>
    </AssistantMessage>
  );
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
        <p className="font-medium text-white">{message}</p>
        {lines.length ? (
          <div className="space-y-1 text-[13px] text-white/80">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {dealHref ? (
            <Link href={dealHref} className="inline-flex min-h-9 items-center rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">
              Ver venta
            </Link>
          ) : null}
          {correctHref ? (
            <Link href={correctHref} className="inline-flex min-h-9 items-center rounded-full border border-white/15 px-4 py-1.5 text-[13px] font-medium text-white/75">
              Corregir en Ventas
            </Link>
          ) : null}
        </div>
      </div>
    </AssistantMessage>
  );
}
