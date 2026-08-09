import {
  ASSISTANT_INTERACTION_STATES,
  ASSISTANT_RESPONSE_TYPES,
  WRITE_PREVIEW_ACTIONS,
  type AssistantInteractionState,
  type AssistantResponseType,
  type BusinessActionId,
  type JsonValue,
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
  // Executable writes only — see isCanonicalExecutableWriteSuccess below.
  COMPLETED: ['SUCCESS_RECEIPT'],
};

const manualRoutes: Readonly<Record<WritePreviewAction, string>> = {
  REGISTER_SALE: '/ventas',
  REGISTER_RECEIVABLE_PAYMENT: '/cuentas',
  REGISTER_PAYABLE_PAYMENT: '/cuentas',
  REGISTER_PURCHASE: '/inventory',
  REGISTER_EXPENSE: '/expenses',
  CREATE_CLIENT: '/crm',
  UPDATE_CLIENT: '/crm',
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

function isRecord(value: JsonValue | undefined | null): value is Record<string, JsonValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalRegisterSaleSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'REGISTER_SALE') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (typeof receipt.dealId !== 'string' || !receipt.dealId) return false;
  if (typeof receipt.paymentMode !== 'string') return false;
  if (typeof receipt.amount !== 'string' && typeof receipt.amount !== 'number') return false;
  if (payload.executableWrite !== true && payload.capability !== 'REGISTER_SALE') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalReceivablePaymentSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'REGISTER_RECEIVABLE_PAYMENT') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (typeof receipt.paymentId !== 'string' || !receipt.paymentId) return false;
  if (typeof receipt.receivableEntryId !== 'string' || !receipt.receivableEntryId) return false;
  if (typeof receipt.destination !== 'string') return false;
  if (typeof receipt.amount !== 'string' && typeof receipt.amount !== 'number') return false;
  if (payload.executableWrite !== true && payload.capability !== 'REGISTER_RECEIVABLE_PAYMENT') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalPayablePaymentSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'REGISTER_PAYABLE_PAYMENT') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (typeof receipt.paymentId !== 'string' || !receipt.paymentId) return false;
  if (typeof receipt.payableEntryId !== 'string' || !receipt.payableEntryId) return false;
  if (typeof receipt.sourceAccount !== 'string') return false;
  if (typeof receipt.amount !== 'string' && typeof receipt.amount !== 'number') return false;
  if (payload.executableWrite !== true && payload.capability !== 'REGISTER_PAYABLE_PAYMENT') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalExpenseSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'REGISTER_EXPENSE') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (typeof receipt.expenseId !== 'string' || !receipt.expenseId) return false;
  if (typeof receipt.category !== 'string' || !receipt.category) return false;
  if (typeof receipt.sourceAccount !== 'string' || !receipt.sourceAccount) return false;
  if (typeof receipt.amount !== 'string' && typeof receipt.amount !== 'number') return false;
  if (payload.executableWrite !== true && payload.capability !== 'REGISTER_EXPENSE') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalPurchaseSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'REGISTER_PURCHASE') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (typeof receipt.watchId !== 'string' || !receipt.watchId) return false;
  if (typeof receipt.paymentMode !== 'string' || !receipt.paymentMode) return false;
  if (typeof receipt.costMxn !== 'string' && typeof receipt.costMxn !== 'number') return false;
  if (payload.executableWrite !== true && payload.capability !== 'REGISTER_PURCHASE') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalCreateClientSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'CREATE_CLIENT') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (typeof receipt.clientId !== 'string' || !receipt.clientId) return false;
  if (typeof receipt.name !== 'string' || !receipt.name) return false;
  if (payload.executableWrite !== true && payload.capability !== 'CREATE_CLIENT') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalUpdateClientSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  if (intent !== 'UPDATE_CLIENT') return false;
  if (response.interactionState !== 'COMPLETED') return false;
  if (response.responseType !== 'SUCCESS_RECEIPT') return false;
  const payload = response.payload;
  if (!isRecord(payload)) return false;
  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (!receipt) return false;
  if (receipt.kind !== 'CLIENT_UPDATED') return false;
  if (typeof receipt.clientId !== 'string' || !receipt.clientId) return false;
  if (typeof receipt.name !== 'string' || !receipt.name) return false;
  if (!Array.isArray(receipt.changedFields)) return false;
  if (payload.executableWrite !== true && payload.capability !== 'UPDATE_CLIENT') {
    if (typeof payload.message !== 'string') return false;
  }
  return true;
}

function isCanonicalExecutableWriteSuccess(
  intent: BusinessActionId,
  response: Partial<StructuredAssistantResponse>,
): boolean {
  return (
    isCanonicalRegisterSaleSuccess(intent, response) ||
    isCanonicalReceivablePaymentSuccess(intent, response) ||
    isCanonicalPayablePaymentSuccess(intent, response) ||
    isCanonicalExpenseSuccess(intent, response) ||
    isCanonicalPurchaseSuccess(intent, response) ||
    isCanonicalCreateClientSuccess(intent, response) ||
    isCanonicalUpdateClientSuccess(intent, response)
  );
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
    if (isCanonicalExecutableWriteSuccess(intent, response)) {
      return { kind: 'VALID', response: candidate as StructuredAssistantResponse };
    }

    const compatibleTypes = writeCompatibility[
      response.interactionState as AssistantInteractionState
    ];
    if (
      response.interactionState === 'COMPLETED' ||
      !compatibleTypes?.includes(response.responseType as AssistantResponseType)
    ) {
      return {
        kind: 'FAIL_CLOSED',
        reason: 'WRITE_RESPONSE_BLOCKED',
        title: 'Esta operación no se ejecutó.',
        message:
          intent === 'REGISTER_SALE' ||
          intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
          intent === 'REGISTER_PAYABLE_PAYMENT' ||
          intent === 'REGISTER_EXPENSE' ||
          intent === 'REGISTER_PURCHASE' ||
          intent === 'CREATE_CLIENT' ||
          intent === 'UPDATE_CLIENT'
            ? 'No se pudo confirmar el resultado de forma segura.'
            : 'La ejecución conversacional de esta acción todavía no está habilitada.',
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
