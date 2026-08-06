import { Injectable, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppendMessageDto } from '../dto/append-message.dto';
import { CreateConversationDto } from '../dto/create-conversation.dto';
import { ConversationStore } from '../types/store-contracts';

@Injectable()
export class ConversationService implements ConversationStore {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, userId: string, dto: CreateConversationDto) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.aIConversation.create({ data: { tenantId, userId, ...dto } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, conversationId: conversation.id, type: AIAuditEventType.CONVERSATION_CREATED } });
      return conversation;
    });
  }

  async findOne(tenantId: string, id: string) {
    const conversation = await this.prisma.aIConversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { messages: { orderBy: { createdAt: 'asc' } }, actionRuns: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('AI conversation not found');
    return conversation;
  }

  appendMessage(tenantId: string, userId: string, dto: AppendMessageDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireActive(tx, tenantId, dto.conversationId);
      const message = await tx.aIMessage.create({ data: {
        conversationId: dto.conversationId, role: dto.role, content: dto.content,
        structuredPayload: dto.structuredPayload, metadata: dto.metadata, tokenCount: dto.tokenCount,
      } });
      await tx.aIConversation.update({ where: { id: dto.conversationId }, data: { lastActivityAt: new Date() } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, conversationId: dto.conversationId, type: AIAuditEventType.MESSAGE_APPENDED, payload: { messageId: message.id, role: message.role } } });
      return message;
    });
  }

  softDelete(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireActive(tx, tenantId, id);
      const conversation = await tx.aIConversation.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, conversationId: id, type: AIAuditEventType.CONVERSATION_DELETED } });
      return conversation;
    });
  }

  private async requireActive(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.aIConversation.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('AI conversation not found');
  }
}
