-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'SETTLEMENT';

-- CreateTable
CREATE TABLE "account_settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receivableEntryId" TEXT NOT NULL,
    "payableEntryId" TEXT NOT NULL,
    "receivablePaymentId" TEXT NOT NULL,
    "payablePaymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "idempotencyKey" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_settlements_receivablePaymentId_key" ON "account_settlements"("receivablePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "account_settlements_payablePaymentId_key" ON "account_settlements"("payablePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "account_settlements_tenantId_idempotencyKey_key" ON "account_settlements"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "account_settlements_tenantId_idx" ON "account_settlements"("tenantId");

-- CreateIndex
CREATE INDEX "account_settlements_tenantId_receivableEntryId_idx" ON "account_settlements"("tenantId", "receivableEntryId");

-- CreateIndex
CREATE INDEX "account_settlements_tenantId_payableEntryId_idx" ON "account_settlements"("tenantId", "payableEntryId");

-- CreateIndex
CREATE INDEX "account_settlements_tenantId_deletedAt_idx" ON "account_settlements"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "account_settlements_tenantId_effectiveDate_idx" ON "account_settlements"("tenantId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_receivableEntryId_fkey" FOREIGN KEY ("receivableEntryId") REFERENCES "account_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_payableEntryId_fkey" FOREIGN KEY ("payableEntryId") REFERENCES "account_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_receivablePaymentId_fkey" FOREIGN KEY ("receivablePaymentId") REFERENCES "account_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_payablePaymentId_fkey" FOREIGN KEY ("payablePaymentId") REFERENCES "account_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_settlements" ADD CONSTRAINT "account_settlements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
