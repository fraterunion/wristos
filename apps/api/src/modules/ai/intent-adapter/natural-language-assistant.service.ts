import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AIRequestService } from '../assistant/ai-request.service';
import { StructuredAssistantService } from '../assistant/structured-assistant.service';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from '../assistant/structured-assistant.types';
import { toProviderConversationContext } from '../context/provider-context';
import { detectDeterministicReference, isPureReferentialUtterance, looksLikeAccountsContinuation } from '../context/ordinal-reference';
import { ReferenceResolverService, trustedIdsFromResolution } from '../context/reference-resolver.service';
import { IntentReference } from '../context/reference-schema';
import { mergeTrustedIds, stripUntrustedEntityIds } from '../context/trusted-entities';
import { WORKING_CONTEXT_SCHEMA_VERSION } from '../context/working-context';
import { WorkingContextService } from '../context/working-context.service';
import { AssistantMessageDto } from '../dto/assistant-message.dto';
import { BusinessActionId } from '../planner/planner.types';
import { mapClarificationType, mapFailureTaxonomy, telem } from '../telemetry/telemetry-hooks';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter.service';
import { IntentAdapterService } from './intent-adapter.service';
import { INTENT_CANDIDATE_VALUES, IntentCandidateIntent } from './intent-schema';
import { assertWithinTextLimit, decideConfidencePolicy } from './safety';
import {
  buildEntitySelectedResponse,
  buildPolicyResponse,
  buildProviderFailureResponse,
  buildReferenceClarificationResponse,
} from './typed-responses';

export interface NaturalLanguageAssistantResult {
  /** The intent the message ultimately resolved to, or 'UNKNOWN' for anything that never reached the orchestrator. */
  resolvedIntent: IntentCandidateIntent;
  response: StructuredAssistantResponse;
  /** The entities the adapter resolved (empty for UNKNOWN/failed outcomes). */
  resolvedEntities: Record<string, string | number | boolean>;
}

/**
 * The natural-language entry point (POST /ai/assistant/message).
 *
 * Concurrency invariant: this service calls AIRequestService.claimText()
 * BEFORE ever calling the LLM provider. claimText() takes the exact same
 * durable, DB-unique-constraint-backed claim the structured endpoint has
 * always used — of any number of concurrent requests with the same tenant/actor/
 * clientRequestId/text, at most one can ever return 'OWNED'. Only the
 * OWNED caller reaches this.intentAdapter.interpret() below. Everyone else
 * gets IN_PROGRESS or an exact REPLAY, with zero provider calls.
 *
 * V1.1: AIWorkspace working context is canonical memory. Ordinal/deictic
 * references resolve deterministically BEFORE (or without) asking Claude.
 * Trusted entity IDs never come from the LLM or free-form user text.
 */
@Injectable()
export class NaturalLanguageAssistantService {
  constructor(
    private readonly aiRequests: AIRequestService,
    private readonly intentAdapter: IntentAdapterService,
    private readonly assistant: StructuredAssistantService,
    private readonly referenceResolver: ReferenceResolverService,
    private readonly workingContext: WorkingContextService,
    private readonly prisma: PrismaService,
    @Optional() private readonly telemetry?: TelemetryEmitter,
  ) {}

