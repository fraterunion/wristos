-- RenameColumn
ALTER TABLE "watches" RENAME COLUMN "serial" TO "serialNumber";

-- AlterTable
ALTER TABLE "watches" ADD COLUMN "condition" TEXT NOT NULL DEFAULT 'Unspecified';
ALTER TABLE "watches" ADD COLUMN "cost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "watches" ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "watches" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- DropColumnDefaults (new rows must supply values via application / Prisma)
ALTER TABLE "watches" ALTER COLUMN "condition" DROP DEFAULT;
ALTER TABLE "watches" ALTER COLUMN "cost" DROP DEFAULT;
ALTER TABLE "watches" ALTER COLUMN "price" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "watches_tenantId_deletedAt_idx" ON "watches"("tenantId", "deletedAt");
