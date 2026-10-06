# ProcureX Development Progress

Last updated: 2026-10-06

## Latest Delivery: Account Funding Labels

- 门店订单及采购申请将paymentStatus明确为“储值/挂账入账”，不再将月结申请UNPAID解释为整单未支付；paidAmount显示为“账户入账金额”。账单结算继续以账单/付款记录为准。
- 未修改财务算法；后台类型检查及生产构建通过，浏览器专项尚未重跑。整体签收口径不变，剩余真实恢复验证、需求映射与默认入口切换。

## Latest Delivery: Product Images, PDF And Real Payment Rejection

- `test:admin:oss-attachments` passed both monthly/direct scenarios and cleanup. React saves real OSS PNG/JPEG product images and reloads/enlarges them; six synthetic payment PDFs open through authenticated blob links and download byte-for-byte correctly.
- All three payment directions reject only with a reason, release the original allocation, allow corrected registration and finish with exactly one confirmed allocation. Reopened rejected/confirmed details are read-only. Ten file objects pass contents/checksum/link/privacy checks including bound store/supplier direction rules; exact versions and temporary records removed.
- Evidence: `var/react-admin-oss-attachments-evidence/manifest.json`, 38 unique mobile screenshots. Added terminal-state selector initially matched two confirmed labels; scoped to descriptions and full rerun passed, failed-run cleanup passed. Local normal four-mode regression, 182 unit tests and admin typecheck passed. No business algorithm changes/bank transfers.
- Requirement audit corrects an inaccurate prior gap: baseline §4.1.3/§6.2.2 explicitly requires automatic template/supplier settlement matching, not store selection. Do not implement a conflicting selector.
- NEXT: fix monthly order funding/payment display ambiguity, verify remaining real React lost-response/reload recovery branches, then final mapping and cutover. Product-image/PDF and payment-rejection items now closed; fixed local 3/7 and closure 6/9 unchanged. This supersedes historical NEXT below.

## Latest Delivery: Real React OSS Evidence Journey

- `test:admin:oss-journey` final four-mode run and all cleanup passed; local-storage real journey also reran 4/4 successfully. Reuses the five-role React chain with real API/database commands, not response fixtures; business algorithms and normal service configuration unchanged.
- Eleven synthetic PNGs uploaded to real private OSS cover recharge, clearing, receipts and three payment directions. Every file is READY, checksum/bytes match and document-linked; thumbnail and enlarged browser preview pass. Anonymous OSS 403, anonymous API 401 and unrelated purchaser 404 verified per file.
- Deletes only each temporary UUID object's exact version, verifies version/current absence, then cleans scoped database fixtures. Missing objects are skipped to avoid creating delete markers. No bucket-wide deletion or credential output.
- Evidence: `var/react-admin-oss-journey-evidence/manifest.json`, 40 mobile screenshots. Unit tests 182/182, admin typecheck, fixture guard, syntax and diff checks passed. Existing pg deprecation warning remains.
- NEXT: remaining product-image/PDF attachment checks, exceptional-path evidence and requirement mapping, then handoff/cutover. Business PNG OSS happy-path subitem closed, not all attachment types or production acceptance. Fixed local 3/7 and closure 6/9 unchanged; supersedes historical NEXT below.

## Latest Delivery: Real React Same-Order Journey

- `npm run test:admin:real-journey` final rerun passed all four settlement modes and cleanup. Real React commands cover five roles, ordering, purchasing, shipping, receipt, applicable recharge/clearing and three payment directions. Only temporary master data/initial prices are seeded; no API response mocking.
- Stored value: 1000 recharge, 24 reserved before receipt, 976 balance/zero reserve afterward, exactly one request-linked debit. Credit: 24 debt cleared to zero without stored-value debit. Monthly/direct payment records and exact single allocations are confirmed for 24/18 and 18 respectively.
- Clearing DEBIT ledger is not a stored-value deduction. Monthly request funding summary stays UNPAID although statement payment allocations are confirmed; display/requirement mapping remains a handoff check, not a financial algorithm change.
- Real private synthetic PNG upload/association/authenticated download and unauthenticated 401 passed, using isolated local storage, NOT OSS or bank transfers. Evidence: `var/react-admin-real-journey-evidence/manifest.json`, 29 mobile screenshots. Build, syntax and diff checks passed; existing pg query deprecation warning remains.
- NEXT: real OSS joint acceptance, exceptional-path evidence and requirement-gap audit, then handoff/cutover. Happy-path same-order subitem is closed, R5 overall is not; local 3/7 and closure 6/9 unchanged. This supersedes historical NEXT below.

## Latest Delivery: R5 Consolidated Regression And Static Deployment

- Added `test:admin:all`: all 12 existing React browser suites passed in the final full rerun. Evidence: `var/react-admin-r5-evidence/manifest.json`, individual logs, source hashes and timing. First run was 11/12; purchase test failed on virtual dropdown selection, fixed by searching before selecting, then individual and full reruns passed. No business code changes.
- Admin production build passed. New Nginx static image, SPA fallback and API reverse proxy verified locally: eight direct routes, JS/CSS cache, missing-asset 404, API 401/database health, real login/refresh restore and 1440/320 finance screenshots. Temporary container/image cleanup passed; evidence: `var/react-admin-deployment-evidence/manifest.json`.
- Docker build context excludes secrets/data and includes only static output/configuration. Deployment commands and API upstream configuration documented. Existing large shared-bundle warning remains.
- Boundary: base suite has temporary store-group writes/cleanup; other business writes use fixtures. Static deployment uses real login/reads only. No real funds, OSS or production deployment acceptance; fixed local 3/7 and closure 6/9 unchanged.
- NEXT: protected local real React same-order role chain, applicable funds/OSS joint acceptance, then final handoff/cutover. No extra page-polish work package. Current details in `react-admin-migration.md`; handoff in `continuation.md`.

## Latest Delivery: Supplier Finance And Reports

- Supplier statements, incoming company/direct payments, read-only settlement differences and supply-basis reports now use bound-supplier scope. Missing bindings prevent reads; foreign details and unrelated recovery commands are blocked.
- Confirmation/rejection reread current payment amounts, allocation, status and version; rejection requires a reason. Unknown commands preserve original body/key. No supplier payer registration/cancellation or self-confirmation of returns payable to the company.
- Supply reports reject sales basis and foreign orders, hide profit, and reuse authenticated evidence/CSV access and persistent export-review gates.
- Supplier finance, central/store billing and reports, supplier fulfillment and admin build passed; five desktop/mobile screenshots inspected. Supplier API responses are fixtures, not real funds/OSS/export acceptance.
- NEXT: R5 full-role business-chain regression, real business/funds/OSS joint acceptance and deployment cutover. R2-R4 planned page implementation is present; joint acceptance and payment-choice contract gap remain open. This supersedes historical NEXT entries below.

## Latest Delivery: Supplier Fulfillment Workspace

- Supplier accounts now enter React `/supplier-orders` with a restricted menu and bound-supplier list/detail checks. Missing binding prevents order reads; foreign rows/details are rejected. Only supply amounts are shown; no central purchasing, funds reconciliation, receipt registration or freight approval controls.
- Shipment/replenishment and permanent reduction reuse existing versioned previews and commands; supplier previews correctly accept the backend's omitted company sales fields. Freight requests and reason-required rejection implemented. Rejection rereads ownership/status/version before writing and is unavailable after shipping.
- Supplier `/discrepancies` supports ACCEPT/REPLENISH/RETURN, current discrepancy versions, private evidence and order navigation. Detail/action/recovery check linked order ownership. Order and discrepancy unknown results retain the original body/key; supplier cannot replay unrelated central commands.
- `test:admin:supplier`, central shipping/receipts, store ordering and `build:admin` passed. Three 1440/320 screenshots inspected. Supplier tests use API response fixtures only, not real supplier funds/OSS acceptance. Existing shared bundle warning remains.
- NEXT: supplier statements, recipient payment confirmation/rejection, settlement-difference and scoped report views; then R5 full role-chain/real business, funds/OSS acceptance and deployment cutover. Supplier migration is not yet complete. Payment-choice contract gap remains. This section supersedes historical NEXT entries below.

## Latest Delivery: R4 Settlement Differences And Reports

- React `/settlement-differences` now provides scoped adjustment lists/details, OFFLINE_RETURN/OFFSET registration, current amount/target rereads, recipient confirmation with current version, and original-key unknown-result recovery. Store recovery rechecks ownership and cannot create central disposals; supply costs hidden from store views.
- React `/reports` now provides order amount monthly/detail views, product quantities and central-only profit, dates/master-data filters and default-10 pagination. Store binding overrides URL; missing binding blocks reads; quantity ranges over three months blocked before request. Server decimal amounts/quantities retained.
- CSV jobs use successful-query snapshots; changed filters block exports. Queue polling, failure retry, expired-job protection and authenticated download implemented. Non-idempotent export unknown results persist as an explicit task-review gate, not automatic resubmission or alleged financial-command replay.
- `test:admin:r4-reports` passed with real read-only counts 2 adjustments, 28 completed orders, 0 export jobs, then all writes mocked. Five desktop/mobile screenshots checked; billing/account regressions and admin build passed. No real financial/OSS/export creation. Existing large shared chunk warning remains.
- R4 page migration is now implemented, but real funds/OSS joint acceptance stays open. NEXT: independent supplier workspace, then R5 complete role-chain/joint acceptance and deployment cutover. Payment-choice contract gap remains documented. Historical NEXT entries below are superseded.

## Latest Delivery: R4 Direct And Store Payments

- Supersedes prior NEXT: central `/finance` now includes direct and supplier-per-store statements. STORE/STORE_FINANCE get scoped store/direct statements, payment registration and pending-payment cancellation, never recipient confirmation/rejection.
- Bound store scope overrides URL parameters; missing binding prevents reads; foreign list/detail/preview results are filtered/rejected. Cancellation replay rechecks payment ownership. Original body/key replay retained; no stored-value/credit rule change.
- Expanded billing browser evidence includes five screenshots and both STORE_TO_COMPANY/STORE_TO_SUPPLIER registrations; real read-only counts include 155 direct and 10 supplier-per-store statements. All business/file writes intercepted; no real funds/OSS changes.
- Regression reproduced confirmation timeouts after conflict/re-preview in store ordering and account clearing. Waiting or controlled open alone did not resolve them. Rebuilding confirmation by reviewed result, with controlled open and form-local mounting, passed ordering/account/billing browser suites and the admin build. No financial contract changed.
- R4 remains open for settlement discrepancies/reports. Supplier workspace, payment-choice contract gap and R5 real-chain/OSS/deployment acceptance remain open.

## Latest Delivery: R4 Central Billing And Payments

- Supersedes previous NEXT: `/finance` now provides supplier/store statements, settlement lines and adjustments, required-evidence payment registration, payment records and versioned confirm/reject/cancel. Only ADMIN/HQ_FINANCE use this central route.
- Fresh preview before registration blocks changed amounts/versions and invalid settlement items. PAYMENT JPEG/PNG/PDF files must be READY; private PDF view/download and image preview supported. Unknown result retains original body/key after reload. No funds logic changed.
- `test:admin:r4-billing` passed: real read-only counts 10 supplier statements, 3 store statements, 36 payments; subsequent writes intercepted. Three screenshots inspected at 1440/320. Account regression passed after one confirmation-popup timeout and rerun; build passed with existing bundle warning. No actual payment/OSS writes.
- R4 still in progress. NEXT: direct/supplier-per-store statements and store payment entry, then settlement discrepancies/reports. Supplier workspace, payment-choice gap and R5 real-chain/OSS/deployment remain open.

## Latest Delivery: R4 Store Accounts

- Supersedes previous NEXT: `/store-finance` now provides store financial overview, recharge, credit-limit adjustment, filtered credit clearing, stored-value/credit ledgers and private document evidence. ADMIN/HQ_FINANCE may write; store roles see only their bound account, read-only.
- Clearing rechecks the server preview before submit; changed amounts/versions require renewed review. Financial unknown results retain the original body/key across reload. Recharge adds stored value; clearing releases credit, not stored value. Existing receipt debit rules remain unchanged.
- `build:admin`, `test:admin:r4-accounts`, `test:admin:r3-store`, `test:admin:r3-shipping` and `test:admin:r3-receipts` passed. Finance evidence: `var/react-admin-r4-accounts-evidence/manifest.json`, four screenshots. Real login/read only; subsequent writes are fixtures, no actual funds or OSS writes. Bundle-size warning remains.
- R4 remains in progress. NEXT: bills and payments, then settlement discrepancies/reports. Supplier workspace, payment-choice contract gap and R5 real-chain/OSS/deployment acceptance remain open; no claim of complete migration.

## Latest Delivery: Store Ordering

- Supersedes previous NEXT: STORE ordering now lives in `/store-orders`, with scoped catalog, decimal quantity/unit snapshots, server price/funding preview, approved template/product/price versions and idempotent submit. STORE_FINANCE remains read-only. Unknown-result submit survives reload with the same body/key; 409 invalidates preview.
- Backend settlement is configured by template/supplier; no user-selectable payment method is accepted in the current create contract. The earlier free-choice requirement remains a contract gap, not silently declared implemented. Existing receipt debit/reservation/credit rules unchanged.
- `build:admin`, `test:admin:r3-store` and `test:admin:r3-receipts` passed; screenshots include 320/1440 ordering. Real login/read only; writes are fixtures, no real funds/OSS changed. Bundle-size warning remains.
- Admin/store R3 page implementation is connected. NEXT development batch: R4 finance. Supplier-role workspace, full-role/real-write acceptance and R5 deployment/cutover remain open; not complete migration or production delivery.

## Latest React Migration Batch: Store Orders

- Added `/store-orders` for STORE/STORE_FINANCE: scoped order list, sales-only detail, shipment progress and private receipt evidence. STORE can register/revise receipts; STORE_FINANCE is read-only. Missing store scope blocks requests; central routes are denied for store scope.
- Receipt unknown-result recovery remains available inside the order modal after reload, using the original body/idempotency key. Existing reservation/debit/credit accounting rules unchanged.
- Verified `build:admin`, `test:admin:r3-receipts`, `test:admin:r3-shipping` and `node scripts/check-react-admin-r3-store.mjs`. Store evidence: `var/react-admin-r3-store-evidence/manifest.json`, desktop/mobile screenshots. Login real; role and business-write checks mocked; no real financial/OSS writes. Existing >500KB bundle warning remains.
- Historical query/receipt batch: store ordering was pending then; see Latest Delivery above for current state. R4 and R5 remain open.

## Current Delivery Direction

2026-10-06 React R3收货及差异交付（覆盖下方历史NEXT）：管理员在供应商订单发货明细登记/修订收货，逐项覆盖并携带订单版本+收货修订号，锁定项不能改；私有JPEG/PNG凭证上传完成后关联，缩略图/预览/下载。新增收货差异列表与接受短缺/安排补发/退回修订，差异版本及幂等恢复；采购员/总部财务不能处理或访问差异接口。保持收货扣储值及挂账后端规则不变。总部管理端采购至收货差异页面已接通，但完整真实业务链及OSS联合验收仍属R5；R3尚余门店订单和门店角色后台，随后R4财务、R5切换，不将整体迁移标为完成。验收详情见docs/react-admin-migration.md和var/react-admin-r3-receipts-evidence/manifest.json，业务/文件写入为响应夹具，无真实资金或OSS写入。

2026-10-06 React R3发货链交付（覆盖下方历史NEXT）：供应商订单已接入发货、永久减量、补发缺口分配、服务端预览、运费申请及确认/驳回。管理员可发货和申请运费，采购员可审核运费，总部财务只读；沿用后端资金规则。共享采购幂等恢复记录，发货未知结果刷新后保持原键和原请求。构建、采购及拒单回归通过，新增发货链浏览器验收使用响应夹具，不是生产写入验收。NEXT收货修订/私有凭证/差异处理和门店角色流程，然后R4财务、R5切换；R3仍未全部完成。详见docs/react-admin-migration.md。

2026-10-06 React R3拒单处理交付（覆盖下方历史NEXT）：采购页拒单待办、采购详情/订单入口、逐项重分配或取消、清单确认及原因、原模板/有效供应商/已发货限制、历史拒单防重复处理已迁入；手机纵向表单。复用原键恢复，409后可重新读取，未知结果刷新和跨页仍用原请求；金额及资金由提交时服务端核定，不修改资金规则。build:admin、test:admin、test:admin:r3、test:admin:r2、test:admin:r3-exceptions通过；拒单6张截图，真实待办读为0条，采购/订单/资金写入均为响应夹具；资料回归分组真实CRUD后清理，审计保留。NEXT固定发货/永久减量/补发/运费、收货/凭证/差异，再R4财务和R5切换；不把R3或完整迁移标为完成。详见docs/react-admin-migration.md及var/react-admin-r3-exceptions-evidence/manifest.json。

2026-10-06 React R3供应商调整补充：采购详情增加批量选择商品、目标供应商、服务端资格及金额预览、双价格版本批准和幂等提交，未知结果沿用采购共用恢复记录。R3仍未完成，下一项为拒单待办和重分配，之后发收货、运费及差异。未改变资金规则，未执行真实订单或OSS写入。

2026-10-06最新React R3交付（覆盖下方历史NEXT）：采购申请及供应商订单迁入4174，完成门店目录选品/销售与采购单位/金额资金预览/新增/修改/确认/取消、订单资金核对和关联发货记录查看。真实读取37条申请/55条订单及首条详情；写入、原键恢复和发货明细测试为响应夹具，无真实采购/订单/资金/OSS写入。R3仍进行中，NEXT换供应商/拒单重分配、发货/补发/运费、收货/凭证/差异，之后R4/R5。目录及预览版本随请求提交，不改收货扣储值或挂账规则。迁移清单见docs/react-admin-migration.md，证据var/react-admin-r3-evidence/manifest.json。

2026-10-06最新React交付（覆盖下方历史NEXT）：R2模板与价格已迁入，R2页面实现及前端回归完成。入口4174/templates与4174/prices；模板版本化关联/结算覆盖，价格预览/发布/版本/重算及刷新后原键恢复已验证。build:admin、test:admin、test:admin:r2通过，新增6张桌面/手机截图。本批写操作为响应夹具，没有真实改价、模板/订单/资金或OSS写入；完整真实写入与OSS联合验收仍待R5。NEXT固定R3采购、订单、发收货及差异流程，随后R4财务和R5全量切换；不把技术迁移当整体业务或生产门槛完成。详见docs/react-admin-migration.md。

React R2新增商品与供应商页面：商品资料/图片/采购单位换算，供应商资料/商品关联/归档；模板与价格未迁移，R2继续进行中。入口4174/products与4174/suppliers，复用现有API，未改变订单资金规则。

React迁移R2进行中：商品分类、品牌、单位维护已加入4174后台，沿用两级分类、版本与引用保护。R2尚未完成：商品/图片/单位换算、供应商、模板与价格待迁移；不新增订单或资金规则。

2026-10-06新增用户批准的React后台并行迁移：apps/admin首批R1（登录与框架、门店、分组、收款账户）完成，直接共用开发数据。新入口4174/stores，旧后台4173保留。迁移范围与下一阶段详见docs/react-admin-migration.md；R2/R3/R4/R5仍未完成，此项不代表原生产/真机/签字门槛完成。

2026-10-06挂账口径补充确认：额度是门店欠公司货款的上限，挂账下单先记未付欠款、占用额度；约定周期收到还款后批量清账，恢复额度，不扣储值、不自动到期清零。现有资金逻辑符合，本次同步需求定义，不新增自动销账任务。

2026-10-06用户确认的储值时点修正完成：新订货单下单冻结、收货完成实际扣款，取消/拒单/减量释放冻结；按拆分的供应商执行单结算，未完成部分继续冻结。StoreAccount新增reservedBalance，FundingAllocation新增reservedAmount，GET账户返回账面/冻结/可用；订单详情显示冻结及实际支付，冻结不标为PAID。充值只增加余额；清账偿还挂账、不扣储值。旧请求storedValueOnReceipt=false沿用原扣款/退款策略，历史余额与流水未重算。迁移20261006190000本地应用，累计65个。build/182单元/736集成/24Web/92小程序/两端静态/桌面手机六截图通过，含并发占用、取消减量、收货修订、差异接受、重复命令和事务失败回滚。API3114已重启健康通过；后台资源stored-reservations-1，Web4173保留。需求v1.5、API/数据库设计及交接同步；本次未commit/push。原生产、真机与签字验收边界未变化，本项不等于全部上线完成。

2026-10-06门店需求图下一阶段完成：新增财务管理→门店财务（#/store-finance）和收款账户（#/collection-accounts），仅管理员/总部财务可用。财务列表默认10条、搜索/分组筛选，展示额度/未清/累计/剩余/储值及充值、清账、调额度、流水操作。清账按挂账发生日期和供应商筛选，全选仅筛选结果，换筛选清除选择，金额按整数分汇总；确认沿用重算/版本校验/幂等提交。收款账户新增/编辑/启停，版本冲突和同事务审计；外部充值校验启用账户，与停用共用事务锁。新门店可首次设置挂账额度，已有账户不能覆盖。迁移20261006170000本地已应用，合计64个；未重置业务库、未造真实银行账户。build/182单元/24Web/静态/732全量集成/导航通过；var/store-finance-evidence六张1440/320截图（筛选内存fixture），var/finance-account-evidence隔离真实充值/清账/凭证/过期预览/丢响应恢复/只读下载通过且清理完成。用户可先配置真实收款账户再本地体验；钉钉仍按§6.5首版不接第三方，生产/真机/签字验收未因此完成。

2026-10-06后台URL简化完成：本地直接http://127.0.0.1:4173/app.html#/stores，workspace-config.js配置本地API3114，部署域名默认同域/api/v1。旧api查询链接读取后replaceState移除，仅当前标签页sessionStorage保存覆盖以兼容隔离验收端口/刷新，不把接口地址持续暴露在URL。23Web/静态、无参数真实列表登录及旧链接清理/刷新导航回归通过；资源clean-url-1，无后端修改。

2026-10-06新增/编辑表单紧凑化完成：共用弹窗640px，少字段480px，字段间距12px、内边距16px，桌面控件36px/手机38px，必填标记回到标签同行；标题/操作区收紧，保留滚动与固定操作区，长文本不裁切。手机单列。Web23/静态/列表回归及6页面新增编辑×320/1440共24截图检查通过（var/form-layout-evidence），未提交表单或改业务数据。资源forms-1；固定完成标准不变。

2026-10-06演示测试数据中文化完成：本地已识别测试记录80条（门店10/供应商17/商品10/分类6/单位6/模板7/用户显示名24）。仅识别测试编号且原名称匹配的记录更新，真实/用户已改名称不覆盖；编号/账号密码/订单关联/金额不变，历史订单名称及单位快照不重写。主流程/结算/报表种子与小程序商品准备脚本同步中文，报表名称断言同步。localize-demo-data.mjs本地限定、事务更新、版本失效；证据var/demo-localization-evidence/applied.json。重复预览0待改，安全范围单测/脚本语法/桌面手机列表回归通过。没有重跑或重置种子数据。

2026-10-06下拉箭头调整：现有Lucide图标距右边10px，文字预留34px，分页下拉加宽96px，保留原生交互及强制颜色/图标不可用回退；资源selects-2。列表/表单桌面手机及静态回归通过。

