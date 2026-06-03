-- AlterTable: add nullable currency metadata to deals
-- originalCurrency: 'MXN' or 'USD'; null = legacy record (treat as MXN)
-- originalAmount:   amount entered by user in original currency
-- exchangeRate:     USD/MXN rate applied at time of sale (populated only when originalCurrency = 'USD')
-- agreedPrice remains the canonical accounting amount in MXN

ALTER TABLE "deals" ADD COLUMN "originalCurrency" TEXT;
ALTER TABLE "deals" ADD COLUMN "originalAmount" DECIMAL(12,2);
ALTER TABLE "deals" ADD COLUMN "exchangeRate" DECIMAL(12,6);
