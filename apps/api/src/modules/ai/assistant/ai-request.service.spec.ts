import { ConflictException } from '@nestjs/common';
import { AIAuditEventType, AIRequestStatus, Prisma } from '@prisma/client';
import { AIRequestService } from './ai-request.service';
import { sha256Canonical } from '../domain/canonical-json';

describe('AIRequestService durable idempotency', () => {
  const tx = { aIRequest: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() }, aIAuditEvent: { create: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    aIRequest: { findUniqueOrThrow: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    aIAuditEvent: { create: jest.fn() },
  };
  const service = new AIRequestService(prisma as never);
  const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] };
  const input = { intent: 'SEARCH_CLIENT' as const, entities: { query: 'private@example.com' }, surface: 'API' as const, clientRequestId: 'req-1' };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx));
  });

  it('claims a request once and stores only a hashed sensitive entity', async () => {
    tx.aIRequest.create.mockImplementation(({ data }) => ({ id: 'ar1', status: AIRequestStatus.RECEIVED, receivedAt: new Date(), updatedAt: new Date(), ...data }));
    const claim = await service.claim(actor, input);
    expect(claim.kind).toBe('OWNED');
    const stored = tx.aIRequest.create.mock.calls[0][0].data.requestPayload;
    expect(stored.entities.query).toEqual({ redactedHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(tx.aIAuditEvent.create.mock.calls)).not.toContain('private@example.com');
  });

  it('returns the exact stored response when the same request is replayed', async () => {
    const response = { requestId: 'ar1', conversationId: 'c1', workspaceId: 'w1', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: { total: '1.20' }, warnings: [], suggestedActions: [], traceId: 'trace', createdAt: '2026-08-06T00:00:00.000Z' } as const;
    const first = { id: 'ar1', tenantId: 't1', actorUserId: 'u1', status: AIRequestStatus.COMPLETED, requestFingerprint: '', responsePayload: response, responseHash: service.responseHash(response as never), receivedAt: new Date(), updatedAt: new Date(), traceId: 'trace' };
    tx.aIRequest.create.mockImplementationOnce(() => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.3' }); });
    prisma.aIRequest.findUniqueOrThrow.mockResolvedValue(first);
    const ownedFingerprint = fingerprint(actor, input);
    first.requestFingerprint = ownedFingerprint;
    const claim = await service.claim(actor, input);
    expect(claim).toEqual(expect.objectContaining({ kind: 'REPLAY', response }));
    expect(tx.aIRequest.create).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a request ID with a different logical payload', async () => {
    tx.aIRequest.create.mockImplementation(() => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.3' }); });
    prisma.aIRequest.findUniqueOrThrow.mockResolvedValue({ id: 'ar1', tenantId: 't1', actorUserId: 'u1', clientRequestId: 'req-1', status: AIRequestStatus.COMPLETED, requestFingerprint: 'different', receivedAt: new Date(), updatedAt: new Date(), traceId: 'trace' });
    await expect(service.claim(actor, input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not start duplicate orchestration while an identical request is active', async () => {
    const requestFingerprint = fingerprint(actor, input);
    tx.aIRequest.create.mockImplementation(() => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.3' }); });
    prisma.aIRequest.findUniqueOrThrow.mockResolvedValue({ id: 'ar1', tenantId: 't1', actorUserId: 'u1', status: AIRequestStatus.EXECUTING, requestFingerprint, conversationId: 'c1', workspaceId: 'w1', actionRunId: 'run1', receivedAt: new Date(), updatedAt: new Date(), traceId: 'trace' });
    const claim = await service.claim(actor, input);
    expect(claim.kind).toBe('IN_PROGRESS');
  });

  function fingerprint(context: typeof actor, request: typeof input): string {
    return sha256Canonical({ tenantId: context.tenantId, actorUserId: context.userId, intent: request.intent, entities: { query: { redactedHash: sha256Canonical(request.entities.query) } }, entityVersions: {}, expectedWorkspaceVersion: null, surface: request.surface, locale: 'es-MX', timezone: 'UTC', conversationId: null, workspaceId: null });
  }

  function textFingerprint(text: string, surface = 'MOBILE') {
    return sha256Canonical({ tenantId: actor.tenantId, actorUserId: actor.userId, phase: 'INTENT_INTERPRETATION', textHash: sha256Canonical(text), surface, locale: 'es-MX', timezone: 'UTC', conversationId: null, workspaceId: null });
  }

  describe('claimText: the pre-provider durable claim for natural-language messages', () => {
    const textParams = { clientRequestId: 'msg-1', text: 'Muéstrame mi liquidez', surface: 'MOBILE' as const };

    it('claims once, keyed on a text-based fingerprint, before any intent is known', async () => {
      tx.aIRequest.create.mockImplementation(({ data }) => ({ id: 'ar1', status: AIRequestStatus.RECEIVED, receivedAt: new Date(), updatedAt: new Date(), ...data }));
      const claim = await service.claimText(actor, textParams);
      expect(claim.kind).toBe('OWNED');
      const stored = tx.aIRequest.create.mock.calls[0][0].data;
      expect(stored.requestPayload.phase).toBe('INTENT_INTERPRETATION');
      expect(stored.requestPayload.textHash).toBe(sha256Canonical(textParams.text));
      // The raw text itself is never persisted in the canonical payload.
      expect(JSON.stringify(stored)).not.toContain('Muéstrame mi liquidez');
    });

    it('rejects reuse of the same clientRequestId with different text -- before any provider call could happen', async () => {
      tx.aIRequest.create.mockImplementation(() => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.3' }); });
      prisma.aIRequest.findUniqueOrThrow.mockResolvedValue({ id: 'ar1', tenantId: 't1', actorUserId: 'u1', clientRequestId: 'msg-1', status: AIRequestStatus.COMPLETED, requestFingerprint: textFingerprint('a totally different message'), receivedAt: new Date(), updatedAt: new Date(), traceId: 'trace' });
      await expect(service.claimText(actor, textParams)).rejects.toBeInstanceOf(ConflictException);
    });

    it('replays the exact stored response for the same clientRequestId + same text', async () => {
      const response = { requestId: 'ar1', conversationId: '', workspaceId: '', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace', createdAt: '2026-08-06T00:00:00.000Z' } as const;
      tx.aIRequest.create.mockImplementationOnce(() => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.3' }); });
      prisma.aIRequest.findUniqueOrThrow.mockResolvedValue({ id: 'ar1', tenantId: 't1', actorUserId: 'u1', status: AIRequestStatus.COMPLETED, requestFingerprint: textFingerprint(textParams.text), responsePayload: response, responseHash: service.responseHash(response as never), receivedAt: new Date(), updatedAt: new Date(), traceId: 'trace' });
      const claim = await service.claimText(actor, textParams);
      expect(claim).toEqual(expect.objectContaining({ kind: 'REPLAY', response }));
    });

    it('reports IN_PROGRESS (never REPLAY, never a second OWNED) while an identical claim is still being interpreted', async () => {
      tx.aIRequest.create.mockImplementation(() => { throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.3' }); });
      prisma.aIRequest.findUniqueOrThrow.mockResolvedValue({ id: 'ar1', tenantId: 't1', actorUserId: 'u1', status: AIRequestStatus.RECEIVED, requestFingerprint: textFingerprint(textParams.text), receivedAt: new Date(), updatedAt: new Date(), traceId: 'trace' });
      const claim = await service.claimText(actor, textParams);
      expect(claim.kind).toBe('IN_PROGRESS');
    });
  });

  describe('recordInterpretation / readInterpretation', () => {
    it('denormalizes the resolved intent/entities onto the claimed row, sanitizing sensitive fields the same way canonicalRequest does', async () => {
      prisma.aIRequest.findUniqueOrThrow.mockResolvedValue({ id: 'ar1', requestPayload: { phase: 'INTENT_INTERPRETATION', textHash: 'x' } });
      await service.recordInterpretation('ar1', { intent: 'SEARCH_CLIENT', entities: { query: 'José Hernández' }, candidateHash: 'hash1' });
      const data = prisma.aIRequest.update.mock.calls[0][0].data;
      expect(data.requestPayload.resolvedIntent).toBe('SEARCH_CLIENT');
      expect(data.requestPayload.candidateHash).toBe('hash1');
      expect(data.requestPayload.resolvedEntities.query).toEqual({ redactedHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(JSON.stringify(data)).not.toContain('José Hernández');
      // The original claim payload survives alongside the new fields.
      expect(data.requestPayload.phase).toBe('INTENT_INTERPRETATION');
    });

    it('reads back a previously recorded interpretation', () => {
      const request = { requestPayload: { resolvedIntent: 'GET_LIQUIDITY', resolvedEntities: { foo: 'bar' } } };
      expect(service.readInterpretation(request as never)).toEqual({ intent: 'GET_LIQUIDITY', entities: { foo: 'bar' } });
    });

    it('returns nulls/empty when nothing was ever recorded (e.g. a provider-failure row)', () => {
      const request = { requestPayload: { phase: 'INTENT_INTERPRETATION', textHash: 'x' } };
      expect(service.readInterpretation(request as never)).toEqual({ intent: null, entities: {} });
    });
  });

  describe('auditReplay', () => {
    it('writes exactly one bounded ASSISTANT_REQUEST_REPLAYED event, never re-emitting the original interpretation lifecycle', async () => {
      const request = { id: 'ar1', tenantId: 't1', actorUserId: 'u1', conversationId: 'c1', workspaceId: 'w1', actionRunId: null, requestFingerprint: 'fp', traceId: 'trace', clientRequestId: 'msg-1', receivedAt: new Date(), requestPayload: { resolvedIntent: 'GET_LIQUIDITY' } };
      await service.auditReplay(actor, request as never);
      expect(prisma.aIAuditEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.aIAuditEvent.create.mock.calls[0][0].data.type).toBe(AIAuditEventType.ASSISTANT_REQUEST_REPLAYED);
      expect(prisma.aIAuditEvent.create.mock.calls[0][0].data.payload.intent).toBe('GET_LIQUIDITY');
    });
  });
});
