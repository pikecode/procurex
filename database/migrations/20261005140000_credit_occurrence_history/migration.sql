ALTER TABLE "StoreAccount" ADD COLUMN "creditCumulative" DECIMAL(20,2);
ALTER TABLE "StoreAccount" ALTER COLUMN "creditCumulative" SET DEFAULT 0;

CREATE TABLE "CreditMovement" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "fundingAllocationId" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "outstandingAfter" DECIMAL(20,2) NOT NULL,
  "sourceType" "LedgerSourceType" NOT NULL,
  "sourceId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditMovement_valid_amount" CHECK ("amount" > 0 AND "outstandingAfter" >= 0),
  CONSTRAINT "CreditMovement_valid_kind" CHECK ("kind" IN ('BOOKING', 'RELEASE', 'CLEARING')),
  CONSTRAINT "CreditMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StoreAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CreditMovement_fundingAllocationId_fkey" FOREIGN KEY ("fundingAllocationId") REFERENCES "FundingAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CreditMovement_accountId_occurredAt_idx" ON "CreditMovement"("accountId", "occurredAt");
CREATE INDEX "CreditMovement_fundingAllocationId_idx" ON "CreditMovement"("fundingAllocationId");
