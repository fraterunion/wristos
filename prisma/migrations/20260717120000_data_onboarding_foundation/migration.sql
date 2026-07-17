-- CreateEnum
CREATE TYPE "DataImportStatus" AS ENUM ('CREATED', 'UPLOADING', 'PROCESSING', 'READY_FOR_REVIEW', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "DataImportFileStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PARSED', 'FAILED');
CREATE TYPE "DataImportFileType" AS ENUM ('PDF', 'XLSX', 'CSV', 'JSON');
CREATE TYPE "DataImportEntityType" AS ENUM ('INVENTORY', 'CLIENTS', 'DEALS', 'PAYMENTS', 'EXPENSES', 'ACCOUNTS', 'TREASURY', 'INVESTORS', 'RADAR', 'UNKNOWN');
CREATE TYPE "DataImportRecordStatus" AS ENUM ('STAGED', 'SELECTED', 'SKIPPED', 'IMPORTED', 'FAILED');
CREATE TYPE "DataImportDuplicateStatus" AS ENUM ('NONE', 'POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE');
CREATE TYPE "DataImportEventType" AS ENUM ('SESSION_CREATED', 'FILE_UPLOADED', 'FILE_PROCESSING', 'FILE_PARSED', 'FILE_FAILED', 'PROCESSING_STARTED', 'PROCESSING_COMPLETED', 'SESSION_FAILED', 'SESSION_CANCELLED');

-- CreateTable
CREATE TABLE "data_import_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" "DataImportStatus" NOT NULL DEFAULT 'CREATED',
    "title" TEXT,
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_files" INTEGER NOT NULL DEFAULT 0,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_import_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_import_files" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_type" "DataImportFileType" NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" TEXT,
    "status" "DataImportFileStatus" NOT NULL DEFAULT 'UPLOADED',
    "detected_entity_type" "DataImportEntityType" NOT NULL DEFAULT 'UNKNOWN',
    "sheet_names" JSONB,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "classification_meta" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_import_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_import_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "entity_type" "DataImportEntityType" NOT NULL DEFAULT 'UNKNOWN',
    "source_sheet" TEXT,
    "source_row_number" INTEGER,
    "raw_data" JSONB NOT NULL,
    "normalized_data" JSONB,
    "validation_errors" JSONB,
    "validation_warnings" JSONB,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    "duplicate_key" TEXT,
    "duplicate_status" "DataImportDuplicateStatus" NOT NULL DEFAULT 'NONE',
    "import_status" "DataImportRecordStatus" NOT NULL DEFAULT 'STAGED',
    "target_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_import_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_import_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_type" "DataImportEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_import_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "data_import_sessions_tenant_id_idx" ON "data_import_sessions"("tenant_id");
CREATE INDEX "data_import_sessions_tenant_id_status_idx" ON "data_import_sessions"("tenant_id", "status");
CREATE INDEX "data_import_sessions_tenant_id_created_at_idx" ON "data_import_sessions"("tenant_id", "created_at");

CREATE INDEX "data_import_files_tenant_id_idx" ON "data_import_files"("tenant_id");
CREATE INDEX "data_import_files_session_id_idx" ON "data_import_files"("session_id");
CREATE INDEX "data_import_files_tenant_id_session_id_idx" ON "data_import_files"("tenant_id", "session_id");
CREATE INDEX "data_import_files_status_idx" ON "data_import_files"("status");

CREATE INDEX "data_import_records_tenant_id_idx" ON "data_import_records"("tenant_id");
CREATE INDEX "data_import_records_session_id_idx" ON "data_import_records"("session_id");
CREATE INDEX "data_import_records_file_id_idx" ON "data_import_records"("file_id");
CREATE INDEX "data_import_records_tenant_id_session_id_idx" ON "data_import_records"("tenant_id", "session_id");
CREATE INDEX "data_import_records_entity_type_idx" ON "data_import_records"("entity_type");
CREATE INDEX "data_import_records_tenant_id_entity_type_idx" ON "data_import_records"("tenant_id", "entity_type");
CREATE INDEX "data_import_records_import_status_idx" ON "data_import_records"("import_status");

CREATE INDEX "data_import_events_tenant_id_idx" ON "data_import_events"("tenant_id");
CREATE INDEX "data_import_events_session_id_idx" ON "data_import_events"("session_id");
CREATE INDEX "data_import_events_tenant_id_session_id_idx" ON "data_import_events"("tenant_id", "session_id");
CREATE INDEX "data_import_events_tenant_id_created_at_idx" ON "data_import_events"("tenant_id", "created_at");

-- Foreign keys (no cascade into Tenant or User)
ALTER TABLE "data_import_sessions" ADD CONSTRAINT "data_import_sessions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_import_sessions" ADD CONSTRAINT "data_import_sessions_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "data_import_files" ADD CONSTRAINT "data_import_files_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_import_files" ADD CONSTRAINT "data_import_files_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "data_import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_import_records" ADD CONSTRAINT "data_import_records_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_import_records" ADD CONSTRAINT "data_import_records_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "data_import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_import_records" ADD CONSTRAINT "data_import_records_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "data_import_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_import_events" ADD CONSTRAINT "data_import_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_import_events" ADD CONSTRAINT "data_import_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "data_import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
