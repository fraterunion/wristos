import { ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { AIAuditEventType, AIRequest, AIRequestStatus } from '@prisma/client';
import { ReadPlanRunner, ReadPlanResult } from '../bindings/read-plan-runner';
import { canonicalize, JsonValue } from '../domain/canonical-json';
import { PlannerService } from '../planner/planner.service';
import { BusinessExecutionPlan } from '../planner/planner.types';
import { AIRequestService } from './ai-request.service';
import { PreparedAssistantRequest, StructuredAssistantPersistence } from './structured-assistant.persistence';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from './structured-assistant.types';

const READ_ACTIONS = new Set(['GET_LIQUIDITY', 'GET_MONTHLY_PROFIT', 'SEARCH_INVENTORY', 'SEARCH_CLIENT', 'GET_CLIENT_ACCOUNTS', 'GET_INVENTORY_AGING', 'GET_TOP_INVENTORY_CAPITAL', 'GET_TOP_DEBTORS', 'GET_RECEIVABLE_SUMMARY', 'GET_SALES_MARGIN_SUMMARY', 'GET_PROFIT_BY_BRAND', 'GET_TOP_SALES', 'GET_ATTENTION_ITEMS', 'GET_BUSINESS_SUMMARY']);

@Injectable()
export class StructuredAssistantService {
  constructor(
    private readonly requests: AIRequestService,
    private readonly persistence: StructuredAssistantPersistence,
    private readonly planner: PlannerService,
    private readonly readRunner: ReadPlanRunner,
  ) {}

  async execute(actor: AssistantActorContext, input: StructuredAssistantRequest): Promise<StructuredAssistantResponse> {
    const claim = await this.requests.claim(actor, input);
    if (claim.kind !== 'OWNED') return claim.response;
    return this.runClaimed(actor, input, claim.request);
  }

  /**
   * Continues the orchestration lifecycle for a request some OTHER durable
   * claim already owns (e.g. NaturalLanguageAssistantService's claimText(),
   * taken before ever calling an LLM provider) — under that SAME AIRequest
   * identity, never a second claim(). Everything from here on is identical
   * to execute()'s own body; this is a pure extraction, not new logic.
   */
  async executeClaimed(actor: AssistantActorContext, input: StructuredAssistantRequest, request: AIRequest): Promise<StructuredAssistantResponse> {
    return this.runClaimed(actor, input, request);
  }

  private async runClaimed(actor: AssistantActorContext, input: StructuredAssistantRequest, request: AIRequest): Promise<StructuredAssistantResponse> {
    let prepared: PreparedAssistantRequest | undefined;
    try {
      await this.requests.transition(request.id, [AIRequestStatus.RECEIVED], AIRequestStatus.VALIDATING);
      this.assertRequestBounds(input);
      prepared = await this.persistence.prepare(request.id, actor, input, request.traceId);
      const plan = this.planner.plan({ intent: input.intent, entities: input.entities }, { workspaceVersion: prepared.workspaceVersion, entityVersions: input.entityVersions ?? {} });
      const checkpoint = await this.persistence.checkpointPlan(request.id, actor, input, prepared, plan);

      if (plan.state === 'NEEDS_CLARIFICATION') {
        const response = this.clarificationResponse(request.id, request.traceId, prepared, checkpoint.actionRun.id, plan);
        return this.persistence.complete(request.id, actor, response, checkpoint.workspaceVersion, AIAuditEventType.ASSISTANT_REQUEST_COMPLETED, AIRequestStatus.NEEDS_CLARIFICATION, { intent: input.intent, entities: input.entities });
      }
      if (!READ_ACTIONS.has(input.intent)) {
        const response = this.writePreviewResponse(request.id, request.traceId, prepared, checkpoint.actionRun.id, plan);
        return this.persistence.complete(request.id, actor, response, checkpoint.workspaceVersion, AIAuditEventType.ASSISTANT_REQUEST_COMPLETED, AIRequestStatus.READY_FOR_CONFIRMATION, { intent: input.intent, entities: input.entities });
      }

      const result = await this.readRunner.run({
        plan,
        current: { workspaceVersion: prepared.workspaceVersion, entityVersions: input.entityVersions ?? {} },
        expectedFingerprint: plan.fingerprint,
        actionRunId: checkpoint.actionRun.id,
        toolContext: {
          tenantId: actor.tenantId, userId: actor.userId, role: actor.role, permissions: actor.permissions,
          conversationId: prepared.conversationId, workspaceId: prepared.workspaceId, actionRunId: checkpoint.actionRun.id,
          requestId: request.traceId, locale: input.locale ?? 'es-MX', timezone: input.timezone ?? 'UTC', now: request.receivedAt,
        },
      });
      const response = this.readResponse(request.id, request.traceId, prepared, checkpoint.actionRun.id, input.intent, plan, result);
      const failed = result.executionState !== 'COMPLETED';
      return this.persistence.complete(request.id, actor, response, checkpoint.workspaceVersion, failed ? AIAuditEventType.ASSISTANT_REQUEST_FAILED : AIAuditEventType.ASSISTANT_REQUEST_COMPLETED, failed ? AIRequestStatus.FAILED : AIRequestStatus.COMPLETED, { intent: input.intent, entities: input.entities });
    } catch (error) {
      const response = this.errorResponse(request.id, request.traceId, prepared, error);
      if (!prepared) return this.requests.failUnattached(request, actor, input.intent, response, this.failureType(error));
      return this.persistence.complete(request.id, actor, response, await this.currentWorkspaceVersion(actor, prepared), AIAuditEventType.ASSISTANT_REQUEST_FAILED, AIRequestStatus.FAILED, { intent: input.intent, entities: input.entities });
    }
  }

  private clarificationResponse(requestId: string, traceId: string, prepared: PreparedAssistantRequest, actionRunId: string, plan: BusinessExecutionPlan): StructuredAssistantResponse {
    return this.responseBase(requestId, traceId, prepared, actionRunId, 'NEEDS_INPUT', 'MISSING_FIELDS_CARD', {
      title: 'Faltan datos para continuar',
      groups: [{ id: 'required', label: 'Datos requeridos', fields: plan.missingEntities.map((item) => ({ key: item.entity, question: item.question })) }],
      message: 'Completa los campos indicados. No se ejecutó ninguna consulta ni se modificaron datos.',
      unchanged: 'No se ejecutó ninguna acción.',
      nextAction: 'Envía una nueva solicitud estructurada con los campos requeridos.',
    }, plan);
  }

  private writePreviewResponse(requestId: string, traceId: string, prepared: PreparedAssistantRequest, actionRunId: string, plan: BusinessExecutionPlan): StructuredAssistantResponse {
    const executable = plan.businessAction === 'REGISTER_SALE';
    return this.responseBase(requestId, traceId, prepared, actionRunId, 'READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      preview: plan.preview as unknown as JsonValue,
      planFingerprint: plan.fingerprint,
      executable,
      correctionPolicy: executable
        ? 'Después de registrarla, cualquier corrección se realiza desde Ventas.'
        : null,
      message: executable
        ? 'Revisa el resumen y confirma para registrar la venta.'
        : 'Esta acción todavía no está habilitada para ejecución desde el asistente.',
      unchanged: 'No se ejecutó ni modificó ningún dato de negocio.',
      nextAction: executable
        ? 'Confirma la venta para ejecutar el registro canónico.'
        : 'Usa el flujo canónico de la aplicación para completar esta acción.',
    }, plan);
  }

  private readResponse(requestId: string, traceId: string, prepared: PreparedAssistantRequest, actionRunId: string, intent: string, plan: BusinessExecutionPlan, result: ReadPlanResult): StructuredAssistantResponse {
    if (result.executionState !== 'COMPLETED') return this.responseBase(requestId, traceId, prepared, actionRunId, 'FAILED', 'ERROR_RECOVERY_CARD', {
      code: 'READ_EXECUTION_FAILED', message: 'No fue posible completar la consulta.', unchanged: 'No se modificaron datos de negocio.', nextAction: 'Intenta nuevamente con un clientRequestId nuevo.',
    }, plan);
    const capability = result.stepResults[0]?.result;
    const responseType = ['GET_LIQUIDITY', 'GET_MONTHLY_PROFIT', 'GET_RECEIVABLE_SUMMARY', 'GET_SALES_MARGIN_SUMMARY', 'GET_ATTENTION_ITEMS', 'GET_BUSINESS_SUMMARY'].includes(intent) ? 'METRIC_BREAKDOWN' : 'ENTITY_LIST';
    return this.responseBase(requestId, traceId, prepared, actionRunId, 'COMPLETED', responseType, {
      data: this.toJson(capability?.data ?? null),
      summary: capability?.summary ?? 'Consulta completada.',
      planFingerprint: plan.fingerprint,
      receipt: { executionState: 'COMPLETED', traceId: result.traceId, durationMs: result.durationMs },
    }, plan);
  }

  private errorResponse(requestId: string, traceId: string, prepared: PreparedAssistantRequest | undefined, error: unknown): StructuredAssistantResponse {
    const stale = error instanceof ConflictException;
    const denied = error instanceof ForbiddenException;
    const notFound = error instanceof NotFoundException;
    const errorType = this.failureType(error);
    const state = stale ? 'STALE_PLAN' : denied ? 'PERMISSION_BLOCKED' : 'FAILED';
    return {
      requestId, conversationId: prepared?.conversationId ?? '', workspaceId: prepared?.workspaceId ?? '',
      interactionState: state, responseType: 'ERROR_RECOVERY_CARD',
      payload: {
        errorType,
        code: errorType,
        message: stale ? 'El estado cambió y la solicitud ya no es vigente.' : denied ? 'No tienes acceso a los datos solicitados.' : notFound ? 'No se encontró el recurso solicitado.' : 'No fue posible procesar la solicitud.',
        unchanged: 'No se ejecutó ninguna acción de escritura ni se modificaron datos de negocio.',
        nextAction: stale ? 'Actualiza el espacio de trabajo y envía una solicitud nueva.' : 'Revisa los datos y envía una solicitud nueva.',
      },
      warnings: [], suggestedActions: [], traceId, createdAt: new Date().toISOString(),
    };
  }

  private responseBase(requestId: string, traceId: string, prepared: PreparedAssistantRequest, actionRunId: string, interactionState: StructuredAssistantResponse['interactionState'], responseType: StructuredAssistantResponse['responseType'], payload: Record<string, JsonValue>, plan: BusinessExecutionPlan): StructuredAssistantResponse {
    return { requestId, conversationId: prepared.conversationId, workspaceId: prepared.workspaceId, actionRunId, interactionState, responseType, payload, warnings: plan.warnings, suggestedActions: [], traceId, createdAt: new Date().toISOString() };
  }

  private failureType(error: unknown): string {
    if (error instanceof ConflictException) return 'CONFLICT';
    if (error instanceof ForbiddenException) return 'PERMISSION_DENIED';
    if (error instanceof NotFoundException) return 'NOT_FOUND';
    return error instanceof Error ? error.constructor.name : 'UNKNOWN_ERROR';
  }

  private toJson(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

  private assertRequestBounds(input: StructuredAssistantRequest): void {
    const canonicalSize = Buffer.byteLength(canonicalize({ intent: input.intent, entities: input.entities, entityVersions: input.entityVersions ?? {}, userDisplayText: input.userDisplayText ?? null }));
    if (canonicalSize > 64 * 1024) throw new PayloadTooLargeException('Structured assistant request exceeds 64 KiB');
  }

  private async currentWorkspaceVersion(actor: AssistantActorContext, prepared: PreparedAssistantRequest): Promise<number> {
    return this.persistence.currentWorkspaceVersion(actor, prepared.workspaceId);
  }
}
