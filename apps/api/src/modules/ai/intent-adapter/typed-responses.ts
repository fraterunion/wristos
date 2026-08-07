import { randomUUID } from 'node:crypto';
import { StructuredAssistantResponse } from '../assistant/structured-assistant.types';
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

export function buildPolicyResponse(policy: Exclude<ConfidencePolicyDecision, { action: 'PROCEED' }>, context: ResponseContext): StructuredAssistantResponse {
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
  // CLARIFY_AMBIGUITY
  return {
    ...base(context),
    interactionState: 'NEEDS_INPUT',
    responseType: 'MISSING_FIELDS_CARD',
    payload: {
      title: 'Necesito un poco más de información',
      message: 'Necesito un poco más de información para continuar.',
      groups: [
        {
          id: 'ambiguities',
          label: 'Aclaraciones necesarias',
          fields: policy.ambiguities.map((ambiguity) => ({
            key: ambiguity.field,
            question: ambiguity.candidates?.length
              ? `${ambiguity.reason} (${ambiguity.candidates.join(', ')})`
              : ambiguity.reason,
          })),
        },
      ],
      unchanged: 'No se ejecutó ninguna acción.',
      nextAction: 'Responde con la aclaración solicitada o usa una acción estructurada.',
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
