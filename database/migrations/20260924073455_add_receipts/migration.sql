-- CreateTable
CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "receiptNo" VARCHAR(80) NOT NULL,
    "shipmentId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "shipmentItemId" UUID NOT NULL,
    "receivedQuantity" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNo_key" ON "Receipt"("receiptNo");

-- CreateIndex
CREATE INDEX "Receipt_shipmentId_isCurrent_idx" ON "Receipt"("shipmentId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_shipmentId_revision_key" ON "Receipt"("shipmentId", "revision");

-- CreateIndex
CREATE INDEX "ReceiptItem_shipmentItemId_idx" ON "ReceiptItem"("shipmentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptItem_receiptId_shipmentItemId_key" ON "ReceiptItem"("receiptId", "shipmentItemId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
