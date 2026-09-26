# 开发日志

## 2026-09-26

- DEV-406：付款预览将待确认差额抵扣计入可用应付余额，防止同一余额在抵扣等待确认时再次登记付款；集成测试覆盖待确认抵扣场景。
- DEV-406：付款登记与抵扣登记在同一组结算明细上使用事务级 advisory lock，并锁定少收退回记录后再检查重复处置，消除并发双重占用窗口。
- 验证：`npm run build`、集成测试（26 项）、`git diff --check` 通过。
- 进度与下一步见 `docs/progress.md`；M4 尚未完成。

## 2026-09-24

状态：需求、架构、数据库、接口、页面交互和开发计划已确认，进入开发。

当前进度与下一步详见 `docs/progress.md`。

本次开发目标：

1. 补齐 TypeScript/Prisma 开发依赖。
2. 建立 NestJS API 与 Worker 最小入口。
3. 建立第一批 Prisma 核心模型，覆盖账号权限、门店、供应商、商品、模板、价格、订单和储值流水底座。
4. 建立领域层金额、账期和储值资金判断的第一批单元测试。
5. 对齐最小健康检查契约，并补齐 `contract:check` 静态契约检查脚本。
6. 跑通本地 PostgreSQL、Prisma schema 校验、client 生成、迁移部署和第一批数据库集成测试。
7. 建立 API 全局 traceId、成功响应包裹和错误响应格式基础。
8. 增加幂等命令记录模型和稳定请求摘要函数，为后续命令重试/查询打底。
9. 增加命令幂等服务，覆盖同键同参复用、同键异参冲突、成功/失败结果落库。
10. 增加运行时契约校验基础，覆盖 UUID、expectedVersion、Idempotency-Key 和十进制字符串规则。
11. 将 Idempotency-Key 校验接入命令服务，并增加按操作者隔离的命令查询方法。
12. 开始 M1 身份底座，增加密码哈希、用户会话表和登录/认证/登出服务。
13. 增加认证 HTTP 接口、Bearer token 守卫和当前用户读取接口。
14. 增加角色守卫和管理员用户列表/状态修改接口底座。
15. 增加门店列表、新增和修改/停用接口底座，接入管理员权限和版本冲突校验。
16. 增加供应商列表、新增和修改/停用接口底座，覆盖配送方式、默认结算和周期字段。
17. 增加分类、单位和商品主数据接口底座，覆盖商品创建、列表和停用。
18. 增加供应商商品整批关联接口，校验供应商版本和商品存在性。
19. 增加价格范围与版本内部服务，支持发布价格和按业务时间取有效价格。
20. 增加订货模板创建、列表和门店整批绑定接口，约束每店一个有效模板。
21. 增加模板商品项整批替换和供应商结算覆盖接口。
22. 增加价格发布和价格版本查询 HTTP 接口。
23. 增加门店可订目录接口，按有效模板返回商品、候选供应商和当前价格。
24. 增加门店订货预览接口雏形，按目录与价格计算金额和储值资金摘要。
25. 增加订货单创建接口，复用预览计算并接入幂等命令记录。
26. 增加采购确认拆单第一版，按供应商生成执行单并接入幂等命令。
27. 增加采购拒单接口，记录拒绝原因、取消订货单并接入幂等命令。
28. 增加订货单列表和详情查询接口，返回金额、状态、商品行和执行单摘要。
29. 增加采购编辑商品接口，支持整批替换目标商品、拟供应商和数量并重算金额。
30. 增加采购改派预览和原子应用接口，逐行校验候选供应商与有效价格。
31. 增加供应商执行单列表和详情查询接口，返回状态、金额和商品行。
32. 增加供应商拒单接口，未发货执行单可拒绝并退回采购重分配队列。
33. 增加供应商拒单后的采购重分配接口，支持改派或取消被拒商品行。
34. 增加供应商发货预览接口，校验本次发货量、永久减量和剩余量。
35. 增加供应商发货创建接口，落库发货批次并更新执行单已发数量与状态。
36. 增加门店收货接口第一版，落库收货修订并累计执行单商品实收数量。
37. 增加收货少收差异和 ACCEPT 解决接口，支持供应商确认接受差异。
38. 增加运费确认登记和采购确认/拒绝接口，支持补发运费单独确认。
39. 增加补货缺口模型，并支持少收差异通过 REPLENISH 生成待补缺口。
40. 增加发货缺口分摊模型，支持补发发货消耗待补缺口并更新缺口状态。
41. 增加发货使用已确认运费，校验确认单金额并将其标记为 USED。
42. 增加执行单资金重算接口，支持充值后刷新采购单资金状态与短缺金额。
43. 增加门店账户和流水只读接口，支持按发生时间筛选流水。
44. 增加门店充值接口，落库充值单、增加账户余额并写入账户流水。
45. 增加门店信用额度更新接口，校验账户版本且额度不得低于已占用额度。
46. 增加执行单履约完成状态重算，综合实收、永久减量、已接受差异和补货缺口判断完成。
47. 增加充值单详情查询接口，返回充值单和当前门店账户快照。
48. 增加资金分配模型和清账预览接口，汇总可清账挂账金额。
49. 增加门店清账创建接口，落库清账单和明细并释放挂账占用。
50. 增加清账单详情查询接口，返回清账单、明细和当前账户快照。
51. 增加收货修订替换，保留旧版本、切换当前版本并按差额更新实收数量。
52. 增加少收差异 RETURN 处理，落库返还记录并重新计算履约完成状态。
53. 增加门店账单读接口，按已完成执行单汇总销售货款、运费和来源行。
54. 增加供应商总账单读接口，按已完成执行单汇总供货货款、运费和门店来源行。
55. 增加供应商分店账单读接口，关联供应商总单并按门店拆分供货口径来源行。
56. 增加付款预览接口，基于账单行结算明细 ID 校验方向主体并返回可付金额和来源版本。
57. 增加付款单创建接口，落库待确认付款和 RESERVED 分配并接入幂等命令。
58. 增加付款确认接口，将待确认付款转为 CONFIRMED 并把预占分配转为已确认。
59. 增加付款驳回接口，记录驳回原因并释放 RESERVED 分配为可再次付款。
60. 增加付款取消接口，记录取消原因并释放 RESERVED 分配为可再次付款。
61. 增加付款单列表和详情接口，支持按方向、状态、门店和供应商筛选并返回分配明细。
62. 增加差额处置线下返还第一版，基于少收 RETURN 记录创建并确认供应商返还差额。
63. 增加调整读接口第一版，将少收 RETURN 记录动态暴露为供应商应付调减并关联差额处置状态。
64. 增加差额抵扣第一版，支持将少收 RETURN 额度抵扣供应商应付并在付款预览中扣减。
65. 增加 B04 直接账期账单读接口，按供应商当前 `SUPPLIER_TERM` 配置汇总完成执行单、商品额和运费。
66. 增加直接账期账单单元检查，并将 B04 路由加入静态契约检查。
67. 为供应商执行单增加结算方式和周期快照；确认及新建改派单时保存配置，B04 按订单快照筛选与分组。
68. 为价格版本保存改价原因，并在价格发布和历史查询接口中返回；发布请求校验原因长度。
69. 增加 P01 价格影响预览，按有效版本区间估算未完成执行单的销售与供货金额变化。
70. 为价格版本增加按价格范围递增的 revision；允许同一生效时间追加修订并以最大 revision 生效，补充迁移和集成覆盖。
71. 增加价格变更 run 持久化与 `GET /jobs/{id}` 查询；发布事务关联待重算任务，实际订单重算和调整单继续保留在后续处理包。
72. 为价格变更 run 增加执行单级待处理明细，持久化每单销售与供货差额，查询任务时返回明细。
73. 增加 `POST /jobs/{id}/process`，事务内应用未完成执行单价格、更新订单/订货单金额，并持久化改价前后及差额记录。
74. 增加真实数据库价格重算覆盖，验证受影响执行单金额、调整来源落库及重复处理冲突。
75. 扩展价格变更 run 查询，返回每单调整来源 ID 及改价前后销售/供货单价。
76. 增加 `GET /jobs/{id}/adjustments`，按价格变更 run 查询持久化的订单调整来源。
77. 将已处理价格调整来源接入门店、供应商总单、供应商分店及直接账期账单明细，账单金额仍按订单当前金额汇总一次。

