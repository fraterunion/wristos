-- CreateEnum
CREATE TYPE "AccountEntryType" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "AccountEntryStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountEntryCategory" AS ENUM ('SALE_BALANCE', 'PURCHASE', 'SERVICE', 'COMMISSION', 'REFUND', 'LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('CLIENT', 'SUPPLIER', 'DEALER', 'BROKER', 'WORKSHOP', 'LOGISTICS', 'OTHER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('MXN', 'USD');

-- CreateEnum
CREATE TYPE "AccountEntrySource" AS ENUM ('MANUAL', 'DEAL_AUTO');

-- CreateTable
CREATE TABLE "account_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "AccountEntryType" NOT NULL,
    "status" "AccountEntryStatus" NOT NULL DEFAULT 'OPEN',
    "category" "AccountEntryCategory" NOT NULL DEFAULT 'OTHER',
    "source" "AccountEntrySource" NOT NULL DEFAULT 'MANUAL',
    "counterpartyName" TEXT NOT NULL,
    "counterpartyType" "CounterpartyType" NOT NULL DEFAULT 'OTHER',
    "concept" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "exchangeRate" DECIMAL(12,6),
    "reference" TEXT,
    "issuedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "clientId" TEXT,
    "dealId" TEXT,
    "watchId" TEXT,
    "expenseId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "method" "PaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_entries_tenantId_idx" ON "account_entries"("tenantId");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_type_idx" ON "account_entries"("tenantId", "type");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_status_idx" ON "account_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_type_status_idx" ON "account_entries"("tenantId", "type", "status");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_source_idx" ON "account_entries"("tenantId", "source");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_dueDate_idx" ON "account_entries"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_clientId_idx" ON "account_entries"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_dealId_idx" ON "account_entries"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_deletedAt_idx" ON "account_entries"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "account_entries_tenantId_createdAt_idx" ON "account_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "account_payments_tenantId_idx" ON "account_payments"("tenantId");

-- CreateIndex
CREATE INDEX "account_payments_entryId_idx" ON "account_payments"("entryId");

-- CreateIndex
CREATE INDEX "account_payments_tenantId_entryId_idx" ON "account_payments"("tenantId", "entryId");

-- CreateIndex
CREATE INDEX "account_payments_tenantId_paidAt_idx" ON "account_payments"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "account_payments_tenantId_deletedAt_idx" ON "account_payments"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "watches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "operating_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_payments" ADD CONSTRAINT "account_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_payments" ADD CONSTRAINT "account_payments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "account_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

