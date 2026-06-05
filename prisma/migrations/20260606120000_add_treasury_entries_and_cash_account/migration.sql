-- CreateEnum
CREATE TYPE "TreasuryAccount" AS ENUM ('CASH', 'BANK', 'CESAR');

-- CreateEnum
CREATE TYPE "TreasuryDirection" AS ENUM ('INFLOW', 'OUTFLOW');

-- AlterTable
ALTER TABLE "account_payments" ADD COLUMN "cashAccount" "TreasuryAccount",
ADD COLUMN "exchangeRateUsed" DECIMAL(12,6);

-- CreateTable
CREATE TABLE "treasury_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "account" "TreasuryAccount" NOT NULL,
    "direction" "TreasuryDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMxn" DECIMAL(12,2) NOT NULL,
    "exchangeRate" DECIMAL(12,6),
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "accountPaymentId" TEXT,
    "dealPaymentId" TEXT,
    "contributionId" TEXT,
    "distributionId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "treasury_entries_accountPaymentId_key" ON "treasury_entries"("accountPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_entries_dealPaymentId_key" ON "treasury_entries"("dealPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_entries_contributionId_key" ON "treasury_entries"("contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_entries_distributionId_key" ON "treasury_entries"("distributionId");

-- CreateIndex
CREATE INDEX "treasury_entries_tenantId_idx" ON "treasury_entries"("tenantId");

-- CreateIndex
CREATE INDEX "treasury_entries_tenantId_account_idx" ON "treasury_entries"("tenantId", "account");

-- CreateIndex
CREATE INDEX "treasury_entries_tenantId_account_direction_idx" ON "treasury_entries"("tenantId", "account", "direction");

-- CreateIndex
CREATE INDEX "treasury_entries_tenantId_transactionDate_idx" ON "treasury_entries"("tenantId", "transactionDate");

-- CreateIndex
CREATE INDEX "treasury_entries_tenantId_deletedAt_idx" ON "treasury_entries"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_accountPaymentId_fkey" FOREIGN KEY ("accountPaymentId") REFERENCES "account_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_dealPaymentId_fkey" FOREIGN KEY ("dealPaymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "investor_contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "investor_distributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
