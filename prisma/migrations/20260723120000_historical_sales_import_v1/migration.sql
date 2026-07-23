-- Historical Sales Import V1 (TYPE C — additive)

-- Enums
ALTER TYPE "DataImportEntityType" ADD VALUE IF NOT EXISTS 'SALES';

DO $$ BEGIN
  CREATE TYPE "DataImportTarget" AS ENUM ('INVENTORY', 'SALES');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "DataImportEventType" ADD VALUE IF NOT EXISTS 'SALES_EXTRACTION_STARTED';
ALTER TYPE "DataImportEventType" ADD VALUE IF NOT EXISTS 'SALES_EXTRACTION_COMPLETED';
ALTER TYPE "DataImportEventType" ADD VALUE IF NOT EXISTS 'SALES_EXTRACTION_FAILED';
ALTER TYPE "DataImportEventType" ADD VALUE IF NOT EXISTS 'SALES_EXTRACTION_EDITED';
ALTER TYPE "DataImportEventType" ADD VALUE IF NOT EXISTS 'SALES_DRY_RUN_COMPLETED';
ALTER TYPE "DataImportEventType" ADD VALUE IF NOT EXISTS 'SALES_IMPORT_COMMITTED';

-- Session import target
ALTER TABLE "data_import_sessions"
  ADD COLUMN IF NOT EXISTS "import_target" "DataImportTarget" NOT NULL DEFAULT 'INVENTORY';

CREATE INDEX IF NOT EXISTS "data_import_sessions_tenant_id_import_target_idx"
  ON "data_import_sessions"("tenant_id", "import_target");

-- Deal: nullable watch + historical import fields
ALTER TABLE "deals" ALTER COLUMN "watchId" DROP NOT NULL;

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "soldAt" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "historicalCost" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "historicalCostCurrency" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "historicalCostOriginalAmount" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "historicalCostExchangeRate" DECIMAL(12,6);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "extrasAmount" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "extrasCurrency" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "extrasOriginalAmount" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "extrasExchangeRate" DECIMAL(12,6);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "reportedProfit" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "calculatedProfit" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "paymentCount" INTEGER;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "importSessionId" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "importFingerprint" TEXT;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "importSourceRow" INTEGER;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "sourceTag" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "deals_tenantId_importFingerprint_key"
  ON "deals"("tenantId", "importFingerprint");

CREATE INDEX IF NOT EXISTS "deals_tenantId_soldAt_idx" ON "deals"("tenantId", "soldAt");
CREATE INDEX IF NOT EXISTS "deals_tenantId_importSessionId_idx" ON "deals"("tenantId", "importSessionId");
