import { NaturalLanguageAssistantService } from '../natural-language-assistant.service';
import { ReferenceResolverService } from '../../context/reference-resolver.service';
import { WORKING_CONTEXT_SCHEMA_VERSION } from '../../context/working-context';

function buildFieldLockService(overrides: {
  lockResolve?: jest.Mock;
  executeClaimed?: jest.Mock;
  provider?: jest.Mock;
} = {}) {
  const request = { id: 'ar-lock-1', traceId: 'trace-lock', receivedAt: new Date('2026-08-11T00:00:00Z') };
  const aiRequests = {
    claimText: jest.fn().mockResolvedValue({ kind: 'OWNED', request }),
    recordInterpretation: jest.fn().mockResolvedValue(undefined),
    recordProviderMetrics: jest.fn().mockResolvedValue(undefined),
    readInterpretation: jest.fn().mockReturnValue({ intent: null, entities: {} }),
    auditReplay: jest.fn().mockResolvedValue(undefined),
    failUnattached: jest.fn().mockImplementation((_r, _a, _i, response) => response),
  };
  const intentAdapter = { interpret: overrides.provider ?? jest.fn() };
  const executeClaimed =
    overrides.executeClaimed ??
    jest.fn().mockResolvedValue({
      requestId: 'ar-lock-1',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'READY_FOR_CONFIRMATION',
      responseType: 'ACTION_PREVIEW_CARD',
      payload: { capability: 'REGISTER_SALE' },
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-lock',
      createdAt: '2026-08-11T00:00:00.000Z',
    });
  const assistant = { executeClaimed };
  const workingContext = {
    load: jest.fn().mockResolvedValue({
      working: {
        schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
        lastIntent: 'REGISTER_SALE',
        pendingMissingFields: ['watchId'],
        contextUpdatedAt: new Date().toISOString(),
      },
      version: 3,
      resolvedContextRaw: {
        conversationDraft: {
          schemaVersion: '1',
          capability: 'REGISTER_SALE',
          status: 'ACTIVE',
          updatedAt: new Date().toISOString(),
          customer: { resolvedId: 'c1', label: 'Bruce Wayne', confidence: 'RESOLVED' },
          amount: { value: 10000, currency: 'USD' },
        },
      },
    }),
    persistSelection: jest.fn(),
    persistClarificationTurn: jest.fn(),
    persistEntityPickerTurn: jest.fn().mockResolvedValue({ conversationId: 'c1', workspaceId: 'w1', version: 4 }),
    readConversationDraft: jest.fn().mockReturnValue({
      schemaVersion: '1',
      capability: 'REGISTER_SALE',
      status: 'ACTIVE',
      updatedAt: new Date().toISOString(),
      customer: { resolvedId: 'c1', label: 'Bruce Wayne', confidence: 'RESOLVED' },
      amount: { value: 10000, currency: 'USD' },
    }),
    buildAuditFromResolution: jest.fn(),
  };
  const clarificationFieldLock = {
    resolve:
      overrides.lockResolve ??
      jest.fn().mockResolvedValue({
        kind: 'BOUND',
        entities: {
          customerId: 'c1',
          customerName: 'Bruce Wayne',
          price: 10000,
          currency: 'USD',
          watchId: 'w-bruce',
          watchLabel: 'Rolex Bruce Wayne',
        },
      }),
  };
  const prisma = { aIRequest: { findFirst: jest.fn().mockResolvedValue(null) } };
  const compositionOrchestrator = {
    loadActive: jest.fn().mockResolvedValue({ composition: null, version: 1, resolvedContext: {} }),
  };
  const service = new NaturalLanguageAssistantService(
    aiRequests as never,
    intentAdapter as never,
    assistant as never,
    new ReferenceResolverService(),
    workingContext as never,
    prisma as never,
    compositionOrchestrator as never,
    clarificationFieldLock as never,
  );
  return { service, aiRequests, intentAdapter, executeClaimed, clarificationFieldLock, workingContext };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };

