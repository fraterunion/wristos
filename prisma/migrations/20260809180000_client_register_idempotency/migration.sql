-- Commit 18A: canonical Client registration + durable active identity integrity.
-- Additive only. Nullable registerIdempotencyKey — no historical backfill.
-- DO NOT run against production until explicit migrate approval.
--
-- Invariants:
-- 1) registerIdempotencyKey unique → same command replay
-- 2) active email/phone identity unique → different commands cannot create the same person
-- 3) Soft-deleted rows are excluded from unique indexes; application MUST still
--    return CLIENT_DELETED_MATCH (no silent recreation / resurrection)
-- 4) NULL email/phone allowed (name-only Clients); multiple NULLs OK
-- 5) No name uniqueness
--
-- Expression indexes MUST match ClientRegistrationService / client-identity.util.ts:
--   email key: lower(btrim(email))
--   phone key: digit-normalized identity (10-digit MX → 52XXXXXXXXXX)

ALTER TABLE "clients"
ADD COLUMN "registerIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "clients_tenantId_registerIdempotencyKey_key"
ON "clients"("tenantId", "registerIdempotencyKey");

-- Lookup helper (non-unique). Identity uniqueness is the expression index below.
CREATE INDEX "clients_tenantId_phone_idx"
ON "clients"("tenantId", "phone");

-- Active non-null email uniqueness (canonical compare = lower(trim))
CREATE UNIQUE INDEX "clients_tenantId_email_active_key"
ON "clients" ("tenantId", (lower(btrim("email"))))
WHERE "email" IS NOT NULL AND btrim("email") <> '' AND "deletedAt" IS NULL;

-- Active non-null phone identity uniqueness (equivalent to clientPhoneIdentityKey)
CREATE UNIQUE INDEX "clients_tenantId_phone_identity_active_key"
ON "clients" (
  "tenantId",
  (
    CASE
      WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) = 10
        THEN '52' || regexp_replace("phone", '[^0-9]', '', 'g')
      WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) = 12
        AND left(regexp_replace("phone", '[^0-9]', '', 'g'), 2) = '52'
        THEN regexp_replace("phone", '[^0-9]', '', 'g')
      ELSE regexp_replace("phone", '[^0-9]', '', 'g')
    END
  )
)
WHERE "phone" IS NOT NULL
  AND btrim("phone") <> ''
  AND length(regexp_replace("phone", '[^0-9]', '', 'g')) BETWEEN 7 AND 15
  AND "deletedAt" IS NULL;
