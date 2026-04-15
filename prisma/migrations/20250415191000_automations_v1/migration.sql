-- CreateEnum
CREATE TYPE "AutomationRuleType" AS ENUM ('STALE_DEAL', 'OVERDUE_PAYMENT', 'AGING_INVENTORY');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "AutomationRuleType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholdDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_tenantId_idx" ON "automation_rules"("tenantId");
CREATE INDEX "automation_rules_tenantId_type_idx" ON "automation_rules"("tenantId", "type");
CREATE INDEX "automation_rules_tenantId_isEnabled_idx" ON "automation_rules"("tenantId", "isEnabled");
CREATE UNIQUE INDEX "automation_rules_tenantId_type_key" ON "automation_rules"("tenantId", "type");
CREATE INDEX "automation_runs_tenantId_idx" ON "automation_runs"("tenantId");
CREATE INDEX "automation_runs_tenantId_createdAt_idx" ON "automation_runs"("tenantId", "createdAt");
CREATE INDEX "automation_runs_ruleId_idx" ON "automation_runs"("ruleId");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
