-- Add nullable FK from operating_expenses to deals.
-- Enables per-sale bankFee and netReceived computation without fragile notes-string matching.
-- All existing rows will have dealId = NULL; no data is modified.

ALTER TABLE "operating_expenses" ADD COLUMN "dealId" TEXT;

ALTER TABLE "operating_expenses"
  ADD CONSTRAINT "operating_expenses_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "operating_expenses_dealId_idx" ON "operating_expenses"("dealId");
