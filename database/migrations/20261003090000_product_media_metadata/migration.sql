ALTER TABLE "Product" ADD COLUMN "specification" VARCHAR(240), ADD COLUMN "brand" VARCHAR(120), ADD COLUMN "storageCondition" VARCHAR(24), ADD COLUMN "imageFileId" UUID;
CREATE UNIQUE INDEX "Product_imageFileId_key" ON "Product"("imageFileId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_imageFileId_fkey" FOREIGN KEY ("imageFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
