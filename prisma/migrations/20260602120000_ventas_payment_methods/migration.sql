-- AlterEnum: Add BANCOS and CESAR to PaymentMethod
ALTER TYPE "PaymentMethod" ADD VALUE 'BANCOS';
ALTER TYPE "PaymentMethod" ADD VALUE 'CESAR';

-- AlterEnum: Add BANK_FEES to OperatingExpenseCategory
ALTER TYPE "OperatingExpenseCategory" ADD VALUE 'BANK_FEES';
