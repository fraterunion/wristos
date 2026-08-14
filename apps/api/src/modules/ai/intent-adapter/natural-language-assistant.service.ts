import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AIRequest } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AIRequestService } from '../assistant/ai-request.service';
import { StructuredAssistantService } from '../assistant/structured-assistant.service';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from '../assistant/structured-assistant.types';
import { toProviderConversationContext } from '../context/provider-context';
import { detectDeterministicReference, isPureReferentialUtterance, looksLikeAccountsContinuation } from '../context/ordinal-reference';
import {
  ReferenceResolutionResult,
  ReferenceResolverService,
  trustedIdsFromResolution,
} from '../context/reference-resolver.service';
import { IntentReference } from '../context/reference-schema';
import { mergeTrustedIds, stripUntrustedEntityIds } from '../context/trusted-entities';
import { AssistantWorkingContext, WORKING_CONTEXT_SCHEMA_VERSION, isCandidateContextFresh } from '../context/working-context';
import { WorkingContextService } from '../context/working-context.service';
import { applyDraftPatch, ConversationDraft, draftToEntities, emptyDraft } from '../context/conversation-draft';
import { AssistantMessageDto } from '../dto/assistant-message.dto';
import { PickerSelectionDto } from '../dto/picker-selection.dto';
import { ConversationResetDto } from '../dto/conversation-reset.dto';
import { BusinessActionId } from '../planner/planner.types';
import { mapClarificationType, mapFailureTaxonomy, telem } from '../telemetry/telemetry-hooks';
import { TelemetryEmitter } from '../telemetry/telemetry-emitter.service';
import {
  ClarificationFieldLockService,
  FieldLockBound,
  FieldLockClarify,
  FieldLockPicker,
} from '../clarification/clarification-field-lock.service';
import {
  detectCorrectedAccount,
  detectCorrectedCurrency,
  detectDraftCorrectionLanguage,
  parseCorrectedAmount,
} from './draft-correction-language';
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
import { IntentAdapterOutcome, IntentAdapterService } from './intent-adapter.service';
import { INTENT_CANDIDATE_VALUES, IntentCandidateIntent } from './intent-schema';
import { assertWithinTextLimit, decideConfidencePolicy } from './safety';
import {
  buildConversationResetResponse,
  buildEntitySelectedResponse,
  buildPolicyResponse,
  buildProviderFailureResponse,
  buildReferenceClarificationResponse,
} from './typed-responses';
import { detectExpenseCorrectionLanguage } from '../reversals/expense-correction-language';
import { detectTransferCorrectionLanguage } from '../reversals/transfer-correction-language';
import { reverseIntentFromLastReversibleAction } from '../reversals/last-action-reverse-allowlist';
import { LastReversibleActionContext } from '../reversals/financial-reversal.types';
import { OperationalIntentRouterService, toRawCandidateOutput } from '../operational-router/operational-intent-router.service';
import { parseResolvedContextShell } from '../context/working-context';

