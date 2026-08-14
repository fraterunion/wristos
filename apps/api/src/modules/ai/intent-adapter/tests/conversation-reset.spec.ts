import { NaturalLanguageAssistantService } from '../natural-language-assistant.service';
import { ReferenceResolverService } from '../../context/reference-resolver.service';

function buildService(overrides: {
  claimText?: jest.Mock;
  workingLoad?: jest.Mock;
  resetConversationTransaction?: jest.Mock;
} = {}) {
  const request = { id: 'ar-1', traceId: 'trace-1', receivedAt: new Date('2026-08-14T00:00:00Z') };
  const aiRequests = {
    claimText: overrides.claimText ?? jest.fn().mockResolvedValue({ kind: 'OWNED', request }),
    recordInterpretation: jest.fn().mockResolvedValue(undefined),
    recordProviderMetrics: jest.fn().mockResolvedValue(undefined),
    readInterpretation: jest.fn().mockReturnValue({ intent: null, entities: {} }),
    auditReplay: jest.fn().mockResolvedValue(undefined),
    failUnattached: jest.fn().mockImplementation((_request, _actor, _intent, response) => response),
  };
  const intentAdapter = { interpret: jest.fn() };
  const assistant = { executeClaimed: jest.fn() };
  const referenceResolver = new ReferenceResolverService();
  const workingContext = {
    load: overrides.workingLoad ?? jest.fn().mockResolvedValue({ working: null, version: 4, resolvedContextRaw: {} }),
    resetConversationTransaction:
      overrides.resetConversationTransaction ??
      jest.fn().mockResolvedValue({ conversationId: 'c1', workspaceId: 'w1', version: 5, cancelledActionRunId: null }),
    persistSelection: jest.fn(),
    persistClarificationTurn: jest.fn(),
    persistEntityPickerTurn: jest.fn(),
    clearStalePickerCandidates: jest.fn(),
    readConversationDraft: jest.fn().mockReturnValue(null),
    buildAuditFromResolution: jest.fn(),
  };
  const prisma = { aIRequest: { findFirst: jest.fn().mockResolvedValue(null) } };
  const compositionOrchestrator = {
    loadActive: jest.fn().mockResolvedValue({ composition: null, version: 1, resolvedContext: {} }),
    cancelComposition: jest.fn(),
    resumeParentAfterClient: jest.fn(),
  };
  const clarificationFieldLock = { resolve: jest.fn() };
  const operationalRouter = { route: () => ({ kind: 'NO_OPERATION_MATCH' }) };
  const service = new NaturalLanguageAssistantService(
    aiRequests as never,
    intentAdapter as never,
    assistant as never,
    referenceResolver,
    workingContext as never,
    prisma as never,
    compositionOrchestrator as never,
    clarificationFieldLock as never,
    operationalRouter as never,
  );
  return { service, request, aiRequests, workingContext, intentAdapter, assistant };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };
const baseDto = { surface: 'MOBILE' as const, clientRequestId: 'reset-1', workspaceId: 'w1', conversationId: 'c1' };

