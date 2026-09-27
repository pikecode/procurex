# 开发日志

## 2026-09-27

- W09/S05/S08：新增 `billing:seed-acceptance` 本地验收种子，稳定生成 `PXACC` 账号、门店、供应商、公司账期/储值/信用/直接账期订单，以及一笔供应商总单与分店单共享的待付款保留。API 精确查询验证：储值总单/分店单均显示 `69.00` pending、信用单半月周期为 `2026-09-16`、直接账期预览为 `STORE_TO_SUPPLIER / DIRECT`、公司账期未结清时供应商付款预览被阻断。验证：构建、种子脚本、Web 可见性检查、diff 检查通过。
- W09/S05/S08：新增 `billing:check-acceptance`，自动启动临时 API，登录 `pxacc_admin` 后通过 HTTP 断言储值共享待付款、信用半月周期、直接账期付款通道、公司账期付款阻断和 `PXACC-PAY-SHARED` 待确认付款记录。
- DEV-406/W10：`PXACC` 种子新增一正一负供应商改价调整，验收检查通过 B05 取回负调整信用项和正调整抵扣目标，再调用 B12 创建 OFFSET 并确认处置，形成可重复的浏览器外 W10 动作证据。
- M4 验收：新增 `acceptance:m4-browserless` 聚合命令，串联构建、W09/W10 种子与 HTTP 检查、主流程验收 runner、Web workbench visibility check，作为浏览器 runtime 可用前的最高信号验收链。
- M4 验收可视化：`billing:check-acceptance` 现在写出 `apps/web/billing-acceptance-run.json`，新增 `apps/web/m4-acceptance.html` 汇总 W09/S05/S08、W10 offset 和主流程 runner 的最新结果；静态 HTTP 检查已确认页面和两个 JSON 可访问。
- 主流程可视化：新增 `main-flow:seed-demo` 和 `apps/web/main-flow-demo.html`，使用 `PXFLOW` 种子数据在浏览器中按步骤调用真实 API 完成登录、下单、采购确认、供应商发货、门店收货、供应商账单和付款预览。临时 API 验证同序列到达 `COMPLETED` 和 `COMPANY_TO_SUPPLIER 90.00`。
- 主流程 demo 验收：新增 `main-flow:check-demo`，通过临时 API 自动执行与操作台一致的 `PXFLOW` 流程，并纳入 `acceptance:m4-browserless`。
- DEV-406/W10：账单工作台新增调整列表、处置状态筛选、原周期/实际周期对照和调整详情；B12 操作随后在同日接通。初始只读切片验证：构建、Web 脚本语法、本地 HTTP 冒烟、diff 检查通过。
- DEV-406/B05/W10：B05 对可精确映射的单笔负向改价暴露 B12 信用项 ID 和处置版本；账单页支持公司财务登记线下返还、收款方确认。净额无法映射到单张负向调整单时不显示登记动作。验证：36 项单测、31 项集成测试、构建、契约检查、Web 脚本语法与 diff 检查通过。
- DEV-406/W10：B05 同时为单笔正向改价返回可用于抵扣的结算项 ID；工作台允许公司财务选择同结算侧的正向调整作抵扣目标，B12 继续校验余额及主体。验证：构建、单测、集成测试、契约检查、Web 语法及 diff 检查通过。
- W10 页面复核：修正正向调整状态文案，并给新增详情/筛选样式使用实际主题色值。验证：Web 脚本语法、本地 HTTP 加载和 diff 检查通过。
- W09/W10 浏览器验收环境核查：CUA 无可用浏览器，系统也无 Chromium/Chrome/Firefox；临时 Playwright 可运行，但 Chromium 182 MB 下载约两分钟仅完成 9 MB，已停止。没有把 API 集成或静态冒烟记作浏览器 E2E。
- DEV-406/W10 HTTP 闭环：真实数据库测试从改价来源创建负向调整单，经 B05 列表和详情取回信用项 ID，再以该 ID 调用 B12 线下返还并由收款方确认。`npm run build` 和该 HTTP 集成场景通过。

