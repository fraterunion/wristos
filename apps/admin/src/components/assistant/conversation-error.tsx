'use client';

import { RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { AssistantMessage } from '@/components/assistant/conversation-message';

export function ConversationError({
  text,
  detail,
  onRetry,
  manualHref,
  manualLabel,
  showAvatar,
  delayMs = 0,
}: {
  text: string;
  detail?: string;
  onRetry?: () => void;
  manualHref?: string;
  manualLabel?: string;
  showAvatar?: boolean;
  delayMs?: number;
}) {
  return (
    <AssistantMessage tone="error" showAvatar={showAvatar} delayMs={delayMs}>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{text}</p>
            {detail ? <p className="mt-0.5 text-[13px] text-rose-100/85">{detail}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRetry ? (
            <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose-200/25 px-3.5 py-1.5 text-[13px] font-medium text-rose-100">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Reintentar
            </button>
          ) : null}
          {manualHref ? (
            <Link href={manualHref} className="inline-flex min-h-9 items-center rounded-full border border-rose-200/25 px-3.5 py-1.5 text-[13px] font-medium text-rose-100">
              {manualLabel ?? 'Abrir flujo manual'}
            </Link>
          ) : null}
        </div>
      </div>
    </AssistantMessage>
  );
}