边界：

1. 本次不实现完整业务接口和前端页面。
2. 本次不生成生产迁移并不写入真实业务数据。
3. npm audit 报告需要单独评估，不在本次直接使用强制升级。
## 2026-09-25

- Added initial W11 browser report screen with login/session, R01-R03 tabs, filters, summaries, tables, empty/error states, and current-result CSV download. Added local `start:web` and API CORS origin. R04 asynchronous export jobs remain pending. Verification: browser assets reviewed, build and API suites run below.
- Verified `npm run build`, 11 unit tests, 26 integration tests, contract check, JS syntax, `git diff --check`, and local static HTTP delivery of the page and script.
- Implemented R04 persisted export jobs: async CSV generation, status lookup, owner-only download, seven-day expiry, and a W11 client that polls before downloading. API polling resumes queued rows after restart, and status/download recheck current report role and scope.
- Verification: migration status up to date, build, 12 unit tests, 26 integration tests, contract check, JavaScript syntax, and `git diff --check` passed.
- Hardened R04 queue processing with atomic QUEUED to PROCESSING claims, expired snapshot cleanup, and a regression check that a queued job is claimed once. Verification: migration applied, build, 13 unit tests, 26 integration tests, contract check, JavaScript syntax, and `git diff --check` passed.
- Hardened DEV-406 adjustment and difference-disposal reads/confirmation with authenticated store/supplier scope checks; added a cross-scope regression test.

