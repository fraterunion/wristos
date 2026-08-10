'use client';

import { ReactNode } from 'react';

export function TimelineSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-white/[0.04]" />
      <span className="text-[10px] font-medium tracking-wide text-white/22">{label}</span>
      <span className="h-px flex-1 bg-white/[0.04]" />
    </div>
  );
}

export function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="ui-msg-in flex justify-end">
      <div className="max-w-[min(85%,28rem)] rounded-[1.35rem] rounded-br-md bg-white/[0.92] px-3.5 py-2.5 text-[14px] leading-5 text-black">
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
    <div
      className="ui-msg-in flex items-start gap-2.5"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <span
        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
          showAvatar ? '' : 'invisible'
        } ${tone === 'error' ? 'bg-rose-400/15 text-rose-200' : 'bg-emerald-400/12 text-emerald-200'}`}
        aria-hidden
      >
        W
      </span>
      <div
        className={`max-w-[min(92%,36rem)] text-[14.5px] leading-6 ${
          tone === 'error'
            ? 'rounded-2xl rounded-tl-md bg-rose-500/[0.07] px-3.5 py-2.5 text-rose-100'
            : 'pt-0.5 text-white/88'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
