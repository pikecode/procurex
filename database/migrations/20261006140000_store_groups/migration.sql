CREATE TABLE "StoreGroup" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreGroup_name_key" ON "StoreGroup"("name");

UPDATE "Store" SET "groupName" = NULLIF(btrim("groupName"), ''),
  "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond')
WHERE "groupName" IS DISTINCT FROM NULLIF(btrim("groupName"), '');
INSERT INTO "StoreGroup" ("id", "name")
SELECT gen_random_uuid(), "groupName" FROM "Store"
WHERE "groupName" IS NOT NULL GROUP BY "groupName";
CREATE INDEX "Store_groupName_idx" ON "Store"("groupName");
ALTER TABLE "Store" ADD CONSTRAINT "Store_groupName_fkey"
FOREIGN KEY ("groupName") REFERENCES "StoreGroup"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
