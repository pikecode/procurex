-- AlterTable
ALTER TABLE "FreightConfirmation" ADD COLUMN "usedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "freightConfirmationId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_freightConfirmationId_key" ON "Shipment"("freightConfirmationId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_freightConfirmationId_fkey" FOREIGN KEY ("freightConfirmationId") REFERENCES "FreightConfirmation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