const WRITE_CLARIFICATION_INTENTS = new Set<string>([
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_CAPITAL_CONTRIBUTION',
  'REGISTER_CAPITAL_DISTRIBUTION',
  'REGISTER_EXPENSE',
  'REVERSE_EXPENSE',
  'REVERSE_TREASURY_TRANSFER',
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
    private readonly operationalRouter: OperationalIntentRouterService,
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
    /**
     * Once true, a stale/irrelevant picker must never resolve a reference
     * for this turn — even one the LLM itself emits after seeing (possibly
     * still-present) candidate context in its prompt. Set by either gate
     * below: the picker-relevance gate (no positive match to the presented
     * list) or the existing high-confidence topic-change gate (a different
     * capability, or a same-capability restart that abandons the old draft).
     */
    let discardStaleReferenceContext = false;

    // Picker relevance gate (expired/irrelevant picker must never hijack a
    // fresh message): a candidate list represents the question "which of
    // these did you mean?" — but a message that doesn't positively engage
    // with it (no ordinal/deictic, no typed label match) must never be
    // force-fit as an answer to it, expired or not. This runs BEFORE the
    // pendingField clarification gate below because that gate's own
    // field-lock step has no picker-freshness awareness of its own — left
    // alone it would search CRM/inventory for an entity literally named the
    // user's entire next sentence. Ordinal/deictic references ("el
    // primero", "ese") are handled by the existing isPureReferentialUtterance
    // block further down, unchanged — this gate only classifies typed-label
    // engagement, since !deterministicRef already excludes that case here.
    if (loaded.working?.lastPresentedCandidates && !deterministicRef) {
      const fresh = isCandidateContextFresh(loaded.working);
      const matchVerdict = this.referenceResolver.matchesPresentedLabel(normalizedText, loaded.working);

      if (matchVerdict !== 'NO_MATCH' && !fresh) {
        // Explicit attempt to select from a genuinely dead list — fail
        // closed. Never silently trust it, never revive it.
        telem(this.telemetry, {
          event: 'ClarificationShown',
          tenantId: actor.tenantId,
          conversationId: dto.conversationId,
          requestId: request.id,
          clarificationType: mapClarificationType('EXPIRED'),
          clarificationReason: 'EXPIRED',
          entityPickerUsed: true,
        });
        const response = buildReferenceClarificationResponse(
          'Necesito que elijas nuevamente. La lista anterior ya no es válida.',
          responseCtx,
          'EXPIRED',
        );
        await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, 'EXPIRED');
        return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
      }

      if (matchVerdict === 'MATCH' && fresh) {
        const resolved = this.referenceResolver.resolveByTypedLabel(normalizedText, loaded.working);
        if (resolved.kind === 'RESOLVED') {
          return this.continueFromResolvedReference({
            actor,
            dto,
            request,
            responseCtx,
            loaded,
            resolution: resolved,
            telemetryMeta: { ordinalUsed: false, deicticUsed: false },
          });
        }
        // Content match + fresh guarantees resolveByTypedLabel also resolves
        // uniquely; falling through here would only happen on an internal
        // inconsistency, in which case unrestricted NLP is the safe default.
      }

      if (matchVerdict === 'AMBIGUOUS' && fresh) {
        const resolved = this.referenceResolver.resolveByTypedLabel(normalizedText, loaded.working);
        if (resolved.kind === 'CLARIFY' && resolved.failureType === 'AMBIGUOUS') {
          telem(this.telemetry, {
            event: 'ClarificationShown',
            tenantId: actor.tenantId,
            conversationId: dto.conversationId,
            requestId: request.id,
            clarificationType: mapClarificationType(resolved.failureType),
            clarificationReason: resolved.failureType,
            entityPickerUsed: true,
          });
          const response = buildReferenceClarificationResponse(resolved.message, responseCtx, resolved.failureType);
          await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, resolved.failureType);
          return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
        }
      }

      if (matchVerdict === 'NO_MATCH') {
        // This picker — fresh or expired — is not what this message is
        // about. Strip it so it can neither leak into the provider prompt
        // nor be honored by a reference the provider emits anyway, and
        // best-effort clear the stored copy so it cannot hijack the next
        // turn either.
        discardStaleReferenceContext = true;
        const { lastPresentedCandidates: _drop, ...rest } = loaded.working;
        loaded.working = { ...rest, contextUpdatedAt: new Date().toISOString() };
        workingForProvider = loaded.working;
        if (dto.workspaceId && loaded.version !== null) {
          void this.workingContext
            .clearStalePickerCandidates(actor.tenantId, actor.userId, dto.workspaceId, loaded.version)
            .catch(() => {});
        }
      }
    }

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
              const {
                pendingMissingFields: _drop,
                pendingActionRunId: _drop2,
                lastPresentedCandidates: _drop3,
                ...rest
              } = workingForProvider;
              return { ...rest, contextUpdatedAt: new Date().toISOString() };
            })()
          : null;
        // A high-confidence topic change means "start fresh" — a reference
        // the provider emits anyway (having seen this same stale context on
        // an earlier turn) must never be honored against it.
        discardStaleReferenceContext = true;
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
        const lockedDraft = this.currentDraftEntities(loaded, pendingIntent);

        const lock = await this.clarificationFieldLock.resolve({
          tenantId: actor.tenantId,
          intent: pendingIntent,
          pendingField,
          answer: normalizedText,
          draftEntities: lockedDraft,
        });

        if (lock.kind === 'BOUND' || lock.kind === 'PICKER' || lock.kind === 'CLARIFY') {
          return this.applyFieldLockResult({ actor, dto, request, intent: pendingIntent, pendingField, lock });
        }

        // 4) lock.kind === 'NO_MATCH' → fall through to unrestricted NLP.
      }
    }

    // Typed picker continuation while an ENTITY_PICKER is active is now
    // fully handled by the picker-relevance gate at the top of this method
    // (it runs before the pendingField block and already resolves/clarifies
    // a positive match, or strips the candidate list on no-match) — by the
    // time execution reaches here, loaded.working.lastPresentedCandidates
    // is only ever still present if that gate didn't apply (no candidates,
    // or a deterministic ordinal/deictic reference, handled further below).

    // Draft correction: "No. Era Batman." / "No. Fueron 480." / "No. Fue por
    // Bancos." / "No. Era Abraham Bosquez." mutate exactly one slot of the
    // in-progress Draft and resume the SAME planner/resolver pipeline.
    // Never re-runs NLP for anything else already known.
    if (!pendingField && pendingIntent) {
      const correctionMatch = detectDraftCorrectionLanguage(normalizedText, pendingIntent);
      if (correctionMatch) {
        const applied = await this.applyDraftCorrection({
          actor,
          dto,
          request,
          responseCtx,
          loaded,
          intent: pendingIntent,
          match: correctionMatch,
        });
        if (applied) return applied;
        // Neither interpretation resolved (e.g. "watch-or-customer" matched
        // neither inventory nor CRM) — fall back safely to unrestricted NLP
        // rather than trapping the user on a guess that couldn't be verified.
      }
    }

    // 26D — Deterministic transfer correction language BEFORE expense / pure "eso".
    const transferCorrection = detectTransferCorrectionLanguage(normalizedText);
    if (transferCorrection) {
      const correctionIntent = transferCorrection.intent;
      const correctionEntities = transferCorrection.entities as Record<
        string,
        string | number | boolean
      >;
      await this.aiRequests.recordInterpretation(request.id, {
        intent: correctionIntent,
        entities: correctionEntities,
        candidateHash: `deterministic-transfer-correction:${transferCorrection.kind}`,
      });
      telem(this.telemetry, {
        event: 'ProviderCompleted',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: correctionIntent,
        clarificationReason: transferCorrection.kind,
        answered: true,
      });
      const continued = await this.assistant.executeClaimed(
        actor,
        {
          intent: correctionIntent,
          entities: correctionEntities,
          surface: dto.surface ?? 'DESKTOP',
          clientRequestId: dto.clientRequestId,
          conversationId: dto.conversationId,
          workspaceId: dto.workspaceId,
          userDisplayText: dto.text,
        },
        request,
      );
      return {
        resolvedIntent: correctionIntent,
        response: continued,
        resolvedEntities: correctionEntities,
      };
    }

    // 26C.1 / 26D — Deterministic expense correction + closed last-action allowlist.
    // LAST_ACTION_DEIXIS routes by lastReversibleAction capability (expense vs transfer).
    const expenseCorrection = detectExpenseCorrectionLanguage(normalizedText);
    if (expenseCorrection) {
      if (expenseCorrection.kind === 'BLOCKED_NON_EXPENSE_REVERSAL') {
        const response = buildReferenceClarificationResponse(
          'Todavía no puedo deshacer esa operación de forma segura desde el asistente. Indica qué quieres corregir o hazlo desde el flujo canónico.',
          responseCtx,
          'UNSUPPORTED_REVERSAL',
        );
        await this.aiRequests.failUnattached(
          request,
          actor,
          'UNKNOWN',
          response,
          'UNSUPPORTED_REVERSAL',
        );
        return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
      }

      let correctionIntent: IntentCandidateIntent = expenseCorrection.intent;
      const correctionEntities = {
        ...(expenseCorrection.entities as Record<string, string | number | boolean>),
      };

      if (expenseCorrection.kind === 'LAST_ACTION_DEIXIS') {
        let last: LastReversibleActionContext | null = null;
        try {
          if (dto.workspaceId) {
            const workspace = await this.prisma.aIWorkspace.findFirst({
              where: {
                id: dto.workspaceId,
                tenantId: actor.tenantId,
                userId: actor.userId,
                deletedAt: null,
              },
              select: { resolvedContext: true },
            });
            const shell = parseResolvedContextShell(workspace?.resolvedContext);
            last =
              (shell.lastReversibleAction as LastReversibleActionContext | undefined) ?? null;
          }
        } catch {
          last = null;
        }
        const mapped = reverseIntentFromLastReversibleAction(last);
        if (!mapped) {
          const response = buildReferenceClarificationResponse(
            'No tengo una acción reversible reciente en esta conversación para deshacer. Indica qué quieres corregir.',
            responseCtx,
            'NO_LAST_ACTION',
          );
          await this.aiRequests.failUnattached(
            request,
            actor,
            'UNKNOWN',
            response,
            'NO_LAST_ACTION',
          );
          return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
        }
        correctionIntent = mapped;
        correctionEntities.useLastAction = true;
      }

      await this.aiRequests.recordInterpretation(request.id, {
        intent: correctionIntent,
        entities: correctionEntities,
        candidateHash: `deterministic-expense-correction:${expenseCorrection.kind}`,
      });
      telem(this.telemetry, {
        event: 'ProviderCompleted',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: correctionIntent,
        clarificationReason: expenseCorrection.kind,
        answered: true,
      });
      const continued = await this.assistant.executeClaimed(
        actor,
        {
          intent: correctionIntent,
          entities: correctionEntities,
          surface: dto.surface ?? 'DESKTOP',
          clientRequestId: dto.clientRequestId,
          conversationId: dto.conversationId,
          workspaceId: dto.workspaceId,
          userDisplayText: dto.text,
        },
        request,
      );
      return {
        resolvedIntent: correctionIntent,
        response: continued,
        resolvedEntities: correctionEntities,
      };
    }

    // Pure ordinal/deictic selection — no LLM, no fabricated IDs.
    if (isPureReferentialUtterance(normalizedText) && deterministicRef) {
      const resolution = this.referenceResolver.resolve(deterministicRef, loaded.working);
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
      return this.continueFromResolvedReference({
        actor,
        dto,
        request,
        responseCtx,
        loaded,
        resolution,
        telemetryMeta: {
          ordinalUsed: deterministicRef.kind === 'ORDINAL',
          deicticUsed: deterministicRef.kind !== 'ORDINAL',
        },
      });
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

    // Operational Intent Router: deterministic, server-side, pre-provider.
    // Recognizes high-confidence dealer language ("Vendí Bruce Wayne en
    // 500k") and constructs the same candidate shape a successful Claude
    // call would produce — validated through the identical
    // buildIntentCandidate() gate (intentAdapter.interpretDeterministic()).
    // Only when the router finds NO_OPERATION_MATCH or AMBIGUOUS_OPERATION
    // does this fall through to the provider, unchanged from today. See
    // docs/ai/OPERATIONAL_INTENT_ROUTER.md.
    const routerVerdict = this.operationalRouter.route(normalizedText);
    const routerRawOutput = toRawCandidateOutput(routerVerdict);
    const currentDate = new Date().toISOString().slice(0, 10);

    let outcome: IntentAdapterOutcome;
    if (routerRawOutput) {
      outcome = this.intentAdapter.interpretDeterministic(routerRawOutput, currentDate, traceId);
    } else {
      const providerContext = toProviderConversationContext(workingForProvider, dto.locale?.startsWith('es') ? 'es' : dto.locale);
      outcome = await this.intentAdapter.interpret({
        userText: normalizedText,
        locale: dto.locale ?? 'es-MX',
        timezone: dto.timezone ?? 'UTC',
        allowedIntents: INTENT_CANDIDATE_VALUES,
        currentDate,
        requestTraceId: traceId,
        conversationContext: providerContext,
      });
    }

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
    // Once this turn has already decided the message is a fresh command
    // (topic change) or irrelevant to the stale picker it saw, never let a
    // reference — deterministic or provider-emitted — resolve against
    // context that decision already discarded.
    const reference: IntentReference | undefined = discardStaleReferenceContext
      ? undefined
      : deterministicRef ?? outcome.candidate.reference;
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
        outcome.candidate.intent === 'REVERSE_TREASURY_TRANSFER' &&
        resolution.entityType === 'TREASURY_TRANSFER'
      ) {
        entities = mergeTrustedIds(entities, {
          selectedTransferId: resolution.id,
          trustedTransferId: resolution.id,
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
    // If we were clarifying a write, preserve prior entities across free-text
    // answers — but never once a topic change already abandoned that draft
    // (a same-capability restart, e.g. a stale REGISTER_SALE clarification
    // followed by an unrelated fresh "Vendí…" sentence, must not silently
    // re-merge the old draft's unrelated fields back in).
    if (
      !discardStaleReferenceContext &&
      pendingField &&
      pendingIntent &&
      WRITE_CLARIFICATION_INTENTS.has(pendingIntent) &&
      intent === pendingIntent
    ) {
      entities = {
        ...this.currentDraftEntities(loaded, pendingIntent),
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

  /**
   * The ConversationDraft, flattened to the entities shape the planner/
   * entity resolvers/bindings have always consumed. The ONE place any
   * continuation/correction handler reads "what's already known" — no more
   * dual-mechanism reconstruction (this used to also re-scan AIRequest
   * history via loadPriorWriteEntities as a backstop, from before the Draft
   * was reliably persisted through every response type; that backstop is
   * gone now that StructuredAssistantPersistence.complete() persists the
   * Draft on every ENTITY_PICKER/MISSING_FIELDS_CARD/ACTION_PREVIEW_CARD).
   */
  private currentDraftEntities(
    loaded: { resolvedContextRaw: unknown },
    intent: string,
  ): Record<string, string | number | boolean> {
    return draftToEntities(this.workingContext.readConversationDraft(loaded.resolvedContextRaw) ?? emptyDraft(intent));
  }

  /**
   * A picker click is an EVENT, not a chat message: the frontend already
   * knows the selected candidate's trusted id (it came straight from the
   * server's own last ENTITY_PICKER response) and posts it directly here
   * instead of re-encoding the candidate's label as free text through
   * handleMessage(). This method never calls intentAdapter.interpret() (no
   * Claude, no OperationalIntentRouter) — it only resolves the id against
   * the durably-stored candidate list and hands off to the exact same
   * continuation logic ordinal/deictic replies ("el primero") already use,
   * which itself only merges the one resolved slot into the surviving
   * Draft and resumes the planner.
   */
  async handlePickerSelection(
    actor: AssistantActorContext,
    dto: PickerSelectionDto,
  ): Promise<NaturalLanguageAssistantResult> {
    const claim = await this.aiRequests.claimText(actor, {
      clientRequestId: dto.clientRequestId,
      text: dto.selectedLabel,
      surface: dto.surface,
      locale: dto.locale,
      timezone: dto.timezone,
      conversationId: dto.conversationId,
      workspaceId: dto.workspaceId,
    });
    if (claim.kind === 'REPLAY') {
      await this.aiRequests.auditReplay(actor, claim.request);
      const { intent } = this.aiRequests.readInterpretation(claim.request);
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
    const responseCtx = { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId: request.traceId };
    const loaded = await this.workingContext.load(actor.tenantId, actor.userId, dto.workspaceId);

    const resolution = this.referenceResolver.resolveByCandidateId(dto.selectedId, loaded.working);
    if (resolution.kind === 'CLARIFY') {
      telem(this.telemetry, {
        event: 'ClarificationShown',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        clarificationType: mapClarificationType(resolution.failureType),
        clarificationReason: resolution.failureType,
        entityPickerUsed: true,
        zeroCandidates: true,
      });
      const response = buildReferenceClarificationResponse(resolution.message, responseCtx, resolution.failureType);
      await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, resolution.failureType);
      return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
    }
    if (resolution.entityType !== dto.entityType) {
      const response = buildReferenceClarificationResponse(
        'Necesito que elijas nuevamente. El tipo de opción no coincide.',
        responseCtx,
        'TYPE_MISMATCH',
      );
      await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, 'TYPE_MISMATCH');
      return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
    }

    return this.continueFromResolvedReference({
      actor,
      dto,
      request,
      responseCtx,
      loaded,
      resolution,
      telemetryMeta: { ordinalUsed: false, deicticUsed: false },
    });
  }

  /**
   * "Empezar de nuevo" — Conversation Reset (V1 simplicity). A first-class,
   * explicit operation, not a simulated cancel or an empty message: no
   * provider call, no planner, no OperationalIntentRouter — a pure
   * deterministic clear of the current in-flight transaction
   * (ConversationDraft, pending clarification/picker state, plan
   * checkpoint), cancelling the one unfinished ActionRun if any. Still
   * claimed through the same durable AIRequestService.claimText() every
   * other assistant-surface action uses, so a double-click or retried
   * network request replays the identical response instead of resetting
   * twice. Conversation history and every completed ActionRun are
   * untouched — only conversationId survives on the workspace; everything
   * transaction-scoped is gone, so the NEXT message behaves exactly like
   * the first message of a brand-new conversation.
   */
  async resetConversation(
    actor: AssistantActorContext,
    dto: ConversationResetDto,
  ): Promise<NaturalLanguageAssistantResult> {
    const claim = await this.aiRequests.claimText(actor, {
      clientRequestId: dto.clientRequestId,
      // A fixed, non-user-authored marker — never shown to the user, never
      // sent to any provider. Only used as the idempotency/replay key.
      text: '__CONVERSATION_RESET__',
      surface: dto.surface,
      locale: dto.locale,
      timezone: dto.timezone,
      conversationId: dto.conversationId,
      workspaceId: dto.workspaceId,
    });
    if (claim.kind === 'REPLAY') {
      await this.aiRequests.auditReplay(actor, claim.request);
      return { resolvedIntent: 'UNKNOWN', response: claim.response, resolvedEntities: {} };
    }
    if (claim.kind === 'IN_PROGRESS') {
      return { resolvedIntent: 'UNKNOWN', response: claim.response, resolvedEntities: {} };
    }

    const request = claim.request;
    const responseCtx = { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId: request.traceId };
    let response = buildConversationResetResponse(responseCtx);

    if (dto.workspaceId) {
      try {
        const loaded = await this.workingContext.load(actor.tenantId, actor.userId, dto.workspaceId);
        if (loaded.version !== null) {
          const cleared = await this.workingContext.resetConversationTransaction(
            actor.tenantId,
            actor.userId,
            dto.workspaceId,
            loaded.version,
          );
          response = {
            ...response,
            conversationId: cleared.conversationId ?? dto.conversationId ?? '',
            workspaceId: cleared.workspaceId,
          };
        }
      } catch (error) {
        // No workspace, or nothing left to clear (already reset/idle) — the
        // reset still succeeds: there is genuinely no in-flight transaction
        // to discard, which is exactly the state the user wants to be in.
        if (!(error instanceof NotFoundException)) throw error;
      }
    }

    await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, 'CONVERSATION_RESET');
    return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
  }

  /**
   * Resumes a pending write from an already-RESOLVED entity reference —
   * shared by ordinal/deictic continuation ("el primero") and the
   * structured picker-selection EVENT (handlePickerSelection()). Never
   * re-runs NLP: it's a PATCH — this is the picker equivalent of
   * applyDraftCorrection() — reading the current ConversationDraft, patching
   * in exactly the one resolved field, and handing the flattened result to
   * the SAME planner/resolver pipeline any fresh write request goes
   * through. Every other field survives untouched.
   */
  private async continueFromResolvedReference(args: {
    actor: AssistantActorContext;
    dto: AssistantMessageDto | PickerSelectionDto;
    request: AIRequest;
    responseCtx: { conversationId?: string; workspaceId?: string; traceId: string };
    loaded: { working: AssistantWorkingContext | null; version: number | null; resolvedContextRaw: unknown };
    resolution: Extract<ReferenceResolutionResult, { kind: 'RESOLVED' }>;
    telemetryMeta: { ordinalUsed: boolean; deicticUsed: boolean };
  }): Promise<NaturalLanguageAssistantResult> {
    const { actor, dto, request, responseCtx, loaded, resolution, telemetryMeta } = args;
    const userDisplayText = 'text' in dto ? dto.text : dto.selectedLabel;
    const audit = this.workingContext.buildAuditFromResolution(resolution, loaded.version ?? 0, WORKING_CONTEXT_SCHEMA_VERSION);
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
      ordinalUsed: telemetryMeta.ordinalUsed,
      deicticUsed: telemetryMeta.deicticUsed,
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
      const currentDraft = this.workingContext.readConversationDraft(loaded.resolvedContextRaw);
      // A customer/seller query still unresolved at the time the watch was
      // ambiguous may have been a mis-parse riding along with it — cleared
      // exactly like the pre-Draft version of this code did; a trusted,
      // already-RESOLVED party is never touched.
      const clearUnresolvedParty =
        currentDraft?.customer && !currentDraft.customer.resolvedId ? { customer: undefined } : {};
      const patchedDraft = applyDraftPatch(
        currentDraft,
        {
          watch: { resolvedId: resolution.id, label: resolution.label, confidence: 'RESOLVED' },
          ...clearUnresolvedParty,
        },
        writeIntent,
      );
      const writeEntities = draftToEntities(patchedDraft);
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
          userDisplayText,
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
      const currentDraft = this.workingContext.readConversationDraft(loaded.resolvedContextRaw);
      const patchedDraft = applyDraftPatch(
        currentDraft,
        { customer: { resolvedId: resolution.id, label: resolution.label, confidence: 'RESOLVED' } },
        'REGISTER_SALE',
      );
      const saleEntities = draftToEntities(patchedDraft);
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
          userDisplayText,
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
          userDisplayText,
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
          userDisplayText,
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
    if (dto.workspaceId && resolution.entityType === 'CLIENT' && 'text' in dto) {
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
          userDisplayText,
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

  /**
   * Renders a ClarificationFieldLockService result (BOUND / PICKER /
   * CLARIFY) exactly once — shared by the original "answering the pending
   * field the planner just asked about" flow and the new draft-correction
   * flow's own watch/customer resolution attempts (both hand this the SAME
   * FieldLockResult shape, just reached via a different pendingField
   * choice: the planner's own missing-field prompt vs. this service's own
   * classification of a "No. Era X." correction).
   */
  private async applyFieldLockResult(args: {
    actor: AssistantActorContext;
    dto: AssistantMessageDto;
    request: AIRequest;
    intent: string;
    pendingField: string;
    lock: FieldLockBound | FieldLockPicker | FieldLockClarify;
  }): Promise<NaturalLanguageAssistantResult> {
    const { actor, dto, request, intent, pendingField, lock } = args;
    const traceId = request.traceId;

    if (lock.kind === 'BOUND') {
      await this.aiRequests.recordInterpretation(request.id, {
        intent,
        entities: lock.entities,
        candidateHash: `clarification-lock:${pendingField}`,
      });
      telem(this.telemetry, {
        event: 'ClarificationAnswered',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: intent,
        clarificationReason: pendingField,
        answered: true,
      });
      const continued = await this.assistant.executeClaimed(
        actor,
        {
          intent: intent as BusinessActionId,
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
        resolvedIntent: intent as IntentCandidateIntent,
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
          intent,
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
        // Picker still returned; ordinal/typed follow-up may need a fresh ask if persist races.
      }
      await this.aiRequests.recordInterpretation(request.id, {
        intent,
        entities: lock.entities,
        candidateHash: `clarification-picker:${pendingField}`,
      });
      await this.aiRequests.failUnattached(request, actor, intent, response, 'FIELD_LOCK_PICKER');
      telem(this.telemetry, {
        event: 'ClarificationShown',
        tenantId: actor.tenantId,
        conversationId: dto.conversationId,
        requestId: request.id,
        capability: intent,
        clarificationType: 'ENTITY_AMBIGUITY',
        clarificationReason: pendingField,
        entityPickerUsed: true,
        candidateCount: lock.candidates.length,
        multipleCandidates: true,
      });
      return { resolvedIntent: intent as IntentCandidateIntent, response, resolvedEntities: lock.entities };
    }

    // lock.kind === 'CLARIFY' — stay on the pending field with contextual copy.
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
        intent,
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
      intent,
      entities: lock.entities,
      candidateHash: `clarification-clarify:${pendingField}`,
    });
    await this.aiRequests.failUnattached(request, actor, intent, response, 'FIELD_LOCK_CLARIFY');
    telem(this.telemetry, {
      event: 'ClarificationShown',
      tenantId: actor.tenantId,
      conversationId: dto.conversationId,
      requestId: request.id,
      capability: intent,
      clarificationType: 'MISSING_FIELD',
      clarificationReason: pendingField,
      zeroCandidates: true,
    });
    return { resolvedIntent: intent as IntentCandidateIntent, response, resolvedEntities: lock.entities };
  }

  /**
   * Applies a deterministically-classified draft correction. Returns null
   * when the correction couldn't be safely resolved (caller falls back to
   * unrestricted NLP) — this method NEVER invents a value, it only ever
   * commits one it could actually verify (money-shape, closed account/
   * currency vocabulary, or a real watch/client match via the same
   * resolvers original extraction uses).
   */
  private async applyDraftCorrection(args: {
    actor: AssistantActorContext;
    dto: AssistantMessageDto;
    request: AIRequest;
    responseCtx: { conversationId?: string; workspaceId?: string; traceId: string };
    loaded: { working: AssistantWorkingContext | null; version: number | null; resolvedContextRaw: unknown };
    intent: string;
    match: { field: 'amount' | 'currency' | 'payment' | 'watch-or-customer'; rawValue: string };
  }): Promise<NaturalLanguageAssistantResult | null> {
    const { actor, dto, request, loaded, intent, match } = args;
    const currentDraft = this.workingContext.readConversationDraft(loaded.resolvedContextRaw);

    // Every branch below spreads the Draft's CURRENT sub-object and
    // overrides only the one leaf that changed — "No. Fueron 480." must
    // never wipe a currency the user already stated, "No. Fue por Bancos."
    // must never wipe the payment mode, and so on.
    if (match.field === 'amount') {
      const parsed = parseCorrectedAmount(match.rawValue);
      if (parsed === null) return null;
      const patchedDraft = applyDraftPatch(currentDraft, { amount: { ...currentDraft?.amount, value: parsed } }, intent);
      return this.resumeWithCorrectedDraft({ actor, dto, request, intent, draft: patchedDraft, correctionField: 'amount' });
    }

    if (match.field === 'currency') {
      const currency = detectCorrectedCurrency(match.rawValue);
      if (!currency) return null;
      const patchedDraft = applyDraftPatch(currentDraft, { amount: { ...currentDraft?.amount, currency } }, intent);
      return this.resumeWithCorrectedDraft({ actor, dto, request, intent, draft: patchedDraft, correctionField: 'currency' });
    }

    if (match.field === 'payment') {
      const account = detectCorrectedAccount(match.rawValue, intent);
      if (!account) return null;
      const patchedDraft = applyDraftPatch(currentDraft, { payment: { ...currentDraft?.payment, account } }, intent);
      return this.resumeWithCorrectedDraft({ actor, dto, request, intent, draft: patchedDraft, correctionField: 'payment' });
    }

    // 'watch-or-customer' — genuinely ambiguous from text alone ("Batman"
    // and "Abraham Bosquez" share the identical "Era <X>." template). Try
    // the SAME watch resolver the original extraction uses first (universal
    // 'watchId' pendingField name); only if it finds nothing at all does
    // this attempt the customer/seller resolver — never both, never a guess
    // presented to the user without verification. ClarificationFieldLockService
    // still speaks the flat entities dialect (unchanged, out of this
    // refactor's scope), so the Draft is flattened once, right at this call.
    const current = draftToEntities(currentDraft ?? emptyDraft(intent));
    const watchAttempt = await this.clarificationFieldLock.resolve({
      tenantId: actor.tenantId,
      intent,
      pendingField: 'watchId',
      answer: match.rawValue,
      draftEntities: current,
    });
    if (watchAttempt.kind === 'BOUND' || watchAttempt.kind === 'PICKER') {
      return this.applyFieldLockResult({ actor, dto, request, intent, pendingField: 'watchId', lock: watchAttempt });
    }

    const customerField = intent === 'REGISTER_PURCHASE' ? 'seller' : 'customerId';
    const customerAttempt = await this.clarificationFieldLock.resolve({
      tenantId: actor.tenantId,
      intent,
      pendingField: customerField,
      answer: match.rawValue,
      draftEntities: current,
    });
    if (customerAttempt.kind === 'BOUND' || customerAttempt.kind === 'PICKER') {
      return this.applyFieldLockResult({ actor, dto, request, intent, pendingField: customerField, lock: customerAttempt });
    }

    // Neither a known watch nor a known client/seller — cannot safely commit either interpretation.
    return null;
  }

  private async resumeWithCorrectedDraft(args: {
    actor: AssistantActorContext;
    dto: AssistantMessageDto;
    request: AIRequest;
    intent: string;
    draft: ConversationDraft;
    correctionField: string;
  }): Promise<NaturalLanguageAssistantResult> {
    const { actor, dto, request, intent, draft, correctionField } = args;
    const entities = draftToEntities(draft);
    await this.aiRequests.recordInterpretation(request.id, {
      intent,
      entities,
      candidateHash: `draft-correction:${correctionField}`,
    });
    telem(this.telemetry, {
      event: 'ClarificationAnswered',
      tenantId: actor.tenantId,
      conversationId: dto.conversationId,
      requestId: request.id,
      capability: intent,
      clarificationReason: `correction:${correctionField}`,
      answered: true,
    });
    const continued = await this.assistant.executeClaimed(
      actor,
      {
        intent: intent as BusinessActionId,
        entities,
        surface: dto.surface ?? 'DESKTOP',
        clientRequestId: dto.clientRequestId,
        conversationId: dto.conversationId,
        workspaceId: dto.workspaceId,
        userDisplayText: dto.text,
      },
      request,
    );
    return { resolvedIntent: intent as IntentCandidateIntent, response: continued, resolvedEntities: entities };
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