  async handleMessage(actor: AssistantActorContext, dto: AssistantMessageDto): Promise<NaturalLanguageAssistantResult> {
    const normalizedText = dto.text.trim();
    assertWithinTextLimit(normalizedText);

    const claim = await this.aiRequests.claimText(actor, {
      clientRequestId: dto.clientRequestId,
      text: normalizedText,
      surface: dto.surface,
      locale: dto.locale,
      timezone: dto.timezone,
      conversationId: dto.conversationId,
      workspaceId: dto.workspaceId,
    });

    if (claim.kind === 'REPLAY') {
      await this.aiRequests.auditReplay(actor, claim.request);
      const { intent } = this.aiRequests.readInterpretation(claim.request);
      telem(this.telemetry, {
        event: 'ReplayServed',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: claim.request.id,
        capability: intent ?? undefined,
        replayed: true,
        idempotentReplay: true,
        outcome: 'REPLAYED',
      });
      return {
        resolvedIntent: (intent as IntentCandidateIntent | null) ?? 'UNKNOWN',
        response: claim.response,
        resolvedEntities: {},
      };
    }
    if (claim.kind === 'IN_PROGRESS') {
      return { resolvedIntent: 'UNKNOWN', response: claim.response, resolvedEntities: {} };
    }

    const request = claim.request;
    const traceId = request.traceId;
    const responseCtx = { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId };

    const loaded = await this.workingContext.load(actor.tenantId, actor.userId, dto.workspaceId);
    const deterministicRef = detectDeterministicReference(normalizedText);

    // Pure ordinal/deictic selection — no LLM, no fabricated IDs.
    if (isPureReferentialUtterance(normalizedText) && deterministicRef) {
      const resolution = this.referenceResolver.resolve(deterministicRef, loaded.working);
      const audit = this.workingContext.buildAuditFromResolution(
        resolution,
        loaded.version ?? 0,
        WORKING_CONTEXT_SCHEMA_VERSION,
      );
      if (resolution.kind === 'CLARIFY') {
        telem(this.telemetry, {
          event: 'ClarificationShown',
          tenantId: actor.tenantId,
          conversationId: dto.conversationId,
          requestId: request.id,
          clarificationType: mapClarificationType(resolution.failureType),
          clarificationReason: resolution.failureType,
          ordinalUsed: deterministicRef.kind === 'ORDINAL',
          deicticUsed: deterministicRef.kind !== 'ORDINAL',
          entityPickerUsed: true,
          zeroCandidates: true,
        });
        const response = buildReferenceClarificationResponse(resolution.message, responseCtx, resolution.failureType);
        await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, resolution.failureType);
        return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
      }
      if (dto.workspaceId && loaded.version !== null) {
        try {
          await this.workingContext.persistSelection(
            actor.tenantId,
            actor.userId,
            dto.workspaceId,
            loaded.version,
            { type: resolution.entityType, id: resolution.id, label: resolution.label },
            audit,
          );
        } catch (error) {
          if (error instanceof ConflictException) {
            const response = buildReferenceClarificationResponse(
              'El estado cambió. Necesito que elijas nuevamente.',
              responseCtx,
              'STALE_CONTEXT',
            );
            await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, 'STALE_CONTEXT');
            return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
          }
          throw error;
        }
      }
      telem(this.telemetry, {
        event: 'ClarificationAnswered',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        answered: true,
        ordinalUsed: deterministicRef.kind === 'ORDINAL',
        deicticUsed: deterministicRef.kind !== 'ORDINAL',
        uniqueResolution: true,
        candidateCount: 1,
      });

      // UPDATE_CLIENT client picker: continue with trusted id + prior mutation entities.
      if (
        loaded.working?.lastIntent === 'UPDATE_CLIENT' &&
        resolution.entityType === 'CLIENT'
      ) {
        const prior = dto.conversationId
          ? await this.prisma.aIRequest.findFirst({
              where: {
                tenantId: actor.tenantId,
                conversationId: dto.conversationId,
                id: { not: request.id },
                requestPayload: {
                  path: ['resolvedIntent'],
                  equals: 'UPDATE_CLIENT',
                },
              },
              orderBy: { createdAt: 'desc' },
              select: { requestPayload: true },
            })
          : null;
        const priorPayload =
          prior?.requestPayload && typeof prior.requestPayload === 'object'
            ? (prior.requestPayload as Record<string, unknown>)
            : null;
        const priorEntities =
          priorPayload?.resolvedEntities &&
          typeof priorPayload.resolvedEntities === 'object' &&
          !Array.isArray(priorPayload.resolvedEntities)
            ? Object.fromEntries(
                Object.entries(priorPayload.resolvedEntities as Record<string, unknown>).filter(
                  ([, v]) =>
                    typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number',
                ),
              )
            : {};
        const updateEntities: Record<string, string | number | boolean> = {
          ...priorEntities,
          selectedClientId: resolution.id,
          clientId: resolution.id,
          clientLabel: resolution.label,
        };
        delete (updateEntities as Record<string, unknown>).clientQuery;
        await this.aiRequests.recordInterpretation(request.id, {
          intent: 'UPDATE_CLIENT',
          entities: updateEntities,
          candidateHash: resolution.resolvedEntityHash,
        });
        const continued = await this.assistant.executeClaimed(
          actor,
          {
            intent: 'UPDATE_CLIENT',
            entities: updateEntities,
            surface: dto.surface ?? 'DESKTOP',
            clientRequestId: dto.clientRequestId,
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            userDisplayText: dto.text,
          },
          request,
        );
        return {
          resolvedIntent: 'UPDATE_CLIENT',
          response: continued,
          resolvedEntities: updateEntities,
        };
      }

