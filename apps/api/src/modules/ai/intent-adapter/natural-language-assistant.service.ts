import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AIAuditEventType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { sha256Canonical } from '../domain/canonical-json';
import { AIRequestService, TERMINAL_AI_REQUEST_STATUSES } from '../assistant/ai-request.service';
import { StructuredAssistantService } from '../assistant/structured-assistant.service';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from '../assistant/structured-assistant.types';
import { AssistantMessageDto } from '../dto/assistant-message.dto';
import { BusinessActionId } from '../planner/planner.types';
import { IntentAdapterService } from './intent-adapter.service';
import { INTENT_CANDIDATE_VALUES, IntentCandidateIntent, KNOWN_INTENTS } from './intent-schema';
import { decideConfidencePolicy } from './safety';
import { assertWithinTextLimit } from './safety';
import { buildPolicyResponse, buildProviderFailureResponse } from './typed-responses';

export interface NaturalLanguageAssistantResult {
  /** The intent the message ultimately resolved to, or 'UNKNOWN' for anything that never reached the orchestrator. */
  resolvedIntent: IntentCandidateIntent;
  response: StructuredAssistantResponse;
  /**
   * The entities the adapter resolved (empty for UNKNOWN/failed/clarify-only
   * outcomes). Returned so the frontend can carry them forward the same way
   * it already does for the structured endpoint's own history items — e.g.
   * merging additional fields into a follow-up request without losing what
   * the message already resolved (a watchQuery, an amount, ...).
   */
  resolvedEntities: Record<string, string | number | boolean>;
}

/**
 * The natural-language entry point (POST /ai/assistant/message). This
 * service's ONLY responsibilities are: durable idempotency at the message
 * layer, calling IntentAdapterService, applying the confidence policy, and
 * — for candidates cleared to proceed — building a StructuredAssistantRequest
 * and handing it to the UNCHANGED StructuredAssistantService.execute(). It
 * never calls a tool, a capability binding, a domain service, or Prisma for
 * anything beyond its own idempotency bookkeeping and audit trail.
 */
@Injectable()
export class NaturalLanguageAssistantService {
  private readonly logger = new Logger(NaturalLanguageAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiRequests: AIRequestService,
    private readonly intentAdapter: IntentAdapterService,
    private readonly assistant: StructuredAssistantService,
  ) {}

