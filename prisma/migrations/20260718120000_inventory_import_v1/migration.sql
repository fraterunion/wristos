-- Add inventory import V1 fields to data_import_sessions
ALTER TABLE "data_import_sessions"
  ADD COLUMN "warning_rows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dry_run_version" TEXT,
  ADD COLUMN "import_started_at" TIMESTAMP(3);

-- Add mapping storage to data_import_files
ALTER TABLE "data_import_files"
  ADD COLUMN "field_mapping" JSONB,
  ADD COLUMN "mapping_version" TEXT;

-- Add new event types to DataImportEventType enum
ALTER TYPE "DataImportEventType" ADD VALUE 'MAPPING_SAVED';
ALTER TYPE "DataImportEventType" ADD VALUE 'DRY_RUN_COMPLETED';
ALTER TYPE "DataImportEventType" ADD VALUE 'IMPORT_STARTED';
ALTER TYPE "DataImportEventType" ADD VALUE 'IMPORT_COMPLETED';
ALTER TYPE "DataImportEventType" ADD VALUE 'IMPORT_FAILED';
