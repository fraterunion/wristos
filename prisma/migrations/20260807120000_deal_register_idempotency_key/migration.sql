-- AlterTable
ALTER TABLE "deals" ADD COLUMN "registerIdempotencyKey" TEXT;

-- CreateIndex
-- PostgreSQL UNIQUE allows multiple NULLs, so legacy/unkeyed deals remain valid.
CREATE UNIQUE INDEX "deals_tenantId_registerIdempotencyKey_key" ON "deals"("tenantId", "registerIdempotencyKey");
