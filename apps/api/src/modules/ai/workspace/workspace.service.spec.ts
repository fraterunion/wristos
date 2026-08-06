import { ConflictException, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIConversationSurface, AIInteractionState } from '@prisma/client';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  const tx = {
    aIWorkspace: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    aIConversation: { findFirst: jest.fn() },
    aIActionRun: { findFirst: jest.fn() },
    aIAuditEvent: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    aIWorkspace: { findFirst: jest.fn() },
  };
  const service = new WorkspaceService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a user/tenant-scoped workspace with valid conversation/action references', async () => {
    tx.aIConversation.findFirst.mockResolvedValue({ id: 'c1' });
    tx.aIActionRun.findFirst.mockResolvedValue({ id: 'r1' });
    tx.aIWorkspace.create.mockResolvedValue({ id: 'w1', tenantId: 't1', userId: 'u1', conversationId: 'c1', activeActionRunId: 'r1', version: 1 });
    await service.create('t1', 'u1', { surface: AIConversationSurface.MOBILE, conversationId: 'c1', activeActionRunId: 'r1' });
    expect(tx.aIActionRun.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'r1', tenantId: 't1', conversationId: 'c1' }), select: { id: true } });
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.WORKSPACE_CREATED, workspaceId: 'w1' }) });
  });

  it('resumes an active workspace with its current references', async () => {
    prisma.aIWorkspace.findFirst.mockResolvedValue({ id: 'w1', version: 3 });
    await expect(service.resume('t1', 'u1', 'w1')).resolves.toEqual({ id: 'w1', version: 3 });
    expect(prisma.aIWorkspace.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', tenantId: 't1', userId: 'u1', deletedAt: null }, include: { conversation: true, activeActionRun: true } });
  });

  it('updates atomically using expectedVersion and increments the version', async () => {
    tx.aIWorkspace.findFirst.mockResolvedValue({ id: 'w1', version: 2, conversationId: null, activeActionRunId: null });
    tx.aIWorkspace.updateMany.mockResolvedValue({ count: 1 });
    tx.aIWorkspace.findUniqueOrThrow.mockResolvedValue({ id: 'w1', version: 3, conversationId: null, activeActionRunId: null });
    await service.update('t1', 'u1', 'w1', { expectedVersion: 2, interactionState: AIInteractionState.COLLECTING_INPUT, draftPayload: { field: 'value' } });
    expect(tx.aIWorkspace.updateMany).toHaveBeenCalledWith({ where: { id: 'w1', tenantId: 't1', userId: 'u1', deletedAt: null, version: 2 }, data: expect.objectContaining({ version: { increment: 1 }, interactionState: AIInteractionState.COLLECTING_INPUT }) });
  });

  it('rejects a stale expectedVersion without auditing a mutation', async () => {
    tx.aIWorkspace.findFirst.mockResolvedValue({ id: 'w1', version: 3 });
    tx.aIWorkspace.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('t1', 'u1', 'w1', { expectedVersion: 2 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.aIAuditEvent.create).not.toHaveBeenCalled();
  });

  it('enforces tenant and user isolation', async () => {
    prisma.aIWorkspace.findFirst.mockResolvedValue(null);
    await expect(service.resume('other-tenant', 'u1', 'w1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resume('t1', 'other-user', 'w1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects cross-tenant or cross-user conversation references', async () => {
    tx.aIConversation.findFirst.mockResolvedValue(null);
    await expect(service.create('t1', 'u1', { surface: AIConversationSurface.API, conversationId: 'foreign' })).rejects.toThrow('conversation not found');
    expect(tx.aIConversation.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 't1', userId: 'u1', deletedAt: null }, select: { id: true } });
  });

  it('soft deletes with version protection', async () => {
    tx.aIWorkspace.findFirst.mockResolvedValue({ id: 'w1', version: 1 });
    tx.aIWorkspace.updateMany.mockResolvedValue({ count: 1 });
    tx.aIWorkspace.findUniqueOrThrow.mockResolvedValue({ id: 'w1', version: 2, deletedAt: new Date() });
    await service.softDelete('t1', 'u1', 'w1', 1);
    expect(tx.aIWorkspace.updateMany).toHaveBeenCalledWith({ where: { id: 'w1', tenantId: 't1', userId: 'u1', deletedAt: null, version: 1 }, data: { deletedAt: expect.any(Date), version: { increment: 1 } } });
  });

  it('resets mutable state while retaining conversation history in its own table', async () => {
    tx.aIWorkspace.findFirst.mockResolvedValue({ id: 'w1', conversationId: 'c1', activeActionRunId: 'r1', version: 4 });
    tx.aIWorkspace.updateMany.mockResolvedValue({ count: 1 });
    tx.aIWorkspace.findUniqueOrThrow.mockResolvedValue({ id: 'w1', conversationId: null, activeActionRunId: null, version: 5 });
    await service.reset('t1', 'u1', 'w1', 4);
    expect(tx.aIWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conversationId: null, activeActionRunId: null, interactionState: AIInteractionState.IDLE }) }));
    expect(tx.aIConversation).not.toHaveProperty('delete');
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.WORKSPACE_RESET, conversationId: 'c1' }) });
  });
});
