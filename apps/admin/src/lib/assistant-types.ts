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
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_CAPITAL_CONTRIBUTION',
  'REGISTER_CAPITAL_DISTRIBUTION',
  'REGISTER_PURCHASE',
  'REGISTER_EXPENSE',
  'REVERSE_EXPENSE',
  'REVERSE_TREASURY_TRANSFER',
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
  'CREATE_RECEIVABLE',
  'CREATE_PAYABLE',
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

export const CONTEXT_ENTITY_TYPES = [
  'WATCH',
  'CLIENT',
  'ACCOUNT_ENTRY',
  'INVESTOR',
  'OPERATING_EXPENSE',
  'TREASURY_TRANSFER',
] as const;
export type ContextEntityType = (typeof CONTEXT_ENTITY_TYPES)[number];

/**
 * A picker click is an EVENT, not a chat message — the frontend already has
 * the selected candidate's trusted id from the server's own last
 * ENTITY_PICKER response, so it posts that id directly to
 * /ai/assistant/picker-selection instead of re-encoding the label as free
 * text through /ai/assistant/message. Same result shape as
 * AssistantMessageResult (the server resumes the identical
 * planner/resolver pipeline either way).
 */
export interface PickerSelectionRequest {
  conversationId?: string;
  workspaceId?: string;
  entityType: ContextEntityType;
  selectedId: string;
  selectedLabel: string;
  surface: 'MOBILE';
  locale: string;
  timezone: string;
  clientRequestId: string;
}
