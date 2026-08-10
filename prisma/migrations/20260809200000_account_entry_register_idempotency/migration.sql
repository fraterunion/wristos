-- Commit 25B: durable idempotency for MANUAL AccountEntry create (receivable/payable).
-- DEAL_AUTO / PURCHASE_AUTO continue to omit this key.
-- DO NOT run against production until explicit migrate approval.

ALTER TABLE "account_entries"
ADD COLUMN "registerIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "account_entries_tenantId_registerIdempotencyKey_key"
ON "account_entries"("tenantId", "registerIdempotencyKey");
