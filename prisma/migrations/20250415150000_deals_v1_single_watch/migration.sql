-- AlterTable
ALTER TABLE "deals" ADD COLUMN "watchId" TEXT;
ALTER TABLE "deals" ADD COLUMN "expectedCloseAt" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN "agreedPrice" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "deals" ADD COLUMN "notes" TEXT;
ALTER TABLE "deals" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "deals" DROP COLUMN "title";

-- NOTE: clientId remains required in schema. If historical rows with NULL exist,
-- set a valid client before applying NOT NULL.
ALTER TABLE "deals" ALTER COLUMN "clientId" SET NOT NULL;

-- For required watchId, temporarily backfill from an existing watch per tenant if needed.
UPDATE "deals" d
SET "watchId" = (
  SELECT w."id"
  FROM "watches" w
  WHERE w."tenantId" = d."tenantId"
  ORDER BY w."createdAt" ASC
  LIMIT 1
)
WHERE d."watchId" IS NULL;

ALTER TABLE "deals" ALTER COLUMN "watchId" SET NOT NULL;
ALTER TABLE "deals" ALTER COLUMN "agreedPrice" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "deals_tenantId_clientId_idx" ON "deals"("tenantId", "clientId");
CREATE INDEX "deals_tenantId_watchId_idx" ON "deals"("tenantId", "watchId");
CREATE INDEX "deals_tenantId_deletedAt_idx" ON "deals"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "watches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" DROP CONSTRAINT "deals_clientId_fkey";
ALTER TABLE "deals" ADD CONSTRAINT "deals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
