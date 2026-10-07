-- Unknown historical units and conversion values must not be inferred from current products.
ALTER TABLE "RequestItem" ADD COLUMN "unitSnapshot" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "unitSnapshot" JSONB;
