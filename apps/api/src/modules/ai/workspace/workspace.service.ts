import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIInteractionState, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from '../dto/workspace.dto';
import { WorkspaceStore } from '../types/store-contracts';

@Injectable()
export class WorkspaceService implements WorkspaceStore {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, userId: string, dto: CreateWorkspaceDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.validateReferences(tx, tenantId, userId, dto.conversationId, dto.activeActionRunId);
      const workspace = await tx.aIWorkspace.create({ data: { tenantId, userId, ...dto } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, workspaceId: workspace.id, conversationId: workspace.conversationId, actionRunId: workspace.activeActionRunId, type: AIAuditEventType.WORKSPACE_CREATED, payload: { version: workspace.version } } });
      return workspace;
    });
  }

  async resume(tenantId: string, userId: string, id: string) {
    const workspace = await this.prisma.aIWorkspace.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      include: { conversation: true, activeActionRun: true },
    });
    if (!workspace) throw new NotFoundException('AI workspace not found');
    return workspace;
  }

  update(tenantId: string, userId: string, id: string, dto: UpdateWorkspaceDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireActive(tx, tenantId, userId, id);
      const effectiveConversationId = dto.conversationId === undefined ? current.conversationId : dto.conversationId;
      const effectiveActionRunId = dto.activeActionRunId === undefined ? current.activeActionRunId : dto.activeActionRunId;
      await this.validateReferences(tx, tenantId, userId, effectiveConversationId, effectiveActionRunId);
      const { expectedVersion } = dto;
      const data: Prisma.AIWorkspaceUncheckedUpdateManyInput = { version: { increment: 1 }, lastActivityAt: new Date() };
      if (dto.conversationId !== undefined) data.conversationId = dto.conversationId;
      if (dto.activeActionRunId !== undefined) data.activeActionRunId = dto.activeActionRunId;
      if (dto.interactionState !== undefined) data.interactionState = dto.interactionState;
      if (dto.draftPayload !== undefined) data.draftPayload = dto.draftPayload === null ? Prisma.DbNull : dto.draftPayload;
      if (dto.resolvedContext !== undefined) data.resolvedContext = dto.resolvedContext === null ? Prisma.DbNull : dto.resolvedContext;
      if (dto.selectedEntities !== undefined) data.selectedEntities = dto.selectedEntities === null ? Prisma.DbNull : dto.selectedEntities;
      if (dto.pendingResponse !== undefined) data.pendingResponse = dto.pendingResponse === null ? Prisma.DbNull : dto.pendingResponse;
      const result = await tx.aIWorkspace.updateMany({
        where: { id, tenantId, userId, deletedAt: null, version: expectedVersion },
        data,
      });
      if (result.count !== 1) throw new ConflictException('AI workspace version is stale');
      const workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, workspaceId: id, conversationId: workspace.conversationId, actionRunId: workspace.activeActionRunId, type: AIAuditEventType.WORKSPACE_UPDATED, payload: { previousVersion: expectedVersion, version: workspace.version } } });
      return workspace;
    });
  }

  reset(tenantId: string, userId: string, id: string, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireActive(tx, tenantId, userId, id);
      const result = await tx.aIWorkspace.updateMany({
        where: { id, tenantId, userId, deletedAt: null, version: expectedVersion },
        data: { conversationId: null, activeActionRunId: null, interactionState: AIInteractionState.IDLE, draftPayload: Prisma.DbNull, resolvedContext: Prisma.DbNull, selectedEntities: Prisma.DbNull, pendingResponse: Prisma.DbNull, version: { increment: 1 }, lastActivityAt: new Date() },
      });
      if (result.count !== 1) throw new ConflictException('AI workspace version is stale');
      const workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, workspaceId: id, conversationId: current.conversationId, actionRunId: current.activeActionRunId, type: AIAuditEventType.WORKSPACE_RESET, payload: { previousVersion: expectedVersion, version: workspace.version } } });
      return workspace;
    });
  }

  softDelete(tenantId: string, userId: string, id: string, expectedVersion: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireActive(tx, tenantId, userId, id);
      const result = await tx.aIWorkspace.updateMany({ where: { id, tenantId, userId, deletedAt: null, version: expectedVersion }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('AI workspace version is stale');
      const workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, workspaceId: id, type: AIAuditEventType.WORKSPACE_DELETED, payload: { previousVersion: expectedVersion, version: workspace.version } } });
      return workspace;
    });
  }

  private async requireActive(tx: Prisma.TransactionClient, tenantId: string, userId: string, id: string) {
    const workspace = await tx.aIWorkspace.findFirst({ where: { id, tenantId, userId, deletedAt: null } });
    if (!workspace) throw new NotFoundException('AI workspace not found');
    return workspace;
  }

  private async validateReferences(tx: Prisma.TransactionClient, tenantId: string, userId: string, conversationId?: string | null, actionRunId?: string | null) {
    if (conversationId) {
      const conversation = await tx.aIConversation.findFirst({ where: { id: conversationId, tenantId, userId, deletedAt: null }, select: { id: true } });
      if (!conversation) throw new NotFoundException('AI conversation not found');
    }
    if (actionRunId) {
      const run = await tx.aIActionRun.findFirst({ where: { id: actionRunId, tenantId, conversation: { deletedAt: null }, ...(conversationId ? { conversationId } : {}) }, select: { id: true } });
      if (!run) throw new NotFoundException('AI action run not found');
    }
  }
}
