# 原需求与交付证据映射

## 当前状态（2026-10-06）

最新React收尾：管理员命令入口已补齐并真实API验证，最终页面/证据/尚未签收映射见react-admin-handoff.md。下段“缺React入口”已完成；价格条件关闭是合成记录真实接口证据，不是实际改价回滚。原验收/生产门槛不变。

React增量以react-admin-handoff.md为当前交接：默认本地入口、通知、入账标签、自动编号、管理员命令工具及四模式29次真实丢响应恢复已完成。正常同单、OSS图片/PDF及付款驳回证据保留，不重复开发。全部异常真实证据未统一签收，不据此宣布生产交付完成。原C3/C8/C9和生产门槛不变。

用户指定增量已完成：M01门店资料新增省市区联动和独立分组管理，后台分组入口/下拉归属、停用保留/禁止新分配、改名级联/旧版本保护及引用删除限制通过。证据var/store-groups-evidence；迁移专项及63迁移空库/57步129图、182/731/92/22回归通过。该指定增量不是重开下方已验收财务任务，也不改既有6/9、3/7签收边界。

当前状态以delivery-closure.md“执行约束与出口”为唯一收尾队列，不再将下方历史候选表里的C2/C4/C5/C6/C7引用解释为重新开发任务。C1/C2/C4/C5/C6/C7已关闭6/9；L4/L5/L6签收3/7。L2主数据/价格需要最终汇总签收，不是新建CRUD；L3已有正式Web同单和四模式履约/财务证据，需补最终原生/交接映射，不重做财务链。

最新已补：C8正式Web189项三引擎/三视口检查（27项未绑定范围拒绝）、C9空库62迁移/独立API/当前57步129图跨角色主流程及全部回收，详见local-operations-acceptance.md。真实OSS在测试目录上传/下载/隐私/指定版本回收已通过，生产策略不据此签收。

真正剩余：C3原生真实窄屏；C8未达200容量目标与初始化来源/生产资源验收边界；C9最终手册与逐包签收，不再缺技术复现。真机、生产OSS保留/恢复、服务器/域名及客户期初/财务确认归P1-P4，不得以本地合成证据签收。

当前回归182单元/730完整集成/92小程序/21Web来自本轮实际复验。原mini:visual-evidence检查9组90图文件/非空/哈希通过，closure OPEN、remaining只有Actual narrow viewport；本轮没有新原生窄屏或真机证据。下方候选AC的精确条件仍按对应签收证据核验，不能因工作包关闭自动将所有候选场景判为通过。

## 历史映射与证据来源

2026-10-05 C8当前增量：DEV-603/AT-24真实隔离数据库与四张凭证备份、销毁源数据、空库恢复、全部表哈希、资金/冻结/命令/审计对平及认证下载通过；DEV-501至505现有报表10项、导出过期恢复/失败重试、通知权限/提醒去重在隔离恢复库当前通过。62迁移、16隔离/实际证据门槛测试；备份龄非生产RPO，不证明旧应用回退或真实OSS。C8剩规模/兼容及初始化最终映射，C3/C9仍开放；不重开C4。证据local-operations-acceptance.md及var/ops-restore-evidence/manifest.json。

2026-10-05最新：C4/L4本地已签收。四模式全程正式页面下单/审核/发货/凭证收货/适用清账或付款/确认/历史核价/新单，共28步骤45图；实际已确认付款形成快照，不人工冻结，历史订单/已付/清账不变，未完成与新单新价正确。复用69财务矩阵、午夜及精确清账和既有差额/付款异常证据。C1/C2/C4/C5/C6/C7为6/9，L4/L5/L6为3/7；剩余C3/C8/C9，不再重复下方旧C4待办。证据finance-acceptance-matrix.md及var/settlement-mode-journeys/manifest.json。

2026-10-05 C4增量：AC-09四模式共享/模板上海零点真实HTTP8项通过；AC-E05真实采购300+700，清300后未清700/可用1300/历史累计1000，5数据库场景和正式财务5图通过（图片上传、单据查看、下载）。新增独立累计及发生/释放/清账流水，旧账户null不伪造历史；采购来源由服务创建/确认，不声称全程页面履约。C4剩余其余模式正式付款/冻结已付联合链，整包仍开放，详见finance-acceptance-matrix.md。以下旧午夜/精确清账待办已被本段覆盖。

最新签收：C6/C7及L5/L6通过，C1/C2/C5/C6/C7关闭5/9、本地2/7。68业务写/预览完整合同/724HTTP拒绝、35基础读矩阵、三方向付款/私有文件和10动作14组合改绑重放，原需求§2.3总部财务只读订单权限已补；27历史/未知边界与安全操作手册通过。715完整集成/172单元及正式Web57步129图通过。以下旧C6/C7待办由本段及privacy-legacy-acceptance.md、command-recovery-runbook.md覆盖；剩余C3/C4/C8/C9，不重新开发已通过权限或恢复。

