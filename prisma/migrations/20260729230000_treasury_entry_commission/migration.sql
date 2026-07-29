-- Add nullable structured bank commission on treasury entries.
-- No default: existing rows remain NULL until explicitly backfilled.
ALTER TABLE "treasury_entries" ADD COLUMN "commission" DECIMAL(12,2);
