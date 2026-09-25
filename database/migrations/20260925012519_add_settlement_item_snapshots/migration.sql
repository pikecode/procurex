-- CreateTable
CREATE TABLE "SettlementItemSnapshot" (
    "id" UUID NOT NULL,
    "settlementItemId" VARCHAR(300) NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "goodsAmount" DECIMAL(20,2) NOT NULL,
    "freightAmount" DECIMAL(20,2) NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementItemSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettlementItemSnapshot_settlementItemId_key" ON "SettlementItemSnapshot"("settlementItemId");

-- CreateIndex
CREATE INDEX "SettlementItemSnapshot_supplierOrderId_idx" ON "SettlementItemSnapshot"("supplierOrderId");

-- AddForeignKey
ALTER TABLE "SettlementItemSnapshot" ADD CONSTRAINT "SettlementItemSnapshot_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
