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
import { registerReceivablePaymentIdempotencyKey } from './write/register-receivable-payment.binding';
import { WriteExecutionContext } from './write/write-capability-binding-definition';

export type ConfirmWriteResult = {
  actionRun: AIActionRun;
  executionState: 'EXECUTED' | 'FAILED' | 'REPLAYED' | 'IN_PROGRESS';
  result: BusinessActionResult | null;
  replayed: boolean;
  recovered: boolean;
  interactionState: 'COMPLETED' | 'FAILED' | 'STALE_PLAN' | 'PERMISSION_BLOCKED' | 'EXECUTING';
  responseType: 'SUCCESS_RECEIPT' | 'ERROR_RECOVERY_CARD';
  message: string;
  receipt: JsonValue | null;
  planFingerprint: string;
  executableWrite: true;
  capability: string;
};

type ClaimResult =
  | { kind: 'REPLAY'; run: AIActionRun }
  | { kind: 'OWNED'; run: AIActionRun }
  | { kind: 'RECOVER'; run: AIActionRun; priorStatus: AIActionRunStatus }
  | { kind: 'IN_PROGRESS'; run: AIActionRun };

export function registerSaleIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

function writeIdempotencyKey(intent: string, actionRunId: string): string {
  if (intent === 'REGISTER_RECEIVABLE_PAYMENT') {
    return registerReceivablePaymentIdempotencyKey(actionRunId);
  }
  return registerSaleIdempotencyKey(actionRunId);
}

