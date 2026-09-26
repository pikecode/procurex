CREATE TABLE "AdjustmentDocument" (
  "id" UUID NOT NULL,
  "sourcePriceChangeId" UUID NOT NULL,
  "supplierOrderId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "side" VARCHAR(20) NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "originalPeriodKey" VARCHAR(128) NOT NULL,
  "settlementPeriodKey" VARCHAR(128) NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdjustmentDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdjustmentDocument_sourcePriceChangeId_side_key" ON "AdjustmentDocument"("sourcePriceChangeId", "side");
CREATE INDEX "AdjustmentDocument_storeId_supplierId_settlementPeriodKey_idx" ON "AdjustmentDocument"("storeId", "supplierId", "settlementPeriodKey");
CREATE TABLE "AdjustmentDocumentItem" (
  "id" UUID NOT NULL,
  "adjustmentId" UUID NOT NULL,
  "orderItemId" UUID NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdjustmentDocumentItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdjustmentDocumentItem_adjustmentId_orderItemId_key" ON "AdjustmentDocumentItem"("adjustmentId", "orderItemId");
CREATE INDEX "AdjustmentDocumentItem_orderItemId_idx" ON "AdjustmentDocumentItem"("orderItemId");
ALTER TABLE "AdjustmentDocumentItem" ADD CONSTRAINT "AdjustmentDocumentItem_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "AdjustmentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
