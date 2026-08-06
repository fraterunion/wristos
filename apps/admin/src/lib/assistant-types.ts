export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const READ_ACTIONS = [
  'GET_LIQUIDITY',
  'GET_MONTHLY_PROFIT',
  'SEARCH_INVENTORY',
  'SEARCH_CLIENT',
  'GET_CLIENT_ACCOUNTS',
] as const;

export const WRITE_PREVIEW_ACTIONS = [
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PURCHASE',
  'REGISTER_EXPENSE',
  'REGISTER_SETTLEMENT',
  'REGISTER_CRYPTO_POSITION',
  'REGISTER_CRYPTO_PRICE',
] as const;

export type ReadAction = (typeof READ_ACTIONS)[number];
export type WritePreviewAction = (typeof WRITE_PREVIEW_ACTIONS)[number];
export type BusinessActionId = ReadAction | WritePreviewAction;

export type AssistantInteractionState =
  | 'ANSWERING'
  | 'NEEDS_INPUT'
  | 'NEEDS_DISAMBIGUATION'
  | 'READY_FOR_CONFIRMATION'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STALE_PLAN'
  | 'PERMISSION_BLOCKED';

export const ASSISTANT_INTERACTION_STATES = [
  'ANSWERING',
  'NEEDS_INPUT',
  'NEEDS_DISAMBIGUATION',
  'READY_FOR_CONFIRMATION',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'STALE_PLAN',
  'PERMISSION_BLOCKED',
] as const satisfies readonly AssistantInteractionState[];

export type AssistantResponseType =
  | 'TEXT_ANSWER'
  | 'METRIC_CARD'
  | 'METRIC_BREAKDOWN'
  | 'ENTITY_LIST'
  | 'ENTITY_PICKER'
  | 'MISSING_FIELDS_CARD'
  | 'ACTION_PREVIEW_CARD'
  | 'SUCCESS_RECEIPT'
  | 'ERROR_RECOVERY_CARD';

export const ASSISTANT_RESPONSE_TYPES = [
  'TEXT_ANSWER',
  'METRIC_CARD',
  'METRIC_BREAKDOWN',
  'ENTITY_LIST',
  'ENTITY_PICKER',
  'MISSING_FIELDS_CARD',
  'ACTION_PREVIEW_CARD',
  'SUCCESS_RECEIPT',
  'ERROR_RECOVERY_CARD',
] as const satisfies readonly AssistantResponseType[];

export interface StructuredAssistantRequest {
  conversationId?: string;
  workspaceId?: string;
  intent: BusinessActionId;
  entities: Record<string, JsonValue>;
  entityVersions?: Record<string, string | number>;
  expectedWorkspaceVersion?: number;
  surface: 'MOBILE';
  locale: string;
  timezone: string;
  clientRequestId: string;
  userDisplayText?: string;
}

export interface AssistantWarning {
  code: string;
  message: string;
}

export interface StructuredAssistantResponse {
  requestId: string;
  conversationId: string;
  workspaceId: string;
  actionRunId?: string;
  interactionState: AssistantInteractionState;
  responseType: AssistantResponseType;
  payload: Record<string, JsonValue>;
  warnings: AssistantWarning[];
  suggestedActions: Array<{
    id: string;
    label: string;
    payload?: Record<string, JsonValue>;
  }>;
  traceId: string;
  createdAt: string;
}

export interface AssistantWorkspace {
  id: string;
  conversationId: string | null;
  version: number;
  deletedAt: string | null;
}

export interface AssistantResumeHint {
  workspaceId: string;
  conversationId: string;
}

export interface AssistantHistoryItem {
  id: string;
  label: string;
  intent: BusinessActionId;
  entities: Record<string, JsonValue>;
  response: StructuredAssistantResponse;
}
