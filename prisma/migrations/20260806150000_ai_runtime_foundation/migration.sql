CREATE TYPE "AIConversationSurface" AS ENUM ('MOBILE', 'DESKTOP', 'API', 'WHATSAPP', 'VOICE');
CREATE TYPE "AIConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AIMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
CREATE TYPE "AIActionRunStatus" AS ENUM ('DRAFT', 'NEEDS_CLARIFICATION', 'READY_FOR_CONFIRMATION', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'STALE');
CREATE TYPE "AIInteractionState" AS ENUM ('IDLE', 'COLLECTING_INPUT', 'AWAITING_CONFIRMATION', 'AWAITING_RESPONSE');
CREATE TYPE "AIAuditEventType" AS ENUM ('CONVERSATION_CREATED', 'CONVERSATION_DELETED', 'MESSAGE_APPENDED', 'PLAN_CREATED', 'PLAN_NEEDS_CLARIFICATION', 'PLAN_READY_FOR_CONFIRMATION', 'PLAN_CONFIRMED', 'EXECUTION_STARTED', 'EXECUTION_COMPLETED', 'EXECUTION_CANCELLED', 'EXECUTION_FAILED', 'PLAN_MARKED_STALE', 'WORKSPACE_CREATED', 'WORKSPACE_UPDATED', 'WORKSPACE_RESET', 'WORKSPACE_DELETED');

CREATE TABLE "ai_conversations" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "title" TEXT, "surface" "AIConversationSurface" NOT NULL,
  "status" "AIConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "role" "AIMessageRole" NOT NULL,
  "content" TEXT NOT NULL, "structuredPayload" JSONB, "metadata" JSONB,
  "tokenCount" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_action_runs" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL, "intent" TEXT NOT NULL,
  "status" "AIActionRunStatus" NOT NULL DEFAULT 'DRAFT', "planFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "proposedPlan" JSONB NOT NULL, "resolvedEntities" JSONB,
  "warnings" JSONB, "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
  "confirmedAt" TIMESTAMP(3), "confirmedByUserId" TEXT, "executedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "error" TEXT, "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_action_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_audit_events" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "conversationId" TEXT, "actionRunId" TEXT, "workspaceId" TEXT, "type" "AIAuditEventType" NOT NULL,
  "payload" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_workspaces" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "conversationId" TEXT, "activeActionRunId" TEXT, "surface" "AIConversationSurface" NOT NULL,
  "interactionState" "AIInteractionState" NOT NULL DEFAULT 'IDLE',
  "draftPayload" JSONB, "resolvedContext" JSONB, "selectedEntities" JSONB, "pendingResponse" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1, "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "ai_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_tenantId_deletedAt_idx" ON "ai_conversations"("tenantId", "deletedAt");
CREATE INDEX "ai_conversations_tenantId_userId_lastActivityAt_idx" ON "ai_conversations"("tenantId", "userId", "lastActivityAt");
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");
CREATE INDEX "ai_action_runs_tenantId_conversationId_idx" ON "ai_action_runs"("tenantId", "conversationId");
CREATE INDEX "ai_action_runs_tenantId_idempotencyKey_idx" ON "ai_action_runs"("tenantId", "idempotencyKey");
CREATE INDEX "ai_action_runs_tenantId_status_idx" ON "ai_action_runs"("tenantId", "status");
CREATE INDEX "ai_action_runs_confirmedByUserId_idx" ON "ai_action_runs"("confirmedByUserId");
CREATE INDEX "ai_audit_events_tenantId_createdAt_idx" ON "ai_audit_events"("tenantId", "createdAt");
CREATE INDEX "ai_audit_events_tenantId_conversationId_createdAt_idx" ON "ai_audit_events"("tenantId", "conversationId", "createdAt");
CREATE INDEX "ai_audit_events_tenantId_actionRunId_createdAt_idx" ON "ai_audit_events"("tenantId", "actionRunId", "createdAt");
CREATE INDEX "ai_audit_events_tenantId_workspaceId_createdAt_idx" ON "ai_audit_events"("tenantId", "workspaceId", "createdAt");
CREATE INDEX "ai_workspaces_tenantId_userId_deletedAt_idx" ON "ai_workspaces"("tenantId", "userId", "deletedAt");
CREATE INDEX "ai_workspaces_tenantId_userId_surface_lastActivityAt_idx" ON "ai_workspaces"("tenantId", "userId", "surface", "lastActivityAt");
CREATE INDEX "ai_workspaces_conversationId_idx" ON "ai_workspaces"("conversationId");
CREATE INDEX "ai_workspaces_activeActionRunId_idx" ON "ai_workspaces"("activeActionRunId");

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_action_runs" ADD CONSTRAINT "ai_action_runs_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_audit_events" ADD CONSTRAINT "ai_audit_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_audit_events" ADD CONSTRAINT "ai_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_audit_events" ADD CONSTRAINT "ai_audit_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_audit_events" ADD CONSTRAINT "ai_audit_events_actionRunId_fkey" FOREIGN KEY ("actionRunId") REFERENCES "ai_action_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_audit_events" ADD CONSTRAINT "ai_audit_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ai_workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_workspaces" ADD CONSTRAINT "ai_workspaces_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_workspaces" ADD CONSTRAINT "ai_workspaces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_workspaces" ADD CONSTRAINT "ai_workspaces_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_workspaces" ADD CONSTRAINT "ai_workspaces_activeActionRunId_fkey" FOREIGN KEY ("activeActionRunId") REFERENCES "ai_action_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These ordinary PostgreSQL triggers are portable (including Neon) and are
-- created after table data during pg_restore's post-data phase, so normal
-- pg_dump/pg_restore workflows can load append-only rows before enforcement.
CREATE FUNCTION wristos_reject_ai_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_messages_append_only" BEFORE UPDATE OR DELETE ON "ai_messages"
FOR EACH ROW EXECUTE FUNCTION wristos_reject_ai_append_only_mutation();
CREATE TRIGGER "ai_audit_events_append_only" BEFORE UPDATE OR DELETE ON "ai_audit_events"
FOR EACH ROW EXECUTE FUNCTION wristos_reject_ai_append_only_mutation();
