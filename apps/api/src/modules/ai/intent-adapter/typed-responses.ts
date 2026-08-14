import { randomUUID } from 'node:crypto';
import { StructuredAssistantResponse } from '../assistant/structured-assistant.types';
import { buildConversationalMissingFieldsPayload } from '../clarification/clarification-presenter';
import { IntentAdapterOutcome } from './intent-adapter.service';
import { ConfidencePolicyDecision } from './safety';

/**
 * Builds StructuredAssistantResponse-shaped failures for everything that
 * happens BEFORE a candidate reaches the orchestrator (Part 14). These are
 * always NEEDS_INPUT/FAILED-shaped and never claim a business outcome — by
 * construction they cannot collide with the write-intent completion gate in
 * assistant-response-validation.ts, because they never represent a write
 * having happened.
 */

interface ResponseContext {
  conversationId?: string;
  workspaceId?: string;
  traceId: string;
}

function base(context: ResponseContext): Pick<StructuredAssistantResponse, 'requestId' | 'conversationId' | 'workspaceId' | 'traceId' | 'createdAt' | 'warnings' | 'suggestedActions'> {
  return {
    requestId: randomUUID(),
    conversationId: context.conversationId ?? '',
    workspaceId: context.workspaceId ?? '',
    traceId: context.traceId,
    createdAt: new Date().toISOString(),
    warnings: [],
    suggestedActions: [],
  };
}

export function buildProviderFailureResponse(outcome: Extract<IntentAdapterOutcome, { kind: 'PROVIDER_FAILURE' | 'INVALID_OUTPUT' }>, context: ResponseContext): StructuredAssistantResponse {
  const message =
    outcome.kind === 'PROVIDER_FAILURE' && (outcome.failureType === 'TIMEOUT' || outcome.failureType === 'UNAVAILABLE' || outcome.failureType === 'RATE_LIMITED')
      ? 'El asistente no está disponible en este momento. No se realizó ningún cambio.'
      : 'No entendí la indicación con suficiente claridad.';
  return {
    ...base(context),
    interactionState: 'FAILED',
    responseType: 'ERROR_RECOVERY_CARD',
    payload: {
      code: outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : outcome.reason,
      message,
      unchanged: 'No se ejecutó ninguna acción de escritura ni se modificaron datos de negocio.',
      nextAction: 'Intenta reformular tu mensaje o usa una acción estructurada.',
    },
  };
}

export function buildPolicyResponse(
  policy: Exclude<ConfidencePolicyDecision, { action: 'PROCEED' }>,
  context: ResponseContext,
  meta?: { capability?: string; entities?: Record<string, unknown> },
): StructuredAssistantResponse {
  if (policy.action === 'REJECT_UNKNOWN') {
    return {
      ...base(context),
      interactionState: 'FAILED',
      responseType: 'ERROR_RECOVERY_CARD',
      payload: {
        code: 'UNKNOWN_INTENT',
        message: 'No entendí la indicación con suficiente claridad.',
        unchanged: 'No se ejecutó ninguna acción de escritura ni se modificaron datos de negocio.',
        nextAction: 'Intenta reformular tu mensaje o usa una acción estructurada.',
      },
    };
  }
  if (policy.action === 'REJECT_LOW_CONFIDENCE') {
    return {
      ...base(context),
      interactionState: 'FAILED',
      responseType: 'ERROR_RECOVERY_CARD',
      payload: {
        code: 'LOW_CONFIDENCE',
        message: 'No entendí con suficiente claridad. ¿Puedes darme más detalles?',
        unchanged: 'No se ejecutó ninguna acción de escritura ni se modificaron datos de negocio.',
        nextAction: 'Intenta reformular tu mensaje o usa una acción estructurada.',
      },
    };
  }
  // CLARIFY_AMBIGUITY — one natural question at a time; never raw LLM reason text.
  const presented = buildConversationalMissingFieldsPayload({
    capability: meta?.capability ?? 'UNKNOWN',
    missing: policy.ambiguities.map((ambiguity) => ({
      entity: ambiguity.field,
      question: ambiguity.reason,
    })),
    entities: meta?.entities,
  });
  return {
    ...base(context),
    interactionState: 'NEEDS_INPUT',
    responseType: 'MISSING_FIELDS_CARD',
    payload: {
      ...presented,
    },
  };
}

export function buildRateLimitedResponse(context: ResponseContext): StructuredAssistantResponse {
  return {
    ...base(context),
    interactionState: 'FAILED',
    responseType: 'ERROR_RECOVERY_CARD',
    payload: {
      code: 'RATE_LIMITED',
      message: 'Has enviado demasiadas solicitudes. Espera un momento e intenta de nuevo.',
      unchanged: 'No se ejecutó ninguna acción de escritura ni se modificaron datos de negocio.',
      nextAction: 'Espera unos segundos antes de volver a intentarlo.',
    },
  };
}

export function buildReferenceClarificationResponse(
  message: string,
  context: ResponseContext,
  code = 'REFERENCE_CLARIFICATION',
): StructuredAssistantResponse {
  return {
    ...base(context),
    interactionState: 'NEEDS_INPUT',
    responseType: 'MISSING_FIELDS_CARD',
    payload: {
      title: 'Necesito que elijas nuevamente',
      message,
      code,
      groups: [],
      unchanged: 'No se ejecutó ninguna acción.',
      nextAction: 'Elige una opción de la lista o reformula tu solicitud.',
    },
  };
}

/**
 * "Empezar de nuevo" — Conversation Reset confirmation. Deterministic, fixed
 * copy: this response never comes from a provider/planner/router call, so
 * there is no candidate output to render — just the one guaranteed outcome.
 */
export function buildConversationResetResponse(context: ResponseContext): StructuredAssistantResponse {
  return {
    ...base(context),
    interactionState: 'COMPLETED',
    responseType: 'TEXT_ANSWER',
    payload: {
      message: 'Listo. Empecemos de nuevo.',
      unchanged: 'El historial de la conversación se conserva; solo se descartó la transacción en curso.',
      nextAction: 'Escribe tu siguiente indicación.',
    },
  };
}

export function buildEntitySelectedResponse(
  label: string,
  context: ResponseContext,
): StructuredAssistantResponse {
  return {
    ...base(context),
    interactionState: 'NEEDS_INPUT',
    responseType: 'TEXT_ANSWER',
    payload: {
      message: `Seleccioné ${label}. ¿Qué quieres hacer ahora?`,
      unchanged: 'No se ejecutó ninguna acción de escritura ni se modificaron datos de negocio.',
      nextAction: 'Puedes pedir sus cuentas, continuar con una venta, o elegir otra opción.',
    },
  };
}