- DEV-406/AT-11：扩展 PostgreSQL 改价验收，先将供货价从 8 调至 10（结算差额 +20），再调至 11（增量 +10）；断言原 80 结算快照不变、B05 按订单净汇总 +30、供应商账单待付与 30 调整额对平。`pricing.test.ts` 三项集成测试通过。
- DEV-404/B07：付款登记的凭证由兼容可选改为必填；Controller 和 service 双层校验至少一个 READY PAYMENT 文件，且必须由登记人上传、未关联其他付款。现有直接账期、公司账期、并发幂等付款集成流均改为真实上传 PDF 凭证；增加缺凭证返回 400 的回归。全量验证：36 项单测、31 项集成测试、构建、契约检查和 diff 检查通过。
- DEV-404/I06-I07：创建上传会话时按批清理超过 24 小时的未完成会话和私有文件；文件签名不符时立即删除无效字节并保留 REJECTED 元数据。集成测试验证过期行和磁盘文件均被清理；全量 36/31 测试及构建、契约检查、diff 检查通过。
- DEV-404：B06-B11、AT-13、收款方授权、直接账期、公司账期先收后付及付款凭证上传/必填/下载/过期清理均已通过当前 M4 验收；进度总账更新为 3 个 M4 包关闭、3 个部分完成。生产备份策略留到 DEV-603/M6。
- M4/W09：新增无依赖静态账单工作台，覆盖四类账单、周期/状态筛选、账单详情、付款明细选择、服务端预览、私有凭证上传、付款登记和收款确认；凭证下载改为上传者、付款关联门店/供应商或总部角色可读。验证：TypeScript 构建、36 项单测、31 项集成测试、Web 脚本语法、契约检查、diff 检查通过。
- M4/S05/S08：为账单工作台补充窄屏布局，复用同一权限和付款流程，支持移动端查看账单、横向查看明细和提交付款。验证：构建、Web 脚本语法、diff 检查通过。
- 修正 W09 调整付款行：四类账单详情返回正向调整结算项及金额，前端可选调整项参与 B06 预览；服务端用 Decimal 规范化字符串金额，修复测试投影的 `.toFixed` 错误。验证：36 项单测、31 项集成测试、构建、契约检查、diff 检查通过。
- I07 权限验收：补充付款凭证关联供应商下载的 HTTP 集成证据，并修正下载控制器遗漏 `SUPPLIER` 角色导致的 403。全量验证：36 项单测、31 项集成测试、构建、契约检查、diff 检查通过。
- I07 越权回归：无关供应商访问其他供应商关联付款凭证返回 404；全量验证保持 36 项单测、31 项集成测试通过。
- DEV-404 I06/I07 私有目录首段：增加上传会话、受限二进制上传、文件头与 SHA-256 校验、上传者下载、B07 PAYMENT 凭证关联、数据库迁移及 HTTP 往返验收。构建及专用集成测试通过。凭证字段暂时可选；付款相对方下载授权仍待补齐。
- DEV-405/AT-24：在独立 PostgreSQL 数据库完成真实备份恢复演练，核验 5 个执行单、4 个付款记录、4 个门店及 READY PAYMENT FileObject；私有凭证文件恢复后 SHA-256 一致。备份捕获耗时 237ms，恢复及核验耗时 521ms。该结果作为本地 AT-24 证据，生产备份策略和 RPO/RTO 目标保留到 DEV-603/M6；DEV-405 按 A04-A06 完成条件关闭。
- W09/S05/S08：完成账单工作台静态冒烟，API 健康检查和 `billing.html` HTTP 加载通过，`billing.js` 语法检查通过；全量后端验证为 36 项单测、31 项集成测试、构建、契约检查和 diff 检查通过。完整浏览器 E2E 仍待具备浏览器自动化环境后执行，未将静态冒烟计为完整页面验收。

