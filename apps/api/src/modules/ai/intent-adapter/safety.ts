import { BoundedConversationContext } from './intent-adapter-provider';
import { StructuredIntentCandidate } from './intent-candidate';

export const MAX_USER_TEXT_LENGTH = 800;
export const MAX_CONTEXT_FIELD_LENGTH = 120;
export const MAX_CONTEXT_LIST_ITEMS = 5;
export const MAX_CONTEXT_ENTITY_KEYS = 10;

/**
 * Deterministic confidence policy (Part 6). The provider's confidence is
 * advisory only — this function is the actual gate, and it is the only
 * place allowed to decide whether a candidate reaches the orchestrator.
 * Numeric/raw confidence is never returned to a caller; only this decision.
 */
export type ConfidencePolicyDecision =
  | { action: 'PROCEED' }
  | { action: 'CLARIFY_AMBIGUITY'; ambiguities: StructuredIntentCandidate['ambiguities'] }
  | { action: 'REJECT_LOW_CONFIDENCE' }
  | { action: 'REJECT_UNKNOWN' };

export function decideConfidencePolicy(candidate: StructuredIntentCandidate): ConfidencePolicyDecision {
  if (candidate.intent === 'UNKNOWN') return { action: 'REJECT_UNKNOWN' };
  // Deliberately stricter than "write-only": a misread READ request can
  // still point a user at the wrong client's financial data, so LOW
  // confidence is never allowed to proceed silently for any intent.
  if (candidate.confidence === 'LOW') return { action: 'REJECT_LOW_CONFIDENCE' };
  if (candidate.ambiguities.length > 0) return { action: 'CLARIFY_AMBIGUITY', ambiguities: candidate.ambiguities };
  // HIGH or MEDIUM with no flagged ambiguity: forward to the orchestrator.
  // Any still-missing required fields are handled by PlannerService's own
  // clarification flow, which already has per-field question text — adding
  // a second, less specific "missing fields" layer here would only degrade
  // that existing UX.
  return { action: 'PROCEED' };
}

/**
 * Defensive re-check ahead of the provider call (Part 13). The HTTP DTO
 * already enforces this; this exists so any direct service-level caller
 * (including tests) cannot accidentally skip it.
 */
export function assertWithinTextLimit(text: string): void {
  if (text.length === 0) throw new Error('userText must not be empty');
  if (text.length > MAX_USER_TEXT_LENGTH) throw new Error(`userText exceeds ${MAX_USER_TEXT_LENGTH} characters`);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Bounds a conversation-context object before it is ever sent to a
 * provider: caps string lengths and list sizes. Never includes trusted
 * entity IDs in the preferred V1.1 shape (labels/ordinals only).
 */
export function sanitizeConversationContext(
  context: BoundedConversationContext | undefined,
): BoundedConversationContext | undefined {
  if (!context) return undefined;

  const sanitized: BoundedConversationContext = {};
  if (context.lastIntent) sanitized.lastIntent = context.lastIntent;
  if (context.conversationLanguage) sanitized.conversationLanguage = truncate(context.conversationLanguage, 10);

  if (context.selectedEntity) {
    sanitized.selectedEntity = {
      type: context.selectedEntity.type,
      label: truncate(context.selectedEntity.label, MAX_CONTEXT_FIELD_LENGTH),
    };
  }

  if (context.presentedCandidates?.length) {
    sanitized.presentedCandidates = context.presentedCandidates.slice(0, MAX_CONTEXT_LIST_ITEMS).map((c) => ({
      ordinal: c.ordinal,
      type: c.type,
      label: truncate(c.label, MAX_CONTEXT_FIELD_LENGTH),
    }));
  }

  if (context.pendingMissingFields?.length) {
    sanitized.pendingMissingFields = context.pendingMissingFields
      .slice(0, MAX_CONTEXT_LIST_ITEMS)
      .map((field) => truncate(field, 64));
  }

  // Legacy fields: keep size bounds but never prefer them for new builders.
  if (context.lastResolvedEntities) {
    const entries = Object.entries(context.lastResolvedEntities).slice(0, MAX_CONTEXT_ENTITY_KEYS);
    sanitized.lastResolvedEntities = Object.fromEntries(
      entries.map(([key, value]) => [
        truncate(key, 64),
        typeof value === 'string' ? truncate(value, MAX_CONTEXT_FIELD_LENGTH) : value,
      ]),
    );
  }

  if (context.lastPresentedCandidateIds?.length) {
    sanitized.lastPresentedCandidateIds = context.lastPresentedCandidateIds
      .slice(0, MAX_CONTEXT_LIST_ITEMS)
      .map((id) => truncate(id, 64));
  }

  return sanitized;
}
