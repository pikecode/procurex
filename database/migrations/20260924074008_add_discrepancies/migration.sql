-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'REPLENISH_PENDING', 'RESOLVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DiscrepancyActionType" AS ENUM ('REPLENISH', 'RETURN', 'ACCEPT');

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" UUID NOT NULL,
    "receiptItemId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "missingQuantity" DECIMAL(20,6) NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscrepancyAction" (
    "id" UUID NOT NULL,
    "discrepancyId" UUID NOT NULL,
    "action" "DiscrepancyActionType" NOT NULL,
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscrepancyAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Discrepancy_receiptItemId_key" ON "Discrepancy"("receiptItemId");

-- CreateIndex
CREATE INDEX "Discrepancy_orderItemId_idx" ON "Discrepancy"("orderItemId");

-- CreateIndex
CREATE INDEX "Discrepancy_status_idx" ON "Discrepancy"("status");

-- CreateIndex
CREATE INDEX "DiscrepancyAction_discrepancyId_createdAt_idx" ON "DiscrepancyAction"("discrepancyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "ReceiptItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyAction" ADD CONSTRAINT "DiscrepancyAction_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "Discrepancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
