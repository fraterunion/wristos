-- AlterTable
ALTER TABLE "clients" ADD COLUMN "notes" TEXT;
ALTER TABLE "clients" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clients" ADD COLUMN "budgetRange" TEXT;
ALTER TABLE "clients" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Backfill + enforce not null for tags
UPDATE "clients" SET "tags" = ARRAY[]::TEXT[] WHERE "tags" IS NULL;
ALTER TABLE "clients" ALTER COLUMN "tags" SET NOT NULL;
ALTER TABLE "clients" ALTER COLUMN "tags" DROP DEFAULT;

-- CreateEnum
CREATE TYPE "ClientInteractionType" AS ENUM ('CALL', 'MESSAGE', 'MEETING', 'NOTE');

-- CreateTable
CREATE TABLE "client_interactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ClientInteractionType" NOT NULL,
    "notes" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_tenantId_deletedAt_idx" ON "clients"("tenantId", "deletedAt");
CREATE INDEX "client_interactions_tenantId_idx" ON "client_interactions"("tenantId");
CREATE INDEX "client_interactions_tenantId_clientId_idx" ON "client_interactions"("tenantId", "clientId");
CREATE INDEX "client_interactions_tenantId_occurredAt_idx" ON "client_interactions"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
