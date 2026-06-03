-- AlterTable: add cost currency metadata columns to watches
ALTER TABLE "watches"
  ADD COLUMN "costCurrency"       TEXT,
  ADD COLUMN "costOriginalAmount" DECIMAL(12,2),
  ADD COLUMN "costExchangeRate"   DECIMAL(12,6);
