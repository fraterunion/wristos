'use client';

import { AssistantMessage } from '@/components/assistant/conversation-message';
import { ConversationChoices } from '@/components/assistant/conversation-choice';
import { ConversationPreview, ConversationReceipt } from '@/components/assistant/conversation-preview';
import { ConversationError } from '@/components/assistant/conversation-error';
import type { ConversationBlock } from '@/components/assistant/response-to-conversation-blocks';
import type { JsonValue } from '@/lib/assistant-types';

// One 60–140ms-range step per block, capped so a long response doesn't
// produce an oddly long staggered reveal. prefers-reduced-motion disables
// the underlying animation entirely (see .ui-msg-in in globals.css), which
// makes this delay a no-op for users who asked for less motion.
const STAGGER_STEP_MS = 70;
const STAGGER_CAP = 6;
function delayFor(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_STEP_MS;
}

export function ConversationBlocks({
  blocks,
  onSelectChoice,
  onSearchAgain,
  onContinue: _onContinue,
  onConfirmSale,
  onEdit,
  onDismiss,
  onRetry,
  manualHref,
  busy,
}: {
  blocks: ConversationBlock[];
  onSelectChoice?: (id: string, label: string) => void;
  onSearchAgain?: () => void;
  /** @deprecated clarification no longer uses mini-forms; kept for call-site compatibility. */
  onContinue?: (entities: Record<string, JsonValue>) => void;
  onConfirmSale?: (args: { actionRunId: string; planFingerprint: string }) => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  onRetry?: () => void;
  manualHref?: string;
  busy?: boolean;
}) {
  // Consecutive message-shaped blocks from the same turn share one avatar,
  // the way grouped consecutive messages do in iMessage — repeating it once
  // per block would read as noisy, not conversational.
  let messageIndex = -1;

  return (
    <>
      {blocks.map((block, index) => {
        const delayMs = delayFor(index);
        switch (block.kind) {
          case 'text':
            messageIndex += 1;
            return (
              <AssistantMessage key={block.id} showAvatar={messageIndex === 0} delayMs={delayMs}>
                <p>{block.text}</p>
              </AssistantMessage>
            );
          case 'summary':
            messageIndex += 1;
            return (
              <AssistantMessage key={block.id} showAvatar={messageIndex === 0} delayMs={delayMs}>
                <p className="text-lg font-semibold text-white">{block.value}</p>
              </AssistantMessage>
            );
          case 'breakdown':
          case 'list':
            messageIndex += 1;
            return (
              <AssistantMessage key={block.id} showAvatar={messageIndex === 0} delayMs={delayMs}>
                <div className="space-y-1.5">
                  {'intro' in block && block.intro ? <p>{block.intro}</p> : null}
                  {block.items.map((item) => (
                    <div key={item.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-white/55">{item.label}</span>
                      <span className="text-right font-medium text-white">
                        {item.value}
                        {'meta' in item && item.meta ? <span className="ml-1.5 text-white/35">· {item.meta}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </AssistantMessage>
            );
          case 'note':
            messageIndex += 1;
            return (
              <AssistantMessage key={block.id} showAvatar={messageIndex === 0} delayMs={delayMs}>
                <p className="text-[12px] text-white/45">{block.text}</p>
              </AssistantMessage>
            );
          case 'warning':
            messageIndex += 1;
            return (
              <AssistantMessage key={block.id} showAvatar={messageIndex === 0} delayMs={delayMs}>
                <p className="text-[13px] text-amber-200">{block.text}</p>
              </AssistantMessage>
            );
          case 'error':
            messageIndex += 1;
            return (
              <ConversationError
                key={block.id}
                text={block.text}
                onRetry={onRetry}
                showAvatar={messageIndex === 0}
                delayMs={delayMs}
              />
            );
          case 'question':
            messageIndex += 1;
            return (
              <div key={block.id} className="space-y-2">
                <AssistantMessage showAvatar={messageIndex === 0} delayMs={delayMs}>
                  <p>{block.text}</p>
                </AssistantMessage>
                {block.choices?.length && onSelectChoice ? (
                  <ConversationChoices
                    disabled={busy}
                    delayMs={delayMs + 40}
                    options={block.choices.map((choice) => ({
                      id: choice.id,
                      label: choice.label,
                    }))}
                    onSelect={(_id, label) => onSelectChoice(_id, label)}
                  />
                ) : null}
              </div>
            );
          case 'preview':
            messageIndex += 1;
            return (
              <ConversationPreview
                key={block.id}
                intro={block.intro}
                title={block.title}
                fields={block.fields}
                effects={block.effects}
                ctaLabel={block.ctaLabel}
                ctaKind={block.ctaKind}
                ctaHref={block.ctaKind === 'MANUAL_MODULE' ? manualHref : undefined}
                onConfirm={
                  (block.ctaKind === 'CONFIRM_SALE' ||
                    block.ctaKind === 'CONFIRM_PAYMENT' ||
                    block.ctaKind === 'CONFIRM_TRANSFER' ||
                    block.ctaKind === 'CONFIRM_CONTRIBUTION' ||
                    block.ctaKind === 'CONFIRM_DISTRIBUTION' ||
                    block.ctaKind === 'CONFIRM_EXPENSE' ||
                    block.ctaKind === 'CONFIRM_REVERSE_EXPENSE' ||
                    block.ctaKind === 'CONFIRM_REVERSE_TREASURY_TRANSFER' ||
                    block.ctaKind === 'CONFIRM_CLIENT' ||
                    block.ctaKind === 'CONFIRM_CLIENT_UPDATE' ||
                    block.ctaKind === 'CONFIRM_PURCHASE' ||
                    block.ctaKind === 'CONFIRM_RECEIVABLE' ||
                    block.ctaKind === 'CONFIRM_PAYABLE') &&
                  block.actionRunId &&
                  block.planFingerprint &&
                  onConfirmSale
                    ? () =>
                        onConfirmSale({
                          actionRunId: block.actionRunId!,
                          planFingerprint: block.planFingerprint!,
                        })
                    : undefined
                }
                onEdit={onEdit}
                onCancel={onDismiss}
                busy={busy}
                showAvatar={messageIndex === 0}
                delayMs={delayMs}
              />
            );
          case 'receipt':
            messageIndex += 1;
            return (
              <ConversationReceipt
                key={block.id}
                message={block.message}
                lines={block.lines}
                dealHref={block.dealHref}
                correctHref={block.correctHref}
                showAvatar={messageIndex === 0}
                delayMs={delayMs}
              />
            );
          case 'choices':
            return (
              <ConversationChoices
                key={block.id}
                disabled={busy}
                delayMs={delayMs}
                options={
                  block.allowOther && onSearchAgain
                    ? [...block.options, { id: '__other__', label: 'Otro cliente' }]
                    : block.options
                }
                onSelect={(id, label) => {
                  if (id === '__other__') {
                    onSearchAgain?.();
                    return;
                  }
                  onSelectChoice?.(id, label);
                }}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
