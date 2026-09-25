CREATE TYPE "UserScopeType" AS ENUM ('COMPANY', 'STORE', 'SUPPLIER');

CREATE TABLE "UserScope" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "scopeType" "UserScopeType" NOT NULL,
  "storeId" UUID,
  "supplierId" UUID,
  CONSTRAINT "UserScope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserScope_userId_key" UNIQUE ("userId"),
  CONSTRAINT "UserScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserScope_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UserScope_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "UserScope_storeId_idx" ON "UserScope"("storeId");
CREATE INDEX "UserScope_supplierId_idx" ON "UserScope"("supplierId");
