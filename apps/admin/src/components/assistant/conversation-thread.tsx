'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AssistantResponseRenderer } from '@/components/assistant/assistant-response-renderer';
import { AssistantBubble, TimelineSeparator, TypingBubble, UserBubble } from '@/components/assistant/bubbles';
import type { AssistantHistoryItem, JsonValue } from '@/lib/assistant-types';

export function ConversationThread({
  history,
  pending,
  pendingLabel,
  error,
  onRetry,
  selectClient,
  onContinue,
  onRestart,
  onSearchAgain,
  manualHrefFor,
  emptyState,
}: {
  history: AssistantHistoryItem[];
  pending: boolean;
  pendingLabel?: string | null;
  error: string | null;
  onRetry?: () => void;
  selectClient: (id: string, label: string) => void;
  onContinue: (item: AssistantHistoryItem, entities: Record<string, JsonValue>) => void;
  onRestart: (item: AssistantHistoryItem) => void;
  onSearchAgain?: () => void;
  manualHrefFor?: (item: AssistantHistoryItem) => string | undefined;
  emptyState?: React.ReactNode;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, pending, error]);

  const visible = history.filter((item) => !dismissed.has(item.id));
  const chronological = [...visible].reverse();

  if (!chronological.length && !pending && !error) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <section aria-label="Conversación con el asistente" className="space-y-3">
      <TimelineSeparator label="Hoy" />
      {chronological.map((item) => (
        <div key={item.id} className="space-y-2">
          <UserBubble>{item.label}</UserBubble>
          <AssistantResponseRenderer
            intent={item.intent}
            response={item.response}
            onSelectClient={selectClient}
            onContinue={(entities) => onContinue(item, entities)}
            onSearchAgain={onSearchAgain}
            onEdit={() => onRestart(item)}
            onDismiss={() => setDismissed((current) => new Set(current).add(item.id))}
            manualHref={manualHrefFor?.(item)}
            busy={pending}
          />
        </div>
      ))}
      {pending ? (
        <div className="space-y-2">
          {pendingLabel ? <UserBubble>{pendingLabel}</UserBubble> : null}
          <TypingBubble />
        </div>
      ) : null}
      {error ? (
        <AssistantBubble tone="error">
          <div className="space-y-2">
            <p>{error}</p>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose-200/25 px-3.5 py-1.5 text-[13px] font-medium text-rose-100">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Reintentar
              </button>
            ) : null}
          </div>
        </AssistantBubble>
      ) : null}
      <div ref={bottomRef} />
    </section>
  );
}
