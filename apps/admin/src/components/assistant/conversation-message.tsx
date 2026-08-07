'use client';

import { ReactNode } from 'react';

// Presentation-only message shells. They know nothing about intents,
// entities, or the network — only how to lay out already-resolved content
// as a chat message.

export function TimelineSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-white/[0.06]" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">{label}</span>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

export function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="ui-msg-in flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-[13.5px] leading-5 text-black sm:max-w-[65%]">
        {children}
      </div>
    </div>
  );
}

export function AssistantMessage({
  children,
  tone = 'neutral',
  showAvatar = true,
  delayMs = 0,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'error';
  showAvatar?: boolean;
  delayMs?: number;
}) {
  return (
    <div className="ui-msg-in flex items-start gap-2" style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}>
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          showAvatar ? '' : 'invisible'
        } ${tone === 'error' ? 'bg-rose-400/15 text-rose-200' : 'bg-emerald-400/15 text-emerald-200'}`}
        aria-hidden
      >
        W
      </span>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-5 sm:max-w-[72%] ${
          showAvatar ? 'rounded-tl-md' : ''
        } ${tone === 'error' ? 'bg-rose-500/[0.08] text-rose-100' : 'bg-panel text-white/85'}`}
      >
        {children}
      </div>
    </div>
  );
}
