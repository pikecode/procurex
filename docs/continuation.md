# ProcureX Continuation Handoff

Last updated: 2026-10-09

## 当前接续（唯一待办入口）

- 2026-10-09 已选商品改为显示商品管理的全部关联供应商：新增商品自动带出全部有效关联供应商，主表供应商列改为列表式（每行一个，首选带标记，可设首选/追加）。**待用户浏览器实测**，服务在 4174/3114，账号 `pxflow_user` / `correct-password`，主要看"结算验收模板"（3门店）。

- 2026-10-09 模板商品展开行内新增按门店配置结算周期：展开商品后，供应商表下按门店横排周期下拉，仅公司账期/供应商账期可设，其余显示"即时结算"；改动存为草稿，保存时先提交 items 再以新 version 提交 settlement-cycles，对管理员仍是一次保存。**尚未做浏览器实测与视觉确认**，需在 http://127.0.0.1:4174/templates 实际走一遍确认交互与横向滚动表现。

- 2026-10-09 结算方式收敛遗留了一批失效测试与脚本，**下一批优先处理**：`template-prices-http.test.ts:158`、`master-data-audit-http.test.ts:84-85`（依赖的审计动作 `template.supplier-setting.set/clear` 已不可达，是否一并废弃需用户确认）、`workspace-master-data-http.test.ts:111,155`、`scripts/check-local-business-flow.mjs:51`、`scripts/check-react-admin-r2.mjs:82`。已确认这些失败与账期覆盖确认改动无关。详见 development-log 对应条目。

- 2026-10-09 模板账期覆盖不再静默清除：移除商品若会连带删除某供应商在门店的账期覆盖，接口改为409 `TEMPLATE_CYCLE_OVERRIDE_REMOVAL_UNCONFIRMED` 并列出明细，须带 `confirmCycleOverrideRemoval: true` 重试；审计记录被清除项。`templates-http.test.ts` 已改为覆盖 `settlement-cycles`，真实数据库 2/2 通过。详见 development-log 对应两条。

- 2026-10-09 需求核对发现文档状态与代码存在实质差距，接续时不要沿用旧的"已完成"表述：以代码为准。已确认被**有意禁用**（非缺陷）：`PUT /templates/:id/supplier-settings` 与 `.../:supplierId` 现返回 `TEMPLATE_SETTLEMENT_DISABLED`，结算方式统一在供应商资料维护，模板只保留按门店账期（cycle）覆盖；`TemplateSupplierSetting` 表及 `replaceSupplierSettings`/`setSupplierSetting` 为保留的死代码，归档与供应商删除时仍在清理。尚未独立核实、需在继续开发前逐条验证的疑点：worker 为空壳（`main.ts` 仅 `console.log`）、超时自动催收、采购拒单/资金缺口通知门店缺失、权限矩阵未落地为可配置能力、商品图片"自动压缩+非正方形裁切"实为拒绝。库存/进货单全仓零实现，属待用户决策的范围问题，不是 bug。

- 支付方式管理现在是关联供应商去重后的逐行配置表，四种支付方式和周期，一次事务保存，PUT /templates/:id/supplier-settings。批量管理已完成，早期未完成说明失效；模板销售价编辑、统一资料/门店配置及删除口径仍是后续项。API3114已运行新版本。

- 模板商品列按最新用户指定为名称/分类/销售单位/商品销售价/供应商/供货价/预估毛利及移除。供应商下拉只选商品关联项，切换维护首选优先级并保留备用；商品销售价不在此编辑。本轮未打通模板售价编辑，后续仍需按需求补齐，不能误报完成。

- 最新订货模板：商品配置改为左分类树与已选/待添加页签，勾选直接加入草稿，一次保存、未保存关闭确认。专项脚本 check-react-admin-template-products.mjs 使用模拟接口，不写真实数据。后续按用户脑图补齐模板价格编辑、统一资料/门店配置、批量支付方式管理及删除行为，不能将本轮交互优化当作整个模板交付完成。

- 最新商品管理：基本信息/供应与采购/订货规则三个Tab，切换保留输入、跨页签校验自动定位并标记；两级分类树形选择，销售价格名称对齐。供应商选择与采购价合并为行式区域，每行供应商/采购价/销售单位/移除图标。商品/关联/采购价同一事务一次保存，不再二次弹窗或要求预览发布。留空不调整，自动记录当前生效时间和原因；独立价格界面已撤下，仅保留底层价格记录及既有结算规则，历史改价来源待核实。构建、188项单测、模拟浏览器和真实数据库联调通过，临时数据清理通过。历史单位快照和无库存边界保持不变。
- 最新供应商商品管理：单弹窗顶部供应商名称/左分类树/右列表，顶部已供商品和待添加商品页签。待添加页勾选直接加入草稿，取消勾选撤回，不再点添加所选；已供页支持单行/批量移除。底部显示待新增/移除数量并统一保存修改，未保存关闭确认，失败保留草稿。

- 供应商删除界面对齐：删除确认后退出日常列表，复用逻辑删除解除商品/模板关联，历史订单及供应商主体保留。

- 最新供应商校验规则覆盖旧记录：联系、地址及银行税务资料选填，前后端可清空；名称与配送/结算/周期必填，运费默认否。构建、188单元测试及必要项模拟提交验证通过。

- 供应商新增/编辑字段顺序及名称按用户最新图对齐，配送自配送/物流、编辑隐藏编码；保留必填规则、状态及结算说明扩展。

- 供应商列表已按最新要求精简为名称、类别、结算周期、操作，编号及其他资料列不显示；详细表单及后台关联规则保留。

- 最新凭证调整：账户历史的充值/销账历史及储值流水直接显示缩略图，点击放大，单据详情保留。未改变资金逻辑，充值历史为充值入账子集。

- 最新界面调整：门店财务操作列改为额度/销账/充值/历史图标，带悬停提示，小屏两行；历史凭证统一图标入口。财务业务规则未变，构建及财务浏览器回归通过。

- 最新完成：账户历史入口及充值/挂账/销账三个查询，按销账单汇总并查看单据凭证，小屏选择记录类型；挂账流水取消100条限制，API3114已重启。历史缺失数据仍不会补造。

- 最新完成：按用户明确需求调整门店财务五项信息及三个直达操作，待销账订单筛选/批量勾选/金额统计、充值日期及字段对齐。门店名称保留账户流水入口。验证通过，未写入真实测试账务。

- 最新完成：挂账额度调整改为保存后弹窗确认，展示原/新额度与原因，可返回修改；充值和销账保留原流程，财务回归通过。

- 财务账户操作入口已明确：列表文字入口替换眼睛图标；充值归储值、调整额度归挂账，权限和财务规则不变。构建及两项浏览器验证通过。

- 最新完成：门店财务视觉交互优化（分区表头/余额、金额格式、筛选和勾选操作），保留财务规则。构建与财务流程/布局浏览器验证通过，详见开发日志2026-10-07记录。

最新用户任务：门店分组维护优化已完成。Stores分组侧栏/手机选择器、数量及停用状态、按组新增、跨分页批量调组、Directories数量跳转已实现；新增POST /stores/group-memberships最多100门店，ADMIN限制、分组事务锁、门店版本及审计回滚。构建、186单元、增强store-groups-http和check-react-admin-store-groups通过。API3114已重启；本任务不涉及财务或库存范围，后续仍按用户最新要求推进。

最新插入规则：商品最小起订量/订购倍数及模板覆盖值必须正整数，默认1，模板可空继承商品；前端precision0和全量校验、后台Decimal整数/正数/14位检查已完成。build/build:admin及增强配置HTTP/交易换算HTTP通过，API3114已重启。数据库无非法存量；不改变价格、换算比例与交易数量的小数规则。

最新插入：采购单位交互改为直接选填，默认不选，选择才展开1采购单位=X销售单位；两个商品配置入口均接入，清空保存null，换单位清除旧X。真实表单专项及两项换算HTTP通过。用户本条提到进货单/库存，与既定首版不含库存冲突，已询问是否新增范围，尚待回复。不要把现采购申请或销售数量伪称进货库存；若用户确认新增，再明确入库/出库库存边界与计划。否则继续模板NEXT。

最新覆盖单位存量待办：用户授权安全合并已完成，5条件归并PXFLOW-UNIT，迁移5个商品引用，8个商品统一引用，删除4条单位；全单位表无重名。60张其他表哈希一致，未改历史快照/账务/价格，备份及报告var/unit-merge-evidence/2026-10-07T01-57-21.145Z。merge-local-units重复执行NO_CHANGE；两份seed复用共享单位且不删除共享单位。本批无需重启后端，前端刷新即可；继续订货模板NEXT，不重复清理。

最新插入任务：单位名称防重已完成API创建/编辑事务锁校验，trim后比较，409/UNIT_NAME_EXISTS中文提示。build及增强catalog-registries-http通过，API3114重新运行。现5条“件”仍存在且有8个商品引用，本轮没有合并/删除；直接SQL夹具不受API防重保护。后续存量处理先审查换算、交易快照与无快照历史，再考虑数据库唯一约束，不允许直接删单位。

最新任务为用户订货模板脑图：本批已完成TemplateProducts紧凑表格、分类树/搜索/跨页批量选择、供货方预填、有效价格/结算展示、全供应商默认/覆盖列表和分页外校验。build:admin、增强R2及1440/320截图检查通过。证据var/react-admin-r2-evidence，写入仍为模拟，不代签真实保存。

NEXT：整合基本信息/门店/商品/结算完整工作区，处理各段保存后的最新版本与未保存草稿；已选商品分类筛选、模板价格入口、真实模板保存联合验收。现仍使用分立弹窗，不能标模板脑图全部完成。API3114与React4174运行，未提交/推送；不要重做既有财务主流程。

2026-10-07最新覆盖下方商品NEXT：历史单位名称展示已补齐，申请/供应商订单/收货/供应商两类账单按原交易单位ID查当前名，删除回退原名；unitSnapshot、数量、换算、金额不改。React优先新名称、小程序采购单位标签同步。分类/品牌现有关联及同步文本由主数据HTTP复验。build/build:admin、186单元、3项HTTP、R3新旧名称差异断言、93小程序及mini:check通过。真实裁切OSS联合两模式2/2、10对象及指定版本/夹具清理PASS，证据var/react-admin-oss-attachments-evidence/manifest.json。API3114已重启，React4174保持运行，未提交/推送。

下方“历史单位展示及新裁切OSS未完成”是上一批记录，现已完成，不重复验证正常链。下一步按用户新增需求或既定客户业务/真机/容量/生产门槛推进；不以本批代签整体上线。商品供货价入口采用价格管理预选，不是表单内直接写价，不新增仓库库存。

补充最终回归：test:admin:r4-billing PASS（真实读/写入夹具）；首轮碰上API重启中断不计通过。所有本批构建和验收进程已结束，只保留正常开发服务。

2026-10-07商品脑图本批：多供应商与内联采购单位换算同事务保存；两侧关联更改/供应商归档更新商品版本。列表/编辑供货价入口跳价格管理预选商品（不是直接填写采购价）；JPEG/PNG先1:1裁切、输出JPEG压缩至2MB以内。build/build:admin、182单元、5项HTTP、基础后台/R2及真实表单专项和清理PASS；证据var/react-admin-product-form-evidence/manifest.json。API3114已重启，React4174保留，未提交/推送。

下一步明确按商品脑图剩余项推进：核查分类/品牌/单位历史名称展示，现单位仍显示旧交易快照；实现当前名称展示与不可变数量/换算快照分离，不修改历史账务。再验证新裁切流程的真实OSS联合上传/下载/权限/清理；本批只签独立本地私有存储。商品脑图尚未整体关闭，不重新开发已完成供应商配置或正常主链。

2026-10-07供应商脑图补齐：列表类型/周期及类型筛选、业务文案、独立供货商品配置（分类/名称筛选、批选添加、移除/保存/未保存返回提示）。build:admin、test:admin及真实持久化/重新进入/移除/409保护专项通过并清理，证据var/react-admin-supplier-code-evidence。§6.3明确银行等资料必填，保留；后端财务/归档规则未改，未提交/推送。

最新修正：分类/单位/订货模板新增和模板复制均由后端自动编号（FL/DW/MB加UUID），编辑只读保留。build/build:admin、4项HTTP集成、R2回归及真实React新增/刷新/编辑/复制/并发校验与清理PASS；证据var/react-admin-registry-code-evidence/manifest.json。API3114已再次重启，React4174刷新生效。品牌无需编码，历史资料与原验收边界不改，未提交/推送。

供应商编码自动生成已补齐，之前仅门店自动化。React新增隐藏code，编辑只读；接口省略生成GYS+UUID，旧显式编码兼容，历史不改。build/build:admin、workspace-master-data-http及suppliers-http2项、真实React新增/刷新/编辑和1440/390检查清理通过；证据var/react-admin-supplier-code-evidence/manifest.json。未提交/推送，原验收边界不变。

收尾最终验证：build:admin、182/182单元、管理员真实API专项（cleanup PASS）及test:admin:all完整12/12通过。首轮旧编号/通知夹具失败已适配并重跑，以var/react-admin-r5-evidence/manifest.json为准。正常4174/3114服务保留，未提交/推送。

收尾更新：管理员/commands入口已实现，真实API复核、刷新原键恢复（审计恰好一条）、回滚/原子未提交条件关闭、无证明409及财务访问拒绝通过并清理。最终交接及页面/证据映射见react-admin-handoff.md。下段“下一批补管理员入口”已完成，不再执行；下一步是客户业务、真机、容量及生产验收，保留未完整覆盖的全部异常真实证据边界，不新增无限页面队列。

React本地默认入口已切换：`npm start`，http://127.0.0.1:4174/；API使用`PORT=3114 npm run start:api`。旧后台用`npm run start:web:legacy`，回退仅入口切换，不改数据库。README已有本地和静态部署说明。

最新通过：四模式29次真实写入丢响应/刷新原键恢复及清理（var/react-admin-recovery-evidence/manifest.json）；通知真实API单条/全部已读、刷新和1440/390检查及清理（var/react-admin-notification-evidence/manifest.json）；build:admin、182单元和静态部署验收。入账标签及门店自动编号已完成，不重开正常链、OSS格式或付款驳回专项。

管理员命令工具及最终交接已完成，既定React页面开发队列已实现。下一步仅按react-admin-handoff.md“尚未签收”推进业务/真机/容量/生产及真实异常证据，不重新开发已完成页面。3/7、6/9不变。以下接续段均为历史记录，旧NEXT不作为待办。

## 历史接续记录

最新用户需求已完成：门店新增自动编号（省略code由后端生成MD+UUID），旧显式编号兼容、编辑只读；商品编码选填并降低列表视觉优先级。后端和后台build、门店分组HTTP含并发自动编号/无效编码校验、React1440/390表单检查通过。本地API显式PORT=3114已重启，React4174保留。未改历史数据。React迁移剩余恢复验证、需求映射与默认入口切换不因此关闭。

最新接续：React门店订单及采购申请的paymentStatus改为“储值/挂账入账”，对应未入账/部分入账/已入账；门店列表paidAmount改为“账户入账金额”。不再表示整单付款状态，月结付款以账单/付款记录为准。未修改财务算法或新增结算汇总接口。后台类型检查和生产构建通过，浏览器专项尚未重跑。下一步：真实丢响应/刷新原键恢复验证、最终需求映射、默认入口切换；整体完成口径不变。

最新接续（覆盖下方旧NEXT）：商品PNG/JPEG、付款PDF和三方向真实驳回链已验收。`test:admin:oss-attachments` 最终2/2及cleanup PASS，10份OSS对象（含6PDF）、38张唯一390宽截图，证据 `var/react-admin-oss-attachments-evidence/manifest.json`。React商品保存/刷新放大、PDF打开认证blob及浏览器下载、空原因阻止驳回、释放原分配/重登/确认/终态只读、绑定门店/供应商及采购附件权限通过。对象具体版本及临时数据清理；不是银行转账。终态选择器首轮严格匹配失败已修正并重跑，失败清理PASS。本地正常4/4、182单元及后台类型检查通过。

下一批先修正StoreOrders付款展示口径（月结已确认分配但申请资金汇总UNPAID），再核查React真实丢响应/刷新原键恢复，最后需求映射及默认后台切换。不要把存储/驳回重复列为未完成。当前requirements.md §4.1.3/§6.2.2明确自动模板/供应商结算匹配、门店不手选；旧“支付自由选择契约缺口”已撤销，不需要新增选择器。原整体口径3/7、6/9及生产/微信真机/业务签收门槛保留。

最新接续：R5真实OSS业务PNG凭证链已完成，覆盖下方历史NEXT。`npm run test:admin:oss-journey` 四模式4/4、cleanup全部PASS；本地同单也4/4。11份充值/销账/收货/三方向付款凭证实际OSS上传，SHA256/字节/单据关联、React缩略图和放大、匿名OSS403/API401及无权采购员404通过。按具体版本删除本次UUID对象并验证版本/当前均不存在，再清理临时数据库。证据 `var/react-admin-oss-journey-evidence/manifest.json`及40张390宽图；182单元测试、后台类型检查及脚本/diff/数据库保护检查通过。

下一批只处理剩余商品图片/PDF附件类型、异常路径证据和需求映射，再交接切换；不要把PNG正常流程代签所有附件或异常。月结申请资金状态/账单展示及支付方式选择契约差距仍开放。真实同单脚本运行前需build；OSS版仅允许已配置测试Bucket和procurex-test/，密钥由.env加载不能记录/回显。无银行实际转账或生产签收。本地3/7、收尾6/9不变；正常4174/4173/3114未改变。

最新R5接续（覆盖下方历史NEXT）：`npm run test:admin:real-journey` 四模式真实React同单正常流程4/4 PASS、每组cleanup PASS。五角色实际操作充值/额度、下单、采购、供应商发货、门店收货、适用销账及付款确认；预置仅临时主数据/初始价格。证据 `var/react-admin-real-journey-evidence/manifest.json`及29张390宽截图。储值1000→冻结24→收货976且关联申请扣款1条；挂账24→销账0且储值不变；三付款方向的单条分配确认。build/语法/diff检查通过。附件合成PNG实际私有上传下载、匿名401，但独立本地存储不是OSS或银行转账。

当前下一批：真实OSS与React凭证联合验收，异常路径证据核查及需求映射，再交接/默认后台切换。月结付款已确认但申请资金汇总仍UNPAID，需核查展示衔接；CLEARING借方流水不是储值扣款，不要错误修改算法。支付方式自由选择契约差距继续开放。R5正常同单子项已完成，不重跑全部页面作为下一阶段；生产域名/HTTPS/真机/客户签收单列。本地3/7、收尾6/9不变，4174新后台、4173旧后台、3114正常API保留。脚本拒绝未知/远程库，禁止重置数据库或生产种子；本批无业务代码变更。

R5最终本批结果：test:admin:all完整重跑12/12 PASS，build:admin PASS，test:admin:deployment PASS且cleanup PASS。两个manifest路径见下段。首轮11/12失败已由采购脚本搜索后选择修复，并非未解决业务缺陷。仍未签真实React同单、资金/OSS联合或生产切换；无需重做已通过专项，后续直接推进R5剩余出口。

React当前接续（覆盖下方旧NEXT）：R2-R4页面及供应商履约/财务/供货报表已实现。R5新增 `npm run test:admin:all` 串行12专项，证据 `var/react-admin-r5-evidence/manifest.json`；基础组有真实临时分组读写及清理，其余业务写入夹具，不能签真实同单资金链。新增Nginx静态镜像及专用Dockerignore，`build:admin`后 `test:admin:deployment` 验证8路径刷新、JS/CSS、404、API401/健康、真实登录恢复及1440/320图，临时容器/镜像回收通过。首轮采购专项因虚拟下拉选择不稳定失败，搜索后选择修复并重跑。最终集中回归结果以最新manifest为准。

下一步仅按 `docs/react-admin-migration.md` 的R5剩余出口：受保护本地夹具完成真实React跨角色同单，再资金/OSS联合验收，最后交接切换。不要重置数据库、重跑生产种子或把模拟写入签为真实资金验收。新后台4174、旧后台4173和API3114保留；生产域名/HTTPS/真机与业务签收单列，原本地3/7和收尾6/9不因React测试数上调。

React最新R3接续（下方旧NEXT为历史）：/purchase-requests与/supplier-orders可用。采购申请新增、门店目录、单位选择、金额/资金预览、修改明细、确认及取消；供应商订单详情/资金核对/发货摘要与权限内明细、申请往返已实现。未知提交结果跨两页及刷新后用原键恢复，禁止新键重复确认；原单位输入/商品版本及双价格版本保留。专用test:admin:r3已通过，现有列表/首条详情真实读取，所有采购写入为响应夹具；没有实际订单/资金/OSS写入。R3未完成，NEXT换供应商与拒单重分配，再发货/补发/运费、收货修订/凭证、差异处理，随后R4/R5。不扩展采购员发收货权限，不重置数据库。入口4174/purchase-requests，API3114及旧后台4173保留，证据var/react-admin-r3-evidence/manifest.json；详细剩余见docs/react-admin-migration.md。

