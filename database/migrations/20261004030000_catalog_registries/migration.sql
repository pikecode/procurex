ALTER TABLE "Category" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Unit" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "Brand" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");
ALTER TABLE "Product" ADD COLUMN "brandId" UUID, ADD COLUMN "barcode" VARCHAR(100);
-- Only real existing text brands are linked; original text remains for compatibility.
INSERT INTO "Brand" ("id", "name")
SELECT gen_random_uuid(), names."name" FROM (
  SELECT DISTINCT btrim("brand") AS "name" FROM "Product" WHERE "brand" IS NOT NULL AND btrim("brand") <> ''
) names;
UPDATE "Product" SET "brandId" = "Brand"."id" FROM "Brand" WHERE btrim("Product"."brand") = "Brand"."name";
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
