-- AlterTable
ALTER TABLE "SupplierOrder" ADD COLUMN     "completedAt" TIMESTAMPTZ(6);

UPDATE "SupplierOrder" AS orders
SET "completedAt" = COALESCE(
  NULLIF(GREATEST(
    COALESCE((SELECT MAX(receipts."submittedAt") FROM "Shipment" shipments JOIN "Receipt" receipts ON receipts."shipmentId" = shipments."id" AND receipts."isCurrent" WHERE shipments."supplierOrderId" = orders."id"), '-infinity'::timestamptz),
    COALESCE((SELECT MAX(discrepancies."resolvedAt") FROM "OrderItem" items JOIN "Discrepancy" discrepancies ON discrepancies."orderItemId" = items."id" WHERE items."supplierOrderId" = orders."id"), '-infinity'::timestamptz)
  ), '-infinity'::timestamptz), orders."updatedAt")
WHERE orders."status" = 'COMPLETED';
