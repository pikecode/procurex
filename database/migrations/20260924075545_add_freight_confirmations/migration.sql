-- CreateEnum
CREATE TYPE "FreightConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'USED');

-- CreateTable
CREATE TABLE "FreightConfirmation" (
    "id" UUID NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "status" "FreightConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMPTZ(6),
    "rejectedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreightConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreightConfirmation_supplierOrderId_status_idx" ON "FreightConfirmation"("supplierOrderId", "status");

-- AddForeignKey
ALTER TABLE "FreightConfirmation" ADD CONSTRAINT "FreightConfirmation_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
