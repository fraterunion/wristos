import { ConflictException } from '@nestjs/common';
import { AIRequestStatus } from '@prisma/client';
import { sha256Canonical } from '../../domain/canonical-json';
import { deriveStructuredClientRequestId, NaturalLanguageAssistantService } from '../natural-language-assistant.service';

function buildService(overrides: { findUnique?: jest.Mock; provider?: jest.Mock; execute?: jest.Mock } = {}) {
  const prisma = {
    aIRequest: { findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(null) },
    aIAuditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const aiRequests = { readStoredResponse: jest.fn((request) => request.responsePayload) };
  const intentAdapter = { interpret: overrides.provider ?? jest.fn() };
  const assistant = { execute: overrides.execute ?? jest.fn() };
  const service = new NaturalLanguageAssistantService(prisma as never, aiRequests as never, intentAdapter as never, assistant as never);
  return { service, prisma, aiRequests, intentAdapter, assistant };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };
const baseDto = { text: 'Muéstrame mi liquidez', surface: 'MOBILE' as const, clientRequestId: 'msg-1' };

describe('NaturalLanguageAssistantService: delegates only to IntentAdapterService and the existing orchestrator', () => {
  it('on a fresh message, calls the intent adapter then the orchestrator exactly once each, never a tool/domain service', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash1' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const execute = jest.fn().mockResolvedValue({ requestId: 'r1', conversationId: 'c1', workspaceId: 'w1', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 't1', createdAt: '2026-08-07T00:00:00.000Z' });
    const { service } = buildService({ provider, execute });

    const result = await service.handleMessage(actor, baseDto);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.resolvedIntent).toBe('GET_LIQUIDITY');
    // The orchestrator call must carry the intent+entities the adapter produced, nothing invented.
    const [, structuredRequest] = execute.mock.calls[0];
    expect(structuredRequest.intent).toBe('GET_LIQUIDITY');
    expect(structuredRequest.entities).toEqual({});
    // Returned to the caller too, so the frontend can carry it forward the
    // same way it already does for the structured endpoint's own history.
    expect(result.resolvedEntities).toEqual({});
  });

  it('replays the exact stored response for the same clientRequestId + same text, without calling the provider again', async () => {
    const textHash = sha256Canonical('Muéstrame mi liquidez');
    const storedResponse = { requestId: 'r1', conversationId: 'c1', workspaceId: 'w1', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 't1', createdAt: '2026-08-07T00:00:00.000Z' };
    const findUnique = jest.fn().mockResolvedValue({
      status: AIRequestStatus.COMPLETED,
      requestPayload: { intent: 'GET_LIQUIDITY', userDisplayTextHash: textHash },
      responsePayload: storedResponse,
    });
    const provider = jest.fn();
    const execute = jest.fn();
    const { service } = buildService({ findUnique, provider, execute });

    const result = await service.handleMessage(actor, baseDto);

    expect(provider).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('GET_LIQUIDITY');
    expect(result.response).toBe(storedResponse);
  });

  it('rejects (409) reuse of the same clientRequestId with different text, without calling the provider', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      status: AIRequestStatus.COMPLETED,
      requestPayload: { intent: 'GET_LIQUIDITY', userDisplayTextHash: sha256Canonical('a completely different message') },
      responsePayload: {},
    });
    const provider = jest.fn();
    const { service, prisma } = buildService({ findUnique, provider });

    await expect(service.handleMessage(actor, baseDto)).rejects.toBeInstanceOf(ConflictException);
    expect(provider).not.toHaveBeenCalled();
    // Still records an audit trail of the rejected attempt.
    expect(prisma.aIAuditEvent.create).toHaveBeenCalled();
  });

  it('a LOW-confidence candidate never reaches the orchestrator', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'REGISTER_SALE', entities: { watchQuery: 'Batman' }, missingEntities: ['watchId', 'customerId', 'price', 'currency'], ambiguities: [], confidence: 'LOW', language: 'es', isReadIntent: false, isWriteIntent: true, candidateHash: 'hash2' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const execute = jest.fn();
    const { service } = buildService({ provider, execute });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'Vendí Batman' });

    expect(execute).not.toHaveBeenCalled();
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
    const execute = jest.fn();
    const { service } = buildService({ provider, execute });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'algo incomprensible' });

    expect(execute).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('UNKNOWN');
    expect(result.response.interactionState).toBe('FAILED');
  });

  it('a flagged ambiguity never reaches the orchestrator and surfaces a MISSING_FIELDS_CARD-shaped clarification', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'SEARCH_CLIENT', entities: { query: 'José' }, missingEntities: [], ambiguities: [{ field: 'query', reason: 'multiple Josés known' }], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash4' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const execute = jest.fn();
    const { service } = buildService({ provider, execute });

    const result = await service.handleMessage(actor, { ...baseDto, text: 'Busca a José' });

    expect(execute).not.toHaveBeenCalled();
    expect(result.response.responseType).toBe('MISSING_FIELDS_CARD');
    expect(result.response.interactionState).toBe('NEEDS_INPUT');
  });

  it('a provider timeout never reaches the orchestrator and returns a safe, non-raw failure message', async () => {
    const provider = jest.fn().mockResolvedValue({ kind: 'PROVIDER_FAILURE', failureType: 'TIMEOUT', provider: 'claude', model: 'claude-x', latencyMs: 12000, schemaVersion: '1.0.0' });
    const execute = jest.fn();
    const { service } = buildService({ provider, execute });

    const result = await service.handleMessage(actor, baseDto);

    expect(execute).not.toHaveBeenCalled();
    expect(result.resolvedIntent).toBe('UNKNOWN');
    // A categorical failure code (e.g. "TIMEOUT") is fine; a raw provider
    // exception class/stack/connection detail is not.
    expect(JSON.stringify(result.response)).not.toMatch(/APIConnectionTimeoutError|ETIMEDOUT|ECONNRESET|at Object\.<anonymous>/i);
    expect(result.response.payload.message).toBe('El asistente no está disponible en este momento. No se realizó ningún cambio.');
  });

  it('audit events never contain the raw message text, a system prompt, or provider chain-of-thought', async () => {
    const provider = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash1' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const execute = jest.fn().mockResolvedValue({ requestId: 'r1', conversationId: '', workspaceId: '', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 't1', createdAt: '2026-08-07T00:00:00.000Z' });
    const { service, prisma } = buildService({ provider, execute });

    const secretText = 'Muéstrame mi liquidez, número de cuenta 1234-5678-9999';
    await service.handleMessage(actor, { ...baseDto, text: secretText });

    const auditPayloads = prisma.aIAuditEvent.create.mock.calls.map((call) => JSON.stringify(call[0].data));
    for (const payload of auditPayloads) {
      expect(payload).not.toContain(secretText);
      expect(payload).not.toContain('1234-5678-9999');
      expect(payload.toLowerCase()).not.toContain('system prompt');
    }
  });
});

describe('deriveStructuredClientRequestId', () => {
  it('is a pure, deterministic function of (tenant, user, message clientRequestId) only — never of the text', () => {
    const a = deriveStructuredClientRequestId(actor, 'msg-1');
    const b = deriveStructuredClientRequestId(actor, 'msg-1');
    expect(a).toBe(b);
    expect(a.startsWith('nlmsg:')).toBe(true);
  });

  it('differs across users/tenants for the same message id, and across message ids for the same user', () => {
    const a = deriveStructuredClientRequestId(actor, 'msg-1');
    const b = deriveStructuredClientRequestId({ ...actor, userId: 'u2' }, 'msg-1');
    const c = deriveStructuredClientRequestId(actor, 'msg-2');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
