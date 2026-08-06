import { ConflictException } from '@nestjs/common';
import { AIRequestStatus, Prisma } from '@prisma/client';
import { AIRequestService } from './ai-request.service';
import { sha256Canonical } from '../domain/canonical-json';

describe('AIRequestService durable idempotency', () => {
  const tx = { aIRequest: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() }, aIAuditEvent: { create: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    aIRequest: { findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
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
});
