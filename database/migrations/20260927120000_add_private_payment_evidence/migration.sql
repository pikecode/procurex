CREATE TABLE "FileObject" (
    "id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "objectKey" VARCHAR(100) NOT NULL,
    "checksum" VARCHAR(64),
    "uploadTokenHash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UPLOADING',
    "ownerId" UUID NOT NULL,
    "paymentId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FileObject_objectKey_key" ON "FileObject"("objectKey");
CREATE INDEX "FileObject_ownerId_status_idx" ON "FileObject"("ownerId", "status");
CREATE INDEX "FileObject_paymentId_idx" ON "FileObject"("paymentId");
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