React最新接续（以下旧NEXT为历史）：R2全部页面已实现，新增/templates与/prices。模板新增/编辑/复制/门店/商品/供应商优先级/结算覆盖/归档，价格报价/预览/发布/版本/重算/原键恢复已接现有接口。build:admin、test:admin、test:admin:r2通过，证据var/react-admin-r2-evidence/manifest.json。写入响应夹具验收不等于真实业务写入或OSS验收；未改价或写订单资金。NEXT进入R3采购、订单、发收货、差异处理，随后R4/R5；不要重置业务库。新后台4174保持运行，旧后台4173/API3114保留。迁移计划见docs/react-admin-migration.md。

React最新交付：/products、/suppliers已加入菜单，商品支持图片和独立采购单位换算，供应商支持银行/发票/结算资料、商品关联及归档确认。下一批模板与价格，R2仍未完成；不重置数据库。商品/关联写入测试采用响应夹具，真实OSS联调仍需验收。

React R2最新交付：/categories、/brands、/units三页已接真实API维护；HQ_FINANCE只读，ADMIN/PURCHASER可维护。下一批商品与供应商，然后模板和价格；R2不能标为完成。回归脚本已加入三页桌面/手机列表与新增弹窗检查。

最新方向：用户批准React并行迁移，新增apps/admin（React/TS/Vite/Ant Design），两套后台直接共用开发数据，不额外隔离。R1首批登录/会话/菜单/路由、门店、分组、收款账户已实现；新入口http://127.0.0.1:4174/stores，API3114，旧后台4173保持可用。完整迁移清单和运行命令见docs/react-admin-migration.md；下一阶段R2基础资料/商品/供应商/模板/价格，再R3订单采购、R4财务、R5全量切换。未迁移页面不显示空菜单，不将R1视为完整React迁移。npm run start:admin/build:admin/check:admin/test:admin；不要重置现有业务库。

账单查询#/finance已紧凑化：账单列表优先，账户/付款记录/结算差异可展开，详情定位及收起；finance-compact-1刷新生效。三种账单×1440/320浏览器验证及24Web测试通过，不改变结算逻辑。

账户单据凭证已支持缩略图、点击放大、下载和失败重试；仍经鉴权接口读取私有图片。缓存proof-preview-1，刷新后从账户流水“查看账户单据”进入；1440/320浏览器回归及24Web测试通过，无真实资金/OSS写入。

充值无反应已复现并修复：本地无启用收款账户，原内嵌提示不明显；现在弹窗明确说明并可跳转配置收款账户。用户需录入真实收款账户后充值，不能自动造银行资料。财务资源recharge-feedback-1，刷新生效；无账户/有账户桌面及320视口Playwright通过，未提交真实充值。

最新挂账确认：挂账为未向公司支付的货款，授权额度限制当前未清欠款；下单占用额度但不记已付、不扣储值。按约定周期确认收到还款后批量清账，释放对应额度；不得实现到期自动清零。现有资金逻辑符合，需求§6.4.3已明确。

最新用户确认优先级：储值订单“下单冻结，收货完成扣款，取消/减量释放”；充值增加余额；销账（清账）偿还挂账欠款、恢复额度，不扣储值。本次已实现，需求v1.5优先于下方历史下单即扣款记录。拆分执行单独立结算，部分收货/未解决差异保持冻结；完成后扣账面余额并释放冻结，支付状态只按实际扣款计算。历史请求策略false保留旧账，业务新建true；不要把旧单批量改true或重跑seed。

第65迁移20261006190000_stored_value_reservations已部署。StoreAccount.reservedBalance、FundingAllocation.reservedAmount；账户接口availableBalance=balance-reservedBalance，订单详情storedReservedAmount，列表/详情storedValueOnReceipt。核心request-funding.ts统一调整冻结/扣款，ShipmentsService/DiscrepanciesService完成后同步，shortage-financials释放对应冻结。新回归tests/integration/stored-value-reservations.test.ts；原原子命令/HTTP断言同步新时点并保留失败回滚/并发/重放覆盖。build、182单元、736集成、24Web、92小程序、静态均通过；finance桌面/320六截图var/store-finance-evidence。API3114已重启健康正常，Web4173；入口http://127.0.0.1:4173/app.html#/store-finance。后台资源stored-reservations-1。本次未提交/推送，上一提交6b9ee1c。后续优先用户资料本地验收、真机/生产与签字门槛，不继续扩展无关细节；小程序页面改动需开发者工具重新编译。

最新阶段：门店财务需求图差距已补齐。入口http://127.0.0.1:4173/app.html#/store-finance；财务管理下还有#/collection-accounts，仅ADMIN/HQ_FINANCE。列表财务指标、共用默认10分页、充值/清账/额度/流水；清账挂账发生日期及供应商筛选，全选筛选结果、换筛选清除选择，确认保留版本/金额重校验及幂等。先配置并启用真实收款账户才可充值，不自动造银行账户。CollectionAccount迁移20261006170000应用，64迁移；新店expectedVersion=0首次授权额度，已有账户409。历史收款编号/订单/账户历史不迁移，不重跑seed。build/182单元/24Web/静态/732集成/导航通过。scripts/check-store-finance-ui.mjs六截图var/store-finance-evidence；scripts/capture-finance-accounts.mjs隔离local API3115真实充值/清账/凭证/恢复通过并清理，3115已关闭。API3114/Web4173保留；资源store-finance-1。后续优先用户真实资料本地验收及原生产/真机/签字边界，钉钉暂不接，不继续扩展无关细节。本阶段按用户要求提交本地Git，未push；具体提交号以git log为准。

最新入口简化：http://127.0.0.1:4173/app.html#/stores，不再需要api参数。本地workspace-config.js端口3114，生产同域/api/v1；旧api链接自动移除查询并标签页保存覆盖，隔离验收随机端口仍兼容。23Web/静态和无参数列表/旧参数导航刷新回归通过。资源clean-url-1。后续给用户链接使用简洁地址，API3114/Web4173无需重启。

最新增量：后台新增编辑表单统一紧凑化，640px/少字段480px、12px间距、桌面36px手机38px控件，必填标记同行、标题与操作区收紧；原交互校验保存保留。资源forms-1。23Web/静态/列表回归及node scripts/check-workspace-forms.mjs六页面新增编辑×1440/320通过，24截图var/form-layout-evidence。仅打开取消，无业务数据写入。

最新用户增量：本地80条演示/旧测试记录名称中文化（门店10/供应商17/商品10/分类6/单位6/模板7/账号显示名24），账号密码与编号未变。仅localize-demo-data.mjs白名单原名称+测试编号，用户改名不覆盖；--apply事务已执行，重复预览0，备份明细var/demo-localization-evidence/applied.json。3演示seed及小程序商品准备中文化、报表断言同步；未重跑seed。安全映射单测/脚本语法/浏览器列表回归通过。历史订单快照保留英文，不改账务历史；后续不要重置业务库。

最新微调：下拉箭头用现有Lucide背景图标，右侧10px间距、文字34px留白，分页96px；仍原生select，强制颜色回退。资源selects-2覆盖下方版本。复现check-workspace-lists.mjs，桌面/手机及表单证据var/list-layout-evidence。

最新增量：原生select布局优化，桌面稳定筛选宽度、手机两列筛选标签上置、分页固定宽度及对齐、表单省市区40px及焦点禁用样式；没有引入第三方下拉组件或自绘弹出层。资源selects-1覆盖下方历史版本。23Web/静态及check-workspace-lists.mjs（9截图、筛选/表单/分页回归）PASSED，var/list-layout-evidence；API3114/Web4173。无后端改动。

最新增量：公共主列表renderTable默认每页10，选20/50/100，首末页/上下页/数字跳转、空态和越界保护；搜索筛选紧凑左对齐与重置，总数移至分页区、行距收紧。内嵌详情非全部共用，分页仍为已加载数据前端分页，未改后端。23Web/静态与门店商品账单320/1440及35条内存分页验证通过；复现node scripts/check-workspace-lists.mjs，证据var/list-layout-evidence。资源版本lists-1覆盖下方旧值；API3114/Web4173。固定完成标准不变。

最新增量：整个侧栏收起/展开完成，顶部页面标题左侧按钮；桌面64px图标栏、手机隐藏菜单，同标签页刷新记忆状态，保留分组折叠及权限。资源sidebar-1覆盖下方旧版本。23Web/静态检查及三账号320/1440展开收起浏览器验收PASSED（var/navigation-evidence，12截图）；复现node scripts/check-workspace-navigation.mjs，仍用API3114/Web4173。不改后端/数据库/完成边界。

最新用户增量：后台左侧业务导航已分组，权限过滤、空组隐藏、原生键盘折叠、当前组自动展开及会话内展开状态保留；手机两列导航最高230px内部滚动。无后端/数据库改动。Web23及静态检查通过，浏览器三账号320/1440证据var/navigation-evidence；复现npm run web:test、npm run web:check、node scripts/check-workspace-navigation.mjs（API3114/Web4173）。资源版本navigation-1覆盖下方历史groups-1。门店分组入口仍在门店管理内；固定6/9与3/7未签收项不变。

最新用户增量：独立门店分组管理完成，入口“门店管理”顶部“分组管理”，管理员维护，门店下拉选择。StoreGroup及旧名称整理迁移已应用（63迁移），groupName接口仍为名称/null，已引用禁删，停用原归属保留但不可新分配，改名级联并失效旧门店版本。182/731/92/22、迁移/71路由权限矩阵/审计故障、320/1440真实UI和干净63迁移/57步129图通过。API3114当前session34317健康，Web4173仍运行，资源groups-1；不再使用旧API session42757。复现npm run db:generate、npm run build、npm run db:migrate，再使用web:check-store-groups和db:test-store-groups；证据var/store-groups-evidence及var/clean-start-evidence。仅此用户明确增量，不重开固定收尾或虚增6/9、3/7。

最新用户指定增量已完成：门店/独立收货地址省市区三级联动，详细地址、回显及旧文本兼容，address接口保持不变。Web22、静态检查、320/1440浏览器检查和隔离62迁移/57步129图PASSED，run2dcf52e3-8bd7-47da-a98e-04c742c4926b；日志/tmp/procurex-address-clean.log。数据源2023大陆快照，上游停止更新，新增区划/港澳台未覆盖；来源许可address-regions.LICENSE.txt。仅此用户指定增量，不扩展固定收尾队列，后续仍按delivery-closure.md未签收项推进。

## Current Execution Priority

2026-10-06最新接续（覆盖全部旧NEXT）：用户指定OSS测试接入已完成，API3114现用FILE_STORAGE=oss/procurex-test/，真实HTTP上传/完成/下载/SHA256、匿名401/无关供应商404/云匿名403及指定版本回收PASSED；P2生产策略仍开放。固定收尾继续完成Web189项三引擎/三视口/三账号兼容及干净空库62迁移/独立API/57步129图跨角色链，全部清理PASSED。182unit/730集成/92mini/21Web及构建契约静态通过。不要重复兼容/空库复现/恢复/规模/财务或容量调优。剩C3开发者工具真实窄屏（当前无桌面控制工具，Web320不代签）、200目标未达及正式初始化/生产依赖边界、最终逐包签收；6/9、本地3/7保持。证据var/web-compatibility-evidence/manifest.json、var/clean-start-evidence/manifest.json、var/oss-attachment-evidence/manifest.json；命令web:compatibility/ops:clean-start，说明delivery-closure/local-operations/m6-storage-policy-guide。运行中的API会话42757、日志/tmp/procurex-oss-api.log，Web4173保留。常规test:integration已显式本地存储，勿用旧捕获脚本直接对OSS服务跑本地文件回收。

2026-10-06用户明确纠偏（优先于下方所有历史NEXT）：只能按delivery-closure.md“执行约束与出口”三批收尾，当前批1状态对齐/入口恢复已执行；NEXT批2真实窄屏/可访问环境兼容/正式入口核验，只修复已复现原需求可用性阻断，随后批3隔离干净复现/一轮当前版本跨角色复验/手册和逐包签收。停止连续性能调优及无新证据的后台扩建；200 QPS未达保持风险、不签通过、不自行删除目标。已关闭C2/C4/C5/C6/C7不重开，下方旧候选AC表不是当前开发队列。mini:visual-evidence本批9组90图完整性PASS、closure OPEN/仅Actual narrow viewport；不能冒充新截图/真机。730集成/178单元/92mini/21Web为上一批已通过基线。API3114健康；Web4173原停已恢复，会话41143、日志/tmp/procurex-closure-web.log。正式入口/app.html?api=http%3A%2F%2F127.0.0.1%3A3114%2Fapi%2Fv1；不改旧product-app/api.js端口冒充正式workspace配置。旧9月m6-local-evidence-handoff仍历史包摘要，不能据其LOCAL_READY宣布当前交付完成。无需用户重复发继续或确认微小改动；无法获得真实视口/设备/生产资源则具体报所需配合，不用后台工作替代。6/9及3/7不变。

2026-10-06最新接续（覆盖下方历史NEXT）：C8价格往返优化已结束。effectivePriceVersion去掉findFirst include scope，保留每侧SQL LIMIT/时间revision排序，以已过滤身份和实际scopeId生成内部范围身份；PricingService调用/公共API结构不变。原拟priceScope.findMany include versions take1实测SQL先读全部历史，已拒绝，失败日志/tmp/procurex-price-read-focused.log保留。新增实际DB SQL边界/历史未来/同时间revision测试，最终178单元/730完整集成/92小程序/21Web/18负载保护及build/契约静态/diff通过。无诊断run e0d8eb45-eebd-44d4-914a-94add831218e：200档5309成功/0错误/691在途满/迟到0，稳态174.35、p95 763.36ms，含预检7110资金/唯一ID/明细/流水/20门店对平及精确重放PASSED，CAPACITY_NOT_MET/cleanup PASSED。最新manifest为该无诊断复测，旧f68293e8诊断报告已归档。API3114最终构建运行会话90085、日志/tmp/procurex-price-read-api.log，health ready reachable；负载容器无残留，不重播种。NEXT优先兼容证据/本地交接缺格，C3真实窄屏；不要继续无新证据的微调或重做已通过财务/履约。200未达作为容量风险明确保留，正式资源仍需复验，不签收C8或放宽目标。6/9不变。

2026-10-06最新接续（覆盖下方历史NEXT）：C8独立生成器+数据库诊断完成。脚本order-load-generator.mjs通过内存IPC接收随机令牌，run-order-load-generator.mjs等待子进程退出/150秒超时回收；guard拒绝共享3114/3000/远程/错误路径及非法库/文件根。无诊断run-e1594aa4-a0c4-40ec-899a-45834e175924.json：200档167.6稳态/5078成功/922在途满丢弃/调度迟到0，含预检6879资金/精确重放通过。当前manifest为诊断f68293e8-b062-4941-b2e6-60ed6fa480b8：160.9稳态/4927成功/1073在途满/0错误，含预检6728一致性/cleanup PASSED；两者均CAPACITY_NOT_MET，不能签200通过。ops:order-load -- --diagnostics只记录Prisma模型操作耗时及500ms连接采样，不保存SQL参数/令牌；查询计数不是SQL条数。200档会话读取均值349.61ms、目录8.85ms、最多10事务内ClientRead，指向池争用/事务占用，未证明纯数据库瓶颈或增加连接有效。NEXT按热点减少事务重复读取/往返（保留锁/版本/原子/资金/原键检查），再无诊断同档复测；兼容/C3真实窄屏/C9仍需完成，不重复恢复/10万行/财务业务。业务服务本轮未改，729集成为上一批通过基线；API3114仍健康，两次负载容器已清理。6/9保持，详见local-operations-acceptance.md及本轮日志。

2026-10-06最新接续（覆盖下方历史NEXT）：C8真实储值下单30秒10/50/200 QPS负载已执行。修复命令事务中的预览另取连接池导致饥饿：PurchaseRequestsService.create将预览放在共享价格/目录锁后并传tx，preview/catalog/pricing/单位/账户/terms均复用tx；单连接池下单及精确重放回归通过。最新manifest CAPACITY_NOT_MET，但6132请求/明细/流水、20门店余额及原键重放一致性PASSED，接口错误0/PROCESSING0/cleanup PASSED。200目标仅137.8稳态QPS、1669未发出，不能改门槛签收；10/50全通过。npm run ops:order-load创建专用随机容器/回环动态端口/load_acceptance/私有临时文件，不能使用业务55438；14防护及指标测试通过。前两次失败报告归档，第一次响应字段断言错，第二次旧后端连接池饥饿；不得释放旧未知命令、重播种业务库或把同进程30秒测量当生产容量。NEXT拆分负载生成进程以定位容量、保留200目标及资金/原键核对，然后兼容/C3真实窄屏/C9。6/9不变。完整测试和运行时状态见development-log.md本轮节。

2026-10-06最新接续（覆盖下方历史NEXT）：C3价格发布/重算丢响应原键恢复9图、三工作台多角色导航6图全部复核，两个新组PASSED，价格夹具cleanup PASSED。门店未绑定永久骨架已修复为明确提示、禁搜索和无订货栏；多角色演示账号无自身绑定，不签跨范围业务。92小程序/静态、21防护、12证据测试通过。mini:visual-evidence现在默认核对9组90张及新组review.json的当前manifest/图像hash，C3只剩实际窄视口。NEXT真实窄屏（现有CLI全列表无切换工具，不能mock）及C8持续负载/兼容、C9最终交接；不要重复9/6图或图片链。capture-native-profile-prices.mjs --prices-only与capture-role-ui-evidence.mjs --navigation-only必须串行；重拍须更新真实复核hash。旧native-profile-price-evidence仍0图NOT_VERIFIED；三次价格运行前两失败清理通过并留failed，最后成功。日志/tmp/procurex-native-price-recovery-verified.log、/tmp/procurex-native-multirole-navigation-reviewed.log。6/9不变，无API/迁移/生产/提交变化，详见local-native-visual-acceptance.md最新节。

2026-10-06接续：C3最终证据映射落地，mini:visual-evidence实际核对7组75张JPEG/非空白/哈希通过。var/native-visual-acceptance/manifest.json明确OPEN及三项缺口；历史主流程只映射不称当前UI重跑，价格恢复功能PASSED但0截图/NOT_VERIFIED保留。NEXT真实窄视口、多角色导航复核、价格发布恢复截图，不重做75张/商品图片。详情local-native-visual-acceptance.md表格，6/9不变；检查器只读证据、不连业务库。

2026-10-06最新接续：C3真实商品图片链路已补，product-media-evidence 5图PASSED/cleanup PASSED；原生crop上传保存、800x800/5911字节真实下载/非空、编辑器及门店实际显示验证。独立前缀临时商品/模板项/两个文件ID及私有文件清理，正常会话/创建审计保留；无订单/价格/金融变更。媒体脚本加local-fixture-guard及已验证工具保护，19保护/91功能/静态通过。NEXT只剩C3窄视口、多角色布局和主流程/价格恢复最终映射，不重做图片/入口；CLI现有viewport/open_page参数没有尺寸切换，不能mock宽度签收。详情local-native-visual-acceptance.md；6/9不变，C8/C9开放。复现媒体脚本须.env与API私有文件根一致、所有原生采集串行，默认3114。

2026-10-06最新接续：商品/档案/快速改价正式入口和空/模拟加载错误状态已真实采集19图，三个入口缺失error-banner样式已用现有error-message补齐，修复后错误态3图全部查看；两个manifest PASSED。91功能/静态/语法/diff通过。脚本capture-native-entry-visuals.mjs与--errors-only，默认3114，只读现有数据、不种fixture/保存商品/发布价格。现有商品无imageFile，图片NOT_AVAILABLE；不要把图片入口或页面模拟故障当实际图片/网络验收。NEXT实际图片、窄视口、多角色布局和主流程/改价恢复最终映射，不重复19图。旧profile-price NOT_VERIFIED保持原义；新证据在native-entry-visual-evidence/native-entry-error-evidence。C3/C8/C9开放，6/9不变，详见local-native-visual-acceptance.md。

