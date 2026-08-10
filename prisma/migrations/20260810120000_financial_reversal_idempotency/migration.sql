-- Commit 26A/26B — Financial Reversal Causality (durable idempotency keys).
-- Additive only. Nullable. No backfill. No business rewrite.
--
-- Distinguishes:
--   AI ActionRun reverse then crash  → SAME_COMMAND recovery (matching key)
--   Human / other reverse            → EXTERNAL (deleted, key null or different)
--
-- Treasury unique includes direction so BOTH transfer legs may share one key.
-- Production migrate is NOT auto-deployed; run manually before 26C bindings.

ALTER TABLE "operating_expenses"
  ADD COLUMN "reversalIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "operating_expenses_tenantId_reversalIdempotencyKey_key"
  ON "operating_expenses"("tenantId", "reversalIdempotencyKey");

ALTER TABLE "treasury_entries"
  ADD COLUMN "reversalIdempotencyKey" TEXT;

-- Same command key may stamp both transfer legs (OUTFLOW + INFLOW).
CREATE UNIQUE INDEX "treasury_entries_tenantId_reversalIdempotencyKey_direction_key"
  ON "treasury_entries"("tenantId", "reversalIdempotencyKey", "direction");
