-- CreateEnum
CREATE TYPE "WristCaviarDryRunStatus" AS ENUM ('GENERATING', 'COMPLETED', 'COMPLETED_WITH_CONFLICTS', 'FAILED', 'INVALIDATED', 'STALE');
CREATE TYPE "WristCaviarDryRunAction" AS ENUM ('CREATE', 'LINK', 'SKIP', 'CONFLICT', 'DEFERRED');
CREATE TYPE "WristCaviarDryRunPlanReadiness" AS ENUM ('READY_FOR_APPROVAL', 'NEEDS_CONFLICT_RESOLUTION', 'STALE', 'FAILED');

-- CreateTable
CREATE TABLE "wrist_caviar_migration_dry_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "dataset_fingerprint" TEXT NOT NULL,
    "status" "WristCaviarDryRunStatus" NOT NULL DEFAULT 'GENERATING',
    "plan_readiness" "WristCaviarDryRunPlanReadiness",
    "planner_version" TEXT NOT NULL,
    "plan_fingerprint" TEXT,
    "plan_fingerprint_prefix" TEXT,
    "destination_state_fingerprint" TEXT,
    "destination_state_by_group" JSONB,
    "source_counts" JSONB NOT NULL,
    "action_counts" JSONB NOT NULL,
    "conflict_counts" JSONB NOT NULL,
    "financial_summary" JSONB,
    "reconciliation_summary" JSONB,
    "dependency_summary" JSONB,
    "progress_phase" TEXT,
    "error_message" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "invalidation_reason" TEXT,
    "duration_ms" INTEGER,
    CONSTRAINT "wrist_caviar_migration_dry_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wrist_caviar_migration_dry_run_items" (
    "id" TEXT NOT NULL,
    "dry_run_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_group" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "source_candidate_id" TEXT NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "action" "WristCaviarDryRunAction" NOT NULL,
    "confidence" TEXT,
    "destination_id" TEXT,
    "dependency_keys" JSONB,
    "planned_payload" JSONB,
    "comparison_snapshot" JSONB,
    "conflict_code" TEXT,
    "conflict_details" JSONB,
    "provenance" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wrist_caviar_migration_dry_run_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wrist_caviar_migration_destination_maps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "source_candidate_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "dry_run_id" TEXT,
    "commit_id" TEXT,
    "imported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wrist_caviar_migration_destination_maps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wrist_caviar_migration_dry_runs_tenant_id_dataset_id_idx" ON "wrist_caviar_migration_dry_runs"("tenant_id", "dataset_id");
CREATE INDEX "wrist_caviar_migration_dry_runs_tenant_id_created_at_idx" ON "wrist_caviar_migration_dry_runs"("tenant_id", "created_at");
CREATE INDEX "wrist_caviar_migration_dry_runs_dataset_id_status_idx" ON "wrist_caviar_migration_dry_runs"("dataset_id", "status");

CREATE UNIQUE INDEX "wrist_caviar_migration_dry_run_items_dry_run_id_entity_type_source_candidate_id_key" ON "wrist_caviar_migration_dry_run_items"("dry_run_id", "entity_type", "source_candidate_id");
CREATE INDEX "wrist_caviar_migration_dry_run_items_dry_run_id_action_idx" ON "wrist_caviar_migration_dry_run_items"("dry_run_id", "action");
CREATE INDEX "wrist_caviar_migration_dry_run_items_tenant_id_entity_group_idx" ON "wrist_caviar_migration_dry_run_items"("tenant_id", "entity_group");
CREATE INDEX "wrist_caviar_migration_dry_run_items_dry_run_id_sequence_idx" ON "wrist_caviar_migration_dry_run_items"("dry_run_id", "sequence");

CREATE UNIQUE INDEX "wrist_caviar_migration_destination_maps_tenant_id_dataset_id_entity_type_source_candidate_id_key" ON "wrist_caviar_migration_destination_maps"("tenant_id", "dataset_id", "entity_type", "source_candidate_id");
CREATE INDEX "wrist_caviar_migration_destination_maps_tenant_id_entity_type_destination_id_idx" ON "wrist_caviar_migration_destination_maps"("tenant_id", "entity_type", "destination_id");

ALTER TABLE "wrist_caviar_migration_dry_runs" ADD CONSTRAINT "wrist_caviar_migration_dry_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_dry_runs" ADD CONSTRAINT "wrist_caviar_migration_dry_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "wrist_caviar_migration_reviewed_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_dry_runs" ADD CONSTRAINT "wrist_caviar_migration_dry_runs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "wrist_caviar_migration_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_dry_runs" ADD CONSTRAINT "wrist_caviar_migration_dry_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_dry_run_items" ADD CONSTRAINT "wrist_caviar_migration_dry_run_items_dry_run_id_fkey" FOREIGN KEY ("dry_run_id") REFERENCES "wrist_caviar_migration_dry_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
