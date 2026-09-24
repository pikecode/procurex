-- AlterTable
ALTER TABLE "SupplierOrder" ADD COLUMN     "settlementCycleSnapshot" VARCHAR(40) NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "settlementMode" "SettlementMode" NOT NULL DEFAULT 'COMPANY_TERM';