      // CREATE_CLIENT probable-duplicate picker: continue the write intent with trusted id.
      if (
        loaded.working?.lastIntent === 'CREATE_CLIENT' &&
        resolution.entityType === 'CLIENT'
      ) {
        const createNew =
          resolution.id === '__CREATE_NEW_CLIENT__' ||
          resolution.id.startsWith('__CREATE_NEW_CLIENT__|');
        const pendingName = createNew
          ? resolution.id.includes('|')
            ? resolution.id.slice('__CREATE_NEW_CLIENT__|'.length)
            : undefined
          : undefined;
        const createEntities: Record<string, string | boolean> = createNew
          ? {
              allowProbableDuplicate: true,
              ...(pendingName ? { name: pendingName } : {}),
            }
          : {
              clientId: resolution.id,
              useExistingClientId: resolution.id,
              name: resolution.label,
            };
        await this.aiRequests.recordInterpretation(request.id, {
          intent: 'CREATE_CLIENT',
          entities: createEntities,
          candidateHash: resolution.resolvedEntityHash,
        });
        const continued = await this.assistant.executeClaimed(
          actor,
          {
            intent: 'CREATE_CLIENT',
            entities: createEntities,
            surface: dto.surface ?? 'DESKTOP',
            clientRequestId: dto.clientRequestId,
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            userDisplayText: dto.text,
          },
          request,
        );
        return {
          resolvedIntent: 'CREATE_CLIENT',
          response: continued,
          resolvedEntities: createEntities,
        };
      }

