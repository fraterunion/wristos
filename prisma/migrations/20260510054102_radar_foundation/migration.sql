-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM', 'WHATSAPP', 'DISCORD', 'SLACK', 'EMAIL', 'RSS', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PARSING', 'CLASSIFYING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "MarketListingIntent" AS ENUM ('SELL_OFFER', 'BUY_REQUEST', 'PRICE_SIGNAL', 'GENERAL_INQUIRY');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CatalogDataSource" AS ENUM ('MANUFACTURER_SPEC', 'AFTERMARKET_GUIDE', 'COMMUNITY_WIKI', 'DEALER_NOTE', 'AI_EXTRACTION', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "ExtractionSource" AS ENUM ('EXPLICIT', 'INFERRED');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'SKIPPED_PREFILTER', 'SKIPPED_MEDIA', 'SKIPPED_SYSTEM');

-- DropIndex
DROP INDEX "payments_dealId_idx";

-- CreateTable
CREATE TABLE "radar_channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT,
    "externalChannelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radar_imports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "stats" JSONB,
    "originalFileName" TEXT,
    "fileSizeBytes" INTEGER,
    "sourceGroupName" TEXT,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "listingsCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radar_channel_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "authorExternalId" TEXT,
    "rawPayload" JSONB,
    "classificationStatus" "ClassificationStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "isSystemMessage" BOOLEAN NOT NULL DEFAULT false,
    "senderRaw" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radar_channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radar_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "displayName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "telegramUsername" TEXT,
    "telegramUserId" TEXT,
    "whatsappId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radar_market_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contactId" TEXT,
    "watchReferenceId" TEXT,
    "intent" "MarketListingIntent" NOT NULL DEFAULT 'GENERAL_INQUIRY',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "referenceSource" "ExtractionSource",
    "brand" TEXT,
    "feedConfidence" DOUBLE PRECISION,
    "initialConfidence" DOUBLE PRECISION,
    "rawModelMention" TEXT,
    "referenceNumberExplicit" TEXT,
    "aiSummary" TEXT,
    "urgencyDetected" BOOLEAN NOT NULL DEFAULT false,
    "conditionNotes" TEXT,
    "hasBox" BOOLEAN,
    "hasPapers" BOOLEAN,
    "year" INTEGER,
    "dealerNotes" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "aiRawResponse" JSONB,
    "title" TEXT,
    "description" TEXT,
    "priceAmount" DECIMAL(14,2),
    "priceCurrency" TEXT,
    "location" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_market_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radar_watch_references" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "catalogSource" "CatalogDataSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "aliases" JSONB NOT NULL,
    "line" TEXT,
    "approximateRetailUsd" DECIMAL(12,2),
    "discontinued" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_watch_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radar_channels_tenantId_idx" ON "radar_channels"("tenantId");

-- CreateIndex
CREATE INDEX "radar_channels_tenantId_type_idx" ON "radar_channels"("tenantId", "type");

-- CreateIndex
CREATE INDEX "radar_channels_tenantId_isActive_idx" ON "radar_channels"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "radar_channels_tenantId_externalChannelId_key" ON "radar_channels"("tenantId", "externalChannelId");

-- CreateIndex
CREATE INDEX "radar_imports_tenantId_idx" ON "radar_imports"("tenantId");

-- CreateIndex
CREATE INDEX "radar_imports_tenantId_channelId_idx" ON "radar_imports"("tenantId", "channelId");

-- CreateIndex
CREATE INDEX "radar_imports_tenantId_status_idx" ON "radar_imports"("tenantId", "status");

