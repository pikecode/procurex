ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "carrierName" VARCHAR(120);
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "carrierId" UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Shipment_carrierId_fkey'
          AND conrelid = '"Shipment"'::regclass
    ) THEN
        ALTER TABLE "Shipment"
            ADD CONSTRAINT "Shipment_carrierId_fkey"
            FOREIGN KEY ("carrierId") REFERENCES "LogisticsCompany"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
