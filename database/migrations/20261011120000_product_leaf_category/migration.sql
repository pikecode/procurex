-- Products may only reference leaf categories. A category that has children is a grouping node,
-- so it cannot hold products. Enforced here as well as in the API because
-- "Category_parentId_fkey" is ON DELETE SET NULL: deleting a parent silently promotes its children to
-- roots, which the application layer never sees and therefore cannot validate.
CREATE OR REPLACE FUNCTION product_category_must_be_leaf() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Category" child WHERE child."parentId" IS NOT NULL AND child."parentId" = NEW."categoryId") THEN
    RAISE EXCEPTION 'CATEGORY_MUST_BE_LEAF: product % references category % which still has child categories', NEW.id, NEW."categoryId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_category_must_be_leaf_insert
  BEFORE INSERT OR UPDATE OF "categoryId" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION product_category_must_be_leaf();

-- Adding a child to a category that already holds products would strand those products.
CREATE OR REPLACE FUNCTION category_child_requires_no_products() RETURNS TRIGGER AS $$
DECLARE
  parent_id UUID;
BEGIN
  parent_id := COALESCE(NEW."parentId", OLD."parentId");
  IF parent_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "Product" WHERE "categoryId" = parent_id) THEN
    RAISE EXCEPTION 'CATEGORY_ALREADY_HAS_PRODUCTS: category % already holds products and cannot gain child category %', parent_id, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER category_child_requires_no_products_insert
  BEFORE INSERT OR UPDATE OF "parentId" ON "Category"
  FOR EACH ROW WHEN (NEW."parentId" IS NOT NULL)
  EXECUTE FUNCTION category_child_requires_no_products();

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");