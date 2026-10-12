CREATE TABLE "ShipmentRevision" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "expectedOrderVersion" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentRevisionItem" (
    "id" UUID NOT NULL,
    "shipmentRevisionId" UUID NOT NULL,
    "shipmentItemId" UUID NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentRevisionItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FileObject" ADD COLUMN "shipmentRevisionId" UUID;

CREATE UNIQUE INDEX "ShipmentRevision_shipmentId_revision_key" ON "ShipmentRevision"("shipmentId", "revision");
CREATE INDEX "ShipmentRevision_shipmentId_createdAt_idx" ON "ShipmentRevision"("shipmentId", "createdAt");
CREATE UNIQUE INDEX "ShipmentRevisionItem_shipmentRevisionId_shipmentItemId_key" ON "ShipmentRevisionItem"("shipmentRevisionId", "shipmentItemId");
CREATE INDEX "ShipmentRevisionItem_shipmentItemId_createdAt_idx" ON "ShipmentRevisionItem"("shipmentItemId", "createdAt");
CREATE INDEX "FileObject_shipmentRevisionId_idx" ON "FileObject"("shipmentRevisionId");

ALTER TABLE "ShipmentRevision" ADD CONSTRAINT "ShipmentRevision_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentRevision" ADD CONSTRAINT "ShipmentRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentRevisionItem" ADD CONSTRAINT "ShipmentRevisionItem_shipmentRevisionId_fkey" FOREIGN KEY ("shipmentRevisionId") REFERENCES "ShipmentRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentRevisionItem" ADD CONSTRAINT "ShipmentRevisionItem_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_shipmentRevisionId_fkey" FOREIGN KEY ("shipmentRevisionId") REFERENCES "ShipmentRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ShipmentRevision" ("id", "shipmentId", "revision", "expectedOrderVersion", "note", "actorUserId", "createdAt")
SELECT gen_random_uuid(), s."id", 1, 0, '历史发货记录迁移快照', NULL, s."createdAt"
FROM "Shipment" s;

INSERT INTO "ShipmentRevisionItem" ("id", "shipmentRevisionId", "shipmentItemId", "quantity", "createdAt")
SELECT gen_random_uuid(), sr."id", si."id", si."quantity", si."createdAt"
FROM "ShipmentItem" si
JOIN "ShipmentRevision" sr ON sr."shipmentId" = si."shipmentId";