- Continued M4 scope audit: `STORE_FINANCE` now has the documented store-side B12 read/confirm permission, and its bound store is enforced across payment, adjustment, difference-disposal, and clearing reads/mutations. Verification: build, 35 unit tests, 28 integration tests, contract check, and diff check passed.
- Hardened W08 account reads: `GET /stores/{id}/account` and `GET /stores/{id}/ledgers` now include STORE_FINANCE and enforce the authenticated bound store. Added controller regression coverage. Verification: build, 35 unit tests, 28 integration tests, contract check, and diff check passed.
- DEV-401/AT-09：修复价格 run 乱序处理覆盖新有效价格的问题。每单处理前重新按首次发货/提交基准时间查询当前有效 revision；旧 revision 已被更新版本取代时，将 run 明细置为成功零差额，不改订单和资金，不重复生成调整。新增 PostgreSQL 集成场景覆盖新 run 先执行、旧 run 后执行。验证：构建、27 项单测、27 项集成测试通过。
- DEV-402 方向核对：AT-16 及需求/数据库设计要求直接账期销售价和供货价始终一致；初步审计未发现 P02 发布入口执行该约束。尚未修改，下一项沿计划补齐守卫及集成验收。
- DEV-402/AT-16：P02 发布价格时校验供应商默认直接账期和模板直接账期配置，销售价与供货价不一致则拒绝；模板切换为直接账期时同步校验该模板商品的最新价格。新增数据库集成覆盖直接账期不一致拒绝及相等价格成功。验证：构建、28 项单测、契约检查、diff 检查通过。
- DEV-403：补充供应商总单与分店单的聚合验收，按所有返回分店逐项求和并断言商品额、运费、总额与总单一致。验证：构建、28 项单测、28 项集成测试、契约检查、diff 检查通过。
- DEV-403：修正四类账单在 `IMMEDIATE` 周期按日期合并同日执行单的问题；分组键和账单 ID 现在包含执行单 ID，直接账期新增同日两单单元回归。验证：构建、28 项单测、28 项集成测试、契约检查、diff 检查通过。
- 进度主线审查：确认计划顺序为 M0→M1→M2→M3→M4→M5→M6；R01-R04/W11 曾在 M4 完成前启动，属于实际偏离。DEV-406 连续小步有真实功能增量，但整包状态长期不变掩盖了增量，也造成对 B12 的过度聚焦。已在 `docs/progress.md` 增加 DEV-401–406 对照缺口和按序关闭方案；后续以验收条件关闭工作包，不以细碎提交数或无分母百分比表示总体进度。
- DEV-406/B12：支持将负向调整额度抵扣到同一结算侧的正向调整项。可抵扣余额扣除付款分配及待确认/已确认差额处置，验证订单、调整单、方向和侧别匹配；新增单元回归覆盖余额计算及跨侧拒绝。验证：`npm run build`、28 项单元测试、26 项集成测试、契约检查、`git diff --check` 通过。
- DEV-406/B12：补充 HTTP+数据库集成覆盖，创建两张同订单供应商侧调整单并经差额处置 API 建立负调抵正调关系，断言方向金额和来源/目标 ID。
- DEV-406 权限复核：发现差额处置确认角色与 B12 契约不符：`COMPANY_TO_STORE` 应由门店收款方确认，但路由不允许 STORE；同时 SUPPLIER 可确认不属于其收款方的公司方向处置。直接账期在当前二值处置方向中没有表达交易双方，暂列为需明确业务映射后实施。详见进度总账。
- 进度口径复核：移除没有统一分母的后端/发布百分比估算；按计划中 DEV-401–406 记录为 0 项关闭、6 项部分完成。更新 B12 下一步，不再重复已经完成的混合付款预览项。M4 未关闭，M5 继续冻结。
- 当前工作状态和建议见 `docs/progress.md`。

## 2026-09-26

