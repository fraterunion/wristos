'use client';

import { validateAssistantResponse } from '@/lib/assistant-response-validation';
import type { BusinessActionId, JsonValue, StructuredAssistantResponse } from '@/lib/assistant-types';
import { ConversationBlocks } from '@/components/assistant/conversation-blocks';
import { ConversationError } from '@/components/assistant/conversation-error';
import { responseToConversationBlocks } from '@/components/assistant/response-to-conversation-blocks';

// Adapts one structured assistant response into conversational presentation.
// validateAssistantResponse is the safety gate — it runs first, unmodified,
// and its FAIL_CLOSED verdict is rendered directly from its own title/message,
// never from response.payload. Only a VALID response is ever handed to the
// conversational block adapter.
export function AssistantResponseRenderer({
  intent,
  response,
  onSelectClient,
  onContinue,
  onConfirmSale,
  onSearchAgain,
  onEdit,
  onDismiss,
  manualHref,
  busy,
}: {
  intent: BusinessActionId;
  response: StructuredAssistantResponse;
  onSelectClient?: (id: string, label: string) => void;
  onContinue?: (entities: Record<string, JsonValue>) => void;
  onConfirmSale?: (args: { actionRunId: string; planFingerprint: string }) => void;
  onSearchAgain?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  manualHref?: string;
  busy?: boolean;
}) {
  const validation = validateAssistantResponse(intent, response);
  if (validation.kind === 'FAIL_CLOSED') {
    return <ConversationError text={validation.title} detail={validation.message} manualHref={validation.manualHref} />;
  }

  const blocks = responseToConversationBlocks(intent, validation.response);
  return (
    <ConversationBlocks
      blocks={blocks}
      onSelectChoice={onSelectClient}
      onSearchAgain={onSearchAgain}
      onContinue={onContinue}
      onConfirmSale={onConfirmSale}
      onEdit={onEdit}
      onDismiss={onDismiss}
      onRetry={onEdit}
      manualHref={manualHref}
      busy={busy}
    />
  );
}
