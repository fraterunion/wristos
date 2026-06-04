-- Capital de socios module: Investor, InvestorContribution, InvestorDistribution.
-- New CapitalAccount enum is separate from PaymentMethod to avoid semantic confusion
-- (PaymentMethod.CESAR = customer payment; CapitalAccount.CESAR_ACCOUNT = internal account).

-- CreateEnum
CREATE TYPE "CapitalAccount" AS ENUM ('CASH', 'BANK', 'CESAR_ACCOUNT');

-- CreateTable investors
CREATE TABLE "investors" (
    "id"               TEXT         NOT NULL,
    "tenantId"         TEXT         NOT NULL,
    "name"             TEXT         NOT NULL,
    "ownershipPercent" DECIMAL(5,2) NOT NULL,
    "isActive"         BOOLEAN      NOT NULL DEFAULT true,
    "notes"            TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    "deletedAt"        TIMESTAMP(3),

    CONSTRAINT "investors_pkey" PRIMARY KEY ("id")
);

-- CreateTable investor_contributions
CREATE TABLE "investor_contributions" (
    "id"            TEXT             NOT NULL,
    "tenantId"      TEXT             NOT NULL,
    "investorId"    TEXT             NOT NULL,
    "amount"        DECIMAL(12,2)    NOT NULL,
    "account"       "CapitalAccount" NOT NULL,
    "notes"         TEXT,
    "contributedAt" TIMESTAMP(3)     NOT NULL,
    "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)     NOT NULL,
    "deletedAt"     TIMESTAMP(3),

    CONSTRAINT "investor_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable investor_distributions
CREATE TABLE "investor_distributions" (
    "id"         TEXT             NOT NULL,
    "tenantId"   TEXT             NOT NULL,
    "investorId" TEXT             NOT NULL,
    "amount"     DECIMAL(12,2)    NOT NULL,
    "account"    "CapitalAccount" NOT NULL,
    "notes"      TEXT,
    "paidAt"     TIMESTAMP(3)     NOT NULL,
    "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3)     NOT NULL,
    "deletedAt"  TIMESTAMP(3),

    CONSTRAINT "investor_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex investors (tenantId, name)
CREATE UNIQUE INDEX "investors_tenantId_name_key" ON "investors"("tenantId", "name");

-- CreateIndex investors
CREATE INDEX "investors_tenantId_idx"          ON "investors"("tenantId");
CREATE INDEX "investors_tenantId_isActive_idx"  ON "investors"("tenantId", "isActive");
CREATE INDEX "investors_tenantId_deletedAt_idx" ON "investors"("tenantId", "deletedAt");

-- CreateIndex investor_contributions
CREATE INDEX "investor_contributions_tenantId_idx"              ON "investor_contributions"("tenantId");
CREATE INDEX "investor_contributions_tenantId_investorId_idx"   ON "investor_contributions"("tenantId", "investorId");
CREATE INDEX "investor_contributions_tenantId_contributedAt_idx" ON "investor_contributions"("tenantId", "contributedAt");
CREATE INDEX "investor_contributions_tenantId_deletedAt_idx"    ON "investor_contributions"("tenantId", "deletedAt");

-- CreateIndex investor_distributions
CREATE INDEX "investor_distributions_tenantId_idx"            ON "investor_distributions"("tenantId");
CREATE INDEX "investor_distributions_tenantId_investorId_idx" ON "investor_distributions"("tenantId", "investorId");
CREATE INDEX "investor_distributions_tenantId_paidAt_idx"     ON "investor_distributions"("tenantId", "paidAt");
CREATE INDEX "investor_distributions_tenantId_deletedAt_idx"  ON "investor_distributions"("tenantId", "deletedAt");

-- AddForeignKey investors -> tenants
ALTER TABLE "investors"
    ADD CONSTRAINT "investors_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey investor_contributions -> tenants
ALTER TABLE "investor_contributions"
    ADD CONSTRAINT "investor_contributions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey investor_contributions -> investors
ALTER TABLE "investor_contributions"
    ADD CONSTRAINT "investor_contributions_investorId_fkey"
    FOREIGN KEY ("investorId") REFERENCES "investors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey investor_distributions -> tenants
ALTER TABLE "investor_distributions"
    ADD CONSTRAINT "investor_distributions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey investor_distributions -> investors
ALTER TABLE "investor_distributions"
    ADD CONSTRAINT "investor_distributions_investorId_fkey"
    FOREIGN KEY ("investorId") REFERENCES "investors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
