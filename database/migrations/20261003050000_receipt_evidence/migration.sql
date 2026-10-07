ALTER TABLE "FileObject" ADD COLUMN "receiptId" UUID;
CREATE INDEX "FileObject_receiptId_idx" ON "FileObject"("receiptId");
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
