-- Legacy missing profile values are unknown, not invented business defaults.
ALTER TABLE "Store"
  ADD COLUMN "groupName" VARCHAR(120),
  ADD COLUMN "storeType" VARCHAR(20),
  ADD COLUMN "receiptAddress" VARCHAR(300),
  ADD COLUMN "receiptContactName" VARCHAR(120),
  ADD COLUMN "receiptContactPhone" VARCHAR(32),
  ADD CONSTRAINT "Store_storeType_check" CHECK ("storeType" IN ('DIRECT', 'FRANCHISE', 'JOINT')),
  ADD CONSTRAINT "Store_receipt_check" CHECK (
    ("receiptAddress" IS NULL AND "receiptContactName" IS NULL AND "receiptContactPhone" IS NULL)
    OR ("receiptAddress" IS NOT NULL AND "receiptContactName" IS NOT NULL AND "receiptContactPhone" IS NOT NULL)
  );
ALTER TABLE "Supplier"
  ADD COLUMN "address" VARCHAR(300),
  ADD COLUMN "bankName" VARCHAR(200),
  ADD COLUMN "bankAccountName" VARCHAR(200),
  ADD COLUMN "bankAccount" VARCHAR(80),
  ADD COLUMN "taxpayerId" VARCHAR(80),
  ADD COLUMN "invoiceTitle" VARCHAR(200),
  ADD COLUMN "requiresFreight" BOOLEAN,
  ADD COLUMN "supplierType" VARCHAR(20),
  ADD COLUMN "settlementCycleDescription" VARCHAR(500),
  ADD COLUMN "remark" VARCHAR(500),
  ADD CONSTRAINT "Supplier_supplierType_check" CHECK ("supplierType" IN ('HEADQUARTERS', 'DIRECT'));
-- Old orders keep their existing freight-confirmation behavior.
ALTER TABLE "SupplierOrder" ADD COLUMN "requiresFreightSnapshot" BOOLEAN;
