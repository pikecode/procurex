ALTER TABLE "RequestItem" ADD COLUMN "settlementModeSnapshot" "SettlementMode",
  ADD COLUMN "settlementCycleSnapshot" VARCHAR(40);
ALTER TABLE "FundingAllocation" ADD COLUMN "requestId" UUID, ADD COLUMN "supplierId" UUID;
CREATE INDEX "FundingAllocation_requestId_active_idx" ON "FundingAllocation"("requestId", "active");
CREATE UNIQUE INDEX "FundingAllocation_active_request_supplier_key"
  ON "FundingAllocation"("requestId", "supplierId") WHERE "active" AND "requestId" IS NOT NULL AND "supplierId" IS NOT NULL;
ALTER TABLE "AccountLedger" ADD COLUMN "requestId" UUID;
CREATE INDEX "AccountLedger_requestId_idx" ON "AccountLedger"("requestId");
