-- Commit 14A: durable idempotency for received-money AccountPayment (CASH/BANK/CESAR).
-- Settlement continues to use AccountSettlement.idempotencyKey.
-- DO NOT run against production until Commit 14B / explicit migrate approval.

ALTER TABLE "account_payments"
ADD COLUMN "registerIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "account_payments_tenantId_registerIdempotencyKey_key"
ON "account_payments"("tenantId", "registerIdempotencyKey");
