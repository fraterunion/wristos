-- Commit 17A: Canonical purchase registration fields on Watch + PURCHASE_AUTO source.
-- DO NOT run against production until Commit 17A rollout plan is approved.
--
-- Production serial audit (2026-08-08, read-only):
--   wrist-caviar: 40 active / 2 with serial / 0 duplicates (incl. soft-deleted)
--   wristos-demo: 60 active / 60 with serial / 0 duplicates (incl. soft-deleted)
-- Partial unique index enforces active non-null serial integrity without blocking
-- re-acquisition after soft-delete reverse.

-- AlterEnum
ALTER TYPE "AccountEntrySource" ADD VALUE 'PURCHASE_AUTO';

-- AlterTable
ALTER TABLE "watches" ADD COLUMN     "acquiredAt" TIMESTAMP(3),
ADD COLUMN     "sellerClientId" TEXT,
ADD COLUMN     "registerIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "watches_tenantId_registerIdempotencyKey_key" ON "watches"("tenantId", "registerIdempotencyKey");

-- CreateIndex
CREATE INDEX "watches_tenantId_acquiredAt_idx" ON "watches"("tenantId", "acquiredAt");

-- CreateIndex
CREATE INDEX "watches_tenantId_sellerClientId_idx" ON "watches"("tenantId", "sellerClientId");

-- Active non-null serial uniqueness per tenant (NULLs allowed; soft-deleted excluded)
CREATE UNIQUE INDEX "watches_tenantId_serialNumber_active_key"
ON "watches" ("tenantId", "serialNumber")
WHERE "serialNumber" IS NOT NULL AND "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_sellerClientId_fkey" FOREIGN KEY ("sellerClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
