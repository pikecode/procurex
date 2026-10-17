WITH promoted AS (
  UPDATE "Receipt" r SET "exceptionStatus" = 'SUBMITTED'
  FROM "Shipment" s, "SupplierOrder" o
  WHERE r."shipmentId" = s.id AND s."supplierOrderId" = o.id
    AND r."isCurrent" = true AND r."exceptionStatus" = 'REGISTERED'
    AND o.status NOT IN ('COMPLETED', 'CANCELED', 'REJECTED')
  RETURNING r.id, r."shipmentId"
), bumped AS (
  UPDATE "SupplierOrder" SET version = version + 1
  WHERE id IN (SELECT s."supplierOrderId" FROM promoted p JOIN "Shipment" s ON s.id = p."shipmentId")
  RETURNING id
)
INSERT INTO "Notification" (id, "recipientId", "eventKey", channel, title, body, payload)
SELECT gen_random_uuid(), u.id, 'RECEIPT_DISCREPANCY:' || p.id::text, 'IN_APP',
  '收货异常待处理', '供应商订单 ' || o."supplierOrderNo" || ' 收货存在异常，请处理。',
  jsonb_build_object('type', 'ORDER_DELIVERY', 'supplierOrderId', o.id, 'shipmentId', s.id, 'receiptId', p.id)
FROM promoted p JOIN "Shipment" s ON s.id = p."shipmentId"
JOIN "SupplierOrder" o ON o.id = s."supplierOrderId"
JOIN "UserScope" scope ON scope."scopeType" = 'SUPPLIER' AND scope."supplierId" = o."supplierId"
JOIN "User" u ON u.id = scope."userId" AND u.status = 'ACTIVE'
ON CONFLICT ("recipientId", "eventKey", channel) DO NOTHING;
