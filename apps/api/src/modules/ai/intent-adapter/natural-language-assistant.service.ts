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
import { ClarificationFieldLockService } from '../clarification/clarification-field-lock.service';
import {
  detectHighConfidenceTopicChange,
  looksLikeClarificationCancel,
} from '../clarification/clarification-escape';
import { CompositionOrchestrator } from '../composition/composition-orchestrator.service';
import {
  COMPOSITION_CANCEL_ID,
  COMPOSITION_SEARCH_ID,
  parseCompositionCreateSentinel,
} from '../composition/composition.types';
import { IntentAdapterService } from './intent-adapter.service';
import { INTENT_CANDIDATE_VALUES, IntentCandidateIntent } from './intent-schema';
import { assertWithinTextLimit, decideConfidencePolicy } from './safety';
import {
  buildEntitySelectedResponse,
  buildPolicyResponse,
  buildProviderFailureResponse,
  buildReferenceClarificationResponse,
} from './typed-responses';

const WRITE_CLARIFICATION_INTENTS = new Set<string>([
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_CAPITAL_CONTRIBUTION',
  'REGISTER_CAPITAL_DISTRIBUTION',
  'REGISTER_EXPENSE',
  'REVERSE_EXPENSE',
  'REGISTER_PURCHASE',
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
  'CREATE_RECEIVABLE',
  'CREATE_PAYABLE',
]);