function capabilityLabel(capability: string): 'venta' | 'pago' {
  return capability === 'REGISTER_RECEIVABLE_PAYMENT' ? 'pago' : 'venta';
}

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
   *
   * Durable business uniqueness boundaries:
   * - REGISTER_SALE → Deal.registerIdempotencyKey
   * - REGISTER_RECEIVABLE_PAYMENT → AccountPayment.registerIdempotencyKey
   *   or AccountSettlement.idempotencyKey (APPLY_TO_PAYABLE)
   *
   * Post-commit recovery: EXECUTING/FAILED + durable marker under
   * ai-action-run:<id> → reconstruct receipt and finalize COMPLETED.
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
      return this.successEnvelope(claim.run, result, { replayed: true, recovered: false });
    }

    if (claim.kind === 'IN_PROGRESS') {
      const label = capabilityLabel(claim.run.intent);
      return {
        actionRun: claim.run,
        executionState: 'IN_PROGRESS',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'EXECUTING',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          label === 'pago'
            ? 'El pago se está registrando. Reintenta la misma confirmación en un momento. No inicies un pago nuevo.'
            : 'La venta se está registrando. Reintenta la misma confirmación en un momento. No inicies una venta nueva.',
        receipt: null,
        planFingerprint: claim.run.planFingerprint,
        executableWrite: true,
        capability: claim.run.intent,
      };
    }

    const run = claim.run;
    const recovered = claim.kind === 'RECOVER';
    const plan = this.parsePlan(run);
    try {
      await this.validateWritePlan(plan, args.expectedFingerprint, run, args.tenantId, args.userId, {
        skipActiveRunCheck: recovered,
      });

      const primary = await this.executeWriteSteps(plan, run, args);
      return await this.finalizeSuccess(args, run, plan, primary, {
        replayed: this.isReplayedReceipt(primary),
        recovered,
        priorStatus: claim.kind === 'RECOVER' ? claim.priorStatus : undefined,
      });
    } catch (error) {
      // Financial trust: if the canonical domain committed, never report "no change".
      const recoveredAfterError = await this.tryRecoverCommittedWrite(args, run, plan, error);
      if (recoveredAfterError) return recoveredAfterError;

      const failureType = this.failureType(error);
      if (run.status === AIActionRunStatus.EXECUTING || run.status === AIActionRunStatus.READY_FOR_CONFIRMATION) {
        if (run.status === AIActionRunStatus.EXECUTING) {
          await this.runtime.failExecution(
            args.tenantId,
            args.userId,
            run.id,
            failureType,
            { planFingerprint: args.expectedFingerprint },
          );
        }
      }
      return this.failureEnvelope(run, failureType);
    }
  }

  private async executeWriteSteps(
    plan: BusinessExecutionPlan,
    run: AIActionRun,
    args: {
      tenantId: string;
      userId: string;
      role?: string;
      permissions?: string[];
      locale?: string;
      timezone?: string;
    },
  ): Promise<BusinessActionResult> {
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
    return stepResults[0]!;
  }

  private async finalizeSuccess(
    args: { tenantId: string; userId: string; expectedFingerprint: string },
    run: AIActionRun,
    plan: BusinessExecutionPlan,
    primary: BusinessActionResult,
    meta: { replayed: boolean; recovered: boolean; priorStatus?: AIActionRunStatus },
  ): Promise<ConfirmWriteResult> {
    const binding = this.writeRegistry.getBinding(plan.executionSteps[0]!.capability);
    const idempotencyKey = writeIdempotencyKey(plan.executionSteps[0]!.capability, run.id);
    const resultPayload = {
      businessActionResult: primary as unknown as Prisma.InputJsonValue,
      planFingerprint: plan.fingerprint,
      replayed: meta.replayed,
      recovered: meta.recovered,
      registerIdempotencyKeyHash: createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24),
      resultHash: createHash('sha256')
        .update(canonicalize(primary as unknown as JsonValue))
        .digest('hex')
        .slice(0, 24),
      capability: plan.executionSteps[0]!.capability,
      bindingVersion: binding.version,
      ...(meta.priorStatus ? { priorRuntimeStatus: meta.priorStatus } : {}),
    };

    // If already COMPLETED (race), prefer stored receipt.
    const current = await this.prisma.aIActionRun.findFirst({
      where: { id: run.id, tenantId: args.tenantId },
    });
    if (current?.status === AIActionRunStatus.COMPLETED && current.result) {
      return this.successEnvelope(current, this.readStoredResult(current), {
        replayed: true,
        recovered: meta.recovered,
      });
    }

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

    return this.successEnvelope(completed, primary, {
      replayed: meta.replayed || meta.recovered,
      recovered: meta.recovered,
    });
  }

  /**
   * After domain success + runtime persistence failure (or crash before COMPLETED),
   * recover from the durable domain marker for this capability.
   */
  private async tryRecoverCommittedWrite(
    args: {
      tenantId: string;
      userId: string;
      expectedFingerprint: string;
      role?: string;
      permissions?: string[];
      locale?: string;
      timezone?: string;
    },
    run: AIActionRun,
    plan: BusinessExecutionPlan,
    originalError: unknown,
  ): Promise<ConfirmWriteResult | null> {
    const committed = await this.findCommittedWriteMarker(args.tenantId, run.intent, run.id);
    if (!committed) return null;

    try {
      const primary = await this.executeWriteSteps(plan, run, args);
      return await this.finalizeSuccess(args, run, plan, primary, {
        replayed: true,
        recovered: true,
        priorStatus: run.status,
      });
    } catch (recoveryError) {
      if (recoveryError instanceof ConflictException) {
        throw recoveryError;
      }
      const prefix =
        run.intent === 'REGISTER_RECEIVABLE_PAYMENT'
          ? 'CANONICAL_PAYMENT_COMMITTED_RUNTIME_PENDING'
          : 'CANONICAL_SALE_COMMITTED_RUNTIME_PENDING';
      throw new ConflictException(
        `${prefix}: ${
          originalError instanceof Error ? originalError.constructor.name : 'UnknownError'
        }`,
      );
    }
  }

  private async findCommittedWriteMarker(
    tenantId: string,
    intent: string,
    actionRunId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const key = writeIdempotencyKey(intent, actionRunId);
    if (intent === 'REGISTER_RECEIVABLE_PAYMENT') {
      const payment = await db.accountPayment.findFirst({
        where: { tenantId, registerIdempotencyKey: key, deletedAt: null },
        select: { id: true },
      });
      if (payment) return true;
      const settlement = await db.accountSettlement.findFirst({
        where: { tenantId, idempotencyKey: key, deletedAt: null },
        select: { id: true },
      });
      return Boolean(settlement);
    }
    const deal = await db.deal.findFirst({
      where: { tenantId, registerIdempotencyKey: key, deletedAt: null },
      select: { id: true },
    });
    return Boolean(deal);
  }

  private async claimConfirmation(args: {
    tenantId: string;
    userId: string;
    actionRunId: string;
    expectedFingerprint: string;
  }): Promise<ClaimResult> {
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

      if (current.planFingerprint !== args.expectedFingerprint) {
        throw new ConflictException('AI action run plan fingerprint does not match');
      }
      if (!this.writeRegistry.hasBinding(current.intent)) {
        throw new ForbiddenException('This action run intent is not enabled for write execution');
      }

      if (current.status === AIActionRunStatus.EXECUTING) {
        if (await this.findCommittedWriteMarker(args.tenantId, current.intent, current.id, tx)) {
          return { kind: 'RECOVER' as const, run: current, priorStatus: current.status };
        }
        return { kind: 'IN_PROGRESS' as const, run: current };
      }

      if (current.status === AIActionRunStatus.FAILED) {
        if (await this.findCommittedWriteMarker(args.tenantId, current.intent, current.id, tx)) {
          return { kind: 'RECOVER' as const, run: current, priorStatus: current.status };
        }
        throw new ConflictException('AI action run already failed');
      }

      if (current.status !== AIActionRunStatus.READY_FOR_CONFIRMATION) {
        throw new ConflictException('AI action run is not ready for confirmation');
      }
      if (current.confirmedAt) {
        if (await this.findCommittedWriteMarker(args.tenantId, current.intent, current.id, tx)) {
          return { kind: 'RECOVER' as const, run: current, priorStatus: current.status };
        }
        throw new ConflictException('AI action run is already confirmed');
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
        if (again?.status === AIActionRunStatus.EXECUTING) {
          if (await this.findCommittedWriteMarker(args.tenantId, again.intent, again.id, tx)) {
            return { kind: 'RECOVER' as const, run: again, priorStatus: again.status };
          }
          return { kind: 'IN_PROGRESS' as const, run: again };
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
    options: { skipActiveRunCheck?: boolean } = {},
  ) {
    if (plan.state !== 'READY_FOR_CONFIRMATION') {
      throw new ConflictException('Write plan is not ready');
    }
    if (plan.confirmationTier === 'NONE') {
      throw new ConflictException('Write plan must require confirmation');
    }
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

    if (!options.skipActiveRunCheck) {
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

  private isReplayedReceipt(primary: BusinessActionResult): boolean {
    return Boolean(
      primary.receipt &&
        typeof primary.receipt === 'object' &&
        !Array.isArray(primary.receipt) &&
        (primary.receipt as Record<string, unknown>).replayed === true,
    );
  }

  private successEnvelope(
    run: AIActionRun,
    result: BusinessActionResult,
    meta: { replayed: boolean; recovered: boolean },
  ): ConfirmWriteResult {
    const label = capabilityLabel(run.intent);
    return {
      actionRun: run,
      executionState: meta.replayed || meta.recovered ? 'REPLAYED' : 'EXECUTED',
      result,
      replayed: meta.replayed || meta.recovered,
      recovered: meta.recovered,
      interactionState: 'COMPLETED',
      responseType: 'SUCCESS_RECEIPT',
      message:
        label === 'pago'
          ? meta.recovered || meta.replayed
            ? 'Listo. El pago ya estaba registrado.'
            : 'Listo. El pago quedó registrado.'
          : meta.recovered || meta.replayed
            ? 'Listo. La venta ya estaba registrada.'
            : 'Listo. La venta quedó registrada.',
      receipt: result.receipt,
      planFingerprint: run.planFingerprint,
      executableWrite: true,
      capability: run.intent,
    };
  }

  private failureEnvelope(run: AIActionRun, failureType: string): ConfirmWriteResult {
    const label = capabilityLabel(run.intent);
    if (
      failureType.startsWith('CANONICAL_SALE_COMMITTED') ||
      failureType.startsWith('CANONICAL_PAYMENT_COMMITTED')
    ) {
      return {
        actionRun: run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'FAILED',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          label === 'pago'
            ? 'El pago ya quedó registrado en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
            : 'La venta ya quedó registrada en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.',
        receipt: null,
        planFingerprint: run.planFingerprint,
        executableWrite: true,
        capability: run.intent,
      };
    }

    const stale =
      failureType.startsWith('STALE_') ||
      failureType.includes('stale') ||
      failureType.includes('WORKSPACE_');
    const permission = failureType.includes('PERMISSION') || failureType.includes('Forbidden');
    const message =
      label === 'pago'
        ? stale
          ? 'La cuenta o el saldo cambió desde que preparaste este pago. No se realizó ningún cambio.'
          : permission
            ? 'Ya no tienes permiso para registrar este pago. No se realizó ningún cambio.'
            : 'No pude registrar el pago. La operación se revirtió y no se realizó ningún cambio.'
        : stale
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
      recovered: false,
      interactionState: stale ? 'STALE_PLAN' : permission ? 'PERMISSION_BLOCKED' : 'FAILED',
      responseType: 'ERROR_RECOVERY_CARD',
      message,
      receipt: null,
      planFingerprint: run.planFingerprint,
      executableWrite: true,
      capability: run.intent,
    };
  }

  private failureType(error: unknown): string {
    if (error instanceof ConflictException) {
      const msg = String(error.message);
      if (msg.includes('CANONICAL_PAYMENT_COMMITTED')) return 'CANONICAL_PAYMENT_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('CANONICAL_SALE_COMMITTED')) return 'CANONICAL_SALE_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('STALE_WATCH_SOLD')) return 'STALE_WATCH_SOLD';
      if (msg.includes('STALE_WATCH_MISSING')) return 'STALE_WATCH_MISSING';
      if (msg.includes('STALE_WATCH_NOT_SELLABLE')) return 'STALE_WATCH_NOT_SELLABLE';
      if (msg.includes('STALE_CUSTOMER_MISSING')) return 'STALE_CUSTOMER_MISSING';
      if (msg.includes('STALE_RECEIVABLE')) return msg.includes('OUTSTANDING')
        ? 'STALE_RECEIVABLE_OUTSTANDING'
        : 'STALE_RECEIVABLE';
      if (msg.includes('STALE_PAYABLE')) return 'STALE_PAYABLE';
      if (msg.includes('STALE_CURRENCY')) return 'STALE_CURRENCY';
      if (msg.includes('WORKSPACE_ACTIVE_RUN_CHANGED')) return 'STALE_WORKSPACE';
      if (msg.includes('WORKSPACE_MISSING')) return 'STALE_WORKSPACE';
      if (msg.toLowerCase().includes('stale')) return 'STALE_PLAN';
      if (msg.includes('Idempotency key already used') || msg.includes('registerIdempotencyKey')) {
        return 'IDEMPOTENCY_PAYLOAD_CONFLICT';
      }
      return 'CONFLICT';
    }
    if (error instanceof ForbiddenException) return 'PERMISSION_DENIED';
    if (error instanceof BadRequestException) return 'INVALID_WRITE_INPUT';
    if (error instanceof NotFoundException) return 'NOT_FOUND';
    return error instanceof Error ? error.constructor.name : 'UnknownError';
  }
}
