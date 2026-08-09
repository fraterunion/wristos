import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, PayloadTooLargeException } from '@nestjs/common';
import { AIAuditEventType, AIRequest, AIRequestStatus } from '@prisma/client';
import { ReadPlanRunner, ReadPlanResult } from '../bindings/read-plan-runner';
import { CreateClientEntityResolver } from '../bindings/write/create-client-entity-resolver.service';
import { enrichExpenseEntities } from '../bindings/write/expense-entity-enricher';
import { enrichPurchaseEntities } from '../bindings/write/purchase-entity-enricher';
import { PurchaseEntityResolver } from '../bindings/write/purchase-entity-resolver.service';
import { PayablePaymentEntityResolver } from '../bindings/write/payable-payment-entity-resolver.service';
import { ReceivablePaymentEntityResolver } from '../bindings/write/receivable-payment-entity-resolver.service';
import { SaleCustomerEntityResolver } from '../bindings/write/sale-customer-entity-resolver.service';
import { UpdateClientEntityResolver } from '../bindings/write/update-client-entity-resolver.service';
import { CompositionOrchestrator } from '../composition/composition-orchestrator.service';
import { canonicalize, JsonValue } from '../domain/canonical-json';
import { PlannerService } from '../planner/planner.service';
import { BusinessExecutionPlan } from '../planner/planner.types';
import { mapClarificationType, mapFailureTaxonomy, telem } from '../telemetry/telemetry-hooks';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter.service';
import { AIRequestService } from './ai-request.service';
import { PreparedAssistantRequest, StructuredAssistantPersistence } from './structured-assistant.persistence';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from './structured-assistant.types';

const READ_ACTIONS = new Set(['GET_LIQUIDITY', 'GET_MONTHLY_PROFIT', 'SEARCH_INVENTORY', 'SEARCH_CLIENT', 'GET_CLIENT_ACCOUNTS', 'GET_INVENTORY_AGING', 'GET_TOP_INVENTORY_CAPITAL', 'GET_TOP_DEBTORS', 'GET_RECEIVABLE_SUMMARY', 'GET_SALES_MARGIN_SUMMARY', 'GET_PROFIT_BY_BRAND', 'GET_TOP_SALES', 'GET_ATTENTION_ITEMS', 'GET_BUSINESS_SUMMARY']);
const EXECUTABLE_WRITES = new Set([
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_EXPENSE',
  'REGISTER_PURCHASE',
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
]);