function looksLikeCancel(text: string): boolean {
  return looksLikeClarificationCancel(text);
}
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
    private readonly compositionOrchestrator: CompositionOrchestrator,
    private readonly clarificationFieldLock: ClarificationFieldLockService,
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
    /** May be cleared when the user cancels or switches topics mid-clarification. */
    let workingForProvider = loaded.working;

    // Active clarification continuation: map closed answers into the pending write
    // without losing prior entities. Cancel phrases clear the draft politely.
    const pendingField = loaded.working?.pendingMissingFields?.[0];
    const pendingIntent = loaded.working?.lastIntent;
    if (
      pendingField &&
      pendingIntent &&
      WRITE_CLARIFICATION_INTENTS.has(pendingIntent) &&
      !deterministicRef
    ) {
      // 1) Explicit cancel — destroy draft, never trap the user.
      if (looksLikeCancel(normalizedText)) {
        let response = buildReferenceClarificationResponse(
          'De acuerdo. Cancelé ese borrador.',
          responseCtx,
          'CLARIFICATION_CANCELLED',
        );
        try {
          const cleared = await this.workingContext.persistClarificationTurn({
            tenantId: actor.tenantId,
            userId: actor.userId,
            surface: dto.surface ?? 'DESKTOP',
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            requestId: request.id,
            intent: pendingIntent,
            entities: {},
            response: {
              interactionState: response.interactionState,
              responseType: response.responseType,
              payload: response.payload as Record<string, unknown>,
            },
            mode: 'CLEAR',
          });
          response = {
            ...response,
            conversationId: cleared.conversationId,
            workspaceId: cleared.workspaceId,
          };
        } catch {
          // Cancel still returns politely even if workspace clear races.
        }
        await this.aiRequests.failUnattached(request, actor, pendingIntent, response, 'CLARIFICATION_CANCELLED');
        return { resolvedIntent: pendingIntent, response, resolvedEntities: {} };
      }

      // 2) High-confidence new intent — abandon draft, then unrestricted NLP.
      const topicChange = detectHighConfidenceTopicChange(normalizedText, pendingIntent);
      if (topicChange) {
        try {
          await this.workingContext.persistClarificationTurn({
            tenantId: actor.tenantId,
            userId: actor.userId,
            surface: dto.surface ?? 'DESKTOP',
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            requestId: request.id,
            intent: pendingIntent,
            entities: {},
            response: {
              interactionState: 'IDLE',
              responseType: 'ERROR_RECOVERY_CARD',
              payload: { code: 'CLARIFICATION_ABANDONED' },
            },
            mode: 'CLEAR',
          });
        } catch {
          // Continue with NLP even if clear races; do not trap the user.
        }
        workingForProvider = workingForProvider
          ? (() => {
              const { pendingMissingFields: _drop, pendingActionRunId: _drop2, ...rest } =
                workingForProvider;
              return { ...rest, contextUpdatedAt: new Date().toISOString() };
            })()
          : null;
        telem(this.telemetry, {
          event: 'ClarificationAnswered',
          tenantId: actor.tenantId,
          conversationId: dto.conversationId,
          requestId: request.id,
          capability: pendingIntent,
          clarificationReason: 'TOPIC_CHANGE',
          answered: false,
        });
        // Fall through to full NLP with cleared pending context.
      } else {
        // 3) Field lock — resolve the pending field before unrestricted NLP.
        const draftEntities = this.workingContext.readPendingClarificationEntities(loaded.resolvedContextRaw);
        const priorEntities = await this.loadPriorWriteEntities(
          actor.tenantId,
          dto.conversationId,
          request.id,
          pendingIntent,
        );
        const lockedDraft: Record<string, string | number | boolean> = {
          ...draftEntities,
          ...priorEntities,
        };

        const lock = await this.clarificationFieldLock.resolve({
          tenantId: actor.tenantId,
          intent: pendingIntent,
          pendingField,
          answer: normalizedText,
          draftEntities: lockedDraft,
        });

        if (lock.kind === 'BOUND') {
          await this.aiRequests.recordInterpretation(request.id, {
            intent: pendingIntent,
            entities: lock.entities,
            candidateHash: `clarification-lock:${pendingField}`,
          });
          telem(this.telemetry, {
            event: 'ClarificationAnswered',
            tenantId: actor.tenantId,
            conversationId: dto.conversationId,
            requestId: request.id,
            capability: pendingIntent,
            clarificationReason: pendingField,
            answered: true,
          });
          const continued = await this.assistant.executeClaimed(
            actor,
            {
              intent: pendingIntent as BusinessActionId,
              entities: lock.entities,
              surface: dto.surface ?? 'DESKTOP',
              clientRequestId: dto.clientRequestId,
              conversationId: dto.conversationId,
              workspaceId: dto.workspaceId,
              userDisplayText: dto.text,
            },
            request,
          );
          return {
            resolvedIntent: pendingIntent,
            response: continued,
            resolvedEntities: lock.entities,
          };
        }

        if (lock.kind === 'PICKER') {
          let response: StructuredAssistantResponse = {
            requestId: request.id,
            conversationId: dto.conversationId ?? '',
            workspaceId: dto.workspaceId ?? '',
            interactionState: 'NEEDS_DISAMBIGUATION',
            responseType: 'ENTITY_PICKER',
            payload: {
              message: lock.message,
              entityType: lock.entityType,
              clarificationField: pendingField,
              data: { items: lock.items },
              unchanged: 'No se ejecutó ninguna acción.',
              nextAction: 'Elige con “el primero”, “el segundo”, o nómbralo.',
            },
            warnings: [],
            suggestedActions: [],
            traceId,
            createdAt: new Date().toISOString(),
          };
          try {
            const persisted = await this.workingContext.persistEntityPickerTurn({
              tenantId: actor.tenantId,
              userId: actor.userId,
              surface: dto.surface ?? 'DESKTOP',
              conversationId: dto.conversationId,
              workspaceId: dto.workspaceId,
              requestId: request.id,
              intent: pendingIntent,
              entities: lock.entities,
              response: {
                interactionState: response.interactionState,
                responseType: response.responseType,
                payload: response.payload as Record<string, unknown>,
              },
            });
            response = {
              ...response,
              conversationId: persisted.conversationId,
              workspaceId: persisted.workspaceId,
            };
          } catch {
            // Picker still returned; ordinal may need a fresh ask if persist races.
          }
          await this.aiRequests.recordInterpretation(request.id, {
            intent: pendingIntent,
            entities: lock.entities,
            candidateHash: `clarification-picker:${pendingField}`,
          });
          await this.aiRequests.failUnattached(request, actor, pendingIntent, response, 'FIELD_LOCK_PICKER');
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: dto.conversationId,
            requestId: request.id,
            capability: pendingIntent,
            clarificationType: 'ENTITY_AMBIGUITY',
            clarificationReason: pendingField,
            entityPickerUsed: true,
            candidateCount: lock.candidates.length,
            multipleCandidates: true,
          });
          return { resolvedIntent: pendingIntent, response, resolvedEntities: lock.entities };
        }

        if (lock.kind === 'CLARIFY') {
          // Stay on pending WATCH with contextual copy — never CLIENT picker / unrestricted NLP.
          const clarifyPayload = {
            message: lock.message,
            clarificationField: pendingField,
            missing: [{ entity: pendingField, question: lock.message }],
            unchanged: 'No se ejecutó ninguna acción.',
            nextAction: 'Responde con el reloj o una referencia más precisa.',
          };
          let response: StructuredAssistantResponse = {
            requestId: request.id,
            conversationId: dto.conversationId ?? '',
            workspaceId: dto.workspaceId ?? '',
            interactionState: 'NEEDS_INPUT',
            responseType: 'MISSING_FIELDS_CARD',
            payload: clarifyPayload,
            warnings: [],
            suggestedActions: [],
            traceId,
            createdAt: new Date().toISOString(),
          };
          try {
            const persisted = await this.workingContext.persistClarificationTurn({
              tenantId: actor.tenantId,
              userId: actor.userId,
              surface: dto.surface ?? 'DESKTOP',
              conversationId: dto.conversationId,
              workspaceId: dto.workspaceId,
              requestId: request.id,
              intent: pendingIntent,
              entities: lock.entities,
              mode: 'MISSING_FIELDS',
              response: {
                interactionState: response.interactionState,
                responseType: response.responseType,
                payload: response.payload as Record<string, unknown>,
              },
            });
            response = {
              ...response,
              conversationId: persisted.conversationId,
              workspaceId: persisted.workspaceId,
            };
          } catch {
            // Clarification still returned.
          }
          await this.aiRequests.recordInterpretation(request.id, {
            intent: pendingIntent,
            entities: lock.entities,
            candidateHash: `clarification-clarify:${pendingField}`,
          });
          await this.aiRequests.failUnattached(request, actor, pendingIntent, response, 'FIELD_LOCK_CLARIFY');
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: dto.conversationId,
            requestId: request.id,
            capability: pendingIntent,
            clarificationType: 'MISSING_FIELD',
            clarificationReason: pendingField,
            zeroCandidates: true,
          });
          return { resolvedIntent: pendingIntent, response, resolvedEntities: lock.entities };
        }

        // 4) lock.kind === 'NO_MATCH' → fall through to unrestricted NLP.
      }
    }

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

      // Field-lock WATCH picker continuation for sale/purchase drafts.
      if (
        (loaded.working?.lastIntent === 'REGISTER_SALE' ||
          loaded.working?.lastIntent === 'REGISTER_PURCHASE') &&
        resolution.entityType === 'WATCH'
      ) {
        const writeIntent = loaded.working.lastIntent;
        const priorEntities = await this.loadPriorWriteEntities(
          actor.tenantId,
          dto.conversationId,
          request.id,
          writeIntent,
        );
        const draftEntities = this.workingContext.readPendingClarificationEntities(loaded.resolvedContextRaw);
        const writeEntities: Record<string, string | number | boolean> = {
          ...draftEntities,
          ...priorEntities,
          watchId: resolution.id,
          watchLabel: resolution.label,
        };
        delete (writeEntities as Record<string, unknown>).customerQuery;
        delete (writeEntities as Record<string, unknown>).clientQuery;
        await this.aiRequests.recordInterpretation(request.id, {
          intent: writeIntent,
          entities: writeEntities,
          candidateHash: resolution.resolvedEntityHash,
        });
        const continued = await this.assistant.executeClaimed(
          actor,
          {
            intent: writeIntent,
            entities: writeEntities,
            surface: dto.surface ?? 'DESKTOP',
            clientRequestId: dto.clientRequestId,
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            userDisplayText: dto.text,
          },
          request,
        );
        return {
          resolvedIntent: writeIntent,
          response: continued,
          resolvedEntities: writeEntities,
        };
      }

      // Field-lock CLIENT picker continuation for sale drafts (not composition CTAs).
      if (
        loaded.working?.lastIntent === 'REGISTER_SALE' &&
        resolution.entityType === 'CLIENT' &&
        !resolution.id.startsWith('__')
      ) {
        const priorEntities = await this.loadPriorWriteEntities(
          actor.tenantId,
          dto.conversationId,
          request.id,
          'REGISTER_SALE',
        );
        const draftEntities = this.workingContext.readPendingClarificationEntities(loaded.resolvedContextRaw);
        const saleEntities: Record<string, string | number | boolean> = {
          ...draftEntities,
          ...priorEntities,
          customerId: resolution.id,
          clientId: resolution.id,
          customerName: resolution.label,
        };
        await this.aiRequests.recordInterpretation(request.id, {
          intent: 'REGISTER_SALE',
          entities: saleEntities,
          candidateHash: resolution.resolvedEntityHash,
        });
        const continued = await this.assistant.executeClaimed(
          actor,
          {
            intent: 'REGISTER_SALE',
            entities: saleEntities,
            surface: dto.surface ?? 'DESKTOP',
            clientRequestId: dto.clientRequestId,
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            userDisplayText: dto.text,
          },
          request,
        );
        return {
          resolvedIntent: 'REGISTER_SALE',
          response: continued,
          resolvedEntities: saleEntities,
        };
      }

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

      // Capital contribution/distribution investor picker: continue with trusted id + prior entities.
      if (
        (loaded.working?.lastIntent === 'REGISTER_CAPITAL_CONTRIBUTION' ||
          loaded.working?.lastIntent === 'REGISTER_CAPITAL_DISTRIBUTION') &&
        resolution.entityType === 'INVESTOR'
      ) {
        const capitalIntent = loaded.working.lastIntent;
        const prior = dto.conversationId
          ? await this.prisma.aIRequest.findFirst({
              where: {
                tenantId: actor.tenantId,
                conversationId: dto.conversationId,
                id: { not: request.id },
                requestPayload: {
                  path: ['resolvedIntent'],
                  equals: capitalIntent,
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
        const capitalEntities: Record<string, string | number | boolean> = {
          ...priorEntities,
          selectedInvestorId: resolution.id,
          investorId: resolution.id,
          investorLabel: resolution.label,
        };
        delete (capitalEntities as Record<string, unknown>).investorQuery;
        await this.aiRequests.recordInterpretation(request.id, {
          intent: capitalIntent,
          entities: capitalEntities,
          candidateHash: resolution.resolvedEntityHash,
        });
        const continued = await this.assistant.executeClaimed(
          actor,
          {
            intent: capitalIntent,
            entities: capitalEntities,
            surface: dto.surface ?? 'DESKTOP',
            clientRequestId: dto.clientRequestId,
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            userDisplayText: dto.text,
          },
          request,
        );
        return {
          resolvedIntent: capitalIntent,
          response: continued,
          resolvedEntities: capitalEntities,
        };
      }

      // Controlled composition V1: dependency CTAs (create / search / cancel) or reuse existing Client.
      if (dto.workspaceId && resolution.entityType === 'CLIENT') {
        const compositionHandled = await this.handleCompositionPickerSelection({
          actor,
          dto,
          request,
          responseCtx,
          resolutionId: resolution.id,
          resolutionLabel: resolution.label,
          workspaceVersion: loaded.version,
        });
        if (compositionHandled) return compositionHandled;
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

    const providerContext = toProviderConversationContext(workingForProvider, dto.locale?.startsWith('es') ? 'es' : dto.locale);
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
      if (outcome.candidate.intent === 'REGISTER_PURCHASE' && resolution.entityType === 'CLIENT') {
        entities = mergeTrustedIds(entities, {
          sellerClientId: resolution.id,
          sellerLabel: resolution.label,
        });
      }
      if (
        (outcome.candidate.intent === 'REGISTER_SALE' ||
          outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
          outcome.candidate.intent === 'REGISTER_PAYABLE_PAYMENT') &&
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
        (outcome.candidate.intent === 'REGISTER_CAPITAL_CONTRIBUTION' ||
          outcome.candidate.intent === 'REGISTER_CAPITAL_DISTRIBUTION') &&
        resolution.entityType === 'INVESTOR'
      ) {
        entities = mergeTrustedIds(entities, {
          investorId: resolution.id,
          selectedInvestorId: resolution.id,
          investorLabel: resolution.label,
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
      if (
        outcome.candidate.intent === 'REVERSE_EXPENSE' &&
        resolution.entityType === 'OPERATING_EXPENSE'
      ) {
        entities = mergeTrustedIds(entities, {
          selectedExpenseId: resolution.id,
          trustedExpenseId: resolution.id,
        });
      }
      if (
        outcome.candidate.intent === 'REGISTER_PAYABLE_PAYMENT' &&
        resolution.entityType === 'ACCOUNT_ENTRY'
      ) {
        entities = mergeTrustedIds(entities, {
          accountId: resolution.id,
          accountEntryId: resolution.id,
          payableEntryId: resolution.id,
          payableAccountId: resolution.id,
        });
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
      (outcome.candidate.intent === 'REGISTER_SALE' ||
        outcome.candidate.intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
        outcome.candidate.intent === 'REGISTER_PAYABLE_PAYMENT') &&
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
    } else if (
      (outcome.candidate.intent === 'REGISTER_CAPITAL_CONTRIBUTION' ||
        outcome.candidate.intent === 'REGISTER_CAPITAL_DISTRIBUTION') &&
      loaded.working?.lastResolvedEntities?.investorId
    ) {
      entities = mergeTrustedIds(entities, {
        investorId: loaded.working.lastResolvedEntities.investorId,
        selectedInvestorId: loaded.working.lastResolvedEntities.investorId,
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
    if (
      outcome.candidate.intent === 'REGISTER_PAYABLE_PAYMENT' &&
      loaded.working?.lastResolvedEntities?.accountEntryId &&
      !('accountId' in entities)
    ) {
      entities = mergeTrustedIds(entities, {
        accountId: loaded.working.lastResolvedEntities.accountEntryId,
        accountEntryId: loaded.working.lastResolvedEntities.accountEntryId,
        payableEntryId: loaded.working.lastResolvedEntities.accountEntryId,
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
      const response = buildPolicyResponse(policy, responseCtx, {
        capability: outcome.candidate.intent,
        entities,
      });
      let attached = response;
      if (policy.action === 'CLARIFY_AMBIGUITY' && response.responseType === 'MISSING_FIELDS_CARD') {
        try {
          const persisted = await this.workingContext.persistClarificationTurn({
            tenantId: actor.tenantId,
            userId: actor.userId,
            surface: dto.surface ?? 'DESKTOP',
            conversationId: dto.conversationId,
            workspaceId: dto.workspaceId,
            requestId: request.id,
            intent: outcome.candidate.intent,
            entities,
            response: {
              interactionState: response.interactionState,
              responseType: response.responseType,
              payload: response.payload as Record<string, unknown>,
            },
            mode: 'MISSING_FIELDS',
          });
          attached = {
            ...response,
            conversationId: persisted.conversationId,
            workspaceId: persisted.workspaceId,
          };
        } catch {
          // Still return the clarification; continuation may fail closed without workspace.
        }
      }
      await this.aiRequests.failUnattached(request, actor, outcome.candidate.intent, attached, policy.action);
      return { resolvedIntent: outcome.candidate.intent, response: attached, resolvedEntities: entities };
    }

    const intent = outcome.candidate.intent as BusinessActionId;
    // If we were clarifying a write, preserve prior entities across free-text answers.
    if (
      pendingField &&
      pendingIntent &&
      WRITE_CLARIFICATION_INTENTS.has(pendingIntent) &&
      intent === pendingIntent
    ) {
      const prior = dto.conversationId
        ? await this.prisma.aIRequest.findFirst({
            where: {
              tenantId: actor.tenantId,
              conversationId: dto.conversationId,
              id: { not: request.id },
              requestPayload: {
                path: ['resolvedIntent'],
                equals: pendingIntent,
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
      const priorEntities = Object.fromEntries(
        (
          priorPayload?.resolvedEntities &&
          typeof priorPayload.resolvedEntities === 'object' &&
          !Array.isArray(priorPayload.resolvedEntities)
            ? Object.entries(priorPayload.resolvedEntities as Record<string, unknown>)
            : []
        ).filter(
          (entry): entry is [string, string | number | boolean] =>
            typeof entry[1] === 'string' || typeof entry[1] === 'boolean' || typeof entry[1] === 'number',
        ),
      );
      entities = {
        ...this.workingContext.readPendingClarificationEntities(loaded.resolvedContextRaw),
        ...priorEntities,
        ...entities,
      };
      telem(this.telemetry, {
        event: 'ClarificationAnswered',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: pendingIntent,
        clarificationReason: pendingField,
        answered: true,
      });
    }
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

  private async loadPriorWriteEntities(
    tenantId: string,
    conversationId: string | undefined,
    requestId: string,
    intent: string,
  ): Promise<Record<string, string | number | boolean>> {
    if (!conversationId) return {};
    const prior = await this.prisma.aIRequest.findFirst({
      where: {
        tenantId,
        conversationId,
        id: { not: requestId },
        requestPayload: {
          path: ['resolvedIntent'],
          equals: intent,
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { requestPayload: true },
    });
    const priorPayload =
      prior?.requestPayload && typeof prior.requestPayload === 'object'
        ? (prior.requestPayload as Record<string, unknown>)
        : null;
    return Object.fromEntries(
      (
        priorPayload?.resolvedEntities &&
        typeof priorPayload.resolvedEntities === 'object' &&
        !Array.isArray(priorPayload.resolvedEntities)
          ? Object.entries(priorPayload.resolvedEntities as Record<string, unknown>)
          : []
      ).filter(
        (entry): entry is [string, string | number | boolean] =>
          typeof entry[1] === 'string' || typeof entry[1] === 'boolean' || typeof entry[1] === 'number',
      ),
    );
  }

  private async handleCompositionPickerSelection(args: {
    actor: AssistantActorContext;
    dto: AssistantMessageDto;
    request: { id: string; traceId: string };
    responseCtx: { conversationId?: string; workspaceId?: string; traceId: string };
    resolutionId: string;
    resolutionLabel: string;
    workspaceVersion: number | null;
  }): Promise<NaturalLanguageAssistantResult | null> {
    if (!args.dto.workspaceId || args.workspaceVersion === null) return null;
    const active = await this.compositionOrchestrator.loadActive({
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      workspaceId: args.dto.workspaceId,
    });
    if (!active.composition || active.composition.state === 'CANCELLED') return null;

    const createName = parseCompositionCreateSentinel(args.resolutionId);
    if (createName || args.resolutionId.startsWith('__COMPOSITION_CREATE_CLIENT__')) {
      const name = createName ?? active.composition.dependencyQuery;
      const createEntities: Record<string, string | boolean> = { name };
      await this.aiRequests.recordInterpretation(args.request.id, {
        intent: 'CREATE_CLIENT',
        entities: createEntities,
        candidateHash: `composition-create:${name}`,
      });
      const continued = await this.assistant.executeClaimed(
        args.actor,
        {
          intent: 'CREATE_CLIENT',
          entities: createEntities,
          surface: args.dto.surface ?? 'DESKTOP',
          clientRequestId: args.dto.clientRequestId,
          conversationId: args.dto.conversationId,
          workspaceId: args.dto.workspaceId,
          userDisplayText: args.dto.text,
        },
        args.request as never,
      );
      return {
        resolvedIntent: 'CREATE_CLIENT',
        response: continued,
        resolvedEntities: createEntities,
      };
    }

    if (args.resolutionId === COMPOSITION_SEARCH_ID) {
      const response = buildReferenceClarificationResponse(
        'Escribe el nombre del cliente que quieres usar como ' +
          (active.composition.dependencyReason === 'PURCHASE_SELLER' ? 'vendedor' : 'comprador') +
          '.',
        {
          conversationId: args.dto.conversationId ?? args.responseCtx.conversationId,
          workspaceId: args.dto.workspaceId,
          traceId: args.request.traceId,
        },
        'COMPOSITION_SEARCH',
      );
      await this.aiRequests.failUnattached(args.request as never, args.actor, 'SEARCH_CLIENT', response, 'COMPOSITION_SEARCH');
      return { resolvedIntent: 'SEARCH_CLIENT', response, resolvedEntities: {} };
    }

    if (args.resolutionId === COMPOSITION_CANCEL_ID) {
      await this.compositionOrchestrator.cancelComposition({
        tenantId: args.actor.tenantId,
        userId: args.actor.userId,
        workspaceId: args.dto.workspaceId,
        expectedVersion: active.version,
      });
      const response = buildEntitySelectedResponse('Composición cancelada. No se registró la acción.', {
        conversationId: args.dto.conversationId ?? args.responseCtx.conversationId,
        workspaceId: args.dto.workspaceId,
        traceId: args.request.traceId,
      });
      response.payload = {
        ...response.payload,
        message: 'Cancelé la operación. No se creó el cliente ni se registró la acción principal.',
        unchanged: 'No se ejecutó ninguna escritura.',
        nextAction: 'Puedes iniciar de nuevo cuando quieras.',
      };
      await this.aiRequests.failUnattached(args.request as never, args.actor, 'UNKNOWN', response, 'COMPOSITION_CANCELLED');
      return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
    }

    // Existing Client chosen while composition is parked — no CREATE_CLIENT mutation.
    // Routes through CREATE_CLIENT USE_EXISTING so StructuredAssistant resumes the parent.
    if (
      active.composition.state === 'DEPENDENCY_REQUIRED' &&
      !args.resolutionId.startsWith('__')
    ) {
      const createEntities: Record<string, string | boolean> = {
        clientId: args.resolutionId,
        useExistingClientId: args.resolutionId,
        name: args.resolutionLabel,
      };
      await this.aiRequests.recordInterpretation(args.request.id, {
        intent: 'CREATE_CLIENT',
        entities: createEntities,
        candidateHash: `composition-reuse:${args.resolutionId}`,
      });
      const continued = await this.assistant.executeClaimed(
        args.actor,
        {
          intent: 'CREATE_CLIENT',
          entities: createEntities,
          surface: args.dto.surface ?? 'DESKTOP',
          clientRequestId: args.dto.clientRequestId,
          conversationId: args.dto.conversationId,
          workspaceId: args.dto.workspaceId,
          userDisplayText: args.dto.text,
        },
        args.request as never,
      );
      return {
        resolvedIntent:
          continued.payload && typeof continued.payload.preview === 'object'
            ? (active.composition.parentCapability as IntentCandidateIntent)
            : 'CREATE_CLIENT',
        response: continued,
        resolvedEntities: createEntities,
      };
    }

    return null;
  }
}
