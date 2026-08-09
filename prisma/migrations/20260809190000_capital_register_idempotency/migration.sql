-- Commit 23A: canonical Capital contribution / distribution registration gate.
-- Additive only. Nullable registerIdempotencyKey — no historical backfill.
-- DO NOT run against production until Commit 23B / explicit migrate approval.
--
-- V1 Capital semantics (frozen by audit): partner equity ledger ONLY.
-- CapitalService historically did not write TreasuryEntry; production has
-- zero contributionId/distributionId Treasury links. Canonical domain keeps
-- that boundary. CapitalAccount remains a display/source label, not an
-- automatic Treasury write. Future cash-linked Capital is a separate decision.

ALTER TABLE "investor_contributions"
ADD COLUMN "registerIdempotencyKey" TEXT;

ALTER TABLE "investor_distributions"
ADD COLUMN "registerIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "investor_contributions_tenantId_registerIdempotencyKey_key"
ON "investor_contributions"("tenantId", "registerIdempotencyKey");

CREATE UNIQUE INDEX "investor_distributions_tenantId_registerIdempotencyKey_key"
ON "investor_distributions"("tenantId", "registerIdempotencyKey");
