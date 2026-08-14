import { Prisma } from '@prisma/client';
import { WorkingContextService } from '../working-context.service';

function buildTx(overrides: {
  workspace?: Record<string, unknown>;
  actionRun?: Record<string, unknown> | null;
} = {}) {
  const workspace = {
    id: 'w1',
    tenantId: 't1',
    userId: 'u1',
    version: 4,
    conversationId: 'c1',
    activeActionRunId: 'run-1',
    deletedAt: null,
    resolvedContext: {
      workingContext: { schemaVersion: '1.1', contextUpdatedAt: '2026-08-14T00:00:00.000Z', lastIntent: 'REGISTER_SALE', pendingMissingFields: ['currency'], lastPresentedCandidates: { type: 'CLIENT', candidates: [], presentedAt: '2026-08-14T00:00:00.000Z' } },
      conversationDraft: { schemaVersion: '1', capability: 'REGISTER_SALE', status: 'ACTIVE', updatedAt: '2026-08-14T00:00:00.000Z', watch: { raw: 'Batman', confidence: 'RAW' } },
      composition: { some: 'state' },
      entityVersions: { watchId: 'v1' },
      planFingerprint: 'fp-1',
    },
    ...overrides.workspace,
  };
  const actionRun = overrides.actionRun === undefined
    ? { id: 'run-1', status: 'NEEDS_CLARIFICATION', conversationId: 'c1' }
    : overrides.actionRun;

  return {
    aIWorkspace: {
      findFirst: jest.fn().mockResolvedValue(workspace),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...workspace, version: workspace.version + 1, resolvedContext: {} }),
    },
    aIActionRun: {
      findFirst: jest.fn().mockResolvedValue(actionRun),
      update: jest.fn().mockResolvedValue({}),
    },
    aIAuditEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function buildService(txOverrides: Parameters<typeof buildTx>[0] = {}) {
  const tx = buildTx(txOverrides);
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new WorkingContextService(prisma as never);
  return { service, tx };
}

describe('WorkingContextService.resetConversationTransaction — "Empezar de nuevo"', () => {
  it('replaces resolvedContext with a fully empty shell — workingContext, conversationDraft, composition, and plan checkpoint all gone', async () => {
    const { service, tx } = buildService();

    await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(updateData.resolvedContext).toEqual({});
  });

  it('clears activeActionRunId, interactionState, draftPayload, selectedEntities, and pendingResponse on the workspace', async () => {
    const { service, tx } = buildService();

    await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(updateData.activeActionRunId).toBeNull();
    expect(updateData.interactionState).toBe('IDLE');
    expect(updateData.draftPayload).toBe(Prisma.DbNull);
    expect(updateData.selectedEntities).toBe(Prisma.DbNull);
    expect(updateData.pendingResponse).toBe(Prisma.DbNull);
  });

  it('leaves conversationId completely untouched — conversation history stays linked', async () => {
    const { service, tx } = buildService();

    const result = await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    expect(result.conversationId).toBe('c1');
    const updateData = tx.aIWorkspace.updateMany.mock.calls[0][0].data;
    expect(updateData.conversationId).toBeUndefined(); // never part of the update at all
  });

  it('cancels the active in-flight ActionRun (NEEDS_CLARIFICATION -> CANCELLED) and audits it', async () => {
    const { service, tx } = buildService({ actionRun: { id: 'run-1', status: 'NEEDS_CLARIFICATION', conversationId: 'c1' } });

    const result = await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    expect(tx.aIActionRun.update).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: { status: 'CANCELLED' } });
    expect(result.cancelledActionRunId).toBe('run-1');
    const auditTypes = tx.aIAuditEvent.create.mock.calls.map((c) => c[0].data.type);
    expect(auditTypes).toContain('EXECUTION_CANCELLED');
    expect(auditTypes).toContain('WORKSPACE_RESET');
  });

  it('cancels a READY_FOR_CONFIRMATION preview the same way', async () => {
    const { service, tx } = buildService({ actionRun: { id: 'run-1', status: 'READY_FOR_CONFIRMATION', conversationId: 'c1' } });

    const result = await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    expect(tx.aIActionRun.update).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: { status: 'CANCELLED' } });
    expect(result.cancelledActionRunId).toBe('run-1');
  });

  it('never touches an already-COMPLETED ActionRun (no valid CANCELLED transition from a terminal state)', async () => {
    const { service, tx } = buildService({ actionRun: { id: 'run-1', status: 'COMPLETED', conversationId: 'c1' } });

    const result = await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    expect(tx.aIActionRun.update).not.toHaveBeenCalled();
    expect(result.cancelledActionRunId).toBeNull();
  });

  it('never touches an EXECUTING run — a write actually in flight must run to its own terminal outcome', async () => {
    const { service, tx } = buildService({ actionRun: { id: 'run-1', status: 'EXECUTING', conversationId: 'c1' } });

    const result = await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    expect(tx.aIActionRun.update).not.toHaveBeenCalled();
    expect(result.cancelledActionRunId).toBeNull();
  });

  it('no active ActionRun at all (plain MISSING_FIELDS_CARD state) still resets cleanly', async () => {
    const { service, tx } = buildService({ workspace: { activeActionRunId: null }, actionRun: null });

    const result = await service.resetConversationTransaction('t1', 'u1', 'w1', 4);

    expect(tx.aIActionRun.update).not.toHaveBeenCalled();
    expect(result.cancelledActionRunId).toBeNull();
    expect(result.conversationId).toBe('c1');
  });

  it('a stale version throws ConflictException and mutates nothing', async () => {
    const { service, tx } = buildService();
    tx.aIWorkspace.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.resetConversationTransaction('t1', 'u1', 'w1', 4)).rejects.toThrow('AI workspace version is stale');
  });

  it('a workspace that does not exist throws NotFoundException', async () => {
    const { service, tx } = buildService();
    tx.aIWorkspace.findFirst.mockResolvedValue(null);

    await expect(service.resetConversationTransaction('t1', 'u1', 'w1', 4)).rejects.toThrow('AI workspace not found');
  });
});