-- CreateIndex
CREATE INDEX "radar_imports_tenantId_createdAt_idx" ON "radar_imports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_idx" ON "radar_channel_messages"("tenantId");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_channelId_idx" ON "radar_channel_messages"("tenantId", "channelId");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_importId_idx" ON "radar_channel_messages"("tenantId", "importId");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_postedAt_idx" ON "radar_channel_messages"("tenantId", "postedAt");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_channelId_postedAt_idx" ON "radar_channel_messages"("tenantId", "channelId", "postedAt");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_createdAt_idx" ON "radar_channel_messages"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "radar_channel_messages_tenantId_classificationStatus_idx" ON "radar_channel_messages"("tenantId", "classificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "radar_channel_messages_tenantId_contentHash_key" ON "radar_channel_messages"("tenantId", "contentHash");

-- CreateIndex
CREATE INDEX "radar_contacts_tenantId_idx" ON "radar_contacts"("tenantId");

-- CreateIndex
CREATE INDEX "radar_contacts_tenantId_clientId_idx" ON "radar_contacts"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "radar_contacts_tenantId_phone_idx" ON "radar_contacts"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "radar_contacts_tenantId_email_idx" ON "radar_contacts"("tenantId", "email");

-- CreateIndex
CREATE INDEX "radar_contacts_tenantId_telegramUserId_idx" ON "radar_contacts"("tenantId", "telegramUserId");

-- CreateIndex
CREATE INDEX "radar_contacts_tenantId_createdAt_idx" ON "radar_contacts"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "radar_market_listings_messageId_key" ON "radar_market_listings"("messageId");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_idx" ON "radar_market_listings"("tenantId");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_reviewStatus_idx" ON "radar_market_listings"("tenantId", "reviewStatus");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_intent_idx" ON "radar_market_listings"("tenantId", "intent");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_watchReferenceId_idx" ON "radar_market_listings"("tenantId", "watchReferenceId");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_contactId_idx" ON "radar_market_listings"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_createdAt_idx" ON "radar_market_listings"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_reviewStatus_createdAt_idx" ON "radar_market_listings"("tenantId", "reviewStatus", "createdAt");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_reviewStatus_feedConfidence__idx" ON "radar_market_listings"("tenantId", "reviewStatus", "feedConfidence", "createdAt");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_brand_createdAt_idx" ON "radar_market_listings"("tenantId", "brand", "createdAt");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_deletedAt_idx" ON "radar_market_listings"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "radar_market_listings_tenantId_priceAmount_intent_idx" ON "radar_market_listings"("tenantId", "priceAmount", "intent");

-- CreateIndex
CREATE INDEX "radar_watch_references_brand_idx" ON "radar_watch_references"("brand");

-- CreateIndex
CREATE INDEX "radar_watch_references_reference_idx" ON "radar_watch_references"("reference");

-- CreateIndex
CREATE INDEX "radar_watch_references_brand_model_idx" ON "radar_watch_references"("brand", "model");

-- CreateIndex
CREATE UNIQUE INDEX "radar_watch_references_brand_model_reference_key" ON "radar_watch_references"("brand", "model", "reference");

-- AddForeignKey
ALTER TABLE "radar_channels" ADD CONSTRAINT "radar_channels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_imports" ADD CONSTRAINT "radar_imports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_imports" ADD CONSTRAINT "radar_imports_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "radar_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_channel_messages" ADD CONSTRAINT "radar_channel_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_channel_messages" ADD CONSTRAINT "radar_channel_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "radar_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_channel_messages" ADD CONSTRAINT "radar_channel_messages_importId_fkey" FOREIGN KEY ("importId") REFERENCES "radar_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_contacts" ADD CONSTRAINT "radar_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_contacts" ADD CONSTRAINT "radar_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_market_listings" ADD CONSTRAINT "radar_market_listings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_market_listings" ADD CONSTRAINT "radar_market_listings_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "radar_channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_market_listings" ADD CONSTRAINT "radar_market_listings_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "radar_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radar_market_listings" ADD CONSTRAINT "radar_market_listings_watchReferenceId_fkey" FOREIGN KEY ("watchReferenceId") REFERENCES "radar_watch_references"("id") ON DELETE SET NULL ON UPDATE CASCADE;
