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
  'GET_INVENTORY_AGING',
  'GET_TOP_INVENTORY_CAPITAL',
  'GET_TOP_DEBTORS',
  'GET_RECEIVABLE_SUMMARY',
  'GET_SALES_MARGIN_SUMMARY',
  'GET_PROFIT_BY_BRAND',
  'GET_TOP_SALES',
  'GET_ATTENTION_ITEMS',
  'GET_BUSINESS_SUMMARY',
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
  // 'UNKNOWN' only ever comes from the natural-language message endpoint,
  // when the text never resolved to a real business intent (or the
  // provider/adapter failed before reaching one). It is never a value the
  // structured endpoint produces or accepts.
  intent: BusinessActionId | 'UNKNOWN';
  entities: Record<string, JsonValue>;
  response: StructuredAssistantResponse;
}

export interface AssistantMessageRequest {
  conversationId?: string;
  workspaceId?: string;
  text: string;
  surface: 'MOBILE';
  locale: string;
  timezone: string;
  clientRequestId: string;
}

export interface AssistantMessageResult {
  resolvedIntent: BusinessActionId | 'UNKNOWN';
  response: StructuredAssistantResponse;
  resolvedEntities: Record<string, JsonValue>;
}
