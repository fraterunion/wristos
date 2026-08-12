-- Generic flag. Does not assume a wristos-demo tenant already exists.
-- Existing rows stay false. CLI provisioning (`npx tsx prisma/seed.ts`) sets
-- isDemo=true for the compiled-in slug wristos-demo. API reset fail-closes
-- unless that row exists and isDemo is true.
ALTER TABLE "tenants" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
