-- CreateTable
CREATE TABLE "client_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "preferredBrands" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preferredModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "budgetMin" DECIMAL(12,2),
    "budgetMax" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_preferences_pkey" PRIMARY KEY ("id")
);

-- Backfill defaults before removing defaults
UPDATE "client_preferences" SET "preferredBrands" = ARRAY[]::TEXT[] WHERE "preferredBrands" IS NULL;
UPDATE "client_preferences" SET "preferredModels" = ARRAY[]::TEXT[] WHERE "preferredModels" IS NULL;
ALTER TABLE "client_preferences" ALTER COLUMN "preferredBrands" DROP DEFAULT;
ALTER TABLE "client_preferences" ALTER COLUMN "preferredModels" DROP DEFAULT;

-- AlterTable
ALTER TABLE "match_suggestions" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "match_suggestions" ALTER COLUMN "score" TYPE INTEGER USING COALESCE(ROUND("score"), 0);
ALTER TABLE "match_suggestions" ALTER COLUMN "score" SET NOT NULL;

-- CreateIndex
CREATE INDEX "client_preferences_tenantId_idx" ON "client_preferences"("tenantId");
CREATE INDEX "client_preferences_tenantId_clientId_idx" ON "client_preferences"("tenantId", "clientId");
CREATE UNIQUE INDEX "client_preferences_tenantId_clientId_key" ON "client_preferences"("tenantId", "clientId");
CREATE INDEX "match_suggestions_tenantId_dismissedAt_idx" ON "match_suggestions"("tenantId", "dismissedAt");
CREATE UNIQUE INDEX "match_suggestions_tenantId_clientId_watchId_key" ON "match_suggestions"("tenantId", "clientId", "watchId");

-- AddForeignKey
ALTER TABLE "client_preferences" ADD CONSTRAINT "client_preferences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_preferences" ADD CONSTRAINT "client_preferences_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
