-- CreateEnum
CREATE TYPE "OperatingExpenseCategory" AS ENUM ('GASOLINE', 'TOLLS', 'WATCHMAKER', 'PARKING', 'MEALS', 'FLIGHTS', 'TRAVEL', 'MARKETING', 'COMMISSIONS');

-- CreateTable
CREATE TABLE "operating_expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" "OperatingExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "expenseDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operating_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operating_expenses_tenantId_idx" ON "operating_expenses"("tenantId");

-- CreateIndex
CREATE INDEX "operating_expenses_tenantId_category_idx" ON "operating_expenses"("tenantId", "category");

-- CreateIndex
CREATE INDEX "operating_expenses_tenantId_expenseDate_idx" ON "operating_expenses"("tenantId", "expenseDate");

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