2026-10-06最新接续：本机微信开发者工具可用，C3已实际采集role16图、门店14图及独立压力1图，manifest均PASSED；旧门店大金额图不采用，正确压力图在store-layout-stress-evidence。工具加限流间隔/临时文件完整响应/项目重开关闭图片覆盖/setData与真实displayPrice断言，脚本必须串行。多角色账号系统栏是合法角色切换，不要无条件隐藏；本轮试加逻辑已撤回，页面业务行为保留。91小程序测试/静态通过，API3114健康，未重播种或创建业务单。NEXT只补C3商品/档案/改价、图片、加载/失败/窄视口、多角色导航及最终映射；native-profile-price-evidence visualAcceptance仍NOT_VERIFIED。C8持续负载/兼容及C9仍开放，固定6/9。详见local-native-visual-acceptance.md，不重复这批已采集主工作台。

2026-10-06最新接续：四个显式fixture种子已加local-fixture-guard，17纯函数/子进程测试通过；只允许回环、显式端口、procurex/drill_source/drill_restore且非production。初始化只读检查正确统计PAYMENT，dataOrigin标明未核验来源及已知夹具生产阻塞；LOCAL_READY只库存/非负值，不是流水或客户期初对平。完整ops:restore-drill及cleanup PASS，16恢复测试PASS；最新规模查询2781.55ms/导出3532.18ms。NEXT持续负载、兼容、C3原生视觉、C9交付及客户期初来源核验，不能重做演示库存充当完成。运行ops:fixture-test复现保护；生产本地转发不由URL保护识别，不使用演示种子初始化客户数据。当前6/9不变，见local-operations-acceptance.md。

2026-10-06最新接续：C8单次100000行profit查询/异步CSV实际下载已通过，规模脚本check-isolated-scale.mjs由ops:restore-drill在独立恢复库执行。查询2696.18ms、完整导出3475.82ms，100000唯一订单、23700142字节及每行金额/范围校验通过，原恢复/小样本并发/报表/通知/cleanup同时PASS。16防护测试包含规模脚本拒绝业务库/远程/共享端口/非演练根/共享文件。不要重做同一规模或声称持续200QPS/p95完成。NEXT持续负载、初始化/演示隔离映射和兼容，再C3/C9；整项6/9不变。参考local-operations-acceptance.md及manifest.scaleAcceptance。

2026-10-05最新接续：C8小夹具固定并发及实际CSV完成时间通过，不再重复串行计时。ops:restore-drill在独立恢复库运行8组性能，10并发100列表、5并发50利润、3次真实worker及CSV下载，p95分别36.02/16.77/4521.62ms、0错误；manifest PASSED/cleanup PASSED，16防护测试PASS。旧轮询4秒小于5秒扫描已修正，10秒门槛保持。NEXT补真实规模、初始化/演示隔离映射及兼容，再C3原生视觉/C9交付。整项6/9不变；小夹具吞吐率不能写为持续200QPS或10万行验收。详见local-operations-acceptance.md。

2026-10-05最新C8运营增量（覆盖下方旧优先级）：真实隔离恢复和当前通知/报表验收已通过。专用临时PostgreSQL两库、回环动态端口、私有临时根目录；空源库62迁移，真实HTTP300+700采购、收货、充值1000、清账300、供应商付款240及四张私有图片。pg_dump与文件备份后销毁隔离源库/源目录，在0表目标恢复；全部public表行数/内容哈希（含会话/命令/审计/冻结快照）与检查点相同，备份后探针不出现。恢复后账户余额1000/未清700/累计1000/可用1300、原单COMPLETED和付款CONFIRMED/应付0，原清账键精确重放无资金/文件/审计重复。自身图片下载及外店/付款方向拒绝、真实通知保留通过。本地恢复1108ms、故障时手动备份龄165ms，不冒充生产定时备份RPO/WAL/OSS/旧版本应用回退。恢复库内单独PXRPT的R01-R05/CSV/过期导出恢复/失败重试10项与通知自身已读/外人404/提醒去重通过；现有共享业务库未重置。新增ops:restore-drill/ops:restore-test，实际恢复报告var/ops-restore-evidence/manifest.json PASSED/cleanup PASSED，原m6:rollback-check现要求真实报告及迁移/清理/哈希/测量匹配才LOCAL_READY。16隔离/证据门槛测试、build/176单元/21Web/契约/静态/diff通过；728集成/91小程序沿用此前基线，未重跑完整DB集成。所有演练容器/私有临时目录已回收，API3114/Web4173保持。C1/C2/C4/C5/C6/C7仍6/9，本地L4/L5/L6仍3/7；C8剩实际规模/并发/导出完成时间、兼容及初始化/演示隔离最终映射，不能拿两单夹具声称200QPS/10万行达标。NEXT只补这些C8缺格，再C3真实原生视觉和C9干净复现/最终交接；不重新开发已签收业务与财务。详见local-operations-acceptance.md；日志/tmp/ops-restore-final-complete.log、/tmp/ops-restore-complete-tests.log、/tmp/ops-restore-complete-readiness.log。M4 OPEN/M6 NOT_READY，生产4包仍未签收，无新生产/真机/OSS/银行/提交。

2026-10-05最新C4/L4签收（覆盖下方旧优先级）：四结算模式全页面联合28步骤45图PASSED，图片齐全/errors=[]/四组cleanup PASSED。隔离主数据/初始共享价/空账户为夹具；充值或额度、下单/审核、发货/凭证收货、适用清账或付款及确认、历史核价发布执行和新单全部正式UI，无预置业务付款。实际确认付款形成冻结快照1/1/2/1，原已完成单、申请已付、付款/分配、资金及清账项逐字段不变；未完成单与新单采用新价。储值余额924，挂账未清52/累计76（含后续两笔26，原24已清），两账期账户0；储值/挂账无重复公司收款，直结排除公司三账单。最终四模式再跑PASS；原Web57步129图兼容复验PASS。构建/176单元/21Web/契约/静态/diff通过；728集成/91小程序沿用上一批基线，本批无业务服务/迁移变化，不宣称重跑完整集成。62迁移/API3114 session93191数据库健康/Web4173保留；SMJ179120门店/供应商/商品/用户0，私有夹具文件清理。固定C1/C2/C4/C5/C6/C7为6/9，本地L4/L5/L6为3/7；剩余C3/C8/C9，M4 OPEN/M6 NOT_READY，生产4包仍未通过。证据finance-acceptance-matrix.md及var/settlement-mode-journeys/manifest.json，日志/tmp/settlement-mode-final-complete.log、/tmp/settlement-mode-compat-browser.log。NEXT C8隔离本地实际DB/私有凭证备份恢复、通知/报表/租约及可复现规模证据，原check-m6-rollback仅政策与迁移检查不能冒充演练，初始化旧演示库盘点不能替客户签字。C3开发者工具视觉仍须真实截图，C9最后干净复现/交接；不重做已签收C4或追加功能。无新真机/OSS/银行/生产/提交。

2026-10-05当前最终基线（下方此前优先级为历史）：C4上海零点AC-09和精确采购清账AC-E05已通过。四模式×共享/模板8项真实HTTP，应用Date控制23:59:59.999/00:00:00.000/00:00:00.001；不修改OS/数据库时钟。真实采购服务创建/确认300+700，清账300后未清700、可用1300、累计1000；5数据库场景及正式财务5图/私有图片下载通过。补独立creditCumulative和BOOKING/RELEASE/CLEARING流水，确认不重复累计、清账/撤销/减量/少收不减累计；旧账户null显示历史未核定、不伪造历史。62迁移。最终build/728完整集成/176单元/91小程序/21Web/schema/契约/静态/diff通过；独立Web57步129图PASSED、无页面错误、清理PASSED。财务矩阵69项；读权限36入口/432基础检查。前次夹具日期过期及并行价格锁超时已定位、修正测试并独立重跑；不能把失败运行当通过。API3114 session93191数据库健康，Web4173保留。固定C1/C2/C5/C6/C7关闭5/9，本地L5/L6为2/7不变；C4/L4仍因其余模式正式付款/冻结已付联合链开放。NEXT只补储值/挂账/直结适用渠道全页面联合链，不重做午夜/精确清账/69矩阵。随后C3原生视觉、C8运营复现、C9最终交接；M4 OPEN/M6 NOT_READY，无新真机/OSS/银行/生产或提交。证据finance-acceptance-matrix.md、var/credit-occurrence-evidence/manifest.json，日志/tmp/finance-final-integration-serial.log、/tmp/finance-final-browser-serial.log。

2026-10-05最终签收（以下旧优先级均为历史）：C6权限隐私、C7遗留与安全恢复已通过，L5/L6通过，本地2/7；固定C1/C2/C5/C6/C7关闭5/9。修复10动作成功缓存重放绕过当前资源范围，14角色/动作组合改绑404、恢复范围精确重放、原命令不变且无新增审计。68业务写/预览路由完整Nest元数据合同、724次HTTP未登录/越角色/缺范围/错范围拒绝及无副作用；新增付款方向/私有附件真实HTTP，总部财务按原需求§2.3跨门店只读申请/订单/发货，采购/履约写仍403。27未知/历史命令边界HTTP通过：过期/审阅不解除原命令、价格专用关闭不可用于非价格或无合同资源，诊断脱敏、原键仍阻止执行。操作合同及冻结交接见command-recovery-runbook.md；无键无精确恢复、旧可省略附件兼容不伪造历史。最终build/715集成/172单元/91小程序/21Web/契约/静态/diff通过，最终Web57步129图/同单链PASSED、browserErrors=[]、清理PASSED。RPM/WPM/UCB门店/供应商/商品/用户0；61迁移无新增，API3114 session32717健康，Web4173保留，全部测试/临时浏览器已结束。日志/tmp/write-recovery-*.log。剩余固定C3/C4/C8/C9；NEXT C4其余适用模式正式付款/冻结已付联合链、AC-09午夜、AC-E05原1000/300采购凭证来源，不重做C5/C6/C7或56财务矩阵。C3原生视觉和生产/真机/OSS仍未通过，M4 OPEN/M6 NOT_READY。

2026-10-05本批最终验证：付款方向保护后的正式API3114独立浏览器重跑PASSED，57步129图、browserErrors=[]、fixtureCleanup PASSED；包含公司账期同单跨角色链、两侧付款及拒单改派。此前一次改派字段超时不再作为最终结果，未放宽页面或业务断言。RPM/APQ门店、供应商、商品、用户均0；临时浏览器容器停止，API3114/Web4173保留。完整682集成/168单元/91小程序/21Web及构建/契约/静态通过，git diff --check通过。无新迁移、真机、银行、OSS、生产或提交证据。

2026-10-05最新：C6/C7权限隐私与遗留事务保护已交付本批子项。6角色/35读入口含缺失、错误及有效范围矩阵；门店目录/采购/发货成本投影保留双价格版本批准及原键重放；供应商报表/CSV改为服务端采购金额口径，历史销售口径缓存拒绝，缺日期历史订单不伪造日期。付款方向及私有附件补反向保护。四个可省略幂等键的旧价格/采购编辑入口业务与审计同事务，新增48四模式成功/审计失败/连接终止用例；不生成假键，不承诺无键丢响应精确恢复。最终build/682集成/168单元/91小程序/21Web/契约/静态通过，无新迁移仍61。C1/C2/C5关闭3/9，C6/C7本批子项通过但整项OPEN，本地整包仍0/7，不换算代码百分比。下一补C6写动作权限拒绝矩阵与C7遗留/未知结果交接，随后C4明确剩余财务案例；不重复本批事务测试。C3真机视觉/C8/C9及生产域名/OSS仍开放，M4 OPEN/M6 NOT_READY。详见privacy-legacy-acceptance.md。最终API3114健康、Web4173保留；浏览器最终重跑结果见下方最新记录。

LATEST MASTER DATA AUDIT ACCEPTED:27 existing HTTP writes across category/unit/brand/product/conversion/supplier/products/archive/template/copy/archive/bindings/settings/store/user now supply authenticated audit context to auditedMasterDataTransaction with existing business locks. Audit record uses same tx; safe result/version/count/resource projection only, no bank/contact/remark/password/file snapshots. Internal standalone calls without context preserve compatibility, not fabricated actors or global CLI audit. User update has conditional version write and scope upsert same tx; concurrency200/409.54 focused real HTTP cases PASS (success + audit inserted then thrown for every entry, finance403, body identity spoof, snapshots rollback, stale versions, user race). Full628 integration/158 unit/91 mini/21 Web/build/contract/static/diff PASS. MDA stores/suppliers/products/templates/users0;48 first failed cleanup fixtures removed by exact dated prefix range. All test sessions ended. API3114 final audit build session85919 ready, old47477 stopped;Web4173 session54478 HTTP200.61 migrations/no browser/device/OSS/production evidence. C1/C2/C5 closed3/9, local0/7, M4 OPEN/M6 NOT_READY. NEXT C6 full permission/privacy matrix and C7 legacy/headerless protection; do not repeat delivered master-data audit/proofs/calendar. Remaining C4 formal-payment/frozen/midnight/AC-E05 source scenarios unchanged. See master-data-audit-acceptance.md; older NEXT entries are historical.

LATEST FINANCIAL CALENDAR ACCEPTED: build/574 full integration/158 unit/91 mini/21 Web/contract/static/diff PASS. Added3 direct-template price cases (15 total) and8 four-mode calendar cases. Focused23 PASS, financial matrix56. Fixed first-shipment period through6+4 replenishment, ordinary vs historical prices, two-store total/sub-bills, account balances/credit, receipt quantity/profit/freight and report completion-date vs first-shipment-date match. Historical requests/orders/dates are isolated fixtures, not UI/real-clock/device evidence. SPM/SCC stores/suppliers/products0. Logs /tmp/financial-closure-*.log and /tmp/financial-calendar-focused.log. No business code/migration/runtime change;61 migrations/API3114 account-proof session47477 ready/Web4173 retained. All test sessions ended. NEXT C5 transactional master-data write audit; do not repeat accepted template/calendar subitems. Remaining C4 formal payment/frozen-source, AC-09 midnight and AC-E05 exact source examples in finance-acceptance-matrix.md. C1/C2 closed2/9/local full packages0/7, M4 OPEN/M6 NOT_READY. Older NEXT entries below are historical.

LATEST ACCOUNT PROOF ACCEPTED:61 migrations/new20261005120000_account_document_evidence; FileObject rechargeId/clearingId FKs and single-document CHECK, no old backfill. RECHARGE/CLEARING purpose central-only/image-only. Stores service optional actor/evidence binds owned READY unused files conditionally in funds/command/audit tx; controller uses auth actor, optional body IDs1..5. Old omitted-ID calls preserved (C7 OPEN), current formal Web requires upload. Scoped GET stores/:id/recharges|clearings/:documentId returns projected files/operator displayName fromaudit/date/account. Account ledger opens readonly document/download. Newworkspace-account-evidence.js upload/retry helper; capture-finance-accounts updated for proofs/cleanup.21 DB PASS +563 fullintegration/158unit/91mini/21Web/schema/contract/static/diff. Finalaccount browser7images PASS/cleanup PASS, APE/PXFIN stores/users0. FinalAPI3114 session47477 ready, Web4173 unchanged. All test sessions and browser46383 stopped; do not redo proof. NEXT C4 remaining direct-template/time/period/financial matrix gaps then C5audit; C1/C2 closed2/9/local0/7. Native/OSS/production gates unchanged. First cleanup failure42 ownfixtures removed with strict dated regex; final full pass supersedes failed563 run.

LATEST C2 ACCEPTED: scripts/capture-cross-role-journey.mjs integrated before purchaserRepair in capture-web-workspace. Exact COMPANY_TERM order all formal UI writes: Store create, Purchaser confirm, own Supplier ship, Store receipt/proof, StoreFinance payment register, HQ_FINANCE collection confirm/supplier payment, own Supplier confirm. Readonly GET statement lookups and DB assertions only; fixtures master data/accounts reuse. Final57 steps129 images PASS/all files/no pageerrors/cleanup PASS. C1+C2 closed2/9, local0/7. NEXT C4 confirmed AC-24/AC-E05 recharge/clearing private proof: current controller/service inputs/schema lack file relation. Implement scoped ownership/READY/purpose association with atomic funds/audit and formal UI, preserve old unknown proof. Other finance matrix/native/audit/legacy gaps remain. Browser sessions60025 first assertion failure,90097 finalPASS,68354 stopped; temporary Docker container removed. API3114/Web4173 unchanged. Do not repeat C2 or claim four-mode/device completion.

LATEST EXECUTED October5: C1 delivered all40 AC and DEV mapping in requirement-delivery-map.md; closure1/9, local full packages0/7. Finance45/45 rerun PASS (29+16, /tmp/delivery-finance-matrix.log and delivery-finance-extra.log); applicable matrix in finance-acceptance-matrix.md. Current API3114 Web51 steps121 screenshots PASS/files all present/cleanup PASS/no pageerrors. Native visual unchanged. NEXT implement same-order all-formal-role Web journey (existing capture includes API precursor steps and cannot close C2), then C4 explicit gaps including direct template prices and recharge/clearing proof fields. Existing Mac Chrome abort recovered using temporary Docker Chromium; container stopped, sessions99922/42996/33117/3256 all ended. No business code/build/runtime change. Do not redo whole accepted financial backend.

LATEST evidence inventory: read delivery-closure.md for finite C1-C9 queue. Local full-package accepted0/7, partial evidence7/7; not a code percentage. Web actual manifest51 steps121 screenshots all files present/cleanup PASSED, native profile-price visual NOT_VERIFIED/screenshots0. Confirmed code gaps: master-data write audit and headerless pricing bypass. NEXT complete C1 DEV/AC mapping, C2 formal same-order cross-role journey and C4 applicable finance matrix; reuse existing evidence and fix actual blockers. No code/browser execution this inventory batch. Do not return to open-ended backend-first work.

USER PRIORITY OVERRIDE October5: read completion-standard.md first. User requested a finite definition of done after concern about endless development.7 local/4 production acceptance packages fixed; next map existing evidence and actual blockers against L1-L7, then formal cross-role flow/financial acceptance and necessary fixes. Do not default to another open-ended backend batch or claim a completion percentage from542 tests. Older NEXT BATCH instructions below are historical, not current priority. Required audit/privacy/legacy recovery still must pass; local completion and production dependencies are distinct.

CURRENT: October5 remedies accepted, build/158 unit/542 full integration/91 mini/21 Web/contract/mini-web static/diff PASS;137 new DB tests. Freight create/confirm/reject, supplier reject/funding and discrepancy ACCEPT/REPLENISH/RETURN use performAtomic and explicit service tx. Freight review locks before reading version; funding FAILED replay throws original error. Paid CREDIT refusal preserves actual clearing/payment history and creates negative adjustment without stored-balance refund. APQ stores/suppliers/products/users/files0. API3114 final remedy build session54157, log /tmp/procurex-api-3114.log, readiness database reachable; Web4173 session54478 HTTP200. Supersedes405/pending-remedy/runtime73709 notes below.60 migrations/M4 OPEN/M6 NOT_READY.

NEXT BATCH: inspect legacy/headerless entry points and master-data audit coverage, establish required/optional key contracts per action, then implement only confirmed remaining permission/privacy/recovery gaps with focused tests. Catalog/template/supplier controllers currently delegate to transactional services without command/audit wiring; inventory this boundary rather than assuming it is covered. Do not reopen delivered procurement, price, shipment/receipt or remedies. Do not use price-only manual closure for other commands. Native visual/device, genuine OSS and production/domain/release acceptance remain separate open gates. This batch added no UI, role-HTTP, OSS or device evidence.

Final atomic fulfillment acceptance: build158 unit/405 full integration/91 mini/21 Web/contract/mini-web static/diff PASS;51 new shipment/receipt cases. APQ stores/suppliers/products/users/files all0. API3114 final fulfillment build readiness database reachable, Web4173 HTTP200, superseding previous runtime/counts. Next freight request/review, supplier rejection/funding reconcile and discrepancy resolution transaction boundaries, then remaining legacy/native/release gates. Do not redo accepted shipment/receipt atomics or reuse price-only manual closure for them.60 migrations/M4 OPEN/M6 NOT_READY; no new UI/device/OSS acceptance.

Latest atomic fulfillment implementation: supplier-order.shipment.create and shipment.receipt.create use performAtomic, explicit tx through services/business/funds/evidence/discrepancies/notifications/result/audit. Standalone services retain own transaction; scope/preview reads followed by original locked version checks.51 new DB cases (48 four-mode operation/fault +2 version race +1 evidence failure replay). First replay test subclass assumption corrected to actual HttpException409/code; final regression in development-log. Next freight request/review, supplier rejection/funding reconcile and discrepancy resolution transaction boundaries. Do not redo shipment/receipt or apply price-only recovery marker to them. No migration/UI/device evidence;60 migrations/M4 OPEN/M6 NOT_READY.

Final October5 contract acceptance: generate/migrate/schema/build158 unit/354 full integration/91 mini/21 Web/contract/mini-web static/diff PASS. Contract/rollback/auth/APQ fixture users0. API3114 final contract build readiness database reachable, Web4173 HTTP200.60 migrations supersede older59; marked new price commands support locked no-commit reconciliation, old/unmarked/headerless/other non-atomic paths remain OPEN. Next legacy/non-atomic recovery coverage and native/release gates, do not redo accepted new-price contract recovery.

