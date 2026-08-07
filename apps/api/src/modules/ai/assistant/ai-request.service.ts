import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { AIAuditEventType, AIConversationSurface, AIRequest, AIRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { JsonValue, sha256Canonical } from '../domain/canonical-json';
import { AssistantActorContext, StructuredAssistantRequest, StructuredAssistantResponse } from './structured-assistant.types';

export const TERMINAL_AI_REQUEST_STATUSES = new Set<AIRequestStatus>([AIRequestStatus.NEEDS_CLARIFICATION, AIRequestStatus.READY_FOR_CONFIRMATION, AIRequestStatus.COMPLETED, AIRequestStatus.FAILED]);
const TERMINAL = TERMINAL_AI_REQUEST_STATUSES;
const STALE_AFTER_MS = 5 * 60 * 1000;

export type RequestClaim =
  | { kind: 'OWNED'; request: AIRequest }
  | { kind: 'REPLAY'; request: AIRequest; response: StructuredAssistantResponse }
  | { kind: 'IN_PROGRESS'; request: AIRequest; response: StructuredAssistantResponse };

export interface TextClaimParams {
  clientRequestId: string;
  text: string;
  surface: AIConversationSurface;
  locale?: string;
  timezone?: string;
  conversationId?: string;
  workspaceId?: string;
}

@Injectable()
export class AIRequestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Durable claim for the existing structured endpoint. Unchanged behavior —
   * this is now a thin wrapper around the shared claimCanonical() mechanics.
   */
  async claim(actor: AssistantActorContext, input: StructuredAssistantRequest): Promise<RequestClaim> {
    const canonicalPayload = this.canonicalRequest(actor, input);
    return this.claimCanonical(actor, input.clientRequestId, canonicalPayload, input.intent);
  }

  /**
   * Durable claim for the natural-language message endpoint, taken BEFORE
   * any provider call. This is the actual concurrency boundary: the DB's
   * unique constraint on (tenantId, actorUserId, clientRequestId) — enforced
   * by claimCanonical()'s create-or-detect-conflict logic below — guarantees
   * that of any number of concurrent requests with the same identity, at
   * most one ever returns 'OWNED'. Only the OWNED caller may call the
   * provider (see NaturalLanguageAssistantService.handleMessage).
   *
   * The fingerprint here is over the natural-language text/context, NOT an
   * intent — there is no intent yet. Once interpretation resolves one, the
   * SAME row/identity continues through StructuredAssistantService's
   * existing lifecycle via executeClaimed() — never a second claim.
   */
  async claimText(actor: AssistantActorContext, params: TextClaimParams): Promise<RequestClaim> {
    const canonicalPayload = this.canonicalTextRequest(actor, params);
    return this.claimCanonical(actor, params.clientRequestId, canonicalPayload, 'INTENT_INTERPRETATION');
  }

  /**
   * Shared claim mechanics: exactly the original claim() body, parameterized
   * over how the canonical payload was built. Behavior for existing
   * structured-endpoint callers (via claim()) is byte-for-byte unchanged.
   */
  private async claimCanonical(
    actor: AssistantActorContext,
    clientRequestId: string,
    canonicalPayload: JsonValue,
    auditIntent: string,
  ): Promise<RequestClaim> {
    const fingerprint = sha256Canonical(canonicalPayload);
    const traceId = `assistant:${randomUUID()}`;
    try {
      const request = await this.prisma.$transaction(async (tx) => {
        const created = await tx.aIRequest.create({ data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          clientRequestId,
          requestFingerprint: fingerprint,
          requestPayload: canonicalPayload as Prisma.InputJsonObject,
          traceId,
        } });
        await tx.aIAuditEvent.create({ data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          type: AIAuditEventType.ASSISTANT_REQUEST_RECEIVED,
          payload: this.auditPayload(created, auditIntent),
        } });
        return created;
      });
      return { kind: 'OWNED', request };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }

    let existing = await this.prisma.aIRequest.findUniqueOrThrow({
      where: { tenantId_actorUserId_clientRequestId: { tenantId: actor.tenantId, actorUserId: actor.userId, clientRequestId } },
    });
    if (existing.requestFingerprint !== fingerprint) {
      await this.prisma.aIAuditEvent.create({ data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        conversationId: existing.conversationId,
        actionRunId: existing.actionRunId,
        workspaceId: existing.workspaceId,
        type: AIAuditEventType.ASSISTANT_REQUEST_CONFLICTED,
        payload: this.auditPayload(existing, auditIntent),
      } });
      throw new ConflictException('Este identificador de solicitud ya fue utilizado con contenido diferente.');
    }
    if (!TERMINAL.has(existing.status) && Date.now() - existing.updatedAt.getTime() >= STALE_AFTER_MS) {
      existing = await this.failStale(existing, auditIntent);
    }
    if (TERMINAL.has(existing.status)) return { kind: 'REPLAY', request: existing, response: this.readStoredResponse(existing) };
    return { kind: 'IN_PROGRESS', request: existing, response: this.inProgressResponse(existing) };
  }

  async transition(id: string, from: AIRequestStatus[], to: AIRequestStatus, links: { conversationId?: string; workspaceId?: string; actionRunId?: string } = {}) {
    const result = await this.prisma.aIRequest.updateMany({ where: { id, status: { in: from } }, data: { status: to, ...links, ...(to === AIRequestStatus.VALIDATING ? { startedAt: new Date() } : {}) } });
    if (result.count !== 1) throw new ConflictException('AI request lifecycle transition is invalid');
    return this.prisma.aIRequest.findUniqueOrThrow({ where: { id } });
  }

  responseHash(response: StructuredAssistantResponse): string {
    return sha256Canonical(response as unknown as JsonValue);
  }

  /**
   * Marks an OWNED-but-never-orchestrated claim as terminally failed —
   * originally for requests rejected before persistence.prepare() ever ran.
   * Reused as-is (no changes) for the natural-language flow's provider-
   * failure and confidence-policy-rejection outcomes, which are exactly
   * that: claimed, never handed to the orchestrator.
   */
  async failUnattached(request: AIRequest, actor: AssistantActorContext, intent: string, response: StructuredAssistantResponse, failureType: string): Promise<StructuredAssistantResponse> {
    const responseHash = this.responseHash(response);
    await this.prisma.$transaction(async (tx) => {
      await tx.aIRequest.update({ where: { id: request.id }, data: { status: AIRequestStatus.FAILED, responsePayload: response as unknown as Prisma.InputJsonObject, responseHash, errorType: failureType, failureSummary: 'Request rejected before persistence preparation', failedAt: new Date() } });
      await tx.aIAuditEvent.create({ data: { tenantId: actor.tenantId, actorUserId: actor.userId, type: AIAuditEventType.ASSISTANT_REQUEST_FAILED, payload: { aiRequestId: request.id, requestFingerprint: request.requestFingerprint, responseHash, status: AIRequestStatus.FAILED, intent, traceId: request.traceId, durationMs: Math.max(0, Date.now() - request.receivedAt.getTime()), failureType } } });
    });
    return response;
  }

  /**
   * Denormalizes the resolved interpretation (sanitized, same convention as
   * canonicalRequest's entities) onto the already-claimed row's
   * requestPayload, before handing off to executeClaimed(). This is what
   * lets a future exact-text replay recover resolvedIntent/resolvedEntities
   * without re-running interpretation — the requestFingerprint column
   * (the only field claimCanonical's conflict check reads) is untouched.
   */
  async recordInterpretation(requestId: string, interpretation: { intent: string; entities: Record<string, JsonValue>; candidateHash: string }): Promise<void> {
    const current = await this.prisma.aIRequest.findUniqueOrThrow({ where: { id: requestId } });
    const existingPayload = current.requestPayload && typeof current.requestPayload === 'object' && !Array.isArray(current.requestPayload)
      ? (current.requestPayload as Record<string, JsonValue>)
      : {};
    await this.prisma.aIRequest.update({
      where: { id: requestId },
      data: {
        requestPayload: {
          ...existingPayload,
          resolvedIntent: interpretation.intent,
          resolvedEntities: this.sanitizeEntities(interpretation.entities),
          candidateHash: interpretation.candidateHash,
        } as Prisma.InputJsonObject,
      },
    });
  }

  /** Reads back a prior recordInterpretation() call from a (possibly replayed) request's payload. */
  readInterpretation(request: AIRequest): { intent: string | null; entities: Record<string, JsonValue> } {
    const payload = request.requestPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { intent: null, entities: {} };
    const record = payload as Record<string, JsonValue>;
    const intent = typeof record.resolvedIntent === 'string' ? record.resolvedIntent : null;
    const entities = record.resolvedEntities && typeof record.resolvedEntities === 'object' && !Array.isArray(record.resolvedEntities)
      ? (record.resolvedEntities as Record<string, JsonValue>)
      : {};
    return { intent, entities };
  }

  /** Bounded, one-shot audit event for a replay — never re-emits the original interpretation lifecycle. */
  async auditReplay(actor: AssistantActorContext, request: AIRequest): Promise<void> {
    await this.prisma.aIAuditEvent.create({ data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      conversationId: request.conversationId,
      actionRunId: request.actionRunId,
      workspaceId: request.workspaceId,
      type: AIAuditEventType.ASSISTANT_REQUEST_REPLAYED,
      payload: this.auditPayload(request, this.readInterpretation(request).intent ?? 'UNKNOWN'),
    } });
  }

  readStoredResponse(request: AIRequest): StructuredAssistantResponse {
    if (!request.responsePayload || !request.responseHash) throw new InternalServerErrorException('Terminal AI request has no replayable response');
    const response = request.responsePayload as unknown as StructuredAssistantResponse;
    if (this.responseHash(response) !== request.responseHash) throw new InternalServerErrorException('Stored AI response hash does not match');
    return response;
  }

  private async failStale(request: AIRequest, intent: string): Promise<AIRequest> {
    const response: StructuredAssistantResponse = {
      requestId: request.id,
      conversationId: request.conversationId ?? '',
      workspaceId: request.workspaceId ?? '',
      ...(request.actionRunId ? { actionRunId: request.actionRunId } : {}),
      interactionState: 'FAILED',
      responseType: 'ERROR_RECOVERY_CARD',
      payload: {
        code: 'STALE_PROCESSING_REQUEST',
        message: 'La solicitud anterior se interrumpió antes de completarse.',
        unchanged: 'No se inició una nueva ejecución ni se modificaron datos de negocio.',
        nextAction: 'Envía una solicitud nueva con un clientRequestId diferente.',
      },
      warnings: [],
      suggestedActions: [],
      traceId: request.traceId,
      createdAt: new Date().toISOString(),
    };
    const responseHash = this.responseHash(response);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.aIRequest.updateMany({
        where: { id: request.id, status: request.status, updatedAt: request.updatedAt },
        data: { status: AIRequestStatus.FAILED, errorType: 'STALE_PROCESSING_REQUEST', failureSummary: 'Orchestration lease expired', failedAt: new Date(), responsePayload: response as unknown as Prisma.InputJsonObject, responseHash },
      });
      if (changed.count === 1) await tx.aIAuditEvent.create({ data: {
        tenantId: request.tenantId, actorUserId: request.actorUserId, conversationId: request.conversationId,
        workspaceId: request.workspaceId, actionRunId: request.actionRunId,
        type: AIAuditEventType.ASSISTANT_REQUEST_FAILED,
        payload: { aiRequestId: request.id, requestFingerprint: request.requestFingerprint, responseHash, status: AIRequestStatus.FAILED, intent, traceId: request.traceId, durationMs: Math.max(0, Date.now() - request.receivedAt.getTime()), failureType: 'STALE_PROCESSING_REQUEST' },
      } });
    });
    return this.prisma.aIRequest.findUniqueOrThrow({ where: { id: request.id } });
  }

  private inProgressResponse(request: AIRequest): StructuredAssistantResponse {
    return {
      requestId: request.id,
      conversationId: request.conversationId ?? '',
      workspaceId: request.workspaceId ?? '',
      ...(request.actionRunId ? { actionRunId: request.actionRunId } : {}),
      interactionState: 'EXECUTING',
      responseType: 'ERROR_RECOVERY_CARD',
      payload: { code: 'REQUEST_IN_PROGRESS', message: 'La solicitud ya está en proceso.', unchanged: 'No se inició una ejecución duplicada.', nextAction: 'Vuelve a consultar con el mismo identificador.' },
      warnings: [], suggestedActions: [], traceId: request.traceId, createdAt: request.receivedAt.toISOString(),
    };
  }

  private canonicalRequest(actor: AssistantActorContext, input: StructuredAssistantRequest): JsonValue {
    return {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      intent: input.intent,
      entities: this.sanitizeEntities(input.entities),
      entityVersions: input.entityVersions ?? {},
      expectedWorkspaceVersion: input.expectedWorkspaceVersion ?? null,
      surface: input.surface,
      locale: input.locale ?? 'es-MX',
      timezone: input.timezone ?? 'UTC',
      conversationId: input.conversationId ?? null,
      workspaceId: input.workspaceId ?? null,
    };
  }

  private canonicalTextRequest(actor: AssistantActorContext, params: TextClaimParams): JsonValue {
    return {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      phase: 'INTENT_INTERPRETATION',
      textHash: sha256Canonical(params.text),
      surface: params.surface,
      locale: params.locale ?? 'es-MX',
      timezone: params.timezone ?? 'UTC',
      conversationId: params.conversationId ?? null,
      workspaceId: params.workspaceId ?? null,
    };
  }

  private sanitizeEntities(entities: Record<string, JsonValue>): Record<string, JsonValue> {
    const sensitive = /^(query|name|email|phone|notes?|searchText)$/i;
    return Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, sensitive.test(key) ? { redactedHash: sha256Canonical(value) } : value]));
  }

  private auditPayload(request: AIRequest, intent: string): Prisma.InputJsonObject {
    return {
      aiRequestId: request.id,
      clientRequestIdHash: sha256Canonical(request.clientRequestId),
      requestFingerprint: request.requestFingerprint,
      status: request.status,
      intent,
      traceId: request.traceId,
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(request.actionRunId ? { actionRunId: request.actionRunId } : {}),
    };
  }
}
