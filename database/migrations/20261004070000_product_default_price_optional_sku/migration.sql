-- Missing historical default prices are unknown, not zero or current effective prices.
ALTER TABLE "Product" ALTER COLUMN "sku" DROP NOT NULL;
ALTER TABLE "Product" ADD COLUMN "defaultSalesPrice" DECIMAL(20,6);
ALTER TABLE "TemplateItem" ADD COLUMN "initialSalesPrice" DECIMAL(20,6);
