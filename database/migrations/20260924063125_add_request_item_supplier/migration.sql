/*
  Warnings:

  - Added the required column `supplierId` to the `RequestItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "priceVersionId" UUID,
ADD COLUMN     "supplierId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "RequestItem_supplierId_idx" ON "RequestItem"("supplierId");

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
