import { ConflictException } from '@nestjs/common';
import { AIRequestStatus, Prisma } from '@prisma/client';
import { AIRequestService } from '../../assistant/ai-request.service';
import { ReferenceResolverService } from '../../context/reference-resolver.service';
import { NaturalLanguageAssistantService } from '../natural-language-assistant.service';

/**
 * A fake Prisma client whose aIRequest.create() performs its uniqueness
 * check and insert as a single synchronous unit (no `await` in between),
 * exactly like a real Postgres unique-constraint INSERT commits atomically
 * regardless of what else is "in flight". This is what makes the race in
 * this file meaningful: it proves AIRequestService.claimText() is a genuine
 * check-and-set, not a separate read followed later by a write — the exact
 * shape of the original bug (a `findUnique` read, with the provider called
 * in between the read and any write ever happening).
 */
function createFakePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const auditEvents: Array<Record<string, unknown>> = [];
  let nextId = 1;

  function rowKey(tenantId: string, actorUserId: string, clientRequestId: string) {
    return `${tenantId}::${actorUserId}::${clientRequestId}`;
  }
  function findByCompoundKey(tenantId: string, actorUserId: string, clientRequestId: string) {
    return rows.get(rowKey(tenantId, actorUserId, clientRequestId));
  }
  function findById(id: string) {
    for (const row of rows.values()) if (row.id === id) return row;
    return undefined;
  }

  const aIRequestCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    const { data } = args;
    const key = rowKey(data.tenantId as string, data.actorUserId as string, data.clientRequestId as string);
    if (rows.has(key)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`tenantId`,`actorUserId`,`clientRequestId`)', { code: 'P2002', clientVersion: '6.19.3' });
    }
    const row = { id: `ar-${nextId++}`, status: AIRequestStatus.RECEIVED, receivedAt: new Date(), updatedAt: new Date(), conversationId: null, workspaceId: null, actionRunId: null, ...data };
    rows.set(key, row);
    return row;
  });

  const aIRequestUpdate = jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = findById(args.where.id);
    if (!row) throw new Error(`no row with id ${args.where.id}`);
    Object.assign(row, args.data, { updatedAt: new Date() });
    return row;
  });

  const aIAuditEventCreate = jest.fn((args: { data: Record<string, unknown> }) => {
    auditEvents.push(args.data);
    return args.data;
  });

  const tx = { aIRequest: { create: aIRequestCreate, update: aIRequestUpdate }, aIAuditEvent: { create: aIAuditEventCreate } };

  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    aIRequest: {
      findUniqueOrThrow: jest.fn((args: { where: { id?: string; tenantId_actorUserId_clientRequestId?: { tenantId: string; actorUserId: string; clientRequestId: string } } }) => {
        const row = args.where.id
          ? findById(args.where.id)
          : findByCompoundKey(args.where.tenantId_actorUserId_clientRequestId!.tenantId, args.where.tenantId_actorUserId_clientRequestId!.actorUserId, args.where.tenantId_actorUserId_clientRequestId!.clientRequestId);
        if (!row) throw new Error('AIRequest not found');
        return row;
      }),
      update: aIRequestUpdate,
      updateMany: jest.fn(() => ({ count: 1 })),
    },
    aIAuditEvent: { create: aIAuditEventCreate },
  };

  return { prisma, rows, auditEvents };
}

const actor = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] as string[] };
const dto = { text: 'Muéstrame mi liquidez', surface: 'MOBILE' as const, clientRequestId: 'msg-race-1' };