2026-10-06下拉布局优化：继续使用原生select，不引入组件库；桌面筛选固定可读宽度和统一34px高度，手机搜索独占行、筛选两列且标签在上方，重置靠末尾。分页下拉88px固定宽度、手机总数与条数选择同排，页码靠右；表单/省市区下拉40px，禁用与焦点样式统一，弹出选项仍由浏览器系统绘制。23Web/静态及门店商品账单与门店编辑320/1440检查通过，9截图var/list-layout-evidence；纯前端改动，资源selects-1。

2026-10-06用户要求的公共列表优化完成：主业务列表共用renderTable，默认每页10条，可选20/50/100，首末页/上下页/页码跳转，筛选或改条数重置第一页、页码越界钳制及空结果禁用控制。搜索和筛选左对齐紧凑布局、重置搜索筛选、总数移到分页区，表头/行/标题间距收紧；账单类型切换保留。内嵌明细表并非全部renderTable，本次不声称全部统一。23Web/静态、真实门店商品账单320/1440和35条内存分页浏览器验证通过，证据var/list-layout-evidence。分页仍为已加载数据的前端分页，未改API查询契约或后端集成；固定完成边界不变。

2026-10-06补充完成整个左侧栏收起/展开：页面标题左侧按钮，桌面208px收起为64px图标导航（名称提示/当前项标识/权限过滤），手机收起隐藏菜单。sessionStorage记住同标签页状态，存储不可用时仍可操作；不刷新业务视图或重发请求。23Web及静态检查通过，三账号320/1440展开/收起12截图、键盘操作及刷新状态恢复通过，var/navigation-evidence。本次仅前端，未重跑后端集成，不改变固定完成边界。

2026-10-06用户要求的后台导航分组完成：按现有页面分业务处理、基础资料、商品配置、财务管理、账号资料；权限过滤后隐藏空组，支持键盘折叠，切换页面自动展开所属组，同会话切换保留其他组展开状态。手机两列导航限制230px高度并内部滚动。门店分组入口仍在门店管理内。本次仅前端导航，不改接口、角色授权或数据库；Web23测试和静态检查通过，三账号320/1440浏览器验收证据var/navigation-evidence。此前731集成结果为上一轮后端验证，本次未重跑。固定6/9与3/7完成边界不变。

2026-10-06用户要求的独立门店分组管理已完成：入口在正式Web门店管理顶部“分组管理”，管理员新增/统一改名/启停/删除未引用分组，显示门店数量。门店所属分组改为下拉，可未分组；停用保留原归属但不可新增分配，已引用禁止删除。StoreGroup迁移整理旧自由文本名称，唯一约束和外键CASCADE/RESTRICT保护；改名同步门店且使旧表单版本失效，分组/归属锁和同事务审计防竞争及半完成。业务库63迁移已应用，API3114已重启并健康，Web4173资源版本更新。182unit/731完整集成/92mini/22Web/迁移专项/契约静态/diff通过；71写/预览入口六角色矩阵通过。UI真实新增/下拉分配/改名/停用保留/启用/重名/删除及320/1440检查PASSED，var/store-groups-evidence；隔离空库63迁移/57步129图及清理PASSED，run07892db8-2b98-412b-a9eb-1167c76bcc02。无新增组织层级或财务规则，本次仅用户指定增量，原6/9与3/7收尾边界不虚增。

2026-10-06用户明确新增要求：正式Web门店管理加入省/市/区联动及详细地址，独立收货地址同样支持。上级变化清空下级，新建完整选择必填，保存后回显；历史纯文本原样保留，不猜测拆分。沿用address/receiptAddress接口，无新增迁移。Web22测试/静态检查通过，Chrome320/1440联动/收货禁用/无溢出通过；隔离62迁移、正式Web57步129图及清理PASSED，run2dcf52e3-8bd7-47da-a98e-04c742c4926b。用户指定增量，不扩大原收尾范围。数据为modood项目2023大陆地区快照，上游停止更新，新增区划/港澳台未覆盖，不声称实时区划；来源/许可见address-regions.LICENSE.txt。

2026-10-06固定收尾实际推进：正式Web三引擎×三视口×三账号189项/189图PASSED，其中27未绑定范围按预期拒绝，非业务流程冒充；修复表格窄列逐字换行。新增可复现web:compatibility，截图尺寸/非空检查通过。ops:clean-start在专用空库62迁移、独立API/新私有目录完成当前Web57步129图跨角色链及夹具/容器/目录回收PASSED，不碰业务库/OSS。build/182unit/730全量集成/92mini/21Web/契约静态/diff通过。C8兼容/C9干净启动与当前主流程缺格已补，不重复执行；C3真实原生窄屏因无桌面控制工具仍缺，200容量及客户初始化来源/生产策略仍保留，6/9与3/7不虚增。NEXT仅最终逐包签收/原生窄屏与外部资源，不增加后台功能。证据和复现见delivery-closure.md、local-operations-acceptance.md。

2026-10-06 RAM授权后真实OSS复验：SDK上传/下载200、字节一致、匿名403及指定版本删除通过；隔离临时HTTP实例和实际API3114各完成上传/完成/下载、SHA256、API匿名401、无关供应商404、OSS匿名403和自身云版本/数据库记录清理，manifest PASSED/cleanup PASSED。本机.env启用FILE_STORAGE=oss，API3114已重启并健康；所有新附件仅存procurex-test/，旧本地附件继续可读。密钥不输出/不入Git，未改云权限/生命周期/历史对象。此前AccessDenied已解除，但P2生产目录/保留/备份恢复/签字仍未验收，整体6/9和本地3/7不变；本次完成用户指定测试接入，不把test前缀当生产。详见m6-storage-policy-guide.md、var/oss-attachment-evidence/manifest.json。

