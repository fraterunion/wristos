import { Injectable } from '@nestjs/common';
import { AIRequestService } from '../assistant/ai-request.service';
import { StructuredAssistantService } from '../assistant/structured-assistant.service';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from '../assistant/structured-assistant.types';
import { AssistantMessageDto } from '../dto/assistant-message.dto';
import { BusinessActionId } from '../planner/planner.types';
import { IntentAdapterService } from './intent-adapter.service';
import { INTENT_CANDIDATE_VALUES, IntentCandidateIntent } from './intent-schema';
import { assertWithinTextLimit, decideConfidencePolicy } from './safety';
import { buildPolicyResponse, buildProviderFailureResponse } from './typed-responses';

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
 * always used (see ai-request.service.ts's shared claimCanonical()) — of
 * any number of concurrent requests with the same tenant/actor/
 * clientRequestId/text, at most one can ever return 'OWNED'. Only the
 * OWNED caller reaches this.intentAdapter.interpret() below. Everyone else
 * gets IN_PROGRESS or an exact REPLAY, with zero provider calls.
 *
 * Once interpretation resolves, the SAME claimed AIRequest identity
 * continues through the UNCHANGED StructuredAssistantService lifecycle via
 * executeClaimed() — never a second claim, never a second AIRequest row.
 *
 * This service never calls a tool, a capability binding, a domain service,
 * or Prisma directly for anything beyond what AIRequestService already
 * owns (the claim itself and its audit trail).
 */
@Injectable()
export class NaturalLanguageAssistantService {
  constructor(
    private readonly aiRequests: AIRequestService,
    private readonly intentAdapter: IntentAdapterService,
    private readonly assistant: StructuredAssistantService,
  ) {}

  async handleMessage(actor: AssistantActorContext, dto: AssistantMessageDto): Promise<NaturalLanguageAssistantResult> {
    const normalizedText = dto.text.trim();
    assertWithinTextLimit(normalizedText);

    // Durable pre-provider claim. Throws ConflictException (409) here, before
    // any provider call, if this clientRequestId was already used with
    // different text — claimCanonical's fingerprint mismatch check.
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
      // Exact replay of a previously-completed claim for this exact text —
      // zero provider calls, one bounded audit event, never the original
      // interpretation-started/completed lifecycle again.
      await this.aiRequests.auditReplay(actor, claim.request);
      const { intent } = this.aiRequests.readInterpretation(claim.request);
      // readInterpretation() reads back the SANITIZED requestPayload (the
      // same audit-safe convention canonicalRequest() already uses) — it
      // may contain {redactedHash} placeholders in place of real entity
      // values. The intent name is never sensitive, but entities are never
      // reconstructed from that store for a client-facing reply: the
      // frontend feeds resolvedEntities straight back into follow-up
      // actions, and a redaction placeholder would corrupt that payload.
      return {
        resolvedIntent: (intent as IntentCandidateIntent | null) ?? 'UNKNOWN',
        response: claim.response,
        resolvedEntities: {},
      };
    }
    if (claim.kind === 'IN_PROGRESS') {
      return { resolvedIntent: 'UNKNOWN', response: claim.response, resolvedEntities: {} };
    }

    // claim.kind === 'OWNED' — we are the SOLE owner of this identity. We may
    // call the provider exactly once.
    const request = claim.request;
    const traceId = request.traceId;

    const outcome = await this.intentAdapter.interpret({
      userText: normalizedText,
      locale: dto.locale ?? 'es-MX',
      timezone: dto.timezone ?? 'UTC',
      allowedIntents: INTENT_CANDIDATE_VALUES,
      currentDate: new Date().toISOString().slice(0, 10),
      requestTraceId: traceId,
    });

    if (outcome.kind !== 'CANDIDATE') {
      const response = buildProviderFailureResponse(outcome, { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId });
      // Marks the SAME claimed row terminally failed (replayable) — never a
      // second AIRequest, never a second provider call on retry.
      await this.aiRequests.failUnattached(request, actor, 'UNKNOWN', response, outcome.kind === 'PROVIDER_FAILURE' ? outcome.failureType : outcome.reason);
      return { resolvedIntent: 'UNKNOWN', response, resolvedEntities: {} };
    }

    // Denormalize the resolved candidate onto the claimed row so a future
    // exact-text replay can recover it without re-interpreting — regardless
    // of whether this outcome proceeds to the orchestrator.
    await this.aiRequests.recordInterpretation(request.id, {
      intent: outcome.candidate.intent,
      entities: outcome.candidate.entities,
      candidateHash: outcome.candidate.candidateHash,
    });

    const policy = decideConfidencePolicy(outcome.candidate);

    if (policy.action !== 'PROCEED') {
      const response = buildPolicyResponse(policy, { conversationId: dto.conversationId, workspaceId: dto.workspaceId, traceId });
      await this.aiRequests.failUnattached(request, actor, outcome.candidate.intent, response, policy.action);
      return { resolvedIntent: outcome.candidate.intent, response, resolvedEntities: outcome.candidate.entities };
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
      clientRequestId: dto.clientRequestId,
      userDisplayText: normalizedText,
    };
    // Continues under the SAME durable identity claimText() already owns —
    // never a second claim(), never a second AIRequest row.
    const response = await this.assistant.executeClaimed(actor, structuredRequest, request);
    return { resolvedIntent: intent, response, resolvedEntities: outcome.candidate.entities };
  }
}
