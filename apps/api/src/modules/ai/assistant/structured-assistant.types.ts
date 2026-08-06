import { AIConversationSurface } from '@prisma/client';
import { JsonValue } from '../domain/canonical-json';
import { BusinessActionId, BusinessWarning } from '../planner/planner.types';

export const ASSISTANT_INTERACTION_STATES = [
  'ANSWERING', 'NEEDS_INPUT', 'NEEDS_DISAMBIGUATION', 'READY_FOR_CONFIRMATION',
  'EXECUTING', 'COMPLETED', 'FAILED', 'STALE_PLAN', 'PERMISSION_BLOCKED',
] as const;
export type AssistantInteractionState = typeof ASSISTANT_INTERACTION_STATES[number];

export const ASSISTANT_RESPONSE_TYPES = [
  'TEXT_ANSWER', 'METRIC_CARD', 'METRIC_BREAKDOWN', 'ENTITY_LIST', 'ENTITY_PICKER',
  'MISSING_FIELDS_CARD', 'ACTION_PREVIEW_CARD', 'SUCCESS_RECEIPT', 'ERROR_RECOVERY_CARD',
] as const;
export type AssistantResponseType = typeof ASSISTANT_RESPONSE_TYPES[number];

export interface StructuredAssistantRequest {
  conversationId?: string;
  workspaceId?: string;
  intent: BusinessActionId;
  entities: Record<string, JsonValue>;
  entityVersions?: Record<string, string | number>;
  expectedWorkspaceVersion?: number;
  surface: AIConversationSurface;
  locale?: string;
  timezone?: string;
  clientRequestId: string;
  userDisplayText?: string;
}

export interface StructuredAssistantResponse {
  requestId: string;
  conversationId: string;
  workspaceId: string;
  actionRunId?: string;
  interactionState: AssistantInteractionState;
  responseType: AssistantResponseType;
  payload: Record<string, JsonValue>;
  warnings: BusinessWarning[];
  suggestedActions: Array<{ id: string; label: string; payload?: Record<string, JsonValue> }>;
  traceId: string;
  createdAt: string;
}

export interface AssistantActorContext {
  tenantId: string;
  userId: string;
  role?: string;
  permissions: string[];
}
