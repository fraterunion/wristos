'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AssistantResponseRenderer } from '@/components/assistant/assistant-response-renderer';
import { conversationGroupFor, formatRelativeTime } from '@/components/assistant/conversation-time';
import { ConversationError } from '@/components/assistant/conversation-error';
import { TimelineSeparator, UserMessage } from '@/components/assistant/conversation-message';
import { TypingIndicator } from '@/components/assistant/typing-indicator';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import type { AssistantHistoryItem, JsonValue } from '@/lib/assistant-types';

const NEAR_BOTTOM_THRESHOLD_PX = 120;

export function ConversationThread({
  history,
  timestamps,
  pending,
  pendingLabel,
  error,
  onRetry,
  selectClient,
  onContinue,
  onRestart,
  onSearchAgain,
  onConfirmSale,
  manualHrefFor,
  emptyState,
}: {
  history: AssistantHistoryItem[];
  /** Client-captured, session-only timestamps keyed by history item id. Never sent to the server. */
  timestamps: Record<string, number>;
  pending: boolean;
  pendingLabel?: string | null;
  error: string | null;
  onRetry?: () => void;
  selectClient: (id: string, label: string) => void;
  onContinue: (item: AssistantHistoryItem, entities: Record<string, JsonValue>) => void;
  onRestart: (item: AssistantHistoryItem) => void;
  onSearchAgain?: () => void;
  onConfirmSale?: (item: AssistantHistoryItem, args: { actionRunId: string; planFingerprint: string }) => void;
  manualHrefFor?: (item: AssistantHistoryItem) => string | undefined;
  emptyState?: React.ReactNode;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showJump, setShowJump] = useState(false);
  // Starts true and is only ever revised by a real scroll event — never
  // measured eagerly on mount, since a long page (sidebar, hero, quick
  // queries) can already extend past one viewport before any conversation
  // content exists, which would otherwise look identical to "the user
  // scrolled away" and wrongly withhold the very first reply.
  const nearBottomRef = useRef(true);
  const hasRevealedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const visible = history.filter((item) => !dismissed.has(item.id));
  const chronological = [...visible].reverse();
  const hasContent = chronological.length > 0 || pending || !!error;
  const contentSignature = `${chronological.length}:${pending ? 1 : 0}:${error ? 1 : 0}`;

  useEffect(() => {
    const handleScroll = () => {
      const distance = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      const near = distance < NEAR_BOTTOM_THRESHOLD_PX;
      nearBottomRef.current = near;
      if (near) setShowJump(false);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!hasContent) return;
    // The thread's very first message always reveals itself — there is no
    // prior scroll position to respect yet. Only later turns check whether
    // the reader is still near the bottom before auto-scrolling.
    const isFirstReveal = !hasRevealedRef.current;
    hasRevealedRef.current = true;
    if (isFirstReveal || nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
      setShowJump(false);
    } else {
      setShowJump(true);
    }
    // contentSignature intentionally drives this — a new message, the typing
    // indicator, or an error should each attempt to reveal themselves, but
    // never by fighting a user who has deliberately scrolled up to read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSignature]);

  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
    setShowJump(false);
  };

  if (!chronological.length && !pending && !error) {
    return emptyState ? <>{emptyState}</> : null;
  }

  const now = Date.now();
  let lastGroup: string | null = null;

  return (
    <section aria-label="Conversaciones" className="relative space-y-4">
      {chronological.map((item) => {
        const at = timestamps[item.id] ?? now;
        const group = conversationGroupFor(at, now);
        const separator = group !== lastGroup ? <TimelineSeparator key={`sep-${group}-${item.id}`} label={group} /> : null;
        lastGroup = group;
        return (
          <div key={item.id} className="space-y-1.5">
            {separator}
            <div className="flex items-start justify-between gap-2">
              <UserMessage>{item.label}</UserMessage>
            </div>
            <p className="pr-1 text-right text-[10px] text-white/20">{formatRelativeTime(at, now)}</p>
            {item.intent === 'UNKNOWN' ? (
              // The natural-language endpoint never resolved this to a real
              // business intent — there is no BusinessActionId to validate
              // against, so this renders directly rather than through
              // AssistantResponseRenderer. The response itself is always
              // NEEDS_INPUT/FAILED-shaped (see typed-responses.ts server-side).
              <ConversationError
                text={typeof item.response.payload.message === 'string' ? item.response.payload.message : 'No entendí la indicación con suficiente claridad.'}
                onRetry={() => onRestart(item)}
              />
            ) : (
              <AssistantResponseRenderer
                intent={item.intent}
                response={item.response}
                onSelectClient={selectClient}
                onContinue={(entities) => onContinue(item, entities)}
                onConfirmSale={
                  onConfirmSale
                    ? (args) => onConfirmSale(item, args)
                    : undefined
                }
                onSearchAgain={onSearchAgain}
                onEdit={() => onRestart(item)}
                onDismiss={() => setDismissed((current) => new Set(current).add(item.id))}
                manualHref={manualHrefFor?.(item)}
                busy={pending}
              />
            )}
          </div>
        );
      })}
      {pending ? (
        <div className="space-y-2">
          {pendingLabel ? <UserMessage>{pendingLabel}</UserMessage> : null}
          <TypingIndicator />
        </div>
      ) : null}
      {error ? <ConversationError text={error} onRetry={onRetry} /> : null}
      <div ref={bottomRef} />
      {showJump ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="sticky bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-panel/95 px-3.5 py-2 text-xs font-medium text-white/80 shadow-lg backdrop-blur"
        >
          Ir al mensaje más reciente
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
