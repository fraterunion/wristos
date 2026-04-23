-- CreateEnum
CREATE TYPE "WatchExpenseCategory" AS ENUM ('POLISHING', 'REPAIR', 'LINKS', 'SHIPPING', 'PARTS', 'COMMISSIONS', 'TRAVEL');

-- AlterTable: add priceMin and priceMax (nullable first for safe data migration)
ALTER TABLE "watches" ADD COLUMN "priceMin" DECIMAL(12,2);
ALTER TABLE "watches" ADD COLUMN "priceMax" DECIMAL(12,2);

-- Data migration: copy existing price into both range bounds
UPDATE "watches" SET "priceMin" = "price", "priceMax" = "price";

-- Enforce NOT NULL after backfill
ALTER TABLE "watches" ALTER COLUMN "priceMin" SET NOT NULL;
ALTER TABLE "watches" ALTER COLUMN "priceMax" SET NOT NULL;

-- Drop the old single-price column
ALTER TABLE "watches" DROP COLUMN "price";

-- CreateTable
CREATE TABLE "watch_expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "category" "WatchExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watch_expenses_tenantId_idx" ON "watch_expenses"("tenantId");
CREATE INDEX "watch_expenses_watchId_idx" ON "watch_expenses"("watchId");

-- AddForeignKey
ALTER TABLE "watch_expenses" ADD CONSTRAINT "watch_expenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "watch_expenses" ADD CONSTRAINT "watch_expenses_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
