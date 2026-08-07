import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AIActionRun, AIActionRunStatus, AIAuditEventType, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { canonicalize, JsonValue } from '../domain/canonical-json';
import { BusinessActionResult, BusinessExecutionPlan } from '../planner/planner.types';
import { PlannerService } from '../planner/planner.service';
import { RuntimeService } from '../runtime/runtime.service';
import { WriteCapabilityBindingRegistry } from './write-capability-binding-registry';
import { WriteExecutionContext } from './write/write-capability-binding-definition';

export type ConfirmWriteResult = {
  actionRun: AIActionRun;
  executionState: 'EXECUTED' | 'FAILED' | 'REPLAYED';
  result: BusinessActionResult | null;
  replayed: boolean;
  interactionState: 'COMPLETED' | 'FAILED' | 'STALE_PLAN' | 'PERMISSION_BLOCKED';
  responseType: 'SUCCESS_RECEIPT' | 'ERROR_RECOVERY_CARD';
  message: string;
  receipt: JsonValue | null;
  planFingerprint: string;
  /** True when REGISTER_SALE (or other write binding) executed through this path. */
  executableWrite: true;
  capability: string;
};

@Injectable()
export class WritePlanRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeService,
    private readonly planner: PlannerService,
    private readonly writeRegistry: WriteCapabilityBindingRegistry,
  ) {}

  /**
   * Atomic confirm + exclusive write execution for bound WRITE capabilities.
   * Deal.registerIdempotencyKey remains the durable business uniqueness boundary.
   */
  async confirmAndExecute(args: {
    tenantId: string;
    userId: string;
    actionRunId: string;
    expectedFingerprint: string;
    role?: string;
    permissions?: string[];
    locale?: string;
    timezone?: string;
  }): Promise<ConfirmWriteResult> {
    const claim = await this.claimConfirmation(args);

    if (claim.kind === 'REPLAY') {
      const result = this.readStoredResult(claim.run);
      return this.successEnvelope(claim.run, result, true);
    }

    const run = claim.run;
    const plan = this.parsePlan(run);
    try {
      await this.validateWritePlan(plan, args.expectedFingerprint, run, args.tenantId, args.userId);

      const context: WriteExecutionContext = {
        tenantId: args.tenantId,
        userId: args.userId,
        role: args.role,
        permissions: args.permissions ?? [],
        conversationId: run.conversationId,
        workspaceId: null,
        actionRunId: run.id,
        requestId: `write:${run.id}`,
        locale: args.locale ?? 'es-MX',
        timezone: args.timezone ?? 'UTC',
        now: new Date(),
        planFingerprint: plan.fingerprint,
        workspaceVersion: plan.workspaceVersion,
        entityVersions: plan.entityVersions,
      };

      const stepResults: BusinessActionResult[] = [];
      for (const step of plan.executionSteps) {
        const binding = this.writeRegistry.getBinding(step.capability);
        const input = binding.mapInput(step, context);
        binding.inputSchema.parse(input);
        const result = await binding.execute(input, context);
        stepResults.push(result);
      }

      const primary = stepResults[0]!;
      const replayed = Boolean(
        primary.receipt &&
          typeof primary.receipt === 'object' &&
          !Array.isArray(primary.receipt) &&
          (primary.receipt as Record<string, unknown>).replayed === true,
      );
      const binding = this.writeRegistry.getBinding(plan.executionSteps[0]!.capability);
      const resultPayload = {
        businessActionResult: primary as unknown as Prisma.InputJsonValue,
        planFingerprint: plan.fingerprint,
        replayed,
        registerIdempotencyKeyHash: createHash('sha256')
          .update(`ai-action-run:${run.id}`)
          .digest('hex')
          .slice(0, 24),
        resultHash: createHash('sha256')
          .update(canonicalize(primary as unknown as JsonValue))
          .digest('hex')
          .slice(0, 24),
        capability: plan.executionSteps[0]!.capability,
        bindingVersion: binding.version,
      };

      const completed = await this.runtime.completeExecution(
        args.tenantId,
        args.userId,
        run.id,
        resultPayload as Prisma.InputJsonObject,
        {
          planFingerprint: plan.fingerprint,
          capability: plan.executionSteps[0]!.capability,
          bindingVersion: binding.version,
          stepId: plan.executionSteps[0]!.stepId,
          toolName: binding.bindingName,
          toolVersion: binding.version,
        },
      );

      return this.successEnvelope(completed, primary, replayed);
    } catch (error) {
      const failureType = this.failureType(error);
      await this.runtime.failExecution(
        args.tenantId,
        args.userId,
        run.id,
        failureType,
        { planFingerprint: args.expectedFingerprint },
      );
      return this.failureEnvelope(run, failureType);
    }
  }

  private async claimConfirmation(args: {
    tenantId: string;
    userId: string;
    actionRunId: string;
    expectedFingerprint: string;
  }): Promise<{ kind: 'OWNED' | 'REPLAY'; run: AIActionRun }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.aIActionRun.findFirst({
        where: {
          id: args.actionRunId,
          tenantId: args.tenantId,
          conversation: { deletedAt: null },
        },
      });
      if (!current) throw new NotFoundException('AI action run not found');

      if (current.status === AIActionRunStatus.COMPLETED && current.result) {
        return { kind: 'REPLAY' as const, run: current };
      }
      if (current.status === AIActionRunStatus.EXECUTING) {
        throw new ConflictException('AI action run execution is already in progress');
      }
      if (current.status === AIActionRunStatus.FAILED) {
        throw new ConflictException('AI action run already failed');
      }
      if (current.status !== AIActionRunStatus.READY_FOR_CONFIRMATION) {
        throw new ConflictException('AI action run is not ready for confirmation');
      }
      if (current.planFingerprint !== args.expectedFingerprint) {
        throw new ConflictException('AI action run plan fingerprint does not match');
      }
      if (!this.writeRegistry.hasBinding(current.intent)) {
        throw new ForbiddenException('This action run intent is not enabled for write execution');
      }

      const now = new Date();
      const claimed = await tx.aIActionRun.updateMany({
        where: {
          id: args.actionRunId,
          tenantId: args.tenantId,
          status: AIActionRunStatus.READY_FOR_CONFIRMATION,
          confirmedAt: null,
          planFingerprint: args.expectedFingerprint,
        },
        data: {
          confirmedAt: now,
          confirmedByUserId: args.userId,
          status: AIActionRunStatus.EXECUTING,
          executedAt: now,
        },
      });

      if (claimed.count !== 1) {
        const again = await tx.aIActionRun.findFirst({
          where: { id: args.actionRunId, tenantId: args.tenantId },
        });
        if (again?.status === AIActionRunStatus.COMPLETED && again.result) {
          return { kind: 'REPLAY' as const, run: again };
        }
        throw new ConflictException('AI action run confirmation lost the race');
      }

      await tx.aIAuditEvent.create({
        data: {
          tenantId: args.tenantId,
          actorUserId: args.userId,
          conversationId: current.conversationId,
          actionRunId: current.id,
          type: AIAuditEventType.PLAN_CONFIRMED,
          payload: {
            planFingerprint: args.expectedFingerprint,
            capability: current.intent,
          },
        },
      });
      await tx.aIAuditEvent.create({
        data: {
          tenantId: args.tenantId,
          actorUserId: args.userId,
          conversationId: current.conversationId,
          actionRunId: current.id,
          type: AIAuditEventType.EXECUTION_STARTED,
          payload: {
            planFingerprint: args.expectedFingerprint,
            capability: current.intent,
          },
        },
      });

      const owned = await tx.aIActionRun.findFirstOrThrow({
        where: { id: args.actionRunId, tenantId: args.tenantId },
      });
      return { kind: 'OWNED' as const, run: owned };
    });
  }

  private async validateWritePlan(
    plan: BusinessExecutionPlan,
    expectedFingerprint: string,
    run: AIActionRun,
    tenantId: string,
    userId: string,
  ) {
    if (plan.state !== 'READY_FOR_CONFIRMATION') {
      throw new ConflictException('Write plan is not ready');
    }
    if (plan.confirmationTier === 'NONE') {
      throw new ConflictException('Write plan must require confirmation');
    }
    // Fingerprint integrity — do not compare workspaceVersion to live workspace
    // (preview completion already advanced workspace version by design).
    const { fingerprint, ...unsignedPlan } = plan;
    const recomputed = this.planner.validatePlanStillCurrent(
      plan,
      { workspaceVersion: plan.workspaceVersion, entityVersions: plan.entityVersions },
      expectedFingerprint,
    );
    if (!recomputed.current && recomputed.reasons.includes('PLAN_FINGERPRINT_MISMATCH')) {
      throw new ConflictException('Write plan is stale: PLAN_FINGERPRINT_MISMATCH');
    }
    if (fingerprint !== expectedFingerprint || fingerprint !== run.planFingerprint) {
      throw new ConflictException('Persisted plan fingerprint mismatch');
    }
    void unsignedPlan;

    // Workspace freshness: this run must still be the active confirmation target.
    const request = await this.prisma.aIRequest.findFirst({
      where: { actionRunId: run.id, tenantId },
      select: { workspaceId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (request?.workspaceId) {
      const workspace = await this.prisma.aIWorkspace.findFirst({
        where: {
          id: request.workspaceId,
          tenantId,
          userId,
          deletedAt: null,
        },
        select: { activeActionRunId: true },
      });
      if (!workspace) {
        throw new ConflictException('Write plan is stale: WORKSPACE_MISSING');
      }
      if (workspace.activeActionRunId && workspace.activeActionRunId !== run.id) {
        throw new ConflictException('Write plan is stale: WORKSPACE_ACTIVE_RUN_CHANGED');
      }
    }

    if (plan.executionSteps.length === 0) {
      throw new BadRequestException('Write plan has no execution steps');
    }
    for (const step of plan.executionSteps) {
      if (!this.writeRegistry.hasBinding(step.capability)) {
        throw new ForbiddenException(`Write capability is not bound: ${step.capability}`);
      }
      const binding = this.writeRegistry.getBinding(step.capability);
      if (binding.mode !== 'WRITE') {
        throw new ForbiddenException('Write plan contains a non-write binding');
      }
    }
  }

  private parsePlan(run: AIActionRun): BusinessExecutionPlan {
    const proposed = run.proposedPlan as unknown as BusinessExecutionPlan;
    if (!proposed || typeof proposed !== 'object' || !Array.isArray(proposed.executionSteps)) {
      throw new BadRequestException('Action run proposed plan is invalid');
    }
    return proposed;
  }

  private readStoredResult(run: AIActionRun): BusinessActionResult {
    const raw = run.result as Record<string, unknown> | null;
    const stored = raw?.businessActionResult as BusinessActionResult | undefined;
    if (!stored || stored.executionState !== 'EXECUTED') {
      throw new ConflictException('Completed action run is missing an executed business result');
    }
    return stored;
  }

  private successEnvelope(
    run: AIActionRun,
    result: BusinessActionResult,
    replayed: boolean,
  ): ConfirmWriteResult {
    return {
      actionRun: run,
      executionState: replayed ? 'REPLAYED' : 'EXECUTED',
      result,
      replayed,
      interactionState: 'COMPLETED',
      responseType: 'SUCCESS_RECEIPT',
      message: replayed
        ? 'Listo. La venta ya estaba registrada.'
        : 'Listo. La venta quedó registrada.',
      receipt: result.receipt,
      planFingerprint: run.planFingerprint,
      executableWrite: true,
      capability: 'REGISTER_SALE',
    };
  }

  private failureEnvelope(run: AIActionRun, failureType: string): ConfirmWriteResult {
    const stale =
      failureType.startsWith('STALE_') ||
      failureType.includes('stale') ||
      failureType.includes('WORKSPACE_');
    const permission = failureType.includes('PERMISSION') || failureType.includes('Forbidden');
    const message = stale
      ? failureType === 'STALE_WATCH_SOLD'
        ? 'El reloj cambió desde que preparaste esta venta. No se realizó ningún cambio.'
        : 'El reloj o el cliente cambió desde que preparaste esta venta. No se realizó ningún cambio.'
      : permission
        ? 'Ya no tienes permiso para registrar esta venta. No se realizó ningún cambio.'
        : 'No pude registrar la venta. La operación se revirtió y no se realizó ningún cambio.';
    return {
      actionRun: run,
      executionState: 'FAILED',
      result: null,
      replayed: false,
      interactionState: stale ? 'STALE_PLAN' : permission ? 'PERMISSION_BLOCKED' : 'FAILED',
      responseType: 'ERROR_RECOVERY_CARD',
      message,
      receipt: null,
      planFingerprint: run.planFingerprint,
      executableWrite: true,
      capability: 'REGISTER_SALE',
    };
  }

  private failureType(error: unknown): string {
    if (error instanceof ConflictException) {
      const msg = String(error.message);
      if (msg.includes('STALE_WATCH_SOLD')) return 'STALE_WATCH_SOLD';
      if (msg.includes('STALE_WATCH_MISSING')) return 'STALE_WATCH_MISSING';
      if (msg.includes('STALE_WATCH_NOT_SELLABLE')) return 'STALE_WATCH_NOT_SELLABLE';
      if (msg.includes('STALE_CUSTOMER_MISSING')) return 'STALE_CUSTOMER_MISSING';
      if (msg.includes('WORKSPACE_ACTIVE_RUN_CHANGED')) return 'STALE_WORKSPACE';
      if (msg.includes('WORKSPACE_MISSING')) return 'STALE_WORKSPACE';
      if (msg.toLowerCase().includes('stale')) return 'STALE_PLAN';
      return 'CONFLICT';
    }
    if (error instanceof ForbiddenException) return 'PERMISSION_DENIED';
    if (error instanceof BadRequestException) return 'INVALID_WRITE_INPUT';
    if (error instanceof NotFoundException) return 'NOT_FOUND';
    return error instanceof Error ? error.constructor.name : 'UnknownError';
  }
}
