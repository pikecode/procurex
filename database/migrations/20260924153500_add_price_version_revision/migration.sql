ALTER TABLE "PriceVersion" ADD COLUMN "revision" INTEGER;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "scopeId"
    ORDER BY "effectiveAt" ASC, "createdAt" ASC, "id" ASC
  ) AS revision
  FROM "PriceVersion"
)
UPDATE "PriceVersion" AS version
SET "revision" = ranked.revision
FROM ranked
WHERE version."id" = ranked."id";

ALTER TABLE "PriceVersion" ALTER COLUMN "revision" SET DEFAULT 1;
ALTER TABLE "PriceVersion" ALTER COLUMN "revision" SET NOT NULL;
CREATE UNIQUE INDEX "PriceVersion_scopeId_revision_key" ON "PriceVersion"("scopeId", "revision");
