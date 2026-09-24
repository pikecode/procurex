-- CreateTable
CREATE TABLE "ClearingDocument" (
    "id" UUID NOT NULL,
    "clearingNo" VARCHAR(80) NOT NULL,
    "storeId" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "remark" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearingItem" (
    "id" UUID NOT NULL,
    "clearingId" UUID NOT NULL,
    "fundingAllocationId" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClearingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClearingDocument_clearingNo_key" ON "ClearingDocument"("clearingNo");

-- CreateIndex
CREATE INDEX "ClearingDocument_storeId_businessDate_idx" ON "ClearingDocument"("storeId", "businessDate");

-- CreateIndex
CREATE INDEX "ClearingItem_clearingId_idx" ON "ClearingItem"("clearingId");

-- CreateIndex
CREATE INDEX "ClearingItem_fundingAllocationId_idx" ON "ClearingItem"("fundingAllocationId");

-- AddForeignKey
ALTER TABLE "ClearingDocument" ADD CONSTRAINT "ClearingDocument_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingItem" ADD CONSTRAINT "ClearingItem_clearingId_fkey" FOREIGN KEY ("clearingId") REFERENCES "ClearingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearingItem" ADD CONSTRAINT "ClearingItem_fundingAllocationId_fkey" FOREIGN KEY ("fundingAllocationId") REFERENCES "FundingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
