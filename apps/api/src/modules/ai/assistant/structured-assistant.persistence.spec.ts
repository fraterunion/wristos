import { AIAuditEventType, AIRequestStatus } from '@prisma/client';
import { draftToEntities, entitiesToDraftPatch, applyDraftPatch } from '../context/conversation-draft';
import { StructuredAssistantPersistence } from './structured-assistant.persistence';
import { StructuredAssistantResponse } from './structured-assistant.types';

function draftFromFlatEntities(capability: string, entities: Record<string, string | number | boolean>) {
  return applyDraftPatch(null, entitiesToDraftPatch(capability, entities), capability);
}

function buildTx(currentResolvedContext: unknown) {
  return {
    aIRequest: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ receivedAt: new Date(), requestPayload: {} }),
      update: jest.fn().mockResolvedValue({}),
    },
    aIMessage: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
    aIAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    aIWorkspace: {
      findFirst: jest.fn().mockResolvedValue({ resolvedContext: currentResolvedContext }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function buildService(currentResolvedContext: unknown) {
  const tx = buildTx(currentResolvedContext);
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const persistence = new StructuredAssistantPersistence(prisma as never);
  return { persistence, tx };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };

function pickerResponse(): StructuredAssistantResponse {
  return {
    requestId: 'ar-1',
    conversationId: 'c1',
    workspaceId: 'w1',
    interactionState: 'NEEDS_DISAMBIGUATION',
    responseType: 'ENTITY_PICKER',
    payload: {
      message: 'Encontré varios clientes llamados Abraham.',
      entityType: 'CLIENT',
      data: {
        items: [
          { id: 'client-abraham-diaz', name: 'Abraham Díaz' },
          { id: 'client-abraham-valdez', name: 'Abraham Valdez' },
          { id: 'client-abraham-bosquez', name: 'Abraham Bosquez' },
        ],
      },
      unchanged: 'No se ejecutó ninguna acción.',
      nextAction: 'Elige.',
    },
    warnings: [],
    suggestedActions: [],
    traceId: 'trace-1',
    createdAt: '2026-08-13T00:00:00.000Z',
  };
}

describe('StructuredAssistantPersistence.complete — the ConversationDraft persists across ENTITY_PICKER turns', () => {
  it('writes the full draft into resolvedContext.conversationDraft for an ENTITY_PICKER response', async () => {
    const { persistence, tx } = buildService({});

    await persistence.complete(
      'ar-1',
      actor,
      pickerResponse(),
      1,
      AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
      AIRequestStatus.NEEDS_CLARIFICATION,
      {
        intent: 'REGISTER_SALE',
        entities: {
          watchId: 'watch-bruce-wayne',
          price: '500000.00',
          currency: 'MXN',
          customerQuery: 'Abraham',
          paymentMode: 'PAID',
        },
      },
    );

    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    const draft = updateData.resolvedContext.conversationDraft;
    expect(draft.capability).toBe('REGISTER_SALE');
    expect(draftToEntities(draft)).toEqual({
      watchId: 'watch-bruce-wayne',
      price: '500000.00',
      currency: 'MXN',
      customerQuery: 'Abraham',
      paymentMode: 'PAID',
    });
    // The picker's own candidate list is durably remembered too (pre-existing behavior, unchanged).
    expect(updateData.resolvedContext.workingContext.lastPresentedCandidates.candidates).toHaveLength(3);
    expect(updateData.resolvedContext.workingContext.lastIntent).toBe('REGISTER_SALE');
  });

  it('a later picker turn in the same draft reflects whatever the caller supplied as the complete current snapshot', async () => {
    const { persistence, tx } = buildService({
      conversationDraft: draftFromFlatEntities('REGISTER_SALE', {
        watchId: 'watch-bruce-wayne',
        price: '500000.00',
        currency: 'MXN',
      }),
    });

    await persistence.complete(
      'ar-2',
      actor,
      pickerResponse(),
      2,
      AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
      AIRequestStatus.NEEDS_CLARIFICATION,
      {
        intent: 'REGISTER_SALE',
        entities: { watchId: 'watch-bruce-wayne', price: '500000.00', currency: 'MXN', customerQuery: 'Abraham' },
      },
    );

    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(draftToEntities(updateData.resolvedContext.conversationDraft)).toEqual({
      watchId: 'watch-bruce-wayne',
      price: '500000.00',
      currency: 'MXN',
      customerQuery: 'Abraham',
    });
  });

  it('a shown ACTION_PREVIEW_CARD keeps the draft alive (not confirmed yet — corrections must still be able to target it)', async () => {
    const { persistence, tx } = buildService({
      conversationDraft: draftFromFlatEntities('REGISTER_SALE', {
        watchId: 'watch-bruce-wayne',
        price: '500000.00',
        currency: 'MXN',
      }),
    });
    const preview: StructuredAssistantResponse = {
      requestId: 'ar-3',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION',
      responseType: 'ACTION_PREVIEW_CARD',
      payload: { message: 'Revisa y confirma.', unchanged: 'No se ejecutó ni modificó ningún dato de negocio.', nextAction: 'Confirma.' },
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-1',
      createdAt: '2026-08-13T00:00:00.000Z',
    };

    await persistence.complete(
      'ar-3',
      actor,
      preview,
      3,
      AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
      AIRequestStatus.READY_FOR_CONFIRMATION,
      {
        intent: 'REGISTER_SALE',
        entities: { watchId: 'watch-bruce-wayne', price: '500000.00', currency: 'MXN', customerId: 'client-abraham-valdez' },
      },
    );

    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(draftToEntities(updateData.resolvedContext.conversationDraft)).toEqual({
      watchId: 'watch-bruce-wayne',
      price: '500000.00',
      currency: 'MXN',
      customerId: 'client-abraham-valdez',
      clientId: 'client-abraham-valdez',
    });
  });

  it('clears the draft on a hard ERROR_RECOVERY_CARD failure', async () => {
    const { persistence, tx } = buildService({
      conversationDraft: draftFromFlatEntities('REGISTER_SALE', { watchId: 'watch-bruce-wayne' }),
    });
    const failure: StructuredAssistantResponse = {
      requestId: 'ar-4',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'FAILED',
      responseType: 'ERROR_RECOVERY_CARD',
      payload: { code: 'ORCHESTRATION_FAILED', message: 'No fue posible completar la solicitud.', unchanged: 'No se modificaron datos.', nextAction: 'Intenta de nuevo.' },
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-1',
      createdAt: '2026-08-13T00:00:00.000Z',
    };

    await persistence.complete(
      'ar-4',
      actor,
      failure,
      4,
      AIAuditEventType.ASSISTANT_REQUEST_FAILED,
      AIRequestStatus.FAILED,
      { intent: 'REGISTER_SALE', entities: { watchId: 'watch-bruce-wayne' } },
    );

    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(updateData.resolvedContext.conversationDraft).toBeUndefined();
  });
});