2026-10-05权限/遗留增量：C6/C7本批子项详见privacy-legacy-acceptance.md，6角色35读入口、跨范围私有文件/账单、成本字段投影、供应商采购金额CSV及四旧无键动作同事务审计已验证。682集成/168单元通过，最终正式Web57步129图重跑通过。付款反向隐私有6单元用例，不冒充完整HTTP写权限矩阵；旧无键响应丢失和旧可省略附件仍有明确兼容边界，C6/C7整项不据此关闭，C1/C2/C5仍3/9。

最新AC-24/AC-E05增量：充值/清账凭证关联代码及正式Web入口已补，金额/日期/审计操作者/单据下载有证据；finance-account manifest7图PASS/cleanup PASS，21凭证DB用例及563完整集成通过。旧API无凭证兼容和AC-E05精确1000/300来源核验仍未据此关闭。下方“实现缺口”记录为历史，不重复开发图片入口。

2026-10-05核对。基线：requirements.md §10的27个主流程、13个异常用例及development-plan.md的DEV工作包。本文完成C1映射，不代表所有用例通过。

最新C2公司账期同单正式页面链已通过：manifest.crossRoleJourney覆盖门店创建/采购确认/供应商发货/门店凭证收货/门店财务登记/总部收款与付款/供应商确认。以下引用“同单串联C2”的项目可复用此证据，但5商品/两供应商、异常精确条件和其他模式不据此签收。AC-24/AC-E05充值清账附件确认为实现缺口，继续归C4。

## 工作包覆盖

| 原工作包 | 本地/生产验收归属 | 主要证据入口 | 剩余收尾项 |
|---|---|---|---|
| DEV-001至005 工程/设计/数据库/契约 | L7/L6，外部技术P2/P3 | 设计稿、迁移、contract:check、db及commands测试 | C7/C9；外部能力单独验收 |
| DEV-101 登录权限 | L1/L5 | auth/auth-http、范围/读写权限及改绑重放HTTP、Web会话、小程序页面测试 | C6已签收；剩余C3原生视觉 |
| DEV-102至105 门店/商品/供应商/模板 | L2/L5 | workspace-master-data、catalog/registries/media、stores/suppliers/templates HTTP及Web截图；master-data-audit-http54项 | C5/C6已通过；C3原生视觉及C9整体签收 |
| DEV-106 价格/单位 | L2/L4/L6 | transaction-units、template-prices、pricing、settlement-price-matrix | C3/C4/C7 |
| DEV-201至205 下单/资金/充值/编辑/拆单拒单 | L3/L4 | purchase-preview/purchaser-workspace、atomic-procurement/store | C2/C4；不重写已通过事务 |
| DEV-206 事务事件 | L5/L6 | atomic命令、通知事务写入、commands及未知边界测试 | C6/C7已签收；完整事件投递验收C8 |
| DEV-301至306 发货/补发/收货/差异/改派/运费 | L3/L4/L6 | Web角色分支、atomic-procurement、frozen-reduction、rejected-credit | C2/C3/C4/C7 |
| DEV-401至406 历史价/周期/账单/付款/清账/差额 | L4/L6 | 资金矩阵、direct/supplier-statements HTTP、atomic-payment/difference/store | C4/C7 |
| DEV-501至505 统计/导出/通知/审计/任务恢复 | L5/L6/L7 | check-reports-acceptance、check-notifications-acceptance、R05/任务工具 | C5/C6/C7/C8；历史材料需复核 |
| DEV-601 全场景回归 | L7 | 本映射、最终全流程及回归记录 | C9 |
| DEV-602 性能兼容 | L1/L7/P3 | Web视口、m6-performance-report、原生/真机 | C3/C8/P3 |
| DEV-603 发布恢复 | L7/P1/P2/P4 | 本地回滚材料、部署/备份手册 | C8/C9，生产演练P4 |
| DEV-604 初始化 | L7/P4 | 本地initialization-signoff、客户金额来源 | C8，客户真实来源P4 |
| DEV-605 试运行 | P3/P4 | 本地pilot材料不替代客户试运行 | P3/P4 |

## 主流程用例

“候选证据”表示已找到相关文件/脚本，仍须核对该编号所有精确条件；不得因名称相关直接签收。资金专项执行结果见finance-acceptance-matrix.md。

