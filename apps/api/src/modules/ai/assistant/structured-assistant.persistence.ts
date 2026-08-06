import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIActionRunStatus, AIInteractionState, AIMessageRole, AIRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JsonValue, sha256Canonical } from '../domain/canonical-json';
import { BusinessExecutionPlan } from '../planner/planner.types';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from './structured-assistant.types';

export interface PreparedAssistantRequest {
  conversationId: string;
  workspaceId: string;
  workspaceVersion: number;
}

@Injectable()
export class StructuredAssistantPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async currentWorkspaceVersion(actor: AssistantActorContext, workspaceId: string): Promise<number> {
    const workspace = await this.prisma.aIWorkspace.findFirst({ where: { id: workspaceId, tenantId: actor.tenantId, userId: actor.userId, deletedAt: null }, select: { version: true } });
    if (!workspace) throw new NotFoundException('AI workspace not found');
    return workspace.version;
  }

  prepare(requestId: string, actor: AssistantActorContext, input: StructuredAssistantRequest, traceId: string): Promise<PreparedAssistantRequest> {
    return this.prisma.$transaction(async (tx) => {
      let conversation = input.conversationId
        ? await tx.aIConversation.findFirst({ where: { id: input.conversationId, tenantId: actor.tenantId, userId: actor.userId, deletedAt: null } })
        : null;
      if (input.conversationId && !conversation) throw new NotFoundException('AI conversation not found');

      let workspace = input.workspaceId
        ? await tx.aIWorkspace.findFirst({ where: { id: input.workspaceId, tenantId: actor.tenantId, userId: actor.userId, deletedAt: null } })
        : null;
      if (input.workspaceId && !workspace) throw new NotFoundException('AI workspace not found');
      if (workspace && input.expectedWorkspaceVersion !== undefined && workspace.version !== input.expectedWorkspaceVersion) throw new ConflictException('AI workspace version is stale');
      if (conversation && workspace?.conversationId && workspace.conversationId !== conversation.id) throw new ConflictException('AI workspace belongs to another conversation');
      if (!conversation && workspace?.conversationId) {
        conversation = await tx.aIConversation.findFirst({ where: { id: workspace.conversationId, tenantId: actor.tenantId, userId: actor.userId, deletedAt: null } });
        if (!conversation) throw new NotFoundException('AI conversation not found');
      }
      if (!conversation) {
        conversation = await tx.aIConversation.create({ data: { tenantId: actor.tenantId, userId: actor.userId, surface: input.surface } });
        await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: conversation.id, type: AIAuditEventType.CONVERSATION_CREATED } });
      }
      if (!workspace) {
        workspace = await tx.aIWorkspace.create({ data: { tenantId: actor.tenantId, userId: actor.userId, conversationId: conversation.id, surface: input.surface } });
        await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: conversation.id, workspaceId: workspace.id, type: AIAuditEventType.WORKSPACE_CREATED, payload: { version: workspace.version } } });
      } else if (!workspace.conversationId) {
        const changed = await tx.aIWorkspace.updateMany({ where: { id: workspace.id, version: workspace.version, deletedAt: null }, data: { conversationId: conversation.id, version: { increment: 1 }, lastActivityAt: new Date() } });
        if (changed.count !== 1) throw new ConflictException('AI workspace version is stale');
        workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });
        await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: conversation.id, workspaceId: workspace.id, type: AIAuditEventType.WORKSPACE_UPDATED, payload: { version: workspace.version } } });
      }

      const content = input.userDisplayText?.trim() || this.displaySummary(input.intent);
      const message = await tx.aIMessage.create({ data: {
        conversationId: conversation.id,
        role: AIMessageRole.USER,
        content,
        structuredPayload: { intent: input.intent, entities: this.messageEntities(input.entities) },
        metadata: { traceId, aiRequestId: requestId },
      } });
      await tx.aIConversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date() } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: conversation.id, workspaceId: workspace.id, type: AIAuditEventType.MESSAGE_APPENDED, payload: { messageId: message.id, role: message.role } } });
      const request = await tx.aIRequest.update({ where: { id: requestId }, data: { conversationId: conversation.id, workspaceId: workspace.id, status: AIRequestStatus.PLANNING, startedAt: new Date() } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: conversation.id, workspaceId: workspace.id, type: AIAuditEventType.ASSISTANT_REQUEST_STARTED, payload: { aiRequestId: request.id, requestFingerprint: request.requestFingerprint, status: request.status, intent: input.intent, traceId } } });
      return { conversationId: conversation.id, workspaceId: workspace.id, workspaceVersion: workspace.version };
    });
  }

  checkpointPlan(requestId: string, actor: AssistantActorContext, input: StructuredAssistantRequest, prepared: PreparedAssistantRequest, plan: BusinessExecutionPlan) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.aIRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.status !== AIRequestStatus.PLANNING) throw new ConflictException('AI request is not planning');
      const run = await tx.aIActionRun.create({ data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        conversationId: prepared.conversationId,
        intent: input.intent,
        status: AIActionRunStatus.DRAFT,
        planFingerprint: plan.fingerprint,
        idempotencyKey: `assistant-request:${requestId}`,
        proposedPlan: plan as unknown as Prisma.InputJsonObject,
        resolvedEntities: input.entities as unknown as Prisma.InputJsonObject,
        warnings: plan.warnings as unknown as Prisma.InputJsonArray,
        requiresConfirmation: plan.confirmationTier !== 'NONE',
      } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: prepared.conversationId, workspaceId: prepared.workspaceId, actionRunId: run.id, type: AIAuditEventType.PLAN_CREATED, payload: { planFingerprint: plan.fingerprint } } });

      const clarification = plan.state === 'NEEDS_CLARIFICATION';
      const runStatus = clarification ? AIActionRunStatus.NEEDS_CLARIFICATION : AIActionRunStatus.READY_FOR_CONFIRMATION;
      await tx.aIActionRun.update({ where: { id: run.id }, data: { status: runStatus } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: prepared.conversationId, workspaceId: prepared.workspaceId, actionRunId: run.id, type: clarification ? AIAuditEventType.PLAN_NEEDS_CLARIFICATION : AIAuditEventType.PLAN_READY_FOR_CONFIRMATION, payload: { planFingerprint: plan.fingerprint } } });

      const pendingResponse = (clarification ? { missingFields: plan.missingEntities } : { preview: plan.preview, planFingerprint: plan.fingerprint }) as unknown as Prisma.InputJsonObject;
      const workspaceUpdate = await tx.aIWorkspace.updateMany({
        where: { id: prepared.workspaceId, tenantId: actor.tenantId, userId: actor.userId, version: prepared.workspaceVersion, deletedAt: null },
        data: {
          activeActionRunId: run.id,
          interactionState: clarification ? AIInteractionState.COLLECTING_INPUT : (plan.confirmationTier === 'NONE' ? AIInteractionState.AWAITING_RESPONSE : AIInteractionState.AWAITING_CONFIRMATION),
          draftPayload: input.entities as unknown as Prisma.InputJsonObject,
          resolvedContext: { entityVersions: input.entityVersions ?? {}, planFingerprint: plan.fingerprint },
          selectedEntities: input.entities as unknown as Prisma.InputJsonObject,
          pendingResponse,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (workspaceUpdate.count !== 1) throw new ConflictException('AI workspace version is stale');
      const workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id: prepared.workspaceId } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: prepared.conversationId, workspaceId: prepared.workspaceId, actionRunId: run.id, type: AIAuditEventType.WORKSPACE_UPDATED, payload: { previousVersion: prepared.workspaceVersion, version: workspace.version } } });
      await tx.aIRequest.update({ where: { id: requestId }, data: { actionRunId: run.id, status: clarification ? AIRequestStatus.NEEDS_CLARIFICATION : (plan.confirmationTier === 'NONE' ? AIRequestStatus.EXECUTING : AIRequestStatus.READY_FOR_CONFIRMATION) } });
      return { actionRun: run, workspaceVersion: workspace.version };
    });
  }

  complete(requestId: string, actor: AssistantActorContext, response: StructuredAssistantResponse, workspaceVersion: number, eventType: AIAuditEventType, terminalStatus: AIRequestStatus = AIRequestStatus.COMPLETED) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.aIRequest.findUniqueOrThrow({ where: { id: requestId } });
      const responseHash = sha256Canonical(response as unknown as JsonValue);
      const assistantMessage = await tx.aIMessage.create({ data: {
        conversationId: response.conversationId,
        role: AIMessageRole.ASSISTANT,
        content: this.assistantContent(response),
        structuredPayload: response as unknown as Prisma.InputJsonObject,
        metadata: { traceId: response.traceId, aiRequestId: requestId, ...(response.actionRunId ? { actionRunId: response.actionRunId } : {}) },
      } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: response.conversationId, workspaceId: response.workspaceId, actionRunId: response.actionRunId, type: AIAuditEventType.MESSAGE_APPENDED, payload: { messageId: assistantMessage.id, role: assistantMessage.role } } });
      const changed = await tx.aIWorkspace.updateMany({ where: { id: response.workspaceId, tenantId: actor.tenantId, userId: actor.userId, version: workspaceVersion, deletedAt: null }, data: {
        interactionState: response.interactionState === 'NEEDS_INPUT' || response.interactionState === 'NEEDS_DISAMBIGUATION' ? AIInteractionState.COLLECTING_INPUT : response.interactionState === 'READY_FOR_CONFIRMATION' ? AIInteractionState.AWAITING_CONFIRMATION : AIInteractionState.IDLE,
        ...(response.interactionState === 'COMPLETED' || response.interactionState === 'FAILED' ? { activeActionRunId: null, pendingResponse: Prisma.DbNull } : { pendingResponse: response as unknown as Prisma.InputJsonObject }),
        version: { increment: 1 }, lastActivityAt: new Date(),
      } });
      if (changed.count !== 1) throw new ConflictException('AI workspace version is stale');
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: response.conversationId, workspaceId: response.workspaceId, actionRunId: response.actionRunId, type: AIAuditEventType.WORKSPACE_UPDATED, payload: { previousVersion: workspaceVersion, version: workspaceVersion + 1 } } });
      const terminalData: Prisma.AIRequestUpdateInput = terminalStatus === AIRequestStatus.FAILED
        ? { status: terminalStatus, responsePayload: response as unknown as Prisma.InputJsonObject, responseHash, failedAt: new Date(), errorType: String(response.payload.code ?? 'ORCHESTRATION_FAILED'), failureSummary: 'Structured assistant request failed safely' }
        : { status: terminalStatus, responsePayload: response as unknown as Prisma.InputJsonObject, responseHash, completedAt: new Date() };
      await tx.aIRequest.update({ where: { id: requestId }, data: terminalData });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, conversationId: response.conversationId, workspaceId: response.workspaceId, actionRunId: response.actionRunId, type: eventType, payload: {
        aiRequestId: requestId, requestFingerprint: request.requestFingerprint, responseHash, status: terminalStatus, intent: request.requestPayload && typeof request.requestPayload === 'object' && !Array.isArray(request.requestPayload) ? String((request.requestPayload as Record<string, unknown>).intent ?? '') : '', traceId: response.traceId, conversationId: response.conversationId, workspaceId: response.workspaceId, ...(response.actionRunId ? { actionRunId: response.actionRunId } : {}), durationMs: Math.max(0, Date.now() - request.receivedAt.getTime()),
      } } });
      return response;
    });
  }

  private messageEntities(entities: Record<string, JsonValue>): Prisma.InputJsonObject {
    return Object.fromEntries(Object.entries(entities).filter(([key]) => !/email|phone|notes?/i.test(key))) as Prisma.InputJsonObject;
  }

  private displaySummary(intent: string): string { return `Solicitud estructurada: ${intent}`; }
  private assistantContent(response: StructuredAssistantResponse): string {
    const message = response.payload.message;
    if (typeof message === 'string') return message;
    if (response.responseType === 'MISSING_FIELDS_CARD') return 'Necesito algunos datos para continuar.';
    if (response.responseType === 'ACTION_PREVIEW_CARD') return 'La acción está preparada para revisión.';
    if (response.interactionState === 'COMPLETED') return 'Consulta completada.';
    return 'No fue posible completar la solicitud.';
  }
}
