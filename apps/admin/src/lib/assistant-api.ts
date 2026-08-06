import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import type {
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
  403: 'No tienes permiso para consultar esta información.',
  404: 'No se encontró el recurso solicitado.',
  409: 'El estado cambió. Actualiza y vuelve a intentarlo.',
  500: 'No fue posible completar la consulta.',
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
