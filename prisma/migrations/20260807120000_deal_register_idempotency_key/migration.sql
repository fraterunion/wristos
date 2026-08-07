-- AlterTable: durable sale-registration idempotency (nullable; multiple NULLs allowed)
ALTER TABLE "deals" ADD COLUMN "registerIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "deals_tenantId_registerIdempotencyKey_key" ON "deals"("tenantId", "registerIdempotencyKey");

-- AlterTable: typed Treasury movement provenance (sale payment inflow vs bank-fee outflow)
ALTER TABLE "treasury_entries" ADD COLUMN "provenanceKey" TEXT;

-- CreateIndex: unique per tenant when non-null (PostgreSQL UNIQUE allows multiple NULLs)
CREATE UNIQUE INDEX "treasury_entries_tenantId_provenanceKey_key" ON "treasury_entries"("tenantId", "provenanceKey");
