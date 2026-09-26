ALTER TABLE "DifferenceDisposalItem" ADD COLUMN "adjustmentDocumentId" UUID;
CREATE UNIQUE INDEX "DifferenceDisposalItem_adjustmentDocumentId_key" ON "DifferenceDisposalItem"("adjustmentDocumentId");
ALTER TABLE "DifferenceDisposalItem" ADD CONSTRAINT "DifferenceDisposalItem_adjustmentDocumentId_fkey" FOREIGN KEY ("adjustmentDocumentId") REFERENCES "AdjustmentDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
