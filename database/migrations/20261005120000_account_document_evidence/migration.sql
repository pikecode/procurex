ALTER TABLE "FileObject" ADD COLUMN "rechargeId" UUID, ADD COLUMN "clearingId" UUID;
CREATE INDEX "FileObject_rechargeId_idx" ON "FileObject"("rechargeId");
CREATE INDEX "FileObject_clearingId_idx" ON "FileObject"("clearingId");
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "RechargeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_clearingId_fkey" FOREIGN KEY ("clearingId") REFERENCES "ClearingDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_single_document" CHECK (num_nonnulls("paymentId", "receiptId", "rechargeId", "clearingId") <= 1);
