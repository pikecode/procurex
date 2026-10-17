CREATE TABLE "ReceiptExceptionReply" (
  "id" UUID NOT NULL,
  "receiptId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "decision" VARCHAR(20) NOT NULL,
  "note" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceiptExceptionReply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceiptExceptionReply_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceiptExceptionReply_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ReceiptExceptionReply_receiptId_createdAt_idx" ON "ReceiptExceptionReply"("receiptId", "createdAt");
ALTER TABLE "FileObject" ADD COLUMN "receiptExceptionReplyId" UUID;
CREATE INDEX "FileObject_receiptExceptionReplyId_idx" ON "FileObject"("receiptExceptionReplyId");
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_receiptExceptionReplyId_fkey" FOREIGN KEY ("receiptExceptionReplyId") REFERENCES "ReceiptExceptionReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ReceiptExceptionReply" (id, "receiptId", "actorUserId", decision, note, "createdAt")
SELECT gen_random_uuid(), r.id, a."actorUserId", a.after->>'decision', a.after->>'reason', a."createdAt"
FROM "AuditLog" a JOIN "Receipt" r ON r.id::text = a.after->>'receiptId'
WHERE a.action = 'supplier-order.respond-receipt-exception'
  AND a.after->>'decision' IN ('HANDLED', 'DECLINED')
  AND length(trim(a.after->>'reason')) BETWEEN 1 AND 500;
