-- Empty key denotes the existing shared scope; historical versions are not rewritten.
ALTER TABLE "PriceScope" ADD COLUMN "templateKey" VARCHAR(36) NOT NULL DEFAULT '';
DROP INDEX "PriceScope_productId_supplierId_key";
CREATE UNIQUE INDEX "PriceScope_productId_supplierId_templateKey_key" ON "PriceScope"("productId", "supplierId", "templateKey");
ALTER TABLE "PriceScope" ADD CONSTRAINT "PriceScope_templateKey_format" CHECK ("templateKey" = '' OR "templateKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