- DEV-406：B05 价格调整列表和详情读取持久化差额处置状态；已确认处置的侧返回 `DISPOSED`、待返还/抵扣金额为 `0.00`，详情返回处置凭证。修正 `processingStatus=DISPOSED` 的价格调整过滤，并新增单元回归。验证：19 项单元测试、26 项集成测试、构建、契约检查、diff 检查通过。
- DEV-406：修正 P03 调整单的原周期和实际结算周期键，统一使用与账单相同的左闭右开日期边界；避免后续正式调整结算明细无法归入对应账期。验证：构建、20 项单元测试、26 项集成测试、契约检查、diff 检查通过。
- DEV-406：B01-B04 读取持久化调整单并按实际结算周期聚合独立 `adjustmentAmount` 字段；调整单可出现在没有原始订单行的新周期账单中，但暂不并入普通总额或付款分配，避免绕过 SettlementItem 核销链路。新增回归；验证：构建、21 项单元测试、26 项集成测试、契约检查、diff 检查通过。
- DEV-406：B01-B04 账单根据已确认付款分配计算 `OPEN`/`SETTLED`，支持 `settlementStatus=SETTLED` 查询；详情读取不再强制只看 OPEN。验证：构建、19 项单元测试、26 项集成测试、契约检查、diff 检查通过。
- DEV-406：为直接账期账单新增状态回归，验证只有已确认分配覆盖账单总额后才为 `SETTLED`，且列表筛选和详情一致。验证：构建、20 项单元测试、`git diff --check` 通过。
- DEV-406：新增 `AdjustmentDocument`/`AdjustmentDocumentItem` 持久化。P03 处理价格变更时，仅对已存在结算快照的侧在同一事务记录净调整、原周期、实际结算周期、来源修订和订单行；未结清侧继续走动态账单。新增迁移并验证数据库表和迁移记录。
- DEV-406：B05 优先读取持久化调整单，旧的无调整单数据继续使用结算快照兼容路径；新增读取回归。验证：18 项单元测试、26 项集成测试、构建、契约检查、diff 检查通过。
- DEV-406：B12 新增负价格调整单信用来源，增加 `adjustmentDocumentId` 关联；门店侧负调整映射门店应收抵扣，供应商侧负调整映射供应商应付抵扣，仅允许负额且仍保持一次性处置。新增迁移；验证：18 项单元测试、26 项集成测试、构建、契约检查、diff 检查通过。
- DEV-406：B05 按结算侧读取 `SettlementItemSnapshot`。改价发生在某侧已确认付款快照之后时，该侧不再重复生成普通价格调整；未冻结侧仍按动态订单金额反映。新增单元回归覆盖同一改价仅冻结一侧。验证：build、15 项单元测试、26 项集成测试、契约检查、diff 检查通过。
- DEV-406：曾将未快照侧误判为独立调整；后续复核确认这会与动态账单重复计差，已在本次提交中修正并覆盖三种事件时序。
- DEV-406：复核后更正上一条规则表述和实现：改价已经包含在后续确认的结算快照内，不应再生成调整；只有改价晚于对应侧快照时才列为独立差额。新增覆盖先改价后结算、单侧先结算后改价、先改价后单侧结算三种时序。
- DEV-406：付款预览将待确认差额抵扣计入可用应付余额，防止同一余额在抵扣等待确认时再次登记付款；集成测试覆盖待确认抵扣场景。
- DEV-406：付款登记与抵扣登记在同一组结算明细上使用事务级 advisory lock，并锁定少收退回记录后再检查重复处置，消除并发双重占用窗口。
- B06-B11：付款列表、详情、预览、登记和确认统一应用当前门店/供应商绑定范围，避免角色用户跨主体读取或操作付款记录。
- B09-B10：付款拒绝和取消也复用同一主体范围校验，补齐付款写入口的权限边界。
- B08-B12：付款确认/拒绝/取消及差额处置确认改为带版本和 PENDING 状态条件的原子更新，避免相同版本并发请求重复完成状态转换。
- B01-B04：总单、分店单、直接账单和门店账单汇总接入付款分配，显示待确认、已确认和剩余应付金额。
- 方向复盘：确认 M5 已在 M4 完成前提前启动；后续冻结新增报表/通知范围，按 DEV-404、DEV-405、DEV-406 顺序补齐资金与调整闭环，并将总进度与 M4 工作包进度分开记录。
- DEV-405：清账明细和门店账户改为带版本、有效状态、余额条件的原子更新，防止并发清账重复扣减挂账额度。
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

# 2026-09-26

- Continued DEV-406 with formal adjustment settlement item IDs. B01-B04 now expose side-specific persisted adjustment IDs alongside adjustment amounts. B06 preview validates the adjustment document, allows only positive adjustments, applies the correct store/company/direct direction, and uses the document source revision. B07 reuses existing payment allocations; B08 confirms adjustment allocations without calculating order overpayments or ordinary settlement snapshots. Negative adjustments remain routed to B12.
- Statement payment summaries now include adjustment allocations; positive adjustment amounts contribute to payable amount and `OPEN`/`SETTLED` status while ordinary goods totals remain unchanged. Added a regression test for a fully paid adjustment-only direct statement.
- Added B06 regression coverage for positive adjustment preview direction/source revision and negative adjustment blocking.
- Company-term supplier-side adjustment preview now includes positive store adjustment items in the store receivable gating calculation; added regression coverage.
- Added mixed ordinary plus same-direction adjustment preview coverage.
- Verification: `npm run build`, `npm test` (26), `npm run test:integration` (26), `npm run contract:check`, and `git diff --check` passed.

