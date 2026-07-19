-- Add AI extraction metadata to data_import_files
ALTER TABLE "data_import_files"
  ADD COLUMN "extraction_provider" TEXT,
  ADD COLUMN "extraction_model" TEXT,
  ADD COLUMN "extracted_document_data" JSONB,
  ADD COLUMN "extraction_error" TEXT;

-- Add document extraction event types to DataImportEventType enum
ALTER TYPE "DataImportEventType" ADD VALUE 'DOCUMENT_EXTRACTION_STARTED';
ALTER TYPE "DataImportEventType" ADD VALUE 'DOCUMENT_EXTRACTION_COMPLETED';
ALTER TYPE "DataImportEventType" ADD VALUE 'DOCUMENT_EXTRACTION_FAILED';
ALTER TYPE "DataImportEventType" ADD VALUE 'DOCUMENT_EXTRACTION_EDITED';
