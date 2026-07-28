-- Historical Sales PDF Chunked Extraction V1

DO $$ BEGIN
  CREATE TYPE "DocumentExtractionChunkStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SUPERSEDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "document_extraction_chunks" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "file_id" TEXT NOT NULL,
  "import_target" "DataImportTarget" NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "start_page" INTEGER NOT NULL,
  "end_page" INTEGER NOT NULL,
  "page_count" INTEGER NOT NULL,
  "source_fingerprint" TEXT NOT NULL,
  "chunk_fingerprint" TEXT NOT NULL,
  "parent_chunk_id" TEXT,
  "status" "DocumentExtractionChunkStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "provider" TEXT,
  "model" TEXT,
  "extraction_version" TEXT NOT NULL,
  "stop_reason" TEXT,
  "raw_result" JSONB,
  "normalized_result" JSONB,
  "sale_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_category" TEXT,
  "safe_error_message" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "duration_ms" INTEGER,
  "provider_request_id" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_extraction_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_extraction_chunks_tenant_id_file_id_extraction_version_chunk_index_key"
  ON "document_extraction_chunks"("tenant_id", "file_id", "extraction_version", "chunk_index");

CREATE INDEX IF NOT EXISTS "document_extraction_chunks_tenant_id_session_id_idx"
  ON "document_extraction_chunks"("tenant_id", "session_id");

CREATE INDEX IF NOT EXISTS "document_extraction_chunks_tenant_id_file_id_status_idx"
  ON "document_extraction_chunks"("tenant_id", "file_id", "status");

CREATE INDEX IF NOT EXISTS "document_extraction_chunks_tenant_id_file_id_extraction_version_start_page_end_page_idx"
  ON "document_extraction_chunks"("tenant_id", "file_id", "extraction_version", "start_page", "end_page");

ALTER TABLE "document_extraction_chunks"
  ADD CONSTRAINT "document_extraction_chunks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_extraction_chunks"
  ADD CONSTRAINT "document_extraction_chunks_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "data_import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_extraction_chunks"
  ADD CONSTRAINT "document_extraction_chunks_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "data_import_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