- Continued DEV-406: added the persisted `Overpayment` model and migration.
- B08 now compares each confirmed allocation with the current order amount after price changes and records positive excess by store, supplier, and source revision; payment details return the overpayment total and source rows.
- Verification: migration deploy, build, 14 unit tests, 26 integration tests, contract check, and diff check passed.
- B12 now accepts `Overpayment` credits, chooses the matching store receivable or supplier payable target by payment direction, and prevents the same credit from being disposed twice.
- B05 now nets repeated price-change rows per order line before exposing store and supplier adjustment views; zero net deltas produce no adjustment row.
- Corrected B12 target availability by settlement side: store receivable offsets use sales goods, supplier payable offsets use supply goods.

- Continued DEV-406 instead of M5: unified P02 price-change adjustments with B05.
- `/adjustments` now returns separate store receivable and supplier payable rows for each non-zero price delta, with original and actual periods, source revision, and detail lines.
- Included price changes for orders without a first shipment by using request submission as the baseline period; preserved existing F05 return adjustment and disposal behavior.
- Verification: `npm run build`, `npm test` (14), `npm run test:integration` (26), `npm run contract:check`, and `git diff --check` passed.

# 2026-09-27

- Re-audited B07 against the API design: payment registration still lacks evidenceFileIds persistence/validation because I06/I07 file upload and private storage are not implemented. Recorded this as an explicit DEV-404 gate rather than accepting arbitrary file IDs.

- Added direct-term positive adjustment payment acceptance: preview, register, and supplier-confirm a persisted +20.00 adjustment; B04 reaches SETTLED with original goods/freight snapshot unchanged.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (30), `npm run contract:check`, and `git diff --check` passed.

- Extended the settled-side price adjustment integration through B05: reads the persisted supplier adjustment document as a pending +10.00 payable adjustment while the original snapshot remains frozen.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (30), `npm run contract:check`, and `git diff --check` passed.

- Added DEV-406 database integration for repricing after supplier-side settlement: keeps the 80.00 snapshot, creates a persisted +10.00 supplier adjustment document, and exposes 90.00 payable components without changing the frozen statement base.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (30), `npm run contract:check`, and `git diff --check` passed.

- Strengthened DEV-405 W08 clearing acceptance: clearing selected 200 from two credits leaves the unselected 50 active, preserves cumulative net-paid and cash balance, reduces only outstanding credit, and writes the matching clearing debit ledger.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (30), `npm run contract:check`, and `git diff --check` passed.

- Added a company-term HTTP settlement gate scenario: B06 rejects company supplier payment with STORE_RECEIVABLE_UNSETTLED until STORE_TO_COMPANY payment is confirmed, then makes the supplier payable available.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (30), `npm run contract:check`, and `git diff --check` passed.

- Added DEV-403 AC-20 integration proof across supplier-total and supplier-store views: a payment reserved from the child statement is reflected as pending and unavailable to pay from the parent statement through the same settlement item ID.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (29), `npm run contract:check`, and `git diff --check` passed.

- Added immediate-cycle grouping regression coverage for store, supplier-total, and supplier-store statements, complementing existing direct-statement coverage; each keeps same-day execution orders separate.
- Verification: `npm run build`, `npm test` (36), `npm run test:integration` (29), `npm run contract:check`, and `git diff --check` passed.

- Made AC-21 explicit in the settlement integration: asserts the completed order is STORED_VALUE while its supplier statement/payment preview still exposes the COMPANY payable including freight.
- Verification: build and all five purchase HTTP integration scenarios passed.

- Extended direct-term payment HTTP acceptance with role boundaries: supplier cannot initiate preview and store cannot confirm its own payment; authorized supplier confirmation still succeeds.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (29), `npm run contract:check`, and `git diff --check` passed.

- Added DEV-402 AT-17 HTTP regression: a credit limit below currently used credit is rejected and neither persisted limit nor used credit changes.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (29), `npm run contract:check`, and `git diff --check` passed.

- Added direct supplier-term HTTP acceptance: B04 list/detail returns goods plus freight; B06 maps to STORE_TO_SUPPLIER/DIRECT; B07 idempotent registration and B08 supplier confirmation settle the statement; confirmed snapshot preserves goods/freight/total amounts.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (29), `npm run contract:check`, and `git diff --check` passed.

