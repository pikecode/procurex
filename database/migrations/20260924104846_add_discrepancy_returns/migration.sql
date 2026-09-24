-- CreateTable
CREATE TABLE "DiscrepancyReturn" (
    "id" UUID NOT NULL,
    "discrepancyId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscrepancyReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscrepancyReturn_discrepancyId_key" ON "DiscrepancyReturn"("discrepancyId");

-- CreateIndex
CREATE INDEX "DiscrepancyReturn_orderItemId_createdAt_idx" ON "DiscrepancyReturn"("orderItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiscrepancyReturn" ADD CONSTRAINT "DiscrepancyReturn_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "Discrepancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyReturn" ADD CONSTRAINT "DiscrepancyReturn_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
