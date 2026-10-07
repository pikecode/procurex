ALTER TABLE "AdjustmentDocument" ALTER COLUMN "sourcePriceChangeId" DROP NOT NULL;
ALTER TABLE "AdjustmentDocument" ADD COLUMN "sourceDiscrepancyId" UUID;
ALTER TABLE "AdjustmentDocument" ADD CONSTRAINT "AdjustmentDocument_one_source_check"
  CHECK (("sourcePriceChangeId" IS NOT NULL)::int + ("sourceDiscrepancyId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "AdjustmentDocument_sourceDiscrepancyId_side_key"
  ON "AdjustmentDocument"("sourceDiscrepancyId", "side");
