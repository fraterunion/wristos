-- CreateTable
CREATE TABLE "wrist_caviar_one_time_import_maps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "migration_source" TEXT NOT NULL,
    "workbook_fingerprint" TEXT NOT NULL,
    "package_fingerprint" TEXT NOT NULL,
    "source_candidate_id" TEXT NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "destination_entity_type" TEXT NOT NULL,
    "destination_id" TEXT NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wrist_caviar_one_time_import_maps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wrist_caviar_one_time_import_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "migration_source" TEXT NOT NULL,
    "workbook_fingerprint" TEXT NOT NULL,
    "package_fingerprint" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planned_counts" JSONB NOT NULL,
    "result_counts" JSONB,
    "backup_verified" BOOLEAN NOT NULL DEFAULT false,
    "backup_note" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    CONSTRAINT "wrist_caviar_one_time_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wrist_caviar_one_time_import_maps_tenant_id_migration_source_package_fingerprint_destination_entity_type_source_candidate_id_key" ON "wrist_caviar_one_time_import_maps"("tenant_id", "migration_source", "package_fingerprint", "destination_entity_type", "source_candidate_id");
CREATE INDEX "wrist_caviar_one_time_import_maps_tenant_id_destination_entity_type_destination_id_idx" ON "wrist_caviar_one_time_import_maps"("tenant_id", "destination_entity_type", "destination_id");
CREATE INDEX "wrist_caviar_one_time_import_maps_tenant_id_import_run_id_idx" ON "wrist_caviar_one_time_import_maps"("tenant_id", "import_run_id");
CREATE INDEX "wrist_caviar_one_time_import_runs_tenant_id_package_fingerprint_idx" ON "wrist_caviar_one_time_import_runs"("tenant_id", "package_fingerprint");
