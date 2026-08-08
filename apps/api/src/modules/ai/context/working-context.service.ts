import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AssistantWorkingContext,
  applyPresentedCandidates,
  applySelectedEntity,
  extractPresentedCandidatesFromEntityList,
  hashEntityId,
  readWorkingContext,
  writeWorkingContext,
  ContextEntityType,
} from './working-context';
import { ReferenceResolutionResult } from './reference-resolver.service';

export interface ContextAuditPayload {
  contextSchemaVersion: string;
  referenceKind?: string;
  entityType?: string;
  ordinal?: number;
  contextVersion: number;
  resolutionResult: 'RESOLVED' | 'CLARIFY' | 'WRITTEN' | 'CLEARED';
  resolvedEntityHash?: string;
  contextAgeMs?: number | null;
  failureType?: string;
}

@Injectable()
export class WorkingContextService {
  constructor(private readonly prisma: PrismaService) {}

  async load(tenantId: string, userId: string, workspaceId: string | undefined): Promise<{
    working: AssistantWorkingContext | null;
    version: number | null;
    resolvedContextRaw: unknown;
  }> {
    if (!workspaceId) return { working: null, version: null, resolvedContextRaw: null };
    const workspace = await this.prisma.aIWorkspace.findFirst({
      where: { id: workspaceId, tenantId, userId, deletedAt: null },
      select: { version: true, resolvedContext: true },
    });
    if (!workspace) throw new NotFoundException('AI workspace not found');
    return {
      working: readWorkingContext(workspace.resolvedContext),
      version: workspace.version,
      resolvedContextRaw: workspace.resolvedContext,
    };
  }

  async persistSelection(
    tenantId: string,
    userId: string,
    workspaceId: string,
    expectedVersion: number,
    selected: { type: ContextEntityType; id: string; label: string },
    audit: ContextAuditPayload,
  ): Promise<{ version: number; working: AssistantWorkingContext }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.aIWorkspace.findFirst({
        where: { id: workspaceId, tenantId, userId, deletedAt: null },
        select: { version: true, resolvedContext: true, conversationId: true },
      });
      if (!current) throw new NotFoundException('AI workspace not found');
      if (current.version !== expectedVersion) throw new ConflictException('AI workspace version is stale');

      const nextWorking = applySelectedEntity(readWorkingContext(current.resolvedContext), selected);
      const nextResolved = writeWorkingContext(current.resolvedContext, nextWorking);
      const changed = await tx.aIWorkspace.updateMany({
        where: { id: workspaceId, tenantId, userId, version: expectedVersion, deletedAt: null },
        data: {
          resolvedContext: nextResolved as Prisma.InputJsonObject,
          selectedEntities: { type: selected.type, id: hashEntityId(selected.id), label: selected.label } as Prisma.InputJsonObject,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new ConflictException('AI workspace version is stale');
      const workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
      await tx.aIAuditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          workspaceId,
          conversationId: current.conversationId,
          type: AIAuditEventType.WORKSPACE_UPDATED,
          payload: { ...audit, contextVersion: workspace.version, resolutionResult: 'RESOLVED' } as Prisma.InputJsonObject,
        },
      });
      return { version: workspace.version, working: nextWorking };
    });
  }

  buildAuditFromResolution(
    resolution: ReferenceResolutionResult,
    contextVersion: number,
    schemaVersion: string,
  ): ContextAuditPayload {
    if (resolution.kind === 'CLARIFY') {
      return {
        contextSchemaVersion: schemaVersion,
        contextVersion,
        resolutionResult: 'CLARIFY',
        failureType: resolution.failureType,
      };
    }
    return {
      contextSchemaVersion: schemaVersion,
      referenceKind: resolution.referenceKind,
      entityType: resolution.entityType,
      ordinal: resolution.ordinal,
      contextVersion,
      resolutionResult: 'RESOLVED',
      resolvedEntityHash: resolution.resolvedEntityHash,
      contextAgeMs: resolution.contextAgeMs,
    };
  }
}

export function deriveWorkingContextAfterResponse(args: {
  previous: AssistantWorkingContext | null;
  intent: string;
  entities: Record<string, unknown>;
  responseType: string;
  payload: Record<string, unknown>;
  now?: Date;
}): AssistantWorkingContext | null {
  const now = args.now ?? new Date();
  let working = args.previous;

  if (args.responseType === 'ENTITY_LIST' || args.responseType === 'ENTITY_PICKER') {
    const presented = extractPresentedCandidatesFromEntityList({
      intent: args.intent,
      data: args.payload.data,
      entityType: args.payload.entityType,
    });
    if (presented) {
      working = applyPresentedCandidates(working, presented, {
        lastIntent: args.intent as never,
        lastResponseType: args.responseType,
        now,
      });
    }
  }

  const clientId = typeof args.entities.clientId === 'string' ? args.entities.clientId : null;
  if (clientId && (args.intent === 'GET_CLIENT_ACCOUNTS' || args.intent === 'SEARCH_CLIENT')) {
    const label =
      (typeof args.entities.clientLabel === 'string' && args.entities.clientLabel) ||
      (working?.lastPresentedCandidates?.candidates.find((c) => c.id === clientId)?.label) ||
      'Cliente';
    working = applySelectedEntity(working, { type: 'CLIENT', id: clientId, label }, now);
  }

  const customerId = typeof args.entities.customerId === 'string' ? args.entities.customerId : null;
  if (customerId && args.intent === 'REGISTER_RECEIVABLE_PAYMENT') {
    const label =
      (typeof args.entities.customerName === 'string' && args.entities.customerName) ||
      (working?.lastPresentedCandidates?.candidates.find((c) => c.id === customerId)?.label) ||
      'Cliente';
    working = applySelectedEntity(working, { type: 'CLIENT', id: customerId, label }, now);
  }

  const watchId = typeof args.entities.watchId === 'string' ? args.entities.watchId : null;
  if (watchId && (args.intent === 'SEARCH_INVENTORY' || args.intent === 'REGISTER_SALE' || args.intent === 'REGISTER_PURCHASE')) {
    const label =
      (typeof args.entities.watchLabel === 'string' && args.entities.watchLabel) ||
      (working?.lastPresentedCandidates?.candidates.find((c) => c.id === watchId)?.label) ||
      'Reloj';
    working = applySelectedEntity(working, { type: 'WATCH', id: watchId, label }, now);
  }

  const accountId =
    (typeof args.entities.accountId === 'string' && args.entities.accountId) ||
    (typeof args.entities.accountEntryId === 'string' && args.entities.accountEntryId) ||
    null;
  if (accountId && args.intent === 'REGISTER_RECEIVABLE_PAYMENT') {
    const label =
      (typeof args.entities.receivableLabel === 'string' && args.entities.receivableLabel) ||
      (typeof args.entities.accountLabel === 'string' && args.entities.accountLabel) ||
      (working?.lastPresentedCandidates?.candidates.find((c) => c.id === accountId)?.label) ||
      'Cuenta';
    working = applySelectedEntity(working, { type: 'ACCOUNT_ENTRY', id: accountId, label }, now);
  }

  if (!working) return null;
  return {
    ...working,
    lastIntent: (args.intent as AssistantWorkingContext['lastIntent']) ?? working.lastIntent,
    lastResponseType: args.responseType,
    contextUpdatedAt: now.toISOString(),
  };
}
