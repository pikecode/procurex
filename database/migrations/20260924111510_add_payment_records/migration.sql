-- CreateEnum
CREATE TYPE "PaymentRecordDirection" AS ENUM ('STORE_TO_COMPANY', 'COMPANY_TO_SUPPLIER');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentAllocationState" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED');

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" UUID NOT NULL,
    "paymentNo" VARCHAR(80) NOT NULL,
    "direction" "PaymentRecordDirection" NOT NULL,
    "storeId" UUID,
    "supplierId" UUID,
    "amount" DECIMAL(20,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'PENDING',
    "remark" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMPTZ(6),
    "rejectedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "settlementItemId" VARCHAR(300) NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "state" "PaymentAllocationState" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_paymentNo_key" ON "PaymentRecord"("paymentNo");

-- CreateIndex
CREATE INDEX "PaymentRecord_direction_status_businessDate_idx" ON "PaymentRecord"("direction", "status", "businessDate");

-- CreateIndex
CREATE INDEX "PaymentRecord_storeId_status_idx" ON "PaymentRecord"("storeId", "status");

-- CreateIndex
CREATE INDEX "PaymentRecord_supplierId_status_idx" ON "PaymentRecord"("supplierId", "status");

-- CreateIndex
CREATE INDEX "PaymentAllocation_settlementItemId_state_idx" ON "PaymentAllocation"("settlementItemId", "state");

-- CreateIndex
CREATE INDEX "PaymentAllocation_supplierOrderId_idx" ON "PaymentAllocation"("supplierOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_settlementItemId_key" ON "PaymentAllocation"("paymentId", "settlementItemId");

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
