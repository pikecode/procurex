-- CreateEnum
CREATE TYPE "ShipmentKind" AS ENUM ('INITIAL', 'REPLENISHMENT');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "shipmentNo" VARCHAR(80) NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "ShipmentKind" NOT NULL,
    "shippedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackingNo" VARCHAR(100),
    "freight" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "permanentlyReduced" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "salesPriceSnapshot" DECIMAL(20,6) NOT NULL,
    "supplyPriceSnapshot" DECIMAL(20,6) NOT NULL,
    "salesLineAmount" DECIMAL(20,2) NOT NULL,
    "supplyLineAmount" DECIMAL(20,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNo_key" ON "Shipment"("shipmentNo");

-- CreateIndex
CREATE INDEX "Shipment_supplierOrderId_shippedAt_idx" ON "Shipment"("supplierOrderId", "shippedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_supplierOrderId_sequence_key" ON "Shipment"("supplierOrderId", "sequence");

-- CreateIndex
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_orderItemId_key" ON "ShipmentItem"("shipmentId", "orderItemId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
