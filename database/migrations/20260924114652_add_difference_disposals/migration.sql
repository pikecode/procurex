-- CreateEnum
CREATE TYPE "DifferenceDisposalMethod" AS ENUM ('OFFSET', 'OFFLINE_RETURN');

-- CreateEnum
CREATE TYPE "DifferenceDisposalStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "DifferenceDisposalDirection" AS ENUM ('SUPPLIER_TO_COMPANY', 'COMPANY_TO_STORE');

-- CreateTable
CREATE TABLE "DifferenceDisposal" (
    "id" UUID NOT NULL,
    "disposalNo" VARCHAR(80) NOT NULL,
    "direction" "DifferenceDisposalDirection" NOT NULL,
    "method" "DifferenceDisposalMethod" NOT NULL,
    "storeId" UUID,
    "supplierId" UUID,
    "amount" DECIMAL(20,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "DifferenceDisposalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DifferenceDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DifferenceDisposalItem" (
    "id" UUID NOT NULL,
    "disposalId" UUID NOT NULL,
    "creditItemId" UUID NOT NULL,
    "targetDebitItemId" VARCHAR(300),
    "amount" DECIMAL(20,2) NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DifferenceDisposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DifferenceDisposal_disposalNo_key" ON "DifferenceDisposal"("disposalNo");

-- CreateIndex
CREATE INDEX "DifferenceDisposal_direction_status_businessDate_idx" ON "DifferenceDisposal"("direction", "status", "businessDate");

-- CreateIndex
CREATE INDEX "DifferenceDisposal_storeId_status_idx" ON "DifferenceDisposal"("storeId", "status");

-- CreateIndex
CREATE INDEX "DifferenceDisposal_supplierId_status_idx" ON "DifferenceDisposal"("supplierId", "status");

-- CreateIndex
CREATE INDEX "DifferenceDisposalItem_disposalId_idx" ON "DifferenceDisposalItem"("disposalId");

-- CreateIndex
CREATE UNIQUE INDEX "DifferenceDisposalItem_creditItemId_key" ON "DifferenceDisposalItem"("creditItemId");

-- AddForeignKey
ALTER TABLE "DifferenceDisposalItem" ADD CONSTRAINT "DifferenceDisposalItem_disposalId_fkey" FOREIGN KEY ("disposalId") REFERENCES "DifferenceDisposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DifferenceDisposalItem" ADD CONSTRAINT "DifferenceDisposalItem_creditItemId_fkey" FOREIGN KEY ("creditItemId") REFERENCES "DiscrepancyReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
