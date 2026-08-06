import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIActionRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { assertValidTransition } from '../domain/action-run-state-machine';
import { JsonValue } from '../domain/canonical-json';
import { createIdempotencyKey } from '../domain/idempotency';
import { createPlanFingerprint } from '../domain/plan-fingerprint';
import { CreateActionRunDto } from '../dto/create-action-run.dto';
import { RuntimeStore } from '../types/store-contracts';

const statusAuditType: Record<AIActionRunStatus, AIAuditEventType> = {
  DRAFT: AIAuditEventType.PLAN_CREATED,
  NEEDS_CLARIFICATION: AIAuditEventType.PLAN_NEEDS_CLARIFICATION,
  READY_FOR_CONFIRMATION: AIAuditEventType.PLAN_READY_FOR_CONFIRMATION,
  EXECUTING: AIAuditEventType.EXECUTION_STARTED,
  COMPLETED: AIAuditEventType.EXECUTION_COMPLETED,
  FAILED: AIAuditEventType.EXECUTION_FAILED,
  CANCELLED: AIAuditEventType.EXECUTION_CANCELLED,
  STALE: AIAuditEventType.PLAN_MARKED_STALE,
};

@Injectable()
export class RuntimeService implements RuntimeStore {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, userId: string, dto: CreateActionRunDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireConversation(tx, tenantId, dto.conversationId);
      const actionRun = await tx.aIActionRun.create({ data: {
        tenantId, actorUserId: userId, conversationId: dto.conversationId, intent: dto.intent,
        proposedPlan: dto.proposedPlan, resolvedEntities: dto.resolvedEntities,
        warnings: dto.warnings, requiresConfirmation: dto.requiresConfirmation ?? true,
        planFingerprint: createPlanFingerprint(dto.proposedPlan as unknown as JsonValue),
        idempotencyKey: createIdempotencyKey({ tenantId, userId, intent: dto.intent, normalizedArguments: dto.normalizedArguments as unknown as JsonValue }),
      } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, conversationId: dto.conversationId, actionRunId: actionRun.id, type: AIAuditEventType.PLAN_CREATED, payload: { planFingerprint: actionRun.planFingerprint } } });
      return actionRun;
    });
  }

  async findOne(tenantId: string, id: string) {
    const actionRun = await this.prisma.aIActionRun.findFirst({ where: { id, tenantId, conversation: { deletedAt: null } } });
    if (!actionRun) throw new NotFoundException('AI action run not found');
    return actionRun;
  }

  confirm(tenantId: string, userId: string, id: string, expectedFingerprint: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireRun(tx, tenantId, id);
      if (current.status !== AIActionRunStatus.READY_FOR_CONFIRMATION) {
        throw new ConflictException('AI action run is not ready for confirmation');
      }
      if (current.planFingerprint !== expectedFingerprint) {
        throw new ConflictException('AI action run plan fingerprint does not match');
      }
      if (current.confirmedAt) throw new ConflictException('AI action run is already confirmed');

      const actionRun = await tx.aIActionRun.update({ where: { id }, data: { confirmedAt: new Date(), confirmedByUserId: userId } });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId: userId, conversationId: current.conversationId, actionRunId: id, type: AIAuditEventType.PLAN_CONFIRMED, payload: { planFingerprint: expectedFingerprint } } });
      return actionRun;
    });
  }

  cancel(tenantId: string, userId: string, id: string) {
    return this.transitionInternal(tenantId, userId, id, AIActionRunStatus.CANCELLED);
  }

  markNeedsClarification(tenantId: string, actorUserId: string, id: string) {
    return this.transitionInternal(tenantId, actorUserId, id, AIActionRunStatus.NEEDS_CLARIFICATION);
  }

  markReadyForConfirmation(tenantId: string, actorUserId: string, id: string) {
    return this.transitionInternal(tenantId, actorUserId, id, AIActionRunStatus.READY_FOR_CONFIRMATION);
  }

  startExecution(tenantId: string, actorUserId: string, id: string) {
    return this.transitionInternal(tenantId, actorUserId, id, AIActionRunStatus.EXECUTING);
  }

  completeExecution(tenantId: string, actorUserId: string, id: string, result?: Prisma.InputJsonValue) {
    return this.transitionInternal(tenantId, actorUserId, id, AIActionRunStatus.COMPLETED, { result });
  }

  failExecution(tenantId: string, actorUserId: string, id: string, error: string) {
    return this.transitionInternal(tenantId, actorUserId, id, AIActionRunStatus.FAILED, { error });
  }

  markStale(tenantId: string, actorUserId: string, id: string) {
    return this.transitionInternal(tenantId, actorUserId, id, AIActionRunStatus.STALE);
  }

  private transitionInternal(tenantId: string, actorUserId: string, id: string, status: AIActionRunStatus, details: { error?: string; result?: Prisma.InputJsonValue } = {}) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.requireRun(tx, tenantId, id);
      assertValidTransition(current.status, status);
      if (status === AIActionRunStatus.EXECUTING && current.requiresConfirmation && !current.confirmedAt) {
        throw new ConflictException('AI action run must be confirmed before execution');
      }

      const now = new Date();
      const data: Prisma.AIActionRunUpdateInput = { status };
      if (status === AIActionRunStatus.EXECUTING) data.executedAt = now;
      if (status === AIActionRunStatus.COMPLETED) { data.completedAt = now; data.result = details.result; }
      if (status === AIActionRunStatus.FAILED) data.error = details.error ?? 'Execution failed';

      const actionRun = await tx.aIActionRun.update({ where: { id }, data });
      await tx.aIAuditEvent.create({ data: { tenantId, actorUserId, conversationId: current.conversationId, actionRunId: id, type: statusAuditType[status], payload: details as Prisma.InputJsonObject } });
      return actionRun;
    });
  }

  private async requireRun(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const run = await tx.aIActionRun.findFirst({ where: { id, tenantId, conversation: { deletedAt: null } } });
    if (!run) throw new NotFoundException('AI action run not found');
    return run;
  }

  private async requireConversation(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.aIConversation.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('AI conversation not found');
  }
}
