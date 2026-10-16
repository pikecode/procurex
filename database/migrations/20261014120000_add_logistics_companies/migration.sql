ALTER TABLE "Shipment" ADD COLUMN "carrierName" VARCHAR(120);
ALTER TABLE "Shipment" ADD COLUMN "carrierId" UUID;

CREATE TABLE "LogisticsCompany" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LogisticsCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LogisticsCompany_name_key" ON "LogisticsCompany"("name");

INSERT INTO "LogisticsCompany" ("id", "name", "updatedAt") VALUES
    (gen_random_uuid(), '顺丰速运', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '京东物流', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '中通快递', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '圆通速递', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '韵达快递', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '中国邮政', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "LogisticsCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