describe('NaturalLanguageAssistantService: clarification field lock', () => {
  it('pending watch answer continues REGISTER_SALE without calling the LLM or opening CLIENT picker', async () => {
    const provider = jest.fn();
    const { service, aiRequests, intentAdapter, executeClaimed, clarificationFieldLock } = buildFieldLockService({
      provider,
    });

    const result = await service.handleMessage(actor, {
      text: 'Bruce Wayne',
      surface: 'DESKTOP',
      clientRequestId: 'lock-1',
      conversationId: 'c1',
      workspaceId: 'w1',
    });

    expect(clarificationFieldLock.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingField: 'watchId',
        answer: 'Bruce Wayne',
        intent: 'REGISTER_SALE',
      }),
    );
    expect(provider).not.toHaveBeenCalled();
    expect(intentAdapter.interpret).not.toHaveBeenCalled();
    expect(executeClaimed).toHaveBeenCalledTimes(1);
    const [, structured] = executeClaimed.mock.calls[0];
    expect(structured.intent).toBe('REGISTER_SALE');
    expect(structured.entities.watchId).toBe('w-bruce');
    expect(structured.entities.customerId).toBe('c1');
    expect(result.response.responseType).not.toBe('ENTITY_PICKER');
    expect(result.response.payload?.entityType).not.toBe('CLIENT');
    expect(aiRequests.recordInterpretation).toHaveBeenCalledWith(
      'ar-lock-1',
      expect.objectContaining({ intent: 'REGISTER_SALE' }),
    );
  });

  it('NO_MATCH falls back to unrestricted NLP', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'SEARCH_CLIENT',
        entities: { query: 'Bruce Wayne' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: true,
        isWriteIntent: false,
        candidateHash: 'hash-fallback',
      },
      provider: 'fake',
      model: 'fake',
      latencyMs: 1,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-lock-1',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'COMPLETED',
      responseType: 'ENTITY_LIST',
      payload: {},
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-lock',
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    const { service, clarificationFieldLock } = buildFieldLockService({
      provider,
      executeClaimed,
      lockResolve: jest.fn().mockResolvedValue({ kind: 'NO_MATCH' }),
    });

    await service.handleMessage(actor, {
      text: 'Bruce Wayne',
      surface: 'DESKTOP',
      clientRequestId: 'lock-2',
      conversationId: 'c1',
      workspaceId: 'w1',
    });

    expect(clarificationFieldLock.resolve).toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(executeClaimed).toHaveBeenCalled();
  });

  it('expense Pesos lock continues without LLM', async () => {
    const provider = jest.fn();
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-lock-1',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'NEEDS_INPUT',
      responseType: 'MISSING_FIELDS_CARD',
      payload: { clarificationField: 'source' },
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-lock',
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    const { service, workingContext } = buildFieldLockService({
      provider,
      executeClaimed,
      lockResolve: jest.fn().mockResolvedValue({
        kind: 'BOUND',
        entities: { amount: 500, concept: 'gasolina', currency: 'MXN' },
      }),
    });
    workingContext.load.mockResolvedValue({
      working: {
        schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
        lastIntent: 'REGISTER_EXPENSE',
        pendingMissingFields: ['currency'],
        contextUpdatedAt: new Date().toISOString(),
      },
      version: 2,
      resolvedContextRaw: {
        conversationDraft: {
          schemaVersion: '1',
          capability: 'REGISTER_EXPENSE',
          status: 'ACTIVE',
          updatedAt: new Date().toISOString(),
          metadata: { amount: 500, concept: 'gasolina' },
        },
      },
    });
    workingContext.readConversationDraft.mockReturnValue({
      schemaVersion: '1',
      capability: 'REGISTER_EXPENSE',
      status: 'ACTIVE',
      updatedAt: new Date().toISOString(),
      metadata: { amount: 500, concept: 'gasolina' },
    });

    await service.handleMessage(actor, {
      text: 'Pesos',
      surface: 'DESKTOP',
      clientRequestId: 'lock-3',
      conversationId: 'c1',
      workspaceId: 'w1',
    });

    expect(provider).not.toHaveBeenCalled();
    expect(executeClaimed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        intent: 'REGISTER_EXPENSE',
        entities: expect.objectContaining({ currency: 'MXN', amount: 500 }),
      }),
      expect.anything(),
    );
  });

  it('Cancela clears pending draft without field lock or NLP', async () => {
    const provider = jest.fn();
    const { service, aiRequests, clarificationFieldLock, workingContext } = buildFieldLockService({
      provider,
    });
    workingContext.load.mockResolvedValue({
      working: {
        schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
        lastIntent: 'REGISTER_SALE',
        pendingMissingFields: ['customerId'],
        contextUpdatedAt: new Date().toISOString(),
      },
      version: 2,
      resolvedContextRaw: { pendingClarificationEntities: { watchQuery: 'Batman' } },
    });
    workingContext.persistClarificationTurn.mockResolvedValue({
      conversationId: 'c1',
      workspaceId: 'w1',
      version: 3,
    });

    const result = await service.handleMessage(actor, {
      text: 'Cancela.',
      surface: 'DESKTOP',
      clientRequestId: 'lock-cancel',
      conversationId: 'c1',
      workspaceId: 'w1',
    });

    expect(clarificationFieldLock.resolve).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(workingContext.persistClarificationTurn).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'CLEAR', intent: 'REGISTER_SALE' }),
    );
    expect(aiRequests.failUnattached).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'REGISTER_SALE',
      expect.objectContaining({
        payload: expect.objectContaining({
          message: 'De acuerdo. Cancelé ese borrador.',
          code: 'CLARIFICATION_CANCELLED',
        }),
      }),
      'CLARIFICATION_CANCELLED',
    );
    expect(result.response.payload.message).toMatch(/cancelé ese borrador/i);
  });

  it('high-confidence new expense intent abandons sale draft and runs NLP', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: {
        intent: 'REGISTER_EXPENSE',
        entities: { amount: 500, currency: 'MXN', concept: 'gasto' },
        missingEntities: [],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
        isReadIntent: false,
        isWriteIntent: true,
        candidateHash: 'hash-expense',
      },
      provider: 'fake',
      model: 'fake',
      latencyMs: 1,
      schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue({
      requestId: 'ar-lock-1',
      conversationId: 'c1',
      workspaceId: 'w1',
      interactionState: 'NEEDS_INPUT',
      responseType: 'MISSING_FIELDS_CARD',
      payload: { clarificationField: 'source' },
      warnings: [],
      suggestedActions: [],
      traceId: 'trace-lock',
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    const { service, clarificationFieldLock, workingContext } = buildFieldLockService({
      provider,
      executeClaimed,
    });
    workingContext.load.mockResolvedValue({
      working: {
        schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
        lastIntent: 'REGISTER_SALE',
        pendingMissingFields: ['customerId'],
        contextUpdatedAt: new Date().toISOString(),
      },
      version: 2,
      resolvedContextRaw: { pendingClarificationEntities: { watchQuery: 'Batman' } },
    });
    workingContext.persistClarificationTurn.mockResolvedValue({
      conversationId: 'c1',
      workspaceId: 'w1',
      version: 3,
    });

    await service.handleMessage(actor, {
      text: 'Registra un gasto de 500 pesos.',
      surface: 'DESKTOP',
      clientRequestId: 'lock-topic',
      conversationId: 'c1',
      workspaceId: 'w1',
    });

    expect(clarificationFieldLock.resolve).not.toHaveBeenCalled();
    expect(workingContext.persistClarificationTurn).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'CLEAR', intent: 'REGISTER_SALE' }),
    );
    expect(provider).toHaveBeenCalledTimes(1);
    const interpretInput = provider.mock.calls[0][0];
    expect(interpretInput.conversationContext?.pendingMissingFields).toBeUndefined();
    expect(executeClaimed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ intent: 'REGISTER_EXPENSE' }),
      expect.anything(),
    );
  });
});
