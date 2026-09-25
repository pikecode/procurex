-- DropForeignKey
ALTER TABLE "SettlementItemSnapshot" DROP CONSTRAINT "SettlementItemSnapshot_supplierOrderId_fkey";

-- AddForeignKey
ALTER TABLE "SettlementItemSnapshot" ADD CONSTRAINT "SettlementItemSnapshot_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
