import {
  ASSISTANT_INTERACTION_STATES,
  ASSISTANT_RESPONSE_TYPES,
  WRITE_PREVIEW_ACTIONS,
  type AssistantInteractionState,
  type AssistantResponseType,
  type BusinessActionId,
  type StructuredAssistantResponse,
  type WritePreviewAction,
} from '@/lib/assistant-types';

const responseTypes = new Set<string>(ASSISTANT_RESPONSE_TYPES);
const interactionStates = new Set<string>(ASSISTANT_INTERACTION_STATES);
const writeIntents = new Set<string>(WRITE_PREVIEW_ACTIONS);

const writeCompatibility: Readonly<
  Partial<Record<AssistantInteractionState, readonly AssistantResponseType[]>>
> = {
  NEEDS_INPUT: ['MISSING_FIELDS_CARD'],
  NEEDS_DISAMBIGUATION: ['ENTITY_PICKER'],
  READY_FOR_CONFIRMATION: ['ACTION_PREVIEW_CARD'],
  FAILED: ['ERROR_RECOVERY_CARD'],
  STALE_PLAN: ['ERROR_RECOVERY_CARD'],
  PERMISSION_BLOCKED: ['ERROR_RECOVERY_CARD'],
};

const manualRoutes: Readonly<Record<WritePreviewAction, string>> = {
  REGISTER_SALE: '/ventas',
  REGISTER_RECEIVABLE_PAYMENT: '/cuentas',
  REGISTER_PURCHASE: '/inventory',
  REGISTER_EXPENSE: '/expenses',
  REGISTER_SETTLEMENT: '/cuentas',
  REGISTER_CRYPTO_POSITION: '/crypto',
  REGISTER_CRYPTO_PRICE: '/crypto',
};

export type AssistantResponseValidation =
  | { kind: 'VALID'; response: StructuredAssistantResponse }
  | {
      kind: 'FAIL_CLOSED';
      title: string;
      message: string;
      manualHref?: string;
      reason: 'UNSUPPORTED_RESPONSE' | 'WRITE_RESPONSE_BLOCKED';
    };

function isWriteIntent(intent: BusinessActionId): intent is WritePreviewAction {
  return writeIntents.has(intent);
}

export function validateAssistantResponse(
  intent: BusinessActionId,
  candidate: unknown,
): AssistantResponseValidation {
  if (!candidate || typeof candidate !== 'object') return unsupportedResponse();
  const response = candidate as Partial<StructuredAssistantResponse>;
  if (
    typeof response.responseType !== 'string' ||
    !responseTypes.has(response.responseType) ||
    typeof response.interactionState !== 'string' ||
    !interactionStates.has(response.interactionState)
  ) {
    return unsupportedResponse();
  }

  if (isWriteIntent(intent)) {
    const compatibleTypes = writeCompatibility[
      response.interactionState as AssistantInteractionState
    ];
    if (
      !compatibleTypes?.includes(response.responseType as AssistantResponseType)
    ) {
      return {
        kind: 'FAIL_CLOSED',
        reason: 'WRITE_RESPONSE_BLOCKED',
        title: 'Esta operación no se ejecutó.',
        message:
          'La ejecución conversacional de esta acción todavía no está habilitada.',
        manualHref: manualRoutes[intent],
      };
    }
  }

  return { kind: 'VALID', response: candidate as StructuredAssistantResponse };
}

function unsupportedResponse(): AssistantResponseValidation {
  return {
    kind: 'FAIL_CLOSED',
    reason: 'UNSUPPORTED_RESPONSE',
    title: 'No se pudo mostrar esta respuesta de forma segura.',
    message: 'No se realizó ningún cambio.',
  };
}