  async handleMessage(actor: AssistantActorContext, dto: AssistantMessageDto): Promise<NaturalLanguageAssistantResult> {
    const normalizedText = dto.text.trim();
    assertWithinTextLimit(normalizedText);

    const derivedClientRequestId = deriveStructuredClientRequestId(actor, dto.clientRequestId);
    const textHash = sha256Canonical(normalizedText);
    const traceId = `nlmsg:${randomUUID()}`;

    const existing = await this.prisma.aIRequest.findUnique({
      where: { tenantId_actorUserId_clientRequestId: { tenantId: actor.tenantId, actorUserId: actor.userId, clientRequestId: derivedClientRequestId } },
    });

    if (existing) {
      const storedTextHash = readTextHash(existing.requestPayload);
      if (storedTextHash !== textHash) {
        await this.prisma.aIAuditEvent.create({
          data: {
            tenantId: actor.tenantId, actorUserId: actor.userId,
            type: AIAuditEventType.ASSISTANT_REQUEST_CONFLICTED,
            payload: { phase: 'INTENT_INTERPRETATION', clientRequestIdHash: sha256Canonical(dto.clientRequestId), aiRequestId: existing.id, traceId },
          },
        });
        throw new ConflictException('Este identificador de solicitud ya fue utilizado con contenido diferente.');
      }
      if (TERMINAL_AI_REQUEST_STATUSES.has(existing.status)) {
        // Exact replay — no second provider call, no second orchestration.
        // resolvedEntities is intentionally empty here: the persisted
        // request payload redacts sensitive entity values (see
        // ai-request.service.ts's sanitizeEntities), so it cannot be
        // unredacted for the frontend. A replay is, by definition, a
        // response the user has already seen in full.
        const response = this.aiRequests.readStoredResponse(existing);
        const resolvedIntent = readResolvedIntent(existing.requestPayload);
        return { resolvedIntent, response, resolvedEntities: {} };
      }
      // In-progress race (rare): fall through and re-interpret. Worst case
      // is a safe 409 from the orchestrator's own claim() if this retry's
      // interpretation differs from the in-flight one — never a silent
      // duplicate execution, since execute() still owns its own claim.
    }

    await this.prisma.aIAuditEvent.create({
      data: {
        tenantId: actor.tenantId, actorUserId: actor.userId,
        type: AIAuditEventType.ASSISTANT_REQUEST_RECEIVED,
        payload: { phase: 'INTENT_INTERPRETATION', outcome: 'STARTED', clientRequestIdHash: sha256Canonical(dto.clientRequestId), derivedClientRequestId, traceId },
      },
    });

    const outcome = await this.intentAdapter.interpret({
      userText: normalizedText,
      locale: dto.locale ?? 'es-MX',
      timezone: dto.timezone ?? 'UTC',
      allowedIntents: INTENT_CANDIDATE_VALUES,
      currentDate: new Date().toISOString().slice(0, 10),
      requestTraceId: traceId,
    });

    if (outcome.kind !== 'CANDIDATE') {
      await this.prisma.aIAuditEvent.create({
        data: {
          tenantId: actor.tenantId, actorUserId: actor.userId,
          type: AIAuditEventType.ASSISTANT_REQUEST_FAILED,
          payload: {
            phase: 'INTENT_INTERPRETATION', outcome: 'FAILED', traceId,
            provider: outcome.provider, model: outcome.model, schemaVersion: outcome.schemaVersion, latencyMs: outcome.latencyMs,
            failureType: outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : outcome.reason,
          },
        },
      });
      return { resolvedIntent: 'UNKNOWN', response: buildProviderFailureResponse(outcome, { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId }), resolvedEntities: {} };
    }

    const policy = decideConfidencePolicy(outcome.candidate);

    await this.prisma.aIAuditEvent.create({
      data: {
        tenantId: actor.tenantId, actorUserId: actor.userId,
        type: AIAuditEventType.ASSISTANT_REQUEST_COMPLETED,
        payload: {
          phase: 'INTENT_INTERPRETATION', outcome: 'COMPLETED', traceId,
          provider: outcome.provider, model: outcome.model, schemaVersion: outcome.schemaVersion, latencyMs: outcome.latencyMs,
          tokenUsage: outcome.tokenUsage ?? null, intent: outcome.candidate.intent, confidence: outcome.candidate.confidence,
          candidateHash: outcome.candidate.candidateHash, policyAction: policy.action,
        },
      },
    });

    if (policy.action !== 'PROCEED') {
      const resolvedIntent: IntentCandidateIntent = outcome.candidate.intent;
      return { resolvedIntent, response: buildPolicyResponse(policy, { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId }), resolvedEntities: outcome.candidate.entities };
    }

    const intent = outcome.candidate.intent as BusinessActionId;
    const structuredRequest: StructuredAssistantRequest = {
      conversationId: dto.conversationId,
      workspaceId: dto.workspaceId,
      intent,
      entities: outcome.candidate.entities,
      surface: dto.surface,
      locale: dto.locale,
      timezone: dto.timezone,
      clientRequestId: derivedClientRequestId,
      userDisplayText: normalizedText,
    };
    const response = await this.assistant.execute(actor, structuredRequest);
    return { resolvedIntent: intent, response, resolvedEntities: outcome.candidate.entities };
  }
}

/**
 * Deterministic, fixed-length, namespaced derivation so natural-language
 * requests never share a keyspace with clientRequestIds chosen directly by
 * a structured-endpoint caller (both write to the same AIRequest unique
 * constraint). Pure function of (tenant, user, the message's own
 * clientRequestId) — never of the message text, so the SAME message-level
 * id always maps to the SAME underlying AIRequest row regardless of what
 * text arrives (that row's own fingerprint, including userDisplayTextHash,
 * is what actually distinguishes same-text replay from different-text
 * conflict — see ai-request.service.ts).
 */
export function deriveStructuredClientRequestId(actor: AssistantActorContext, messageClientRequestId: string): string {
  const digest = createHash('sha256').update(`${actor.tenantId}:${actor.userId}:${messageClientRequestId}`).digest('hex');
  return `nlmsg:${digest.slice(0, 40)}`;
}

function readTextHash(requestPayload: unknown): string | null {
  if (!requestPayload || typeof requestPayload !== 'object') return null;
  const value = (requestPayload as Record<string, unknown>).userDisplayTextHash;
  return typeof value === 'string' ? value : null;
}

function readResolvedIntent(requestPayload: unknown): IntentCandidateIntent {
  if (!requestPayload || typeof requestPayload !== 'object') return 'UNKNOWN';
  const value = (requestPayload as Record<string, unknown>).intent;
  return typeof value === 'string' && (KNOWN_INTENTS as readonly string[]).includes(value) ? (value as IntentCandidateIntent) : 'UNKNOWN';
}
