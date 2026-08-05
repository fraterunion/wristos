-- CreateTable
CREATE TABLE "investor_opening_balances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investor_opening_balances_tenantId_idx" ON "investor_opening_balances"("tenantId");

-- CreateIndex
CREATE INDEX "investor_opening_balances_tenantId_investorId_idx" ON "investor_opening_balances"("tenantId", "investorId");

-- CreateIndex
CREATE INDEX "investor_opening_balances_tenantId_effectiveDate_idx" ON "investor_opening_balances"("tenantId", "effectiveDate");

-- CreateIndex
CREATE INDEX "investor_opening_balances_tenantId_deletedAt_idx" ON "investor_opening_balances"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "investor_opening_balances_tenantId_investorId_source_key" ON "investor_opening_balances"("tenantId", "investorId", "source");

-- AddForeignKey
ALTER TABLE "investor_opening_balances" ADD CONSTRAINT "investor_opening_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_opening_balances" ADD CONSTRAINT "investor_opening_balances_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "investors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
