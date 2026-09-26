CREATE TABLE "Overpayment" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Overpayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Overpayment_paymentId_storeId_supplierId_sourceRevision_key" ON "Overpayment"("paymentId", "storeId", "supplierId", "sourceRevision");
CREATE INDEX "Overpayment_storeId_supplierId_createdAt_idx" ON "Overpayment"("storeId", "supplierId", "createdAt");
ALTER TABLE "Overpayment" ADD CONSTRAINT "Overpayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Overpayment" ADD CONSTRAINT "Overpayment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Overpayment" ADD CONSTRAINT "Overpayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