Latest October5 atomic price contract: migration60 adds CommandRecord.atomicPriceExecution defaultfalse, old records never backfilled. New keyed price.process sets true server-side. ADMIN keyed close-uncommitted-price locks target and requires PROCESSING/contract/action/resource, atomically writes FAILED COMMAND_NOT_COMMITTED409/audit/close result. Command row lock proves no business commit under the contract, even with no diagnostic; running execution finishes before reconciliation, committed success remains replayable and stale started handles cannot execute after closure.8 new DB tests plus actual four-mode missing-diagnostic/HTTP/native coverage. Next OLD/unbound/headerless and other non-atomic paths; do not follow older all-no-proof-pricing-blocked statements for marked records. No OS process-kill/device/visual acceptance;60 migrations/M4 OPEN/M6 NOT_READY.

Native history final supplementary verification:158 unit/diff PASS. Latest native history checkpoint below is current;346 integration remains prior backend acceptance, not new native visual/device evidence.

Latest native server-submission history: prices/index renders GET current jobs/:id/submissions time/status/redacted error labels, independent loading/error/empty/retry. loadPublished/process/recover refresh history; failures preserve run and same-run entries, changed run clears old history; generation/page/actor/task guards discard stale replies. History reads never release pending/reexecute.90 mini tests PASS (7 new), build21 Web/contract/mini-web static PASS. Backend unchanged: previous346 integration acceptance not rerun; API3114 remains accepted proven rollback build. No DevTools screenshots/visual/device evidence. Next commit-unknown/crash-no-proof/legacy and formal visual/device/release; do not redo history/recovery.59 migrations/M4 OPEN/M6 NOT_READY.

Final proven-price-rollback acceptance PASS: build158 unit/346 full integration/83 mini/21 Web/contract/mini-web static. Actual four-mode funds after audited closure/new submit and HTTP ADMIN201/replay/non-admin403/unproven409 verified; rollback/review/auth/APQ users0. Mini original-key COMMAND_ROLLED_BACK409 ends pending and displays refresh-before-submit, no automatic execution. API3114 final rollback-recovery build readiness database reachable; Web4173 HTTP200. Supersedes older no-manual-closure notes ONLY for proven price callback rollback; commit-unknown/no-proof/crash/legacy remain blocked. Next those uncovered paths and native/release acceptance, no repeat of accepted closure.59 migrations/M4 OPEN/M6 NOT_READY.

Latest proven price rollback recovery: performAtomic records COMMAND_ROLLBACK_CONFIRMED only for price.process operation callback non-HTTP rejection after transaction failure; successful callback/commit-stage failure cannot produce proof. ADMIN POST commands/:id/close-rolled-back-price (reason/key required) locks and validates target PROCESSING/action/resource/server proof, atomically marks original FAILED with COMMAND_ROLLED_BACK409 + audit + close result. Same close key replays; original business key fails, user refreshes task before a fresh keyed submission. No automatic task run/compensation.5 DB +1 unit added,16 pricing cases expanded for actual four-mode closure/reexecute/funds, actual HTTP auth/proof/unknown checks added. Next commit-unknown/crash-no-proof and legacy coverage; do not repeat accepted proven rollback branch. No migration/UI/device acceptance;59 migrations/M4 OPEN/M6 NOT_READY.

Final task-submission/review acceptance: build157 unit/341 full integration/82 mini/21 Web/contract/mini-web static/diff PASS.5 new DB cases; task history scope covered across16 price fault cases; actual HTTP ADMIN stale200/review201/replay and non-admin403 PASS. Review/diagnostic/auth/APQ fixture users all0. API3114 final review build readiness database reachable; Web4173 HTTP200. This overrides previous runtime/test counts. Next proven-outcome remediation/legacy task coverage; no manual unlock/compensation, no full execution-attempt history or visual/device acceptance. Do not redo review/history/HTTP checks.59 migrations/M4 OPEN/M6 NOT_READY.

Latest task submissions/review checkpoint: GET jobs/:id/submissions filters price.process + PriceChangeRun resource, ADMIN all task summaries/PURCHASER own only/max100; historical headerless/unbound commands not backfilled. ADMIN POST commands/:id/reviews requires original key/expectedStatus/reason, locks target and commits audit+review command response atomically, preserves original command completely and returns REVIEW_RECORDED_NO_STATE_CHANGE. Cannot review command.review (avoid mutual lock cycles).5 new DB cases;16 price cases expanded for task history/scope, auth HTTP expanded for ADMIN success/non-admin reject/replay. No migration or UI/device acceptance. Next proven-outcome remediation/legacy coverage, NOT automatic stale reset; no terminal resolution or compensation tool implemented.59 migrations/M4 OPEN/M6 NOT_READY.

Final diagnostics acceptance: build157 unit/336 full integration/82 mini/21 Web/contract/mini-web static PASS; diagnostic/APQ fixture users0. API3114 final diagnostics build readiness database reachable, commands unauthenticated401; Web4173 HTTP200. This overrides earlier runtime checkpoints. Next task-level attempt history/audited manual remediation; stale read-only query and native original-key recovery are delivered, not full reconciliation closure.59 migrations/M4 OPEN/M6 NOT_READY.

Diagnostics HTTP coverage added to auth-http: unauthenticated401/non-admin stale403/invalid limit400/own summary200 with ignored actor query and no private payload. CommandsModule imports AuthModule (first full run exposed missing guard dependency; fixed/rebuilt). ADMIN allow covered by guard unit, not new ADMIN HTTP200. Next task-attempt history and audited manual remediation; do not redo basic HTTP own/auth validation.

Latest command diagnostics: GET /commands returns authenticated actor-only redacted summaries; ADMIN-only GET /commands/stale lists expired PROCESSING (limit1..100/default50). Commands.perform unknown failures best-effort writes COMMAND_OUTCOME_UNKNOWN/observedAt only while PROCESSING, never finishedAt/status or raw exception; persistence failure preserves original exception. price.process begin binds PriceChangeRun ID. New2 unit/1 DB cases; API design documents READ-ONLY reconciliation. No migration. Next actual HTTP permissions acceptance, task-level failure-attempt history and audited manual reconciliation/remediation of old non-atomic commands. Stale is NOT proof of no writes and must not trigger deletion/reexecution/terminal overwrite; no recovery write tool implemented. M4 OPEN/M6 NOT_READY; do not claim global recovery complete.

Native recovery final additional verification:155 unit PASS and git diff --check PASS. Read latest native checkpoint next; no new Developer Tools visual/device acceptance.

Latest native price-run recovery DELIVERED: prices/index processRun uses durable purchaser roleCommand, recoverRun replays persisted original path/body/key; GET refresh never clears pending or authorizes a fresh command. api.js retains process result and definite failure code in local history, account/API scoped storage and in-flight guards unchanged.82 mini tests PASS (6 new/2 updated), build21 Web/contract/mini-web static PASS; backend unchanged, previous335 integration acceptance not rerun this batch. API3114 remains accepted price-process build. Next SERVER task-level failure diagnostics and long-lived PROCESSING reconciliation; do not follow older native-headerless/client-recovery-next notes. Local history is not server diagnostics/cross-device recovery. No migration/native screenshots/device evidence; M4 OPEN/M6 NOT_READY.

Final keyed price processing acceptance PASS: build155 unit/335 full integration/76 mini/21 Web/contract/mini-web static checks; APQ stores/suppliers/products/users all0. API3114 restarted final price-process build, readiness database reachable; Web4173/app.html HTTP200. This overrides all older runtime statements below, including the implementation-stage note. Next persisted failure diagnostics/client keyed recovery, then long-lived PROCESSING reconciliation; do not redo accepted keyed process atomicity.

Latest keyed price processing: POST jobs/:id/process with Idempotency-Key uses price.process performAtomic and explicit tx for pricing/funds/adjustments/run result/command/audit. getRun accepts tx and returns complete result before commit; success replays exactly, unknown failures remain PROCESSING.16 new DB cases cover four modes and completion/audit/connection faults. Headerless calls remain legacy; native prices processRun still headerless with GET-based uncertainty recovery. Next persist price-run failure diagnostics and add safe client recovery, then long-lived PROCESSING reconciliation. Do not declare global recovery complete or automatically rerun unknown commands. Runtime below remains previous purchase-edit build until explicitly updated.

Current runtime after purchase-edit acceptance: API3114 final purchase-edit build, readiness database reachable; Web4173/app.html HTTP200. Entry: http://127.0.0.1:4173/app.html?api=http://127.0.0.1:3114/api/v1. Older runtime checkpoints below are historical.

Final purchase-edit regression PASS: build155 unit/319 full integration/76 mini/21 Web/schema/static/contract;132 focused cases in tests/integration/atomic-procurement-commands.test.ts (74 new), APQ stores/suppliers/products/users all0. Keyed replaceItems/assign/reallocate delivered, full returned detail from same tx; do not redo them. Next processRun result/audit/failure tracing, then long-lived PROCESSING reconciliation and headerless legacy/full master-data audit/privacy/native/release. No migration (59), M4 OPEN/M6 NOT_READY.

Latest purchase editing DELIVERED at focused DB level: keyed replaceItems/assign and required-key reallocate pass explicit tx through business/succeed/audit. saveReplacement/assign/reallocate return get(request.id,undefined,tx), preserving full detail/progress/name/handled-rejection fields in original command response; do not use a root GET before commit. Prepare reads still followed by existing locked write rechecks, no ambient/nested write transaction added.74 new DB cases/132 focused PASS in tests/integration/atomic-procurement-commands.test.ts, including four modes, rejection remedy/cancel, cross-channel switch, faults/version race/legacy compatibility. Next processRun transaction result/audit/failure trace, then long-lived PROCESSING reconciliation and headerless legacy/full master-data audit/privacy/native/release. Headerless edit/assign still separate business and audit; keyless pricing legacy unchanged.59 migrations/M4 OPEN/M6 NOT_READY, no new UI/device/bank evidence. Old next-purchase editing notes below are historical; final full counts/runtime in development-log.

Current runtime after core procurement/keyed-price acceptance: API3114 latest build readiness database reachable, Web4173/app.html HTTP200. Normal entry http://127.0.0.1:4173/app.html?api=http://127.0.0.1:3114/api/v1. Older difference/payment runtime notes below are historical.

Final core-procurement/keyed-price regression PASS: build155 unit/245 full integration/76 mini/21 Web/schema/static/contract;58 cases in tests/integration/atomic-procurement-commands.test.ts, APQ stores/suppliers/products/users all0. Next actual tx-aware replaceItems/assign/reallocate (including returned details), then price-run failure/recovery and long-lived PROCESSING reconciliation. Do not repeat accepted create/confirm/reject/keyed publication. Headerless price audit/recovery remains legacy; full master-data audit/privacy/native/release OPEN.59 migrations/M4 OPEN/M6 NOT_READY.

Latest core procurement and keyed-price batch: create/confirm/reject use performAtomic and explicit tx for business, funds/splits, succeed and audit; PricingService.publishPrice accepts tx and keyed PricingController uses same tx with new price.publish audit.58 focused DB cases PASS in tests/integration/atomic-procurement-commands.test.ts, four purchase modes/three core writes plus shared/template publication, faults/race/legacy. Headerless pricing is deliberately unchanged (no keyed recovery/audit), processRun unchanged. Next purchase replaceItems/assign/reallocate: prepare/preview reads and final service.get responses need explicit tx-aware handling, not an ambient transaction or blindly nested $transaction; then price-run completion/failure tracing and long-lived PROCESSING reconciliation. Existing account/payment/difference/core-create-confirm-reject/keyed-publication routes are delivered; do not redo them or claim all purchase/pricing finished.59 migrations/M4 OPEN/M6 NOT_READY, no new role-UI/native/device/bank acceptance. Final test counts/runtime in development-log.

Final difference batch regression PASS: build155 unit/187 full integration/76 mini/21 Web/schema/static/contract,36 new cases in tests/integration/atomic-difference-commands.test.ts; ADC store/supplier/product/user/file all0. Current API3114 final difference build readiness database reachable; Web4173/app.html HTTP200, normal entry http://127.0.0.1:4173/app.html?api=http://127.0.0.1:3114/api/v1. Next purchase-request transaction boundaries (create/edit/assign/reallocate/confirm/reject) and pricing, then long-lived PROCESSING/manual reconciliation/full audit/privacy/native/release. Do not redo account/payment/difference atomics or follow their old next-task notes. M4 OPEN/M6 NOT_READY,59 migrations unchanged.

Latest difference atomics implemented and36 focused DB cases PASS: create/confirm controllers use performAtomic with tx business/succeed/audit; CREDIT disposal confirmation refreshes source-request effective payment in same tx after existing ordered account/request locks. Standalone confirm now uses its own transaction in both directions. Sources in tests/atomic-difference-commands are actual clearing+repricing and actual payment confirmation; no fake discrepancy/price source. No double credit disposal or target over-reservation under concurrency; receiver scope/direction failure is terminal without writes. Next purchase-request write and pricing publication/run atomic boundaries, then long-lived PROCESSING reconciliation/full audit/privacy/native/release. Old next-difference/account/payment instructions below are historical.59 migrations/M4 OPEN/M6 NOT_READY; no new role-UI/OSS/device/bank evidence. Final test counts/runtime in development-log.

Current runtime: API3114 restarted with final payment build, readiness database reachable; Web4173/app.html HTTP200. Normal entry http://127.0.0.1:4173/app.html?api=http://127.0.0.1:3114/api/v1. Older account-build runtime notes below are historical.

Final payment batch regression PASS: build155 unit/151 full integration/76 mini/21 Web/schema/static/contract;52 payment DB cases, APC and interrupted CCF fixture cleanup checked. Next difference-disposals create/confirm atomic business/command/audit, then purchaser/pricing and long-lived PROCESSING reconciliation. Older next-account/next-payment instructions are historical; do not redo those routes. M4 OPEN/M6 NOT_READY,59 migrations.

Latest payment-record atomicity DELIVERED at focused DB level: four controller writes use performAtomic and explicit tx business/succeed/audit; service standalone callers retain independent transactions. Confirmation snapshots/overpayments and allocation transitions are included. Proof files are linked with conditional updateMany(owner/READY/PAYMENT/paymentId:null), exact count required; losing concurrent payment rolls back and fails without stealing proof.52 DB cases PASS, tests/integration/atomic-payment-commands.test.ts; final regression counts/runtime in development-log. Next difference-disposals create/confirm (currently separate business/command/audit commits), then purchase/pricing writes, long-lived PROCESSING reconciliation and master-data audit/privacy. No new migration/UI/native/device/OSS/bank acceptance,59 migrations/M4 OPEN/M6 NOT_READY. Old next-payment instructions below are historical; do not repeat account/payment atomicity.

Current runtime after final account acceptance: API3114 latest final build, /api/v1/health/ready database reachable; Web4173/app.html HTTP200. Normal entry: http://127.0.0.1:4173/app.html?api=http://127.0.0.1:3114/api/v1.

Final account batch verified: build153 unit/99 full integration/76 mini/21 Web/schema/static/contract PASS; ATC stores/users/commands/audits all0. Read the account atomicity checkpoint immediately below before old refusal instructions. Next implement payment-record atomic business/command/audit writes, not account rework. M4 OPEN/M6 NOT_READY.

October4 account atomicity checkpoint: CommandsService.performAtomic executes with explicit tx, locks/reloads CommandRecord, requires SUCCEEDED before commit and replays terminal success without executing twice. StoresController recharge/credit-limit/clearing passes the same tx to business service, commands.succeed and audit.record. Credit-limit service also locks existing account/version and preserves missing-account404. fail only changes PROCESSING, never a completed response or original terminal error. Tests: atomic-store-commands.test.ts (14 DB cases, including pg_terminate_backend before commit) plus commands terminal-state case; final counts/runtime in development-log. No migration or UI evidence. Next actual atomic integration for payment-record create/confirm/reject/cancel; then difference-disposals and purchase/pricing controllers (still separate business/succeed/audit transactions). Do not claim global crash recovery: unknown failures remain PROCESSING, no automatic expiration/reexecution/manual reconciliation yet; keyless pricing and full master-data audit/privacy remain open. Keep M4 OPEN/M6 NOT_READY. Do not redo the delivered account or refusal/reallocation branches.

Latest refusal batch runtime verified: final build running at API3114 (/api/v1/health/ready database reachable), Web4173/app.html HTTP200; RJF/CCF isolated store/supplier/product counts all0. No reseeding of existing business data. Read the newest checkpoint first; older entries below are historical, not current next actions.

Latest October4 paid-credit supplier refusal DELIVERED overrides older refusal-guarded/58-migration instructions. Rejection produces explicit sourceRejectedOrderId negative STORE credit from actual clearing/effective payment less existing pending credit; retires original allocation without erasing netPaid/ClearingItems or refunding stored balance. Purchaser reallocate(cancel:true), same/new supplier and COMPANY_TERM replacement verified. CREDIT replacement has new funding and limit checks; payment summaries exclude retired orders, and confirmed return/offset never pays the new order. New migration20261004110000_add_rejected_credit_adjustment_source deployed (59 total); ORDER_REJECTION read view uses existing disposal APIs. Build153 unit/84 integration/76 mini/21 Web/schema/static/contract PASS,20 focused financial cases (8 new refusal cases), exact failed-run fixture cleanup completed. Next audit/privacy and business/command crash reconciliation, then native visual/device and release evidence. M4 OPEN/M6 NOT_READY; not arbitrary paid-order cancellation or new bank/role-UI acceptance. Do not repeat delivered refusal/reallocation work. Tests: tests/integration/rejected-credit-funding.test.ts and cleared-credit-funding.test.ts; entry remains Web4173 with API3114.

Latest October4 reincrease DELIVERED overrides older guards-as-unimplemented instructions. loadFundingPaymentStates subtracts only CONFIRMED negative STORE price/shortage disposals from gross CREDIT netPaid; pendingCredit excludes confirmed amount. refreshRequestPaymentSummary reused by clearing and transactional receiver confirmation; synchronizeRequestFunding/shortage use effectivePaid. After paid120/confirmed refund or offset20, summary100; reincrease120 books20, clear20 gives summary120/gross140; next decrease110 creates10. Pending/partial disposal still409, confirmed sources unlock repricing; insufficient credit limit rolls back source/order/funds.153 unit/76 full integration/76 mini/21 Web/static/contract PASS,12 financial cases incl partial/concurrent confirmation and CCF cleanup. Next paid-credit supplier refusal/cancel/reallocation (currently guarded even if refunded; do not erase gross paid history), then audit/privacy/crash/native visual/release. No migration or new bank/role UI/device evidence; M4 OPEN. Do not redo reincrease reconciliation or treat pending-disposal protection as missing all-confirmed support.

Latest October4 cleared-credit historical-price decrease delivered: matching price source and actual ClearingItems generate only incremental excess-paid STORE documents, retaining netPaid/clearing. Added priceAdjustmentId internal funding option in worker and frozen completion checkpoint. Negative CREDIT STORE frozen documents skipped there to avoid fictional/duplicate credit. Price credit IDs stay individually actionable in adjustments list/get; existing non-CREDIT netting retained.145 unit/75 integration/76 mini/21 Web/static/contract PASS,11 focused cases/CCF cleanup PASS. Tests cover130→110 releases10/credit10,110→100 adds10, frozen supplier snapshot, receipt completion, offline return/offset, replay, reincrease rollback. Next implement reconciled reincrease after negative credit (current CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED intentionally blocks), then paid-credit refusal/reallocation/cancel without reusing refunded money. M4 OPEN; no new migration, UI screenshots/device/bank or crash acceptance. Do not redo negative-price decrease or mistake the guard for completed reincrease support.

Runtime after restored-DB acceptance: API3114 restarted from final build, readiness database reachable; Web4173/app.html HTTP200. This supersedes prior no-rollout notes. Normal entry remains http://127.0.0.1:4173/app.html?api=http://127.0.0.1:3114/api/v1.

Latest October4 DB acceptance PASSED supersedes restore-DB/retest-before-delivery instructions below. Docker/PostgreSQL restored; six cleared-credit cases and70 full integration PASS, build144 unit/75 mini/20 Web/static/contract PASS. Actual shortage after paid120/target130 creates16 credit and releases10; paid120/target120 shortage96 creates24. Offline return/company-term offset and recipient scope/repeated handling/documented funding resync verified; clearing history/balance unchanged. Legacy CREDIT frozen snapshot without payment does not create a refundable STORE shortage document. CCF cleanup checked. Next independent cleared-credit historical-price decrease/refusal flows, then audit/privacy/crash reconciliation/native visuals/release; full M4 OPEN. Tests are DB/services, not new role UI/device/bank evidence; no migration. Do not repeat accepted-shortage implementation or treat prior environment failure as current blocker.

