ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_FINANCE';
ALTER TABLE "PurchaseRequest"
  ADD COLUMN "procurementConfirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN "financeReviewedAt" TIMESTAMPTZ(6),
  ADD COLUMN "financeReturnedReason" VARCHAR(300);
