ALTER TABLE "OrderTemplate" ADD COLUMN "tag" VARCHAR(120), ADD COLUMN "remark" VARCHAR(500);
-- Historical missing tags and duplicate names are not fabricated or renamed.
