import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AIActionRun, AIActionRunStatus, AIAuditEventType, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { canonicalize, JsonValue } from '../domain/canonical-json';
import { BusinessActionResult, BusinessExecutionPlan } from '../planner/planner.types';
import { PlannerService } from '../planner/planner.service';
import { RuntimeService } from '../runtime/runtime.service';
import { mapFailureTaxonomy, telem } from '../telemetry/telemetry-hooks';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter.service';
import { WriteCapabilityBindingRegistry } from './write-capability-binding-registry';
import { createClientIdempotencyKey } from './write/create-client.binding';
import { registerExpenseIdempotencyKey } from './write/register-expense.binding';
import { registerPurchaseIdempotencyKey } from './write/register-purchase.binding';
import { registerPayablePaymentIdempotencyKey } from './write/register-payable-payment.binding';
import { registerReceivablePaymentIdempotencyKey } from './write/register-receivable-payment.binding';
import {
  registerTreasuryTransferIdempotencyKey,
} from './write/register-treasury-transfer.binding';
import {
  treasuryTransferInflowProvenanceKey,
  treasuryTransferOutflowProvenanceKey,
} from '../../treasury/treasury-transfer.service';
import { WriteExecutionContext } from './write/write-capability-binding-definition';

export type ConfirmWriteResult = {
  actionRun: AIActionRun;
  executionState: 'EXECUTED' | 'FAILED' | 'REPLAYED' | 'IN_PROGRESS';
  result: BusinessActionResult | null;
  replayed: boolean;
  recovered: boolean;
  interactionState: 'COMPLETED' | 'FAILED' | 'STALE_PLAN' | 'PERMISSION_BLOCKED' | 'EXECUTING' | 'READY_FOR_CONFIRMATION' | 'NEEDS_INPUT';
  responseType: 'SUCCESS_RECEIPT' | 'ERROR_RECOVERY_CARD' | 'ACTION_PREVIEW_CARD' | 'MISSING_FIELDS_CARD';
  message: string;
  receipt: JsonValue | null;
  planFingerprint: string;
  executableWrite: true;
  capability: string;
  /** Controlled composition V1: parent preview after CREATE_CLIENT (no second mutation). */
  compositionResume?: {
    requestId: string;
    conversationId: string;
    workspaceId: string;
    actionRunId?: string;
    interactionState: string;
    responseType: string;
    payload: Record<string, JsonValue>;
    warnings: unknown[];
    suggestedActions: unknown[];
    traceId: string;
    createdAt: string;
    parentCapability: string;
    compositionIdHash: string;
  };
};

type ClaimResult =
  | { kind: 'REPLAY'; run: AIActionRun }
  | { kind: 'OWNED'; run: AIActionRun }
  | { kind: 'RECOVER'; run: AIActionRun; priorStatus: AIActionRunStatus }
  | { kind: 'IN_PROGRESS'; run: AIActionRun }
  | { kind: 'PAYABLE_REVERSED'; run: AIActionRun }
  | { kind: 'PAYABLE_INVARIANT'; run: AIActionRun; code: string }
  | { kind: 'TREASURY_TRANSFER_REVERSED'; run: AIActionRun }
  | { kind: 'TREASURY_TRANSFER_INVARIANT'; run: AIActionRun; code: string };

type PayableMarkerClassification =
  | { kind: 'ACTIVE' }
  | { kind: 'REVERSED' }
  | { kind: 'MISSING_TREASURY' }
  | { kind: 'NONE' };

type TreasuryTransferMarkerClassification =
  | { kind: 'ACTIVE' }
  | { kind: 'REVERSED' }
  | { kind: 'INVARIANT' }
  | { kind: 'NONE' };

export function registerSaleIdempotencyKey(actionRunId: string): string {
  return `ai-action-run:${actionRunId}`;
}