| AC | 包 | 候选证据 | 未关闭边界/收尾项 |
|---|---|---|---|
| AC-01 | L3 | purchase-preview确认拆单测试 | 5商品/2供应商精确数据及正式同单串联C2 |
| AC-02 | L3 | Web采购代下单、purchaser-workspace | 同单串联C2 |
| AC-03 | L3 | Web供应商减量、frozen-reduction | 正式跨角色同单C2 |
| AC-04 | L4 | atomic-procurement储值、settlement-price-matrix | 矩阵C4 |
| AC-05 | L4 | atomic-procurement挂账、settlement-price-matrix | 支付状态口径核对C4 |
| AC-06 | L4 | purchase-preview额度校验 | 超额精确断言C4 |
| AC-07 | L3 | Web门店收货、atomic履约 | 同单串联C2 |
| AC-08 | L7 | reports-acceptance工具 | 完成日/金额全模式证据复核C8 |
| AC-09 | L2/L4 | midnight-price-boundary-http四模式共享/模板8项 | 上海零点应用时钟HTTP通过；非OS/数据库时钟改写 |
| AC-10 | L3 | Web分类批选、purchaser-workspace | X/Y资格与整条分配C2 |
| AC-11 | L4 | direct-statement-http、Web直结 | 原生批量入口覆盖C3/C4 |
| AC-12 | L4 | atomic-store、finance账户UI | 精确金额/来源字段C4 |
| AC-13 | L4 | pricing-funding、settlement-price-matrix | 日期实例与未完成/已完成比较C4 |
| AC-14 | L5/L7 | reports-acceptance权限与利润 | 实收/运费/过滤精确证据C6/C8 |
| AC-15 | L2/L5 | stores-http、Web资料编辑、master-data-audit-http门店创建/修改 | 主数据审计已通过，完整角色边界仍C6 |
| AC-16 | L4 | purchase-preview储值缺口 | 500/100及不推送精确条件C4 |
| AC-17 | L4 | purchase-preview/atomic采购确认与充值 | 充值不自动确认及累计扣500C4 |
| AC-18 | L2/L4 | templates-http、settlement-price-matrix | 覆盖清除/默认/历史完整链C4 |
| AC-19 | L4 | settlement-calendar-closure四模式15/16日普通/历史价 | 数据库周期已通过；全页面联验仍C4 |
| AC-20 | L4 | settlement-calendar-closure两门店总分对平、supplier-statement-details-http | 总分金额已通过；实际核销联验仍C4 |
| AC-21 | L4 | settlement-price-matrix四模式 | 供应商应付与门店不重复收费C4 |
| AC-22 | L4/L7 | settlement-calendar-closure实收/利润30/运费5/日期口径 | 数据库对平已通过；其余报表验收仍C8 |
| AC-23 | L3 | Web供应商发货、main-flow工具 | 物流原发/补发单号两端可见C2 |
| AC-24 | L4/L5 | finance-account、atomic-store、files HTTP | 充值/清账凭证、日期、操作者逐字段C4/C5，不能仅余额断言 |
| AC-25 | L1/L5 | native-profile-price、范围HTTP、Web自身目录 | 原生视觉C3及完整拒绝矩阵C6 |
| AC-26 | L3/L4 | settlement-calendar-closure四模式6+4补发/首发固定/三账单 | 隔离历史日期数据库通过；正式页面联合验收仍C4 |
| AC-27 | L4 | settlement-calendar-closure普通16日新价/历史14日核价 | 首发15日及补发17日数据库实例通过，不冒充实际时钟/真机 |

## 异常用例

| AC | 包 | 候选证据 | 未关闭边界/收尾项 |
|---|---|---|---|
| AC-E01 | L3/L4 | atomic-procurement拒单与资金 | 储值退款/挂账释放正式入口C2/C4 |
| AC-E02 | L3 | Web供应商部分发货/补发 | 跨角色串联C2 |
| AC-E03 | L3/L5 | Web少收、范围HTTP、atomic处置 | 门店不能代供应商决定C6 |
| AC-E04 | L4 | purchase-preview额度失败 | 额度边界C4 |
| AC-E05 | L4 | credit-occurrence-history5项、credit-occurrence-evidence5图 | 真实采购1000清300→700、可用+300、累计不变1000及图片凭证通过；非全程页面采购链 |
| AC-E06 | L7 | notifications工具/overdue提醒 | 阈值/去重/实际通知C8 |
| AC-E07 | L3/L4 | Web补发、atomic履约/处置 | 精确10/8/2与默认运费一次C2/C4 |
| AC-E08 | L4 | pricing-funding FROZEN_ACCEPT、cleared-credit SHORTAGE | 原生操作C3、利润实收C8 |
| AC-E09 | L3 | Web退回重收revision2 | 同单历史保留C2 |
| AC-E10 | L3/L4 | Web采购修复/改派/取消、rejected-credit8场景 | 正式账户模式与其他单继续C4 |
| AC-E11 | L4 | 资金涨价/shortfall及atomic funding | 已发可收但未补不能结清C4 |
| AC-E12 | L4 | cleared-credit混合调整、supplier账单详情 | 总分两侧联动C4 |
| AC-E13 | L4 | frozen-reduction、Web正负差额/付款 | 冻结原单不改、净差额与重复C4 |

此表覆盖全部40个AC编号；未关闭边界不一律代表缺代码，先检查已有精确断言/执行证据，再补实际缺口。新增发现仍归C1-C9原收尾队列，不扩大范围。
