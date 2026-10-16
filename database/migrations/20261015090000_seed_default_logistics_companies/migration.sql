INSERT INTO "LogisticsCompany" ("id", "name", "updatedAt") VALUES
    (gen_random_uuid(), '顺丰速运', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '京东物流', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '中通快递', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '圆通速递', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '韵达快递', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '中国邮政', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
