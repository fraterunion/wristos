import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { AIAuditEventType, AIConversationSurface, AIInteractionState, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AssistantWorkingContext,
  applyPresentedCandidates,
  applySelectedEntity,
  emptyWorkingContext,
  extractPresentedCandidatesFromEntityList,
  hashEntityId,
  parseResolvedContextShell,
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

  /**
   * Persist a pre-orchestrator conversational clarification (policy CLARIFY /
   * cancel) onto AIWorkspace so the next NL turn can continue deterministically.
   * failUnattached alone does not update working context.
   */
  async persistClarificationTurn(args: {
    tenantId: string;
    userId: string;
    surface: AIConversationSurface;
    conversationId?: string;
    workspaceId?: string;
    requestId: string;
    intent: string;
    entities: Record<string, string | number | boolean>;
    response: {
      interactionState: string;
      responseType: string;
      payload: Record<string, unknown>;
      conversationId?: string;
      workspaceId?: string;
    };
    mode: 'MISSING_FIELDS' | 'CLEAR';
  }): Promise<{ conversationId: string; workspaceId: string; version: number }> {
    return this.prisma.$transaction(async (tx) => {
      let conversation = args.conversationId
        ? await tx.aIConversation.findFirst({
            where: {
              id: args.conversationId,
              tenantId: args.tenantId,
              userId: args.userId,
              deletedAt: null,
            },
          })
        : null;
      if (args.conversationId && !conversation) {
        throw new NotFoundException('AI conversation not found');
      }

      let workspace = args.workspaceId
        ? await tx.aIWorkspace.findFirst({
            where: {
              id: args.workspaceId,
              tenantId: args.tenantId,
              userId: args.userId,
              deletedAt: null,
            },
          })
        : null;
      if (args.workspaceId && !workspace) {
        throw new NotFoundException('AI workspace not found');
      }

      if (conversation && workspace?.conversationId && workspace.conversationId !== conversation.id) {
        throw new ConflictException('AI workspace belongs to another conversation');
      }
      if (!conversation && workspace?.conversationId) {
        conversation = await tx.aIConversation.findFirst({
          where: {
            id: workspace.conversationId,
            tenantId: args.tenantId,
            userId: args.userId,
            deletedAt: null,
          },
        });
        if (!conversation) throw new NotFoundException('AI conversation not found');
      }
      if (!conversation) {
        conversation = await tx.aIConversation.create({
          data: {
            tenantId: args.tenantId,
            userId: args.userId,
            surface: args.surface,
          },
        });
        await tx.aIAuditEvent.create({
          data: {
            tenantId: args.tenantId,
            actorUserId: args.userId,
            conversationId: conversation.id,
            type: AIAuditEventType.CONVERSATION_CREATED,
          },
        });
      }
      if (!workspace) {
        workspace = await tx.aIWorkspace.create({
          data: {
            tenantId: args.tenantId,
            userId: args.userId,
            conversationId: conversation.id,
            surface: args.surface,
          },
        });
        await tx.aIAuditEvent.create({
          data: {
            tenantId: args.tenantId,
            actorUserId: args.userId,
            conversationId: conversation.id,
            workspaceId: workspace.id,
            type: AIAuditEventType.WORKSPACE_CREATED,
            payload: { version: workspace.version },
          },
        });
      } else if (!workspace.conversationId) {
        const linked = await tx.aIWorkspace.updateMany({
          where: { id: workspace.id, version: workspace.version, deletedAt: null },
          data: {
            conversationId: conversation.id,
            version: { increment: 1 },
            lastActivityAt: new Date(),
          },
        });
        if (linked.count !== 1) throw new ConflictException('AI workspace version is stale');
        workspace = await tx.aIWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });
      }

      const previous = readWorkingContext(workspace.resolvedContext);
      let nextWorking: AssistantWorkingContext | null;
      if (args.mode === 'CLEAR') {
        const base = previous ?? emptyWorkingContext();
        const { pendingMissingFields: _drop, pendingActionRunId: _drop2, ...rest } = base;
        nextWorking = {
          ...rest,
          lastIntent: args.intent as AssistantWorkingContext['lastIntent'],
          lastResponseType: args.response.responseType,
          contextUpdatedAt: new Date().toISOString(),
        };
      } else {
        nextWorking = deriveWorkingContextAfterResponse({
          previous,
          intent: args.intent,
          entities: args.entities,
          responseType: args.response.responseType,
          payload: args.response.payload,
        });
      }
      if (!nextWorking) {
        nextWorking = emptyWorkingContext();
      }

      const nextResolved: Record<string, unknown> = {
        ...writeWorkingContext(workspace.resolvedContext, nextWorking),
      };
      if (args.mode === 'MISSING_FIELDS') {
        nextResolved.pendingClarificationEntities = args.entities;
      } else {
        delete nextResolved.pendingClarificationEntities;
      }

      const changed = await tx.aIWorkspace.updateMany({
        where: {
          id: workspace.id,
          tenantId: args.tenantId,
          userId: args.userId,
          version: workspace.version,
          deletedAt: null,
        },
        data: {
          conversationId: conversation.id,
          interactionState:
            args.mode === 'MISSING_FIELDS'
              ? AIInteractionState.COLLECTING_INPUT
              : AIInteractionState.IDLE,
          resolvedContext: nextResolved as Prisma.InputJsonObject,
          pendingResponse:
            args.mode === 'MISSING_FIELDS'
              ? ({
                  ...args.response,
                  conversationId: conversation.id,
                  workspaceId: workspace.id,
                } as unknown as Prisma.InputJsonObject)
              : Prisma.DbNull,
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new ConflictException('AI workspace version is stale');
      const updated = await tx.aIWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });

      await tx.aIRequest.update({
        where: { id: args.requestId },
        data: { conversationId: conversation.id, workspaceId: workspace.id },
      });
      await tx.aIConversation.update({
        where: { id: conversation.id },
        data: { lastActivityAt: new Date() },
      });
      await tx.aIAuditEvent.create({
        data: {
          tenantId: args.tenantId,
          actorUserId: args.userId,
          conversationId: conversation.id,
          workspaceId: workspace.id,
          type: AIAuditEventType.WORKSPACE_UPDATED,
          payload: {
            previousVersion: workspace.version,
            version: updated.version,
            contextSchemaVersion: '1.1',
            resolutionResult: args.mode === 'CLEAR' ? 'CLEARED' : 'CLARIFY',
          } as Prisma.InputJsonObject,
        },
      });

      return {
        conversationId: conversation.id,
        workspaceId: workspace.id,
        version: updated.version,
      };
    });
  }

  readPendingClarificationEntities(resolvedContextRaw: unknown): Record<string, string | number | boolean> {
    const shell = parseResolvedContextShell(resolvedContextRaw);
    const raw = (shell as { pendingClarificationEntities?: unknown }).pendingClarificationEntities;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (entry): entry is [string, string | number | boolean] =>
          typeof entry[1] === 'string' || typeof entry[1] === 'boolean' || typeof entry[1] === 'number',
      ),
    );
  }

  /**
   * Persist a field-lock entity picker (WATCH/CLIENT/…) so ordinal follow-ups
   * stay on the pending write intent without unrestricted NLP.
   */
  async persistEntityPickerTurn(args: {
    tenantId: string;
    userId: string;
    surface: AIConversationSurface;
    conversationId?: string;
    workspaceId?: string;
    requestId: string;
    intent: string;
    entities: Record<string, string | number | boolean>;
    response: {
      interactionState: string;
      responseType: string;
      payload: Record<string, unknown>;
    };
  }): Promise<{ conversationId: string; workspaceId: string; version: number }> {
    return this.persistClarificationTurn({
      ...args,
      mode: 'MISSING_FIELDS',
      response: {
        interactionState: args.response.interactionState,
        responseType: 'ENTITY_PICKER',
        payload: args.response.payload,
      },
    });
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
    const clarificationField =
      typeof args.payload.clarificationField === 'string' ? args.payload.clarificationField : null;
    if (clarificationField) {
      working = {
        ...(working ?? emptyWorkingContext(now)),
        lastIntent: (args.intent as AssistantWorkingContext['lastIntent']) ?? working?.lastIntent,
        lastResponseType: args.responseType,
        pendingMissingFields: [clarificationField],
        contextUpdatedAt: now.toISOString(),
      };
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

  // After CREATE_CLIENT: prefer trusted client selection for multi-turn (created or reused).
  if (args.intent === 'CREATE_CLIENT') {
    if (args.responseType === 'SUCCESS_RECEIPT') {
      const receipt =
        args.payload.receipt && typeof args.payload.receipt === 'object'
          ? (args.payload.receipt as Record<string, unknown>)
          : null;
      const createdId = typeof receipt?.clientId === 'string' ? receipt.clientId : null;
      const createdName = typeof receipt?.name === 'string' ? receipt.name : 'Cliente';
      if (createdId) {
        working = applySelectedEntity(working, { type: 'CLIENT', id: createdId, label: createdName }, now);
      }
    } else {
      const existingId =
        (typeof args.entities.useExistingClientId === 'string' && args.entities.useExistingClientId) ||
        (typeof args.entities.clientId === 'string' && args.entities.clientId) ||
        null;
      if (existingId && !existingId.startsWith('__CREATE_NEW_CLIENT__')) {
        const label =
          (typeof args.entities.clientLabel === 'string' && args.entities.clientLabel) ||
          (typeof args.entities.name === 'string' && args.entities.name) ||
          'Cliente';
        working = applySelectedEntity(working, { type: 'CLIENT', id: existingId, label }, now);
      }
    }
  }

  // After UPDATE_CLIENT: keep / refresh trusted selected Client (safe label only).
  if (args.intent === 'UPDATE_CLIENT') {
    if (args.responseType === 'SUCCESS_RECEIPT') {
      const receipt =
        args.payload.receipt && typeof args.payload.receipt === 'object'
          ? (args.payload.receipt as Record<string, unknown>)
          : null;
      const updatedId = typeof receipt?.clientId === 'string' ? receipt.clientId : null;
      const updatedName = typeof receipt?.name === 'string' ? receipt.name : 'Cliente';
      if (updatedId) {
        working = applySelectedEntity(working, { type: 'CLIENT', id: updatedId, label: updatedName }, now);
      }
    } else {
      const selectedId =
        (typeof args.entities.selectedClientId === 'string' && args.entities.selectedClientId) ||
        (typeof args.entities.clientId === 'string' && args.entities.clientId) ||
        null;
      if (selectedId) {
        const label =
          (typeof args.entities.clientLabel === 'string' && args.entities.clientLabel) || 'Cliente';
        working = applySelectedEntity(working, { type: 'CLIENT', id: selectedId, label }, now);
      }
    }
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

  // After CREATE_RECEIVABLE / CREATE_PAYABLE: select the new AccountEntry so follow-up
  // payment intents can reuse trusted accountEntryId ("Cóbrale 50 mil a esa cuenta").
  if (
    (args.intent === 'CREATE_RECEIVABLE' || args.intent === 'CREATE_PAYABLE') &&
    args.responseType === 'SUCCESS_RECEIPT'
  ) {
    const receipt =
      args.payload.receipt && typeof args.payload.receipt === 'object'
        ? (args.payload.receipt as Record<string, unknown>)
        : null;
    const createdAccountId =
      typeof receipt?.accountEntryId === 'string' ? receipt.accountEntryId : null;
    if (createdAccountId) {
      const label =
        (typeof receipt?.counterpartyLabel === 'string' && receipt.counterpartyLabel) ||
        (args.intent === 'CREATE_RECEIVABLE' ? 'Cuenta por cobrar' : 'Cuenta por pagar');
      working = applySelectedEntity(
        working,
        { type: 'ACCOUNT_ENTRY', id: createdAccountId, label },
        now,
      );
    }
  }

  if (accountId && args.intent === 'REGISTER_PAYABLE_PAYMENT') {
    const label =
      (typeof args.entities.payableLabel === 'string' && args.entities.payableLabel) ||
      (typeof args.entities.accountLabel === 'string' && args.entities.accountLabel) ||
      (working?.lastPresentedCandidates?.candidates.find((c) => c.id === accountId)?.label) ||
      'Cuenta';
    working = applySelectedEntity(working, { type: 'ACCOUNT_ENTRY', id: accountId, label }, now);
  }

  if (!working) {
    if (args.responseType !== 'MISSING_FIELDS_CARD' && args.responseType !== 'ENTITY_LIST' && args.responseType !== 'ENTITY_PICKER') {
      return null;
    }
    working = emptyWorkingContext(now);
  }

  if (args.responseType === 'MISSING_FIELDS_CARD') {
    const clarificationField =
      typeof args.payload.clarificationField === 'string' ? args.payload.clarificationField : null;
    const groups = Array.isArray(args.payload.groups) ? args.payload.groups : [];
    const firstKey =
      clarificationField ||
      (() => {
        for (const group of groups) {
          if (!group || typeof group !== 'object') continue;
          const fields = (group as { fields?: unknown }).fields;
          if (!Array.isArray(fields) || !fields[0] || typeof fields[0] !== 'object') continue;
          const key = (fields[0] as { key?: unknown }).key;
          if (typeof key === 'string' && key) return key;
        }
        return null;
      })();
    return {
      ...working,
      lastIntent: (args.intent as AssistantWorkingContext['lastIntent']) ?? working.lastIntent,
      lastResponseType: args.responseType,
      pendingMissingFields: firstKey ? [firstKey] : working.pendingMissingFields,
      contextUpdatedAt: now.toISOString(),
    };
  }

  // Successful progression clears pending clarification slots.
  if (
    args.responseType === 'ACTION_PREVIEW_CARD' ||
    args.responseType === 'SUCCESS_RECEIPT' ||
    args.responseType === 'ERROR_RECOVERY_CARD'
  ) {
    const { pendingMissingFields: _drop, pendingActionRunId: _drop2, ...rest } = working;
    return {
      ...rest,
      lastIntent: (args.intent as AssistantWorkingContext['lastIntent']) ?? working.lastIntent,
      lastResponseType: args.responseType,
      contextUpdatedAt: now.toISOString(),
    };
  }

  return {
    ...working,
    lastIntent: (args.intent as AssistantWorkingContext['lastIntent']) ?? working.lastIntent,
    lastResponseType: args.responseType,
    contextUpdatedAt: now.toISOString(),
  };
}