Latest October4 IN-PROGRESS cleared-credit shortage batch: adjustAcceptedShortage releases unpaid credit and creates only newly overpaid STORE adjustment; netPaid/clearing unchanged, no balance refund. Existing difference-disposals handles offline return/company-term offset. synchronizeRequestFunding accepts documented existing shortage excess only with nondecreasing target and sufficient sourceDiscrepancy STORE documents. Price decreases/refusal still guarded. Payment status refresh includes all effective freight. Build144 unit/75 mini/20 Web/static/contract PASS; real-DB acceptance NOT_VERIFIED: PostgreSQL55438 unreachable, Docker socket missing, Docker app could not launch. First next action: restore Docker/local DB without reseeding existing data; npm run db:up; npm run build; node --env-file-if-exists=.env --test --test-concurrency=1 dist/tests/integration/cleared-credit-funding.test.js (6 cases); npm run test:integration; check CCF cleanup. Do not claim six/full integration PASS or deploy current funding changes until verified. Previous API build/evidence is not rerun. Then complete remaining negative-price/refusal flows, audit/crash/native visual/release; M4 OPEN.

Latest October4 clearing-summary checkpoint: immediate createClearing request paidAmount/paymentStatus refresh is implemented, superseding the next-summary task below. Account then sorted affected-request locks precede writes; summary aggregates valid allocations and effective freight without synchronizeRequestFunding. Real120 clearing PAID120, target130 UNPAID120, final10 PAID130; identical concurrent clearing must yield one success. Web/mini Chinese blocker remains definite failure. Next independent negative settled-credit adjustments, then audit/privacy/crash reconciliation. Full M4 OPEN; do not repeat summary work or claim visual/device acceptance.

Latest October4 funding checkpoint supersedes active-only allocation assumptions. requestFundingWhere includes inactive CREDIT only with netPaid>0 and actual ClearingItems; pricing runs, completion checkpoint and shortage share it. Real clearing120, repricing130, second clearing10 preserves original paid history and same allocation. Lower-than-paid repricing/shortage/refusal are guarded, not implemented settlement adjustments. New isolated tests: cleared-credit-funding.test.ts (4 cases) and settlement-price-matrix.test.ts (4 modes x3 effective-time cases), cleanup in finally. Next review requirements for independent settled-credit negative adjustments and immediate createClearing request payment-summary refresh; then master-data audit/privacy/command-crash reconciliation. No new schema, no visual/device acceptance, no full M4 closure. Keep prior native screenshot gap and7 categories explicit.

Latest October4 native own-profile/rapid-price checkpoint overrides "implement native profile/catalog/quick pricing next" below. Native pages profile/index and prices/index are implemented and actual Developer Tools functional run PASSED/cleanup PASSED: Supplier right-top 我的→own readonly banking/catalog/supply price/search; Store 我的→门店资料 with independent receipt fields; Purchaser right-top 改价→shared/template choices and active associated product/supplier, readonly template cost, effective date/time/reason, real impact/recheck/publish/version/run. Published response loss survives page navigation with same key and exactly one template version; run response loss requires GET refresh and one adjustment. Template14 goods28/cost20, shared cost9 gives goods28/cost18 and ledger0.140 unit/52 full HTTP/74 mini/19 Web/static/contract PASS. POST price-changes honors provided idempotency key through Commands.perform; headerless existing callers remain unchanged, not global protection; native history retains actual result for restoration. var/native-profile-price-evidence/manifest.json status PASSED is FUNCTIONAL ONLY: visualAcceptance NOT_VERIFIED/screenshots[] because simulator_screenshot repeatedly timed out; no new screenshots, genuine photos, bank/device/all-mode funding acceptance. First script failures (cleanup relation/order identity, native navigation timeout) fixed and isolated fixtures cleaned, no existing data rewritten. API3114 latest; Web4173 remains. To reproduce with IDE screenshot service available: npm run mini:capture-profile-prices; functional-only fallback -- --without-screenshots; explicit interrupted owned fixture cleanup -- --cleanup-prefix=PXNATIVE<timestamp>. Next full four-mode/template-price/frozen/cleared-credit funding acceptance, then complete master-data audit/privacy/command-crash/release; native visual evidence is outstanding separately, do not redo delivered pages/normal payments.7 unequal categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged; full keyless protection/transaction-command crash window/recalculation failure tracing still open.

Latest October4 positive-payment/purchaser-exception checkpoint supersedes next-positive-payment/invalidated-config/reallocation instructions below. Formal positive-adjustment payment browser-verified from real previously paid/frozen company order: late evidenced shortage→REPLENISH→approved freight3.50 gap shipment→receipt creates two real extra documents, original snapshots unchanged. Supplier extra initially blocked; own StoreFinance registers collection, central confirms, then supplier extra registration/scoped confirmation, both remaining0/account-ledger0. Fixed company gate using immutable STORE_RECEIVABLE snapshot rather than current amount plus extra a second time; recognize both existing order-first/document-first adjustment ID encodings for collection only, not a global ID migration or legacy reconciliation. GET purchase-requests/:id/edit-catalog is ADMIN/PURCHASER only and uses editable request's original template; replacement preview adds templateId. Store rebinding cannot silently replace original identity. UI retains invalid products for explicit removal, clears unavailable supplier and changed unit/ratio selections, preserves original input quantity, requires reason/fresh quote; approval signature includes templateId. Scoped Purchaser actual repair/edit response-loss recovery once, confirmation, API supplier refusal, lost eligibility no-mutation/retry, reallocation recovery one replacement/audit verified. Formal per-item supplier/cancel and pending procurement refusal controls added. Reallocation checks active/original-template eligibility and unshipped target again under catalog/funding/supplier locks; all canceled request is now CANCELED, not CONFIRMED. Procurement reject Commands.perform/replay-only fixes FAILED/PROCESSING. Final build140 unit/52 HTTP/61 mini/19 Web/static/contract PASS; browser51 steps121 images cleanup PASS/browserErrors empty. Recovery harness reenters page with persisted session/command rather than waiting on intermittent reload navigation; initial actual reload test retained. API3113/Web4173 live, logs in /tmp.7 categories/58 migrations/M4 OPEN/M6 NOT_READY. Next native scoped own profile/supplier catalog and rapid pricing, then complete template-price/four-mode/frozen/cleared-credit money acceptance, audit/privacy/command-crash/release. Company-term cancellation and synthetic proofs/API setup are not account-funded cancellation, real bank/device/production acceptance; do not redo these completed branches.

Latest October4 Finance branch checkpoint supersedes Direct/cancel/preview-change/opposite-disposal unverified instructions below. Scoped StoreFinance actual cancel with required reason, successful-response-loss recovery once and RELEASED allocation verified; actual competing reservation blocks stale approved payment preview, no extra record. Separate paid/frozen company fixture verifies Store OFFSET and Supplier OFFLINE_RETURN with own scoped confirmations, original snapshots unchanged. Equal-price SUPPLIER_TERM fixture verifies Direct StoreFinance proof registration and scoped Supplier confirmation16/payable0/account-ledger0. Found/fixed company supplier total/store statements including Direct base orders; both now exclude SUPPLIER_TERM base and adjustment-only source orders. New2 unit tests cover all four modes and independent adjustment periods; old adjustment-only fixture now provides its actual source order. Build134 unit/52 full HTTP/61 mini/17 Web/static/contract PASS; complete browser46 steps109 screenshots cleanup PASS. Failed runs cleaned, not accepted. Browser reload timeouts traced to accumulated local static-server logs; Web4173 now redirects logs to /tmp/procurex-web-4173.log. API3113 rebuilt/live. Synthetic proof/API configuration+fulfillment is not bank/device/full mode acceptance. Next positive-adjustment payment targeted acceptance, then purchaser original-config remediation/reallocation and native/full funding/reliability/release.9 categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged; do not repeat these completed branches or normal Finance controls.

Latest October4 Finance difference checkpoint supersedes difference-controls-not-delivered notes below: formal adjustment list/detail, real credit-ID/remaining amount, OFFLINE_RETURN or real statement target OFFSET registration, scoped pending confirmation and readonly completed record delivered. Recheck credit signature before create; backend locks/current-availability/refund/double-disposal rules remain authoritative. Adjustment/disposal controllers now BusinessScopeGuard, disposal create/confirm Commands.perform with SUCCEEDED-only replay. GET disposal adds targetSupplierOrderNo on items for auditable confirmation; no frontend ID decoding/new money math. Found/fixed initial Finance bill-button loading race (disabled until handlers ready); harness waits exact checkbox. Build132 unit/52 HTTP/61 mini/17 Web/static/contract PASS; final full browser42 steps98 screenshots cleanup PASS. Actual paid/frozen company order late evidenced receipt+ACCEPT generates Store12.50/Supplier10 credits, original snapshots unchanged: Store offline-return create lost-response recovery exactly1 disposal, own STORE_FINANCE confirmation then readonly; Supplier OFFSET to real completed order and own Supplier confirmation with target order visible. No account-ledger writes or existing balance overwrite. API shortage/target fulfillment setup and synthetic proof are not their additional UI, real banking or all-mode acceptance. Normal financial entry implemented; next finite financial branch acceptance (Direct/cancel/positive adjustment/payment-preview change/opposite Store-offset and Supplier-offline), then purchaser invalidated-config/reallocation, native own profile/quick price and full funding/reliability/release.9 categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged; do not redo account/payment/difference normal entry.

Latest October4 Finance payments checkpoint supersedes payment-registration-not-delivered notes below: formal finance switches Store/Supplier/Direct statements, selects actual encoded base/positive-adjustment settlement IDs, server previews/repreviews, uploads private JPEG/PNG/PDF proof (10MiB), retries failure and registers with original-key recovery. Payment records/details show provenance, proof downloads and role-aware confirm/reject/cancel; pending commands disable competing writes. Create/cancel now Commands.perform with SUCCEEDED-only replay; failed/processing cannot execute again. Supplier confirm/reject explicitly denies STORE_TO_COMPANY company collections even for its own supplier; direct and company-to-supplier remain supported. Build130 unit/52 HTTP/61 mini/16 Web/static/contract PASS; final full browser41 steps94 screenshots cleanup PASS, including real StoreFinance payment upload retry/create response-loss recovery once, central proof download/reject/release/corrected confirm, central supplier payment and scoped Supplier finance confirmation. Synthetic proofs/order+ship+receipt API setup, not real funds/four-mode acceptance. Direct UI, cancellation UI, positive adjustment and preview-change payment scenarios NOT browser-accepted by this batch; do not treat them as proven by the company flow. Next formal difference offset/offline return, then these targeted financial cases, purchaser remediation/native/full financial/release.9 categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged. Accounts already delivered; no need to redo completed normal Store/Supplier/payment entry.

Latest October4 Finance account UI checkpoint supersedes query-only/account-controls-not-delivered notes below: formal finance screen mounts scoped store balance/credit/ledger and active positive credit allocations. HQ_FINANCE/ADMIN real recharge, expected-version PATCH credit limit and checkbox clearing preview/repreview/commit delivered; Store/StoreFinance readonly. GET stores/:id/credit-items uses explicit projection and existing scope guard; no manual UUID entry. Remember selected store across refresh, block writes during pending commands and expose original-key recovery. Build127 unit/52 full HTTP/15 Web/static/contract PASS; dedicated finance browser5 desktop/mobile screenshots PASS/cleanup PASS, stale allocation version blocks commit, actual clearing commit response loss recovers exactly1 clearing/2 ledgers, final balance100/limit200/used0. Opening credit25 is isolated historical fixture seed, NOT real procurement funding/full financial acceptance; no existing account overwrite. var/finance-account-evidence/manifest.json and scripts/capture-finance-accounts.mjs are reproducible evidence, separate from prior40-step Store/Supplier manifest. Next formal bill payment registration/evidence/review and difference actions, then purchaser remediation/native/full financial/release.9 categories/58 migrations/M4 OPEN/M6 NOT_READY unchanged; do not redo account controls.

Latest October4 financial-account safety checkpoint: recharge, credit-limit and clearing commands now use Commands.perform and replay only SUCCEEDED results. PROCESSING/FAILED cannot execute financial writes or audit again; definite business rejection records FAILED and retries return the original error. StoresController uses BusinessScopeGuard; account/ledger checks require a valid own-store binding for noncentral callers. Build127 unit/52 full HTTP PASS; latest extra real-DB invalid-recharge replay and extended Store account/ledger scope checks PASS in focused2 HTTP tests. Existing store-account HTTP fixture now binds its STORE user; monetary/audit assertions retained. No migration or new Finance UI/browser acceptance. Finance recharge/credit/clearing/payment/difference formal controls remain next, including a scoped selectable credit-allocation read API (do not require manual UUIDs). Financial business/command/audit crash window and full reconciliation remain open;9 categories/M4 OPEN/M6 NOT_READY unchanged. This checkpoint supersedes only financial-account command/scope behavior, not completed Store/Supplier flow evidence.

Latest October4 Store formal-flow checkpoint supersedes all Store-query-only/next-Store instructions below. workspace-store.js uses real scoped orders/details/shipment receipt navigation, readonly STORE_FINANCE, own-profile-selected catalog/cart/product images and sales-only visible quote through shared openPurchaseDraft; own store selector locked. Receipt quantities/max and exact decimal change checks, locked lines, required1-6 new images, authenticated current evidence, upload retry/removal, returned revision and persistent create/receipt recovery delivered. Receipt controller now Commands.perform: definite failures recorded/replayed as errors, PROCESSING never reexecuted, no empty FAILED success. BusinessScopeGuard added to purchase-requests/catalog/shipments; real HTTP tests prove missing/mismatched scope denial and foreign request/catalog/shipment denial. Build117 unit/52 HTTP/61 mini/14 Web/static/contract, browser40 steps/91 images cleanup PASS. Store actual order and receipt commits with lost responses recover once, upload failure/retry/max, unchanged receipt no add/resubmit, RETURN revised with fresh proof to revision2, STORE_FINANCE readonly. Supplier36-step flow retained. Receipt synthetic images and procurement/ship/RETURN API setup are not genuine photos/device or extra role UI acceptance. No migration (58),9 categories remain because invalidated-original-config edit remediation shares DEV201/204 row. Next formal finance recharge/credit/clearing/payment registration/difference actions, then purchaser invalidated-config/reallocation, native own-profile/quick price and financial/M4/release/M6. Full read-price privacy/global audit and transaction/command crash reconciliation not closed. API3113/Web4173 live; do not redo completed Store/Supplier normal entry.

Latest October4 supplier full-flow checkpoint supersedes supplier NOT_VERIFIED/query-only/next-supplier instructions below. Formal Web real shipment commit, partial shipment+permanent reduction, lost-response recovery once, evidenced short receipt→REPLENISH→gap shipment→remaining ordinary shipment, ACCEPT and RETURN/revised receipt, freight request→API approval→exact approved consumption, evidence download and allocated payment reject/release→corrected confirmation→lost-response recovery once are browser-verified. Found/fixed a real backend bug: replenishment allocations must not consume ordinary unshipped quantity; remainingNormalShipmentQuantity is shared by detail/preview, using persisted gap allocations, and current preview adds gap allocations back to remaining. No history backfill or new financial formula. Scenario ordered6/reduced1/received5, cost50, gap shipment leaves ordinary2; supplier payment blocked until store receivable collected through real API; final payable0. Build117 unit/51 HTTP/61 mini/13 Web/static/contract PASS, browser36 steps/84 images cleanup PASS. Synthetic receipt/payment images, receipt and store collection plus freight approval are API setup, NOT Store/finance UI or genuine funds/device acceptance. Supplier formal-entry row removed:9 unequal remaining categories,58 migrations, M4 OPEN/M6 NOT_READY. Next implement formal Store catalog/cart/preview/order and receipt/evidence workflows, then financial real-session writes and purchaser invalidated-config/reallocation gaps. Do not redo supplier entry or broaden into a general history center. API3113/Web4173 live.

Latest October4 supplier-workspace checkpoint supersedes the query-only supplier/next-supplier foundations below. workspace-supplier.js wires real-session shipment/reduction/replenishment/approved freight previews and commands, refusal, scoped discrepancy tasks/details/ACCEPT-REPLENISH-RETURN and payment evidence/confirm/reject. Money stays server-side; edits invalidate approval, submit re-previews, persistent commands block competing writes; task generations prevent stale dialogs/results. GET /discrepancies reads current OPEN/REPLENISH_PENDING tasks scoped by supplier rather than notification history. Supplier order detail remainingToShipQuantity is exact quantity minus shipped minus permanent reductions, floored at zero. BusinessScopeGuard on supplier-orders/discrepancies/payment-records rejects missing/mismatched business scopes; supplier-orders strips nested company sales fields for supplier-only callers, central pricing remains. Build115 unit/51 HTTP plus enhanced scoped HTTP test/61 mini/13 Web/static/contract PASS; browser32 steps/70 images cleanup PASS, desktop/mobile shipment preview and actual refusal. IMPORTANT: complete Web shipment commit/lost-response/replenishment, discrepancy actions and actual allocated payment review have NOT been browser-accepted; implement isolated fixtures and verify next, then formal Store/finance.58 migrations,10 categories/M4 OPEN/M6 NOT_READY unchanged. Do not mark supplier financial workflow or global API field/scope audit complete. API3113/Web4173 live.

Latest October4 purchaser-workflow supersedes next-purchaser foundations below. workspace-purchasing.js implements proxy order/catalog/category/add/remove/unit/quantity/preview, reasoned item edit and category/batch assignment with eligible/ineligible previews. POST requests/:id/items-preview shares prepareReplacement/save validation, readonly/no funding mutation. Create optional expectedTemplateId; create/edit optional expectedPriceVersionId/expectedSupplyPriceVersionId; assign optional expectedPrices exact selected-item coverage; changed approved sources409. PATCH items/POST assign optional-key compatible, Web persists method/body/key; actual create/PATCH commit with lost response recovers once. Success edit/assignment audited once, definite failures/PROCESSING do not reexecute; transaction/command/audit crash window remains. Build113 unit/51 HTTP/61 mini/12 Web/static/contract, browser31 steps/67 images cleanup PASS;58 migrations. Invalidated original template/product/supplier/unit editing safely blocked, repair not delivered. Next formal supplier shipment/rejection/difference/payment, then Store/finance and native own-profile/catalog.10 categories/M4 OPEN/M6 NOT_READY; do not repeat completed purchaser controls.

Latest October4 scoped-profile/archive supersedes next-self-profile/archive foundations below.58 migrations; Supplier.isArchived defaultsfalse. GET stores/:id and suppliers/:id allow central readers or strict own-role scope; missing/foreign scope403. GET suppliers/:id/catalog returns enabled supplier links, product identity/spec/unit/isActive and current shared supply price/source only, never sale/default price/profit. Formal Web profile/supplier-products readonly. POST suppliers/:id/archive expectedVersion, ADMIN/PURCHASER: exclusive price/catalog locks and supplier/template rows, remove product/template supplier/settings links, bump affected templates, retain supplier/order/history/prices. Archived edits/reassociation409; template configuration cannot reintroduce archived suppliers.113 unit/50 HTTP/61 mini/10 Web/static/schema; browser28 steps/61 images cleanup PASS. Next formal purchaser order/edit/assignment, then supplier/finance actions; native own-profile/catalog and full audit remain open.10 categories/M4 OPEN/M6 NOT_READY. No native/device acceptance claimed.

Latest October4 template-pricing checkpoint supersedes all next-template-scope/rule instructions below.57 migrations deployed: PriceScope.templateKey='' is shared legacy sale/supplier cost, template UUID identifies independent sales scopes; template version supplyPrice is only the observed shared-cost snapshot. effective-price.ts merges template sale (when effective) with shared cost and records distinct source IDs on new request/order lines; PriceVersion.supplySourceVersionId preserves publication/copy cost provenance. Do not invent missing old sources or a separate template cost. POST prices/quote supports readonly effective-time lookup; price publication/preview accept optional templateId, reject invalid pairs/cost edits, guard direct current/future equality and bump template version. Catalog, create/replace/reassign/reallocate, jobs and checkpoints wired; writes reject changed price sources. Template min/multiple nullable-inherit, enabled flag preserved, rules captured in new unit snapshot; shared/exclusive catalog locks protect preview/write. Copy materializes current/future independent sales config only, not old run/history or stores. Formal Web scope/quote/readonly cost and template category/rules/live prices implemented.113 unit/50 HTTP/61 mini/10 Web/static/schema and browser25 steps/54 images, cleanup PASS. API3113/Web4173. DEV-105 local functional row removed;10 remaining categories. Next scoped own-profile/supplier archive, then formal role actions and full template-price funding/freeze/cleared-credit/native quick-price verification. M4 OPEN/M6 NOT_READY, native visual gap unchanged; do not redo template CRUD/scope foundations.

