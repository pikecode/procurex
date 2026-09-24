-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "rejectedAt" TIMESTAMPTZ(6),
ADD COLUMN     "rejectedReason" VARCHAR(300);
