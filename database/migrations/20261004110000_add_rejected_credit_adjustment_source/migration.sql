ALTER TABLE "AdjustmentDocument" ADD COLUMN "sourceRejectedOrderId" UUID;
ALTER TABLE "AdjustmentDocument" DROP CONSTRAINT "AdjustmentDocument_one_source_check";
ALTER TABLE "AdjustmentDocument" ADD CONSTRAINT "AdjustmentDocument_one_source_check"
  CHECK (("sourcePriceChangeId" IS NOT NULL)::int + ("sourceDiscrepancyId" IS NOT NULL)::int +
    ("sourceShipmentId" IS NOT NULL)::int + ("sourceRejectedOrderId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "AdjustmentDocument_sourceRejectedOrderId_side_key"
  ON "AdjustmentDocument"("sourceRejectedOrderId", "side");