Latest October4 default-price checkpoint: migration20261004070000_product_default_price_optional_sku deployed (53 migrations). Product.defaultSalesPrice nullable for legacy ONLY; new HTTP creates require nonnegative Decimal(20,6), SKU optional/editable/clearable, duplicate409 PRODUCT_SKU_EXISTS. Product metadata PATCH never publishes an effective price. TemplateItem.initialSalesPrice captures current default only for a new association under shared catalog lock; repeat saves/copy preserve original value including NULL. Web/native forms implemented; build110 unit/49 HTTP/60 mini/10 Web/static/schema PASS, browser23 steps/51 screenshots and cleanup PASS. API3113/Web4173. Do not repeat default-price/SKU CRUD or treat this snapshot as template-specific effective pricing. Next complete template price scopes/rules/presentation and independent-copy semantics, then remaining scoped profiles/archive and formal role actions.11 remaining categories; full financial acceptance/M4, native visual/device and production/M6 remain OPEN.

Latest October4 operational conversion supersedes foundation-only instructions below. Migration20261004050000_transaction_unit_snapshots deployed; nullable JSON request/order unit snapshots, no old-data backfill. PATCH /products/:id/purchase-unit uses product version, one positive8-decimal purchase-to-sales ratio or null disable. Preview/create/replacement accepts optional unitId/expectedProductVersion, converts to exact sales quantities, checks min/multiple and stable metadata under shared catalog lock before writing. Confirm/reallocate copy request snapshots. Read models use snapshot names and exact derived purchase prices; legacy unitBasis=LEGACY_UNKNOWN and unit guards remain, traded sales-unit changes still blocked. Unit rename invalidates catalog versions. Native unit choice/cart/checkout/snapshot detail and Web config/history implemented; definite create rejection uses existing CommandsService.perform, failed retries remain errors, successful retries preserve original request. Build110 unit/49 HTTP/59 mini/10 Web and static/schema PASS; browser22 steps/50 screenshots cleanup PASS. Check development-log.md and var/unit-conversion-native-evidence/manifest.json for separate native visual status; do not infer real-device acceptance. API3113/Web4173. Next default-product price/template initialization and optional SKU, then template price scopes/rules, own-profile/archive and formal role actions. Do not redo conversion core or invent old snapshots; M4/M6/audit/crash-window gates remain OPEN.

Latest October4 conversion groundwork: packages/domain/src/unit-conversion.ts provides exact quantity and price conversion; five focused tests plus full110 unit tests/build PASS. Independent Decimal clone prevents import-order precision loss. NOT wired to API or pages; no new migration/snapshots and no conversion acceptance closure. Next: optional one-set product configuration, nullable historical transaction snapshots without backfill, stable metadata check inside request write, snapshot copying on confirmation/reallocation, real request unit choice and HTTP/browser regression. Existing historical-unit guards remain active. Do not count helper completion as full delivery.

Latest October4 catalog checkpoint supersedes next-catalog-registry instructions below. Deployed20261004030000_catalog_registries: Category/Unit integer versions, Brand registry with actual legacy-text linking, nullable product brandId/barcode. New real-account brands/categories/units pages; CRUD, two-level tree/cycle guards, referenced delete checks (including conversion unit IDs), finance read-only. Product brand dropdown/barcode/search; old text writes remain compatible and preserve old editor data, brand rename bumps affected product versions without prices. Native brand picker reads /brands. Build105 unit/48 HTTP/58 mini/10 Web and static/schema checks; browser20 steps/46 screenshots, cleanup PASS. API3113/Web4173 remain ready. Existing unit/transaction snapshots are NOT invented: historical unit rename/base-unit change rejected, trade create/replacement uses shared catalogue lock while metadata writes are exclusive. Next implement transaction unit/conversion snapshots and one-set quantity/price conversion, then default product/template pricing and remaining role/self-profile/supplier archive work. Do not redo registry CRUD; full audit/recovery and M4/M6 stay OPEN.

October4 checkpoint supersedes older next-template-operations instructions: migration20261004010000_template_metadata deployed; strict create tag, editable name/tag/remark, copy excludes stores but retains product/supplier/priority/enable/settings, archived delete cancels current bindings/items/settings without deleting historical orders. DELETE supplier override restores defaults, checks direct-term equality, and bumps version; setting writes require associated suppliers and valid cycles. Name writes serialized before row lock; historical missing tags/duplicates not invented or renamed. API3113/Web4173 ready. Build105 unit/47 integration/57 mini/10 Web and static/schema checks; Playwright18 steps/29 screenshots, fixtures cleaned. Next catalog/brand/category/unit/conversion/product fields; then template product rules and price scopes, own-profile/supplier archive and role actions. Do not redo completed profile/template actions. Shared product+supplier prices are unchanged, not full independent template-price copying. Audit/reliable writes and M4/M6 remain OPEN.

Latest implementation and baseline gap list: [正式业务入口验收与剩余清单](./formal-workspace-acceptance.md). API3113/Web4173; normal `app.html` uses real accounts, regression UI explicit local `?demo=1`. Complete Store/Supplier profile fields delivered: migration 20261003110000_master_data_profiles, strict full new-create HTTP validation, nullable legacy data and partial-patch compatibility, actual forms/filters/read-only detail, receipt default reset and delivery/catalog integration. New orders snapshot supplier freight permission; false rejects nonzero charges, old null snapshots retain earlier behavior and no financial history is rewritten. Build105 unit/47 integration/57 mini/10 Web tests; Playwright PASSED17 steps/25 screenshots desktop/mobile, fixtures cleaned. DEV-102–106 still PARTIAL for operations, not these completed fields. Next: catalog/brand/unit/conversion and complete template operations, scoped self-profile/archive, then real-account role workflows. Normal Store/Supplier/Finance views still query-only. Do not repeat profile CRUD or build general history features.

Read [交付方向重新评审](./delivery-review.md) first. It supersedes all older Next/Next Batch/Next Work instructions below: complete formal Web/business-entry and baseline master-data acceptance, close remaining financial lifecycle gaps, then finish release acceptance. M4 remains reopened; M6 is not production-ready. Preserve verified native workflows. Necessary audit/reliable commands remain required, but do not start a new general history center or speculative historical backfill before baseline gaps. This review changed documentation only and did not rerun acceptance or implement product features.

## Latest Verified Checkpoint

2026-10-03 supplier bill drill-down supersedes supplier-store/product-row absence below. Native total bills load exact-parent store summaries, open a scoped store bill, expand current order products and follow member order/payment/adjustment sources; source return rereads the child, child return rereads the total. Independent store-list/payment failures preserve monetary detail with retry, and generation checks reject late/closed responses. Child membership and parent identity are both checked; moving to another tab does not reopen the parent. Existing settlementItemIds are reused, never creating another payable.

Total/store detail lines now include current store/product name, SKU/specification/unit, ordered/effective/received quantities and current supply unit/line prices. Effective quantity reuses fulfillment rules (permanent reduction and accepted shortage, not returned discrepancy). Decimal aggregation supplies productGoodsAmount and goodsReconciliationAmount = statement goods minus current product goods; amountBasis explicitly distinguishes FROZEN/CURRENT_ORDER, while productAmountBasis is always CURRENT_ORDER. Historical settlement snapshots contain only header amounts, so these are NOT reconstructed frozen product snapshots. No automatic backfill, price/payment/funding changes or new migration. Store summaries expose current storeName; adjustment-only children retain source identities and parent linkage, and total storeCount now includes adjustment-only stores. Malformed UUID identities and foreign/empty supplier scopes are rejected before enrichment.

Build/unit102/integration46/mini56 and mini/web/contract/schema/billing/diff/readiness PASS on rebuilt API3112. New real HTTP fixture proves two stores, frozen goods20/current products12.34/reconciliation7.66, unchanged snapshot20, an adjustment-only later period, exact-parent links and supplier403/404. Existing settlement assertions stay unchanged. Final native read-only capture PASSED6 screenshots at390x753 (`var/supplier-bill-details-evidence/manifest.json`): total/store/products/source/fresh child/fresh total; store goods27 + freight8.50, paid35.50/payable0 displayed. Final product screenshot inspected with disclosure icon and trimmed numeric display; no order/payment/ledger writes and no full financial-journey rerun claimed.

Next priority: full server-backed business history and source/version browsing, then remaining master-data/Web editing. Frozen per-product historical snapshots, complete bill actions/pagination, cross-device/stuck-command reconciliation, M4 cleared-credit/historical reconciliation/mode summaries and M6 external production/device/OSS gates remain OPEN. This completes the read-only total→store→current-product/source chain, not all financial or production acceptance. Requirement alignment: AC-20/AC-25 bill grouping and supplier read-only boundary; do not repeat this drill-down batch.

2026-10-03 role command recovery supersedes the role-recovery-next notes below. Native purchaser confirm/reallocate/freight review and supplier freight request/shipment/rejection/discrepancy/payment review now persist the exact POST body/version/path/key before sending. One pending command per API base/actor/workspace blocks fresh commands; explicit recovery replays the stored request without fresh previews or current-state validation. App restart/navigation preserves it, while successful or definite business rejection appends up to20 local records and refreshes server data. Authentication loss,408/429/5xx/COMMAND_PROCESSING retain the pending command; in-flight retries and logout are guarded. Late completion writes only its original actor storage; account-change responses cannot populate another actor's command result. Local storage failure prevents sending. These are **local submit records**, not complete server business history or cross-device recovery.

Backend selected role endpoints now guard PROCESSING and replay FAILED as errors rather than empty success. CommandsService.perform records definite4xx business failures; unknown5xx outcomes stay PROCESSING and never run a second operation. Reallocate now requires Idempotency-Key, stores a replayable result and audit reason; Web role demo caller updated. Existing unrelated command endpoints are NOT all migrated. Business transaction and command-success/audit writes remain separate: crashes between them require manual reconciliation; do not delete pending commands or invent an automatic timeout retry.

Final build/unit98/integration45/mini50, mini/web/contract/schema/billing/diff PASS. Real HTTP reallocation replay preserves version4, and seeded PROCESSING returns409 without mutation. Native recovery PASSED4 screenshots (`var/role-recovery-evidence/manifest.json`): actual supplier freight commit and purchaser review succeeded before injected client response loss; explicit same-key recovery yields one request, version2, unused confirmation and exactly two successful commands. Supplier navigation also preserves pending state; module restart covered by tests. Temporary0.01 freight/audit/command fixtures cleaned; no shipment/payment/ledger writes. Final Chinese status/history screenshots inspected. This is controlled DevTools fault injection, not actual airplane-mode/real-device evidence or a rerun of the full monetary journey.

Next: supplier-store statements/product-level bill lines and full server business history, remaining master-data/Web editor work. Long-lived PROCESSING/manual reconciliation, cross-device command recovery and auth/scope loss handling remain OPEN. M4 cleared-credit/historical reconciliation/mode summaries and M6 external production/device/OSS gates remain OPEN; do not repeat this eight-flow local recovery batch.

Final product native verification PASSED5 screenshots (`var/product-media-evidence/manifest.json`). Actual canvas export is800x800 JPEG5911bytes, decoded pixel variance confirms nonblank, READY upload/native save and authorized store thumbnail/specification/brand/storage display PASS. Crop/editor-thumbnail/store screenshots inspected. Temporary PXMEDIA-UI product and template item removed; no order/price/money mutations. Earlier timeout/null-serialization/keepalive failures are not acceptance; the final clean run uses fresh HTTP connections. Camera/album, real-device orientation/gesture and OSS remain NOT_VERIFIED. This final result supersedes pending-capture notes below. Reproduce `node --env-file-if-exists=.env scripts/capture-product-media-evidence.mjs` with the project compiled/open in DevTools; avoid recompiling inside an active automation session.

2026-10-03 product media checkpoint supersedes the product-media-next notes below. Migration20261003090000_product_media_metadata applied; products now retain optional specification, brand, storageCondition and a unique private image reference. PURCHASER/ADMIN manage these through native pages/products/index (purchaser header entry). Existing brands are suggestions derived from product data, not an independent brand registry. Ordinary metadata saves never publish prices. Atomic timestamp-version updates reject concurrent edits; image attachment requires the actor's READY, PRODUCT-purpose, unlinked file under a row lock.

Native square crop/zoom/export uses800x800 JPEG, quality0.8; PRODUCT uploads allow JPEG/PNG up to2MiB. Server verifies format, square dimensions up to4096, single frame and successful decoding. Store catalog shows specification/brand/storage and authenticated thumbnails; stale catalog/image responses and removed editor images are isolated. Store download requires an active product in an enabled, unarchived, unexpired bound template; supplier download requires its product association. Replaced/unlinked media is not visible to stores. Existing uploader/HQ/ADMIN access remains.

Build/unit98/integration44/mini44, mini/web/contract/schema/billing/diff and API3112 readiness PASS. Dedicated native screenshot/canvas verification is being attempted with scripts/capture-product-media-evidence.mjs; read its manifest status rather than assuming PASS. Earlier startup/automator timeout attempts are FAILED, not acceptance. Synthetic bitmap/temporary product only, not real product photography. Actual camera/album, orientation/gesture behavior on real devices and OSS remain NOT_VERIFIED. Web product editor, independent brand management, other master-data fields/supplier editing and full price UI are not complete. Next work: role uncertain-command recovery/history and remaining supplier bill detail; M4 cleared-credit/historical reconciliation/mode summaries and M6 external gates remain OPEN.

2026-10-03 receipt evidence continuation supersedes the source-navigation checkpoint below. Migration20261003050000_receipt_evidence applied locally; Receipt now retains FileObject attachments per version. RECEIPT upload sessions allow JPEG/PNG up to10MiB, private storage and signature/checksum completion. Binding is transactional and requires1-6 unique READY images owned by the actor, correct purpose and not already attached. Invalid ownership/type/status/reuse rolls back the receipt/version/item changes. Current shipment and exact discrepancy-version details expose safe file metadata; download permits the associated store/supplier or uploader/HQ/ADMIN, not unrelated or empty scopes.

Native receipt selection/upload/retry/remove, authenticated preview, all-READY gating, account/request-generation isolation and same-key uncertain replay with unchanged attachmentIDs implemented. Existing legal quantity corrections and accepted/replenishment locks remain unchanged. Unchanged submitted quantities do not offer a new upload. API omission remains legacy-compatible: full mandatory evidence across other clients is NOT closed, nor camera/album/real-device/OSS acceptance. Product media/specification management remains next; do not repeat this receipt storage/UI batch.

Current build/unit98/integration43/mini39, mini/web/contract/schema/billing/diff checks PASS; API3112 current rebuilt, readiness PASS. Final full native rerun PASSED16 steps/17 screenshots on3112 (`var/miniprogram-extended-evidence/manifest.json`), rejection-todo removal and store104.50/supplier84.50 audits PASS. Receipt audit PASSED3 versions/3 distinct READY files with historical version preserved; reproduce `node --env-file-if-exists=.env scripts/audit-native-receipt-evidence.mjs`. Earlier image-injection path/full-page JSON truncation, low demo funds and DevTools timeout attempts are not counted as PASS; the final rerun did not resume. Demo funding was replenished through the existing recharge API, not balance overwrite/history reset. Supplemental store UI14 screenshots PASS at390px (`var/store-ui-evidence/manifest.json`), including current-version attachment list and authenticated preview; inspected and no stale add/count control on unchanged receipt. Local fixture images and synthetic display stress cases are explicitly not genuine receipt photos. Camera/album and real device remain NOT_VERIFIED. DevTools image preview is closed by simulator_open_page before further automation.

2026-10-03 supplier statement source navigation: native bills now open member order/payment/adjustment sources and return by reloading the bill, not restoring stale monetary data. Related payments use exact settlement item allocations; whole-payment and bill-linked amounts are separate, including rejected/released history. Lookup failure preserves the bill with retry. Request generations prevent older responses overwriting a reopened same-ID bill. Price source links use PRICE_DOCUMENT identities and unaggregated frozen source detail; existing financial adjustment lists still net changes. Database regression proves consecutive20/10 source documents open with their own amounts and foreign supplier access is rejected; aggregate30 and original base80 assertions remain unchanged.

Build, unit96/96, integration43/43, mini33/33, mini:check, web:check, contract:check and diff PASS. Current API3112 rebuilt/restarted and readiness PASS. Native role UI16 screenshots PASS (`var/role-ui-evidence/manifest.json`), including bill order/payment sources and fresh return; payment and returned bill screenshots inspected. Adjustment source has database coverage, not a fresh native screenshot. Do not infer fresh financial/device acceptance from this checkpoint. October1 extended financial evidence remains the prior monetary checkpoint. Remaining priority: product media/specification management and receipt evidence, role uncertain-command recovery/history. Bill substatements/product rows/write actions and M4/M6 gates remain OPEN.

2026-10-01 current role closure checkpoint supersedes the older3111 checkpoints below. API is `http://127.0.0.1:3112/api/v1`, readiness PASS. Build, unit95/95, integration43/43, mini page28/28, mini:check, web:check, contract:check, db:validate, billing acceptance and diff PASS. Billing check is stateful: its first check encountered the prior fixture's already-paid balance; reseeding only PXACC and checking again passed without changing monetary assertions or PXFLOW data.

Purchaser rejection work now reads `GET /purchase-requests/rejection-todos` (PURCHASER/ADMIN only), derived from current assignments and effective supplier orders rather than the most recent50 historical notifications. Reallocation removes old rejection from API/UI todos without deleting historical orders/notifications; same-supplier re-push/rejection ignores the older rejected order. Unit and real HTTP evidence cover progress, presence/removal and finance403. Stale handled-detail selection cannot send another reallocation command.

Supplier scoped order detail now exposes current store `destination` name/address/contactName/contactPhone and list `storeName`; missing values remain explicit. These are current store details, not delivery-address historical snapshots. Supplier period statements open an encoded-ID, scoped read-only detail with source orders, goods/freight, adjustments, confirmed/pending amounts and payable balance. Chinese cycle/date labels respect exclusive period ends; leap-year regression included. Stale/closed bill-detail responses cannot overwrite current selection. This does NOT implement supplier-store substatements, product-level lines, full payment/adjustment/history links or bill write actions.

Fresh extended native journey PASSED16 steps/17 screenshots on3112 (`var/miniprogram-extended-evidence/manifest.json`), including explicit `rejectionTodoCheck` proving handled order absent from current API/UI todos. Store96+8.50=104.50 actual net debit and supplier76+8.50=84.50 payable PASS. First attempt stopped before order submission because DevTools setData serialized/truncated an entire growing page; the harness now resets only created through a small evaluate result, and a complete rerun passed. Native payment registration remains a local fixture, not real payment/device acceptance.

Next priority: remaining role-detail states and bill source navigation, product media/specification management and receipt evidence, then role-specific command-uncertain recovery and complete history. Do not repeat implemented rejection filtering/destination/readonly bill work. Pagination, multi-role navigation layout and real-device keyboard/network/viewport checks remain. Financial M4 cleared-credit/historical reconciliation/mode summaries and M6 external production gates remain OPEN.

Final role UI capture PASSED13 screenshots on3112 (`var/role-ui-evidence/manifest.json`), including destination missing-data state and Chinese-cycle/exclusive-end statement detail. These supplement the16-step/17-image business journey, not replace it. Current demo store contact/address are unconfigured; nonempty metadata is verified with actual database-backed HTTP fixtures, not invented demo contact data. No real-device or additional-width acceptance is claimed.

2026-10-01 role UI continuation: supplier/purchaser now have compact operational headers, fixed business navigation, searchable/status-filtered order lists, separate guarded detail/return paths and current Shanghai month reports. Switching views clears stale selection and is blocked during writes; account changes clear visible results. Supplier discrepancy/payment navigation uses list-to-detail rather than duplicate selectors. Order/request frontend twenty-row truncation is removed; other lists and server pagination remain open. Existing shipment/replenishment, discrepancy, freight, reallocation and payment handlers are retained.

Mini page24/24 and mini:check PASS; readiness3111 PASS. Native role UI capture PASSED12 screenshots on3111: `var/role-ui-evidence/manifest.json`. Initial screenshots exposed clipped search text, fixed and recaptured. DevTools retries encountered `routeDone ... webviewId ... is not found`; recompiling/opening login recovered the tool. Reproduce: `PROCUREX_API_BASE=http://127.0.0.1:3111/api/v1 node scripts/capture-role-ui-evidence.mjs`. This capture performs no new financial writes. The basic native action journey also PASSED9 steps/9 screenshots on3111 (`var/miniprogram-journey-evidence/manifest.json`): store36.00 goods +8.50 freight =44.50 net debit; supplier27.00 goods +8.50 freight =35.50 payable. Payment registration is a local fixture, confirmation/evidence opening are native; not real payment/device acceptance. Prior backend94/43 tests remain the previous checkpoint, not rerun in this frontend batch.

