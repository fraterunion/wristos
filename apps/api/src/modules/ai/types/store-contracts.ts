import { AIAuditEventType, AIConversationSurface, AIInteractionState, AIMessageRole, Prisma } from '@prisma/client';

export const CONVERSATION_STORE = Symbol('ConversationStore');
export const RUNTIME_STORE = Symbol('RuntimeStore');
export const AUDIT_STORE = Symbol('AuditStore');
export const WORKSPACE_STORE = Symbol('WorkspaceStore');

export interface ConversationStore {
  create(tenantId: string, userId: string, data: { title?: string; surface: AIConversationSurface }): Promise<unknown>;
  findOne(tenantId: string, id: string): Promise<unknown>;
  appendMessage(tenantId: string, userId: string, data: { conversationId: string; role: AIMessageRole; content: string; structuredPayload?: Prisma.InputJsonValue; metadata?: Prisma.InputJsonValue; tokenCount?: number }): Promise<unknown>;
  softDelete(tenantId: string, userId: string, id: string): Promise<unknown>;
}

export interface RuntimeStore {
  create(tenantId: string, userId: string, data: { conversationId: string; intent: string; proposedPlan: Prisma.InputJsonValue; normalizedArguments: Prisma.InputJsonValue; resolvedEntities?: Prisma.InputJsonValue; warnings?: Prisma.InputJsonValue; requiresConfirmation?: boolean }): Promise<unknown>;
  findOne(tenantId: string, id: string): Promise<unknown>;
  confirm(tenantId: string, userId: string, id: string, expectedFingerprint: string): Promise<unknown>;
  cancel(tenantId: string, userId: string, id: string): Promise<unknown>;
}

export interface WorkspaceStore {
  create(tenantId: string, userId: string, data: { surface: AIConversationSurface; conversationId?: string; activeActionRunId?: string; interactionState?: AIInteractionState }): Promise<unknown>;
  resume(tenantId: string, userId: string, id: string): Promise<unknown>;
  update(tenantId: string, userId: string, id: string, data: { expectedVersion: number }): Promise<unknown>;
  reset(tenantId: string, userId: string, id: string, expectedVersion: number): Promise<unknown>;
  softDelete(tenantId: string, userId: string, id: string, expectedVersion: number): Promise<unknown>;
}

export interface AuditStore {
  append(data: { tenantId: string; actorUserId: string; type: AIAuditEventType; conversationId?: string; actionRunId?: string; payload?: Prisma.InputJsonValue }): Promise<unknown>;
}

export interface PlannerRuntime { createPlan(...args: never[]): Promise<unknown>; }
export interface ConfirmationRuntime {
  confirm(tenantId: string, userId: string, actionRunId: string, expectedFingerprint: string): Promise<unknown>;
  cancel(tenantId: string, userId: string, actionRunId: string): Promise<unknown>;
}
