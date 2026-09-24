-- CreateEnum
CREATE TYPE "ReplenishmentGapStatus" AS ENUM ('PENDING', 'PARTIAL_FILLED', 'FILLED', 'CANCELED');

-- CreateTable
CREATE TABLE "ReplenishmentGap" (
    "id" UUID NOT NULL,
    "discrepancyId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "remainingQuantity" DECIMAL(20,6) NOT NULL,
    "status" "ReplenishmentGapStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReplenishmentGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplenishmentGap_discrepancyId_key" ON "ReplenishmentGap"("discrepancyId");

-- CreateIndex
CREATE INDEX "ReplenishmentGap_orderItemId_status_idx" ON "ReplenishmentGap"("orderItemId", "status");

-- CreateIndex
CREATE INDEX "ReplenishmentGap_status_idx" ON "ReplenishmentGap"("status");

-- AddForeignKey
ALTER TABLE "ReplenishmentGap" ADD CONSTRAINT "ReplenishmentGap_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "Discrepancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentGap" ADD CONSTRAINT "ReplenishmentGap_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
