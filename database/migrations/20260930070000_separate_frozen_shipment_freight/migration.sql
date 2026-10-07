ALTER TABLE "AdjustmentDocument" ADD COLUMN "shipmentAdjustmentKind" TEXT;
UPDATE "AdjustmentDocument" SET "shipmentAdjustmentKind" = 'REDUCTION' WHERE "sourceShipmentId" IS NOT NULL;
DROP INDEX "AdjustmentDocument_sourceShipmentId_side_key";
CREATE UNIQUE INDEX "AdjustmentDocument_sourceShipmentId_side_shipmentAdjustmentKind_key" ON "AdjustmentDocument"("sourceShipmentId", "side", "shipmentAdjustmentKind");
ALTER TABLE "AdjustmentDocument" ADD CONSTRAINT "AdjustmentDocument_shipment_kind_check" CHECK (
  ("sourceShipmentId" IS NULL AND "shipmentAdjustmentKind" IS NULL) OR
  ("sourceShipmentId" IS NOT NULL AND "shipmentAdjustmentKind" IS NOT NULL AND "shipmentAdjustmentKind" IN ('REDUCTION', 'FREIGHT'))
);
