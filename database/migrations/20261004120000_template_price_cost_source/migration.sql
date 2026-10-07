-- A template version records the actual shared cost observed on publication/copy.
-- Existing missing source identities remain unknown.
ALTER TABLE "PriceVersion" ADD COLUMN "supplySourceVersionId" UUID;
