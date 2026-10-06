-- Existing requests retain their original cash accounting policy.
ALTER TABLE "PurchaseRequest" ADD COLUMN "storedValueOnReceipt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreAccount" ADD COLUMN "reservedBalance" DECIMAL(20,2) NOT NULL DEFAULT 0;
ALTER TABLE "FundingAllocation" ADD COLUMN "reservedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0;
ALTER TABLE "StoreAccount" ADD CONSTRAINT "StoreAccount_reservedBalance_nonnegative" CHECK ("reservedBalance" >= 0);
ALTER TABLE "FundingAllocation" ADD CONSTRAINT "FundingAllocation_reservedAmount_nonnegative" CHECK ("reservedAmount" >= 0);