- Hardened DEV-501 report date validation against impossible calendar dates and added coverage for the R02 maximum range. Verification: build, 11 unit tests, contract check, and `git diff --check` passed.
- Added the first data-scope slice for DEV-501: `UserScope` migration, admin account scope assignment through I05, scope in authenticated sessions, and forced store/supplier filtering for R01/R02. R03 remains restricted to company roles.

- Started M5 DEV-501 with R01-R03 reporting endpoints. Added `SupplierOrder.completedAt`, completion-time writes for receipt/discrepancy completion, and a migration backfill for existing completed orders. Reports use Asia/Shanghai date boundaries and persisted amount fields; R02 enforces the three-month limit and R03 excludes supplier direct-term orders with freight separate.
- Verification: migration deployed locally, build, 10 unit tests, 26 integration tests, contract check, and `git diff --check` passed. Remaining: store/supplier report scopes, static report route checks, and W11 UI.

- Added the direct `STORE_TO_SUPPLIER` payment direction. B04 direct statement IDs now work with B06-B08 payment preview, registration, and confirmation; direct payments preserve the supplier as payee and persist/read amount snapshots.
- Added database integration assertions that confirm a statement snapshot is persisted with goods and freight split, then remains visible in the statement and payment preview after the source order amount changes.
- Verification: build, 9 unit tests, and 26 integration tests passed.
- Added `SettlementItemSnapshot` persistence. Payment confirmation now records the confirmed settlement item's goods, freight, total amount, and source version atomically; later payment previews and store/supplier statement lines use the immutable amount after eligible order changes.
- Added the database migration and cascade cleanup relation. Verification: build, 9 unit tests, 26 integration tests, and migration deploy passed.

- Fixed statement and adjustment period grouping to use each supplier order's settlement cycle snapshot instead of the supplier's current default; added a regression unit test.
- Verification: build, 9 unit tests, 26 integration tests, contract check, and `git diff --check` passed.
- Kept P02 price revaluation funding summaries in sync with changed request totals; verified increased prices create a positive shortfall that blocks store-side payment preview.
- Enforced B06's company-term rule: supplier payment preview stays blocked until the related store receivable is confirmed paid; RESERVED payment alone does not satisfy it.
- Verification: build, 8 unit tests, 26 integration tests, contract check, and `git diff --check` passed.
- Fixed P02 processing status: a price-change run is FAILED if any order item fails; added integration coverage for an order completed before processing.
- Payment preview now blocks completed orders whose purchase request still has a positive funding shortfall.
- Purchase confirmation now recalculates current item total against current store balance and refuses to split orders when funds are short.
- Left account balances and ledgers untouched by price adjustments because the requirements define no refund or reversal flow.
- Verification: build, 8 unit tests, 26 integration tests, contract check, and `git diff --check` passed.
