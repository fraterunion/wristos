-- CreateTable
CREATE TABLE "physical_cash_balance_adjustments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "previousBalance" DECIMAL(14,2) NOT NULL,
    "adjustmentAmount" DECIMAL(14,2) NOT NULL,
    "resultingBalance" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "treasuryEntryId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "physical_cash_balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "physical_cash_balance_adjustments_treasuryEntryId_key" ON "physical_cash_balance_adjustments"("treasuryEntryId");

-- CreateIndex
CREATE INDEX "physical_cash_balance_adjustments_tenantId_idx" ON "physical_cash_balance_adjustments"("tenantId");

-- CreateIndex
CREATE INDEX "physical_cash_balance_adjustments_tenantId_effectiveDate_idx" ON "physical_cash_balance_adjustments"("tenantId", "effectiveDate");

-- CreateIndex
CREATE INDEX "physical_cash_balance_adjustments_tenantId_deletedAt_idx" ON "physical_cash_balance_adjustments"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "physical_cash_balance_adjustments" ADD CONSTRAINT "physical_cash_balance_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_cash_balance_adjustments" ADD CONSTRAINT "physical_cash_balance_adjustments_treasuryEntryId_fkey" FOREIGN KEY ("treasuryEntryId") REFERENCES "treasury_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