function writeIdempotencyKey(intent: string, actionRunId: string): string {
  if (intent === 'REGISTER_RECEIVABLE_PAYMENT') {
    return registerReceivablePaymentIdempotencyKey(actionRunId);
  }
  if (intent === 'REGISTER_PAYABLE_PAYMENT') {
    return registerPayablePaymentIdempotencyKey(actionRunId);
  }
  if (intent === 'REGISTER_TREASURY_TRANSFER') {
    return registerTreasuryTransferIdempotencyKey(actionRunId);
  }
  if (intent === 'REGISTER_EXPENSE') {
    return registerExpenseIdempotencyKey(actionRunId);
  }
  if (intent === 'REGISTER_PURCHASE') {
    return registerPurchaseIdempotencyKey(actionRunId);
  }
  if (intent === 'CREATE_CLIENT') {
    return createClientIdempotencyKey(actionRunId);
  }
  return registerSaleIdempotencyKey(actionRunId);
}

function capabilityLabel(
  capability: string,
): 'venta' | 'pago' | 'gasto' | 'compra' | 'cliente' | 'actualizacion' | 'transferencia' {
  if (
    capability === 'REGISTER_RECEIVABLE_PAYMENT' ||
    capability === 'REGISTER_PAYABLE_PAYMENT'
  ) {
    return 'pago';
  }
  if (capability === 'REGISTER_TREASURY_TRANSFER') return 'transferencia';
  if (capability === 'REGISTER_EXPENSE') return 'gasto';
  if (capability === 'REGISTER_PURCHASE') return 'compra';
  if (capability === 'CREATE_CLIENT') return 'cliente';
  if (capability === 'UPDATE_CLIENT') return 'actualizacion';
  return 'venta';
}

