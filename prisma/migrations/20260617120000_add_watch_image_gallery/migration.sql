-- CreateTable
CREATE TABLE "watch_images" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watch_images_tenantId_idx" ON "watch_images"("tenantId");

-- CreateIndex
CREATE INDEX "watch_images_tenantId_watchId_idx" ON "watch_images"("tenantId", "watchId");

-- CreateIndex
CREATE INDEX "watch_images_tenantId_watchId_sortOrder_idx" ON "watch_images"("tenantId", "watchId", "sortOrder");

-- CreateIndex
CREATE INDEX "watch_images_tenantId_deletedAt_idx" ON "watch_images"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "watch_images" ADD CONSTRAINT "watch_images_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_images" ADD CONSTRAINT "watch_images_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
