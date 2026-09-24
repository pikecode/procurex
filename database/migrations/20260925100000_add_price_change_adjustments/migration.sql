CREATE TABLE "PriceChangeAdjustment" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "supplierOrderId" UUID NOT NULL,
  "orderItemId" UUID NOT NULL,
  "previousSalesPrice" DECIMAL(20,6) NOT NULL,
  "newSalesPrice" DECIMAL(20,6) NOT NULL,
  "previousSupplyPrice" DECIMAL(20,6) NOT NULL,
  "newSupplyPrice" DECIMAL(20,6) NOT NULL,
  "salesDelta" DECIMAL(20,2) NOT NULL,
  "supplyDelta" DECIMAL(20,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceChangeAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceChangeAdjustment_runId_orderItemId_key" ON "PriceChangeAdjustment"("runId", "orderItemId");
CREATE UNIQUE INDEX "PriceChangeAdjustment_runId_supplierOrderId_key" ON "PriceChangeAdjustment"("runId", "supplierOrderId");
CREATE INDEX "PriceChangeAdjustment_supplierOrderId_idx" ON "PriceChangeAdjustment"("supplierOrderId");
ALTER TABLE "PriceChangeAdjustment" ADD CONSTRAINT "PriceChangeAdjustment_runId_supplierOrderId_fkey" FOREIGN KEY ("runId", "supplierOrderId") REFERENCES "PriceChangeRunOrder"("runId", "supplierOrderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceChangeAdjustment" ADD CONSTRAINT "PriceChangeAdjustment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
