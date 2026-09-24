-- CreateTable
CREATE TABLE "RechargeDocument" (
    "id" UUID NOT NULL,
    "rechargeNo" VARCHAR(80) NOT NULL,
    "storeId" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "collectionAccountId" VARCHAR(80) NOT NULL,
    "remark" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RechargeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RechargeDocument_rechargeNo_key" ON "RechargeDocument"("rechargeNo");

-- CreateIndex
CREATE INDEX "RechargeDocument_storeId_businessDate_idx" ON "RechargeDocument"("storeId", "businessDate");

-- AddForeignKey
ALTER TABLE "RechargeDocument" ADD CONSTRAINT "RechargeDocument_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
