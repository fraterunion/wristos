-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'CASH', 'CARD', 'OTHER');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "payments" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "notes" TEXT;
ALTER TABLE "payments" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "payments" ALTER COLUMN "dueDate" DROP NOT NULL;
ALTER TABLE "payments" DROP COLUMN "currency";

-- Normalize existing rows before setting constraints
UPDATE "payments"
SET "method" = 'OTHER'
WHERE "method" IS NULL;

-- For required dealId in V1, backfill from any existing deal in tenant if needed.
UPDATE "payments" p
SET "dealId" = (
  SELECT d."id"
  FROM "deals" d
  WHERE d."tenantId" = p."tenantId"
  ORDER BY d."createdAt" ASC
  LIMIT 1
)
WHERE p."dealId" IS NULL;

ALTER TABLE "payments" ALTER COLUMN "dealId" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "method" DROP DEFAULT;

-- Update foreign key behavior for required deal relation
ALTER TABLE "payments" DROP CONSTRAINT "payments_dealId_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "payments_tenantId_method_idx" ON "payments"("tenantId", "method");
CREATE INDEX "payments_tenantId_dealId_idx" ON "payments"("tenantId", "dealId");
CREATE INDEX "payments_tenantId_deletedAt_idx" ON "payments"("tenantId", "deletedAt");