Extended native journey after role changes PASSED16 steps/17 screenshots on3111 (`var/miniprogram-extended-evidence/manifest.json`): supplier rejection/reallocation, ACCEPT/RETURN/REPLENISH, returned receipt correction, freight reject/confirm, gap shipment/receipt, payment reject/confirm and authenticated evidence opening. Store96.00 goods +8.50 freight =104.50 actual net debit; supplier76.00 goods +8.50 freight =84.50 payable. This supersedes3110 as the native role-action checkpoint. Final search placeholder correction is display-only; role UI capture is separate from financial action evidence.

NOT full formal role acceptance: authoritative handled-rejection notification filtering, pagination, shipment/payment richer detail states, actual destination/contact metadata in supplier views, command-uncertain retries in these roles, bill details/actions, product media/specification, receipt evidence and history remain. Current list APIs do not return storeName, so search placeholders promise order/request number only, not nonexistent store-name search. Multi-role users keep global role tabs below local business navigation; real-device safe-area/keyboard and broader sizes remain unverified. Next work: handled rejection todos, actual destination data and remaining detail states, then bill operations/media/evidence. Avoid another unrelated financial refinement.

Current priority follows the user's visual-interaction review: complete formal native business screens, not another backend-only batch. Store catalog, checkout, order detail and batch receipt have been rebuilt in WXML/WXSS. Catalog has search/category filters, actual sales units/prices/minimums/multiples, quantity steppers, a cart sheet and fixed checkout action. Confirmation groups products by supplier and shows actual store address/contact plus stored/credit requirements and gaps. No invented address/image/specification data: missing values are explicit. Store-local bottom navigation exposes order/catalog, orders, receipts, account and profile; global role routing remains unchanged.

Order lists use real supplier completion/cancellation/rejection counts rather than treating procurement CONFIRMED as fulfillment completion; details include supplier names and actual shipment/current-receipt timestamps. Account entries use Chinese source labels and Shanghai timestamps. Preview rechecks prices/funding before submit. Network-uncertain order/receipt payloads and keys are retained per user/store and editing is locked until replay confirmation; this is same-key replay, not a new command-query endpoint. The two backend create endpoints now reject persisted PROCESSING commands with COMMAND_PROCESSING, preventing duplicate execution during replay. Real HTTP regressions prove no side effects in this state and preserve ordinary success/replay.

Final current API `http://127.0.0.1:3111/api/v1`: readiness, build, unit94/94, integration43/43, mini page22/22, mini:check, web:check, contract:check, db:validate, billing acceptance and diff PASS. An October rollover exposed a historical pricing fixture assuming base bill and adjustment always share a period; the regression now asserts the base line and aggregate actual-period amounts independently. Native extended journey PASSED16 steps/17 screenshots on3110 with unchanged funding audit (store104.50/supplier84.50), including new catalog/cart/confirmation/detail screens and revised receipt actions. An initial DevTools timeout was followed by a complete successful rerun. Evidence: `var/miniprogram-extended-evidence/manifest.json` and associated images. The subsequent progress/read-only receipt corrections have unit/HTTP coverage and supplemental native screenshot evidence on3111, not another full financial journey.

This is NOT full visual or production acceptance. Product image/specification metadata and its management/upload path are absent from the current Product model; rendered image slots show honest missing-image states. Receipt evidence upload, complete procurement-change history, full native account bill actions, supplier/purchaser formal-screen redesign, real-device keyboard/network and additional viewport checks remain. Local test fixture names are still English; they are data, not hard-coded UI labels. Keep M4/AC-E08 OPEN for cleared-credit adjustments, historical price-source reconciliation, mode-specific summaries and complete standard money evidence. M6 external production/device/customer gates remain open.

Supplemental UI capture PASSED12 screenshots on3111 at a 390px-wide DevTools viewport: `var/store-ui-evidence/manifest.json`. Search empty, cart, confirmation, long text/large money, read-only catalog, completed orders, detail/timeline, already-submitted receipt, account and profile were captured and inspected. Its synthetic display overrides do not alter database rows or count as production evidence. Initial attempts exposed historical rejection counting and unchanged receipt submission; those are fixed, with current allocation-based progress and no unchanged revision submission. Full receipt corrections remain allowed (do NOT lock every existing receipt; RETURN review still needs corrections). Reproduce with `PROCUREX_API_BASE=http://127.0.0.1:3111/api/v1 npm run mini:capture-store-ui`; close any prior native image preview by refreshing the simulator first. `scripts/capture-store-ui-evidence.mjs` uses args files because this DevTools CLI rejects inline --args despite advertising it.

Frozen permanent reductions now use real shipment sources and separate REDUCTION/FREIGHT documents per frozen side. Original snapshots are preserved; historical partial-freeze fixtures cover all four settlement modes. Stored cash releases the goods reduction before booking new freight in the same transaction (24.00 refund, 35.00 debit, final target 131.00); credit adjusts outstanding usage without cash movement. Supplier original 90.00 plus reduction -18.00 and freight +35.00 reconciles to 107.00. Insufficient funds roll back shipment, fee consumption, documents and ledgers. Competing submissions produce one success and one VERSION_CONFLICT. Already-refunded store reductions cannot be disposed again; supplier reductions can be independently returned. Shipment preview also subtracts earlier permanent reductions from remaining capacity.

Latest verification: build, unit 91/91, full integration 43/43, focused four-mode database tests repeated, mini page 14/14, mini:check, web:check, contract:check, db:validate, billing acceptance and diff PASS. Migrations through 20260930070000 are applied locally (46 total). Current API is `http://127.0.0.1:3108/api/v1`, readiness verified. Native 3105 evidence is unchanged and does not prove this new frozen workflow. M4 stays OPEN for cleared-credit adjustments, missing/consumed-source historical reconciliation, mode-specific account summaries and full standard funding evidence. Gap replenishment cancellation is not arbitrary permanent reduction; do not extend this shipment workflow to already-shipped gaps.

The checkpoints below are historical. In particular, old FROZEN_REDUCTION_ADJUSTMENT_REQUIRED descriptions and older API addresses are superseded by the shipment-sourced workflow above.

Frozen completion repricing is implemented for final receipt and ACCEPT when the latest effective price has a real PENDING published run/order source. Original bill snapshots remain untouched. Each changed item creates its run-linked PriceChangeAdjustment and documents only the frozen sides; order/request lines and totals update atomically. Funding synchronization uses the price-adjustment ID, not the receipt ID, so actual stored refunds cannot be disposed again. Frozen increases can complete with a real cash/credit funding gap without exceeding account capacity. Missing/already-consumed legacy sources still require reconciliation (FROZEN_PRICE_CHECKPOINT_RECONCILIATION_REQUIRED), not invented run history.

Worker processing rereads each run-order after the funding/order locks: a worker that cached PENDING before receipt consumed the source skips the now-SUCCEEDED row. Real database tests enforce this interleaving. Unit 88/88, full integration 39/39, mini page 14/14, build, mini:check, web:check, contract:check, billing acceptance and diff PASS. The eight funding integration cases cover unfrozen increases, frozen increases/decreases and frozen ACCEPT for STORED_VALUE/CREDIT, publication/completion races, one successful competing completion, unchanged snapshots, single adjustment/documents, actual refund/replay rejection and cleared-credit rollback. Frozen price lines snapshot effective quantity/unit price and adjustment details read those snapshots (ACCEPT quantity 9, not original ordered 10).

Current backend is `http://127.0.0.1:3107/api/v1`, readiness `/health/ready` relative to that base. This batch has unit/database evidence; the native 3105 stored-value journey remains the previous channel-protection baseline and was not rerun for dynamic frozen pricing. M4 stays OPEN for frozen permanent reductions, cleared-credit settlement adjustments, missing-source historical reconciliation, mode-specific summaries and complete standard funding evidence.

Account-backed duplicate receivable protection is implemented: B01 base lines and store adjustments include COMPANY_TERM only; STORED_VALUE/CREDIT remain account settlements, and SUPPLIER_TERM stays in direct statements. Preview/create and historical pending-payment confirmation reject second store payments with ACCOUNT_SETTLEMENT_NOT_PAYABLE. Store offsets require COMPANY_TERM, including positive adjustment targets. Supplier payable statements remain intact. Historical confirmed payments are not automatically reversed.

Build, unit 81/81, full integration 33/33, mini page 14/14, mini:check, web:check, contract:check and diff PASS. Billing acceptance passes with credit supplier payable 185.00 in the half-month period, no credit store receivable, and company store receivable 130.00. The combined purchase/billing fixture first proves stored double-payment rejection, then explicitly releases its stored funding before a separate COMPANY_TERM billing phase; this is fixture setup, not a production mode-conversion feature. Late company shortage creates pending credit rather than falsely refunding an account. Term shortages without account allocations preserve request paid/shortfall amounts, neither inventing a funding gap nor clearing other account groups' existing gaps. Real database tests also prove blocked legacy confirmations roll back to PENDING/RESERVED.

Unfrozen effective-price checkpoints are implemented at first shipment and at completion through final receipt or ACCEPT. First shipment uses its actual first-shipment time, updates order/request prices and funds, and writes shipment price snapshots from the refreshed prices. Insufficient first-shipment funds roll back the entire action, including the first-shipment timestamp. Completion applies latest published prices effective at the original first-shipment time, never the replenishment/receipt date. Stored and credit shortfalls do not block receipt completion: existing booked amounts remain, allocation targets and request shortfall reflect the new price, and later funding reconciliation can recover them.

Price publication takes an exclusive transaction advisory lock; price processing and fulfillment checkpoints take the shared lock before account/order locks. Real database tests race publication with two final receipt submissions: exactly one receipt succeeds, the final price follows the transaction order, and later publication cannot rewrite the completed order. Credit completion retains prior credit usage without exceeding its limit. Build, integration 33/33, unit 67/67, mini page 14/14, mini:check, contract:check and diff PASS. Price/final-receipt race cases passed again in a separate repeat run.

Fresh native rerun on the 3105 channel-protection baseline PASSED all 16 steps/14 screenshots and automated funding audit: store goods 96.00 plus freight 8.50 equals paid/allocation/net debit 104.50; supplier payable remains 84.50. `var/miniprogram-extended-evidence/manifest.json` and `funding-check.json` are the current native evidence; supplier payment screenshot visually checked. The subsequent term-shortage funding-gap fix is tested by unit/database integration and runs on 3106, not by this stored-value native scenario. This is a local Developer Tools journey, not real-device/payment acceptance. Dynamic price race evidence comes from database integration, not this native scenario.

The preceding frozen-checkpoint block is superseded by the run-sourced completion workflow above. Cleared-credit decreases and frozen permanent reductions remain blocked pending their settlement workflows. Missing or already-consumed price sources still require historical reconciliation. Do not claim these exceptions complete.

Price-run funding now reconciles actual allocations rather than deriving paidAmount from spare account balance. Runs update request-item prices and amounts together with order/request totals. Stored increases debit only the net difference when affordable; insufficient balance retains existing booked funds and records the shortfall. Decreases refund actual excess booked cash. Credit increases/decreases adjust real outstanding usage; over-limit processing rolls back and leaves the published run PENDING for retry after limit restoration. A decrease below already-cleared credit is explicitly blocked by CLEARED_CREDIT_ADJUSTMENT_REQUIRED; that settlement adjustment remains unfinished.

Frozen snapshots remain unchanged. Store-side negative price documents already refunded through their price-change-sourced ledger are DISPOSED in adjustment views and cannot be refunded again through difference disposal. Real integration cases cover 120 -> 130 -> 200 -> 100 goods targets, stored shortfall/recovery, credit limit rollback/retry, refund replay rejection and cleared-credit protection. Verification: build, full integration 33/33, unit 67/67, mini page 14/14, mini:check, contract:check and diff check. The preceding native evidence remains a shipment-funding baseline; it does not prove these new price-run scenarios.

Request funding is now booked transactionally at submission: sufficient stored value debits once; insufficient stored value leaves the request pending without a partial new debit. CREDIT reserves its own limit; an over-limit credit group rolls back the entire mixed request. Confirmation attaches allocations without a second debit. Draft edits, cancellation, supplier rejection and reallocation reconcile actual allocations and cash/credit usage. Settlement mode/cycle snapshots survive later supplier-default changes. Migration `20260930050000_request_funding_allocations` is applied locally.

Funding HTTP assertions cover competing 120.00 requests against 150.00 (one funded, one pending, balance 30.00), mixed stored/credit rollback and cancellation, actual edit refunds, rejection/reallocation money conservation, and COMPANY_TERM/SUPPLIER_TERM with no stored debit. Verification: build, unit 65/65, full integration 31/31, mini page 14/14, mini:check and contract:check. Legacy overpaid allocations block automatic reconciliation rather than refunding unrelated overpayment.

The payment-channel/term-shortage checkpoint used 3106; use current 3107 above. Native capture supports `PROCUREX_API_BASE`; select 3107 in the mini-program login API configuration for latest local testing. Port 3105 remains the latest stored-value native evidence baseline.

Shipment funding now includes actual freight and permanent reductions in one account/request/order-locked transaction. An unfrozen permanent reduction recalculates item/order/request goods and releases the corresponding cash/credit; shipment freight is then included in allocation targets. Insufficient balance or credit rolls back shipment creation, reduction and freight-confirmation consumption. Two simultaneous shipment submissions with one expected version produce one success and one VERSION_CONFLICT. ACCEPT refunds preserve booked freight in paidAmount. Frozen permanent reductions are explicitly blocked with FROZEN_REDUCTION_ADJUSTMENT_REQUIRED until a valid adjustment-source path is implemented.

Current regression: build, unit 67/67, full integration 31/31, mini page 14/14, mini:check and contract:check PASS. Integration asserts a 120.00 stored booking reduced to 96.00 goods plus 35.00 freight yields target/paid 131.00 and balance 19.00 from 150.00. Credit freight over-limit rolls back; after increasing the limit it reserves 131.00 without cash movements. Native rerun on 3102 PASSED all 16 steps/14 screenshots and the automated database funding audit: store goods 96.00 plus freight 8.50 equals paid/allocation/net ledger debit 104.50; supplier payable remains 84.50. Evidence: `var/miniprogram-extended-evidence/manifest.json` and `funding-check.json`. This is local testing, not real cash movement.

The preceding goods-only native checkpoint on 3101 passed with net goods debit 96.00 but did not book freight. It is superseded by the current 3102 result above. Payment registration remains an explicit local API fixture, not real money or a native finance registration page.

ACCEPT updates item/order/request amounts in one locked transaction; subsequent repricing uses effective quantities. Frozen sides retain their snapshots and get discrepancy-sourced negative documents, visible through adjustment list/detail and eligible for independent disposal. Existing stored-value allocations refund only the shortage portion of actual booked funds; credit allocations release outstanding credit. No allocation means no fabricated refund. Store-side documents already refunded to stored value are not separately refundable. RETURN is receipt review history, not a new financial credit; historical booked disposals remain auditable.

Frozen shortage document lines also snapshot quantity and unit price, so later repricing cannot change historical detail. Both new discrepancy-source and line-snapshot migrations have been applied locally.

Real HTTP coverage now includes concurrent ACCEPT with distinct idempotency keys (one success, one conflict), unchanged two-sided snapshots, one actual stored-value refund ledger entry, duplicate-refund rejection, adjustment list/detail and supplier offline return confirmation. The former 98.50 versus 82.50 conflict was traced: permanent reduction plus accepted shortage deduct 16.00 legitimately; an obsolete RETURN credit was the separate defect. The test now rejects that credit and uses an independent post-freeze price adjustment for offset coverage.

Verified: build; unit 65/65; mini:check; native page tests 14/14; focused HTTP 6/6; contract:check; diff whitespace check. A shutdown leak exposed by longer HTTP tests was fixed: export maintenance stops and awaits in-flight work before database disconnect. All HTTP tests now finish normally.

## Next Batch

User-directed priority: current rejection todos, destination details and read-only supplier bill entry are implemented. Continue remaining role-detail states/bill source links, product media/specification management and receipt evidence, then complete native bill actions, uncertain-command recovery and change history. Verify screenshots and actual native workflows after each role-wide batch. Do not switch back to invisible financial detail work without keeping this screen-completion priority visible.

AC-E08 / DEV-304 / DEV-406 remains OPEN for the full funding lifecycle, not for the now-fixed 84.50 native amount:
- Initial goods funding, draft edits, confirmation linking, supplier rejection, reallocation and cancellation are implemented and database-tested; do not repeat that work.
- Price-run funding, unfrozen checkpoints, run-sourced frozen completion, frozen/unfrozen unshipped reductions and independent frozen shipment freight are implemented. Next implement settled-credit adjustments and mode-specific summaries; audit historical frozen orders whose matching price source is missing/already consumed. Both frozen and unfrozen completion can preserve real funding gaps; cleared-credit decreases remain blocked.
- Duplicate store-term receivable protection is implemented. Next improve mode-specific deduction/clearing summaries without recreating term payables; preserve refunded-store adjustment protections and frozen-side accounting.
- Verify the standard money scenarios in `docs/development-plan.md`, then emit complete M4 funding evidence. Do not remove the required gate or claim full M4 closure based solely on native amount success.
- Real-device/network acceptance and M6 production server/domain/OSS inputs remain open.

Older dated checkpoints below are historical context and do not override this section.

Use this as the first document when continuing development in a new window.

## Historical State

Historical M4 evidence passed the earlier local gates and recorded manual browser evidence 6/6. AC-E08 / DEV-304 / DEV-406 is now reopened by extended native amount verification; `m4:gate-status` checks that evidence and blocks closure while it fails. Do not repeat the historical closure claim until the quantity-to-money defect is fixed and gates are rerun.

M5 has resumed. The current M5 slice has a repeatable browserless acceptance chain for R01-R05 reporting/export/reconciliation, I08 in-app notification list/read/bulk-read, real DEV-503 supplier-shipment, receipt-discrepancy, discrepancy-resolution, supplier-rejection, and overdue-receipt reminder triggers, DEV-504 audit logs for purchase requests, supplier operations, shipment/receipt/discrepancy resolution, payment create/confirm/reject/cancel, W10 difference-disposal create/confirm, and store recharge/credit-limit/clearing operations, W11 visibility, R04 export task listing and failed retry, DEV-505 stale export recovery and export health monitoring/export, W13 reconciliation export/operations/notification/filterable-exportable-audit visibility, and Chrome-captured W11/W13 screenshots.

M6 readiness tracking has started without claiming production launch readiness. `npm run m6:readiness` writes `apps/web/m6-readiness.json` and `apps/web/m6-readiness.html` renders DEV-601 through DEV-605. Current expected status is `NOT_READY`: DEV-601 is READY from M5 close evidence, browser/mobile Web, local performance sampling, local rollback check, local initialization/reconciliation check, local pilot rehearsal, local mini-program API flow, and local restore evidence are LOCAL_READY, while WeChat real-device evidence, production environment config, object-storage policy, production recovery drill, customer finance sign-off, customer pilot sign-off, and handover evidence remain open. `npm run m6:external-evidence` writes `var/m6-external-evidence.json` to track those external launch materials separately from local readiness; `npm run m6:capture-readiness-evidence` captures the visible page to `var/m6-readiness-evidence/`; `npm run m6:package-local-evidence` and `npm run m6:write-local-handoff` produce the machine-readable and human-readable local evidence package; `npm run m6:write-customer-evidence-request` produces `docs/m6-customer-evidence-request.md`, the owner-based request list for the remaining external materials. The M6 page now has a visible review handoff section with local handoff, customer request, evidence templates, strict gate commands, and production/WeChat/storage guides; the latest screenshot manifest records 7 handoff rows on desktop and mobile with no horizontal overflow.

The first actual mini-program product-client slice now lives under `apps/miniprogram`. It is not another HTML validation page: it uses native WeChat mini-program files and exposes login, Store, Supplier, and Purchaser pages. The Store page now covers real account/ledger visibility, order preview/create/progress, notification-driven receipt submission through `GET /shipments/{id}` and `POST /shipments/{id}/receipts`, plus scoped R01/R02 statistics. The Supplier page covers shipment/reject, discrepancy ACCEPT/REPLENISH/RETURN from notifications, supplier statements, payment confirm/reject, plus scoped R01/R02 statistics without company profit. The Purchaser page covers request detail/shortfall visibility, confirm, `SUPPLIER_ORDER_REJECTED` notification-driven reallocation, and authorized R01/R02/R03 profit statistics. `npm run mini:check` verifies the surface, role routing, real API paths, command version guards, supplier order item IDs, rejected-order reallocation input, store account/ledger visibility, store receipt version/revision input, store order progress, purchaser detail/shortfall visibility, purchaser rejection notifications, supplier discrepancy actions, supplier statement/payment actions, per-role statistics panels, and that no HTML files exist under the mini-program app. `npm run mini:flow-check` now rebuilds, reseeds PXFLOW, runs the Store/Purchaser/Supplier mini-program role flow over real HTTP APIs, verifies report endpoints and Supplier profit denial, and writes `apps/miniprogram/mini-flow-check.json`.

