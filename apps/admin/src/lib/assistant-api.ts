import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import type {
  AssistantMessageRequest,
  AssistantMessageResult,
  AssistantResumeHint,
  AssistantWorkspace,
  BusinessActionId,
  JsonValue,
  StructuredAssistantRequest,
  StructuredAssistantResponse,
} from '@/lib/assistant-types';

const RESUME_KEY = 'wristos.ai.assistant.resume.v1';

export class AssistantRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly response?: StructuredAssistantResponse,
  ) {
    super(message);
    this.name = 'AssistantRequestError';
  }
}

const statusMessages: Record<number, string> = {
  400: 'Revisa los datos de la consulta.',
  401: 'Tu sesión expiró. Inicia sesión nuevamente.',
  403: 'No tienes acceso a esa información.',
  404: 'No encontré ese recurso.',
  409: 'La información cambió desde que abriste esta conversación.',
  500: 'No pude completar la consulta. No se realizó ningún cambio.',
};

function isStructuredResponse(value: unknown): value is StructuredAssistantResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StructuredAssistantResponse>;
  return (
    typeof candidate.requestId === 'string' &&
    typeof candidate.interactionState === 'string' &&
    typeof candidate.responseType === 'string' &&
    !!candidate.payload &&
    typeof candidate.payload === 'object'
  );
}

export class AssistantMessageRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly result?: AssistantMessageResult,
  ) {
    super(message);
    this.name = 'AssistantMessageRequestError';
  }
}

function isAssistantMessageResult(value: unknown): value is AssistantMessageResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AssistantMessageResult>;
  return typeof candidate.resolvedIntent === 'string' && isStructuredResponse(candidate.response);
}

export function newClientRequestId(): string {
  return crypto.randomUUID();
}

export interface AssistantAction {
  readonly clientRequestId: string;
  readonly request: StructuredAssistantRequest;
  execute(): Promise<StructuredAssistantResponse>;
  retry(): Promise<StructuredAssistantResponse>;
}

export function createAssistantAction(input: {
  intent: BusinessActionId;
  entities: Record<string, JsonValue>;
  userDisplayText?: string;
  conversationId?: string;
  workspaceId?: string;
  expectedWorkspaceVersion?: number;
}): AssistantAction {
  const clientRequestId = newClientRequestId();
  const request: StructuredAssistantRequest = {
    ...input,
    clientRequestId,
    surface: 'MOBILE',
    locale: typeof navigator === 'undefined' ? 'es' : navigator.language,
    timezone:
      typeof Intl === 'undefined'
        ? 'UTC'
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const execute = async () => {
    try {
      return await apiPost<StructuredAssistantResponse, StructuredAssistantRequest>(
        '/ai/assistant/structured',
        request,
        { authenticated: true },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw new AssistantRequestError(
          error.status,
          statusMessages[error.status] ?? 'La consulta no pudo completarse.',
          isStructuredResponse(error.payload) ? error.payload : undefined,
        );
      }
      throw error;
    }
  };
  return { clientRequestId, request, execute, retry: execute };
}

export interface AssistantMessageAction {
  readonly clientRequestId: string;
  readonly request: AssistantMessageRequest;
  execute(): Promise<AssistantMessageResult>;
  retry(): Promise<AssistantMessageResult>;
}

/**
 * Free-form natural-language submission — POST /ai/assistant/message. This
 * never parses or interprets text client-side: it only forwards it and
 * renders back whatever typed, already-validated response the backend
 * returns (the same fail-closed rendering pipeline used for the structured
 * endpoint — see AssistantResponseRenderer / assistant-response-validation).
 */
export function createAssistantMessageAction(input: {
  text: string;
  conversationId?: string;
  workspaceId?: string;
}): AssistantMessageAction {
  const clientRequestId = newClientRequestId();
  const request: AssistantMessageRequest = {
    ...input,
    clientRequestId,
    surface: 'MOBILE',
    locale: typeof navigator === 'undefined' ? 'es' : navigator.language,
    timezone:
      typeof Intl === 'undefined'
        ? 'UTC'
        : Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const execute = async () => {
    try {
      return await apiPost<AssistantMessageResult, AssistantMessageRequest>(
        '/ai/assistant/message',
        request,
        { authenticated: true },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw new AssistantMessageRequestError(
          error.status,
          statusMessages[error.status] ?? 'El asistente no está disponible en este momento. No se realizó ningún cambio.',
          isAssistantMessageResult(error.payload) ? error.payload : undefined,
        );
      }
      throw error;
    }
  };
  return { clientRequestId, request, execute, retry: execute };
}

export async function resumeAssistantWorkspace(
  workspaceId: string,
): Promise<AssistantWorkspace> {
  return apiGet<AssistantWorkspace>(`/ai/workspaces/${workspaceId}`, {
    authenticated: true,
  });
}

export function readResumeHint(): AssistantResumeHint | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(RESUME_KEY) ?? 'null');
    if (
      value &&
      typeof value.workspaceId === 'string' &&
      typeof value.conversationId === 'string'
    ) {
      return value;
    }
  } catch {
    // A local hint is disposable and never authoritative.
  }
  return null;
}

