-- Commit 18A: canonical Client registration gate.
-- Additive only. Nullable registerIdempotencyKey — no historical backfill.
-- No unique phone/email constraints (production may contain legacy duplicates;
-- duplicate safety is enforced in ClientRegistrationService).
-- DO NOT run against production until Commit 18B / explicit migrate approval.

ALTER TABLE "clients"
ADD COLUMN "registerIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "clients_tenantId_registerIdempotencyKey_key"
ON "clients"("tenantId", "registerIdempotencyKey");

CREATE INDEX "clients_tenantId_phone_idx"
ON "clients"("tenantId", "phone");