@Injectable()
export class StructuredAssistantService {
  constructor(
    private readonly requests: AIRequestService,
    private readonly persistence: StructuredAssistantPersistence,
    private readonly planner: PlannerService,
    private readonly readRunner: ReadPlanRunner,
    private readonly receivablePaymentResolver: ReceivablePaymentEntityResolver,
    private readonly payablePaymentResolver: PayablePaymentEntityResolver,
    private readonly purchaseEntityResolver: PurchaseEntityResolver,
    private readonly saleCustomerEntityResolver: SaleCustomerEntityResolver,
    private readonly createClientEntityResolver: CreateClientEntityResolver,
    private readonly updateClientEntityResolver: UpdateClientEntityResolver,
    private readonly compositionOrchestrator: CompositionOrchestrator,
    @Optional() private readonly telemetry?: TelemetryEmitter,
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
    const totalStarted = Date.now();
    try {
      await this.requests.transition(request.id, [AIRequestStatus.RECEIVED], AIRequestStatus.VALIDATING);
      this.assertRequestBounds(input);
      prepared = await this.persistence.prepare(request.id, actor, input, request.traceId);
      telem(this.telemetry, {
        event: 'ConversationStarted',
        tenantId: actor.tenantId,
        conversationId: prepared.conversationId,
        workspaceId: prepared.workspaceId,
        requestId: request.id,
        normalizedIntent: input.intent,
        plannerIntent: input.intent,
        capability: input.intent,
        funnelStage: 'intent',
      });

      // Crash recovery: CREATE_CLIENT completed but parent preview never checkpointed.
      const recoveredComposition = await this.tryRecoverComposition(actor, request, prepared);
      if (recoveredComposition) return recoveredComposition;

      let entities = input.entities;
      if (input.intent === 'REGISTER_RECEIVABLE_PAYMENT') {
        const resolved = await this.receivablePaymentResolver.resolve(actor.tenantId, entities);
        entities = resolved.entities;
        if (resolved.clarify) {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            capability: input.intent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: 'account_disambiguation',
            candidateCount: resolved.clarify.items?.length,
            multipleCandidates: (resolved.clarify.items?.length ?? 0) > 1,
            entityPickerUsed: true,
          });
          const response = this.accountDisambiguationResponse(
            request.id,
            request.traceId,
            prepared,
            resolved.clarify.message,
            resolved.clarify.items,
            resolved.clarify.entityType,
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
        telem(this.telemetry, {
          event: 'PlannerCompleted',
          tenantId: actor.tenantId,
          requestId: request.id,
          capability: input.intent,
          uniqueResolution: resolved.uniqueReceivableSelected === true,
          candidateCount: resolved.uniqueReceivableSelected ? 1 : undefined,
        });
      }
      if (input.intent === 'REGISTER_PAYABLE_PAYMENT') {
        const resolved = await this.payablePaymentResolver.resolve(actor.tenantId, entities);
        entities = resolved.entities;
        if (resolved.clarify) {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            capability: input.intent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: 'payable_disambiguation',
            candidateCount: resolved.clarify.items?.length,
            multipleCandidates: (resolved.clarify.items?.length ?? 0) > 1,
            entityPickerUsed: true,
          });
          const response = this.accountDisambiguationResponse(
            request.id,
            request.traceId,
            prepared,
            resolved.clarify.message,
            resolved.clarify.items,
            resolved.clarify.entityType,
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
        telem(this.telemetry, {
          event: 'PlannerCompleted',
          tenantId: actor.tenantId,
          requestId: request.id,
          capability: input.intent,
          uniqueResolution: resolved.uniquePayableSelected === true,
          candidateCount: resolved.uniquePayableSelected ? 1 : undefined,
        });
      }
      if (input.intent === 'REGISTER_EXPENSE') {
        entities = enrichExpenseEntities(entities, request.receivedAt) as typeof entities;
      }
      if (input.intent === 'CREATE_CLIENT') {
        const resolved = await this.createClientEntityResolver.resolve(
          actor.tenantId,
          entities as Record<string, JsonValue>,
        );
        entities = resolved.entities as typeof entities;
        if (resolved.kind === 'USE_EXISTING') {
          const active = await this.compositionOrchestrator.loadActive({
            tenantId: actor.tenantId,
            userId: actor.userId,
            workspaceId: prepared.workspaceId,
          });
          const composition = active.composition;
          if (composition && composition.state !== 'CANCELLED') {
            const resumed = await this.compositionOrchestrator.resumeParentAfterClient({
              actor,
              requestId: request.id,
              traceId: request.traceId,
              workspaceId: prepared.workspaceId,
              conversationId: prepared.conversationId,
              expectedVersion: active.version,
              clientId: resolved.clientId,
              clientLabel: resolved.clientName,
              kind: 'CLIENT_REUSED',
            });
            if ('parentResponse' in resumed) {
              return this.persistence.complete(
                request.id,
                actor,
                resumed.parentResponse,
                resumed.workspaceVersion,
                AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
                resumed.parentResponse.interactionState === 'READY_FOR_CONFIRMATION'
                  ? AIRequestStatus.READY_FOR_CONFIRMATION
                  : AIRequestStatus.NEEDS_CLARIFICATION,
                { intent: resumed.parentCapability, entities },
              );
            }
            const partial = this.responseBase(
              request.id,
              request.traceId,
              prepared,
              '',
              'COMPLETED',
              'ERROR_RECOVERY_CARD',
              {
                code: 'COMPOSITION_PARTIAL',
                message: resumed.message,
                unchanged: 'No se registró la acción principal.',
                nextAction: 'Reintenta continuar; el cliente existente ya está identificado.',
              },
              this.planner.plan(
                { intent: 'SEARCH_CLIENT', entities: { query: resolved.clientName } },
                { workspaceVersion: prepared.workspaceVersion, entityVersions: {} },
              ),
            );
            return this.persistence.complete(
              request.id,
              actor,
              partial,
              resumed.workspaceVersion,
              AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
              AIRequestStatus.COMPLETED,
              { intent: input.intent, entities },
            );
          }
          const response = this.responseBase(
            request.id,
            request.traceId,
            prepared,
            '',
            'COMPLETED',
            'ENTITY_LIST',
            {
              message: `Usaré el cliente existente «${resolved.clientName}». No se creó un cliente nuevo.`,
              data: {
                items: [{ id: resolved.clientId, label: resolved.clientName, name: resolved.clientName }],
              },
              entityType: 'CLIENT',
              summary: `Cliente existente: ${resolved.clientName}`,
              unchanged: 'No se creó ningún cliente nuevo.',
              nextAction: 'Puedes continuar con una venta, compra o pago usando este cliente.',
            },
            this.planner.plan(
              { intent: 'SEARCH_CLIENT', entities: { query: resolved.clientName } },
              { workspaceVersion: prepared.workspaceVersion, entityVersions: {} },
            ),
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.COMPLETED,
            { intent: input.intent, entities },
          );
        }
        if (resolved.kind === 'CLARIFY') {
          const block = resolved.clarify.blockCreate === true;
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            capability: input.intent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: resolved.clarify.code ?? resolved.clarify.field,
            candidateCount: resolved.clarify.items?.length,
            multipleCandidates: (resolved.clarify.items?.length ?? 0) > 1,
            entityPickerUsed: !block && (resolved.clarify.items?.length ?? 0) > 0,
          });
          if (block) {
            const response = this.responseBase(
              request.id,
              request.traceId,
              prepared,
              '',
              'FAILED',
              'ERROR_RECOVERY_CARD',
              {
                code: resolved.clarify.code ?? 'CLIENT_IDENTITY_CONFLICT',
                message: resolved.clarify.message,
                matchField: resolved.clarify.matchField ?? null,
                unchanged: 'No se creó ningún cliente.',
                nextAction:
                  resolved.clarify.code === 'CLIENT_DELETED_MATCH'
                    ? 'Abre CRM para restaurar el cliente eliminado si corresponde.'
                    : 'Usa el cliente existente desde CRM, o corrige los datos de contacto.',
              },
              this.planner.plan(
                { intent: 'CREATE_CLIENT', entities },
                { workspaceVersion: prepared.workspaceVersion, entityVersions: {} },
              ),
            );
            return this.persistence.complete(
              request.id,
              actor,
              response,
              prepared.workspaceVersion,
              AIAuditEventType.ASSISTANT_REQUEST_FAILED,
              AIRequestStatus.FAILED,
              { intent: input.intent, entities },
            );
          }
          const response = this.accountDisambiguationResponse(
            request.id,
            request.traceId,
            prepared,
            resolved.clarify.message,
            resolved.clarify.items,
            resolved.clarify.entityType,
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
      }
      if (input.intent === 'UPDATE_CLIENT') {
        const resolved = await this.updateClientEntityResolver.resolve(
          actor.tenantId,
          entities as Record<string, JsonValue>,
        );
        entities = resolved.entities as typeof entities;
        if (resolved.kind === 'NOOP') {
          const response = this.responseBase(
            request.id,
            request.traceId,
            prepared,
            '',
            'COMPLETED',
            'TEXT_ANSWER',
            {
              message: resolved.message,
              unchanged: 'No se modificó ningún cliente.',
              nextAction: 'Indica otro cambio si lo necesitas.',
            },
            this.planner.plan(
              { intent: 'UPDATE_CLIENT', entities },
              { workspaceVersion: prepared.workspaceVersion, entityVersions: {} },
            ),
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.COMPLETED,
            { intent: input.intent, entities },
          );
        }
        if (resolved.kind === 'CLARIFY') {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            capability: input.intent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: resolved.clarify.code ?? resolved.clarify.field,
            candidateCount: resolved.clarify.items?.length,
            multipleCandidates: (resolved.clarify.items?.length ?? 0) > 1,
            entityPickerUsed: (resolved.clarify.items?.length ?? 0) > 0,
          });
          const response = this.accountDisambiguationResponse(
            request.id,
            request.traceId,
            prepared,
            resolved.clarify.message,
            resolved.clarify.items,
            resolved.clarify.entityType,
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
      }
      if (input.intent === 'REGISTER_PURCHASE') {
        entities = enrichPurchaseEntities(entities as Record<string, unknown>, request.receivedAt) as typeof entities;
        const resolved = await this.purchaseEntityResolver.resolve(
          actor.tenantId,
          entities as Record<string, JsonValue>,
        );
        entities = resolved.entities as typeof entities;
        if (resolved.clarify) {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            capability: input.intent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: 'seller_disambiguation',
            candidateCount: resolved.clarify.items?.length,
            multipleCandidates: (resolved.clarify.items?.length ?? 0) > 1,
            entityPickerUsed: true,
          });
          const response = this.accountDisambiguationResponse(
            request.id,
            request.traceId,
            prepared,
            resolved.clarify.message,
            resolved.clarify.items,
            resolved.clarify.entityType,
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
        if (resolved.dependencyRequired) {
          const paused = await this.compositionOrchestrator.pausePurchaseSellerMissing({
            actor,
            prepared,
            requestId: request.id,
            traceId: request.traceId,
            entities: entities as Record<string, JsonValue>,
            query: resolved.dependencyRequired.query,
            message: resolved.dependencyRequired.message,
          });
          return this.persistence.complete(
            request.id,
            actor,
            paused.response,
            paused.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
      }
      if (input.intent === 'REGISTER_SALE') {
        const resolved = await this.saleCustomerEntityResolver.resolve(
          actor.tenantId,
          entities as Record<string, JsonValue>,
        );
        entities = resolved.entities as typeof entities;
        if (resolved.clarify) {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            capability: input.intent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: 'customer_disambiguation',
            candidateCount: resolved.clarify.items?.length,
            multipleCandidates: (resolved.clarify.items?.length ?? 0) > 1,
            entityPickerUsed: true,
          });
          const response = this.accountDisambiguationResponse(
            request.id,
            request.traceId,
            prepared,
            resolved.clarify.message,
            resolved.clarify.items,
            resolved.clarify.entityType,
          );
          return this.persistence.complete(
            request.id,
            actor,
            response,
            prepared.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
        if (resolved.dependencyRequired) {
          const paused = await this.compositionOrchestrator.pauseSaleCustomerMissing({
            actor,
            prepared,
            requestId: request.id,
            traceId: request.traceId,
            entities: entities as Record<string, JsonValue>,
            query: resolved.dependencyRequired.query,
            message: resolved.dependencyRequired.message,
          });
          return this.persistence.complete(
            request.id,
            actor,
            paused.response,
            paused.workspaceVersion,
            AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
            AIRequestStatus.NEEDS_CLARIFICATION,
            { intent: input.intent, entities },
          );
        }
      }

      const plannedInput = { ...input, entities };
      const plannerStarted = Date.now();
      telem(this.telemetry, {
        event: 'PlannerStarted',
        tenantId: actor.tenantId,
        requestId: request.id,
        capability: plannedInput.intent,
        plannerIntent: plannedInput.intent,
      });
      const plan = this.planner.plan(
        { intent: plannedInput.intent, entities },
        { workspaceVersion: prepared.workspaceVersion, entityVersions: plannedInput.entityVersions ?? {} },
      );
      const plannerLatencyMs = Date.now() - plannerStarted;
      telem(this.telemetry, {
        event: 'PlannerCompleted',
        tenantId: actor.tenantId,
        requestId: request.id,
        capability: plan.businessAction,
        plannerIntent: plan.businessAction,
        plannerLatencyMs,
        funnelStage: 'intent',
      });
      const checkpoint = await this.persistence.checkpointPlan(
        request.id,
        actor,
        plannedInput,
        prepared,
        plan,
        { plannerLatencyMs },
      );

      // Composition V1: CREATE_CLIENT child preview attaches to paused parent draft.
      let workspaceVersion = checkpoint.workspaceVersion;
      if (plannedInput.intent === 'CREATE_CLIENT' && plan.state !== 'NEEDS_CLARIFICATION') {
        const active = await this.compositionOrchestrator.loadActive({
          tenantId: actor.tenantId,
          userId: actor.userId,
          workspaceId: prepared.workspaceId,
        });
        if (
          active.composition &&
          active.composition.state === 'DEPENDENCY_REQUIRED' &&
          active.composition.childCapability === 'CREATE_CLIENT'
        ) {
          workspaceVersion = await this.compositionOrchestrator.attachChildPreview({
            tenantId: actor.tenantId,
            userId: actor.userId,
            workspaceId: prepared.workspaceId,
            expectedVersion: active.version,
            childActionRunId: checkpoint.actionRun.id,
          });
        }
      }

      if (plan.state === 'NEEDS_CLARIFICATION') {
        for (const missing of plan.missingEntities) {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: prepared.conversationId,
            requestId: request.id,
            actionRunId: checkpoint.actionRun.id,
            capability: plan.businessAction,
            clarificationType: mapClarificationType(missing.entity),
            clarificationReason: missing.entity,
          });
        }
        const response = this.clarificationResponse(request.id, request.traceId, prepared, checkpoint.actionRun.id, plan);
        return this.persistence.complete(request.id, actor, response, workspaceVersion, AIAuditEventType.ASSISTANT_REQUEST_COMPLETED, AIRequestStatus.NEEDS_CLARIFICATION, { intent: plannedInput.intent, entities });
      }
      if (!READ_ACTIONS.has(plannedInput.intent)) {
        telem(this.telemetry, {
          event: 'PreviewShown',
          tenantId: actor.tenantId,
          conversationId: prepared.conversationId,
          requestId: request.id,
          actionRunId: checkpoint.actionRun.id,
          capability: plan.businessAction,
          plannerIntent: plan.businessAction,
          shown: true,
          funnelStage: 'preview',
          plannerLatencyMs,
          totalLatencyMs: Date.now() - totalStarted,
        });
        const response = this.writePreviewResponse(request.id, request.traceId, prepared, checkpoint.actionRun.id, plan);
        return this.persistence.complete(request.id, actor, response, workspaceVersion, AIAuditEventType.ASSISTANT_REQUEST_COMPLETED, AIRequestStatus.READY_FOR_CONFIRMATION, { intent: plannedInput.intent, entities });
      }

      telem(this.telemetry, {
        event: 'ExecutionStarted',
        tenantId: actor.tenantId,
        requestId: request.id,
        actionRunId: checkpoint.actionRun.id,
        capability: plan.businessAction,
        funnelStage: 'execution',
      });
      const execStarted = Date.now();
      const result = await this.readRunner.run({
        plan,
        current: { workspaceVersion: prepared.workspaceVersion, entityVersions: plannedInput.entityVersions ?? {} },
        expectedFingerprint: plan.fingerprint,
        actionRunId: checkpoint.actionRun.id,
        toolContext: {
          tenantId: actor.tenantId, userId: actor.userId, role: actor.role, permissions: actor.permissions,
          conversationId: prepared.conversationId, workspaceId: prepared.workspaceId, actionRunId: checkpoint.actionRun.id,
          requestId: request.traceId, locale: plannedInput.locale ?? 'es-MX', timezone: plannedInput.timezone ?? 'UTC', now: request.receivedAt,
        },
      });
      const domainLatencyMs = Date.now() - execStarted;
      const response = this.readResponse(request.id, request.traceId, prepared, checkpoint.actionRun.id, plannedInput.intent, plan, result);
      const failed = result.executionState !== 'COMPLETED';
      telem(this.telemetry, {
        event: failed ? 'ExecutionFailed' : 'ExecutionCompleted',
        tenantId: actor.tenantId,
        requestId: request.id,
        actionRunId: checkpoint.actionRun.id,
        capability: plan.businessAction,
        completed: !failed,
        failed,
        domainLatencyMs,
        plannerLatencyMs,
        totalLatencyMs: Date.now() - totalStarted,
        funnelStage: failed ? 'execution' : 'completed',
        outcome: failed ? 'FAILED' : 'SUCCESS',
        failureType: failed ? 'DOMAIN_FAILURE' : undefined,
      });
      telem(this.telemetry, {
        event: 'ConversationFinished',
        tenantId: actor.tenantId,
        requestId: request.id,
        actionRunId: checkpoint.actionRun.id,
        capability: plan.businessAction,
        outcome: failed ? 'FAILED' : 'SUCCESS',
        totalLatencyMs: Date.now() - totalStarted,
      });
      return this.persistence.complete(request.id, actor, response, checkpoint.workspaceVersion, failed ? AIAuditEventType.ASSISTANT_REQUEST_FAILED : AIAuditEventType.ASSISTANT_REQUEST_COMPLETED, failed ? AIRequestStatus.FAILED : AIRequestStatus.COMPLETED, { intent: plannedInput.intent, entities });
    } catch (error) {
      const response = this.errorResponse(request.id, request.traceId, prepared, error);
      telem(this.telemetry, {
        event: 'ExecutionFailed',
        tenantId: actor.tenantId,
        requestId: request.id,
        conversationId: prepared?.conversationId,
        capability: input.intent,
        failed: true,
        failureType: mapFailureTaxonomy(this.failureType(error)),
        outcome: 'FAILED',
        totalLatencyMs: Date.now() - totalStarted,
      });
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
    const executable = EXECUTABLE_WRITES.has(plan.businessAction);
    const isPayment =
      plan.businessAction === 'REGISTER_RECEIVABLE_PAYMENT' ||
      plan.businessAction === 'REGISTER_PAYABLE_PAYMENT';
    const isExpense = plan.businessAction === 'REGISTER_EXPENSE';
    const isPurchase = plan.businessAction === 'REGISTER_PURCHASE';
    const isCreateClient = plan.businessAction === 'CREATE_CLIENT';
    const isUpdateClient = plan.businessAction === 'UPDATE_CLIENT';
    const correctionPolicy = !executable
      ? null
      : isPayment
        ? 'Después de registrarlo, cualquier corrección se realiza desde Cuentas.'
        : isExpense
          ? 'Después de registrarlo, cualquier corrección se realiza desde Gastos.'
          : isPurchase
            ? 'Después de registrarla, cualquier corrección se realiza desde Inventario.'
            : isCreateClient || isUpdateClient
              ? 'Después de guardarlo, cualquier corrección se realiza desde CRM.'
              : 'Después de registrarla, cualquier corrección se realiza desde Ventas.';
    const message = !executable
      ? 'Esta acción todavía no está habilitada para ejecución desde el asistente.'
      : isPayment
        ? 'Revisa el resumen y confirma para registrar el pago.'
        : isExpense
          ? 'Revisa el resumen y confirma para registrar el gasto.'
          : isPurchase
            ? 'Revisa el resumen y confirma para registrar la compra.'
            : isCreateClient
              ? 'Voy a crear este cliente. Revisa el resumen y confirma.'
              : isUpdateClient
                ? 'Voy a actualizar este cliente. Revisa el resumen y confirma.'
                : 'Revisa el resumen y confirma para registrar la venta.';
    const nextAction = !executable
      ? 'Usa el flujo canónico de la aplicación para completar esta acción.'
      : isPayment
        ? 'Confirma el pago para ejecutar el registro canónico.'
        : isExpense
          ? 'Confirma el gasto para ejecutar el registro canónico.'
          : isPurchase
            ? 'Confirma la compra para ejecutar el registro canónico.'
            : isCreateClient
              ? 'Confirma para crear el cliente canónico.'
              : isUpdateClient
                ? 'Confirma para guardar los cambios del cliente.'
                : 'Confirma la venta para ejecutar el registro canónico.';
    return this.responseBase(requestId, traceId, prepared, actionRunId, 'READY_FOR_CONFIRMATION', 'ACTION_PREVIEW_CARD', {
      preview: plan.preview as unknown as JsonValue,
      planFingerprint: plan.fingerprint,
      executable,
      correctionPolicy,
      message,
      unchanged: 'No se ejecutó ni modificó ningún dato de negocio.',
      nextAction,
    }, plan);
  }

  private accountDisambiguationResponse(
    requestId: string,
    traceId: string,
    prepared: PreparedAssistantRequest,
    message: string,
    items: Array<Record<string, JsonValue>>,
    entityType: 'CLIENT' | 'WATCH' | 'ACCOUNT_ENTRY',
  ): StructuredAssistantResponse {
    return {
      requestId,
      conversationId: prepared.conversationId,
      workspaceId: prepared.workspaceId,
      interactionState: 'NEEDS_DISAMBIGUATION',
      responseType: 'ENTITY_PICKER',
      payload: {
        message,
        entityType,
        data: { items },
        unchanged: 'No se ejecutó ninguna acción.',
        nextAction: 'Elige con “el primero”, “el segundo”, o nómbralo.',
      },
      warnings: [],
      suggestedActions: [],
      traceId,
      createdAt: new Date().toISOString(),
    };
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
    // Omit empty actionRunId — '' is not a valid FK and breaks AIAuditEvent persistence.
    return {
      requestId,
      conversationId: prepared.conversationId,
      workspaceId: prepared.workspaceId,
      ...(actionRunId ? { actionRunId } : {}),
      interactionState,
      responseType,
      payload,
      warnings: plan.warnings,
      suggestedActions: [],
      traceId,
      createdAt: new Date().toISOString(),
    };
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

  /**
   * If CREATE_CLIENT child committed but parent preview was never checkpointed,
   * resume the parked parent exactly once (no second Client create).
   */
  private async tryRecoverComposition(
    actor: AssistantActorContext,
    request: AIRequest,
    prepared: PreparedAssistantRequest,
  ): Promise<StructuredAssistantResponse | null> {
    const active = await this.compositionOrchestrator.loadActive({
      tenantId: actor.tenantId,
      userId: actor.userId,
      workspaceId: prepared.workspaceId,
    });
    if (!active.composition || active.composition.state === 'CANCELLED') return null;
    if (
      active.composition.state !== 'DEPENDENCY_COMPLETED' &&
      active.composition.state !== 'PRIMARY_RESUMING' &&
      !(active.composition.childActionRunId && !active.composition.resolvedClientId)
    ) {
      return null;
    }
    const resumed = await this.compositionOrchestrator.recoverPendingResume({
      actor,
      requestId: request.id,
      traceId: request.traceId,
      workspaceId: prepared.workspaceId,
      conversationId: prepared.conversationId,
      expectedVersion: active.version,
      resolvedContext: active.resolvedContext,
    });
    if (!resumed) return null;
    return this.persistence.complete(
      request.id,
      actor,
      resumed.parentResponse,
      resumed.workspaceVersion,
      AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
      resumed.parentResponse.interactionState === 'READY_FOR_CONFIRMATION'
        ? AIRequestStatus.READY_FOR_CONFIRMATION
        : AIRequestStatus.NEEDS_CLARIFICATION,
      { intent: resumed.parentCapability, entities: {} },
    );
  }
}