M7 is the current productization track while M6 external launch materials remain blocked by real production infrastructure, storage policy sign-off, WeChat real-device evidence, and customer pilot evidence. The committed M7 cockpit at `apps/web/m7-business-flow.html` turns the main-flow evidence into a role-based business flow. `apps/web/store-workbench.html` logs in as the PXFLOW Store account, reads `/stores/{id}/account`, `/stores/{id}/ledgers`, `/purchase-requests`, and `/notifications`, then lets the Store preview/create orders and submit full or short receipts through shipment detail and receipt APIs. `apps/web/purchaser-workbench.html` logs in as the PXFLOW Purchaser account, reads `/purchase-requests` and `/notifications`, opens request detail, confirms purchase requests, and reallocates supplier rejections to the backup supplier. The current slice adds `apps/web/supplier-workbench.html` and `apps/web/supplier-workbench.js`: it logs in as the PXFLOW Supplier account, reads `/supplier-orders`, `/notifications`, `/supplier-statements`, and `/payment-records?direction=COMPANY_TO_SUPPLIER`, then supports supplier shipment, rejection, discrepancy ACCEPT/REPLENISH/RETURN, and payment confirm/reject. Continue M7 next by tightening the three role pages into a complete happy-path guided workflow and then adding Supplier/Store action evidence beyond page load screenshots.

The formal Web product app now starts at `apps/web/app.html` with ES modules in `apps/web/product-app/`. This is the preferred target for new Web product work: `product-app/api.js` holds the shared API client, `state.js` loads the PXFLOW seed/run files, `shell.js` owns navigation and route chrome, and `pages/overview.js`, `pages/store.js`, `pages/purchaser.js`, and `pages/supplier.js` render the role routes. The old `store-workbench.html`, `purchaser-workbench.html`, and `supplier-workbench.html` remain as compatibility/evidence pages, not the preferred place to keep adding new product UX.

Latest M7 continuation point: `apps/web/product-app/pages/flow.js` adds `app.html#/flow`, the formal App-level business-flow action route. It logs in with PXFLOW Store/Purchaser/Supplier accounts and executes Store order preview/create, Purchaser confirmation, Supplier shipment preview/create, and Store receipt through real APIs. `npm run main-flow:capture-interactive-demo` now clicks this route and expects `productAppFlowAction.status=COMPLETED` with four result rows and `var/main-flow-demo-evidence/product-app-flow-action.png`. Continue M7 by moving the exception branches (supplier rejection reallocation, discrepancy ACCEPT/REPLENISH/RETURN, supplier payment confirmation) from compatibility workbenches into the same formal product-app route family.

The exception branches have now also moved into `app.html#/flow`: the route executes supplier rejection, purchaser reallocation, discrepancy ACCEPT, REPLENISH with replenishment shipment/receipt, and RETURN. The interactive manifest now expects `productAppExceptionAction.status=BRANCHES_READY` with four exception result rows. The remaining product-app migration target is supplier payment confirmation/rejection and finance settlement visibility inside the formal App rather than only in `supplier-workbench.html` / `billing.html`.

Finance settlement visibility has now moved into `app.html#/finance`: the route reads supplier statements, store statements, `COMPANY_TO_SUPPLIER` payment records, and exposes supplier-side payment confirm/reject actions. The interactive manifest now captures `productAppFinance.status=READY` and `var/main-flow-demo-evidence/product-app-finance.png`. Continue M7 by tightening finance action evidence: create or select a deterministic pending payment in the formal App flow, then confirm/reject it in `#/finance` without relying on accumulated local data.

Finance action evidence is now deterministic too. `app.html#/finance` has “登记并确认供应商付款”, which selects the PXFLOW supplier statement, previews a payable settlement item, uploads a generated PDF payment proof, creates a `COMPANY_TO_SUPPLIER` payment, and confirms it as the Supplier account. `npm run main-flow:capture-interactive-demo` now expects `productAppFinanceAction.status=CONFIRMED` and captures `var/main-flow-demo-evidence/product-app-finance-action.png`. The formal App now covers happy path, exception branches, finance visibility, and supplier payment confirmation.

Finance rejection evidence is deterministic in the formal App as well. `app.html#/finance` has “登记并驳回供应商付款”, which creates a fresh supplier payment through the same preview/evidence-upload chain and rejects it with the Supplier account. `npm run main-flow:capture-interactive-demo` now expects `productAppFinanceRejectAction.status=REJECTED` and captures `var/main-flow-demo-evidence/product-app-finance-reject-action.png`. Continue M7 by improving the formal App's day-to-day operator UX around these already-real flows, not by adding more one-off HTML workbenches.

The formal App overview has now been upgraded into the first day-to-day command center. `app.html#/overview` reads the main-flow run, role evidence, seed accounts, and `m6-readiness.json`, then shows main-flow status, local evidence, external blockers, role coverage, formal route entries, today’s role evidence, next implementation focus, and productization/launch status. The latest `npm run main-flow:capture-interactive-demo` records desktop and mobile overview as `PASSED` with no horizontal overflow while flow, exception, finance rejection, and finance confirmation actions still pass. Continue M7 by applying the same operator-focused polish to Store/Purchaser/Supplier/Finance route details.

The Store and Purchaser formal routes have now moved beyond passive summaries. `app.html#/store` can select notification-driven shipments, read shipment detail, and submit receipts; `app.html#/purchaser` can read purchase-request summary and item rows, confirm requests, and show reallocation results. The Supplier formal route also now handles payment collection directly: it reads payment detail/version and confirms or rejects the payment from `app.html#/supplier`. Continue M7 by tightening the Finance route detail view and then connecting these role routes into a more guided day-to-day workflow, rather than adding new one-off HTML pages.

The Finance formal route detail view is now tightened as well. `app.html#/finance` can load supplier statement detail, show statement lines/settlement item IDs/adjustment items, and show payment allocation rows after selecting or creating a payment. Continue M7 by connecting Overview/Flow/Store/Purchaser/Supplier/Finance into a guided day-to-day workflow and making the next visible work reduce operator clicks, rather than creating additional compatibility pages.

The first guided day-to-day workflow connection is now in place. `app.html#/flow` saves the latest main-flow handoff to `sessionStorage` via `apps/web/product-app/workflow.js`; Overview displays that handoff, and Store/Purchaser/Supplier/Finance prefill the relevant IDs from it. Continue M7 by making the handoff more actionable after finance registration, for example by surfacing payment status back on Overview and adding route-level refresh actions, not by adding new standalone HTML pages.

The guided formal App journey is browser-verified: Flow creates a current handoff, Overview refreshes four linked resources, each role route refreshes details, Finance registers a `PENDING` payment, Supplier confirms it, and the breadcrumb returns to Overview with the process complete. Independent App evidence covers Store order -> Purchaser confirmation -> Supplier shipment -> Store receipt, Supplier rejection returning to Purchaser, and Purchaser handling the rejection notification to reallocate only the rejected supplier order's product rows. The request remains `CONFIRMED`, the action result is `REALLOCATED`, and Overview routes the next action to Supplier. Supplier ACCEPT/REPLENISH/RETURN are exercised from `app.html#/supplier`; REPLENISH creates a gap-allocated shipment and Overview recommends Store receiving. Desktop and narrow-screen interactive captures pass. `docs/requirements-surface-audit.md` now records the dual-client audit. `npm run mini:check` and `npm run mini:flow-check` pass; native API flow reaches Store receipt, Supplier payment confirmation/discrepancy resolution, Purchaser reallocation, Store/Supplier scoped statistics, Purchaser profit statistics, and Supplier profit denial over real HTTP APIs. The M6 local package, readiness browser screenshots, and M5 close baseline have been refreshed after the mini-program statistics update. This is not real-device WeChat acceptance. Next keep baselines green while collecting external M6 launch evidence. Keep external M6 gates separate.

## Latest High-Signal Work

Recent commits closed M4 and restarted M5 reporting/export/operations acceptance:

```text
560a633 Refresh M6 evidence package after customer request
77c70c7 Add M6 customer evidence request
5b41ae8 Refresh M6 local handoff
beb9aec Add M6 local evidence handoff
fffca4a Refresh M6 local evidence package
8564836 Package M6 local evidence
f796fd2 Capture M6 readiness browser evidence
21014cb Show M6 external evidence on readiness page
84e7ee4 Add M6 external evidence templates
51ac5af Add M6 external evidence checklist
66d6a87 Add M6 pilot rehearsal check
03de062 Add M6 initialization signoff check
de176fd Add M6 rollback readiness check
ce21378 Add M6 local performance check
f5de790 Include mini flow in M6 readiness
20fac39 Add mini program flow check
6aae683 Show mini program purchaser request details
0abf45f Add mini program supplier payments
44ab916 Add mini program store account view
e111de1 Show mini program store order progress
ab2c115 Connect mini program purchaser rejections
accc041 Connect mini program store receiving
a7012a7 Connect mini program supplier discrepancies
c4be0b9 Add native mini program role surface
81eadb9 Add M6 production readiness ledger
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
```

## Commands To Rebuild Evidence

Run the M5 reporting/export browserless chain:

```bash
npm run acceptance:m5-close
npm run m5:status
npm run acceptance:m5-browserless
npm run m5:capture-all-evidence
npm run m5:capture-browser-evidence
npm run m5:capture-ops-evidence
npm run m5:gate-status
npm run m6:performance
npm run m6:rollback-check
npm run m6:readiness
npm run mini:check
npm run mini:flow-check
```

The latest refreshed local run on 2026-09-30 has Docker, PostgreSQL, Chrome, M5 browserless output, W11/W13 evidence, main-flow interactive browser evidence, and M6 readiness browser evidence ready locally. The browserless chain passed 10/10 steps, W11/W13 capture refreshed, M5 gate marked DEV-501/502, R04/W11, DEV-505, R05/W13, DEV-503, DEV-504, MainFlowUI, MainFlowRun, and Chrome evidence READY, and the M6 readiness screenshot manifest records 11 readiness rows, 6 external rows, 7 handoff rows, and no desktop/mobile overflow.

`npm run acceptance:m5-close` is now the strongest single M5 close-readiness command. It reruns the M5 browserless reporting/export/reconciliation/notification chain, reseeds/checks the main-flow demo, writes `apps/web/main-flow-demo-run.json`, writes the M5 status snapshot, refreshes W11/W13 browser evidence through `m5:capture-all-evidence`, captures the main-flow demo role/evidence card, role-view tabs, and `role-workbenches.html` role lanes in Chrome, clicks the main-flow page's one-click browser run through `main-flow:capture-interactive-demo` in desktop and mobile viewports, clicks the Store order, Purchaser confirmation, Supplier shipment, Store receipt, Supplier discrepancy, Supplier rejection reallocation, and discrepancy branch actions in desktop and 390px mobile role-workbench viewports, runs `m5:gate-status`, and writes a final M5 status snapshot. The latest committed run marks DEV-501/502, R04/W11, DEV-505, R05/W13, DEV-503, DEV-504, MainFlowUI, MainFlowRun, and Chrome evidence as READY; MainFlowRun includes a real Store role order reaching `PENDING_PROCUREMENT / PAID`, Purchaser `CONFIRMED`, Supplier `SHIPPED`, Store receipt `COMPLETED`, Supplier discrepancy `RESOLVED`, supplier rejection reallocated to a backup supplier, discrepancy `REPLENISH_PENDING/1`, and discrepancy `RESOLVED/RETURN` on both desktop and 390px role-workbench viewports.

This performs:

0. `m5:status` checks Docker, local PostgreSQL, browser runtime, latest M5 browserless output, and W11/W13 evidence manifests. If Docker/PostgreSQL is down, DB-backed M5 acceptance is environment-blocked until `npm run db:up` succeeds.
1. TypeScript build.
2. `PXRPT` report acceptance seeding.
3. R01/R02/R03/R04/R05 HTTP acceptance checks.
4. Store-scope and supplier profit-permission checks.
5. R04 export task list check.
6. DEV-505 export health check: admin sees a stale `PROCESSING` job before recovery, supplier gets 403, then the worker recovers the job to READY.
7. DEV-505 failed export retry check: a FAILED job is requeued through `POST /exports/{id}/retry`, reaches READY, and a second retry returns 409.
8. I08 notification check: current-user list/read works and another user gets 404 for the admin message.
9. R05 reconciliation issue list check.
10. W11/W13 Web visibility check.

The screenshot capture logs in as `pxrpt_store`, renders the M5 acceptance summary on the W11 report page, runs the September 2026 R01 scoped query, creates an export job, waits for READY in the export task list, and writes local evidence to:

```text
var/m5-browser-evidence/reports-dashboard.png
var/m5-browser-evidence/manifest.json
var/m5-browser-evidence/ops-reconciliation.png
var/m5-browser-evidence/ops-manifest.json
```

Generated local file:

```text
apps/web/reports-acceptance-run.json
apps/web/m5-status.json
apps/web/main-flow-demo-run.json
apps/web/m5-gate-status.json
```

These files are intentionally ignored by git.

The W13 ops evidence logs in as `pxrpt_admin`, renders `GET /exports/health`, `GET /notifications`, `GET /audit-logs`, and `GET /reconciliation-issues`, and writes `ops-manifest.json` with export health, notification, audit, and reconciliation issue row counts.

Run the strongest browserless M4 chain:

```bash
npm run m4:status
npm run db:check
npm run acceptance:m4-browserless
```

This performs:

1. TypeScript build.
2. W09/W10 `PXACC` acceptance seeding.
3. W09/S05/S08 and W10 HTTP acceptance checks.
4. DEV-402/403/406 automatic gate-status check.
5. Generated manual-checklist sync check.
6. Main-flow acceptance runner.
7. Interactive main-flow demo seeding and HTTP check.
8. Web workbench visibility check.

Generated local files:

```text
apps/web/billing-acceptance-run.json
apps/web/main-flow-run.json
```

These files are intentionally ignored by git.

## What To Open

Start the local services:

```bash
npm run m4:start-manual-acceptance
```

Alternatively, start the API and web server separately with `npm run start:api` and `npm run start:web`.

Open:

```text
http://127.0.0.1:4173/m4-acceptance.html
http://127.0.0.1:4173/main-flow-demo.html
http://127.0.0.1:4173/billing.html
http://127.0.0.1:4173/main-flow.html
http://127.0.0.1:4173/
```

The root report page is now the best first M5 reporting screen: after `npm run acceptance:m5-close` and `npm run m5:status`, it displays the latest local M5 environment snapshot from `apps/web/m5-status.json`, the latest 10-step R01-R05/DEV-505 acceptance result from `apps/web/reports-acceptance-run.json`, and the M5 close-readiness gate from `apps/web/m5-gate-status.json`; it can be re-captured with `npm run m5:capture-browser-evidence`.

`ops.html` is the best first M5 operations screen: it shows DEV-505 export task health with CSV export, I08 in-app notifications with single/bulk read actions, DEV-504 filterable audit logs with current-result CSV export, and R05 reconciliation issues with CSV export for the seeded admin account.

`m4-acceptance.html` is the best first screen for review: it shows the latest browserless result, the DEV-402/403/406 gate status, structured automatic evidence coverage, the seeded account matrix, and a copyable acceptance summary. The manual evidence checkboxes are saved locally in the browser as review aids; the strict file-based close gate is `npm run m4:check-manual-evidence`.

The gate definitions live in `apps/web/m4-gates.json`; update that file first if DEV-402/403/406 acceptance evidence changes, because both the page and `m4:gate-status` read from it. The same file also drives the manual acceptance path shown on `m4-acceptance.html`.

If port `4173` is occupied, run a one-off static server on another port:

```bash
python3 -m http.server 4174 --directory apps/web
```

## Seeded Accounts

All seeded accounts use password `correct-password`.

| Account | Use |
|---|---|
| `pxflow_user` | Interactive main-flow demo from order creation to payment preview. |
| `pxflow_store` | Store-scoped main-flow notification check after supplier shipment. |
| `pxflow_supplier` | Supplier-scoped main-flow notification check after receipt discrepancy. |
| `pxacc_admin` | ADMIN/HQ finance view for all billing tabs and checks. |
| `pxacc_store` | Store-scoped billing and direct statement view. |
| `pxacc_supplier_company` | Supplier-scoped company-term view. |
| `pxacc_supplier_direct` | Supplier-scoped direct-term view. |
| `pxrpt_admin` | Company report acceptance checks and export ownership. |
| `pxrpt_store` | Store-scoped W11 report screenshot and R01/R02 scoped checks. |
| `pxrpt_supplier` | Supplier-scoped report permission boundary checks. |

More detail is in `docs/billing-acceptance-seed.md`.

For the interactive main-flow demo, run:

```bash
npm run main-flow:seed-demo
npm run main-flow:check-demo
npm run main-flow:capture-demo-evidence
npm run main-flow:capture-interactive-demo
```

The demo page renders `apps/web/main-flow-demo-run.json` as visible role and evidence sections, plus role tabs with next-workbench boundary text. `apps/web/role-workbenches.html` now renders Store/Purchaser/Supplier/Operator lanes from the same PXFLOW evidence, including account scope, todos, actions, evidence mapping, and next-page boundary text. The Store lane has a real order action that logs in as `pxflow_store`, previews the order, and creates a `PENDING_PROCUREMENT / PAID` purchase request; the Purchaser lane confirms that request to `CONFIRMED` and generates a supplier order; the Supplier lane creates a real shipment; the Store receipt action completes that shipment through the receipt API; the Supplier discrepancy action creates a short-receipt exception and resolves it to `RESOLVED`; the Supplier rejection action rejects a pushed order and has Purchaser reallocate it to a backup supplier; the discrepancy branch action covers `REPLENISH` with replenishment shipment/receipt and `RETURN` with returnRecord. The latest Chrome capture under `var/main-flow-demo-evidence/` records `PASSED`, 4 role rows, 4 role tabs, 4 role workbench lanes, 7 evidence rows, 6 step rows, and true notification/audit evidence flags. `main-flow:capture-interactive-demo` also proves the page's one-click run control can execute the browser flow against real APIs in desktop and 390px mobile viewports and that the role actions can create, confirm, ship, receive, resolve, reallocate, replenish, and return in desktop and 390px role-workbench viewports; it is now part of `acceptance:m5-close` and the `MainFlowRun` gate.

For the M4 gate status summary, run:

```bash
npm run m4:prepare-manual-acceptance
npm run m4:status
npm run m4:manual-evidence-status
npm run m4:capture-manual-evidence
npm run m4:check-browser-runtime
npm run m4:gate-status
npm run m4:capture-browser-evidence
```

For the generated manual acceptance checklist, run:

```bash
npm run m4:write-manual-checklist
npm run m4:check-manual-checklist
```

Open `docs/m4-manual-acceptance.md` when collecting screenshots or recordings.

Place collected manual evidence files under:

```text
var/m4-manual-evidence/<gate>/<manualEvidenceId>.<png|jpg|jpeg|webp|mp4|mov|webm|pdf>
```

Run `npm run m4:check-manual-evidence` before marking M4 closed.

Run `npm run acceptance:m4-close` for the final local M4 close check after browser evidence exists.

## Next Work

Do these in order:

1. Fix AC-E08 amount linkage before further UI polish: accepted missing quantities must update effective sales/supply amounts and reconcile stored-value/credit funding; frozen settlement snapshots need adjustment documents rather than overwritten bills. Add the 3/2/3 -> 84.50 regression and the standard 10 -> 8 quantity scenarios from `docs/development-plan.md`, including already-settled sides. The extended native actions are covered, but the financial comparison is open; rerun `npm run mini:capture-extended` until that comparison passes.
2. Keep the regression baseline green: `npm run mini:test`, `npm run mini:check`, `npm run build`, `npm test`, plus the existing M5/API acceptance commands when their mapped behavior changes.
3. Complete external M6 launch gates when inputs exist: production host/domain and runtime configuration, signed storage policy, WeChat real-device evidence, customer finance sign-off, and pilot/handover sign-off.
4. When production inputs arrive, run the strict M6 checks and replace the current BLOCKED evidence with signed production/customer artifacts.

Do not mark production launch complete from local browser evidence alone.
