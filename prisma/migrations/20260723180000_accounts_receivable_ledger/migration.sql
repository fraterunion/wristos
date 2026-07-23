-- Accounts Receivable Ledger (TYPE C — additive)

DO $$ BEGIN
  CREATE TYPE "ReceivableStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WRITTEN_OFF');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReceivablePaymentMethod" AS ENUM ('WIRE', 'BANK_TRANSFER', 'CASH', 'CHECK', 'CRYPTO', 'CARD', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinancialAuditEventType" AS ENUM (
    'RECEIVABLE_CREATED',
    'PAYMENT_CREATED',
    'PAYMENT_DELETED',
    'PAYMENT_REVERSED',
    'RECEIVABLE_WRITTEN_OFF'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "receivables" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "originalAmount" DECIMAL(12,2) NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'MXN',
  "fxRate" DECIMAL(12,6),
  "normalizedAmount" DECIMAL(12,2) NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "status" "ReceivableStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "sourceTag" TEXT,
  "writtenOffAt" TIMESTAMP(3),
  "writtenOffReason" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "receivables_dealId_key" ON "receivables"("dealId");
CREATE UNIQUE INDEX IF NOT EXISTS "receivables_tenantId_dealId_key" ON "receivables"("tenantId", "dealId");
CREATE INDEX IF NOT EXISTS "receivables_tenantId_idx" ON "receivables"("tenantId");
CREATE INDEX IF NOT EXISTS "receivables_tenantId_customerId_idx" ON "receivables"("tenantId", "customerId");
CREATE INDEX IF NOT EXISTS "receivables_tenantId_status_idx" ON "receivables"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "receivables_tenantId_issueDate_idx" ON "receivables"("tenantId", "issueDate");
CREATE INDEX IF NOT EXISTS "receivables_tenantId_dueDate_idx" ON "receivables"("tenantId", "dueDate");
CREATE INDEX IF NOT EXISTS "receivables_tenantId_deletedAt_idx" ON "receivables"("tenantId", "deletedAt");

CREATE TABLE IF NOT EXISTS "receivable_payments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'MXN',
  "fxRate" DECIMAL(12,6),
  "normalizedAmount" DECIMAL(12,2) NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "method" "ReceivablePaymentMethod" NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "reversesPaymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receivable_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "receivable_payments_tenantId_idx" ON "receivable_payments"("tenantId");
CREATE INDEX IF NOT EXISTS "receivable_payments_tenantId_receivableId_idx" ON "receivable_payments"("tenantId", "receivableId");
CREATE INDEX IF NOT EXISTS "receivable_payments_tenantId_paymentDate_idx" ON "receivable_payments"("tenantId", "paymentDate");
CREATE INDEX IF NOT EXISTS "receivable_payments_tenantId_deletedAt_idx" ON "receivable_payments"("tenantId", "deletedAt");

CREATE TABLE IF NOT EXISTS "financial_audit_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventType" "FinancialAuditEventType" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "dealId" TEXT,
  "receivableId" TEXT,
  "actorUserId" TEXT,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "financial_audit_events_tenantId_idx" ON "financial_audit_events"("tenantId");
CREATE INDEX IF NOT EXISTS "financial_audit_events_tenantId_eventType_idx" ON "financial_audit_events"("tenantId", "eventType");
CREATE INDEX IF NOT EXISTS "financial_audit_events_tenantId_receivableId_idx" ON "financial_audit_events"("tenantId", "receivableId");
CREATE INDEX IF NOT EXISTS "financial_audit_events_tenantId_entityId_idx" ON "financial_audit_events"("tenantId", "entityId");
CREATE INDEX IF NOT EXISTS "financial_audit_events_tenantId_createdAt_idx" ON "financial_audit_events"("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "receivables" ADD CONSTRAINT "receivables_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivableId_fkey"
    FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_reversesPaymentId_fkey"
    FOREIGN KEY ("reversesPaymentId") REFERENCES "receivable_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "financial_audit_events" ADD CONSTRAINT "financial_audit_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
