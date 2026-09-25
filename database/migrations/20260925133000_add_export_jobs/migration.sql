CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'READY', 'FAILED');

CREATE TABLE "ExportJob" (
  "id" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "reportType" VARCHAR(40) NOT NULL,
  "filters" JSONB NOT NULL,
  "permissionScope" JSONB NOT NULL,
  "asOf" TIMESTAMPTZ(6) NOT NULL,
  "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "csvContent" TEXT,
  "errorMessage" VARCHAR(500),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ExportJob_requestedById_createdAt_idx" ON "ExportJob"("requestedById", "createdAt");
CREATE INDEX "ExportJob_status_expiresAt_idx" ON "ExportJob"("status", "expiresAt");
