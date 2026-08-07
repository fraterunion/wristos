'use client';

import Link from 'next/link';
import { ReactNode } from 'react';

// Presentation-only building blocks for the conversational assistant surface.
// None of these know about intents, entities, or the network — they only
// arrange already-resolved content into a chat-like shape.

export function TimelineSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-white/[0.06]" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">{label}</span>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ui-msg-in flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-[13.5px] leading-5 text-black sm:max-w-[70%]">
        {children}
      </div>
    </div>
  );
}

export function AssistantBubble({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'error' }) {
  return (
    <div className="ui-msg-in flex items-start gap-2">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          tone === 'error' ? 'bg-rose-400/15 text-rose-200' : 'bg-emerald-400/15 text-emerald-200'
        }`}
        aria-hidden
      >
        W
      </span>
      <div
        className={`max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13.5px] leading-5 sm:max-w-[75%] ${
          tone === 'error' ? 'bg-rose-500/[0.08] text-rose-100' : 'bg-panel text-white/85'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="ui-msg-in flex items-center gap-2" role="status" aria-label="El asistente está escribiendo">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[10px] font-semibold text-emerald-200" aria-hidden>W</span>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-panel px-3.5 py-3">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChoiceBubble({
  options,
  onSelect,
  disabled,
}: {
  options: Array<{ id: string; label: string }>;
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}) {
  if (!options.length) return null;
  return (
    <div className="ui-msg-in flex flex-wrap gap-2 pl-8">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option.id, option.label)}
          className="min-h-9 rounded-full border border-emerald-300/25 bg-emerald-400/[0.07] px-3.5 py-1.5 text-[13px] font-medium text-emerald-100 transition hover:bg-emerald-400/[0.14] disabled:opacity-50"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function QuestionBubble({ question, children }: { question: string; children?: ReactNode }) {
  return (
    <AssistantBubble>
      <div className="space-y-3">
        <p>{question}</p>
        {children}
      </div>
    </AssistantBubble>
  );
}

export function PreviewBubble({
  intro,
  summary,
  confirmHref,
  onConfirm,
  onEdit,
  onCancel,
  busy,
  children,
}: {
  intro: string;
  summary: ReactNode;
  confirmHref?: string;
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <AssistantBubble>
      <div className="space-y-3">
        <p className="font-medium text-white">{intro}</p>
        <div className="rounded-xl bg-black/20 p-3">{summary}</div>
        {children}
        <div className="flex flex-wrap gap-2 pt-1">
          {confirmHref ? (
            <Link href={confirmHref} className="inline-flex min-h-9 items-center rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black">
              Confirmar
            </Link>
          ) : onConfirm ? (
            <button type="button" disabled={busy} onClick={onConfirm} className="min-h-9 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50">
              Confirmar
            </button>
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
    </AssistantBubble>
  );
}

export function ReceiptBubble({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <AssistantBubble>
      <div className="space-y-2">
        <p className="font-medium text-white">{title}</p>
        {children}
      </div>
    </AssistantBubble>
  );
}
