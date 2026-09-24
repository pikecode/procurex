CREATE TYPE "PriceChangeRunStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "PriceChangeRun" (
  "id" UUID NOT NULL,
  "status" "PriceChangeRunStatus" NOT NULL DEFAULT 'PENDING',
  "affectedOrderCount" INTEGER NOT NULL DEFAULT 0,
  "salesDelta" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "supplyDelta" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceChangeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceChangeRunVersion" (
  "runId" UUID NOT NULL,
  "priceVersionId" UUID NOT NULL,
  CONSTRAINT "PriceChangeRunVersion_pkey" PRIMARY KEY ("runId", "priceVersionId")
);

CREATE INDEX "PriceChangeRunVersion_priceVersionId_idx" ON "PriceChangeRunVersion"("priceVersionId");
ALTER TABLE "PriceChangeRunVersion" ADD CONSTRAINT "PriceChangeRunVersion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PriceChangeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceChangeRunVersion" ADD CONSTRAINT "PriceChangeRunVersion_priceVersionId_fkey" FOREIGN KEY ("priceVersionId") REFERENCES "PriceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
