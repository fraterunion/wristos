-- AlterTable
ALTER TABLE "wrist_caviar_migration_analyses" ADD COLUMN IF NOT EXISTS "reviewed_snapshot" JSONB;
ALTER TABLE "wrist_caviar_migration_analyses" ADD COLUMN IF NOT EXISTS "review_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable issues
ALTER TABLE "wrist_caviar_migration_issues" ADD COLUMN IF NOT EXISTS "taxonomy_code" TEXT;
ALTER TABLE "wrist_caviar_migration_issues" ADD COLUMN IF NOT EXISTS "entity_type" TEXT;
ALTER TABLE "wrist_caviar_migration_issues" ADD COLUMN IF NOT EXISTS "candidate_id" TEXT;
ALTER TABLE "wrist_caviar_migration_issues" ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'UNRESOLVED';

CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_issues_analysis_id_taxonomy_code_idx" ON "wrist_caviar_migration_issues"("analysis_id", "taxonomy_code");
CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_issues_analysis_id_review_status_idx" ON "wrist_caviar_migration_issues"("analysis_id", "review_status");

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WristCaviarMigrationResolutionType" AS ENUM (
    'ACCEPT_AS_IS', 'CORRECT_VALUE', 'MAP_ENTITY', 'MERGE_EXACT_DUPLICATE', 'KEEP_SEPARATE',
    'EXCLUDE_FROM_MIGRATION', 'DEFER', 'CONFIRM_SCOPE_DIFFERENCE', 'CONFIRM_FORMULA_OVERRIDE',
    'ACKNOWLEDGE_WARNING', 'CHOOSE_CANONICAL_NAME', 'MARK_SERIAL_UNKNOWN', 'CONFIRM_INVENTORY_OVERLAP'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WristCaviarMigrationResolutionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WristCaviarMigrationEntityGroup" AS ENUM (
    'CUSTOMERS', 'INVENTORY', 'SALES', 'RECEIVABLES', 'PAYABLES', 'EXPENSES',
    'CASH_LEDGER', 'BANK_LEDGER', 'PARTNER_LEDGER', 'PROFIT_DISTRIBUTIONS', 'DEFERRED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WristCaviarMigrationEntityApprovalStatus" AS ENUM (
    'NOT_REVIEWED', 'IN_REVIEW', 'APPROVED', 'DEFERRED', 'BLOCKED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "wrist_caviar_migration_resolutions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "issue_id" TEXT,
    "entity_type" TEXT,
    "candidate_id" TEXT,
    "resolution_type" "WristCaviarMigrationResolutionType" NOT NULL,
    "status" "WristCaviarMigrationResolutionStatus" NOT NULL DEFAULT 'ACTIVE',
    "original_value" JSONB,
    "resolved_value" JSONB,
    "reason" TEXT,
    "notes" TEXT,
    "idempotency_key" TEXT,
    "resolved_by_user_id" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wrist_caviar_migration_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wrist_caviar_migration_resolutions_analysis_id_idempotency_key_key"
  ON "wrist_caviar_migration_resolutions"("analysis_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_resolutions_tenant_id_analysis_id_idx"
  ON "wrist_caviar_migration_resolutions"("tenant_id", "analysis_id");
CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_resolutions_analysis_id_issue_id_idx"
  ON "wrist_caviar_migration_resolutions"("analysis_id", "issue_id");
CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_resolutions_analysis_id_status_idx"
  ON "wrist_caviar_migration_resolutions"("analysis_id", "status");

CREATE TABLE IF NOT EXISTS "wrist_caviar_migration_entity_approvals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "entity_group" "WristCaviarMigrationEntityGroup" NOT NULL,
    "status" "WristCaviarMigrationEntityApprovalStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "reason" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "invalidation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wrist_caviar_migration_entity_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wrist_caviar_migration_entity_approvals_analysis_id_entity_group_key"
  ON "wrist_caviar_migration_entity_approvals"("analysis_id", "entity_group");
CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_entity_approvals_tenant_id_analysis_id_idx"
  ON "wrist_caviar_migration_entity_approvals"("tenant_id", "analysis_id");

CREATE TABLE IF NOT EXISTS "wrist_caviar_migration_reviewed_datasets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "fingerprint_prefix" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "source_workbook_fingerprint" TEXT NOT NULL,
    "active_resolution_ids" JSONB NOT NULL,
    "entity_counts" JSONB NOT NULL,
    "reconciliation_summary" JSONB NOT NULL,
    "approval_states" JSONB NOT NULL,
    "readiness" "WristCaviarMigrationReadiness" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "superseded_by_dataset_id" TEXT,
    "frozen_by_user_id" TEXT NOT NULL,
    "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wrist_caviar_migration_reviewed_datasets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_reviewed_datasets_tenant_id_analysis_id_idx"
  ON "wrist_caviar_migration_reviewed_datasets"("tenant_id", "analysis_id");
CREATE INDEX IF NOT EXISTS "wrist_caviar_migration_reviewed_datasets_analysis_id_dataset_version_idx"
  ON "wrist_caviar_migration_reviewed_datasets"("analysis_id", "dataset_version");

ALTER TABLE "wrist_caviar_migration_resolutions"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_resolutions_analysis_id_fkey";
ALTER TABLE "wrist_caviar_migration_resolutions"
  ADD CONSTRAINT "wrist_caviar_migration_resolutions_analysis_id_fkey"
  FOREIGN KEY ("analysis_id") REFERENCES "wrist_caviar_migration_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wrist_caviar_migration_resolutions"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_resolutions_issue_id_fkey";
ALTER TABLE "wrist_caviar_migration_resolutions"
  ADD CONSTRAINT "wrist_caviar_migration_resolutions_issue_id_fkey"
  FOREIGN KEY ("issue_id") REFERENCES "wrist_caviar_migration_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wrist_caviar_migration_resolutions"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_resolutions_resolved_by_user_id_fkey";
ALTER TABLE "wrist_caviar_migration_resolutions"
  ADD CONSTRAINT "wrist_caviar_migration_resolutions_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wrist_caviar_migration_entity_approvals"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_entity_approvals_analysis_id_fkey";
ALTER TABLE "wrist_caviar_migration_entity_approvals"
  ADD CONSTRAINT "wrist_caviar_migration_entity_approvals_analysis_id_fkey"
  FOREIGN KEY ("analysis_id") REFERENCES "wrist_caviar_migration_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wrist_caviar_migration_entity_approvals"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_entity_approvals_approved_by_user_id_fkey";
ALTER TABLE "wrist_caviar_migration_entity_approvals"
  ADD CONSTRAINT "wrist_caviar_migration_entity_approvals_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wrist_caviar_migration_reviewed_datasets"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_reviewed_datasets_analysis_id_fkey";
ALTER TABLE "wrist_caviar_migration_reviewed_datasets"
  ADD CONSTRAINT "wrist_caviar_migration_reviewed_datasets_analysis_id_fkey"
  FOREIGN KEY ("analysis_id") REFERENCES "wrist_caviar_migration_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wrist_caviar_migration_reviewed_datasets"
  DROP CONSTRAINT IF EXISTS "wrist_caviar_migration_reviewed_datasets_frozen_by_user_id_fkey";
ALTER TABLE "wrist_caviar_migration_reviewed_datasets"
  ADD CONSTRAINT "wrist_caviar_migration_reviewed_datasets_frozen_by_user_id_fkey"
  FOREIGN KEY ("frozen_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
