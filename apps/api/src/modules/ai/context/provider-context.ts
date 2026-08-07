import { BoundedConversationContext } from '../intent-adapter/intent-adapter-provider';
import { AssistantWorkingContext } from './working-context';

/**
 * Builds provider-facing context: labels and ordinals only — never trusted IDs.
 */
export function toProviderConversationContext(
  working: AssistantWorkingContext | null,
  conversationLanguage?: string,
): BoundedConversationContext | undefined {
  if (!working) {
    return conversationLanguage ? { conversationLanguage } : undefined;
  }

  const context: BoundedConversationContext = {};
  if (working.lastIntent) context.lastIntent = working.lastIntent;
  if (conversationLanguage) context.conversationLanguage = conversationLanguage;
  if (working.pendingMissingFields?.length) {
    context.pendingMissingFields = working.pendingMissingFields.slice(0, 5);
  }
  if (working.lastSelectedEntity) {
    context.selectedEntity = {
      type: working.lastSelectedEntity.type,
      label: working.lastSelectedEntity.label,
    };
  }
  if (working.lastPresentedCandidates?.candidates.length) {
    context.presentedCandidates = working.lastPresentedCandidates.candidates.slice(0, 5).map((c) => ({
      ordinal: c.ordinal,
      type: working.lastPresentedCandidates!.type,
      label: c.label,
    }));
  }
  return context;
}