- Closed two remaining store-scope read gaps found during the M4 audit: recharge details now allow STORE_FINANCE and reject another store; store catalog reads now reject unconfigured or mismatched STORE/STORE_FINANCE scopes.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened purchase request O03 reads: STORE_FINANCE can read purchase requests, list filters are forced to the bound store, mismatched filters are rejected, and cross-store details resolve as not found.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened supplier order F01 reads: SUPPLIER list filters are forced to the bound supplier, mismatched filters are rejected, and cross-supplier details resolve as not found.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened supplier order F02/F03/F06/F09 mutations: configured SUPPLIER scope is carried through shipment preview, shipment creation, freight confirmation, and rejection lookups.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened F04 discrepancy resolution: configured SUPPLIER scope is applied through the discrepancy's order-item and supplier-order relation.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened F04 receipt creation: configured STORE/STORE_FINANCE scope is applied through the shipment's supplier-order relation.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened O01/O02: configured store accounts can preview and create purchase requests only for their bound store.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Added DEV-401 HTTP acceptance coverage for P01 impact preview alongside the existing P02/P03 publish, process, replay, run, adjustment, and version-history flow. The preview verifies a no-impact scope returns zero deltas.
- Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Closed DEV-401 against the current backend gates: AT-08 receipt/revaluation ordering, AT-09 out-of-order price runs, and W06/S10 P01-P03 HTTP flow are all covered. M4 tracking moves to 1 closed, 5 partial.

- Added `STORE_FINANCE` to B12 read/confirm authorization, matching the documented shared store-side permission. Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Closed a STORE_FINANCE scope gap across DEV-404/405/406: payment records, adjustments, difference disposals, and clearing details now enforce the bound store for both STORE and STORE_FINANCE accounts. Added the clearing regression assertion. Verification: `npm run build`, `npm test` (35), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Added DEV-403 AT-10 boundary coverage for half-month 15/16, Sunday/Monday weekly rollover, year-end, and leap-day periods. Verification: `npm run build`, `npm test` (35), and `git diff --check` passed.

- Closed the statement detail scope gap found during follow-up audit: unconfigured STORE/STORE_FINANCE/SUPPLIER accounts are rejected before decoded statement IDs are queried. Added Controller regression coverage for list narrowing and missing detail scopes. Verification: `npm run build`, `npm test` (34), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened DEV-402/403 statement reads: direct, store, supplier-total, and supplier-store list/detail endpoints now apply authenticated store or supplier scope, reject mismatched filters, and prevent cross-scope detail access. Company roles retain existing broad access.
- Verification: `npm run build`, `npm test` (33), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Closed the B12 receiver authorization slice: store and supplier users may read and confirm only difference disposals whose direction matches their receiving side; company roles retain existing access. Added unit coverage for matching and mismatching scope/direction combinations.
- Verification: `npm run build`, `npm test` (30), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Added AT-13 integration evidence for DEV-404: two different idempotency keys concurrently register the same supplier payable, exactly one reserves it, the other receives a conflict, and the winning request replays the same payment.
- Verification: `npm run build` and `npm run test:integration` (28) passed.

- Added regression coverage for DEV-402/403: direct supplier-term payment previews use `STORE_TO_SUPPLIER` and the DIRECT channel with freight included; replenishment shipments remain in the original first-shipment settlement period.
- Verification: `npm run build`, `npm test` (33), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Hardened DEV-401 AT-08 ordering: price-run processing takes a row lock on each supplier order before checking completion and applying the new price, preventing a final receipt from racing with a stale completion check.
- Verification: `npm run build` and `npm run test:integration` (28) passed.

- Hardened DEV-405 A06 clearing detail access: STORE and STORE_FINANCE roles can read only their bound store's clearing documents; company roles retain full access. Added a cross-store unit regression test.
- Verification: `npm run build`, `npm test` (31), `npm run test:integration` (28), `npm run contract:check`, and `git diff --check` passed.

- Added DEV-406 AT-14 integration coverage: a negative adjustment without a follow-up order can be recorded as an `OFFLINE_RETURN` with no target debit and confirmed by the supplier receiver role.
- Verification: `npm run build` and `npm run test:integration` (28) passed.
