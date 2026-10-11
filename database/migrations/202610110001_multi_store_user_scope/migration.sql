ALTER TYPE "UserScopeType" ADD VALUE 'MULTI_STORE';

CREATE TABLE "UserScopeStore" (
    "scopeId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    CONSTRAINT "UserScopeStore_pkey" PRIMARY KEY ("scopeId", "storeId")
);

CREATE INDEX "UserScopeStore_storeId_idx" ON "UserScopeStore"("storeId");
ALTER TABLE "UserScopeStore" ADD CONSTRAINT "UserScopeStore_scopeId_fkey"
    FOREIGN KEY ("scopeId") REFERENCES "UserScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserScopeStore" ADD CONSTRAINT "UserScopeStore_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Role" ("id", "code", "name", "description", "updatedAt") VALUES
    (gen_random_uuid(), 'REGION_MANAGER', '区域经理', '查看指定门店的订单与财务报表', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PURCHASE_FOLLOWER', '采购跟单', '处理指定门店的采购订单', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'REGION_FINANCE', '区域财务', '查看指定门店的订单与结算信息', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
