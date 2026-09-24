-- CreateTable
CREATE TABLE "ShipmentGapAllocation" (
    "id" UUID NOT NULL,
    "shipmentItemId" UUID NOT NULL,
    "gapId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentGapAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentGapAllocation_gapId_idx" ON "ShipmentGapAllocation"("gapId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentGapAllocation_shipmentItemId_gapId_key" ON "ShipmentGapAllocation"("shipmentItemId", "gapId");

-- AddForeignKey
ALTER TABLE "ShipmentGapAllocation" ADD CONSTRAINT "ShipmentGapAllocation_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentGapAllocation" ADD CONSTRAINT "ShipmentGapAllocation_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "ReplenishmentGap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
