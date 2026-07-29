-- CreateEnum
CREATE TYPE "WristCaviarMigrationReadiness" AS ENUM ('READY_FOR_DRY_RUN', 'NEEDS_REVIEW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "WristCaviarMigrationAnalysisStatus" AS ENUM ('ANALYZING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "wrist_caviar_migration_analyses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" "WristCaviarMigrationAnalysisStatus" NOT NULL DEFAULT 'ANALYZING',
    "readiness" "WristCaviarMigrationReadiness" NOT NULL,
    "parser_version" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "fingerprint_prefix" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "duration_ms" INTEGER,
    "sheet_summaries" JSONB NOT NULL,
    "normalized_counts" JSONB NOT NULL,
    "issue_summary" JSONB NOT NULL,
    "reconciliation_summary" JSONB NOT NULL,
    "private_snapshot" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wrist_caviar_migration_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wrist_caviar_migration_sheets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detected_records" INTEGER NOT NULL,
    "warning_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "manual_review_count" INTEGER NOT NULL,
    "notes" JSONB,

    CONSTRAINT "wrist_caviar_migration_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wrist_caviar_migration_issues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT,
    "message" TEXT NOT NULL,
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "source_block_id" TEXT,

    CONSTRAINT "wrist_caviar_migration_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wrist_caviar_migration_analyses_tenant_id_idx" ON "wrist_caviar_migration_analyses"("tenant_id");
CREATE INDEX "wrist_caviar_migration_analyses_tenant_id_created_at_idx" ON "wrist_caviar_migration_analyses"("tenant_id", "created_at");
CREATE INDEX "wrist_caviar_migration_analyses_tenant_id_readiness_idx" ON "wrist_caviar_migration_analyses"("tenant_id", "readiness");
CREATE INDEX "wrist_caviar_migration_sheets_tenant_id_idx" ON "wrist_caviar_migration_sheets"("tenant_id");
CREATE INDEX "wrist_caviar_migration_sheets_analysis_id_idx" ON "wrist_caviar_migration_sheets"("analysis_id");
CREATE INDEX "wrist_caviar_migration_issues_tenant_id_idx" ON "wrist_caviar_migration_issues"("tenant_id");
CREATE INDEX "wrist_caviar_migration_issues_analysis_id_idx" ON "wrist_caviar_migration_issues"("analysis_id");
CREATE INDEX "wrist_caviar_migration_issues_analysis_id_severity_idx" ON "wrist_caviar_migration_issues"("analysis_id", "severity");

-- AddForeignKey
ALTER TABLE "wrist_caviar_migration_analyses" ADD CONSTRAINT "wrist_caviar_migration_analyses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_analyses" ADD CONSTRAINT "wrist_caviar_migration_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_sheets" ADD CONSTRAINT "wrist_caviar_migration_sheets_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "wrist_caviar_migration_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wrist_caviar_migration_issues" ADD CONSTRAINT "wrist_caviar_migration_issues_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "wrist_caviar_migration_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
