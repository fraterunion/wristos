-- CreateEnum
CREATE TYPE "StorefrontReservationStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'PROCESSED');

-- AlterTable: public storefront fields on watches
ALTER TABLE "watches"
ADD COLUMN "isPublished"       BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publicSlug"        TEXT,
ADD COLUMN "publicDescription" TEXT,
ADD COLUMN "publicPrice"       DECIMAL(12,2),
ADD COLUMN "reservationAmount" DECIMAL(12,2);

-- CreateIndex: tenant-scoped slug uniqueness
CREATE UNIQUE INDEX "watches_tenantId_publicSlug_key" ON "watches"("tenantId", "publicSlug");

-- CreateIndex: fast lookup of published watches
CREATE INDEX "watches_tenantId_isPublished_idx" ON "watches"("tenantId", "isPublished");

-- CreateTable
CREATE TABLE "storefront_reservations" (
    "id"                      TEXT NOT NULL,
    "tenantId"                TEXT NOT NULL,
    "watchId"                 TEXT NOT NULL,
    "clientId"                TEXT,
    "customerName"            TEXT NOT NULL,
    "customerEmail"           TEXT NOT NULL,
    "customerPhone"           TEXT,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId"   TEXT,
    "reservationAmount"       DECIMAL(12,2) NOT NULL,
    "currency"                TEXT NOT NULL DEFAULT 'mxn',
    "status"                  "StorefrontReservationStatus" NOT NULL DEFAULT 'PENDING',
    "webhookEventId"          TEXT,
    "reservationExpiresAt"    TIMESTAMP(3),
    "processedAt"             TIMESTAMP(3),
    "expiredAt"               TIMESTAMP(3),
    "cancelledAt"             TIMESTAMP(3),
    "dealId"                  TEXT,
    "deletedAt"               TIMESTAMP(3),
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique Stripe identifiers (idempotency guards)
CREATE UNIQUE INDEX "storefront_reservations_stripeCheckoutSessionId_key" ON "storefront_reservations"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "storefront_reservations_stripePaymentIntentId_key"   ON "storefront_reservations"("stripePaymentIntentId");
CREATE UNIQUE INDEX "storefront_reservations_dealId_key"                  ON "storefront_reservations"("dealId");

-- CreateIndex: query indexes
CREATE INDEX "storefront_reservations_tenantId_idx"             ON "storefront_reservations"("tenantId");
CREATE INDEX "storefront_reservations_tenantId_status_idx"      ON "storefront_reservations"("tenantId", "status");
CREATE INDEX "storefront_reservations_tenantId_watchId_idx"     ON "storefront_reservations"("tenantId", "watchId");
CREATE INDEX "storefront_reservations_tenantId_customerEmail_idx" ON "storefront_reservations"("tenantId", "customerEmail");
CREATE INDEX "storefront_reservations_tenantId_createdAt_idx"   ON "storefront_reservations"("tenantId", "createdAt");
CREATE INDEX "storefront_reservations_tenantId_deletedAt_idx"   ON "storefront_reservations"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_watchId_fkey"
    FOREIGN KEY ("watchId") REFERENCES "watches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
