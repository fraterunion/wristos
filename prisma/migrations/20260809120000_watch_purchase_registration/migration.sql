-- Commit 17A: Canonical purchase registration fields on Watch + PURCHASE_AUTO source.
-- DO NOT run against production until Commit 17A rollout plan is approved.

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

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_sellerClientId_fkey" FOREIGN KEY ("sellerClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
