-- Partial inventory import: allow watches with only the fields present in the source document.
-- Manual create via API DTO still requires brand/model/condition/cost/prices.
ALTER TABLE "watches" ALTER COLUMN "brand" DROP NOT NULL;
ALTER TABLE "watches" ALTER COLUMN "model" DROP NOT NULL;
ALTER TABLE "watches" ALTER COLUMN "condition" DROP NOT NULL;
ALTER TABLE "watches" ALTER COLUMN "cost" DROP NOT NULL;
ALTER TABLE "watches" ALTER COLUMN "priceMin" DROP NOT NULL;
ALTER TABLE "watches" ALTER COLUMN "priceMax" DROP NOT NULL;
