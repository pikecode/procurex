CREATE TABLE "TemplateStoreSupplierCycle" (
  "id" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "storeId" UUID NOT NULL,
  "supplierId" UUID NOT NULL,
  "settlementCycle" VARCHAR(40) NOT NULL,
  CONSTRAINT "TemplateStoreSupplierCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TemplateStoreSupplierCycle_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE,
  CONSTRAINT "TemplateStoreSupplierCycle_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id"),
  CONSTRAINT "TemplateStoreSupplierCycle_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id"),
  CONSTRAINT "TemplateStoreSupplierCycle_cycle_check" CHECK ("settlementCycle" IN ('IMMEDIATE', 'WEEKLY', 'HALF_MONTHLY', 'MONTHLY'))
);
CREATE UNIQUE INDEX "TemplateStoreSupplierCycle_templateId_storeId_supplierId_key" ON "TemplateStoreSupplierCycle"("templateId", "storeId", "supplierId");
