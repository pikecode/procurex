-- Preserve unknown historical price sources. New transactions record each side independently.
ALTER TABLE "RequestItem" ADD COLUMN "supplyPriceVersionId" UUID;
ALTER TABLE "OrderItem" ADD COLUMN "salesPriceVersionId" UUID, ADD COLUMN "supplyPriceVersionId" UUID;
