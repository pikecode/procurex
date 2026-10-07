-- NULL inherits the product rule. No historical transaction rule is reconstructed.
ALTER TABLE "TemplateItem" ADD COLUMN "minOrderQty" DECIMAL(20,6), ADD COLUMN "orderMultiple" DECIMAL(20,6);
ALTER TABLE "TemplateItem" ADD CONSTRAINT "TemplateItem_positive_rules" CHECK (("minOrderQty" IS NULL OR "minOrderQty" > 0) AND ("orderMultiple" IS NULL OR "orderMultiple" > 0));