describe('Concurrency: exactly one provider call per (tenant, actor, clientRequestId, text)', () => {
  it('two concurrent identical handleMessage() calls result in exactly ONE intentAdapter.interpret() call, ONE AIRequest row, and ONE interpretation-started audit event', async () => {
    const { prisma, rows, auditEvents } = createFakePrisma();
    const aiRequests = new AIRequestService(prisma as never);
    const interpret = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash1' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const intentAdapter = { interpret };
    const executeClaimed = jest.fn().mockResolvedValue({ requestId: 'ar-1', conversationId: '', workspaceId: '', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace', createdAt: new Date().toISOString() });
    const assistant = { executeClaimed };
    const workingContext = {
      load: jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null }),
      persistSelection: jest.fn(),
      persistClarificationTurn: jest.fn(),
      readPendingClarificationEntities: jest.fn().mockReturnValue({}),
      buildAuditFromResolution: jest.fn().mockReturnValue({ contextSchemaVersion: '1.1', contextVersion: 0, resolutionResult: 'RESOLVED' }),
    };
    const compositionOrchestrator = {
      loadActive: jest.fn().mockResolvedValue({ composition: null, version: 1, resolvedContext: {} }),
    };
    const service = new NaturalLanguageAssistantService(
      aiRequests,
      intentAdapter as never,
      assistant as never,
      new ReferenceResolverService(),
      workingContext as never,
      prisma as never,
      compositionOrchestrator as never,
    );

    const [resultA, resultB] = await Promise.all([
      service.handleMessage(actor, dto),
      service.handleMessage(actor, dto),
    ]);

    expect(interpret).toHaveBeenCalledTimes(1);
    expect(executeClaimed).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
    expect(auditEvents.filter((event) => event.type === 'ASSISTANT_REQUEST_RECEIVED')).toHaveLength(1);

    // Exactly one caller owns the claim and reaches a real (COMPLETED)
    // outcome; the other observes the in-flight claim and returns
    // immediately with zero side effects of its own.
    const outcomes = [resultA, resultB].map((r) => r.response.interactionState);
    expect(outcomes).toContain('COMPLETED');
    expect(outcomes.filter((state) => state === 'EXECUTING')).toHaveLength(1);
  });

  it('the same-clientRequestId, different-text conflict is detected BEFORE any provider call, with zero second orchestration', async () => {
    const { prisma } = createFakePrisma();
    const aiRequests = new AIRequestService(prisma as never);
    const interpret = jest.fn().mockResolvedValue({
      kind: 'CANDIDATE',
      candidate: { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es', isReadIntent: true, isWriteIntent: false, candidateHash: 'hash1' },
      provider: 'fake', model: 'fake-v1', latencyMs: 5, schemaVersion: '1.0.0',
    });
    const executeClaimed = jest.fn().mockResolvedValue({ requestId: 'ar-1', conversationId: '', workspaceId: '', interactionState: 'COMPLETED', responseType: 'METRIC_BREAKDOWN', payload: {}, warnings: [], suggestedActions: [], traceId: 'trace', createdAt: new Date().toISOString() });
    const workingContext = {
      load: jest.fn().mockResolvedValue({ working: null, version: null, resolvedContextRaw: null }),
      persistSelection: jest.fn(),
      persistClarificationTurn: jest.fn(),
      readPendingClarificationEntities: jest.fn().mockReturnValue({}),
      buildAuditFromResolution: jest.fn().mockReturnValue({ contextSchemaVersion: '1.1', contextVersion: 0, resolutionResult: 'RESOLVED' }),
    };
    const compositionOrchestrator = {
      loadActive: jest.fn().mockResolvedValue({ composition: null, version: 1, resolvedContext: {} }),
    };
    const service = new NaturalLanguageAssistantService(
      aiRequests,
      { interpret } as never,
      { executeClaimed } as never,
      new ReferenceResolverService(),
      workingContext as never,
      prisma as never,
      compositionOrchestrator as never,
    );

    await service.handleMessage(actor, dto);
    expect(interpret).toHaveBeenCalledTimes(1);

    await expect(service.handleMessage(actor, { ...dto, text: 'un mensaje completamente diferente' })).rejects.toBeInstanceOf(ConflictException);

    // The provider was never called a second time for the conflicting request.
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(executeClaimed).toHaveBeenCalledTimes(1);
  });
});