2026-10-06用户要求接入真实OSS（P2定向工作，不扩展固定功能范围）：已添加官方ali-oss存储适配，显式FILE_STORAGE=oss启用；默认保持本地，旧本地UUID附件可读，新云附件带oss:前缀，业务鉴权不变。配置缺项/不安全Endpoint拒绝，云端故障不误判坏文件，清理失败保留元数据。构建、182单元、29附件/产品图片/账户凭证/角色隐私集成通过。真实GET与PUT均403 AccessDenied，没有成功写入测试对象；未切换业务API、未修改云权限/生命周期/历史附件。P2仍BLOCKED、整体6/9和本地3/7不变。下一步仅需专用RAM用户的procurex-test/*最小权限，授权后复验真实上传/下载/隐私/版本清理，再启用运行服务；详见m6-storage-policy-guide.md。不以本地回归冒充云验收。

2026-10-06执行纠偏（最高优先级，覆盖下方全部历史NEXT）：按delivery-closure.md“执行约束与出口”三批收尾：1状态对齐/恢复入口，2正式页面真实窄屏与兼容，只修复已复现阻断，3隔离干净复现/当前版本跨角色复验/手册和逐包签收。停止连续容量调优，不新增功能或重做已签收财务/履约/权限；新发现非阻断仅列风险。200目标未通过保持原义，不自行放宽或作为无限优化队列。当前固定6/9、本地3/7，外部P1-P4单列；本批9组90图证据完整性检查通过，但C3仍只缺真实窄屏。已修正文档旧测试数和旧待办解释，730/178/92/21是上一批已验证基线；API3114健康，Web4173原未运行已恢复。旧9月m6-local-evidence-handoff为历史包摘要，不可当当前最终交接。下一批直接做页面/兼容缺格，不再规划新后台工作。

2026-10-06最新C8价格往返优化（覆盖下方历史NEXT）：有效价格读取去掉两次重复范围关联，每个版本仍findFirst/SQL LIMIT，模板销售优先、公共成本、未来回退及写入前复核不变；范围身份由已过滤的商品/供应商/模板和实际scopeId得到，API报价结构不变。新增真实SQL两条且各带LIMIT、历史/未来及同时间revision回归。最初关联take1方案实测SQL不限制历史，已拒绝采用。构建/178单元/730全量集成/92小程序/21Web/契约静态/18负载保护通过，API3114更新且健康。无诊断200档5309成功/0错误/691在途满/迟到0，稳态174.35、p95 763.36ms；含预检7110请求资金/明细/流水/20门店核对与原键重放PASSED，但整体CAPACITY_NOT_MET/cleanup PASSED，200目标仍未达。单次本机短测不称生产容量或确定增益。NEXT兼容证据和本地交接缺格，不继续无新诊断的微调；200未达明确保留风险，C3真实窄屏/C8/C9仍开放，6/9不变。详见local-operations-acceptance.md，最新run e0d8eb45-eebd-44d4-914a-94add831218e。

2026-10-06最新C8容量定位（覆盖下方历史NEXT）：真实负载生成器已拆为独立IPC子进程，API/生成器PID不同；200 QPS无诊断复测稳态167.6、5078成功/0错误/922未发出，全部未发出为128在途已满，调度迟到0。包括预检6879请求资金/唯一ID/明细/流水、20门店对平及原键重放通过；CAPACITY_NOT_MET/cleanup PASSED。诊断复测160.9、4927成功/0错误/1073未发出，含预检6728一致性通过；会话读取客户端均值349.61ms、目录8.85ms、最多10连接idle in transaction，证据指向池争用/事务占用，不能当纯SQL或生产容量。两次独立容器已回收，业务API3114健康，业务服务/连接池/超时/门槛未改。最新诊断manifest与归档无诊断基线分开保留，详见local-operations-acceptance.md。NEXT仅按热点减少事务重复读取/往返并验证容量、补兼容/真实窄屏/最终交接；6/9不变，不重复已验收财务/履约。

2026-10-06最新C8真实下单负载（覆盖下方历史NEXT）：新增隔离30秒开放到达负载10/50/200 QPS及14项保护/指标测试。发现命令事务持有连接后预览另取全局连接造成连接池饥饿，目录/价格/单位/账户/结算读取已复用当前事务，新增单连接池下单及原键重放回归。修复后6132次真实储值采购、唯一请求/明细/流水及20门店余额对平，原键重放不重复扣款；接口错误0、PROCESSING命令0。10/50 QPS无丢弃；200 QPS稳态137.8、1669次未发出，报告CAPACITY_NOT_MET/consistency PASSED/cleanup PASSED，不能签200 QPS完成。生成器与API同进程、本机30秒、单商品20门店及合成期初余额，不是生产容量或完整采购履约验收。整体仍6/9；NEXT C8独立负载生成与容量定位/兼容、C3真实窄视口及C9交接，不重做已通过业务模块。详情local-operations-acceptance.md及var/ops-order-load-evidence/manifest.json。

2026-10-06最新C3收敛（覆盖下方历史NEXT）：价格发布/重算真实提交后丢响应、原键恢复9图PASSED/cleanup PASSED，订单28/18、流水0、唯一版本/调整验证；三工作台多角色导航6图全部复核，390px分层无遮挡，未绑定账号不算跨范围操作。修复门店无绑定永久骨架，现明确绑定提示/禁搜索/无订货栏；92小程序/静态、21夹具防护、12证据检查器通过。mini:visual-evidence默认核对9组90图及新组复核hash；剩余仅真实窄屏。旧价格0图NOT_VERIFIED保留，失败报告/清理保留，未重跑全后端集成、无API/迁移。NEXT真实窄屏及C8持续负载/兼容、C9最终交接，不重做价格/导航/图片。整体6/9不变，C3/C8/C9开放，详情local-native-visual-acceptance.md。

2026-10-06 C3证据映射：新增mini:visual-evidence，7组75张实际文件解码/非空白/哈希核对通过，不等于布局签收。历史原生主流程与当前入口明确区分，价格发布/丢响应恢复仍功能通过、视觉NOT_VERIFIED；旧大金额图不用于压力签收。最终报告var/native-visual-acceptance/manifest.json列明窄屏、多角色导航、价格恢复截图三项。6/9不变，C3/C8/C9开放；没有重复业务测试/截图或扩展功能。

2026-10-06最新C3图片增量：真实开发者工具裁剪/PRODUCT上传/保存/编辑器与门店认证显示5图PASSED，800x800/5911字节真实下载和非空像素统计通过，两处缩略图已查看。临时PXMEDIA-UI商品/模板项和两个文件ID/私有文件清理PASSED，商品/文件残留0；正常会话与商品创建审计保留，不称零写入。无价格/订单/金融变更。媒体脚本加fixture guard/限流/完整响应/setData/重开项目；19保护及91功能/静态/语法/diff通过。合成图片非摄影/相机验收；先前入口NOT_AVAILABLE保持历史原义。CLI无尺寸切换参数，窄屏未做、不mock替代。NEXT窄视口、多角色布局及主流程/改价恢复最终映射，再C8/C9；不重复图片或入口。详见local-native-visual-acceptance.md和product-media-evidence，整项仍6/9，C3开放。

2026-10-06最新C3入口增量：真实开发者工具只读采集商品/档案/快速改价入口及空/模拟加载失败19图PASSED；修正三个入口error-banner缺样式，复用现有错误提示样式后另3图PASSED且全部查看，提示与操作区不重叠。91小程序功能/静态/语法/diff通过，无商品保存/价格发布/新订单或重播种。现有商品无imageFile，图片NOT_AVAILABLE，不冒充图片渲染通过；旧native-profile-price-evidence NOT_VERIFIED不改写，新证据仅入口及模拟状态。NEXT只补图片、窄视口、多角色布局及主流程/价格恢复最终映射，不重复19图。详见local-native-visual-acceptance.md及native-entry-visual-evidence/native-entry-error-evidence。C3/C8/C9仍开放，固定6/9不变。

2026-10-06最新C3原生视觉增量：实际微信开发者工具，role采集16图PASSED、门店14图PASSED（旧大金额图不采用）、独立长文本/真正displayPrice大金额图PASSED且人工查看。修正采集限流/大JSON管道截断/跨运行环境注入/原生凭证预览覆盖与重复导航；每套必须串行。实际多角色账号需要系统角色切换，试加无条件隐藏逻辑已撤回，保留原业务导航，不冒充UI修复；多角色导航布局继续评审。91小程序功能/静态/diff通过，Docker及API3114恢复健康，业务库未重播种/无新业务提交。详见local-native-visual-acceptance.md；NEXT商品/档案/改价和图片、加载/失败/窄视口及最终映射，随后C8/C9剩余。固定6/9不变，C3未整项签收，不是真机/生产证据。

2026-10-06最新C8初始化/演示保护：四个显式演示/账务/报表/通知种子在连接前拒绝production、远程/未知库/无端口/错误协议，17项保护测试PASS；无绕过开关。本地回环不识别生产SSH隧道，不覆盖全部捕获脚本。初始化修正PAYMENT凭证类型，10项只读检查PASS/32付款凭证；新增dataOrigin=UNVERIFIED_LOCAL_DATA及已知夹具前缀计数，明确生产阻塞“来源/截止日未验证”“存在演示夹具”，不冒充账务对平。完整恢复/并发/通知/报表/10万行合跑及cleanup PASSED，规模查询2781.55ms/完整导出3532.18ms；17保护+16恢复测试及build/diff通过。操作映射见local-operations-acceptance.md。C8剩持续负载/兼容及正式期初来源签收，C3/C9开放，固定6/9不变；禁止清理共享业务库或用本地库存检查签生产。

2026-10-06最新C8规模增量：独立恢复库实际100000采购/完成订单/明细，正式HTTP利润100000行及总额对平；异步导出真实worker完成后下载CSV100000行/唯一订单100000/23700142字节，每行金额及门店范围校验通过。查询2696.18ms、完整导出下载校验3475.82ms，本次目标PASS，但单次不是p95或持续200QPS证据。ops:restore-drill/cleanup/build及16防护测试PASS，现有业务库未重置。证据manifest.scaleAcceptance，详见local-operations-acceptance.md；NEXT持续负载、兼容、初始化/演示隔离映射、C3原生视觉/C9交付。整项仍6/9，C8开放；不重复小样本串行计时或再生成同一规模证据。

2026-10-05最新C8并发增量：隔离恢复/报表/通知/性能合跑PASSED，cleanup PASSED。列表10并发100请求p95 36.02ms，利润5并发50请求p95 16.77ms；导出3次含真实worker及CSV下载范围/两行校验p95 4521.62ms，全0错误。修正旧4秒轮询短于5秒扫描，保持10秒门槛。固定小夹具2门店/2供应商/3采购/3订单，不签持续200QPS/10万行规模。8组性能PASS、16防护测试PASS、build PASS。证据var/ops-restore-evidence/manifest.json及local-operations-acceptance.md；NEXT为规模、初始化/演示隔离映射、兼容和C3/C9。整项仍6/9，C8未整项关闭。

2026-10-05最新C8运营增量（覆盖下方旧优先级）：真实隔离恢复和当前通知/报表验收已通过。专用临时PostgreSQL两库、回环动态端口、私有临时根目录；空源库62迁移，真实HTTP300+700采购、收货、充值1000、清账300、供应商付款240及四张私有图片。pg_dump与文件备份后销毁隔离源库/源目录，在0表目标恢复；全部public表行数/内容哈希（含会话/命令/审计/冻结快照）与检查点相同，备份后探针不出现。恢复后账户余额1000/未清700/累计1000/可用1300、原单COMPLETED和付款CONFIRMED/应付0，原清账键精确重放无资金/文件/审计重复。自身图片下载及外店/付款方向拒绝、真实通知保留通过。本地恢复1108ms、故障时手动备份龄165ms，不冒充生产定时备份RPO/WAL/OSS/旧版本应用回退。恢复库内单独PXRPT的R01-R05/CSV/过期导出恢复/失败重试10项与通知自身已读/外人404/提醒去重通过；现有共享业务库未重置。新增ops:restore-drill/ops:restore-test，实际恢复报告var/ops-restore-evidence/manifest.json PASSED/cleanup PASSED，原m6:rollback-check现要求真实报告及迁移/清理/哈希/测量匹配才LOCAL_READY。16隔离/证据门槛测试、build/176单元/21Web/契约/静态/diff通过；728集成/91小程序沿用此前基线，未重跑完整DB集成。所有演练容器/私有临时目录已回收，API3114/Web4173保持。C1/C2/C4/C5/C6/C7仍6/9，本地L4/L5/L6仍3/7；C8剩实际规模/并发/导出完成时间、兼容及初始化/演示隔离最终映射，不能拿两单夹具声称200QPS/10万行达标。NEXT只补这些C8缺格，再C3真实原生视觉和C9干净复现/最终交接；不重新开发已签收业务与财务。详见local-operations-acceptance.md；日志/tmp/ops-restore-final-complete.log、/tmp/ops-restore-complete-tests.log、/tmp/ops-restore-complete-readiness.log。M4 OPEN/M6 NOT_READY，生产4包仍未签收，无新生产/真机/OSS/银行/提交。

2026-10-05最新C4/L4签收（覆盖下方旧优先级）：四结算模式全页面联合28步骤45图PASSED，图片齐全/errors=[]/四组cleanup PASSED。隔离主数据/初始共享价/空账户为夹具；充值或额度、下单/审核、发货/凭证收货、适用清账或付款及确认、历史核价发布执行和新单全部正式UI，无预置业务付款。实际确认付款形成冻结快照1/1/2/1，原已完成单、申请已付、付款/分配、资金及清账项逐字段不变；未完成单与新单采用新价。储值余额924，挂账未清52/累计76（含后续两笔26，原24已清），两账期账户0；储值/挂账无重复公司收款，直结排除公司三账单。最终四模式再跑PASS；原Web57步129图兼容复验PASS。构建/176单元/21Web/契约/静态/diff通过；728集成/91小程序沿用上一批基线，本批无业务服务/迁移变化，不宣称重跑完整集成。62迁移/API3114 session93191数据库健康/Web4173保留；SMJ179120门店/供应商/商品/用户0，私有夹具文件清理。固定C1/C2/C4/C5/C6/C7为6/9，本地L4/L5/L6为3/7；剩余C3/C8/C9，M4 OPEN/M6 NOT_READY，生产4包仍未通过。证据finance-acceptance-matrix.md及var/settlement-mode-journeys/manifest.json，日志/tmp/settlement-mode-final-complete.log、/tmp/settlement-mode-compat-browser.log。NEXT C8隔离本地实际DB/私有凭证备份恢复、通知/报表/租约及可复现规模证据，原check-m6-rollback仅政策与迁移检查不能冒充演练，初始化旧演示库盘点不能替客户签字。C3开发者工具视觉仍须真实截图，C9最后干净复现/交接；不重做已签收C4或追加功能。无新真机/OSS/银行/生产/提交。

2026-10-05当前最终基线（下方此前优先级为历史）：C4上海零点AC-09和精确采购清账AC-E05已通过。四模式×共享/模板8项真实HTTP，应用Date控制23:59:59.999/00:00:00.000/00:00:00.001；不修改OS/数据库时钟。真实采购服务创建/确认300+700，清账300后未清700、可用1300、累计1000；5数据库场景及正式财务5图/私有图片下载通过。补独立creditCumulative和BOOKING/RELEASE/CLEARING流水，确认不重复累计、清账/撤销/减量/少收不减累计；旧账户null显示历史未核定、不伪造历史。62迁移。最终build/728完整集成/176单元/91小程序/21Web/schema/契约/静态/diff通过；独立Web57步129图PASSED、无页面错误、清理PASSED。财务矩阵69项；读权限36入口/432基础检查。前次夹具日期过期及并行价格锁超时已定位、修正测试并独立重跑；不能把失败运行当通过。API3114 session93191数据库健康，Web4173保留。固定C1/C2/C5/C6/C7关闭5/9，本地L5/L6为2/7不变；C4/L4仍因其余模式正式付款/冻结已付联合链开放。NEXT只补储值/挂账/直结适用渠道全页面联合链，不重做午夜/精确清账/69矩阵。随后C3原生视觉、C8运营复现、C9最终交接；M4 OPEN/M6 NOT_READY，无新真机/OSS/银行/生产或提交。证据finance-acceptance-matrix.md、var/credit-occurrence-evidence/manifest.json，日志/tmp/finance-final-integration-serial.log、/tmp/finance-final-browser-serial.log。

2026-10-05最终签收（以下旧优先级均为历史）：C6权限隐私、C7遗留与安全恢复已通过，L5/L6通过，本地2/7；固定C1/C2/C5/C6/C7关闭5/9。修复10动作成功缓存重放绕过当前资源范围，14角色/动作组合改绑404、恢复范围精确重放、原命令不变且无新增审计。68业务写/预览路由完整Nest元数据合同、724次HTTP未登录/越角色/缺范围/错范围拒绝及无副作用；新增付款方向/私有附件真实HTTP，总部财务按原需求§2.3跨门店只读申请/订单/发货，采购/履约写仍403。27未知/历史命令边界HTTP通过：过期/审阅不解除原命令、价格专用关闭不可用于非价格或无合同资源，诊断脱敏、原键仍阻止执行。操作合同及冻结交接见command-recovery-runbook.md；无键无精确恢复、旧可省略附件兼容不伪造历史。最终build/715集成/172单元/91小程序/21Web/契约/静态/diff通过，最终Web57步129图/同单链PASSED、browserErrors=[]、清理PASSED。RPM/WPM/UCB门店/供应商/商品/用户0；61迁移无新增，API3114 session32717健康，Web4173保留，全部测试/临时浏览器已结束。日志/tmp/write-recovery-*.log。剩余固定C3/C4/C8/C9；NEXT C4其余适用模式正式付款/冻结已付联合链、AC-09午夜、AC-E05原1000/300采购凭证来源，不重做C5/C6/C7或56财务矩阵。C3原生视觉和生产/真机/OSS仍未通过，M4 OPEN/M6 NOT_READY。

2026-10-05本批最终验证：付款方向保护后的正式API3114独立浏览器重跑PASSED，57步129图、browserErrors=[]、fixtureCleanup PASSED；包含公司账期同单跨角色链、两侧付款及拒单改派。此前一次改派字段超时不再作为最终结果，未放宽页面或业务断言。RPM/APQ门店、供应商、商品、用户均0；临时浏览器容器停止，API3114/Web4173保留。完整682集成/168单元/91小程序/21Web及构建/契约/静态通过，git diff --check通过。无新迁移、真机、银行、OSS、生产或提交证据。

2026-10-05最新：C6/C7权限隐私与遗留事务保护已交付本批子项。6角色/35读入口含缺失、错误及有效范围矩阵；门店目录/采购/发货成本投影保留双价格版本批准及原键重放；供应商报表/CSV改为服务端采购金额口径，历史销售口径缓存拒绝，缺日期历史订单不伪造日期。付款方向及私有附件补反向保护。四个可省略幂等键的旧价格/采购编辑入口业务与审计同事务，新增48四模式成功/审计失败/连接终止用例；不生成假键，不承诺无键丢响应精确恢复。最终build/682集成/168单元/91小程序/21Web/契约/静态通过，无新迁移仍61。C1/C2/C5关闭3/9，C6/C7本批子项通过但整项OPEN，本地整包仍0/7，不换算代码百分比。下一补C6写动作权限拒绝矩阵与C7遗留/未知结果交接，随后C4明确剩余财务案例；不重复本批事务测试。C3真机视觉/C8/C9及生产域名/OSS仍开放，M4 OPEN/M6 NOT_READY。详见privacy-legacy-acceptance.md。最终API3114健康、Web4173保留；浏览器最终重跑结果见下方最新记录。

当前最终基线（覆盖下方历史优先级）：C5主数据关键写入审计已交付，27现有HTTP写入口×成功/审计插入后抛错54项通过；会话操作者/作用域不可由body伪造，失败回滚主表及关联/版本/价格复制，结果审计只投影非敏感元数据。分类/单位/品牌、商品及转换、供应商及供货/归档、模板及复制/绑定/结算设置、门店、用户均覆盖；用户范围修改补事务内版本校验，并发仅一方成功。完整628集成/158单元/91小程序/21Web/build/契约/静态/diff通过，MDA门店/供应商/商品/模板/用户均0。API3114新审计版本session85919数据库健康，Web4173 HTTP200；无新迁移仍61。固定清单C1/C2/C5关闭3/9，本地整包仍0/7（不是代码0%），M4 OPEN/M6 NOT_READY。下一实施C6完整角色/隐私矩阵及C7遗留无键保护，不重复已交付主数据审计、凭证或价格日历；C4其余付款联验、C3原生视觉、C8/C9仍开放。详见master-data-audit-acceptance.md。本轮未新增页面/真机/OSS/生产证据。

当前验收基线（覆盖下方历史下一步）：build/574完整集成/158单元/91小程序/21Web/contract/mini-web静态/diff通过。新增直结模板3项、四模式普通/历史价日历8项，23专项通过；财务矩阵45→56。补发固定原单首发日期及周期，普通新价与历史核价分开验证；总分账单、账户余额/额度、实收数量/利润/运费和完成日/首发日报表口径对平。SPM/SCC门店/供应商/商品均0。历史日期由隔离夹具设置，不是新增页面/实际时钟/真机证据。本轮仅测试及文档，仍61迁移/API3114账户凭证版本健康/Web4173保持。下一实施C5主数据写审计；C4剩余明确边界见finance-acceptance-matrix.md，不重复已完成价格日历子项。整项仍C1/C2关闭2/9、本地整包0/7，M4 OPEN/M6 NOT_READY。

CURRENT账户凭证交付：61迁移，build/563完整集成/158单元/91小程序/21Web/schema/contract/mini-web静态/diff通过；21新增真实DB凭证成功/故障/所有者用途状态错误/并发/下载拒绝用例。正式财务充值/清账图片上传、旧预览失效不关联、实际丢响应原键恢复只一次、操作人/自身单据下载，7图PASS/cleanup PASS。APE/PXFIN测试门店/用户0。API3114最终凭证构建session47477 readiness database reachable；Web4173保持。C4只关闭凭证子项，旧API无字段兼容归C7；清单仍2/9整项，本地整包0/7。下一批直结模板/时间/周期等资金矩阵明确缺格，再主数据审计；不重做账户凭证。无真机/OSS/银行证据，M4 OPEN/M6 NOT_READY。

最新C2已交付：同一公司账期订单跨STORE/PURCHASER/SUPPLIER/STORE_FINANCE/HQ_FINANCE全程正式页面，业务写入无API前置。完整Web57步129图PASSED、截图缺失0/页面错误0/夹具清理通过；21Web测试/静态/契约/脚本语法/diff通过。C1+C2关闭2/9，本地整包仍0/7。下一项优先修复原AC-24/AC-E05充值/清账私有凭证关联和页面；已确认当前输入/schema无附件关系，不再只列待验收。无新业务后端/迁移或真机验收。

2026-10-05最新收尾进展：C1交付（40AC/全部DEV映射），固定清单关闭1/9；本地整包仍0/7，不折算代码百分比。API3114正式Web重新验证51步121图PASSED、文件缺失0、cleanup PASSED/browserErrors空；财务专项45/45通过并建立适用矩阵。无业务代码变更/无完整542重跑。下一交付：同一订单全程正式角色页面串联，并补C4明确缺格；当前Web含API前置不能冒充该项。证据和剩余边界见requirement-delivery-map.md、finance-acceptance-matrix.md。

最新交付核对见[delivery-closure.md](delivery-closure.md)：固定9项本地收尾，7包均有部分证据但整包关闭0/7（不是代码完成0%）。实际Web manifest为51步/121图、缺失0/清理通过；原生资料/价格功能通过但视觉截图0。已确认主数据审计和价格无键兼容路径缺口；其余须补完整验收映射而非默认重写。下一批C1细项映射+C2跨角色串联+C4资金矩阵优先，替代历史后台优先建议。

2026-10-05 delivery exit now governed by [completion-standard.md](completion-standard.md):7 fixed local acceptance packages and4 production packages. No overall percentage until existing evidence is mapped; counts of tests are not completion. Priority supersedes backend-first next-batch notes below: audit evidence against L1-L7, verify formal cross-role workflow/financial matrix, fix blocking gaps only, final local handoff. Preserve required audit/privacy/recovery work and original requirements; production dependencies remain separate.

Current accepted checkpoint: build/158 unit/542 full integration/91 mini/21 Web/contract/mini-web static/diff PASS.137 new remedy DB cases, including four-mode faults, paid CREDIT refusal history and conflicting decisions. Freight request/confirm/reject, supplier rejection/funding reconcile and discrepancy ACCEPT/REPLENISH/RETURN now commit business/funds/notifications/command/audit together. APQ stores/suppliers/products/users/files0. API3114 final remedy build readiness database reachable; Web4173 HTTP200. This supersedes the pending remedy work and405 count below.60 migrations/M4 OPEN/M6 NOT_READY, no new UI/device/OSS acceptance.

Next bounded batch: inventory legacy/headerless write paths and master-data audit coverage; document required versus optional idempotency per action before changing contracts, then add focused permission/privacy and recovery acceptance for confirmed gaps. Do not repeat accepted procurement/price/fulfillment/remedy atomics. Separately close formal native visual/device evidence and production/domain/OSS/release gates; these remain real acceptance requirements, not more financial features.

Final fulfillment acceptance: build158 unit/405 full integration/91 mini/21 Web/contract/mini-web static/diff PASS,51 new DB cases; APQ stores/suppliers/products/users/files0. API3114 final fulfillment build healthy, Web4173 HTTP200. Next freight request/review, supplier rejection/funding reconcile and discrepancy resolution atomics, not repeat shipment/receipt.60 migrations/M4 OPEN/M6 NOT_READY; full legacy recovery/UI/device/OSS/release still open.

Latest fulfillment batch: shipment create and receipt create now atomically commit business/funds/adjustments/evidence/discrepancies/notifications/command/audit.51 new real-DB cases added for four modes/faults/concurrency/evidence replay. Next freight request/review, supplier rejection/funding reconcile and discrepancy resolution; legacy/headerless/global crash recovery still open. No new migration/UI/visual/device acceptance,60 migrations/M4 OPEN/M6 NOT_READY.

Final October5 acceptance PASS: generate/migrate/schema/build158 unit/354 full integration/91 mini/21 Web/contract/mini-web static/diff; contract/rollback/auth/APQ fixture users0. API3114 final atomic-contract build healthy, Web4173 HTTP200.60 migrations; new marked-price interrupted/unknown execution reconciliation verified, legacy/non-atomic and native/release gates remain open. M4 OPEN/M6 NOT_READY, not global recovery completion.

Latest October5: persistent server atomic-price execution contract (migration60/defaultfalse/no legacy backfill) plus ADMIN keyed audited uncommitted closure. Acquiring command lock then observing PROCESSING proves no atomic business commit; committed success replays, stale execution handles blocked after closure.8 DB tests plus four-mode/HTTP/native coverage added; old/unbound/headerless/other non-atomic paths remain open. No automatic retry/compensation or new visual/device evidence; M4 OPEN/M6 NOT_READY.

Latest native price page delivery: server task-submission records with status/time/failure reason, independent retry and stale-response isolation now visible; no auto retry or pending release from reads.90 mini/21 Web/build/contract/mini-web static PASS,7 new page tests. Backend unchanged and previous346 DB acceptance not rerun. Runtime API3114 accepted rollback build. No new visual/device evidence;59 migrations/M4 OPEN/M6 NOT_READY. Remaining commit-unknown/crash-no-proof/legacy and formal native/release acceptance.

Final proven price rollback closure acceptance: build158 unit/346 full integration/83 mini/21 Web/contract/mini-web static PASS; real four-mode recovery/funds and HTTP permissions/replay verified. Mini original-key failure replay ends pending without automatic rerun. API3114 updated/healthy, Web4173 HTTP200; isolated rollback/review/auth/APQ users0. Narrow proven-price rollback path closed, NOT general compensation or commit-unknown recovery. Remaining: commit-unknown/crash-no-proof, legacy/unbound calls, full attempt history/native/release.59 migrations/M4 OPEN/M6 NOT_READY.

Latest proven rollback recovery: a narrow server-generated price callback rollback proof permits ADMIN keyed audited closure to FAILED, followed by explicit fresh submission through original business validations. Commit-unknown/legacy/terminal/no-proof commands remain blocked; no automatic retry/compensation.5 DB+1 unit and actual pricing/HTTP coverage added.59 migrations/M4 OPEN/M6 NOT_READY; no new UI/device evidence.

Final task submissions/audited reviews acceptance: build157 unit/341 full integration/82 mini/21 Web/contract/mini-web static/diff PASS. ADMIN HTTP stale200/review201/original-key replay, non-admin403; review/task-scope rollback DB tests PASS. Isolated review/diagnostic/auth/APQ users0; API3114 final review build healthy, Web4173 HTTP200. Next proven-outcome remediation and legacy/unbound execution coverage, not repeat accepted review/history. No manual unlock/compensation or new UI/device evidence;59 migrations/M4 OPEN/M6 NOT_READY.

Latest delivery: scoped price-task submission history and ADMIN-only keyed audited review records. Review verifies locked current status and preserves original command/state/funds, response explicitly NO_STATE_CHANGE; not manual unlocking/compensation.5 new DB cases plus expanded task-scope/HTTP/guard tests; no migration/UI/device evidence. Full task execution-attempt coverage and proven-outcome manual remediation/legacy cases remain open; M4 OPEN/M6 NOT_READY.

Final diagnostics acceptance PASS: build157 unit/336 full integration/82 mini/21 Web/contract/mini-web static; diagnostic/APQ user fixtures0. Own-summary auth HTTP401/200, actor-query isolation, limit400 and non-admin stale403 verified. API3114 final diagnostics build healthy, Web4173 HTTP200. Next task-level attempt history and audited manual remediation; do not repeat delivered diagnostics/basic HTTP checks.59 migrations/M4 OPEN/M6 NOT_READY, no new visual/device evidence.

Latest server command diagnostics delivered: own redacted command summaries and ADMIN-only stale PROCESSING query, best-effort sanitized unknown-outcome persistence and early price-task resource binding.2 unit/1 DB tests added; no migration/UI/device evidence. This provides read-only reconciliation evidence, NOT safe automatic retry/manual terminal resolution. HTTP permission acceptance, task-level attempt history and audited remediation remain outstanding; M4 OPEN/M6 NOT_READY.

Latest native price-run recovery: durable original-key execution/recovery implemented on prices page, pending survives restart and task refresh, late results isolated; local history retains completed run and definite error code.82 mini/21 Web/build/contract/mini-web static PASS; no backend changes or new full DB regression (previous335 integration remains historical acceptance). Next server task-level failure diagnostics and long-lived PROCESSING reconciliation, not client recovery. No new visual/device evidence; M4 OPEN/M6 NOT_READY.

Final keyed price-process acceptance: build155 unit/335 full integration/76 mini/21 Web/contract/mini-web static PASS,16 newly added DB cases; APQ fixture counts all0. API3114 final price-process build readiness database reachable, Web4173 entry HTTP200. Next persisted failure diagnostics/client keyed recovery and long-lived PROCESSING reconciliation. No new migration or visual/device acceptance, M4 OPEN/M6 NOT_READY.

Latest keyed price processing implementation: jobs/:id/process now commits pricing/funds/adjustments/run result with command success and price.process audit in one explicit transaction, returning tx-aware detail for exact replay.16 added four-mode/fault DB cases. Headerless/native execution remains existing GET-based recovery; persisted failure diagnostics, client keyed recovery and long-lived PROCESSING reconciliation are still outstanding. No migration/UI/device evidence; M4 OPEN/M6 NOT_READY.

Final purchase-edit acceptance: build155 unit/319 full integration/76 mini/21 Web/schema/static/contract PASS;132 focused procurement/price cases including74 newly added edit/assign/reallocate/cancel/switch/fault cases. APQ store/supplier/product/user all0; git diff --check PASS. Keyed purchase chain accepted with complete tx-aware returned details; headerless edit/assignment still legacy separate business/audit. Next price-run result/audit/failure trace, long-lived PROCESSING/manual reconciliation and keyless/full audit/privacy/native/release.59 migrations/M4 OPEN/M6 NOT_READY, no new visual/device/bank evidence.

October4 purchase-edit atomicity supersedes next-replaceItems/assign/reallocate instructions below. Keyed item replacement/assignment and required-key refusal reallocation now share explicit tx for business/funds/new orders, command result and audit. All three return full tx-aware detail consistent with subsequent GET, including names/progress/rejection handling, rather than the older minimal write snapshot.74 new real-DB cases PASS (132 focused total): four settlement modes x four operations x four success/fault modes, STORED_VALUE/CREDIT switches, version race and headerless compatibility. Existing preview/recheck and lock rules retained; failure preserves original request/funds/order state, replay commits once. Headerless edit/assign retain legacy separate business/audit behavior; price-run processing and keyless price protection remain next, not complete global recovery. No migration/UI/device/bank acceptance,59 migrations/M4 OPEN/M6 NOT_READY. Next price-run result/audit/failure tracing, long-lived PROCESSING/manual reconciliation, keyless legacy and full audit/privacy/native/release. Final full-regression/runtime in development-log.

Final core-procurement/keyed-price acceptance: build155 unit/245 full integration/76 mini/21 Web/schema/static/contract PASS;58 new DB cases, APQ store/supplier/product/user all0, git diff --check PASS. create/confirm/reject plus keyed publication accepted, NOT all purchase/pricing. Next replaceItems/assign/reallocate, then price-run recovery and long-lived PROCESSING/manual reconciliation;59 migrations/M4 OPEN/M6 NOT_READY unchanged. No new visual/device/bank acceptance.

October4 procurement core/keyed-price atomicity supersedes next-core-purchase/publication instructions below. Purchase create/confirm/reject now pass one explicit tx through business funds/splits, command success and audit. Keyed shared/template price publication includes actual version/run/impacted orders/template-version update plus command/audit in one tx; price.publish audit added.58 real-DB focused cases PASS: four modes x three purchase writes x four success/fault modes, two price scopes x four modes, confirm/reject race and headerless compatibility. Failure rolls back funds/requests/orders/version/run/audit; confirmation does not book funds twice; original retired target remains historical. No migration (59) or new UI/device/bank acceptance. Headerless pricing retains legacy standalone behavior without keyed recovery/audit; purchase edit/assign/reallocate and price-run processing still need this integration. Next those three purchase writes, then price-run recovery and long-lived PROCESSING/manual reconciliation/full audit/privacy/native/release. M4 OPEN/M6 NOT_READY; this is NOT all purchase/pricing or global recovery closure. Final regression/runtime in development-log.

Final difference-atomicity acceptance: build155 unit/187 full integration/76 mini/21 Web/schema/static/contract PASS;36 new DB cases, ADC store/supplier/product/user/file counts all0 and git diff --check PASS. API3114 latest difference build readiness database reachable, Web4173 HTTP200. Account/payment/difference atomics accepted; purchase/pricing windows and long-lived PROCESSING reconciliation still next. No migration/UI/device/bank acceptance;59 migrations/M4 OPEN/M6 NOT_READY.

October4 difference-disposal atomicity supersedes next-difference instructions below. create/confirm now share explicit tx for business, command response and audit; CREDIT confirmation payment-summary refresh uses that same tx and existing ordered funding locks.36 real-DB focused cases PASS with actual cleared-credit price adjustment and actual confirmed-payment overpayment sources: both disposal methods, both operations, completion/audit/backend-termination faults, same-credit race, shared-target capacity race and receiver scope/direction failures. Paid120 becomes110 only on confirmed disposal; failure preserves request/clearing/account, failed OFFSET creation releases target reservation. No migration (59), UI/OSS/device/bank or full-global-recovery acceptance. Final regression/runtime in development-log. Next purchase/pricing atomics, long-lived PROCESSING reconciliation, full master-data audit/privacy/native/release; M4 OPEN/M6 NOT_READY. Account/payment/difference routes are delivered, do not repeat them.

Final payment-atomicity acceptance: build155 unit/151 full integration/76 mini/21 Web/schema/static/contract PASS;52 new payment DB cases. APC store/supplier/user/file and CCF store/supplier counts all0; git diff --check PASS. Verified scope is account writes plus payment create/confirm/reject/cancel, NOT global recovery. Next difference-disposals atomics;59 migrations/M4 OPEN/M6 NOT_READY unchanged.

October4 payment atomicity checkpoint supersedes payment-record separate-transaction next tasks below. create/confirm/reject/cancel now pass one explicit tx through business, command response and audit. Allocations, confirmation snapshots/overpayments and rejection/cancellation releases roll back together on failure. Proof linking uses owner/READY/purpose/unlinked conditional update with exact count, preventing concurrent payments from stealing the same proof.52 real-DB focused cases PASS: three payment directions x four writes x four success/fault modes, proof race and scoped/invalid-proof failures. These use isolated completed-order/READY-file baselines, not new OSS/role-UI/device/bank or all-settlement-mode acceptance. No migration (59). Final full-regression/runtime results recorded in development-log. Next difference-disposal create/confirm atomicity, then purchaser/pricing, long-lived PROCESSING reconciliation and global audit/privacy/native/release. M4 OPEN/M6 NOT_READY; do not redo delivered account/payment atomics or treat them as full recovery closure.

Final account-atomicity acceptance: build153 unit/99 full integration/76 mini/21 Web/schema/static/contract PASS;14 new account DB cases plus one command terminal-state case. ATC isolated stores/users/commands/audits all0; git diff --check PASS. This is the verified result for the account checkpoint below, superseding its pending-validation wording. Scope remains three account routes only; M4 OPEN/M6 NOT_READY,59 migrations unchanged.

October4 account-command atomicity implementation: store.recharge.create, store.credit-limit.update and store.clearing.create now commit business data, command success/response and audit in one explicit Prisma transaction. Command row locking rechecks terminal state before execution; incomplete completion rolls back. Credit-limit updates lock the existing account before checking version/used credit, without creating missing accounts. Definite business failure remains FAILED; unknown transaction outcome remains PROCESSING and is NOT automatically retried. Terminal failure writes are conditional on PROCESSING, preserving earlier success/original failure. New real-DB tests cover completion/audit fault injection, actual transaction-backend termination before commit, exact replay, stale-started concurrency, version conflicts and missing-account semantics. No new migration/UI/visual evidence;59 migrations/M4 OPEN/M6 NOT_READY. Validation results will be recorded in the development log after final regression. This closes only these three account routes, NOT the global command/business crash gap. Next payment create/confirm/reject/cancel, then difference create/confirm and purchaser writes/pricing, followed by long-lived PROCESSING reconciliation, cross-module audit/privacy and native/release gates.

Latest October4 paid-credit supplier-refusal checkpoint supersedes refusal-unimplemented/58-migration notes below. Actual supplier refusal creates a negative STORE AdjustmentDocument with explicit sourceRejectedOrderId, only for effective paid money not already covered by pending price/shortage credit. Retired funding retains gross netPaid/original ClearingItems and its rejected order; unpaid credit is released, never refunded as cash. Purchaser cancellation or reallocation (including same supplier and COMPANY_TERM) preserves that history; replacement CREDIT gets a distinct allocation and fresh limit validation. Retired paid money is excluded from request payment summaries. Independent OFFLINE_RETURN/OFFSET confirmation reuses existing disposal controls; no automatic stored-balance refund or payment transfer. Migration20261004110000_add_rejected_credit_adjustment_source applied,59 migrations; source CHECK and per-order/side uniqueness retained. Build153 unit/84 full integration/76 mini/21 Web/schema/static/contract PASS;20 focused cases including8 new refusal scenarios. Failed-run fixtures cleaned by exact identities; subsequent fixture cleanup verified. Covers supplier refusal followed by purchaser cancel/reallocation, NOT arbitrary cancellation of paid orders. No new role-UI screenshots/native visual/device/bank acceptance. Next cross-module write-audit/privacy and command/business crash reconciliation, then outstanding native visual and release acceptance; M4 OPEN/M6 NOT_READY. Remaining category counts are unequal work packages, not completion percentages.

Latest October4 confirmed-credit reincrease checkpoint supersedes reincrease-unimplemented notes below. Effective CREDIT payment is gross allocation netPaid minus CONFIRMED STORE negative-adjustment disposals (offline return or offset), never pending dispositions; original clearing and gross paid records retained. Funding repricing, clearing summaries and shortage calculation share this state. Receiver confirmation locks source account/requests and updates disposal/payment summary atomically. Returned/offset20 after paid120 immediately gives effective paid100; target120 then books only20, clearing20 gives effective120/gross140; later target110 creates only new credit10. Unassigned/PENDING/partially confirmed credit still blocks reincrease; all-confirmed credits permit it with fresh limit checking. Actual offline/offset, partial/concurrent confirmation, credit-limit rollback, replay and immutable clearing tests PASS. Build153 unit/76 full integration/76 mini/21 Web/static/contract PASS;12 financial cases and CCF cleanup verified. No migration/new visual/device/bank acceptance. Next paid-credit supplier refusal/cancel/reallocation with preserved history and effective-payment handling, then global audit/crash/native visual/release. M4 OPEN/M6 NOT_READY.

Latest October4 cleared-credit historical-price decrease checkpoint supersedes price-decrease-blocked notes below. Actual ClearingItems plus a matching negative PriceChangeAdjustment authorize only newly excess-paid STORE credit; netPaid/clearing retained, unpaid credit released, no balance refund. Paid120/target130→110 releases10 and creates10 credit;110→100 creates only another10. Works in run processing, frozen supplier side and final-receipt price checkpoint. CREDIT negative STORE documents are generated by funding evidence, not synthetic frozen receivable alone. Consecutive credits retain separate actionable list/detail IDs; other channels retain existing net summaries. Offline return/company-term offset/repeated handling and funding resync verified. Build145 unit/75 full integration/76 mini/21 Web/static/contract PASS;11 focused cases and CCF cleanup PASS. No migration/new visual/device evidence. Subsequent increase after a credit is deliberately blocked by CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED pending refunded/offset payment reconciliation; paid-credit refusal also remains blocked. Next these two flows, then global audit/crash/native visual/release. M4 OPEN/M6 NOT_READY; not full financial completion.

Latest October4 restored-DB acceptance supersedes DATABASE ACCEPTANCE PENDING/environment-blocked notes below. Docker/PostgreSQL healthy; build144 unit/70 full integration/75 mini/20 Web/static/contract PASS. Six cleared-credit cases PASS: actual paid history retained, incremental funding/clearing, full-paid and mixed paid/unpaid accepted shortage, offline return and company-term offset, recipient scope/replay protection, documented-credit funding resync. Paid120/target130 shortage104 releases10 unpaid and creates only16 STORE credit; full-paid120 shortage96 creates24. No balance refund or clearing history mutation. Corrected legacy synthetic CREDIT frozen-receivable expectation: snapshot is not payment proof; unpaid reduction releases credit without a refundable STORE document. CCF cleanup verified. No migration or new visual/device evidence. Next remaining cleared-credit negative-price/refusal workflows and global audit/crash reconciliation; M4 OPEN/M6 NOT_READY,7 unequal categories unchanged.

Latest October4 cleared-credit shortage adjustment implementation (DATABASE ACCEPTANCE PENDING) supersedes shortage-blocked notes below. Accepted shortage preserves netPaid and original clearing; releases only unpaid credit, creates STORE negative AdjustmentDocument only for newly excess paid amount, reuses existing OFFLINE_RETURN/OFFSET disposal. No automatic stored-balance refund. Payment summary includes effective freight. Funding reconciliation preserves an already documented shortage credit only when target does not decrease further and documents cover excess; undocumented price decreases/refusal remain blocked. Build144 unit/75 mini/20 Web/static/contract PASS. Six real-DB cases prepared (including mixed paid/unpaid credit and company-term offset), but execution failed because PostgreSQL55438 unreachable, Docker daemon socket absent and Docker app launch failed. NOT a financial acceptance pass; previous68 integration PASS does not apply to this batch. Next restore local DB, rerun focused six/full integration and verify cleanup, then remaining negative-price/refusal workflows and audit. No migration, no latest API rollout or new visual/device evidence; M4 OPEN/M6 NOT_READY.

Latest October4 clearing-summary checkpoint supersedes the immediate-summary gap below: createClearing locks account and affected requests in the funding order, then updates request paidAmount/paymentStatus in the same transaction from valid funding and current freight. No funding reconciliation, balance deduction or extra credit booking. Clearing120 reports PAID120; target130 reports UNPAID120; final clearing10 reports PAID130. Concurrent identical clearing requests are tested for one success only. Web/mini show a Chinese definite CLEARED_CREDIT_ADJUSTMENT_REQUIRED blocker. Independent settled-credit negative adjustment remains OPEN; no migration, visual/device pass or M4 closure.

Latest October4 cleared-credit funding checkpoint: fully cleared CREDIT allocations remain part of funding when backed by actual ClearingItems, even when inactive. Repricing reuses the same allocation: actual cleared120 plus target130 creates only outstanding10; clearing that10 returns creditUsed to0 without changing prior clearing items. Below-paid repricing, accepted shortage and supplier refusal roll back with CLEARED_CREDIT_ADJUSTMENT_REQUIRED. Four-mode template override/freight/statements matrix covers historical, immediate and future prices; completed orders remain unchanged. No migration or new financial UI. This closes the lost-cleared-payment defect, NOT the separate cleared-credit negative settlement workflow, immediate clearing payment-summary refresh, global crash reconciliation or native visual acceptance. M4 OPEN/M6 NOT_READY and7 unequal remaining categories remain. Next implement/review independent settled-credit adjustment against requirements before claiming full financial completion.

Latest October4 native own-profile/rapid-price checkpoint supersedes their implementation-missing notes below. Actual WXML/WXSS/JS pages added: Supplier "我的"→own profile/banking/read-only catalog and search, Store "我的"→independent receipt profile, Purchaser "改价"→shared/template selection, eligible products/suppliers, effective date/time, reason, server impact/recheck/publication, versions and run processing. Template cost readonly and sourced from shared quote; changed scope clears stale prices. Keyed POST price-changes now Commands.perform with exact SUCCEEDED replay, FAILED original error and PROCESSING409; existing headerless integrations remain compatible and are not globally protected. Native publication persists original request/key and actual version in actor/server-scoped history; uncertain run blocks writes until GET refresh. Build140 unit/52 full HTTP/74 mini/19 Web/static/contract PASS. Real WeChat Developer Tools functional run PASSED/fixtureCleanup PASSED: own Supplier forbidden write/foreign catalog, own profiles/catalog, one actual template version after committed response loss/navigation/replay, order goods28/cost20; shared cost9 preserves template sale14, actual run lost-response/GET recovery one adjustment/final goods28/cost18/account-ledger0. Evidence var/native-profile-price-evidence/manifest.json explicitly visualAcceptance NOT_VERIFIED/screenshots empty: simulator screenshot service timed out, not a visual/device pass. Failed attempts cleaned; no preexisting order/account mutation. API3114 latest/Web4173 retained; previous Web51-step121-image manifest not rerun by this native batch.7 unequal categories/58 migrations/M4 OPEN/M6 NOT_READY remain. Next full four-mode/template/frozen/cleared-credit funding acceptance and master-data write audit; recover native visual evidence separately, do not redevelop these pages or claim headerless/crash/price-preview atomicity closed.

Latest October4 positive-adjustment/purchaser-exception batch supersedes their outstanding notes below. Real frozen-paid company order late shortage/replenishment adds approved freight3.50 per side; StoreFinance registers extra collection, central confirms, then central supplier extra payment/scoped Supplier confirmation, remaining0 and original snapshots unchanged/account-ledger0. Fixed double-counted current freight in company payment gate: frozen store base plus positive adjustments; collection lookup supports both known statement/payment ID encodings without historical rewrites. Formal Purchaser edits against original request template despite store rebinding; invalid products retained until explicit removal, invalid supplier/unit selection cleared without automatic reinterpretation, reason and fresh preview required. Actual edit recovery once, procurement confirmation, supplier rejection, lost-eligibility rejection without mutation, successful reallocation recovery once, rejected-item cancellation and procurement refusal recovery once verified. Per-item supplier/cancel controls, original-template/current relation/active/unshipped candidate filtering and transactional eligibility checks added. All-item cancellation now persists CANCELED, not CONFIRMED; procurement reject uses Commands.perform/SUCCEEDED-only replay. Build140 unit/52 HTTP/61 mini/19 Web/static/contract PASS; final browser51 steps121 screenshots/cleanup PASS/no page exceptions.7 unequal remaining categories/58 migrations/M4 OPEN/M6 NOT_READY: native own-profile/catalog and rapid pricing next, then full funding/reliability/release. Synthetic proofs/API precursor and company-term cancellations do not prove genuine funds/device or account-funded cancellation; no automatic legacy reconciliation/general history expansion.

October4 Finance branch acceptance supersedes the outstanding Direct/cancel/preview-change/opposite-disposal notes below. Actual StoreFinance cancellation with required reason and lost-response recovery releases allocations once; a real competing payment reservation invalidates the approved preview without creating another payment. Store OFFSET and Supplier OFFLINE_RETURN are registered and confirmed by their own scoped recipients. Equal-price SUPPLIER_TERM Direct payment16 is registered by StoreFinance and confirmed by Supplier, payable0/no account-ledger writes. Found/fixed Direct orders incorrectly appearing in company supplier payables: total/store summaries and adjustment-only periods now exclude direct sources, without rewriting history. Build134 unit/52 HTTP/61 mini/17 Web/static/contract PASS; full browser46 steps109 screenshots/cleanup PASS. Synthetic proofs and actual API setup are not banking/full four-mode acceptance. Next positive-adjustment payment专项, purchaser invalidated-config/reallocation, native remaining entries and full funding/reliability/release.9 unequal categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged.

Latest October4 Finance difference delivery: adjustment sources/detail, real-credit remaining amount, offline return/statement-target offset registration, scoped confirmation/completed readonly and original-key recovery now formal UI. Backend scope/command protection added, target order names exposed on disposal reads, bill initialization click race fixed. Build132 unit/52 HTTP/61 mini/17 Web/static/contract PASS; final browser42 steps98 screenshots cleanup PASS proves actual frozen paid order late shortage, Store12.50 offline registration/recovery once/own confirmation and Supplier10 offset/own confirmation, original snapshots unchanged and no account-ledger mutation. Synthetic proofs/API shortage+target fulfillment not banking/all-mode acceptance. Finance normal controls are delivered, not query-only; remaining financial branch acceptance and full M4 funding checks keep its row open.9 categories/58 migrations/M4 OPEN/M6 NOT_READY.

October4 formal Finance payment increment: statement-type selection, settlement-item checkboxes, preview/repreview, private proof upload/retry, registration/recovery and payment detail/download/confirm/reject/cancel implemented. Backend create/cancel replay/failure handling fixed; suppliers cannot review company Store collections. Build130 unit/52 HTTP/61 mini/16 Web/static/contract PASS; final browser41 steps94 images cleanup PASS, actual StoreFinance create lost-response recovery once, central reject/release/corrected confirm, central supplier registration and scoped supplier confirmation. Synthetic proof and API fulfillment setup are not real funds/full financial acceptance. Cancellation/Direct/positive-adjustment/payment-preview-change UI acceptance remains, along with difference controls. No migration/category closure:58 migrations,9 remaining/M4 OPEN/M6 NOT_READY.

Latest October4 formal Finance account delivery: own/central store selection, balances/credit/ledger, readonly StoreFinance, HQ recharge/credit-limit PATCH and selected clearing preview/repreview/commit with pending recovery now implemented. New scoped credit-items API exposes only active positive outstanding allocations and provenance, no manual UUIDs. Build127 unit/52 HTTP/15 Web/static/contract PASS; dedicated browser5 screenshots PASS/cleanup PASS. Actual recharge100/limit200/clearing25 ends balance100/used0; changed preview blocked, lost response recovered exactly1 clearing/2 ledgers. Opening credit25 seeded solely in isolated local fixture; not full procurement funding or genuine-funds acceptance. Remaining Finance bill payment/evidence/review/difference controls not delivered.9 categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged.

October4 financial-account safety: recharge/credit-limit/clearing no longer reexecute PROCESSING commands or return empty success for FAILED; definite errors persist and replay. Account/ledger reads now reject unbound, mismatched and foreign Store scopes. Build127 unit/52 full HTTP PASS, plus latest focused2 HTTP PASS including invalid recharge repeated with one key (FAILED, no extra document/ledger). These are backend safety checks, NOT delivered financial operation UI or financial browser acceptance. Next remains formal recharge/credit/clearing/payment/difference controls.58 migrations/9 remaining categories/M4 OPEN/M6 NOT_READY unchanged; transaction/command/audit crash reconciliation still open.

Latest October4 formal Store checkpoint: Store is no longer query-only. Scoped catalog/cart/unit/quantity/image/preview/order, request→shipment→receipt, evidence upload/retry/removal/current image and returned revision implemented. Own store locked; visible quote sales-only; STORE_FINANCE readonly. Create and receipt actual commits with lost-response recovery once, required photo/max quantity/unchanged no-resubmit and RETURN revision2 proven by browser40 steps/91 images, cleanup PASS, mobile cart/receipt images inspected. Receipt FAILED replay fixed through Commands.perform; missing/mismatched business scopes denied on purchase/catalog/shipment APIs, cross-store reads denied by new real HTTP test. Build117 unit/52 HTTP/61 mini/14 Web/static/contract PASS. Synthetic photos, procurement/ship/RETURN setup via actual API, not device/genuine photo/additional role UI acceptance.58 migrations,9 unequal remaining categories: Store normal-path gap shrunk inside the still-open invalidated-config edit row, not stalled delivery or a completion percentage. Next formal financial writes (recharge/credit/clearing/payment/difference), purchaser repair/reallocation, native remaining entries and full financial/release acceptance. M4 OPEN/M6 NOT_READY, full audit/read-price privacy/crash reconciliation unchanged.

Latest October4 supplier full-flow checkpoint: formal supplier shipment/reduction/replenishment/refusal/freight/discrepancy/payment-review normal entry now locally accepted, superseding implementation-only notes below. Fixed replenishment reducing normal backlog: actual gap allocations added back in shared detail/preview calculation; gap-only preview leaves original backlog unchanged. Browser verifies ordered6/reduced1/short1/replenish1/remaining2/received5/cost50, actual shipment and payment commits with response-loss recovery once, ACCEPT payable10, RETURN/revised receipt payable20, approved freight3.50 used once, real payment rejection releases reservation and corrected confirmation yields payable0. Company payment is blocked before store receivable settles; setup uses actual API registration/confirmation, no balance overwrite or real funds. Build117 unit/51 HTTP/61 mini/13 Web/static/contract PASS; browser36 steps/84 images, cleanup PASS, mobile gap/payment images inspected. Supplier formal-entry row removed from remaining list:9 unequal categories, not a percent;58 migrations unchanged. Store/finance formal UI remains incomplete; full four-mode financial/M4, global audit/crash reconciliation and native/device/production/M6 remain open. Next formal Store order/receipt/evidence, then financial writes; do not repeat supplier normal-entry development.

Latest October4 supplier-workspace checkpoint: formal supplier view is no longer query-only. Real API shipment/reduction/replenishment/approved-freight preview and submit, refusal, current discrepancy list/detail/actions, payment evidence/confirm/reject controls implemented. Exact remaining quantities and supplier-only company sales-price removal added; missing/mismatched business scopes denied on supplier-orders/discrepancies/payment-records. Build115 unit/51 HTTP plus enhanced scoped HTTP/61 mini/13 Web/static/contract PASS; browser32 steps/70 images cleanup PASS proves desktop/mobile shipment preview, approval invalidation and actual refusal. Full browser shipment commit/recovery, shortage/replenishment and allocated payment-review chains remain NOT_VERIFIED and are next priority; then Store/finance. No migration (58),10 unequal remaining categories unchanged, M4 OPEN/M6 NOT_READY. This implementation checkpoint is not complete supplier financial acceptance.

Latest October4 purchaser-workflow checkpoint supersedes next-proxy-order/edit/assignment instructions below. Formal Web now supports store/catalog/category selection, product add/remove, sales/purchase units and quantities, money preview, proxy creation, reasoned item replacement, category/batch assignment, eligibility preview and confirmation. Replacement preview shares save validation; approved sale/cost sources and create template identity checked server-side. Optional-key PATCH/assign preserve legacy callers; formal client persists method/body/key, exact recovery verified, success audited once, failures/PROCESSING cannot reexecute. Build113 unit/51 HTTP/61 mini/12 Web/static/contract PASS; browser31 steps/67 images cleanup PASS.58 migrations unchanged.10 categories remain: normal Store query-only, supplier/finance actions, invalidated-original-config editing repair, full audit/crash reconciliation, native profiles and financial/release acceptance still open. Next formal supplier shipment/rejection/difference/payment actions, then Store/finance and remaining acceptance. M4 OPEN/M6 NOT_READY; do not redo delivered purchaser controls.

Latest October4 scoped-profile/archive checkpoint supersedes missing Web self-profile/archive instructions below.58 migrations deployed. Scoped store/supplier detail rejects missing/foreign scopes; supplier catalog exposes product identities and shared supply price/source only, never company sale/default price/profit. Formal Web own-profile/catalog readonly; versioned archive removes current product/template-supplier/settings links, bumps template versions, blocks edits/reassociation, retains supplier/orders/price versions without financial rewrites. Build113 unit/50 HTTP/61 mini/10 Web/static/contract/schema PASS; browser28 steps/61 images cleanup PASS.10 categories remain: full write audit, native own-profile/catalog entry, formal role actions and financial/release acceptance still open. Next formal purchaser order/edit/assignment, then supplier/finance actions and native profile/catalog; do not redo completed Web profile/archive. M4 OPEN/M6 NOT_READY.

Latest October4 template pricing/rules checkpoint supersedes next-template-price instructions below. Deployed template price scopes/rules and separate price-source migrations (57 total). Template sales prices are independent; supplier cost remains shared product+supplier pricing per requirements and database design. One effective-price resolver feeds catalog/request edit/assignment/reallocation/repricing/checkpoints. New request/order lines track both price versions; old unknowns stay NULL. Scope publication cannot change supplier cost, and direct-settlement current/future equality is guarded. Copy creates independent current/future sales configuration, not old publication runs/history or an independent supplier cost; rules/enablement/initial values retained. Template rule writes and previews use catalog locks, transaction snapshots capture applicable rules; write rechecks both price sources and template metadata. Formal Web category/rule/effective-price display, scope selector/quote/readonly cost/version/job flows delivered.113 unit/50 HTTP/61 mini/10 Web/static/schema PASS; browser25 steps/54 images and cleanup PASS. DEV-105 local functional gaps removed from remaining table:10 categories remain, unequal work packages, not a completion percentage. Next scoped self-profile/supplier archive, then formal role actions and remaining template-price funding/mode/freeze reconciliation/native quick-price work. M4 OPEN/M6 NOT_READY; no new native visual/full financial acceptance claimed.

October4 default-price checkpoint supersedes the next-default-price instructions below. Migration20261004070000_product_default_price_optional_sku deployed: new products require a nonnegative six-decimal defaultSalesPrice; SKU is optional/editable/clearable with serialized uniqueness and version conflicts. Legacy missing prices remain NULL and ordinary partial edits do not fabricate them. Web/native product editors implemented. TemplateItem.initialSalesPrice captures the product default on first association; repeated saves and copies preserve the captured value, including NULL, without publishing price versions or rewriting historical money. This is an initialization snapshot, NOT effective template-specific pricing. Build110 unit/49 HTTP/60 mini/10 Web and static/schema checks PASS; browser23 steps/51 screenshots, cleanup PASS. Native visual/device gap remains. Core flow locally demonstrated, formal Web/financial/release closure incomplete;11 remaining categories are unequal work packages, not a basis for an arbitrary percentage. Next template-specific price scopes/rules and price presentation, then scoped self-profile/archive and formal role actions. M4 OPEN/M6 NOT_READY unchanged.

Latest October4 operational conversion checkpoint supersedes the foundation-only and next-conversion instructions below. Deployed20261004050000_transaction_unit_snapshots with nullable RequestItem/OrderItem JSON snapshots, no backfill. Versioned one-set purchase-unit configuration, actual request/replacement quantity conversion with sales-unit min/multiple/precision checks; shared-lock metadata revalidation before writes; original snapshots copied on confirmation/reallocation. Native unit selector/cart/quote and snapshot detail, Web configuration/historical detail, catalog exact purchase prices implemented. Snapshotted units can rename without rewriting orders; legacy unknowns remain protected. Definite create failures become FAILED and replay as errors; success replay retains original request despite config edits. Build110 unit/49 HTTP/59 mini/10 Web/static/schema PASS; Web22 steps/50 screenshots and cleanup PASS. Native visual attempt status is separate in development-log.md, not implied by VM tests. Next default product sales price/template initialization and optional SKU, then remaining template price scopes/rules and role/self-profile/archive work. Full DEV-103, M4/M6 and audit/crash reconciliation remain OPEN.

October4 conversion foundation checkpoint: exact purchase-to-sales quantity and price functions added in packages/domain/src/unit-conversion.ts, with independent Decimal precision and strict database-scale/overflow checks. Build and110 unit tests PASS. This is internal groundwork ONLY: no conversion API/UI, transaction snapshot migration, or operational order conversion delivered yet. No additional baseline acceptance item or M4/M6 gate closed; next work remains the complete snapshot/configuration/request-entry integration batch below.

Latest October4 catalog checkpoint supersedes older next-registry instructions: Brand registry + real legacy-text migration/linking, product brand selector/barcode, category two-level CRUD, unit CRUD/reference restrictions, version conflicts and read-only finance pages delivered. Native brand choices include unused registered brands. Build105 unit/48 HTTP/58 mini/10 Web and static/schema checks; actual browser20 steps/46 screenshots with cleanup. Unit renaming or base-unit changes are blocked for transactions missing snapshots, not falsely frozen/backfilled; shared trade/exclusive metadata lock closes the check/write race. Next: unit/conversion transaction snapshots and quantity/price conversion, then default-product/template prices and remaining role/self-profile/archive work. Do not repeat taxonomy/brand/basic-unit CRUD. M4/M6 and full DEV-103 remain OPEN.

October4 supersedes the next-template-operations instruction below: template tag/remark migration, edit, copy without stores, archived delete/unbind/current configuration removal and default-settlement reset now implemented. Atomic name uniqueness and version locks tested; associated-supplier/cycle validation enforced. Build105 unit/47 HTTP/57 mini/10 Web, static/schema checks PASS; actual browser18 steps/29 screenshots, fixtures cleaned. Existing historical orders and price versions unchanged. Next: catalog/brand/category/unit/conversion and product fields, then remaining template product/price scope, scoped self-profile/supplier archive and real-account role actions. No entire DEV-105/M4/M6 closure; global product+supplier pricing is not template-specific pricing.

Current local delivery: [正式业务入口验收与剩余清单](./formal-workspace-acceptance.md). Complete Store/Supplier profile fields now have a deployed migration, strict new-create API validation, legacy-null/partial-patch compatibility, real-account forms, read-only details and filters. Independent receipt profiles reach delivery/catalog reads; new split/reassigned orders snapshot freight permission without rewriting old orders. Playwright PASSED17 steps/25 screenshots at desktop/mobile; fixtures cleaned. Build105 unit/47 integration/57 mini/10 Web tests. DEV-102 through DEV-106 remain PARTIAL for remaining operations listed there; the missing profile-field rows are removed, not reopened. Normal Store/Supplier/Finance views remain query-only. Next: catalog/brand/unit/conversion and complete template operations, scoped self-profile/archive, then formal role workflows. M4 reopened/M6 not ready unchanged.

2026-10-03 review: use [交付方向重新评审](./delivery-review.md) as the current closure plan. Formal Web/master-data acceptance and full financial acceptance remain incomplete; M4 is reopened and M6 is not production-ready. The older six-closed package table and metrics below are historical, not current status. Next: formal business entry/master-data scope audit and completion, remaining financial closure, then release acceptance. Do not prioritize new general history features over these baseline gaps.

## Latest Verified Progress

October3 supplier bill detail batch: native total→exact-parent store bill→current product/source order→fresh child/total return implemented; child payment/adjustment links reuse existing scoped source identities. Store-list failure/retry and stale response protection covered. Detail exposes SKU/spec/unit, ordered/effective/received quantities, supply price/amount and explicit frozen-header versus current-product reconciliation; historical product snapshots are not fabricated. Adjustment-only store names/source links work, and total storeCount includes those stores. No financial write rules or migrations changed. Build102 unit/46 integration/56 mini, static/schema/billing/diff/readiness PASS; native6 screenshots PASS at390x753, read-only goods27/freight8.50/paid35.50/payable0. Full server history, frozen product snapshot reconstruction, bill actions/pagination, Web/master-data, M4/M6 remain OPEN. This supersedes blanket supplier-store/product-row absence below, not full S08/AC-20 financial acceptance.

October3 role recovery batch: purchaser confirm/reallocate/freight review and supplier freight/shipment/reject/discrepancy/payment review preserve original parameters/version/key before POST, survive restart, block other commands while pending, and offer explicit recovery. Account/server/workspace isolation, duplicate retry suppression, local storage failure and late-account responses covered. Up to20 **local** submit records now have native views; not full server history. Selected backend endpoints refuse PROCESSING and replay definite failures as errors; reallocate now has required-key replay/audit. Build98 unit/45 integration/50 mini and static/schema/billing/diff PASS. Native4 screenshots PASS with real HTTP commits followed by injected response loss: one freight request, one review at version2, no consumption or ledger mutation. Temporary fixtures cleaned. Remaining: cross-device/full business history, manual stuck-command reconciliation, supplier-store/product bill details, Web/master-data work, real-device/OSS and M4/M6 gates. No production/financial gate closed.

Final product native evidence PASSED5 screenshots: actual800x800 JPEG5911bytes, nonblank pixel check, READY upload/save and authorized store image/metadata display. Crop/editor thumbnail/store views inspected; temporary product/template item cleaned, no financial mutations. This supersedes the pending media capture note below; synthetic bitmap is not genuine product photography or real-device acceptance. var/product-media-evidence/manifest.json.

October3 product metadata/media batch: native purchaser product list/search/create/edit, specification/brand/storage/unit/minimum/multiple/active controls, square crop/zoom/compressed upload and store authenticated thumbnails implemented. Migration20261003090000 applied; private PRODUCT files max2MiB with full decode/square checks, scoped download and transactional owner/READY/unlinked binding. Concurrent edits yield one success and one VERSION_CONFLICT; ordinary edits do not create prices. Build/unit98/integration44/mini44 and static/schema/billing/diff/readiness PASS. Native screenshot capture is separate and not yet declared PASS; inspect var/product-media-evidence/manifest.json. Real-device/photo/OSS, web editor, independent brand registry, remaining supplier/unit master data, role recovery/history, richer bill lines and M4/M6 stay OPEN. This supersedes older statements that product metadata/media is wholly absent; it does not close full product management acceptance.

Final receipt UI follow-up: store14 screenshots PASS at390px, current receipt evidence list and authenticated opening inspected. Unchanged submitted quantities have no new-image button/count. These are local fixture images and UI-only stress overrides, not real receipt photography/device evidence. `var/store-ui-evidence/manifest.json`; no M4/M6 gate closed.

October3 receipt batch: per-version private image attachment schema/storage, transactional actor/READY/purpose/unlinked validation, exact-version supplier discrepancy read and scoped download implemented. Native1-6-image upload/retry/remove, mandatory READY gate, account-generation isolation and pending-command attachment replay implemented. Existing completed-receipt correction semantics preserved; new upload is hidden when quantities have not changed. Build98 unit/43 integration/39 mini and static/schema/billing/diff/readiness PASS. Final native full rerun PASSED16 steps/17 images, with current rejection todo removal and store104.50/supplier84.50 audits PASS. Receipt evidence audit proves3 versions/3 distinct READY files and historical preservation. Earlier tooling/funding failures are not acceptance; final rerun not resumed. Full API mandatory switch, camera/album/real-device, OSS, product media/specification and full revision browsing remain open. This supersedes older blanket statements that receipt attachment support is absent, not S05 full acceptance.

Final October3 native role capture16 screenshots PASS on3112, including source order/payment and refreshed bill return. Payment and returned bill screenshots inspected. Readiness PASS. Adjustment detail is database-tested without new native screenshot; October1 financial journey unchanged. This supersedes the pending-capture note below.

2026-10-03: supplier native bill source order/payment/adjustment navigation and fresh return implemented. Exact allocation matching distinguishes whole payment from this bill's share, preserves rejected history, and supports independent lookup retry. Same-bill stale responses are generation guarded. Consecutive frozen price documents now have separate readonly PRICE_DOCUMENT detail identities instead of ambiguous net-list identities; existing aggregate financial behavior unchanged. Build/unit96/integration43/mini33 and mini/web/contract/diff checks PASS. Native source screenshots pending verification; no fresh financial/device acceptance claimed. Next media/specification and receipt evidence; substatements, product bill lines, history/write actions, role command recovery and M4/M6 exceptions remain open.

Current3112 checkpoint: authoritative purchaser rejection todos, scoped supplier destination/current contact data and read-only supplier statement details implemented. Reassignment clears current todos, not history; same-supplier repeat rejection keeps only current order. Statement title/cycle/date are business labels, not internal keys; exclusive end/leap-year and stale-detail handling covered. Build95 unit/43 integration/28 mini page, mini:check, web:check, contract:check, db:validate, billing acceptance after PXACC-only reset, readiness and diff PASS. Extended native16 steps/17 images PASS on3112 with API/UI todo-removal assertion, store104.50/supplier84.50 financial audit. The initial harness full-page JSON truncation was corrected before the complete rerun. This supersedes older3111 money evidence below; not real payment/device acceptance. Bill substatements, product-level lines/source links/write actions, media/specification, receipt evidence, role uncertain-command recovery/history and real-device acceptance remain open.

Final role UI13 screenshots PASS on3112; statement detail and current-store missing address/contact state inspected. Demo contact data remains unconfigured, nonempty values are database/HTTP-tested. `var/role-ui-evidence/manifest.json` is separate UI evidence, not money/device acceptance.

Latest role-action evidence: extended native16 steps/17 screenshots PASSED on3111 after supplier/purchaser UI changes; actual store96+8.50=104.50 net debit and supplier76+8.50=84.50 payable PASS. `var/miniprogram-extended-evidence/manifest.json` supersedes the3110 native checkpoint below. Covers reject/reallocate, ACCEPT/RETURN/REPLENISH and receipt correction, freight reject/confirm, replenishment receipt, payment reject/confirm and authenticated evidence. Local fixture/payment/device caveats remain. Next: authoritative handled rejection todos, real supplier destination/contact display and remaining detail states; store-name search is not advertised because list APIs do not return names.

2026-10-01 role UI batch: supplier/purchaser compact headers/business navigation, searchable status-filtered orders, separated guarded detail/return paths and current-month reporting implemented. Order/request frontend twenty-row truncation removed; other lists/pagination remain. Mini page24/24, mini:check, readiness3111 PASS; native role UI12 screenshots PASS (`var/role-ui-evidence/manifest.json`). Search clipping fixed and recaptured after DevTools routing recovery. Basic native action journey9 steps/9 screenshots on3111 PASS, store44.50/supplier35.50 actual audit PASS (`var/miniprogram-journey-evidence/manifest.json`); local payment fixture, not real payment. Backend94/43 below remains prior evidence. This is role navigation/list/detail productization, not full formal acceptance; handled rejection todos, richer operation states, bill detail/actions and production/device requirements remain open.

User-directed visual batch: the native store workflow is now a searchable/category-filtered catalog with quantity steppers, fixed cart/checkout, supplier-grouped confirmation with actual funding gaps, filtered order list and batch fulfillment timeline, redesigned receipt form, account and profile. Backend catalog adds actual store contact/address/category/unit/supplier names; request read models add completion counts and shipment/current-receipt history. No fictional product images/specifications or addresses are injected.

Build, unit94/94, integration43/43, mini page22/22, mini:check, web:check, contract:check, billing acceptance, db:validate and diff PASS. Current API `http://127.0.0.1:3111/api/v1` readiness verified. Native full extended journey PASSED16 steps/17 screenshots on3110; store104.50/supplier84.50 financial audit unchanged. Supplemental3111 UI evidence PASSED12 screenshots at390px, including long text/large money and read-only display tests. The first full-flow attempt hit a DevTools timeout; the subsequent complete rerun passed. Network replay retains original order/receipt keys and bodies; persisted PROCESSING commands cannot execute twice (HTTP-tested). Cross-month pricing statement tests now respect separate original/actual periods. Historical handled rejections are excluded from active progress and retained in detail; unchanged receipts cannot create another UI submission, but correction remains available.

Do not equate this store-screen milestone with full visual completion: actual product image/specification management, receipt evidence, full change history/native bill operations, formal supplier/purchaser screens, real-device keyboard/network and broader viewport checks remain. UI-only synthetic stress evidence is separate from native business evidence. Priority next is role-wide visual workflow completion, not more isolated backend detail. Existing M4 financial and M6 external acceptance gaps remain OPEN.

Frozen shipment reductions and additional freight now have separate, real shipment-sourced documents on each frozen side; original bill snapshots remain unchanged. Cash reduction refunds and freight debits are individually traceable and atomic. Four settlement modes, insufficient stored/credit funding rollback, concurrent shipment version protection, no repeated store refund and supplier independent disposal are verified in the database. Historical partial-freeze fixtures explicitly do not imply normal payment can freeze incomplete orders.

Current verification: build, unit 91/91, integration 43/43, mini page 14/14, mini:check, web:check, contract:check, billing acceptance, db:validate and diff PASS. Current API `http://127.0.0.1:3108/api/v1` is ready; migrations total 46. The earlier frozen-reduction blocker is removed for unshipped remaining quantities. M4 remains OPEN for cleared-credit settlement adjustments, historical price-source reconciliation, mode-specific funding summaries and complete standard evidence. Production/device/customer gates remain separate. This batch is backend/database evidence, not a fresh native capture.

All checkpoint paragraphs below are historical and do not override this remaining-work list or API address.

Frozen final-receipt/ACCEPT repricing now uses actual PENDING published price-run/order sources, preserving original snapshots and creating separate frozen-side documents. Refund ledgers use the price adjustment source; repeated refund is rejected. A worker that cached PENDING rereads under the order/funding locks and cannot duplicate receipt-applied changes. Effective quantity/price snapshots also drive adjustment detail, including ACCEPT quantity 9.

Latest verification: build, unit 88/88, full integration 39/39, mini page 14/14, mini:check, web:check, contract:check, billing acceptance and diff PASS. Current API: `http://127.0.0.1:3107/api/v1`; readiness `/health/ready`. New frozen pricing evidence is unit/database integration, not the previous 3105 native journey. M4 remains OPEN: frozen permanent reductions, cleared-credit adjustments, legacy missing/consumed-source reconciliation, mode-specific account summaries and full standard funding evidence remain.

The checkpoints below are prior verification records and do not override the latest API/counts or remaining-work list above.

Duplicate store receivable protection is implemented: B01 company-term lines/adjustments only; stored-value and credit cannot preview/create/confirm a second store payment, and store offsets cannot target account-backed orders. Supplier payable and direct statements retain their channels. Historical confirmed payments are not automatically reversed; mode-specific deduction/clearing summaries still need completion.

Verification: build, unit 81/81, full integration 33/33, mini page 14/14, mini:check, web:check, contract:check, billing acceptance and diff PASS. The former 32/33 fixture failure is resolved by asserting stored rejection, releasing funding explicitly in test setup, then testing COMPANY_TERM billing separately. Real database legacy-confirmation rejection preserves PENDING/RESERVED. Term shortages without account allocations preserve paid/shortfall and cannot invent a cash funding gap or clear other groups' gaps. Current API: `http://127.0.0.1:3106/api/v1`. M4 remains OPEN for frozen checkpoints/reductions, cleared-credit adjustments and full standard-scenario evidence.

First-shipment and completion effective-price checkpoints are implemented for unfrozen orders, including ACCEPT-triggered completion. Shipment snapshots use refreshed prices; insufficient first-shipment funds roll back shipment and its timestamp. Final receipt uses the original first-shipment price baseline, applies unprocessed published versions, and can complete fulfillment while keeping a real stored/credit shortfall. Credit usage never exceeds its limit; account money and target debt are not confused with received quantity.

Publication/completion serialization and version recheck are database-tested: concurrent price publication and two final receipts follow transaction order, one receipt succeeds, and post-completion publication does not rewrite finished amounts. Preceding checkpoint verification: build, integration 33/33, unit 67/67, mini page 14/14, mini:check, contract:check and diff PASS; race tests separately repeated successfully. Its API was 3104; use the current API above. Its frozen-checkpoint block has been superseded by the run-sourced workflow above.

Fresh 3105 channel-protection native journey PASSED 16 steps/14 screenshots and automated funding audit: store net debit/paid/active allocation 104.50 (goods96+freight8.50), supplier payable84.50. Current manifest/funding-check files supersede prior native captures; payment screenshot checked. The subsequent term-shortage fix on 3106 has unit/database coverage, not this stored-value native scenario. Native evidence does not replace database dynamic-price race evidence or real-device/real-payment acceptance.

Price-run funding is implemented and real-database tested: request lines and totals update together; stored increases book only net additional cash or retain the actual booked amount with shortfall; stored decreases refund excess funds; credit changes adjust outstanding use. Credit over-limit processing rolls back and can retry after limit restoration. Cleared-credit decreases below paid funds remain explicitly blocked pending settlement-adjustment implementation.

Frozen price documents retain original snapshots; store price credits already refunded to balance show DISPOSED and cannot be refunded again. Latest verification: build, full integration 33/33, unit 67/67, mini page 14/14, mini:check, contract:check and diff PASS. Latest backend: `http://127.0.0.1:3103/api/v1`. Native 3102 evidence below is the previous shipment-funding baseline, not new price-run evidence.

Shipment funding follow-up is implemented: unfrozen permanent reductions adjust goods and actual allocations immediately; shipment freight is included in stored/credit targets; insufficient funds roll back the entire shipment and preserve the fee approval for reuse. Account/request/order locks and version recheck prevent cross-client duplicate shipment. ACCEPT no longer drops previously booked freight from paidAmount.

Latest verification: build, unit 67/67, full integration 31/31, mini page 14/14, mini:check and contract:check PASS. New real-database cases cover insufficient stored freight, insufficient credit freight, reduction-plus-freight net movement and concurrent shipment submission. Latest backend is `http://127.0.0.1:3102/api/v1`. Native capture now automatically audits ledger/allocation/paidAmount against goods plus freight.

Native rerun on 3102 PASSED 16 steps/14 screenshots plus automated funding audit: store goods 96.00 + freight 8.50 = actual net debit/paid/allocation 104.50; supplier goods 76.00 + freight 8.50 = payable 84.50. Evidence is in `var/miniprogram-extended-evidence/manifest.json` and `funding-check.json`; supplier payment screenshot checked. This supersedes the prior goods-only audit below.

Initial goods funding and its request lifecycle are implemented: stored debit at submission, independent credit reservation, confirmation without duplicate debit, draft edits/refunds, cancellation, supplier rejection/refund and reallocation/rebooking. Mode/cycle snapshots preserve submission terms. Actual cash movements have request-linked ledger entries; active allocations link to supplier orders at confirmation. The new funding migration is applied locally.

The preceding goods-booking regression passed full integration 31/31, unit 65/65 and mini page 14/14. Its assertions prove no negative balance under concurrent submissions, mixed-credit failure rolls back stored debit, cancellation releases both funding groups, and company/direct terms do not consume stored value. The newer shipment regression and API address are recorded above.

Native extended acceptance is PASSED (16 steps, 14 screenshots): received 3/2/3, supplier goods 76.00, freight 8.50, payment preview and local test payment 84.50. See `var/miniprogram-extended-evidence/manifest.json` and `supplier-payment.jpg`. The previous 94.00 result is historical, no longer the current backend result.

The earlier goods-only 3101 run verified debit 108.00, rejection refund 108.00, reallocation debit 108.00 and accepted-shortage refund 12.00, net goods debit 96.00. Current automated evidence additionally includes freight; do not treat the old 96.00 as the current total paid amount.

Implemented and database-tested: ACCEPT amount recalculation, real existing-allocation refund, frozen two-sided discrepancy documents, finance adjustment queries/disposal, concurrent duplicate-resolution protection, RETURN-review credit rejection and already-refunded store-credit rejection. Unit tests also cover credit release and unrelated overpayment preservation. Export-worker shutdown now stops and drains before database disconnect.

Frozen shortage detail captures quantity/unit-price snapshots; HTTP coverage verifies historical detail does not change after the current order price changes. Both new migrations are applied locally.

Verification: build, unit 65/65, mini page 14/14, focused HTTP 6/6, mini surface and contract checks PASS. Native Developer Tools PASS is not real-device acceptance and its payment registration is a local fixture.

Remaining business work keeps AC-E08 / DEV-304 / DEV-406 OPEN: frozen checkpoint price adjustments, frozen permanent-reduction adjustment sources, settled-credit adjustment handling and stored-value/credit versus store-term payable separation. These frozen/cleared changes are currently explicitly blocked, not silently applied. Then run all standard money scenarios and produce complete M4 funding evidence. Production M6 dependencies and real-device checks remain open. No percentage completion is inferred from these local results.

Use `docs/continuation.md` for the exact next batch. Dated checkpoints below are historical and do not override this section.

## Historical Position

Latest native UI checkpoint (2026-09-30): multi-product ordering, per-item partial shipping, per-item receipt quantities, product-name details, operator rejection reasons, rejected-order-only reallocation, single-role navigation and key Chinese status labels are implemented. Seven page regression tests, 47 unit tests and five purchase HTTP integration tests pass. Real WeChat Developer Tools checks read the catalog, add a cart item, preview 12.00 sales amount and render Supplier/Purchaser details; screenshots are in `var/miniprogram-ui-evidence/`. Next finish discrepancy/payment details, gap-allocated replenishment/freight and native mutation/device acceptance. This checkpoint supersedes older recommendations below to collect only external launch inputs; production M6 gates remain open.

For new-window continuation, start with `docs/continuation.md`.

M7 checkpoint (2026-09-30): the formal Web product app has a browser-verified Flow -> Purchaser -> Supplier -> Store -> Finance -> Supplier journey, live refresh for request/order/shipment/payment, role mutations that update the shared workflow, and a return breadcrumb to Overview. Browser evidence executes Supplier ACCEPT/REPLENISH/RETURN; REPLENISH creates a gap-allocated shipment and routes next to Store receiving. Independent App role evidence covers Store order -> Purchaser confirmation -> Supplier shipment -> Store receipt, Supplier rejection returning to Purchaser, and notification-driven Purchaser reallocation of only the rejected supplier order's product rows back to Supplier. The request remains `CONFIRMED`; the action is recorded separately as `REALLOCATED`, and the replacement order ID differs from the rejected order. The dual-client requirements audit is now recorded in `docs/requirements-surface-audit.md`; its locally actionable DEV-501 finding is closed by native mini-program per-role statistics: Store/Supplier show scoped R01/R02 statistics, Purchaser shows R01/R02/R03 profit statistics, and `mini:flow-check` verifies report endpoints plus Supplier profit 403. The M6 local package and M5 close baseline have been refreshed after that change; M6 readiness screenshots now show 11 readiness rows, 6 external rows, 7 handoff rows, and no desktop/mobile overflow. This is local browser/API-flow evidence, not WeChat Developer Tools or real-device acceptance. M6 production launch remains externally blocked by production host/domain and runtime configuration, signed storage policy, WeChat real-device evidence, customer finance sign-off, and pilot/handover evidence. Next: keep baselines green while collecting external M6 launch evidence; do not count Web evidence as mini-program completion.

M4 is locally closed against the current acceptance gates: DEV-401 through DEV-406 are closed, `acceptance:m4-close` passes, and the W09 billing plus W10 adjustment workbenches have browser evidence. M5 reporting/export has resumed with a repeatable browserless acceptance chain, browser-visible W11 acceptance summary, W13 operations view, DEV-505 export recovery/health/retry coverage, DEV-503 in-app notifications connected to supplier shipment/receipt discrepancy/discrepancy resolution/supplier rejection/overdue receipt events, and DEV-504 audit coverage across the order-to-payment handoff, supplier operations, purchase-request commands, and store funds operations.

Latest follow-up audit also closes two remaining store-scope reads: recharge detail accepts STORE_FINANCE and rejects another store, and store catalog reads reject unconfigured or mismatched STORE/STORE_FINANCE scopes.

Purchase request O03 list/detail reads now also accept STORE_FINANCE and force the authenticated store scope; mismatched list filters are rejected and cross-store details resolve as not found.

Supplier order F01 list/detail reads now force the authenticated SUPPLIER scope; mismatched supplier filters are rejected and cross-supplier details resolve as not found.

Supplier order F02/F03/F06/F09 supplier-side mutations now carry the configured supplier scope through preview, shipment creation, freight confirmation, and rejection lookups.

F04 discrepancy resolution also carries the configured supplier scope through its order-item relation.

F04 receipt creation now carries the configured STORE/STORE_FINANCE scope through the shipment's supplier-order relation.

O01/O02 preview and create now reject a configured store account's request for another store.

DEV-401 now has HTTP acceptance coverage for P01 impact preview, P02 publish, P03 run status/process/replay, and version history; the preview confirms a no-impact scope returns zero deltas.

DEV-402/404 now have a full direct supplier-term HTTP acceptance path: B04 list/detail includes goods and freight, B06 previews STORE_TO_SUPPLIER on DIRECT channel, B07 registration replays idempotently, B08 supplier confirmation settles the statement, and the confirmed goods/freight snapshot remains persisted.

DEV-402 AT-17 is covered over HTTP: lowering a store credit limit below used credit returns CREDIT_LIMIT_BELOW_USED and leaves both the limit and outstanding used credit unchanged.

DEV-404 direct-payment role boundaries are covered in the same HTTP flow: SUPPLIER cannot initiate payment preview and STORE cannot confirm its own payment; supplier confirmation succeeds.

DEV-402 AC-21 now has explicit integration evidence: a completed STORED_VALUE supplier order still appears as a COMPANY supplier payable with its goods and freight amount in the supplier statement/payment preview.

DEV-403 immediate-cycle grouping now has unit evidence for all four statement views: store, direct, supplier total, and supplier-store each keep same-day execution orders in separate statements.

DEV-403 AC-20 now proves cross-view reservation consistency: registering the shared supplier payable from a supplier-store statement makes the same item show zero payable and the full pending amount from the supplier-total statement.

DEV-404 company-term ordering now has HTTP acceptance: the supplier payable is blocked with STORE_RECEIVABLE_UNSETTLED until the store payment is confirmed; afterward B06 exposes the company supplier payable.

DEV-405 W08 clearing now has stronger HTTP/database evidence: clearing one selected 200 credit leaves an unselected 50 credit outstanding, preserves the 240 cumulative net-paid amount and 320.50 cash balance, and records a 200 debit clearing ledger row.

DEV-406 database acceptance now covers two successive price runs after an 80.00 supplier payable snapshot: the snapshot stays 80.00, deltas of +20.00 and +10.00 persist once each, and B05/B01-B04 reconcile the net +30.00 adjustment without rewriting the base.

DEV-406 positive adjustment payments now have direct-term HTTP evidence: B06 previews a persisted +20.00 adjustment as STORE_TO_SUPPLIER/DIRECT; B07 registers and B08 confirms it; B04 reflects the confirmed payment and SETTLED state while the original goods/freight snapshot stays unchanged.

Latest completed implementation: the four statement families, payment records, adjustments, difference disposals, and clearing details now enforce authenticated store scope for both STORE and STORE_FINANCE accounts; cross-scope IDs resolve as not found, while company roles retain broad access. B01–B04 expose persisted adjustment amounts and adjustment settlement item IDs in their actual settlement period; B06–B08 now preview, register, and confirm positive adjustment payments through the existing allocation path without turning them into order overpayments; statement payment summaries and settlement status include those positive adjustment allocations; company-term supplier adjustments also wait for the related store receivable and positive store adjustments to settle; negative adjustments remain B12 credits. Price adjustment documents use the same left-closed, right-open period key as statements; B05 reads persisted settled-side adjustment documents and their side-specific disposal status; P03 writes them transactionally.

M7 productization is now underway on top of the closed M5/M6 local evidence path. The first productized Web surface is `apps/web/m7-business-flow.html`, which turns the acceptance evidence into a business flow cockpit. Productized role pages now cover Store, Purchaser, and Supplier daily work. `apps/web/store-workbench.html` uses the PXFLOW Store account to call real APIs for Store login, account and ledger visibility, order preview/create/progress, notification-driven receiving, shipment detail, and receipt submission. `apps/web/purchaser-workbench.html` uses the PXFLOW Purchaser account to call real APIs for purchase-request list/detail, confirmation, supplier-rejection notifications, and reallocation to the backup supplier. `apps/web/supplier-workbench.html` uses the PXFLOW Supplier account to call real APIs for supplier-order list/detail, shipment preview/create, rejection, discrepancy ACCEPT/REPLENISH/RETURN, supplier statements, and supplier payment confirmation/rejection. The flow cockpit now routes Store, Purchaser, and Supplier work into those pages, and `web:check` plus the interactive browser capture protect the pages from regressing into static mocks.

The formal Web product app architecture has started at `apps/web/app.html` with ES modules under `apps/web/product-app/`. This keeps the repo's current no-bundler static deployment model, but moves new product development away from one-off HTML pages into a shared shell, shared API client, shared seed/run state, and route modules for Overview, Store, Purchaser, and Supplier. The legacy role HTML pages remain available as compatibility and evidence-entry pages while new product work should target the componentized `product-app/` modules first.

The formal Web product app now includes a real business-flow action route at `apps/web/app.html#/flow`. `apps/web/product-app/pages/flow.js` logs in as Store, Purchaser, and Supplier, then executes the main operational chain through real APIs: Store preview/create purchase request, Purchaser confirm, Supplier shipment preview/create, and Store receipt. `npm run main-flow:capture-interactive-demo` clicks this route in Chrome and records `productAppFlowAction.status=COMPLETED` with four result rows plus `var/main-flow-demo-evidence/product-app-flow-action.png`, so the product app is no longer protected only by page-load screenshots.

The same formal App route now also executes the exception branches that previously lived mainly in compatibility workbenches. `app.html#/flow` can run Supplier rejection, Purchaser reallocation to the backup supplier, short-receipt discrepancy ACCEPT, REPLENISH with replenishment shipment/receipt, and RETURN. The interactive browser evidence now records `productAppExceptionAction.status=BRANCHES_READY` with four exception result rows, proving the formal App covers both the happy path and the key exception branches through real APIs.

The formal Web product app now has a finance route at `apps/web/app.html#/finance`. `apps/web/product-app/pages/finance.js` uses the PXFLOW finance/operator account to read supplier statements, store statements, and `COMPANY_TO_SUPPLIER` payment records, and uses the Supplier account to load a payment version and submit confirm/reject actions. The interactive browser evidence now captures `var/main-flow-demo-evidence/product-app-finance.png` and reports the finance route as READY alongside Overview, Store, Purchaser, and Supplier.

The finance route now also has deterministic App-level payment action evidence. `app.html#/finance` can select the PXFLOW supplier statement, preview the payable settlement item, upload a generated PDF payment evidence file, create a `COMPANY_TO_SUPPLIER` payment record, and confirm it with the Supplier account. The interactive browser evidence now records `productAppFinanceAction.status=CONFIRMED` with `var/main-flow-demo-evidence/product-app-finance-action.png`, closing the formal App path from operational fulfillment through supplier payment confirmation.

The finance route now also covers the deterministic payment rejection branch in the formal App. `app.html#/finance` can create a fresh PXFLOW supplier payment from the same preview/evidence-upload path and reject it with the Supplier account. The interactive browser evidence records `productAppFinanceRejectAction.status=REJECTED` with `var/main-flow-demo-evidence/product-app-finance-reject-action.png`, so finance confirmation and rejection are both guarded in the product app rather than only in compatibility pages.

The formal Web product app Finance route now includes readable settlement detail, not only payment actions. `apps/web/product-app/pages/finance.js` can read `/supplier-statements/{id}` from `#/finance`, display period, payable, pending/confirmed payment totals, statement lines, settlement item IDs, adjustment items, and payment allocation rows after a payment is selected or created. The latest interactive browser evidence records `productAppFinance.status=READY` with five data cards and no horizontal overflow, while the flow, exception, finance rejection, and finance confirmation actions still pass.

The formal Web product app now has a first cross-route workflow handoff. `apps/web/product-app/workflow.js` stores the latest `#/flow` business context in sessionStorage, and `apps/web/product-app/pages/flow.js` writes purchase request, supplier order, shipment, and receipt IDs after the real API main flow completes. `#/overview` displays the handoff, while `#/store`, `#/purchaser`, `#/supplier`, and `#/finance` prefill the relevant IDs so operators can continue reviewing the same business case without copying identifiers between pages. The latest interactive browser evidence records Overview as `PASSED` with four data cards, Store/Purchaser/Supplier/Finance as `READY`, and the flow/exception/finance actions still passing without horizontal overflow.

The workflow handoff now also drives next-step status. `apps/web/product-app/workflow.js` exposes `workflowNextAction`, and `#/overview` shows receipt status, payment status, recommended next action, supplier order, shipment, and payment cards. `#/supplier` writes payment confirmation/rejection back into the same workflow context, so a payment handled from Supplier updates the visible workflow state as well. The latest interactive browser evidence records the formal App overview as `PASSED` with five data cards and no horizontal overflow, while Finance remains `READY` and the flow/exception/finance actions still pass.

Finance now has a normal pending-payment handoff in addition to the deterministic confirm/reject evidence actions. `#/finance` can register a payment and leave it `PENDING`, stores its ID and status in the shared workflow context, and displays its payment detail. Overview then directs the operator to Supplier for collection confirmation, where the existing route prefills the same payment. This closes the expected Finance -> Supplier role transition in the product app.

Workflow status can now be refreshed from live API details. Overview reads the saved purchase request, supplier order, shipment, and payment IDs under their respective roles, then writes the latest statuses, versions, and receipt revision back to session workflow. The Store, Purchaser, Supplier, and Finance detail refresh actions also update their corresponding workflow fields, so a later Overview render reflects the server state rather than only the last locally submitted action. Per-resource failures are reported while successful refreshes are retained.

The latest interactive browser run exercised the refresh button against a fresh formal App flow: all four resources refreshed successfully, showing purchase `CONFIRMED`, supplier order `COMPLETED`, shipment `SHIPPED`, receipt `COMPLETED`, and payment version 1. The pending handoff still recommends Supplier confirmation; all existing flow/exception/payment branches passed, and the new Overview route had no horizontal overflow.

The formal App browser evidence now follows the complete role journey: Purchaser refreshes the request, Supplier refreshes the order, Store refreshes shipment/receipt, Finance registers and refreshes a pending payment, Supplier confirms collection, and the operator returns to Overview. The final workflow records `CONFIRMED` and Overview recommends “流程复核完成”; the route shell also exposes a persistent breadcrumb back to Overview on role pages.

Independent role mutations now advance the same handoff: a newly submitted Store request clears stale downstream IDs and routes next to Purchaser; Purchaser confirmation/reallocation saves the replacement supplier order; Supplier shipment writes the new shipment and current order version, rejection routes back to Purchaser; Store receipt writes receipt status/revision. This keeps Overview's recommendation tied to the latest operation, not an older completed journey.

The formal Web product app overview has been upgraded from a migration-status page into a business command center. `apps/web/product-app/pages/overview.js` now reads the main-flow run, role evidence, seed accounts, and `m6-readiness.json`, then shows the main-flow status, local evidence count, external blocker count, role coverage, five formal business route entries, today’s role evidence, workflow handoff, next-step action, and productization/launch status.

The formal Web product app Store route now includes day-to-day receipt handling rather than only order creation and passive reminders. `apps/web/product-app/pages/store.js` lets the Store choose a shipment from notification-driven receiving todos, read `/shipments/{id}` for the supplier-order version and receipt revision, and submit a full receipt through `/shipments/{id}/receipts`. The latest interactive browser evidence records `productAppStore.status=READY` with five data cards and no horizontal overflow, while the main flow, exception branches, finance rejection, and finance confirmation still pass.

The formal Web product app Purchaser route now has a fuller day-to-day review surface. `apps/web/product-app/pages/purchaser.js` displays purchase-request summary details, item rows with target supplier/quantity/sales amount, and a separate action-result panel for confirmation or supplier-rejection reallocation. Confirmation now shows generated supplier-order identifiers, and reallocation shows the target supplier plus newly generated supplier orders. The latest interactive browser evidence records `productAppPurchaser.status=READY` with four data cards and no horizontal overflow, while the Store, Supplier, Finance, flow, exception, finance rejection, and finance confirmation paths still pass.

The formal Web product app Supplier route now includes day-to-day payment collection handling. `apps/web/product-app/pages/supplier.js` lets the Supplier choose a payment record, read `/payment-records/{id}` for status, amount, and version, then submit `/payment-records/{id}/confirm` or `/payment-records/{id}/reject` with an explicit rejection reason. The latest interactive browser evidence records `productAppSupplier.status=READY` with five data cards and no horizontal overflow, while the Store, Purchaser, Finance, flow, exception, finance rejection, and finance confirmation paths still pass.

Latest recovery evidence: an independent PostgreSQL backup/restore drill completed against the local database. Backup capture took 237ms and restore plus verification took 521ms. The restored database preserved 5 supplier orders, 4 payment records, 4 stores, and a READY PAYMENT FileObject; the restored private evidence file matched its source SHA-256. This is local AT-24 evidence; production backup policy and the RPO/RTO target remain DEV-603/M6 work.

Latest W09/S05/S08 verification: the local API health endpoint and `billing.html` served successfully, `billing.js` passed syntax checking, and the full backend baseline passed with 36 unit tests, 31 integration tests, build, contract check, and diff check. Google Chrome is available locally, and DEV-402/403/406 browser evidence has been collected under `var/m4-manual-evidence/`.

Latest full M5 regression baseline: after refreshing the M5 W11/W13 browser evidence, `npm run build`, 47 unit tests, 31 integration tests, `contract:check`, `web:check`, `m5:status`, and `git diff --check` all passed. `m5:status` reports Docker 29.7.2, local PostgreSQL `127.0.0.1:55438`, Chrome, the 10/10 M5 browserless run, and W11/W13 evidence as READY. The integration suite still emits the known `pg` v9 deprecation warning for `client.query()` while another query is executing, but it is non-blocking in the current baseline.

W10 workbench now provides adjustment filtering, original/actual period comparison, detail, B12 offline-return registration and receiver confirmation, plus offsets to a selected positive adjustment on the same settlement side. A real-database HTTP test now follows a negative price adjustment through B05 list/detail into B12 creation and receiver confirmation. B05 exposes actionable source/target IDs only when a price adjustment maps to one persisted document; ambiguous multi-run netting remains read-only. Browser E2E remains open. Verification: 36 unit tests, 31 integration tests, build, contract check, Web syntax, HTTP smoke, diff check, and the targeted W10 HTTP test pass.

`npm run web:check` now provides a browserless visibility guard for W09/W10/W11. It verifies the billing page, adjustment section, payment/evidence controls, difference-disposal controls, report page, JavaScript syntax, and required web assets. It is not a replacement for browser E2E, but it prevents silent removal of the visible workbench entry points.

`npm run m5:status` now gives the fastest current M5 snapshot. It checks Docker daemon reachability, local PostgreSQL reachability, browser runtime availability, latest `reports-acceptance-run.json`, W11/W13 browser evidence manifests, and the key M5 package scripts. It writes `apps/web/m5-status.json`, which W11 renders as a "M5 环境状态" card. The latest local run reports Docker 29.7.2, PostgreSQL `127.0.0.1:55438`, Chrome, the 10-step M5 browserless result, and W11/W13 evidence as READY.

`npm run m5:gate-status` now gives the M5 close-readiness view. It reads the M5 report acceptance output, W11/W13 browser evidence manifests, the persisted `main-flow-demo-run.json` notification/audit/role evidence, the browser-rendered main-flow demo evidence manifest, and the interactive one-click main-flow manifest. `npm run acceptance:m5-close` runs the M5 browserless chain, reseeds/checks the main-flow demo, writes the M5 status snapshot, refreshes W11/W13 browser evidence through `m5:capture-all-evidence`, captures the main-flow demo role/evidence card, role-view tabs, and `role-workbenches.html` role lanes in Chrome, clicks the main-flow page's one-click browser run in desktop and 390px mobile viewports, clicks the role workbench's real Store order, Purchaser confirmation, Supplier shipment, Store receipt, Supplier discrepancy, Supplier rejection reallocation, and discrepancy branch actions in both desktop and 390px mobile role-workbench viewports, executes the gate-status check, and writes a final M5 status snapshot. The latest committed run marks DEV-501/502, R04/W11, DEV-505, R05/W13, DEV-503, DEV-504, MainFlowUI, MainFlowRun, and Chrome evidence as READY; MainFlowRun requires desktop 6/6, mobile 6/6, the expected `COMPANY_TO_SUPPLIER / ¥90.00` preview, a real Store role order reaching `PENDING_PROCUREMENT / PAID`, Purchaser `CONFIRMED`, Supplier `SHIPPED`, Store receipt `COMPLETED`, Supplier discrepancy `RESOLVED`, supplier rejection reallocated to the backup supplier, discrepancy `REPLENISH` reaching `REPLENISH_PENDING` with replenishment receipt, discrepancy `RETURN` reaching `RESOLVED/RETURN`, non-empty desktop/mobile screenshots, and no page-level horizontal overflow. The remaining gaps are WeChat adaptation, broader production-device acceptance, and production operations policy in M6.

`npm run m6:readiness` is now the first M6 production-readiness ledger. It writes `apps/web/m6-readiness.json` and `apps/web/m6-readiness.html` renders the result. The current status is intentionally `NOT_READY`: DEV-601 full regression is `READY` from the M5 close and desktop/mobile role-workbench evidence; desktop/mobile Web evidence, local performance sampling (`var/m6-performance-report.json`), the local mini-program API flow (`apps/miniprogram/mini-flow-check.json`), local rollback check (`var/m6-rollback-drill.json`), local initialization/reconciliation check (`var/m6-initialization-signoff.json`), local pilot rehearsal (`var/m6-pilot-run.json`), and the local restore drill are `LOCAL_READY`; WeChat AppID/test account/real-device evidence, production `DATABASE_URL`/`PRIVATE_FILE_DIR`/`PUBLIC_API_BASE_URL`, and object-storage policy are `BLOCKED`. DEV-604 is not production `READY` until customer source files and finance sign-off are recorded; DEV-605 is not production `READY` until customer pilot participants, pilot window, issue closure, and handover sign-off are recorded. `npm run m6:readiness:strict` is reserved for the real production close gate and should fail until those external materials exist.

`npm run m6:external-evidence` now writes `var/m6-external-evidence.json` as the external launch-material checklist. It keeps WeChat real-device evidence, production runtime variables, signed object-storage/private-file policy, production recovery drill, finance sign-off, and customer pilot/handover sign-off separate from local readiness evidence. Use `npm run m6:external-evidence:strict` only when those materials should already be complete.

`npm run m6:write-external-templates` now maintains external evidence templates under `docs/m6-evidence-templates/`, with the summary at `docs/m6-external-evidence-templates.md`. `npm run m6:check-external-templates` keeps those templates synchronized, so future production evidence has a fixed shape before strict checks are enabled.

`apps/web/m6-readiness.html` now also renders `apps/web/m6-external-evidence.json`, so the visible M6 page shows both the internal readiness ledger and the external launch-material blockers with their target evidence/template paths.

`npm run m6:capture-readiness-evidence` now refreshes M6 readiness/external evidence, opens `m6-readiness.html` in Chrome, captures desktop and 390px mobile screenshots, and writes `var/m6-readiness-evidence/manifest.json`. The latest capture rendered 11 readiness rows and 6 external evidence rows with no horizontal overflow in either viewport.

`npm run m6:package-local-evidence` now writes `var/m6-local-evidence-package.json` and `apps/web/m6-local-evidence-package.json`, collecting current commit/remote, evidence file SHA-256 digests, readiness/external statuses, and the command list needed to refresh the M6 local evidence package.

`npm run m6:write-local-handoff` now generates `docs/m6-local-evidence-handoff.md` from the local evidence package. It is the fastest human-readable summary for reviewers: current M6 status, packaged commit, local evidence status, external blockers, evidence file hashes, refresh commands, and remote note.

`npm run m6:write-customer-evidence-request` now generates `docs/m6-customer-evidence-request.md` from the current local evidence package and external blockers. It turns the remaining M6 gaps into an owner-based request list for WeChat real-device evidence, production runtime settings, storage policy, production recovery, customer finance sign-off, and customer pilot/handover sign-off. `npm run m6:check-customer-evidence-request` keeps that request synchronized.

`apps/web/m6-readiness.html` now includes a visible review handoff section. It shows the local evidence handoff path, customer evidence request path, external template directory, strict launch-gate commands, and production/WeChat/storage guides directly on the M6 readiness page. The latest browser evidence manifest records 11 readiness rows, 6 external blocker rows, 7 handoff rows, customer request/local handoff/strict command visibility, and no horizontal overflow on desktop or 390px mobile.

`npm run m6:prepare-wechat-evidence` now creates a local, ignored WeChat real-device evidence draft under `var/m6-wechat-device-evidence/`. `npm run m6:check-wechat-evidence`, `m6:external-evidence`, and `m6:readiness` require the manifest to include the real AppID, Store/Supplier/Purchaser test accounts, binding mode, real device models, all required mini-program flows, existing screenshot or recording files, `subscriptionMessageResult=PASS`, and owner sign-off before DEV-602-WECHAT can become READY.

`docs/m6-wechat-device-evidence-guide.md` is now the handoff guide for the remaining WeChat blocker. It records the exact real-device capture files, manifest fields, validation commands, privacy boundary, and refresh steps so the work can continue from another window without rediscovering the process.

`npm run m6:check-production-runtime` now writes `var/m6-production-runtime.json`, and `docs/m6-production-runtime-guide.md` records the production server/domain/database/private-file-storage preflight. Because no production server or domain exists yet, the report remains `BLOCKED`; once those inputs exist, the same command becomes the evidence path for DEV-603-DEPLOY.

`npm run m6:check-storage-policy` now writes `var/m6-production-storage-policy.json`, and `docs/m6-storage-policy-guide.md` records the private payment-evidence storage policy checklist. The policy remains `BLOCKED` until production storage provider, private root, retention, access review, backup schedule, restore reference, download audit policy, and owner sign-off are filled.

M7 productized business-flow work has started with `apps/web/m7-business-flow.html`. The first page reads the existing main-flow seed and evidence JSON, then presents the Store -> Purchaser -> Supplier -> Receipt -> Finance workflow as a daily business cockpit with role navigation, task list, timeline, and finance summary instead of another readiness-only page. Existing workbench navigation now links to this page, and `web:check` protects the page, script, route, and role/finance stage labels.

`npm run acceptance:m5-browserless` now covers the M5 reporting/export/reconciliation/notification slice. It builds the project, seeds isolated `PXRPT` data, verifies R01 scoped completed-order amount, R02 product quantity and three-month range rejection, R03 profit excluding direct supplier-term orders with freight separate, R04 export job READY plus CSV download and task listing, DEV-505 export health detection plus recovery of a stale `PROCESSING` export job, failed export retry through `POST /exports/{id}/retry`, I08 notification list/read and owner isolation, R05 account reconciliation mismatches, store-scope enforcement, supplier profit denial, and W11/W13 Web visibility. The latest run passed on 2026-09-28 with 10/10 steps and wrote `apps/web/reports-acceptance-run.json`.

`apps/web/index.html` now renders the latest M5 browserless result from `reports-acceptance-run.json`, the latest local M5 environment snapshot from `m5-status.json`, and the M5 close-readiness gate from `m5-gate-status.json` inside the W11 report page. It also shows the latest export tasks with READY/FAILED/processing status, retry for failed jobs, and download actions backed by `GET /exports`. `npm run m5:capture-browser-evidence` logs in as the store-scoped report account, loads the M5 acceptance, environment, and close-readiness summaries, runs the R01 September 2026 query, creates an export job, and captures Chrome evidence under `var/m5-browser-evidence/`. The latest capture showed `PASSED`, 10 acceptance steps, M5 status `READY`, M5 gate status `READY` with 9 gate rows, 1 report row, and 1 export row.

R04 export reliability now has the first DEV-505 slices: the worker scans both fresh `QUEUED` jobs and `PROCESSING` jobs older than a 10-minute lease, reclaims them with an atomic status/age condition, clears stale error text on retry, and marks expired `PROCESSING` jobs as `FAILED`. `GET /exports/health` exposes admin/HQ-only status counts, stale processing jobs, and recent failures for W13; the W13 card can export the current stale/failed task result to CSV. `POST /exports/{id}/retry` lets the owner retry an unexpired FAILED export in its saved permission scope and rejects non-failed jobs with 409. This avoids a service crash or interrupted worker leaving an export permanently stuck while keeping the existing no-migration schema.

`apps/web/ops.html` now provides the W13 operations/reconciliation view. It logs in with an authorized company account, renders `GET /exports/health` as a DEV-505导出任务健康卡片, renders `GET /reconciliation-issues` as a read-only exception list, and can export the current R05 exception result to CSV for offline finance review. `npm run m5:capture-ops-evidence` captures Chrome evidence under `var/m5-browser-evidence/ops-reconciliation.png`; the latest local screenshot showed 5 current reconciliation issues, 0 export health exception rows, 2 notification rows, and 16 audit rows after the refreshed M5 close run.

DEV-503 now has I08 in-app notification list/read/bulk-read plus real business triggers. `Notification` persists recipient, channel, status, title/body, payload, read timestamp, and a per-recipient event key; `GET /notifications` returns the current user's latest 50 messages with unread count, `POST /notifications/{id}/read` marks only the current user's message as read, and `POST /notifications/read-all` marks the current user's unread messages as read in one action. `notifications:seed-acceptance` seeds admin reconciliation and overdue receipt facts, `notifications:send-overdue-receipt-reminders -- --hours=24` scans shipped-but-not-received uncompleted shipments and creates de-duplicated "超时收货提醒", `notifications:check-acceptance` verifies list/read/isolation plus reminder idempotency over HTTP, and W13 renders a "站内消息" card with single and bulk read actions. Supplier shipment creation writes a "待收货提醒" notification to active users scoped to the destination store; receipt with missing quantity writes a "收货差异待处理" notification to active users scoped to the supplier; supplier discrepancy resolution writes a store notification such as "差异已同意少收"; supplier rejection writes "供应商拒单待处理" to active ADMIN/PURCHASER users. `main-flow:check-demo` verifies these immediate business messages through real `PXFLOW` order, shipment, receipt, F05 resolution, and rejection steps.

DEV-504 now has order-to-payment and funds-operation audit coverage. `AuditLog` persists actor, active roles/scope, action, entity, traceId, reason, before/after JSON, and createdAt. `GET /audit-logs` is restricted to ADMIN/HQ_FINANCE and returns the latest 50 entries with actor display text; it also supports action, entity type/id, actor, traceId, and limit filters for W13 investigation. Purchase request create/confirm/reject, store recharge, credit-limit update, clearing creation, supplier order rejection, supplier funding reconciliation, freight confirmation create/confirm/reject, supplier shipment, store receipt, discrepancy resolution, W10 difference-disposal create/confirm, and payment create/confirm/reject/cancel command paths write audit rows only after the command succeeds, so idempotent replay does not duplicate the audit trail. W13 renders a filterable "审计日志" table and can export the current filtered result to CSV; `main-flow:check-demo` verifies purchase-request create/confirm plus fulfillment actions and the action filter, `test:integration` verifies store funds, supplier-order, and freight audit idempotency, and `billing:check-acceptance` verifies direct payment create/confirm plus difference-disposal actions.

The main-flow acceptance runner now writes a browser-readable result to `apps/web/main-flow-run.json`, and `apps/web/main-flow.html` renders the latest order-to-payment handoff status. `npm run web:check` now guards this page as well, so the main flow is visible even before a full interactive order-entry workbench is built.

W09/S05/S08 now has a repeatable local acceptance seed and checker: `npm run billing:seed-acceptance` creates `PXACC` demo data for company-term, stored-value, credit-backed, and direct supplier-term statements, plus a shared pending supplier payable reservation visible from supplier total and supplier-store views; it also seeds W10 positive/negative supplier adjustments for offset. `npm run billing:check-acceptance` verifies those facts through a temporary API and creates/confirms one W10 offset disposal. See `docs/billing-acceptance-seed.md` for accounts and checks.

`npm run acceptance:m4-browserless` now collects the strongest non-browser M4 checks into one command: build, W09/W10 seeded HTTP acceptance, DEV-402/403/406 gate-status check, generated manual-checklist sync check, main-flow acceptance output, and Web workbench visibility.

`npm run m4:gate-status` reads the generated billing acceptance output and asserts that DEV-402, DEV-403, and DEV-406 have complete automatic evidence coverage. The command is part of `acceptance:m4-browserless` and prints the remaining manual browser evidence for each gate.

`apps/web/m4-gates.json` is now the single source of truth for DEV-402/403/406 gate definitions. Both `m4-acceptance.html` and `m4:gate-status` read it, so the page, command output, and acceptance summary stay aligned.

The same gate definition file now includes manual execution steps for each gate. `m4-acceptance.html` renders those steps as an acceptance path with account, entry page, action, and expected result for DEV-402, DEV-403, and DEV-406.

`npm run m4:write-manual-checklist` generates `docs/m4-manual-acceptance.md` from the same gate definition file, giving reviewers a committed manual checklist for screenshot and recording collection.

`npm run m4:check-manual-checklist` verifies that generated checklist is still in sync with `apps/web/m4-gates.json`.

`npm run m4:check-browser-runtime` checks whether a local Chromium, Chrome, or Firefox runtime is available for manual M4 acceptance. The current environment reports Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, so the remaining M4 work is evidence collection rather than browser installation.

`npm run m4:prepare-manual-acceptance` is the single preflight command for manual M4 review. It prints the M4 status snapshot, runs the browser runtime check, database reachability check, gate-status check, manual checklist sync check, and prints the exact service commands, URLs, accounts, and DEV-402/403/406 manual acceptance path.

`npm run m4:start-manual-acceptance` starts the API and Web static server together and opens the M4 review pages in Chrome on macOS. Use it after `npm run acceptance:m4-browserless` when collecting the remaining screenshots or recordings.

`npm run m4:capture-browser-evidence` captures Chrome-rendered entry screenshots for `m4-acceptance.html`, `billing.html`, and `main-flow-demo.html` into `var/m4-browser-evidence/`. These entry screenshots support review, but DEV-402/403/406 still need manual workflow screenshots or recordings before closure.

`npm run db:check` verifies the local PostgreSQL endpoint before DB-backed M4 acceptance commands run. Docker Desktop is running in the current session, and `127.0.0.1:55438` is reachable.

`npm run m4:status` gives the fastest current M4 snapshot: browser runtime, local database, automatic gate evidence, manual checklist, browser entry screenshots, and manual evidence package status. It is meant for orientation and does not replace `acceptance:m4-browserless`.

Latest M4 browserless run passed after Docker/PostgreSQL was restored: build, W09/W10 acceptance seed/check, DEV-402/403/406 automatic gate status, manual checklist sync, main-flow demo check, main-flow acceptance runner, and Web workbench visibility all passed. API readiness and the M4 acceptance, billing, and main-flow demo pages returned HTTP 200.

`npm run m4:manual-evidence-status` lists the DEV-402/403/406 manual screenshots or recordings under `var/m4-manual-evidence/`. `npm run m4:check-manual-evidence` is the strict close-gate version and now passes with 6/6 files present.

`npm run m4:capture-manual-evidence` uses a real Chrome session to log in as `pxacc_admin` and capture the six DEV-402/403/406 browser evidence screenshots. `npm run acceptance:m4-close` then runs the full M4 browserless chain plus the strict manual evidence package check.

`apps/web/m4-acceptance.html` now renders the generated `billing-acceptance-run.json` and `main-flow-run.json` together, so a reviewer can see the latest M4 browserless acceptance result from the Web workbench rather than reading terminal logs only.

The same M4 acceptance page now includes a gate walkthrough for DEV-402, DEV-403, and DEV-406, plus the seeded account matrix for W09/S05/S08 and W10. `billing:check-acceptance` writes structured `gateId/evidenceId` entries, so the page can show which automatic evidence is already covered per gate and which manual browser evidence remains. This keeps the remaining work visible as browser acceptance and manual evidence collection, not new M5 scope.

The gate cards also provide a local manual-evidence checklist. Reviewers can mark browser screenshots or recordings as collected for DEV-402/403/406 in the page, while the authoritative local close check is `acceptance:m4-close`.

The M4 acceptance page now also renders a copyable acceptance summary. It combines the generated automatic evidence, local manual checklist state, and remaining manual evidence so the current M4 closure status can be handed off without reading terminal output.

`apps/web/main-flow-demo.html` now provides a narrow interactive operator demo plus visible operational evidence. `npm run main-flow:seed-demo` creates `PXFLOW` master data, a browser-readable seed file, and an Operator/Store/Supplier/Purchaser account matrix. The page can call the real APIs through login, order creation, procurement confirmation, supplier shipment, store receipt, supplier statement, and payment preview. It renders a "角色复核" card from `main-flow-demo-run.json`, a "分角色视图" with Operator/Store/Supplier/Purchaser tabs, the current role's evidence state, and the next-workbench boundary, has a one-click run control for the whole order-to-payment path, and uses shared narrow-screen layout rules for mobile review. `apps/web/role-workbenches.html` is the first product-facing split from that demo: it shows Store, Purchaser, Supplier, and Operator lanes with account scope, current todos, actions, main-flow evidence mapping, and next-page boundaries. The Store lane logs in as `pxflow_store`, calls `/purchase-requests/preview`, then calls `/purchase-requests` with an idempotency key to create a real `PENDING_PROCUREMENT / PAID` order for `120.00`; the Purchaser lane logs in as `pxflow_user` and calls `/purchase-requests/{id}/confirm` to reach `CONFIRMED` with a generated supplier order id; the Supplier lane logs in as `pxflow_supplier` and creates a real shipment through preview/create APIs; the Store receipt action then calls `/shipments/{id}/receipts` to reach `COMPLETED`; the Supplier discrepancy action creates a short-receipt exception and resolves it through `/discrepancies/{id}/resolve`; the Supplier rejection action rejects a pushed order and has Purchaser reallocate it to the backup supplier; the discrepancy branch action covers `REPLENISH` with replenishment shipment/receipt and `RETURN` with returnRecord. `npm run main-flow:check-demo` runs the same sequence through a temporary API, reaches `COMPANY_TO_SUPPLIER` payable preview for `90.00`, and writes `apps/web/main-flow-demo-run.json` with four role evidence rows plus shipment notification, receipt-discrepancy notification, discrepancy-resolution notification, supplier-rejection notification, audit actions, and payment-preview evidence. `npm run main-flow:capture-demo-evidence` captures the browser-rendered demo evidence under `var/main-flow-demo-evidence/`; the latest manifest records `PASSED`, 4 role rows, 4 role tabs, 4 role workbench lanes, 7 evidence rows, 6 step rows, next-workbench/next-page boundary text, and true notification/audit evidence flags. `npm run main-flow:capture-interactive-demo` goes further by starting API/Web, clicking the page's one-click run control in desktop and 390px mobile Chrome viewports, waiting for 6/6 browser operation rows and the `COMPANY_TO_SUPPLIER / ¥90.00` payment preview in both, clicking the role workbench actions in desktop and 390px mobile viewports to reach `BRANCHES_READY` after normal fulfillment and exception handling, checking no page-level horizontal overflow, and writing `interactive-manifest.json`.

`apps/miniprogram` is now the first non-HTML product client slice. It is a WeChat mini-program native surface with `app.json`, `wxml`, `wxss`, and `js` pages for login, Store, Supplier, and Purchaser. The Store page calls the real order preview/create APIs; the Supplier page lists supplier orders and calls shipment preview/create plus reject with version and item guards; the Purchaser page lists purchase requests and calls confirm/reallocate with version, rejected-order, and assignment guards. `npm run mini:check` verifies the page files, API endpoints, role routing, no HTML under the mini-program surface, and the critical command fields.

Latest mini-program product slice: `npm run mini:flow-check` now provides real API evidence for the native mini-program surface, not only static file inspection. It rebuilds, refreshes PXFLOW seed data, starts a temporary Nest API, logs in as Store/Purchaser/Supplier with `client: MINIPROGRAM`, runs Store account/ledger, order preview/create/list, Purchaser detail/confirm/reallocate, Supplier list/shipment/reject/discrepancy resolution, Store shipment notification/detail/receipt, Supplier statement/payment confirmation, and writes `apps/miniprogram/mini-flow-check.json`. The product surface itself includes Purchaser request detail/shortfall visibility, Supplier statements/payment confirmation, Store account visibility, Store order progress, Purchaser rejection handling, Store receiving, and Supplier discrepancy handling connected to real notification-driven API flows, not only the HTML validation workbench. `contract:check` covers the F04/F05 read endpoints, `mini:check` covers the mobile actions and flow-check endpoint coverage, and `mini:flow-check` exercises the core role path over HTTP.

Latest commits:

Latest functional slice in this update: the Store, Purchaser, Supplier, Store receipt, Supplier discrepancy, Supplier rejection, multi-supplier reallocation, and discrepancy REPLENISH/RETURN role workbench actions can create, confirm, ship, receive, resolve, reallocate, replenish, and return through real APIs; these are checked in the M5 close gate.
Latest commit before this progress update: `4351eaa Add role workbench skeleton`.

```text
4351eaa Add role workbench skeleton
a8fda49 Add role views to main flow demo
f499e73 Show role evidence in main flow gate
67567d4 Add mobile main flow evidence to M5 gate
d7d1a34 Validate interactive main flow in M5 close gate
9b9e99e Add interactive main flow browser run
fd295f9 Refresh M5 browser evidence in close gate
52a46ca Include main flow UI evidence in M5 close gate
45e14b7 Show main flow demo evidence
e539f86 Show M5 close gate on W11
690bf16 Add M5 close readiness gate
e773875 Record full M5 regression baseline
2623e51 Refresh M5 acceptance evidence
559916f Show M5 status on W11
8bb8cd9 Add M5 status report
e1375c1 Export W13 export health to CSV
d218a12 Export W13 reconciliation issues to CSV
0ca1e7a Export W13 audit logs to CSV
d3bb9cf Add bulk read for in-app notifications
0649036 Notify purchasers about supplier rejections
0003eb0 Audit store funds operations
ab30908 Audit supplier order operations
c5d2d2c Add audit log filters to W13
c738288 Audit purchase request commands
5bab429 Harden settlement item locking
9679479 Record audit rows in W13 evidence capture
adbafbe Add overdue receipt reminder scan
0bd495e Audit payment record actions
d4d6614 Audit difference disposal actions
b2b21ea Add audit logs for fulfillment actions
ca3b382 Notify stores after discrepancy resolution
b7ee08c Notify suppliers about receipt discrepancies
bf3c999 Notify stores after supplier shipment
8923fde Add in-app notifications foundation
48a9cdc Add failed report export retry
16d0edd Add report export health monitoring
6f10226 Recover stale report exports
b636e45 Refresh progress ledger after W13 workbench
d4b76d5 Add W13 reconciliation workbench
65b2d92 Refresh progress ledger after R05 reconciliation
452ea4d Add R05 reconciliation issue checks
7fd6c4a Add R04 export task list
2449286 Refresh progress ledger after M5 browser evidence
387fca8 Add M5 browser evidence view
20f62b9 Refresh progress ledger after M5 acceptance chain
15b66b3 Add M5 reports acceptance chain
77e7fb2 Close M4 local acceptance gates
89e07ff Record M4 browserless acceptance after DB restore
560600d Add M4 manual evidence package check
5d21c5d Add M4 status report
cfb5762 Add local database preflight check
c5f925f Add M4 browser evidence capture
913d4e5 Add M4 manual acceptance launcher
5b3db41 Add M4 manual acceptance preflight
dfc3512 Add M4 browser runtime check
d21b77a Run manual checklist check in M4 acceptance
3bb78bc Check generated M4 manual checklist
85ebf3e Generate M4 manual acceptance checklist
e2a0fe4 Add M4 manual acceptance path
babc65a Share M4 gate definitions
5705727 Add M4 gate status command
a61c0db Add copyable M4 acceptance summary
6a38fcb Add M4 manual evidence checklist
1260b1b Map M4 gates to acceptance evidence
2eae05a Add M4 acceptance gate walkthrough
ea81b68 Add main flow demo checker
4afe8a6 Add interactive main flow demo
7db7c4d Refresh progress ledger for handoff
eaea023 Add continuation handoff document
56672e9 Add M4 acceptance summary page
4dde596 Refresh progress ledger after acceptance work
1593023 Add M4 browserless acceptance command
91bd150 Extend billing acceptance to W10 offsets
dc2e5ea Add billing acceptance checker
640a2c4 Add billing acceptance seed data
8bf55d3 Add visible main flow acceptance page
2aaf72c Add main flow acceptance runner
62a3df0 Add main flow acceptance map
ce1860e Add M4 exit checklist
5e9ecfd Add web workbench visibility check
1117d3b Add acceptance dashboard for visible progress
25288bb Record W10 workbench review
9023643 Clarify adjustment disposal states
dd39150 Record W10 commits in progress ledger
00e520a Connect W10 adjustment workbench to B12
59c7966 Add adjustment read workbench to billing page
427953d Refresh progress after adjustment payment acceptance
9b24dce Verify direct adjustment payment lifecycle
5cbc373 Verify B05 reads persisted price adjustment
146a13b Verify settled price adjustments persist separately
c0ad0de Refresh progress after clearing acceptance
16790b9 Verify clearing affects selected credit only
628d1cd Verify company term waits for store payment
dc41992 Verify shared statement item reservation
3e0f341 Cover immediate grouping across statement views
bc16c68 Verify direct payment receiver role boundaries
b856890 Assert stored value supplier payable acceptance
1bc4666 Close DEV-401 backend gates
3e7c8fd Cover price impact preview HTTP flow
173bae4 Scope purchase previews by store
6113241 Scope receipt creation by store
30ef897 Scope discrepancy resolution by supplier
a4195b2 Scope supplier order mutations
5134e59 Scope supplier order reads by supplier
1293338 Scope purchase request reads by store
942352a Harden recharge and catalog store scopes
96aee8f Allow finance scope disposal confirmation
b54145c Enforce finance store scopes
7c5cda1 Cover settlement period boundaries
54fadd1 Cover statement scope guards
4cd5090 Require statement detail scopes
b867e59 Harden statement list and detail scopes
a205d0c Record B12 receiver permission gap
ae2e702 Verify adjustment credit offsets end to end
e61f84e Allow offsets against positive adjustments
419c438 Audit M4 plan alignment and closure gates
66d8d78 Cover mixed adjustment payments
de2ced8 Gate supplier adjustments on store settlement
a674e33 Document adjustment settlement items
```

Earlier related commits:

```text
Freeze price adjustments by settlement side
818770f Fix disposal target balance by side
8837472 Net repeated price adjustments
e1140c4 Allow overpayments in difference disposal
070a1f3 Persist payment overpayments
cb076db Unify price changes in adjustment reads
8114349 Link statement totals to payment allocations
da7a0bc Make settlement state transitions atomic
3a4f1c0 Enforce payment account scopes
```

Latest committed implementation: B05 returns net price adjustments per order line, while B12 accepts both discrepancy-return and overpayment credit sources for offset or offline disposal.
The B12 target balance calculation now uses sales goods for store receivable targets and supply goods for supplier payable targets.

```text
b81a722 Serialize settlement offset reservations
e2cc71e Reserve pending offsets from payable balance
```

```text
7365e9d Add persisted report exports
ea129f6 Build initial W11 reporting screen
062e65a Enable direct supplier payments
72ea185 Verify settled statement snapshots persist
e132c1d Snapshot confirmed settlement item amounts
59ae4d3 Enforce settlement funding checks
5ea495f Guard price processing and funding checks
1c23421 Refresh M4 progress after price statement work
6c7fbb8 Test statement price adjustment links
3a6a1e3 Link price adjustments from statements
b976b3f Expose price adjustment sources
```

Confirmed payment allocations now create immutable settlement item amount snapshots in one transaction. Store, supplier total, and supplier-store statement lines and later payment previews read those snapshots, while items without a confirmed payment remain dynamic. Snapshot rows cascade with test data cleanup.

Direct supplier-term statements now use their B04 settlement item ID with the B06 payment preview/create/confirm flow and retain direct channel metadata.

Latest completed work: B12 permits a negative adjustment credit to offset a positive adjustment settlement item on the matching STORE or SUPPLIER side. Available amount subtracts reserved/confirmed payment allocations and pending/confirmed disposals. Unit and HTTP/database integration coverage verifies the offset record links both adjustment documents. Build, 28 unit tests, 26 integration tests, contract check, and diff check pass.

DEV-401 is now closed against the backend acceptance gates: AT-08 serializes revaluation with final receipt, AT-09 preserves the newer effective revision when runs are processed out of order, and the HTTP pricing flow covers P01 preview, P02 publish, P03 status/process/replay, adjustment history, and version history.

DEV-402 progress: P02 price publishing now rejects unequal sales/supply prices when the supplier is configured for direct supplier-term settlement. Setting a template supplier to direct settlement performs the same check against the template's latest prices. A database integration test covers rejection and equal-price success. This closes the identified AT-16 price guard slice; broader direct-term statement and payment acceptance remains.

DEV-403 progress: the supplier-store statement integration now sums every returned store statement and asserts goods, freight, and total amounts equal the supplier total statement. Parent linkage and shared settlement item IDs remain covered. This closes the total-versus-store-breakdown evidence slice; replenishment-period and immediate-order acceptance remain.

DEV-403 progress: fixed `IMMEDIATE` statement grouping in store, supplier-total, supplier-store, and direct statements. Same-day execution orders now include their order ID in the grouping key and statement ID, and direct statements have a regression test proving two same-day orders remain two statements.

## Historical Plan Alignment Review (2026-09-27)

Historical closure record only. M4 is currently reopened; the table below is not today's acceptance status. See Current Delivery Direction above.

The delivery order is M0 → M1 → M2 → M3 → M4 → M5 → M6. Actual work did not follow it cleanly: R01-R04 and W11 from M5 were implemented before M4 was closed. M5 is now frozen, but those early features do not count toward closing M4.

Progress is tracked by M4 package gates rather than an unweighted percentage. DEV-401 through DEV-406 are now closed against the local M4 acceptance gates.

| Package | Current assessment against plan | Closure evidence still needed |
|---|---|---|
| DEV-401 | **Closed**: P01-P03, AT-08, AT-09, and W06/S10 backend flow evidence are complete | None for the current backend scope |
| DEV-402 | **Closed**: B01-B04, amount/period logic, AT-16 price guard, direct-term B04→B08 flow, AT-17 credit-limit guard, AC-21 stored-value supplier payable, and W09/S05/S08 browser evidence verified | None for the current M4 package |
| DEV-403 | **Closed**: statement read paths, total/store sum, immediate per-order grouping across all four views, replenishment period, account scope, cross-view shared-item reservation, and W09/S05/S08 browser evidence verified | None for the current M4 package |
| DEV-404 | **Closed**: B06-B11 payment lifecycle, AT-13 concurrency, receiver authorization, direct-term adjustment payment, company-term store-first HTTP gate, mandatory I06/I07 PAYMENT evidence, participant download scope, expired-upload cleanup, and local DB/private-file restore evidence verified | Production storage/backup operations remain M6 |
| DEV-405 | **Closed**: A04-A06, store scope, and W08 selected-only clearing/accounting flow verified | None for the current M4 package; production backup policy remains DEV-603/M6 |
| DEV-406 | **Closed**: persisted adjustments, repeated-change netting (+20 then +10), positive adjustment payment, offsets/returns, receiver scopes, snapshot reconciliation, W10 workbench, B05→B12 real-database HTTP flow, and W10 browser evidence verified | None for the current M4 package |

W09 first usable web flow is now implemented in `apps/web/billing.html`: role-filtered store, supplier total, supplier-store, and direct statements; detail lines; payment preview/registration with private evidence upload; payment list; receiver confirmation; and counterparty-scoped evidence download. Existing API and browser script checks pass. The same page now has narrow-screen S05/S08 layout rules; broader end-to-end browser acceptance remains open.

W09 detail now exposes each persisted positive adjustment settlement item and amount, so the payment picker can register adjustment payments alongside order lines. Statement services normalize adjustment amounts through Decimal for both database values and test/integration projections.

I07 authorization now has HTTP evidence that a supplier linked to a payment can download its payment proof, while the route remains restricted to payment participants or authorized finance roles.
The same acceptance now verifies an unrelated supplier receives 404 for that proof.

The M4 package sequence is locally closed. DEV-404 and DEV-405 are closed against their M4 package conditions; local recovery evidence is recorded, while production backup policy remains in DEV-603/M6. Revisit M5 after preserving the generated M4 evidence package and rerunning `npm run acceptance:m4-close` if any M4-related code changes.

DEV-406 payment previews subtract PENDING and CONFIRMED difference offsets from payable availability. Payment and offset creation use the same PostgreSQL transaction advisory locks for settlement item IDs; credit IDs are locked before duplicate-disposal checks. Payment and adjustment/disposal reads enforce store/supplier scopes, and state changes use conditional version/status updates. B01-B04 aggregate RESERVED and CONFIRMED allocations. AT-14 offline return, receiver scope, repeated price-change netting, frozen snapshot reconciliation, and W10 browser evidence are covered.

DEV-405 clearing creation now conditionally updates each funding allocation by version, active state, and outstanding amount, and conditionally updates the store account version and credit used. A concurrent second clearing therefore fails atomically instead of consuming the same credit twice.

## Historical Progress Metrics

The six-closed count below is archived. Current formal management is partial and M4 reopened; no overall completion percentage is published.

The earlier 70%–75% backend and 40%–45% release figures were estimates without a repeatable acceptance-item denominator, so they are retired. Trackable M4 status currently is **6 closed, 0 partial, 0 not started**. This whole-package count is a gate status, not a sensitive progress metric; use the closure-evidence column in the plan alignment review to show movement between commits. Do not publish an overall percentage until the plan has an itemized denominator for all milestones.

## Verification Baseline

The latest completed stage passed:

```bash
npm run db:validate && npm run db:migrate && npm run build && npm test && npm run test:integration && npm run contract:check
```

Current integration coverage count: 28 integration tests passing; unit coverage is 35 tests.

Latest run: 30 integration tests and 36 unit tests passed, along with build, contract check, and diff check.

DEV-404 acceptance slice: payment integration now registers the same supplier payable concurrently with two different idempotency keys and verifies exactly one reservation succeeds while the other conflicts; replaying the winning key returns the original payment. B07 requires at least one completed PAYMENT evidence file belonging to the registering actor, and missing evidence is rejected before command creation. Existing payment HTTP flows upload and link real test PDFs. Latest verification: 36 unit tests, 31 integration tests, build, contract check, and diff check passed.

DEV-405 acceptance slice: clearing preview/create/detail integration covers the selected credit allocation, independent clearing document, account ledger, released credit, and idempotent replay; clearing detail, account, and ledger reads now reject a mismatched store scope for both STORE and STORE_FINANCE.

DEV-406 acceptance slice: the integration now creates a negative adjustment with no follow-up order, disposes it through `OFFLINE_RETURN` without a target debit, and confirms it through the receiver role; AT-14 is covered end to end.

DEV-401 concurrency slice: price-run processing now locks each supplier order before reading completion status, so a receipt that commits first is skipped and a revaluation that acquires the lock first is applied before completion.

DEV-402/403 evidence slice: direct-term settlement previews resolve to `STORE_TO_SUPPLIER` with the DIRECT channel and include freight; replenishment shipments remain in the supplier order's first-shipment half-month period.

DEV-406 scope hardening: adjustment list/detail and difference-disposal detail/confirmation now enforce the authenticated store or supplier scope before returning or mutating records. Company roles retain the existing company access paths.
Statement and payment scope hardening: STORE and STORE_FINANCE accounts now share the same bound-store enforcement across statements, payments, adjustments, difference disposals, and clearing details; unconfigured accounts are rejected before decoded IDs are queried.
Controller regression coverage now verifies statement list narrowing and missing detail scopes for STORE, STORE_FINANCE, and SUPPLIER paths.
DEV-403 AT-10 coverage now checks half-month 15/16 boundaries, Sunday/Monday weekly boundaries, year-end rollover, and leap-day month length.

Current verified change: price-change runs now report FAILED when any child order fails; P02 revaluation refreshes purchase-request funding summaries; purchase confirmation recalculates funding from current item amounts and current account balance before splitting. Payment preview blocks unresolved positive shortfalls and company-term supplier payments whose store receivables are not confirmed paid. Price changes do not mutate balances or ledgers.

Latest verification: recharge detail and store catalog scope hardening passed build, 35 unit tests, 28 integration tests, contract check, and diff check.

Purchase request scope hardening passed the same verification baseline.

Supplier order F01 scope hardening passed the same verification baseline.

Supplier order mutation scope hardening passed the same verification baseline.

F04 discrepancy scope hardening passed the same verification baseline.

F04 receipt scope hardening passed the same verification baseline.

O01/O02 store scope hardening passed the same verification baseline.

DEV-501 R01-R03 backend slice is implemented. `completedAt` is persisted and written when fulfillment becomes complete; existing completed orders are backfilled by migration. R01 reports completed-order amounts by completion month, R02 final received quantities by completion date with a three-month limit, and R03 completed non-direct order profit by first shipment date with freight separate. Date filtering uses Asia/Shanghai day boundaries; completed order prices are frozen by P02's completed-order exclusion. Local migration, build, 10 unit tests, 26 integration tests, contract check, and diff check passed.

Report access now accepts store and supplier roles for R01/R02 and forces their bound `UserScope` into the query. R03 remains company-only. I05 `PATCH /users/{id}` can assign one COMPANY, STORE, or SUPPLIER scope; the scope is included in login authentication context. The scope migration is deployed locally.

W11 first usable web screen is implemented in `apps/web`: login, R01-R03 tabs, date/entity filters, KPI summaries, result tables, empty/error states, and CSV export. Start with `npm run start:web`; API CORS permits the local web origin.

R04 creates a persisted export job (202), claims queued CSV jobs atomically with PROCESSING status, exposes status and owner-only download routes, rechecks the current report role and bound account scope, and expires snapshots after seven days. The API polls queued jobs after restart and cleans expired content; storage is database text rather than private object storage.

Statement and adjustment period grouping now uses the supplier order's settlement cycle snapshot, so changing supplier defaults does not move historical orders.

## Completed Areas

### Foundation

- NestJS API entry, health checks, global traceId, response envelope, exception format.
- Prisma schema and migrations for core business tables.
- Command idempotency service and command records.
- Runtime request validation for UUID, expectedVersion, Idempotency-Key, and decimals.

### Identity And Admin

- Password hashing, sessions, login/logout/me APIs.
- Bearer auth guard, current auth decorator, role guard.
- User admin list and status update.
- Store admin list/create/update.
- Supplier admin list/create/update.

### Master Data

- Categories, units, products create/list/archive basics.
- Supplier-product binding.
- Price scopes, price versions, effective price lookup.
- Price publish and price version HTTP endpoints.
- Order templates create/list, store binding, item replacement, supplier settlement override.
- Store catalog endpoint.

### Purchase Flow

Implemented interfaces:

- O01 `POST /purchase-requests/preview`
- O02 `POST /purchase-requests`
- O03 `GET /purchase-requests`, `GET /purchase-requests/{id}`
- O04 `PATCH /purchase-requests/{id}/items`
- O05 `POST /purchase-requests/{id}/reassign-preview`
- O06 `POST /purchase-requests/{id}/assign`
- O07 `POST /purchase-requests/{id}/confirm`
- O08 `POST /purchase-requests/{id}/reject`
- O09 `POST /supplier-orders/{id}/reject`
- O10 `POST /purchase-requests/{id}/reallocate`
- O11 `POST /supplier-orders/{id}/reconcile-funding`

Current O11 behavior:

- Re-evaluates the supplier order's purchase request against the store account balance.
- Refreshes paid and shortfall amounts on the purchase request.
- Marks the purchase request PAID and CONFIRMED when the refreshed stored-value funding is sufficient.
- Uses Idempotency-Key through command records.

### Supplier Orders And Fulfillment

Implemented interfaces:

- F01 `GET /supplier-orders`, `GET /supplier-orders/{id}`
- F02 `POST /supplier-orders/{id}/shipment-preview`
- F03 `POST /supplier-orders/{id}/shipments`

Current F03 behavior:

- Creates `Shipment` and `ShipmentItem` records.
- Supports item-level `gapAllocations` for replenishment gaps.
- Creates `ShipmentGapAllocation` records and decrements gap remaining quantity.
- Marks replenishment gaps PARTIAL_FILLED or FILLED when allocated.
- Supports `freightConfirmationId` for non-zero freight, validates confirmed amount and supplier order ownership, and marks the confirmation USED on shipment creation.
- Updates `OrderItem.shippedQuantity`.
- Updates supplier order status and fulfillment status to `PARTIAL_SHIPPED` or `SHIPPED`.
- Uses Idempotency-Key through command records.

Current F04 behavior:

- Creates `Receipt` and `ReceiptItem` records.
- Supports first receipt revision with `expectedReceiptRevision = 0`.
- Supports replacing the current receipt by submitting the current `expectedReceiptRevision`; the old receipt is retained and marked non-current.
- Supersedes OPEN discrepancies from the replaced receipt; receipts with already resolved/replenishment discrepancies cannot be replaced in this version.
- Validates each shipment item belongs to the shipment.
- Requires receipt items to cover all shipment items exactly once.
- Validates received quantity is between zero and shipped quantity.
- Updates `OrderItem.receivedQuantity`.
- Updates supplier order fulfillment status based on received quantity, permanently reduced quantity, accepted discrepancies, and replenishment gaps.
- Marks supplier orders COMPLETED once all effective quantities are satisfied and no blocking discrepancies or gaps remain.
- Uses Idempotency-Key through command records.

Current F05 behavior:

- Creates an OPEN discrepancy automatically when a receipt item is short.
- Implements `POST /discrepancies/{id}/resolve`.
- Supports ACCEPT, REPLENISH, and RETURN resolution in this version.
- ACCEPT persists a discrepancy action record and marks the discrepancy RESOLVED.
- REPLENISH persists a discrepancy action record, marks the discrepancy REPLENISH_PENDING, and creates a replenishment gap with pending quantity.
- RETURN persists a discrepancy action record, creates a return record for the shortage quantity, and marks the discrepancy RESOLVED.
- Resolving discrepancies recalculates supplier order fulfillment status.
- Uses Idempotency-Key through command records.

Current F06/F07 behavior:

- Implements `POST /supplier-orders/{id}/freight-confirmations`.
- Implements `POST /freight-confirmations/{id}/confirm`.
- Implements `POST /freight-confirmations/{id}/reject`.
- Tracks PENDING, CONFIRMED, REJECTED, and USED statuses.
- Confirmed freight can be attached to a shipment once and is marked USED.
- Uses Idempotency-Key through command records.

## Known Boundaries

- Current access control is role-based. Supplier-user and store-user data-scope binding is not implemented yet.
- Funding logic is still a first pass. It records stored-value summaries and O11 reconciliation results but does not yet implement the complete immutable allocation/ledger behavior described in the long-term design.
- F03 stores permanently reduced quantity on shipment items. Replenishment gap allocation is supported when the caller provides explicit `gapAllocations`.
- F05 RETURN currently records internal shortage-return resolution. Downstream supplier statement/payment disposal remains future work.
- M4 settlement and reconciliation are locally closed against the current package gates. DEV-402/403/406 have automatic evidence and browser screenshot evidence.
- W09 billing and W10 adjustment pages are implemented for the recorded flows; Chrome-based evidence capture now covers the M4 browser acceptance package.

### Store Finance

Implemented interfaces:

- A01 `GET /stores/{id}/account`, `GET /stores/{id}/ledgers`
- A02 `POST /stores/{id}/recharges`
- A03 `PATCH /stores/{id}/credit-limit`
- A04 `POST /stores/{id}/clearings/preview`
- A05 `POST /stores/{id}/clearings`
- A06 `GET /recharges/{id}`, `GET /clearings/{id}`

Current A01 behavior:

- Returns store account balance, credit limit, credit used, and available credit.
- Returns account ledgers ordered by occurred time.
- Supports `occurredFrom` and `occurredTo` filters.
- Access control is role-based; store-user data-scope binding is not implemented yet.

Current A02 behavior:

- Creates a `RechargeDocument`.
- Creates the store account when missing, or increments the existing balance.
- Writes a CREDIT account ledger with source type RECHARGE.
- Uses Idempotency-Key through command records.

Current A03 behavior:

- Updates store account credit limit with account-level version checking.
- Rejects limits below currently used credit.
- Uses Idempotency-Key through command records.

Current A06 recharge behavior:

- Returns recharge document details by id.
- Includes the current store account snapshot.
- Access control is role-based; store-user data-scope binding is not implemented yet.

Current A06 clearing behavior:

- Returns clearing document details by id.
- Includes clearing items and the current store account snapshot.
- Access control is role-based; store-user data-scope binding is not implemented yet.

Current A04 behavior:

- Adds the `FundingAllocation` model.
- Validates selected allocations belong to the store, are active, and have clearable credit outstanding.
- Returns per-allocation clearable amounts and total clearable amount.

Current A05 behavior:

- Creates `ClearingDocument` and `ClearingItem` records.
- Requires each selected funding allocation version and amount to match the previewed clearable amount.
- Reduces funding allocation credit outstanding and releases store account credit used.
- Writes a DEBIT account ledger with source type CLEARING.
- Uses Idempotency-Key through command records.

### Settlement Read Models

Implemented interfaces:

- B01 `GET /store-statements`, `GET /store-statements/{id}`
- B02 `GET /supplier-statements`, `GET /supplier-statements/{id}`
- B03 `GET /supplier-store-statements`, `GET /supplier-store-statements/{id}`
- B05 `GET /adjustments`, `GET /adjustments/{id}`
- B06 `POST /payment-records/preview`
- B07 `POST /payment-records`
- B08 `POST /payment-records/{id}/confirm`
- B09 `POST /payment-records/{id}/reject`
- B10 `POST /payment-records/{id}/cancel`
- B11 `GET /payment-records`, `GET /payment-records/{id}`
- B12 `POST /difference-disposals`, `POST /difference-disposals/{id}/confirm`, `GET /difference-disposals/{id}`

Current B01 behavior:

- Dynamically groups completed supplier orders into store-side statements by store, supplier, settlement cycle, and first shipment period.
- Uses the store sales amount plus shipment freight as the store statement total.
- Returns open statement summaries with goods amount, freight amount, total amount, payable amount, and line count.
- Returns statement details with source supplier order lines and source revision.
- Keeps payment and settlement status as an OPEN read model in this first version; allocation and confirmed payment are future work.

Current B02 behavior:

- Dynamically groups completed supplier orders into supplier total statements by supplier, settlement cycle, and first shipment period.
- Uses the supplier supply amount plus shipment freight as the supplier payable total.
- Returns open supplier statement summaries with goods amount, freight amount, total amount, payable amount, store count, and line count.
- Returns supplier statement details with source supplier order lines, store IDs, and source revision.
- Keeps payment and settlement status as an OPEN read model in this first version; shared payment allocation is future work.

Current B03 behavior:

- Dynamically groups completed supplier orders into supplier-store statements by store, supplier, settlement cycle, and first shipment period.
- Uses the supplier supply amount plus shipment freight as the supplier-store payable total.
- Returns `parentStatementId` pointing to the matching supplier total statement for the same supplier and period.
- Returns supplier-store statement details with source supplier order lines and source revision.
- Keeps payment and settlement status as an OPEN read model in this first version; shared settlement item IDs are future work.

Current B05 behavior:

- Dynamically exposes F05 RETURN `DiscrepancyReturn` records as supplier payable decrease adjustments.
- Exposes P02 `PriceChangeAdjustment` records through the same endpoint as separate store receivable and supplier payable adjustment rows, including unfinished orders whose baseline is request submission time.
- Calculates adjustment amount from returned quantity times source supplier order item supply unit price.
- Returns original supplier statement ID and original period based on the source order first shipped time.
- Returns actual adjustment period based on the return record creation time.
- Supports filtering by storeId, supplierId, cycle, actual period, and processingStatus.
- Marks adjustments DISPOSED when linked to a confirmed `DifferenceDisposal`, otherwise PENDING_DISPOSAL.
- Direct settlement adjustments and persisted adjustment documents remain future work.

Current B06 behavior:

- Statement detail lines expose stable virtual `settlementItemId` values.
- Store statement lines preview as `STORE_TO_COMPANY` payment items using sales amount plus shipment freight.
- Supplier total and supplier-store statement lines share supplier payable IDs and preview as `COMPANY_TO_SUPPLIER` items using supply amount plus shipment freight.
- Validates selected items are completed, share the same payment direction, and belong to the same paying/receiving subject.
- Returns payable amount, pending amount, confirmed paid amount, source version, and blocked items.
- Includes existing RESERVED allocations as pending amounts.
- Blocks positive unresolved purchase funding shortfalls and, for COMPANY_TERM supplier payable items, requires the related store receivable to be fully confirmed paid.

Current B07 behavior:

- Adds `PaymentRecord` and `PaymentAllocation` models.
- Creates a PENDING payment record from previewed settlement item IDs.
- Validates selected items share direction and subject, source versions match, and expected amounts match current payable amounts.
- Creates RESERVED payment allocations so later previews show pending payment amounts and no remaining payable amount for the same items.
- Uses Idempotency-Key through command records.

Current B08 behavior:

- Confirms PENDING payment records with expectedVersion checking.
- Marks the payment record CONFIRMED and increments its version.
- Converts RESERVED allocations to CONFIRMED.
- Later payment previews show confirmed paid amounts and no remaining payable amount for confirmed items.
- If the payable amount decreases after registration but before confirmation, B08 preserves the registered payment and persists the excess as an `Overpayment`; the response exposes its amount and source rows.
- Uses Idempotency-Key through command records.

Current B09 behavior:

- Rejects PENDING payment records with expectedVersion checking and a rejection reason.
- Marks the payment record REJECTED and increments its version.
- Converts RESERVED allocations to RELEASED.
- Later payment previews ignore RELEASED allocations, so rejected items become payable again.
- Uses Idempotency-Key through command records.

Current B10 behavior:

- Cancels PENDING payment records with expectedVersion checking and a cancellation reason.
- Marks the payment record CANCELLED and increments its version.
- Converts RESERVED allocations to RELEASED.
- Later payment previews ignore RELEASED allocations, so cancelled items become payable again.
- Uses Idempotency-Key through command records.

Current B11 behavior:

- Lists payment records ordered by creation time.
- Supports filtering by direction, status, storeId, and supplierId.
- Returns payment record details with allocation rows and allocation states.
- Keeps role-based access only in this version; participant data-scope filtering remains future work.

Current B12 behavior:

- Adds `DifferenceDisposal` and `DifferenceDisposalItem` models.
- Creates supplier-to-company offline-return difference disposals from F05 RETURN `DiscrepancyReturn` credit items.
- Creates supplier-to-company OFFSET difference disposals from F05 RETURN credit items to supplier payable settlement items.
- Calculates disposal amount from returned quantity times the source supplier order item supply unit price.
- Requires selected credit items to share the same store and supplier, and rejects already disposed credit items.
- Requires OFFSET target debit items to be completed supplier payable items for the same supplier with enough remaining payable amount.
- Confirms PENDING disposals with expectedVersion checking and records confirmedAt.
- Payment previews subtract confirmed OFFSET disposal amounts from target supplier payable items.
- Uses Idempotency-Key through command records for create and confirm.
- Overpayment, adjustment-driven credit items, direct settlement offsets, and evidence files remain future work.

Current B04 behavior:

- Implements `GET /direct-statements` and `GET /direct-statements/{id}`.
- Groups completed supplier orders for suppliers currently configured with `SUPPLIER_TERM` by store, supplier, cycle, and first shipment period.
- Uses sales goods amount plus shipment freight as the direct settlement total.
- Returns source order lines, stable direct settlement item IDs, source revision, and OPEN payment summary fields.
- Supplier order settlement mode and cycle are snapshotted at order creation; B04 filters and groups on these values, so later supplier configuration changes do not move historical orders.

Current settlement snapshot behavior:

- Adds `settlementMode` and `settlementCycleSnapshot` to supplier orders, with legacy rows defaulted to `COMPANY_TERM` and `MONTHLY`.
- Purchase confirmation and newly created reallocation orders snapshot the template override when present, otherwise the supplier defaults.
- Existing target orders retain their original snapshot when more items are reallocated into them.

Current price history behavior:

- Price versions persist the reason for each change and return it from publish and version history queries.
- Price versions persist a per-scope monotonic revision; the highest revision wins when effective times match, and publishing appends history in a transaction.
- P02 now creates a persisted pending price change run linked to the published version; each currently affected execution order is recorded as a pending run item, and `GET /jobs/{id}` exposes the status and deltas.
- `POST /jobs/{id}/process` applies pending order price changes in one transaction, records before/after prices and amount deltas, updates order/request totals, and marks the run successful.
- Revaluation refreshes the affected purchase request's funding summary against current store balance in the same transaction; positive shortfalls therefore block payment preview.
- The database integration test covers a real affected execution order, updated line totals, and persisted price adjustment source; repeated run processing returns 409.
- `GET /jobs/{id}` returns each processed order's adjustment ID and before/after sales and supply prices.
- `GET /jobs/{id}/adjustments` returns the persisted per-order adjustment source rows for later statement and payment reconciliation.
- Store, supplier total, supplier store, and direct statement detail lines include associated processed price adjustment IDs and deltas; statement amounts use current order totals once.
- P01 previews the uncompleted orders in the price version's effective interval and returns estimated sales and supply deltas; completed orders are excluded.
- Publishing remains synchronous; a separate worker queue and automatic asynchronous run pickup remain future work.

## Recommended Next Step

2026-09-30 update: native mini-program productization now includes multi-item ordering/shipping/receiving and real Developer Tools screenshots. Continue with discrepancy/payment details and replenishment/freight, followed by native mutation/device acceptance. See the latest checkpoint at the top of this document and `docs/continuation.md`; do not count local screenshots as production readiness.

W10 implementation and its real-database B05→B12 HTTP flow are complete, and M4 local close acceptance now passes. Next follow the plan order by resuming M5 reporting/export or the next approved milestone.

For a user-visible status map, use `docs/acceptance-dashboard.md`. It maps each implemented slice back to the original plan, shows the available workbenches, and separates passed API evidence from still-open browser E2E.

For the M4 exit gates, use `docs/m4-exit-checklist.md` together with `npm run acceptance:m4-close`. DEV-402, DEV-403, and DEV-406 now meet the local close conditions.

The ordering-to-payment main flow is tracked in `docs/main-flow-acceptance.md`. Current assessment: backend APIs and integration tests cover the main path, but the visible product flow starts mostly at billing/payment. The next execution step should create a narrow visible main-flow demo or scripted acceptance runner before adding more detailed settlement work.

`npm run acceptance:main-flow` now provides that scripted runner. It starts a temporary API instance, seeds isolated data, runs purchase request creation, procurement confirmation, supplier shipment, store receipt, statement reads, and supplier payment preview, then cleans up. Latest local run passed and printed the expected 120.00 store statement and 90.00 supplier payable preview.

## Where To Look

- Visible acceptance map: `docs/acceptance-dashboard.md`
- Main flow acceptance map: `docs/main-flow-acceptance.md`
- M4 exit checklist: `docs/m4-exit-checklist.md`
- Completed chronological notes: `docs/development-log.md`
- Planned milestones: `docs/development-plan.md`
- API contract: `docs/api-design.md`
- Static contract checks: `scripts/check-contract.mjs`
- Current order-flow integration coverage: `tests/integration/purchase-preview-http.test.ts`

Private evidence storage slice: I06 creates a payment-evidence upload session; I07 accepts JPEG/PNG/PDF files up to 10 MiB, checks file signatures and SHA-256, stores bytes under mode-0700 `PRIVATE_FILE_DIR`, and permits authorized participant/finance downloads. B07 requires at least one READY PAYMENT file ID owned by the registering actor and links it to the payment. HTTP upload/complete/download, missing-evidence rejection, and expiry cleanup are covered. Local database and private-file restore were demonstrated; production storage/backup operations remain M6.
