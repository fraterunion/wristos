-- Commit 15A: canonical paid expense registration gate.
-- Additive only. Nullable fields — no historical backfill.
-- DO NOT run against production until Commit 15B / explicit migrate approval.

-- Currency for OperatingExpense (default MXN for existing rows).
ALTER TABLE "operating_expenses"
ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'MXN';

-- Paid-from source (null = legacy / import without Treasury OUTFLOW).
ALTER TABLE "operating_expenses"
ADD COLUMN "sourceAccount" "TreasuryAccount";

-- Durable idempotency for ExpenseRegistrationService.register().
ALTER TABLE "operating_expenses"
ADD COLUMN "registerIdempotencyKey" TEXT;

-- Soft-delete so correction can reverse Treasury atomically.
ALTER TABLE "operating_expenses"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "operating_expenses_tenantId_registerIdempotencyKey_key"
ON "operating_expenses"("tenantId", "registerIdempotencyKey");

CREATE INDEX "operating_expenses_tenantId_deletedAt_idx"
ON "operating_expenses"("tenantId", "deletedAt");
