-- CreateEnum
CREATE TYPE "FundingAllocationMethod" AS ENUM ('STORED_VALUE', 'CREDIT');

-- CreateTable
CREATE TABLE "FundingAllocation" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "supplierOrderId" UUID,
    "method" "FundingAllocationMethod" NOT NULL,
    "targetAmount" DECIMAL(20,2) NOT NULL,
    "netPaid" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "creditOutstanding" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FundingAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingAllocation_storeId_active_idx" ON "FundingAllocation"("storeId", "active");

-- CreateIndex
CREATE INDEX "FundingAllocation_supplierOrderId_idx" ON "FundingAllocation"("supplierOrderId");

-- AddForeignKey
ALTER TABLE "FundingAllocation" ADD CONSTRAINT "FundingAllocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreAccount"("storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingAllocation" ADD CONSTRAINT "FundingAllocation_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