describe('NaturalLanguageAssistantService.resetConversation — "Empezar de nuevo"', () => {
  it('clears the workspace transaction state and returns the fixed confirmation copy — no provider, no planner, no router call', async () => {
    const { service, workingContext, intentAdapter, assistant } = buildService();

    const result = await service.resetConversation(actor, baseDto);

    expect(workingContext.resetConversationTransaction).toHaveBeenCalledWith('t1', 'u1', 'w1', 4);
    expect(intentAdapter.interpret).not.toHaveBeenCalled();
    expect(assistant.executeClaimed).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('UNKNOWN');
    expect(result.response.responseType).toBe('TEXT_ANSWER');
    expect(result.response.interactionState).toBe('COMPLETED');
    expect(result.response.payload.message).toBe('Listo. Empecemos de nuevo.');
    expect(result.resolvedEntities).toEqual({});
  });

  it('preserves conversationId — conversation history stays linked, only the transaction is cleared', async () => {
    const { service } = buildService();

    const result = await service.resetConversation(actor, baseDto);

    expect(result.response.conversationId).toBe('c1');
    expect(result.response.workspaceId).toBe('w1');
  });

  it('is durably claimed — a replayed clientRequestId returns the exact stored response without resetting again', async () => {
    const storedResponse = {
      requestId: 'ar-1', conversationId: 'c1', workspaceId: 'w1',
      interactionState: 'COMPLETED' as const, responseType: 'TEXT_ANSWER' as const,
      payload: { message: 'Listo. Empecemos de nuevo.' }, warnings: [], suggestedActions: [],
      traceId: 'trace-1', createdAt: '2026-08-14T00:00:00.000Z',
    };
    const claimText = jest.fn().mockResolvedValue({ kind: 'REPLAY', request: { id: 'ar-1' }, response: storedResponse });
    const { service, workingContext, aiRequests } = buildService({ claimText });

    const result = await service.resetConversation(actor, baseDto);

    expect(workingContext.resetConversationTransaction).not.toHaveBeenCalled();
    expect(aiRequests.auditReplay).toHaveBeenCalledTimes(1);
    expect(result.response).toBe(storedResponse);
  });

  it('an IN_PROGRESS claim (concurrent double-click) never resets twice', async () => {
    const inProgressResponse = {
      requestId: 'ar-1', conversationId: '', workspaceId: '', interactionState: 'ANSWERING' as const,
      responseType: 'TEXT_ANSWER' as const, payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-14T00:00:00.000Z',
    };
    const claimText = jest.fn().mockResolvedValue({ kind: 'IN_PROGRESS', request: { id: 'ar-1' }, response: inProgressResponse });
    const { service, workingContext } = buildService({ claimText });

    const result = await service.resetConversation(actor, baseDto);

    expect(workingContext.resetConversationTransaction).not.toHaveBeenCalled();
    expect(result.response).toBe(inProgressResponse);
  });

  it('no workspaceId at all (nothing to reset yet) still succeeds with the same confirmation copy', async () => {
    const { service, workingContext } = buildService();

    const result = await service.resetConversation(actor, { surface: 'MOBILE', clientRequestId: 'reset-2' });

    expect(workingContext.resetConversationTransaction).not.toHaveBeenCalled();
    expect(result.response.payload.message).toBe('Listo. Empecemos de nuevo.');
  });

  it('a workspace with no version (load returned null version) still succeeds without attempting the clear', async () => {
    const workingLoad = jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null });
    const { service, workingContext } = buildService({ workingLoad });

    const result = await service.resetConversation(actor, baseDto);

    expect(workingContext.resetConversationTransaction).not.toHaveBeenCalled();
    expect(result.response.payload.message).toBe('Listo. Empecemos de nuevo.');
  });

  it('a workspace that no longer exists (NotFoundException) still succeeds — genuinely nothing left to discard', async () => {
    const resetConversationTransaction = jest.fn().mockRejectedValue(new (require('@nestjs/common').NotFoundException)('AI workspace not found'));
    const { service } = buildService({ resetConversationTransaction });

    const result = await service.resetConversation(actor, baseDto);

    expect(result.response.payload.message).toBe('Listo. Empecemos de nuevo.');
  });

  it('a genuine conflict (stale version, real race) propagates instead of being silently swallowed', async () => {
    const resetConversationTransaction = jest.fn().mockRejectedValue(new (require('@nestjs/common').ConflictException)('AI workspace version is stale'));
    const { service } = buildService({ resetConversationTransaction });

    await expect(service.resetConversation(actor, baseDto)).rejects.toThrow('AI workspace version is stale');
  });

  it('terminally records the durable AIRequest row via failUnattached, matching every other non-executeClaimed response', async () => {
    const { service, aiRequests, request } = buildService();

    const result = await service.resetConversation(actor, baseDto);

    expect(aiRequests.failUnattached).toHaveBeenCalledWith(request, actor, 'UNKNOWN', result.response, 'CONVERSATION_RESET');
  });
});
