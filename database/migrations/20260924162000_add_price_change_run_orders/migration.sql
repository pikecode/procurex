CREATE TYPE "PriceChangeRunOrderStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "PriceChangeRunOrder" (
  "runId" UUID NOT NULL,
  "supplierOrderId" UUID NOT NULL,
  "status" "PriceChangeRunOrderStatus" NOT NULL DEFAULT 'PENDING',
  "salesDelta" DECIMAL(20,2) NOT NULL,
  "supplyDelta" DECIMAL(20,2) NOT NULL,
  CONSTRAINT "PriceChangeRunOrder_pkey" PRIMARY KEY ("runId", "supplierOrderId")
);

CREATE INDEX "PriceChangeRunOrder_supplierOrderId_idx" ON "PriceChangeRunOrder"("supplierOrderId");
ALTER TABLE "PriceChangeRunOrder" ADD CONSTRAINT "PriceChangeRunOrder_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PriceChangeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceChangeRunOrder" ADD CONSTRAINT "PriceChangeRunOrder_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