@Injectable()
export class WritePlanRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeService,
    private readonly planner: PlannerService,
    private readonly writeRegistry: WriteCapabilityBindingRegistry,
    @Optional() private readonly telemetry?: TelemetryEmitter,
  ) {}

  /**
   * Atomic confirm + exclusive write execution for bound WRITE capabilities.
   *
 * Durable business uniqueness boundaries:
 * - REGISTER_SALE → Deal.registerIdempotencyKey
 * - REGISTER_RECEIVABLE_PAYMENT → AccountPayment.registerIdempotencyKey
 *   or AccountSettlement.idempotencyKey (APPLY_TO_PAYABLE)
 * - REGISTER_PAYABLE_PAYMENT → AccountPayment.registerIdempotencyKey
 * - REGISTER_TREASURY_TRANSFER → paired TreasuryEntry provenance
 *   treasury-transfer:ai-action-run:<id>:outflow|inflow
 * - REGISTER_EXPENSE → OperatingExpense.registerIdempotencyKey
 * - REGISTER_PURCHASE → Watch.registerIdempotencyKey
 * - CREATE_CLIENT → Client.registerIdempotencyKey
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
    const totalStarted = Date.now();
    const claim = await this.claimConfirmation(args);

    if (claim.kind === 'REPLAY') {
      const result = this.readStoredResult(claim.run);
      const envelope = this.successEnvelope(claim.run, result, { replayed: true, recovered: false });
      telem(this.telemetry, {
        event: 'ReplayServed',
        tenantId: args.tenantId,
        conversationId: claim.run.conversationId,
        actionRunId: claim.run.id,
        capability: claim.run.intent,
        replayed: true,
        idempotentReplay: true,
        outcome: 'REPLAYED',
        funnelStage: 'completed',
        totalLatencyMs: Date.now() - totalStarted,
      });
      telem(this.telemetry, {
        event: 'ConversationFinished',
        tenantId: args.tenantId,
        conversationId: claim.run.conversationId,
        actionRunId: claim.run.id,
        capability: claim.run.intent,
        outcome: 'REPLAYED',
        totalLatencyMs: Date.now() - totalStarted,
      });
      return envelope;
    }

    if (claim.kind === 'PAYABLE_REVERSED') {
      if (claim.run.status === AIActionRunStatus.EXECUTING) {
        await this.runtime.failExecution(
          args.tenantId,
          args.userId,
          claim.run.id,
          'STALE_PAYABLE_PAYMENT_REVERSED',
          { planFingerprint: args.expectedFingerprint },
        );
      }
      return {
        actionRun: claim.run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'STALE_PLAN',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          'El pago se registró anteriormente, pero después fue revertido en Cuentas. No voy a volver a aplicarlo automáticamente.',
        receipt: null,
        planFingerprint: claim.run.planFingerprint,
        executableWrite: true,
        capability: claim.run.intent,
      };
    }

    if (claim.kind === 'TREASURY_TRANSFER_REVERSED') {
      if (claim.run.status === AIActionRunStatus.EXECUTING) {
        await this.runtime.failExecution(
          args.tenantId,
          args.userId,
          claim.run.id,
          'STALE_TREASURY_TRANSFER_REVERSED',
          { planFingerprint: args.expectedFingerprint },
        );
      }
      return {
        actionRun: claim.run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'STALE_PLAN',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          'La transferencia se registró anteriormente, pero después fue revertida en Tesorería. No voy a volver a aplicarla automáticamente.',
        receipt: null,
        planFingerprint: claim.run.planFingerprint,
        executableWrite: true,
        capability: claim.run.intent,
      };
    }

    if (claim.kind === 'PAYABLE_INVARIANT') {
      if (claim.run.status === AIActionRunStatus.EXECUTING) {
        await this.runtime.failExecution(
          args.tenantId,
          args.userId,
          claim.run.id,
          claim.code,
          { planFingerprint: args.expectedFingerprint },
        );
      }
      return this.failureEnvelope(claim.run, claim.code);
    }

    if (claim.kind === 'TREASURY_TRANSFER_INVARIANT') {
      if (claim.run.status === AIActionRunStatus.EXECUTING) {
        await this.runtime.failExecution(
          args.tenantId,
          args.userId,
          claim.run.id,
          claim.code,
          { planFingerprint: args.expectedFingerprint },
        );
      }
      return this.failureEnvelope(claim.run, claim.code);
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
            : label === 'gasto'
              ? 'El gasto se está registrando. Reintenta la misma confirmación en un momento. No inicies un gasto nuevo.'
              : label === 'compra'
                ? 'La compra se está registrando. Reintenta la misma confirmación en un momento. No inicies una compra nueva.'
                : label === 'cliente'
                  ? 'El cliente se está creando. Reintenta la misma confirmación en un momento. No inicies un alta nueva.'
                  : label === 'transferencia'
                    ? 'La transferencia se está registrando. Reintenta la misma confirmación en un momento. No inicies una transferencia nueva.'
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
    telem(this.telemetry, {
      event: 'PreviewConfirmed',
      tenantId: args.tenantId,
      conversationId: run.conversationId,
      actionRunId: run.id,
      capability: run.intent,
      confirmed: true,
      funnelStage: 'confirmation',
      recovered,
    });
    if (recovered) {
      telem(this.telemetry, {
        event: 'ExecutionRecovered',
        tenantId: args.tenantId,
        conversationId: run.conversationId,
        actionRunId: run.id,
        capability: run.intent,
        recovered: true,
        recoveryReason: String(claim.priorStatus ?? 'RECOVER'),
        funnelStage: 'execution',
      });
    }
    telem(this.telemetry, {
      event: 'ExecutionStarted',
      tenantId: args.tenantId,
      conversationId: run.conversationId,
      actionRunId: run.id,
      capability: run.intent,
      funnelStage: 'execution',
      recovered,
    });
    const bindingStarted = Date.now();
    try {
      await this.validateWritePlan(plan, args.expectedFingerprint, run, args.tenantId, args.userId, {
        skipActiveRunCheck: recovered,
      });

      const primary = await this.executeWriteSteps(plan, run, args);
      const bindingLatencyMs = Date.now() - bindingStarted;
      const envelope = await this.finalizeSuccess(args, run, plan, primary, {
        replayed: this.isReplayedReceipt(primary),
        recovered: recovered || this.isRecoveredReceipt(primary),
        priorStatus: claim.kind === 'RECOVER' ? claim.priorStatus : undefined,
      });
      telem(this.telemetry, {
        event: 'ExecutionCompleted',
        tenantId: args.tenantId,
        conversationId: run.conversationId,
        actionRunId: run.id,
        capability: run.intent,
        completed: true,
        recovered: envelope.recovered,
        replayed: envelope.replayed,
        bindingLatencyMs,
        domainLatencyMs: bindingLatencyMs,
        totalLatencyMs: Date.now() - totalStarted,
        funnelStage: 'receipt',
        outcome: envelope.recovered ? 'RECOVERED' : envelope.replayed ? 'REPLAYED' : 'SUCCESS',
      });
      telem(this.telemetry, {
        event: 'ConversationFinished',
        tenantId: args.tenantId,
        conversationId: run.conversationId,
        actionRunId: run.id,
        capability: run.intent,
        outcome: envelope.recovered ? 'RECOVERED' : envelope.replayed ? 'REPLAYED' : 'SUCCESS',
        totalLatencyMs: Date.now() - totalStarted,
        funnelStage: 'completed',
      });
      return envelope;
    } catch (error) {
      // Financial trust: if the canonical domain committed, never report "no change".
      const recoveredAfterError = await this.tryRecoverCommittedWrite(args, run, plan, error);
      if (recoveredAfterError) {
        telem(this.telemetry, {
          event: 'ExecutionRecovered',
          tenantId: args.tenantId,
          conversationId: run.conversationId,
          actionRunId: run.id,
          capability: run.intent,
          recovered: true,
          recoveryReason: this.failureType(error),
          recoveryDurationMs: Date.now() - bindingStarted,
          funnelStage: 'receipt',
          outcome: 'RECOVERED',
          totalLatencyMs: Date.now() - totalStarted,
        });
        telem(this.telemetry, {
          event: 'ExecutionCompleted',
          tenantId: args.tenantId,
          conversationId: run.conversationId,
          actionRunId: run.id,
          capability: run.intent,
          completed: true,
          recovered: true,
          totalLatencyMs: Date.now() - totalStarted,
          funnelStage: 'receipt',
          outcome: 'RECOVERED',
        });
        telem(this.telemetry, {
          event: 'ConversationFinished',
          tenantId: args.tenantId,
          conversationId: run.conversationId,
          actionRunId: run.id,
          capability: run.intent,
          outcome: 'RECOVERED',
          totalLatencyMs: Date.now() - totalStarted,
        });
        return recoveredAfterError;
      }

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
      const envelope = this.failureEnvelope(run, failureType);
      telem(this.telemetry, {
        event: 'ExecutionFailed',
        tenantId: args.tenantId,
        conversationId: run.conversationId,
        actionRunId: run.id,
        capability: run.intent,
        failed: true,
        failureType: mapFailureTaxonomy(failureType),
        totalLatencyMs: Date.now() - totalStarted,
        outcome: 'FAILED',
        funnelStage: 'execution',
      });
      telem(this.telemetry, {
        event: 'ConversationFinished',
        tenantId: args.tenantId,
        conversationId: run.conversationId,
        actionRunId: run.id,
        capability: run.intent,
        outcome: 'FAILED',
        totalLatencyMs: Date.now() - totalStarted,
      });
      return envelope;
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
        run.intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
        run.intent === 'REGISTER_PAYABLE_PAYMENT'
          ? 'CANONICAL_PAYMENT_COMMITTED_RUNTIME_PENDING'
          : run.intent === 'REGISTER_TREASURY_TRANSFER'
            ? 'CANONICAL_TREASURY_TRANSFER_COMMITTED_RUNTIME_PENDING'
            : run.intent === 'REGISTER_EXPENSE'
              ? 'CANONICAL_EXPENSE_COMMITTED_RUNTIME_PENDING'
              : run.intent === 'REGISTER_PURCHASE'
                ? 'CANONICAL_PURCHASE_COMMITTED_RUNTIME_PENDING'
                : run.intent === 'CREATE_CLIENT'
                  ? 'CANONICAL_CLIENT_COMMITTED_RUNTIME_PENDING'
                  : 'CANONICAL_SALE_COMMITTED_RUNTIME_PENDING';
      throw new ConflictException(
        `${prefix}: ${
          originalError instanceof Error ? originalError.constructor.name : 'UnknownError'
        }`,
      );
    }
  }

  /**
   * REGISTER_PAYABLE_PAYMENT recovery must classify durable markers before IN_PROGRESS.
   * Active → recover; reversed → typed stale (never re-apply); missing treasury → invariant;
   * none → caller may return IN_PROGRESS.
   */
  private async classifyPayableRecoveryClaim(
    tenantId: string,
    run: AIActionRun,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<ClaimResult | null> {
    if (run.intent !== 'REGISTER_PAYABLE_PAYMENT') return null;
    const marker = await this.inspectPayablePaymentMarker(tenantId, run.id, db);
    if (marker.kind === 'ACTIVE') {
      return { kind: 'RECOVER', run, priorStatus: run.status };
    }
    if (marker.kind === 'REVERSED') {
      return { kind: 'PAYABLE_REVERSED', run };
    }
    if (marker.kind === 'MISSING_TREASURY') {
      return {
        kind: 'PAYABLE_INVARIANT',
        run,
        code: 'STALE_PAYABLE_PAYMENT_MISSING_TREASURY',
      };
    }
    return null;
  }

  /**
   * REGISTER_TREASURY_TRANSFER recovery inspects both provenance legs.
   * Both active → recover; both reversed → typed stale; unpaired → invariant;
   * neither → none (IN_PROGRESS / not committed).
   */
  private async classifyTreasuryTransferRecoveryClaim(
    tenantId: string,
    run: AIActionRun,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<ClaimResult | null> {
    if (run.intent !== 'REGISTER_TREASURY_TRANSFER') return null;
    const marker = await this.inspectTreasuryTransferMarker(tenantId, run.id, db);
    if (marker.kind === 'ACTIVE') {
      return { kind: 'RECOVER', run, priorStatus: run.status };
    }
    if (marker.kind === 'REVERSED') {
      return { kind: 'TREASURY_TRANSFER_REVERSED', run };
    }
    if (marker.kind === 'INVARIANT') {
      return {
        kind: 'TREASURY_TRANSFER_INVARIANT',
        run,
        code: 'CANONICAL_TREASURY_TRANSFER_INVARIANT',
      };
    }
    return null;
  }

  private async inspectPayablePaymentMarker(
    tenantId: string,
    actionRunId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PayableMarkerClassification> {
    const key = registerPayablePaymentIdempotencyKey(actionRunId);
    const payment = await db.accountPayment.findFirst({
      where: { tenantId, registerIdempotencyKey: key },
      select: { id: true, deletedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) return { kind: 'NONE' };
    if (payment.deletedAt) return { kind: 'REVERSED' };
    const treasury = await db.treasuryEntry.findFirst({
      where: {
        tenantId,
        accountPaymentId: payment.id,
        deletedAt: null,
        direction: 'OUTFLOW',
      },
      select: { id: true },
    });
    if (!treasury) return { kind: 'MISSING_TREASURY' };
    return { kind: 'ACTIVE' };
  }

  private async inspectTreasuryTransferMarker(
    tenantId: string,
    actionRunId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<TreasuryTransferMarkerClassification> {
    const logicalKey = registerTreasuryTransferIdempotencyKey(actionRunId);
    const outflowKey = treasuryTransferOutflowProvenanceKey(logicalKey);
    const inflowKey = treasuryTransferInflowProvenanceKey(logicalKey);
    const outflow = await db.treasuryEntry.findFirst({
      where: { tenantId, provenanceKey: outflowKey },
      select: { id: true, deletedAt: true },
    });
    const inflow = await db.treasuryEntry.findFirst({
      where: { tenantId, provenanceKey: inflowKey },
      select: { id: true, deletedAt: true },
    });
    if (!outflow && !inflow) return { kind: 'NONE' };
    if (!outflow || !inflow) return { kind: 'INVARIANT' };
    if (outflow.deletedAt && inflow.deletedAt) return { kind: 'REVERSED' };
    if (Boolean(outflow.deletedAt) !== Boolean(inflow.deletedAt)) {
      return { kind: 'INVARIANT' };
    }
    if (!outflow.deletedAt && !inflow.deletedAt) return { kind: 'ACTIVE' };
    return { kind: 'INVARIANT' };
  }

  /** Payable + treasury-transfer typed recovery before generic marker / IN_PROGRESS. */
  private async classifyWriteRecoveryClaim(
    tenantId: string,
    run: AIActionRun,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<ClaimResult | null> {
    return (
      (await this.classifyPayableRecoveryClaim(tenantId, run, db)) ??
      (await this.classifyTreasuryTransferRecoveryClaim(tenantId, run, db))
    );
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
    if (intent === 'REGISTER_PAYABLE_PAYMENT') {
      const payment = await db.accountPayment.findFirst({
        where: { tenantId, registerIdempotencyKey: key, deletedAt: null },
        select: { id: true },
      });
      return Boolean(payment);
    }
    if (intent === 'REGISTER_TREASURY_TRANSFER') {
      const marker = await this.inspectTreasuryTransferMarker(tenantId, actionRunId, db);
      return marker.kind === 'ACTIVE';
    }
    if (intent === 'REGISTER_EXPENSE') {
      const expense = await db.operatingExpense.findFirst({
        where: { tenantId, registerIdempotencyKey: key, deletedAt: null },
        select: { id: true },
      });
      return Boolean(expense);
    }
    if (intent === 'REGISTER_PURCHASE') {
      const watch = await db.watch.findFirst({
        where: { tenantId, registerIdempotencyKey: key, deletedAt: null },
        select: { id: true },
      });
      return Boolean(watch);
    }
    if (intent === 'CREATE_CLIENT') {
      const client = await db.client.findFirst({
        where: { tenantId, registerIdempotencyKey: key },
        select: { id: true },
      });
      return Boolean(client);
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
        const recoveryClaim = await this.classifyWriteRecoveryClaim(
          args.tenantId,
          current,
          tx,
        );
        if (recoveryClaim) return recoveryClaim;
        if (await this.findCommittedWriteMarker(args.tenantId, current.intent, current.id, tx)) {
          return { kind: 'RECOVER' as const, run: current, priorStatus: current.status };
        }
        return { kind: 'IN_PROGRESS' as const, run: current };
      }

      if (current.status === AIActionRunStatus.FAILED) {
        const recoveryClaim = await this.classifyWriteRecoveryClaim(
          args.tenantId,
          current,
          tx,
        );
        if (recoveryClaim) return recoveryClaim;
        if (await this.findCommittedWriteMarker(args.tenantId, current.intent, current.id, tx)) {
          return { kind: 'RECOVER' as const, run: current, priorStatus: current.status };
        }
        throw new ConflictException('AI action run already failed');
      }

      if (current.status !== AIActionRunStatus.READY_FOR_CONFIRMATION) {
        throw new ConflictException('AI action run is not ready for confirmation');
      }
      if (current.confirmedAt) {
        const recoveryClaim = await this.classifyWriteRecoveryClaim(
          args.tenantId,
          current,
          tx,
        );
        if (recoveryClaim) return recoveryClaim;
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
          const recoveryClaim = await this.classifyWriteRecoveryClaim(
            args.tenantId,
            again,
            tx,
          );
          if (recoveryClaim) return recoveryClaim;
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
    if (
      !primary.receipt ||
      typeof primary.receipt !== 'object' ||
      Array.isArray(primary.receipt)
    ) {
      return false;
    }
    const receipt = primary.receipt as Record<string, unknown>;
    // CREATE uses replayed; UPDATE_CLIENT may set recovered after intended-state match.
    return receipt.replayed === true || receipt.recovered === true;
  }

  private isRecoveredReceipt(primary: BusinessActionResult): boolean {
    return Boolean(
      primary.receipt &&
        typeof primary.receipt === 'object' &&
        !Array.isArray(primary.receipt) &&
        (primary.receipt as Record<string, unknown>).recovered === true,
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
        label === 'transferencia'
          ? meta.recovered || meta.replayed
            ? 'Listo. La transferencia ya estaba registrada.'
            : 'Listo. La transferencia quedó registrada.'
          : label === 'pago'
            ? meta.recovered || meta.replayed
              ? 'Listo. El pago ya estaba registrado.'
              : 'Listo. El pago quedó registrado.'
            : label === 'gasto'
              ? meta.recovered || meta.replayed
                ? 'Listo. El gasto ya estaba registrado.'
                : 'Listo. El gasto quedó registrado.'
              : label === 'compra'
                ? meta.recovered || meta.replayed
                  ? 'Listo. La compra ya estaba registrada.'
                  : 'Listo. La compra quedó registrada.'
                : label === 'cliente'
                  ? meta.recovered || meta.replayed
                    ? 'Listo. El cliente ya estaba creado.'
                    : 'Listo. El cliente quedó creado.'
                  : label === 'actualizacion'
                    ? meta.recovered || meta.replayed
                      ? 'Listo. El cliente ya estaba actualizado.'
                      : 'Listo. El cliente quedó actualizado.'
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
      failureType.startsWith('CANONICAL_PAYMENT_COMMITTED') ||
      failureType.startsWith('CANONICAL_TREASURY_TRANSFER_COMMITTED') ||
      failureType.startsWith('CANONICAL_EXPENSE_COMMITTED') ||
      failureType.startsWith('CANONICAL_PURCHASE_COMMITTED') ||
      failureType.startsWith('CANONICAL_CLIENT_COMMITTED')
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
          label === 'transferencia'
            ? 'La transferencia ya quedó registrada en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
            : label === 'pago'
              ? 'El pago ya quedó registrado en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
              : label === 'gasto'
                ? 'El gasto ya quedó registrado en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
                : label === 'compra'
                  ? 'La compra ya quedó registrada en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
                  : label === 'cliente'
                    ? 'El cliente ya quedó creado en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
                    : label === 'actualizacion'
                      ? 'El cliente ya quedó actualizado en el negocio, pero no pude confirmar el recibo todavía. Reintenta la misma confirmación.'
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
    if (
      failureType === 'CLIENT_EXACT_DUPLICATE' ||
      failureType === 'CLIENT_DELETED_MATCH' ||
      failureType === 'CLIENT_IDENTITY_CONFLICT'
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
          failureType === 'CLIENT_DELETED_MATCH'
            ? label === 'actualizacion'
              ? 'Existe un cliente eliminado con esos datos de contacto. No se actualizó el cliente. Restáuralo desde CRM si corresponde.'
              : 'Existe un cliente eliminado con esos datos. No se creó un duplicado. Restáuralo desde CRM si corresponde.'
            : label === 'actualizacion'
              ? 'Otro cliente activo ya usa esos datos de contacto. No se actualizó el cliente.'
              : 'Ya existe un cliente con esos datos de contacto. No se creó un duplicado.',
        receipt: null,
        planFingerprint: run.planFingerprint,
        executableWrite: true,
        capability: run.intent,
      };
    }

    if (failureType === 'CLIENT_STALE' || failureType === 'AMBIGUOUS_RECOVERY') {
      return {
        actionRun: run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'STALE_PLAN',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          'Este cliente cambió desde que preparé la actualización. Revisemos los datos actuales antes de continuar.',
        receipt: null,
        planFingerprint: run.planFingerprint,
        executableWrite: true,
        capability: run.intent,
      };
    }

    if (failureType === 'STALE_PAYABLE_PAYMENT_REVERSED') {
      return {
        actionRun: run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'STALE_PLAN',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          'El pago se registró anteriormente, pero después fue revertido en Cuentas. No voy a volver a aplicarlo automáticamente.',
        receipt: null,
        planFingerprint: run.planFingerprint,
        executableWrite: true,
        capability: run.intent,
      };
    }

    if (failureType === 'STALE_PAYABLE_PAYMENT_MISSING_TREASURY') {
      return {
        actionRun: run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'FAILED',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          'Encontré un pago incompleto que necesita revisión en Cuentas. No voy a volver a aplicarlo automáticamente.',
        receipt: null,
        planFingerprint: run.planFingerprint,
        executableWrite: true,
        capability: run.intent,
      };
    }

    if (failureType === 'CANONICAL_TREASURY_TRANSFER_INVARIANT') {
      return {
        actionRun: run,
        executionState: 'FAILED',
        result: null,
        replayed: false,
        recovered: false,
        interactionState: 'FAILED',
        responseType: 'ERROR_RECOVERY_CARD',
        message:
          'No pude confirmar la transferencia porque su estado interno quedó incompleto. No voy a registrar otro movimiento automáticamente.',
        receipt: null,
        planFingerprint: run.planFingerprint,
        executableWrite: true,
        capability: run.intent,
      };
    }

    const message =
      label === 'pago'
        ? stale
          ? 'La cuenta o el saldo cambió desde que preparaste este pago. No se realizó ningún cambio.'
          : permission
            ? 'Ya no tienes permiso para registrar este pago. No se realizó ningún cambio.'
            : 'No pude registrar el pago. La operación se revirtió y no se realizó ningún cambio.'
        : label === 'gasto'
          ? stale
            ? 'El plan del gasto cambió o el espacio de trabajo ya no es válido. No se realizó ningún cambio.'
            : permission
              ? 'Ya no tienes permiso para registrar este gasto. No se realizó ningún cambio.'
              : 'No pude registrar el gasto. La operación se revirtió y no se realizó ningún cambio.'
          : label === 'compra'
            ? stale
              ? 'El plan de la compra cambió (serie, vendedor o espacio de trabajo). No se realizó ningún cambio.'
              : permission
                ? 'Ya no tienes permiso para registrar esta compra. No se realizó ningún cambio.'
                : 'No pude registrar la compra. La operación se revirtió y no se realizó ningún cambio.'
            : label === 'cliente'
              ? stale
                ? 'El plan del cliente cambió o el espacio de trabajo ya no es válido. No se creó ningún cliente.'
                : permission
                  ? 'Ya no tienes permiso para crear este cliente. No se realizó ningún cambio.'
                  : 'No pude crear el cliente. No se realizó ningún cambio.'
              : label === 'actualizacion'
                ? stale
                  ? 'Este cliente cambió desde que preparé la actualización. Revisemos los datos actuales antes de continuar.'
                  : permission
                    ? 'Ya no tienes permiso para actualizar este cliente. No se realizó ningún cambio.'
                    : 'No pude actualizar el cliente. No se realizó ningún cambio.'
                : label === 'transferencia'
                  ? stale
                    ? 'El plan de la transferencia cambió o el espacio de trabajo ya no es válido. No se realizó ningún cambio.'
                    : permission
                      ? 'Ya no tienes permiso para registrar esta transferencia. No se realizó ningún cambio.'
                      : 'No pude registrar la transferencia. La operación se revirtió y no se realizó ningún cambio.'
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
      const response = error.getResponse();
      if (response && typeof response === 'object' && !Array.isArray(response)) {
        const code = (response as { code?: unknown }).code;
        if (
          code === 'CLIENT_EXACT_DUPLICATE' ||
          code === 'CLIENT_DELETED_MATCH' ||
          code === 'CLIENT_IDENTITY_CONFLICT' ||
          code === 'CLIENT_IDEMPOTENCY_PAYLOAD_CONFLICT' ||
          code === 'CLIENT_STALE' ||
          code === 'AMBIGUOUS_RECOVERY'
        ) {
          return String(code);
        }
      }
      const msg = String(error.message);
      if (msg.includes('CANONICAL_CLIENT_COMMITTED')) return 'CANONICAL_CLIENT_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('CANONICAL_PAYMENT_COMMITTED')) return 'CANONICAL_PAYMENT_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('CANONICAL_EXPENSE_COMMITTED')) return 'CANONICAL_EXPENSE_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('CANONICAL_EXPENSE_INVARIANT')) return 'CANONICAL_EXPENSE_INVARIANT';
      if (msg.includes('CANONICAL_PURCHASE_COMMITTED')) return 'CANONICAL_PURCHASE_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('CANONICAL_PURCHASE_INVARIANT')) return 'CANONICAL_PURCHASE_INVARIANT';
      if (msg.includes('CANONICAL_SALE_COMMITTED')) return 'CANONICAL_SALE_COMMITTED_RUNTIME_PENDING';
      if (msg.includes('STALE_WATCH_SOLD')) return 'STALE_WATCH_SOLD';
      if (msg.includes('STALE_WATCH_MISSING')) return 'STALE_WATCH_MISSING';
      if (msg.includes('STALE_WATCH_NOT_SELLABLE')) return 'STALE_WATCH_NOT_SELLABLE';
      if (msg.includes('STALE_CUSTOMER_MISSING')) return 'STALE_CUSTOMER_MISSING';
      if (msg.includes('STALE_RECEIVABLE')) return msg.includes('OUTSTANDING')
        ? 'STALE_RECEIVABLE_OUTSTANDING'
        : 'STALE_RECEIVABLE';
      if (msg.includes('STALE_PAYABLE_PAYMENT_REVERSED')) {
        return 'STALE_PAYABLE_PAYMENT_REVERSED';
      }
      if (msg.includes('STALE_PAYABLE_PAYMENT_MISSING_TREASURY')) {
        return 'STALE_PAYABLE_PAYMENT_MISSING_TREASURY';
      }
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
