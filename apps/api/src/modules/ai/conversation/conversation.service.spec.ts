import { NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIConversationSurface, AIMessageRole } from '@prisma/client';
import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  const tx = {
    aIConversation: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    aIMessage: { create: jest.fn() },
    aIAuditEvent: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    aIConversation: { findFirst: jest.fn() },
  };
  const service = new ConversationService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a tenant-scoped conversation and immutable audit event', async () => {
    tx.aIConversation.create.mockResolvedValue({ id: 'c1' });
    await service.create('tenant-1', 'user-1', { title: 'Test', surface: AIConversationSurface.API });

    expect(tx.aIConversation.create).toHaveBeenCalledWith({ data: { tenantId: 'tenant-1', userId: 'user-1', title: 'Test', surface: 'API' } });
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 'tenant-1', conversationId: 'c1', type: AIAuditEventType.CONVERSATION_CREATED }) });
  });

  it('appends a message and audit event without any update path for the message', async () => {
    tx.aIConversation.findFirst.mockResolvedValue({ id: 'c1' });
    tx.aIMessage.create.mockResolvedValue({ id: 'm1', role: AIMessageRole.USER });
    await service.appendMessage('tenant-1', 'user-1', { conversationId: 'c1', role: AIMessageRole.USER, content: 'hello' });

    expect(tx.aIConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 'tenant-1', deletedAt: null } }));
    expect(tx.aIMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.MESSAGE_APPENDED }) });
  });

  it('enforces tenant isolation and soft-delete awareness on reads', async () => {
    prisma.aIConversation.findFirst.mockResolvedValue(null);
    await expect(service.findOne('other-tenant', 'c1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aIConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 'other-tenant', deletedAt: null } }));
  });

  it('soft deletes rather than deleting history', async () => {
    tx.aIConversation.findFirst.mockResolvedValue({ id: 'c1' });
    tx.aIConversation.update.mockResolvedValue({ id: 'c1', deletedAt: new Date() });
    await service.softDelete('tenant-1', 'user-1', 'c1');
    expect(tx.aIConversation.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { deletedAt: expect.any(Date) } });
    expect(tx.aIAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: AIAuditEventType.CONVERSATION_DELETED }) });
  });
});
