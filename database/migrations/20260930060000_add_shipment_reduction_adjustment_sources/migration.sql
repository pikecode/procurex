ALTER TABLE "AdjustmentDocument" ADD COLUMN "sourceShipmentId" UUID;
ALTER TABLE "AdjustmentDocument" DROP CONSTRAINT "AdjustmentDocument_one_source_check";
ALTER TABLE "AdjustmentDocument" ADD CONSTRAINT "AdjustmentDocument_one_source_check"
  CHECK (("sourcePriceChangeId" IS NOT NULL)::int + ("sourceDiscrepancyId" IS NOT NULL)::int + ("sourceShipmentId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "AdjustmentDocument_sourceShipmentId_side_key"
  ON "AdjustmentDocument"("sourceShipmentId", "side");
