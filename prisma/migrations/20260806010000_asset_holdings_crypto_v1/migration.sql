-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CRYPTO');

-- CreateTable
CREATE TABLE "asset_holdings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL DEFAULT 'CRYPTO',
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(28,18) NOT NULL,
    "averageCostMxn" DECIMAL(18,8) NOT NULL,
    "location" TEXT NOT NULL,
    "custodian" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_price_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL DEFAULT 'CRYPTO',
    "ticker" TEXT NOT NULL,
    "priceMxn" DECIMAL(18,8) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_holdings_tenantId_idx" ON "asset_holdings"("tenantId");

-- CreateIndex
CREATE INDEX "asset_holdings_tenantId_deletedAt_idx" ON "asset_holdings"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "asset_holdings_tenantId_assetType_ticker_idx" ON "asset_holdings"("tenantId", "assetType", "ticker");

-- CreateIndex
CREATE INDEX "asset_holdings_tenantId_assetType_deletedAt_idx" ON "asset_holdings"("tenantId", "assetType", "deletedAt");

-- CreateIndex
CREATE INDEX "asset_price_snapshots_tenantId_idx" ON "asset_price_snapshots"("tenantId");

-- CreateIndex
CREATE INDEX "asset_price_snapshots_tenantId_assetType_ticker_capturedAt_idx" ON "asset_price_snapshots"("tenantId", "assetType", "ticker", "capturedAt");

-- CreateIndex
CREATE INDEX "asset_price_snapshots_tenantId_assetType_capturedAt_idx" ON "asset_price_snapshots"("tenantId", "assetType", "capturedAt");

-- AddForeignKey
ALTER TABLE "asset_holdings" ADD CONSTRAINT "asset_holdings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
