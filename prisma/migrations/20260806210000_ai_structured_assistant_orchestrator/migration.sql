CREATE TYPE "AIRequestStatus" AS ENUM (
  'RECEIVED',
  'VALIDATING',
  'PLANNING',
  'NEEDS_CLARIFICATION',
  'READY_FOR_CONFIRMATION',
  'EXECUTING',
  'COMPLETED',
  'FAILED'
);

ALTER TYPE "AIAuditEventType" ADD VALUE 'ASSISTANT_REQUEST_RECEIVED';
ALTER TYPE "AIAuditEventType" ADD VALUE 'ASSISTANT_REQUEST_STARTED';
ALTER TYPE "AIAuditEventType" ADD VALUE 'ASSISTANT_REQUEST_REPLAYED';
ALTER TYPE "AIAuditEventType" ADD VALUE 'ASSISTANT_REQUEST_CONFLICTED';
ALTER TYPE "AIAuditEventType" ADD VALUE 'ASSISTANT_REQUEST_COMPLETED';
ALTER TYPE "AIAuditEventType" ADD VALUE 'ASSISTANT_REQUEST_FAILED';

CREATE TABLE "ai_requests" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "conversationId" TEXT,
  "workspaceId" TEXT,
  "actionRunId" TEXT,
  "clientRequestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "status" "AIRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "requestPayload" JSONB NOT NULL,
  "responsePayload" JSONB,
  "responseHash" TEXT,
  "traceId" TEXT NOT NULL,
  "errorType" TEXT,
  "failureSummary" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_requests_tenantId_actorUserId_clientRequestId_key"
  ON "ai_requests"("tenantId", "actorUserId", "clientRequestId");
CREATE INDEX "ai_requests_tenantId_actorUserId_createdAt_idx"
  ON "ai_requests"("tenantId", "actorUserId", "createdAt");
CREATE INDEX "ai_requests_conversationId_idx" ON "ai_requests"("conversationId");
CREATE INDEX "ai_requests_workspaceId_idx" ON "ai_requests"("workspaceId");
CREATE INDEX "ai_requests_actionRunId_idx" ON "ai_requests"("actionRunId");
CREATE INDEX "ai_requests_status_idx" ON "ai_requests"("status");
CREATE INDEX "ai_requests_requestFingerprint_idx" ON "ai_requests"("requestFingerprint");

ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "ai_workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_actionRunId_fkey"
  FOREIGN KEY ("actionRunId") REFERENCES "ai_action_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
