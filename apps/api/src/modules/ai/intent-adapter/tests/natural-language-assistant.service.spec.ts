import { ConflictException } from '@nestjs/common';
import { NaturalLanguageAssistantService } from '../natural-language-assistant.service';

function buildService(overrides: { claimText?: jest.Mock; provider?: jest.Mock; executeClaimed?: jest.Mock } = {}) {
  const request = { id: 'ar-1', traceId: 'trace-1', receivedAt: new Date('2026-08-07T00:00:00Z') };
  const aiRequests = {
    claimText: overrides.claimText ?? jest.fn().mockResolvedValue({ kind: 'OWNED', request }),
    recordInterpretation: jest.fn().mockResolvedValue(undefined),
    readInterpretation: jest.fn().mockReturnValue({ intent: null, entities: {} }),
    auditReplay: jest.fn().mockResolvedValue(undefined),
    failUnattached: jest.fn().mockImplementation((_request, _actor, _intent, response) => response),
  };
  const intentAdapter = { interpret: overrides.provider ?? jest.fn() };
  const assistant = { executeClaimed: overrides.executeClaimed ?? jest.fn() };
  const service = new NaturalLanguageAssistantService(aiRequests as never, intentAdapter as never, assistant as never);
  return { service, request, aiRequests, intentAdapter, assistant };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };
const baseDto = { text: 'Muéstrame mi liquidez', surface: 'MOBILE' as const, clientRequestId: 'msg-1' };