export function writeResumeHint(hint: AssistantResumeHint): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RESUME_KEY, JSON.stringify(hint));
}

export function clearResumeHint(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(RESUME_KEY);
}

export type ConfirmSaleResult = {
  interactionState: 'COMPLETED' | 'FAILED' | 'STALE_PLAN' | 'PERMISSION_BLOCKED';
  responseType: 'SUCCESS_RECEIPT' | 'ERROR_RECOVERY_CARD';
  message: string;
  receipt: JsonValue | null;
  planFingerprint: string;
  executableWrite: true;
  capability: string;
  replayed: boolean;
  actionRunId: string;
};

/**
 * Semantic confirmation for a READY_FOR_CONFIRMATION ActionRun.
 * Calls POST /ai/action-runs/:id/confirm only — never /deals/register-sale.
 * Server owns execution and derives registerIdempotencyKey.
 */
export async function confirmAssistantActionRun(input: {
  actionRunId: string;
  planFingerprint: string;
}): Promise<ConfirmSaleResult> {
  try {
    const raw = await apiPost<Record<string, unknown>, { planFingerprint: string }>(
      `/ai/action-runs/${input.actionRunId}/confirm`,
      { planFingerprint: input.planFingerprint },
      { authenticated: true },
    );
    const receipt = (raw.receipt ?? null) as JsonValue | null;
    const interactionState = String(raw.interactionState ?? 'FAILED') as ConfirmSaleResult['interactionState'];
    const responseType = String(raw.responseType ?? 'ERROR_RECOVERY_CARD') as ConfirmSaleResult['responseType'];
    return {
      interactionState:
        interactionState === 'COMPLETED' ||
        interactionState === 'STALE_PLAN' ||
        interactionState === 'PERMISSION_BLOCKED'
          ? interactionState
          : 'FAILED',
      responseType: responseType === 'SUCCESS_RECEIPT' ? 'SUCCESS_RECEIPT' : 'ERROR_RECOVERY_CARD',
      message: typeof raw.message === 'string' ? raw.message : 'No se pudo confirmar la venta.',
      receipt,
      planFingerprint: typeof raw.planFingerprint === 'string' ? raw.planFingerprint : input.planFingerprint,
      executableWrite: true,
      capability: typeof raw.capability === 'string' ? raw.capability : 'REGISTER_SALE',
      replayed: Boolean(raw.replayed),
      actionRunId: input.actionRunId,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw new AssistantRequestError(
        error.status,
        statusMessages[error.status] ?? 'No pude registrar la venta. No se realizó ningún cambio.',
      );
    }
    throw error;
  }
}

export function confirmResultToAssistantResponse(
  result: ConfirmSaleResult,
  shell: Pick<StructuredAssistantResponse, 'conversationId' | 'workspaceId' | 'requestId' | 'traceId'>,
): StructuredAssistantResponse {
  return {
    requestId: shell.requestId,
    conversationId: shell.conversationId,
    workspaceId: shell.workspaceId,
    actionRunId: result.actionRunId,
    interactionState: result.interactionState,
    responseType: result.responseType,
    payload: {
      message: result.message,
      receipt: result.receipt,
      planFingerprint: result.planFingerprint,
      executableWrite: true,
      capability: result.capability,
      replayed: result.replayed,
      unchanged:
        result.interactionState === 'COMPLETED'
          ? null
          : 'No se realizó ningún cambio.',
    },
    warnings: [],
    suggestedActions: [],
    traceId: shell.traceId,
    createdAt: new Date().toISOString(),
  };
}
