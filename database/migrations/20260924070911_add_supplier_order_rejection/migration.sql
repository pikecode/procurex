-- AlterTable
ALTER TABLE "SupplierOrder" ADD COLUMN     "rejectedAt" TIMESTAMPTZ(6),
ADD COLUMN     "rejectedReason" VARCHAR(300);