describe('NaturalLanguageAssistantService: claims durably BEFORE ever calling the provider', () => {
  it('on a fresh (OWNED) claim, calls the provider then continues the SAME durable identity via executeClaimed — never a second claim', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash1' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue({ requestId: 'ar-1', conversationId: 'c1', workspaceId: 'w1', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-07T00:00:00.000Z' });
    const { service, request, aiRequests } = buildService({ provider, executeClaimed });

    const result = await service.handleMessage(actor, baseDto);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(executeClaimed).toHaveBeenCalledTimes(1);
    // executeClaimed must be handed the SAME claimed request row, never a fresh claim() of its own.
    expect(executeClaimed.mock.calls[0][2]).toBe(request);
    expect(aiRequests.recordInterpretation).toHaveBeenCalledWith('ar-1', expect.objectContaining({ intent: 'GET_LIQUIDITY', candidateHash: 'hash1' }));
    expect(result.resolvedIntent).toBe('GET_LIQUIDITY');
    const [, structuredRequest] = executeClaimed.mock.calls[0];
    expect(structuredRequest.intent).toBe('GET_LIQUIDITY');
    expect(structuredRequest.entities).toEqual({});
    expect(structuredRequest.clientRequestId).toBe('msg-1');
    expect(result.resolvedEntities).toEqual({});
  });

  it('a REPLAY claim never calls the provider or the orchestrator, emits one bounded replay audit event, and returns the exact stored response', async () => {
    const storedResponse = { requestId: 'ar-1', conversationId: 'c1', workspaceId: 'w1', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-07T00:00:00.000Z' };
    const request = { id: 'ar-1', traceId: 'trace-1', receivedAt: new Date() };
    const claimText = jest.fn().mockResolvedValue({ kind: 'REPLAY', request, response: storedResponse });
    const provider = jest.fn();
    const executeClaimed = jest.fn();
    const { service, aiRequests } = buildService({ claimText, provider, executeClaimed });
    aiRequests.readInterpretation.mockReturnValue({ intent: 'GET_LIQUIDITY', entities: { query: { redactedHash: 'x'.repeat(64) } } });

    const result = await service.handleMessage(actor, baseDto);

    expect(provider).not.toHaveBeenCalled();
    expect(executeClaimed).not.toHaveBeenCalled();
    expect(aiRequests.auditReplay).toHaveBeenCalledTimes(1);
    expect(aiRequests.auditReplay).toHaveBeenCalledWith(actor, request);
    expect(result.resolvedIntent).toBe('GET_LIQUIDITY');
    expect(result.response).toBe(storedResponse);
    // The sanitized/redacted store is never surfaced as if it were a real
    // entity value — the frontend reuses resolvedEntities to build
    // follow-up actions, so a {redactedHash} placeholder must never appear.
    expect(result.resolvedEntities).toEqual({});
  });

  it('this same REPLAY path also covers a previously-FAILED terminal claim (provider-failure replay): still zero provider calls', async () => {
    const storedResponse = { requestId: 'ar-1', conversationId: '', workspaceId: '', interactionState: 'FAILED', responseType: 'ERROR_RECOVERY_CARD', payload: { code: 'TIMEOUT' }, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-07T00:00:00.000Z' };
    const request = { id: 'ar-1', traceId: 'trace-1', receivedAt: new Date() };
    const claimText = jest.fn().mockResolvedValue({ kind: 'REPLAY', request, response: storedResponse });
    const provider = jest.fn();
    const { service } = buildService({ claimText, provider });

    const result = await service.handleMessage(actor, baseDto);

    expect(provider).not.toHaveBeenCalled();
    expect(result.response).toBe(storedResponse);
  });

  it('an IN_PROGRESS claim (a concurrent identical request still being interpreted) never calls the provider a second time', async () => {
    const inProgressResponse = { requestId: 'ar-1', conversationId: '', workspaceId: '', interactionState: 'ANSWERING', responseType: 'TEXT_ANSWER', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace-1', createdAt: '2026-08-07T00:00:00.000Z' };
    const claimText = jest.fn().mockResolvedValue({ kind: 'IN_PROGRESS', request: { id: 'ar-1' }, response: inProgressResponse });
    const provider = jest.fn();
    const executeClaimed = jest.fn();
    const { service } = buildService({ claimText, provider, executeClaimed });

    const result = await service.handleMessage(actor, baseDto);

    expect(provider).not.toHaveBeenCalled();
    expect(executeClaimed).not.toHaveBeenCalled();
    expect(result.response).toBe(inProgressResponse);
  });

  it('propagates the 409 conflict from claimText untouched — same clientRequestId, different text, before any provider call', async () => {
    const claimText = jest.fn().mockRejectedValue(new ConflictException('Este identificador de solicitud ya fue utilizado con contenido diferente.'));
    const provider = jest.fn();
    const { service } = buildService({ claimText, provider });

    await expect(service.handleMessage(actor, baseDto)).rejects.toBeInstanceOf(ConflictException);
    expect(provider).not.toHaveBeenCalled();
  });

  it('a LOW-confidence candidate never reaches the orchestrator and terminally fails the SAME claimed row', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'REGISTER_SALE', entities: { watchQuery: 'Batman' }, missingEntities: ['watchId', 'customerId', 'price', 'currency'], ambiguities: [], confidence: 'LOW', language: 'es', isReadIntent: false, isWriteIntent: true, candidateHash: 'hash2' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn();
    const { service, request, aiRequests } = buildService({ provider, executeClaimed });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'Vendí Batman' });

    expect(executeClaimed).not.toHaveBeenCalled();
    expect(aiRequests.failUnattached).toHaveBeenCalledWith(request, actor, 'REGISTER_SALE', expect.anything(), 'REJECT_LOW_CONFIDENCE');
    expect(result.resolvedIntent).toBe('REGISTER_SALE');
    expect(result.response.interactionState).toBe('FAILED');
    expect(result.response.payload.message).toMatch(/no entendí/i);
  });

  it('an UNKNOWN candidate never reaches the orchestrator and returns a safe typed response', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'UNKNOWN', entities: {}, missingEntities: [], ambiguities: [], confidence: 'LOW', language: 'es', isReadIntent: false, isWriteIntent: false, candidateHash: 'hash3' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn();
    const { service } = buildService({ provider, executeClaimed });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'algo incomprensible' });

    expect(executeClaimed).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('UNKNOWN');
    expect(result.response.interactionState).toBe('FAILED');
  });

  it('a flagged ambiguity never reaches the orchestrator and surfaces a MISSING_FIELDS_CARD-shaped clarification', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'SEARCH_CLIENT', entities: { query: 'José' }, missingEntities: [], ambiguities: [{ field: 'query', reason: 'multiple Josés known' }], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash4' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn();
    const { service } = buildService({ provider, executeClaimed });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'Busca a José' });

    expect(executeClaimed).not.toHaveBeenCalled();
    expect(result.response.responseType).toBe('MISSING_FIELDS_CARD');
    expect(result.response.interactionState).toBe('NEEDS_INPUT');
  });

  it('a provider timeout never reaches the orchestrator, terminally fails the claimed row, and returns a safe, non-raw failure message', async () => {
    const provider = jest.fn().mockResolvedValue({ kind: 'PROVIDER_FAILURE', failureType: 'TIMEOUT', provider: 'claude', model: 'claude-x', latencyMs: 12000, schemaVersion: '1.0.0' });
    const executeClaimed = jest.fn();
    const { service, request, aiRequests } = buildService({ provider, executeClaimed });

    const result = await service.handleMessage(actor, baseDto);

    expect(executeClaimed).not.toHaveBeenCalled();
    expect(aiRequests.failUnattached).toHaveBeenCalledWith(request, actor, 'UNKNOWN', expect.anything(), 'TIMEOUT');
    expect(result.resolvedIntent).toBe('UNKNOWN');
    // A categorical failure code (e.g. "TIMEOUT") is fine; a raw provider
    // exception class/stack/connection detail is not.
    expect(JSON.stringify(result.response)).not.toMatch(/APIConnectionTimeoutError|ETIMEDOUT|ECONNRESET|at Object\.<anonymous>/i);
    expect(result.response.payload.message).toBe('El asistente no está disponible en este momento. No se realizó ningún cambio.');
  });

  it('invalid structured provider output fails closed the same way a provider outage does — never reaches the orchestrator', async () => {
    const provider = jest.fn().mockResolvedValue({ kind: 'INVALID_OUTPUT', reason: 'ENTITY_SCHEMA_INVALID', issueCount: 2, issuePaths: ['entities.price'], provider: 'claude', model: 'claude-x', latencyMs: 400, schemaVersion: '1.0.0' });
    const executeClaimed = jest.fn();
    const { service, aiRequests } = buildService({ provider, executeClaimed });

    const result = await service.handleMessage(actor, baseDto);

    expect(executeClaimed).not.toHaveBeenCalled();
    expect(aiRequests.failUnattached).toHaveBeenCalledWith(expect.anything(), actor, 'UNKNOWN', expect.anything(), 'ENTITY_SCHEMA_INVALID');
    expect(result.resolvedIntent).toBe('UNKNOWN');
    expect(result.response.interactionState).toBe('FAILED');
  });

  it('never touches Prisma directly — all durable state goes through AIRequestService', () => {
    // Structural guarantee: the constructor accepts no PrismaService at all,
    // so there is no way for this service to read or write a business table
    // or bypass AIRequestService's own idempotency/audit bookkeeping.
    expect(NaturalLanguageAssistantService.length).toBe(3);
  });
});
