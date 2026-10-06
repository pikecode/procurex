CREATE TABLE "CollectionAccount" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "bankName" VARCHAR(120) NOT NULL,
  "accountName" VARCHAR(120) NOT NULL,
  "accountNo" VARCHAR(80) NOT NULL,
  "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CollectionAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CollectionAccount_name_key" ON "CollectionAccount"("name");