      const response = buildEntitySelectedResponse(resolution.label, responseCtx);
      await this.aiRequests.recordInterpretation(request.id, {
        intent: 'UNKNOWN',
        entities: trustedIdsFromResolution(resolution),
        candidateHash: resolution.resolvedEntityHash,
      });
      await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, 'ENTITY_SELECTED');
      return {
        resolvedIntent: 'UNKNOWN',
        response,
        resolvedEntities: trustedIdsFromResolution(resolution),
      };
    }

    // Deterministic accounts continuation: "Ahora sus cuentas."
    if (looksLikeAccountsContinuation(normalizedText) && deterministicRef) {
      const resolution = this.referenceResolver.resolve(
        deterministicRef.kind === 'ORDINAL' ? deterministicRef : { kind: 'LAST_SELECTED', entityType: 'CLIENT' },
        loaded.working,
      );
      if (resolution.kind === 'CLARIFY' || resolution.entityType !== 'CLIENT') {
        const message =
          resolution.kind === 'CLARIFY'
            ? resolution.message
            : 'Necesito que elijas nuevamente un cliente para ver sus cuentas.';
        telem(this.telemetry, {
          event: 'ClarificationShown',
          tenantId: actor.tenantId,
          conversationId: dto.conversationId,
          requestId: request.id,
          capability: 'GET_CLIENT_ACCOUNTS',
          clarificationType: mapClarificationType(
            resolution.kind === 'CLARIFY' ? resolution.failureType : 'TYPE_MISMATCH',
          ),
          clarificationReason: resolution.kind === 'CLARIFY' ? resolution.failureType : 'TYPE_MISMATCH',
        });
        const response = buildReferenceClarificationResponse(
          message,
          responseCtx,
          resolution.kind === 'CLARIFY' ? resolution.failureType : 'TYPE_MISMATCH',
        );
        await this.aiRequests.failUnattached(request, actor, 'GET_CLIENT_ACCOUNTS', response, 'REFERENCE_CLARIFICATION');
        return { resolvedIntent: 'GET_CLIENT_ACCOUNTS', response, resolvedEntities: {} };
      }
      const entities = trustedIdsFromResolution(resolution);
      await this.aiRequests.recordInterpretation(request.id, {
        intent: 'GET_CLIENT_ACCOUNTS',
        entities,
        candidateHash: resolution.resolvedEntityHash,
      });
      const structuredRequest: StructuredAssistantRequest = {
        conversationId: dto.conversationId,
        workspaceId: dto.workspaceId,
        intent: 'GET_CLIENT_ACCOUNTS',
        entities,
        surface: dto.surface,
        locale: dto.locale,
        timezone: dto.timezone,
        clientRequestId: dto.clientRequestId,
        userDisplayText: normalizedText,
      };
      const response = await this.assistant.executeClaimed(actor, structuredRequest, request);
      return { resolvedIntent: 'GET_CLIENT_ACCOUNTS', response, resolvedEntities: entities };
    }

    const providerContext = toProviderConversationContext(loaded.working, dto.locale?.startsWith('es') ? 'es' : dto.locale);
    const outcome = await this.intentAdapter.interpret({
      userText: normalizedText,
      locale: dto.locale ?? 'es-MX',
      timezone: dto.timezone ?? 'UTC',
      allowedIntents: INTENT_CANDIDATE_VALUES,
      currentDate: new Date().toISOString().slice(0, 10),
      requestTraceId: traceId,
      conversationContext: providerContext,
    });

    // Durable provider metrics (best-effort). Never awaited for correctness.
    void this.aiRequests.recordProviderMetrics(request.id, {
      provider: outcome.provider,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      tokenInput: outcome.tokenUsage?.inputTokens ?? null,
      tokenOutput: outcome.tokenUsage?.outputTokens ?? null,
      schemaValidationFailure: outcome.kind === 'INVALID_OUTPUT',
      timeout: outcome.kind === 'PROVIDER_FAILURE' && outcome.failureType === 'TIMEOUT',
      failureType: outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : outcome.kind === 'INVALID_OUTPUT' ? outcome.reason : undefined,
    });

    if (outcome.kind !== 'CANDIDATE') {
      const response = buildProviderFailureResponse(outcome, responseCtx);
      telem(this.telemetry, {
        event: 'ConversationFinished',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        outcome: 'FAILED',
        failureType: mapFailureTaxonomy(
          outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : outcome.reason,
        ),
        providerLatencyMs: outcome.latencyMs,
      });
      await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : outcome.reason);
      return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
    }

    // Prefer deterministic reference detection over any LLM-emitted reference.
    const reference: IntentReference | undefined = deterministicRef ?? outcome.candidate.reference;
    let entities = stripUntrustedEntityIds(outcome.candidate.entities);

    if (reference) {
      const resolution = this.referenceResolver.resolve(reference, loaded.working);
      if (resolution.kind === 'CLARIFY') {
        telem(this.telemetry, {
          event: 'ClarificationShown',
          tenantId: actor.tenantId,
          conversationId: dto.conversationId,
          requestId: request.id,
          capability: outcome.candidate.intent,
          providerIntent: outcome.candidate.intent,
          clarificationType: mapClarificationType(resolution.failureType),
          clarificationReason: resolution.failureType,
          ordinalUsed: reference.kind === 'ORDINAL',
          deicticUsed: reference.kind !== 'ORDINAL',
          entityPickerUsed: true,
        });
        const response = buildReferenceClarificationResponse(resolution.message, responseCtx, resolution.failureType);
        await this.aiRequests.recordInterpretation(request.id, {
          intent: outcome.candidate.intent,
          entities,
          candidateHash: outcome.candidate.candidateHash,
        });
        await this.aiRequests.failUnattached(request, actor, outcome.candidate.intent, response, resolution.failureType);
        return { resolvedIntent: outcome.candidate.intent, response, resolvedEntities: entities };
      }
      telem(this.telemetry, {
        event: 'ClarificationAnswered',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: outcome.candidate.intent,
        answered: true,
        uniqueResolution: true,
        candidateCount: 1,
        ordinalUsed: reference.kind === 'ORDINAL',
        deicticUsed: reference.kind !== 'ORDINAL',
      });
      entities = mergeTrustedIds(entities, trustedIdsFromResolution(resolution));
      // Write intents: map CLIENT→customerId when preparing REGISTER_SALE preview.
      if (outcome.candidate.intent === 'REGISTER_SALE' && resolution.entityType === 'WATCH') {
        entities = mergeTrustedIds(entities, { watchId: resolution.id });
      }
      if (
        (outcome.candidate.intent === 'REGISTER_SALE' || outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT') &&
        resolution.entityType === 'CLIENT'
      ) {
        const paymentNeedsPayableTarget =
          outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT' &&
          (entities.destination === 'APPLY_TO_PAYABLE' ||
            typeof entities.payableQuery === 'string') &&
          (typeof entities.customerId === 'string' || typeof entities.accountId === 'string');
        if (paymentNeedsPayableTarget) {
          entities = mergeTrustedIds(entities, { payableClientId: resolution.id });
        } else {
          entities = mergeTrustedIds(entities, { customerId: resolution.id });
        }
      }
      if (outcome.candidate.intent === 'CREATE_CLIENT' && resolution.entityType === 'CLIENT') {
        entities = mergeTrustedIds(entities, {
          clientId: resolution.id,
          useExistingClientId: resolution.id,
        });
      }
      if (outcome.candidate.intent === 'UPDATE_CLIENT' && resolution.entityType === 'CLIENT') {
        entities = mergeTrustedIds(entities, {
          clientId: resolution.id,
          selectedClientId: resolution.id,
        });
      }
      if (
        outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT' &&
        resolution.entityType === 'ACCOUNT_ENTRY'
      ) {
        const paymentNeedsPayableAccount =
          entities.destination === 'APPLY_TO_PAYABLE' &&
          typeof entities.accountId === 'string';
        if (paymentNeedsPayableAccount) {
          entities = mergeTrustedIds(entities, {
            payableAccountId: resolution.id,
            payableEntryId: resolution.id,
          });
        } else {
          entities = mergeTrustedIds(entities, {
            accountId: resolution.id,
            accountEntryId: resolution.id,
          });
        }
      }
    } else if (
      outcome.candidate.intent === 'GET_CLIENT_ACCOUNTS' &&
      loaded.working?.lastResolvedEntities?.clientId
    ) {
      entities = mergeTrustedIds(entities, { clientId: loaded.working.lastResolvedEntities.clientId });
    } else if (outcome.candidate.intent === 'REGISTER_SALE' && loaded.working?.lastResolvedEntities?.watchId) {
      // Prior trusted watch selection may prepare a write preview — never execute.
      entities = mergeTrustedIds(entities, { watchId: loaded.working.lastResolvedEntities.watchId });
    } else if (
      (outcome.candidate.intent === 'REGISTER_SALE' || outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT') &&
      loaded.working?.lastResolvedEntities?.clientId
    ) {
      entities = mergeTrustedIds(entities, { customerId: loaded.working.lastResolvedEntities.clientId });
    } else if (
      outcome.candidate.intent === 'UPDATE_CLIENT' &&
      loaded.working?.lastResolvedEntities?.clientId
    ) {
      entities = mergeTrustedIds(entities, {
        clientId: loaded.working.lastResolvedEntities.clientId,
        selectedClientId: loaded.working.lastResolvedEntities.clientId,
      });
    }

    if (
      outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT' &&
      loaded.working?.lastResolvedEntities?.accountEntryId &&
      !('accountId' in entities)
    ) {
      entities = mergeTrustedIds(entities, {
        accountId: loaded.working.lastResolvedEntities.accountEntryId,
        accountEntryId: loaded.working.lastResolvedEntities.accountEntryId,
      });
    }

    await this.aiRequests.recordInterpretation(request.id, {
      intent: outcome.candidate.intent,
      entities,
      candidateHash: outcome.candidate.candidateHash,
    });

    const policy = decideConfidencePolicy(outcome.candidate);

    if (policy.action !== 'PROCEED') {
      telem(this.telemetry, {
        event: 'ClarificationShown',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: outcome.candidate.intent,
        providerIntent: outcome.candidate.intent,
        normalizedIntent: outcome.candidate.intent,
        clarificationType:
          outcome.candidate.intent === 'UNKNOWN'
            ? 'OTHER'
            : mapClarificationType(policy.action),
        clarificationReason: policy.action,
        failureType: mapFailureTaxonomy(policy.action),
      });
      const response = buildPolicyResponse(policy, responseCtx);
      await this.aiRequests.failUnattached(request, actor, outcome.candidate.intent, response, policy.action);
      return { resolvedIntent: outcome.candidate.intent, response, resolvedEntities: entities };
    }

    const intent = outcome.candidate.intent as BusinessActionId;
    const structuredRequest: StructuredAssistantRequest = {
      conversationId: dto.conversationId,
      workspaceId: dto.workspaceId,
      intent,
      entities,
      surface: dto.surface,
      locale: dto.locale,
      timezone: dto.timezone,
      clientRequestId: dto.clientRequestId,
      userDisplayText: normalizedText,
    };
    const response = await this.assistant.executeClaimed(actor, structuredRequest, request);
    return { resolvedIntent: intent, response, resolvedEntities: entities };
  }
}
