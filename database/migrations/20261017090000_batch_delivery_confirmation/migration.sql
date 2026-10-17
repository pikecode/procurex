ALTER TABLE "SupplierOrder"
  ADD COLUMN "deliveryState" VARCHAR(40),
  ADD COLUMN "deliveryCompletedAt" TIMESTAMPTZ(6),
  ADD COLUMN "deliveryNote" VARCHAR(500),
  ADD COLUMN "deliveryReview" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "closedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0;
ALTER TABLE "ReplenishmentGap" ALTER COLUMN "discrepancyId" DROP NOT NULL;
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_deliveryState_check"
  CHECK ("deliveryState" IS NULL OR "deliveryState" IN ('IN_PROGRESS', 'FINISHED', 'DISPUTED', 'REPLENISHING', 'DECLINED', 'COMPLETED'));
