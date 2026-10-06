# 接口详细设计

2026-10-06储值时点更新：新`POST /purchase-requests`下单足额冻结，不扣账面余额；`funding.stored`新增reserved，paid只表示实际扣款，available扣除全店其他订单冻结。采购确认/拆单/发货仅调整冻结；供应商执行单收货完成（含差异处理）时同事务转实际扣款，重复命令和重算不重复扣款。

`GET /stores/{id}/account`及财务总览account新增reservedBalance和availableBalance；balance为账面余额，availableBalance=balance-reservedBalance。`GET /purchase-requests/{id}`新增storedReservedAmount，列表/详情新增storedValueOnReceipt标识新旧计费策略。冻结不等于PAID；不足仍保留PENDING_FUNDS，补足后重新冻结并确认。减量/取消释放冻结，无实际现金变动时不造现金流水。充值增加balance不自动扣款；清账只减少creditUsed并恢复creditAvailable，不扣储值。历史请求策略保留，未回写金额或流水。

2026-10-06门店财务增量：`GET /stores/finance-overview`仅ADMIN/HQ_FINANCE，返回门店资料及account（balance/creditLimit/creditUsed/creditCumulative/creditAvailable/version），无账户返回零值及version=0，不在GET创建账户。`GET /stores/{id}/credit-items`增加occurredAt（挂账分配创建时间）、supplierId/supplierName，历史或未分配供应商为null；保持原范围和版本字段。

`GET/POST /collection-accounts`及`PATCH /collection-accounts/{id}`仅ADMIN/HQ_FINANCE。维护name/bankName/accountName（必填最长120）、accountNo（必填最长80）、status=ACTIVE/DISABLED。PATCH全表单及expectedVersion必传，过期409 VERSION_CONFLICT，重复名称409 COLLECTION_ACCOUNT_NAME_EXISTS；无删除入口。维护与审计同事务，与外部充值校验共用事务锁。外部充值collectionAccountId必须有效且启用的UUID，其他引用409 COLLECTION_ACCOUNT_UNAVAILABLE；不回写旧单引用。`PATCH /stores/{id}/credit-limit`允许无账户时expectedVersion=0首次创建及授权，同事务；账户已存在时0返回409，不把已有账户当新账户覆盖。其余正版本校验及低于未清额度拒绝保持。

2026-10-06门店分组增量（用户明确要求）：`GET /store-groups`仅ADMIN/PURCHASER/HQ_FINANCE，返回id/name/status/version/createdAt/storeCount（含停用门店）；POST仅ADMIN，name去首尾空格后必填且最多120字，唯一。PATCH/DELETE `/store-groups/{id}`仅ADMIN，UUID及expectedVersion必传；PATCH可改name/status=ACTIVE或DISABLED，重名409 STORE_GROUP_NAME_EXISTS，旧版本409 VERSION_CONFLICT。已引用DELETE返回409 STORE_GROUP_IN_USE；数据库外键RESTRICT防绕过，改名CASCADE同步门店groupName并使旧门店表单版本失效。分组创建/改名/停用/删除与认证审计同事务，失败整体回滚。分组及门店归属写共用事务锁防删除/分配竞争。门店原groupName接口保持字符串/null，但不能再写不存在的名称；新增/改归属拒绝停用分组409 STORE_GROUP_DISABLED，保留已有停用归属时可编辑其他门店资料；null清除归属。迁移20261006140000_store_groups整理旧名称、去首尾空格去重并关联原门店，不改订单或资金。没有层级组织架构或新的财务业务。

2026-10-05挂账累计合同：GET stores/{id}/account新增creditCumulative，金额字符串或null；旧账户历史未知为null，不把未清creditUsed当累计。GET stores/{id}/credit-movements仅ADMIN/HQ_FINANCE/自身STORE/STORE_FINANCE，门店范围先验证；返回最近100条BOOKING/RELEASE/CLEARING的金额、发生时间、来源及该分配事后未清金额，不含采购成本。正向占用才增加历史累计，确认关联不重复累计，清账/取消/减量/少收只释放未清。累计、流水与资金/命令/审计同事务；旧API附件兼容合同不变。

2026-10-05权限/恢复最终合同：HQ_FINANCE按原需求§2.3可只读公司全部采购请求、供应商订单及发货详情，仍不可采购审核、发货或收货。成功命令重放在发货/运费申请/供应商拒单/差异处理/收货/付款四动作/差额确认中重新读取当前资源授权；原账号被改绑后不能绕过范围读旧缓存，原命令保持不变，恢复合法范围后仍返回原结果而不重执行业务。68写/预览路由合同与724HTTP拒绝、三方向付款/凭证及改绑HTTP通过；旧无键及非价格未知处置见command-recovery-runbook.md。C6/C7及L5/L6已签收，不宣称所有未知结果可强制恢复或无键精确重放。

2026-10-05权限与遗留合同：业务角色必须具有匹配的门店/供应商范围；补齐账单、运费、旧账户单据、供应商、文件、报表及导出的范围守卫。门店商品/请求/预览/发货收货响应移除采购成本值，保留不含金额的supplyPriceVersionId用于原双版本批准。供应商金额报告及导出由认证范围设置amountBasis=SUPPLY，客户端不能指定；旧销售口径缓存拒绝访问，缺日期订单不伪造日期进入报表。付款及付款附件参与者授权须同时符合方向，门店不能读公司供应商付款或预览供应商应付/调整，供应商不能读门店公司付款。总部及原上传者附件权限保持。价格发布/执行及采购替换/指派的旧无键调用业务审计同事务，审计标记LEGACY_HEADERLESS，不生成幂等键或命令记录，也不支持无键丢响应精确恢复。范围/故障/回归证据与尚未覆盖边界见privacy-legacy-acceptance.md。

2026-10-05主数据审计合同：分类/单位/品牌、商品及采购单位转换、供应商及供货/归档、模板及复制/归档/门店商品绑定/结算覆盖、门店资料、用户资料范围共27现有写入口，从认证会话取操作者/作用域，忽略body伪造身份；成功结果审计与业务共享原事务，审计失败全部回滚。AuditLog.after只保存结果、可用版本和关联数量/资源ID，不复制银行/联系/备注/密码/附件内容。用户更新补事务内版本条件校验，范围变更同事务，其他已有锁/版本/权限保留。无新路由、迁移、主数据命令幂等协议或全局恢复能力；内部无身份服务调用保留兼容。细项及54真实HTTP故障/权限/并发证据见master-data-audit-acceptance.md；C7价格无键等遗留保护仍开放。

2026-10-05充值/清账凭证：POST stores/{id}/recharges及clearings支持可选evidenceFileIds（提供时1至5个不同UUID），当前正式Web必须先完成JPEG/PNG凭证上传。保留未提供字段的旧调用，不代表全接口已强制凭证，该兼容边界继续归C7。服务器从会话取actorUserId，不信任body操作者；同业务/资金/命令/审计事务条件关联本人READY、用途RECHARGE/CLEARING、未关联其他单据/商品的私有文件，关联数不足则整体回滚。精确原键恢复包含原凭证ID，不重复单据或关联。

GET stores/{id}/recharges/{documentId}及clearings/{documentId}仅ADMIN/HQ_FINANCE和自身STORE/STORE_FINANCE，先校验门店范围，再以storeId+documentId读取；供应商/采购无权限。返回单号、金额、日期、收款账户（充值）、备注、审计操作人显示名及凭证安全投影，旧缺失为null/空列表。下载仍走认证files接口，只授权本人、总部或所属门店；供应商没有账户单据参与者权限。上传新增RECHARGE/CLEARING用途仅总部/管理员，须图片非PDF；非原生/OSS/银行验收。

2026-10-05 运费与履约处置事务更新：运费申请/确认/驳回、供应商拒单/资金重算、差异ACCEPT/REPLENISH/RETURN的业务、资金、差额/补货/退回、通知、命令结果和审计共享显式事务。服务独立调用仍有事务；运费审核先锁确认记录再读版本，互斥决定不能覆盖。资金重算FAILED原键重放原HTTP状态/错误码，不再返回空成功。已清CREDIT拒单保留原清账/已付历史并生成独立负差额，不退回储值余额。没有将价格专用中断关闭约定扩展到这些命令。

2026-10-05 发货/收货事务更新：既有POST supplier-orders/{id}/shipments与POST shipments/{id}/receipts的业务、资金/减量/完成重定价、运单/收货数量、凭证关联、差异/站内通知、命令结果与审计共享显式事务。原键精确成功重放；确定业务失败重放原HTTP状态/错误码，未知仍PROCESSING。原作用域、预览、版本、运费审批和凭证条件更新不变，原服务无controller调用也保留单独事务。未迁移price-only恢复约定到这些命令，不能借价格关闭接口解除历史发货/收货命令。

2026-10-05 新原子价格命令中断对账：新有键price.process创建时由服务器保存atomicPriceExecution=true；旧记录默认false且不回填。ADMIN POST /commands/{id}/close-uncommitted-price要求Idempotency-Key及1至500字reason，同事务取得目标命令行锁、验证PROCESSING/price.process/PriceChangeRun资源/持久化执行约定，然后标记FAILED（COMMAND_NOT_COMMITTED/409）并提交审计与关闭命令结果。原键重放关闭结果；旧业务键明确失败，刷新任务后由正常验证决定是否新键提交，不自动重算/补偿。

运行事务先锁同一命令行，因此管理员只能在事务结束后检查；若提交成功必有SUCCEEDED响应，不允许改失败。若服务未执行或事务回滚，即使诊断写入丢失，持锁PROCESSING仍证明没有业务提交；关闭后旧started执行句柄在锁内重读FAILED，不能再次执行。提交成功但响应丢失走原键精确重放；未持久化约定/旧记录/其他action仍拒绝。此规则仅新原子价格任务，不能推广到非原子资金业务。

2026-10-04 已证明回滚的价格命令关闭：price.process原子事务operation回调抛出非HttpException且$transaction已返回失败时，尽力保存COMMAND_ROLLBACK_CONFIRMED/proof=PRICE_PROCESS_CALLBACK_REJECTED。提交阶段异常、未保存证据、业务HttpException、其他action不据此判定回滚；失败的证据写入仍保持阻塞。诊断摘要不返回proof原体，未知诊断不覆盖已保存回滚证据。

ADMIN POST /commands/{id}/close-rolled-back-price必须Idempotency-Key和1至500字reason。事务锁定目标，要求PROCESSING + price.process + PriceChangeRun/resourceId + 服务端回滚证据，然后同事务标记原命令FAILED（COMMAND_ROLLED_BACK/409）、审计及关闭命令成功结果。原键精确重放关闭结果，旧业务键返回明确失败；不会自动执行任务或产生资金补偿。用户须刷新任务，再由既有价格执行校验决定能否新键提交。未知/终态/遗留命令409，不能按过期或审阅意见绕过；回调成功后的commit响应丢失仍为未知。仅此价格回滚分支闭环，不是全局资金恢复。

2026-10-04 任务提交历史与对账记录：GET /jobs/{id}/submissions在既有ADMIN/PURCHASER权限下返回最多100条price.process提交摘要，ADMIN可见该任务全部提交，PURCHASER仅见自身记录；先验证任务存在，脱敏字段沿用commands摘要。此历史是有键命令的提交历史，同键HTTP重试不新增执行；无键/旧未绑定资源的调用和进程崩溃前未保存的异常不被补造。

POST /commands/{id}/reviews仅ADMIN，必须Idempotency-Key，body为expectedStatus（PROCESSING/SUCCEEDED/FAILED）及1至500字reason。事务内锁定目标命令并核对当前状态，同事务保存command.review审计与审阅命令成功响应，原键精确重放。响应resolution=REVIEW_RECORDED_NO_STATE_CHANGE；不变更目标命令的状态、响应、错误、时间，也不执行或补偿业务。目标不存在404/状态变化409；不允许审阅command.review避免审阅互锁。记录核验意见不等于解除未知结果，自动重跑/伪造终态仍禁止。

2026-10-04 命令诊断：GET /commands仅返回当前登录账号最近命令摘要（limit默认50，1至100），不接受客户端账号切换；GET /commands/stale仅ADMIN可查询expiresAt已过且仍PROCESSING的记录。摘要包含命令ID、账号、action、资源ID、traceId、状态/时间、脱敏errorCode、stale及恢复建议，不返回幂等键/请求hash/原错误体/成功业务响应。未知异常尽力持久化COMMAND_OUTCOME_UNKNOWN和observedAt，仍PROCESSING/finishedAt为空；诊断写失败不掩盖原异常，也不修改终态。price.process开始即绑定PriceChangeRun资源ID，明确失败仍保存原HTTP状态/业务码。无迁移，不是任务级完整尝试历史或人工解除接口。

命令只读对账顺序：管理员GET /commands/stale取得命令ID/traceId/action/resourceId；结合对应资源GET（价格任务用GET /jobs/{id}及GET /jobs/{id}/adjustments）、审计日志、资金/订单账务记录核对。expiresAt仅用于筛查，不证明业务未执行；UNKNOWN或无诊断的PROCESSING不能删除、改FAILED、换键或直接重跑。即使资源已完成，也不能据此虚构原响应并改命令成功。当前仅提供查询证据，人工决策/解除工具和旧非原子调用补偿仍待设计验收；不得把本条算作恢复闭环。

2026-10-04 有键价格任务执行：POST jobs/:id/process可选Idempotency-Key，命令price.process绑定任务ID，同事务提交价格/资金/调整/任务状态、完整结果及审计；成功原键精确重放，未知故障保留PROCESSING且不得重新执行。无键调用兼容原行为。getRun支持同事务读取结果；不新增自动重试、失败原因字段或长期命令对账。本条覆盖下方历史任务未原子化说明。

2026-10-04 采购编辑事务更新：带Idempotency-Key的items PATCH/assign POST与要求键的reallocate POST同事务保存资金/明细/目标单、命令成功响应和审计。响应在同事务通过完整详情查询构造，包含商品/供应商名称、进度、拒单处理和运单摘要，成功原键重放该原始响应，不读未提交的根客户端。原价格/单位/模板资格、版本及资金锁校验保持。74新增服务/DB专项通过；无键编辑/分配仍兼容原独立业务后审计，不算有键恢复。价格任务及长期处理中对账尚未完成，无新接口/迁移或全局恢复闭环。

2026-10-04 采购主链与有键价格发布原子性更新：purchase-requests创建、确认、拒绝同事务提交资金/申请/拆单、命令成功响应和审计。带Idempotency-Key的price-changes共享/模板发布同事务保存实际版本、任务/影响单、模板版本变化、命令结果及新增price.publish审计，原原因/价格/生效时间可追溯。失败整体回滚、成功原键精确重放，未知仍PROCESSING。无键价格发布仍走兼容独立服务、不算新增幂等/审计；采购编辑/分配/重分配和jobs/:id/process未纳入本批原子化。58服务/DB专项通过，无新接口/迁移；不是全局恢复闭环。

2026-10-04 差额处置原子性更新：既有创建和确认接口同一个显式事务保存差额单/明细、命令成功响应和审计；COMPANY_TO_STORE的CREDIT门店调整确认后，申请有效已付/付款状态也在该事务刷新。原账户/申请锁顺序、来源去重、抵扣目标额度/结算通道和接收方向scope校验保持，失败整体回滚，未知仍PROCESSING不得自动重执行。36真实DB专项通过，覆盖两来源、两方式、故障、并发及越权；无新写接口/迁移。采购/价格及长期处理中对账尚未完成同类闭环。

2026-10-04 付款原子性更新：payment-records的创建、确认、拒绝、取消四个既有写接口使用同一显式事务保存业务、命令成功响应和审计。确认的核销分配、结算快照、超付款，及拒绝/取消释放占用一并提交或回滚。登记凭证改为owner/READY/PAYMENT/未关联条件更新，更新数不符触发PAYMENT_EVIDENCE_INVALID且回滚，禁止并发偷换凭证。既有版本、结算通道及角色scope保护保持；确定失败重放HTTP状态/错误码，未知仍PROCESSING不可自动重执行。52真实DB专项通过，不新增接口/迁移；差额、采购/价格及长期处理中对账还未完成原子性闭环。

2026-10-04 财务账户写入的原子性更新：既有充值、额度PATCH、清账POST接口在同一个显式Prisma事务中保存业务、命令SUCCEEDED/响应和审计；锁命令后重读终态，重复旧started句柄不会重复操作，漏保存成功状态则整体回滚。额度更新在现有账户行锁内重新验证版本/已用额度，缺失账户仍404。确定失败写FAILED；未知结果仍PROCESSING且不可自动执行，终态不会被迟到fail覆盖。本次无新接口/迁移，未推广到付款、差额、采购/价格入口或长期处理中对账，不能作为全局恢复闭环。

2026-10-04 已清挂账供应商拒单分支已验收，覆盖下文拒单仍受保护的旧说明。既有reject事务创建来源sourceRejectedOrderId的STORE负向差额；金额为有效已付减既有待处置差额，保留原netPaid/ClearingItems，释放未清额度。采购既有reallocate支持取消/同或新供应商及账期切换；新CREDIT分配独立，申请付款汇总排除REJECTED/CANCELED订单。既有adjustments列表/详情增加ORDER_REJECTION与sourceRejectedOrderId，通过原difference-disposals线下退回/抵扣及接收方确认，不新增写接口或自动转款。59迁移，20专项/84完整集成通过；不是任意已付款订单取消或全量M4验收。

2026-10-04 已确认差额后的涨价已验收，覆盖下文“再次涨价待实现”：内部loadFundingPaymentStates以挂账原netPaid减已CONFIRMED的门店负向price/shortage差额处置计算effectivePaid，原字段/清账历史保留。重算所需挂账、申请paidAmount/paymentStatus及少收超付按effectivePaid处理；未确认部分仍触发既有CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED，全部确认后按额度重算。COMPANY_TO_STORE调整处置确认对关联CREDIT申请加资金锁，确认与付款汇总原子更新。无新接口/迁移；线下退回及抵扣、部分/并发确认、额度回滚/重新清账通过76项完整集成。已清拒单/取消/重分配仍未完成。

2026-10-04 已清挂账历史降价已验收：价格任务及冻结收货检查向资金同步传入内部priceAdjustmentId，仅匹配本订单负向PriceChangeAdjustment、实际ClearingItem及已有差额覆盖时，按新增超付量生成STORE差额单。保留netPaid/历史清账，只释放未清额度，无新接口/迁移。CREDIT负向STORE冻结文档由资金证据生成，createFrozenPriceDocuments不重复创建。连续差额保留独立可处置列表/详情身份，其他渠道净额展示不改。差额后的涨价409 CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED且回滚，须继续实现有效已付/退回抵扣对账；已清拒单仍受保护。11专项/75完整集成通过，不表示这两个剩余流程完成。

2026-10-04 数据库恢复验收通过，取代下文“待真实DB验收/未发布”的阶段状态：已清挂账少收6项专项及70项完整集成通过，支持既有差额单线下退回/公司账期抵扣，保留清账及netPaid。已清120、目标130少收到104只记差额16并释放额度10；无已付的CREDIT少收仅释放额度，不因人工冻结应收快照生成退款债权。无新接口或迁移；已清历史降价/拒单仍受保护，完整M4未关闭。

2026-10-04 待真实DB验收的已清挂账少收：adjustAcceptedShortage保留netPaid与ClearingItem；调减先释放creditOutstanding，仅将max(netPaid-newTarget,0)-max(netPaid-oldTarget,0)的新增超付创建STORE负向AdjustmentDocument。不自动写储值退款流水；既有difference-disposals线下退回/抵扣及确认复用。资金同步仅允许已有sourceDiscrepancy STORE调整覆盖且target未再降低的超付，新增历史降价/拒单仍拦截。少收后付款状态计入运费。无新接口/迁移；构建/单元通过但本地DB不可达，未完成数据库验收或发布，不覆盖下文其他负向调整边界。

2026-10-04 清账付款汇总：createClearing事务先锁账户，再按排序锁受影响申请；清账后按requestFundingWhere累计netPaid，与申请销售商品金额加有效订单运费比较，原子更新paidAmount/paymentStatus。不调用synchronizeRequestFunding、不改shortfallAmount、不再次扣余额。无申请独立分配兼容；版本/金额/账户冲突整体回滚。Web/原生中文展示CLEARED_CREDIT_ADJUSTMENT_REQUIRED且保留确定失败语义。取代下文“申请付款汇总即时刷新待完成”，不表示负向独立调整已实现。

2026-10-04 已清挂账资金：内部requestFundingWhere保留active分配，以及有真实ClearingItem且netPaid>0的非活动CREDIT分配。价格重算/收货完成/少收同步读取；涨价复用原分配，仅对targetAmount减去netPaid后的差额增加creditOutstanding，剩余额度为0时保持inactive。低于已付金额的调价、少收、拒单返回既有CLEARED_CREDIT_ADJUSTMENT_REQUIRED并回滚，不修改历史清账、不自动转储值退款。无新接口或迁移；独立结算调减和清账后的申请付款汇总即时刷新仍待完成。

2026-10-04 原生快速改价命令：POST /price-changes继续仅ADMIN/PURCHASER；请求提供idempotency-key时按actor/action price.publish/body建立命令，Commands.perform对SUCCEEDED返回原PriceQuote，对FAILED重放原错误，对PROCESSING返回409且不重复发布。成功记录PriceVersion及完整实际结果，原生按原参数原键恢复；旧无键调用保持兼容，不表示全局保护或事务/命令崩溃窗口已关闭，无新迁移。原生共享/模板取价、影响、版本、GET job和显式process复用现有契约；模板供货价只读，修改供货成本走共享价格。重算未知响应先GET核对任务，不盲目再执行。自身资料复用有权限/范围投影的GET stores/:id、suppliers/:id及catalog，不给供应商新增PATCH或价格权限。真实HTTP/开发者工具功能通过，截图未验收。

2026-10-04 采购异常及正调整更新：GET /purchase-requests/:id/edit-catalog仅ADMIN/PURCHASER，校验待采购/待补款且无执行单，使用原request.templateId（归档/不存在404），不接受客户端任意模板、不依赖当前门店绑定；items-preview增加templateId。公共目录过滤停用/归档供货方。POST采购reject统一Commands.perform及SUCCEEDED-only重放；reallocate再次锁定目录/供应商/资金申请，验证原模板有效商品/供货资格与目标未首次发货，全部取消保存CANCELED并复用原资金释放。付款preview放行公司付供应商时，门店应收使用原冻结快照＋正调整，确认收款识别两种既有调整ID编码；不改历史记录或全局ID契约。门店账单adjustmentItems增加可选supplierOrderId用于来源选择。真实HTTP/浏览器专项通过，无迁移，完整财务/崩溃核对仍开放。

2026-10-04 直结渠道修正：GET /supplier-statements及/supplier-store-statements的公司供货价应付不包含SUPPLIER_TERM基础订单或以该订单为来源的差额调整；储值/挂账/公司账期仍纳入。直结使用/direct-statements及STORE_TO_SUPPLIER收款确认，不新增应付或改写已付历史。四模式/调整期单元和真实直结浏览器验收通过，无迁移。

2026-10-04 差异命令更新：adjustments/difference-disposals启用BusinessScopeGuard；未绑定或角色/范围不匹配403。差异create/confirm使用Commands.perform，FAILED重放原错误，PROCESSING409不执行业务。GET /difference-disposals/:id的items新增可空targetSupplierOrderNo，按已保存targetDebitItemId解析源订单并查询实际订单号，供确认核对；不改抵扣金额/资金规则，无迁移。既有同方向所属门店/供应商与原金额/来源/退回流水/抵扣容量/唯一处置校验保留。

2026-10-04 付款命令更新：POST /payment-records与POST /payment-records/:id/cancel改用Commands.perform，SUCCEEDED重放原结果，FAILED重放原错误，PROCESSING409不再执行业务。供应商范围调用confirm/reject对STORE_TO_COMPANY返回404，即使supplierId匹配；COMPANY_TO_SUPPLIER/STORE_TO_SUPPLIER保留。channel仍由持久化direction派生，不新增字段。正式Web消费账单已有settlementItemId及预览sourceVersion/payableAmount，不自行编码ID或计算金额。

2026-10-04 最新账户明细契约：GET /stores/:id/credit-items允许ADMIN/HQ_FINANCE/STORE/STORE_FINANCE，非公司角色须正确自身门店绑定。仅查询本门店active且creditOutstanding>0的FundingAllocation，返回fundingAllocationId、supplierOrderNo（历史可null）、requestId、method、creditOutstanding（两位小数字符串）、version。用于真实明细选择，不替代POST clearings/preview及提交时版本/金额核验。新增HTTP范围及金额/版本读取断言；无schema迁移。

> 版本：v1.0 详细设计评审稿，2026-09-24
> 基线：[需求 v1.4](./requirements.md)、[架构设计](./architecture-design.md)
> 配套：[数据库设计](./database-design.md)、[页面设计](./page-interaction-design.md)
> 状态：历史接口设计基线，现有实现及验收进度以 `docs/progress.md`、`docs/continuation.md` 和下文最新实现更新为准。

## 1. 通用契约

2026-10-04 正式门店：purchase-requests/catalog/shipments现在对缺所属范围或角色/范围不匹配的业务账号403 SCOPE_REQUIRED；有STORE范围的STORE/STORE_FINANCE只能读自身申请/目录/发货，财务写权限不扩大。POST `/shipments/{id}/receipts`使用Commands.perform，明确业务失败记录FAILED、同键重放原错误而非空成功，PROCESSING409且不重执行。原expectedOrderVersion/expectedReceiptRevision、锁定行、私有图片归属/版本规则不变。正常Web复用下单预览/双来源批准/上传会话接口，门店页面仅显示销售侧报价；全API价格字段隐私审计未关闭。业务事务与命令/审计崩溃窗口仍开放。

2026-10-04 补发待发修正：订单详情remainingToShipQuantity与shipment-preview共用remainingNormalShipmentQuantity，计算max(0,订购-累计已发-永久减少+历史实际缺口分配量)。补发属于旧发货替换，不消耗原普通待发；本次preview剩余量同样加回本次gapAllocations之和。只读取实际ShipmentGapAllocation，不补造旧历史，不改价格/收款公式。真实Web验证部分发货/补发/余量发货及金额50/付款余额0；完整四模式资金验收仍开放。

2026-10-04 供应商入口：GET `/discrepancies`仅ADMIN/SUPPLIER，返回当前OPEN/REPLENISH_PENDING的id/status/missingQuantity/productName/supplierOrderNo，自身供应商范围过滤。supplier-orders详情行增加remainingToShipQuantity，Decimal计算订购减已发减永久减少并取零下限。supplier-orders/discrepancies/payment-records业务账号缺范围或角色/范围不匹配403 SCOPE_REQUIRED；公司授权角色保留原访问。supplier-orders对供应商专属角色响应移除salesGoodsAmount/salesUnitPrice/salesLineAmount/purchaseSalesUnitPrice/salesPriceVersionId，供货字段保留；公司读取不变。其余API字段隐私及范围全审计未关闭，无新财务公式/迁移。

2026-10-04 正式采购：POST `/purchase-requests/{id}/items-preview`仅ADMIN/PURCHASER，body同PATCH items（expectedVersion/reason/items），返回requestId/version/items/totals，无申请或资金写入。创建/预览可选expectedTemplateId；创建/编辑行可选expectedPriceVersionId/expectedSupplyPriceVersionId；批准模板/来源变化409。POST assign可选expectedPrices[{requestItemId,priceVersionId,supplyPriceVersionId}]，完整且无重复覆盖itemIds。PATCH items/POST assign可选Idempotency-Key兼容旧调用，同键同body重放原结果，FAILED原错误，PROCESSING409。编辑/分配成功审计一次，保留编辑原因；Web恢复保留PATCH/POST方法。既有资金同步/事务关联来源重检保留，编辑预览不声称完整资金结论；业务事务与命令/审计崩溃窗口未关闭。

2026-10-04 自身资料/归档：GET `/stores/{id}`、`/suppliers/{id}`允许公司授权角色或账号自身范围，缺范围/跨范围403。GET `/suppliers/{id}/catalog`同供应商范围检查，返回supplierId/items：id/name/sku/specification/unitName/isActive、公共supplyPrice/supplyPriceVersionId；未发布NULL，无salesPrice/defaultSalesPrice/利润。原商品配置GET/PUT权限不扩大。POST `/suppliers/{id}/archive`仅ADMIN/PURCHASER，expectedVersion必填，旧版本409，已归档以当前版本重复返回现状。SupplierView增加isArchived；归档保留资料/订单/价格，删除当前供货/模板供货/结算关联，禁止编辑/重新关联；完整写审计及原生页面仍未完成。

2026-10-03 供应商账单明细更新：总单/分店详情lines增加amountBasis（FROZEN或CURRENT_ORDER）、storeName、products及productAmountBasis=CURRENT_ORDER；商品包含orderItemId/productId/sku/productName/specification/unitName、orderedQuantity/effectiveQuantity/receivedQuantity、supplyUnitPrice/supplyLineAmount，不额外暴露销售价。productGoodsAmount按Decimal累加，goodsReconciliationAmount为本结算货款减当前商品货款；旧冻结表仅保存总金额，不能把当前商品当作冻结历史。分店摘要补storeName和调整来源adjustmentId/supplierOrderId；总单storeCount包含仅调整门店。精确parentStatementId关联、原settlementItemId及金额计算保留。非法UUID编码身份和外/空供应商scope拒绝。仅新增读字段，无迁移/财务写规则变化。

2026-10-03 角色恢复更新：`POST /purchase-requests/{id}/reallocate`现在要求Idempotency-Key，与确认、发货、运费申请/审核、拒单、差异处理和付款审核保持同键原请求重放。本批角色接口对PROCESSING返回409/COMMAND_PROCESSING而不再次执行；明确4xx业务错误记FAILED，再次请求返回原错误，不当作空成功。未知5xx保留PROCESSING等待核对；业务事务和命令成功/审计写入尚非同事务，崩溃窗口不能自动重执行。原生恢复记录按服务地址/操作人/角色存储原参数和版本，401/403、408/429、5xx或处理中不删除原提交；本机最近20条不是服务端完整审计历史。

2026-10-03 商品资料更新：商品读模型增加可空 specification（240字）、brand（120字）、storageCondition（AMBIENT/CHILLED/FROZEN/WARM）及 imageFileId/imageFile 安全元数据。创建/修改允许省略保留、null清空，文本空白清空。修改按 expectedVersion 原子比较更新，冲突409；普通资料不发布价格。PRODUCT会话仅ADMIN/PURCHASER创建，JPEG/PNG最大2MiB；完成要求实际解码成功、单帧、正方形且边长不超过4096。新绑定图片必须本人上传、READY、PRODUCT且未关联其他业务，文件行锁与商品保存同事务。门店下载要求有效模板可见且启用商品，供应商要求商品关联；门店无权读未绑定或已替换图片。真实设备和OSS尚未验收。

2026-10-03 收货凭证更新：文件用途增加 `RECEIPT`，仅接受JPEG/PNG、每张最大10MiB，沿用私有目录、内容签名/校验和及24小时未完成会话清理。收货命令可提交 `evidenceFileIds`（显式提交时1至6个、不重复）；事务内只允许当前操作人上传、READY、正确用途且未关联其他付款/收货的文件，绑定到新收货版本，失败整体回滚。原生门店新提交/更正必须先上传至少一张；旧API省略该字段暂保持兼容，尚未完成全入口必传切换，不能视为S05全部验收。历史无附件版本仍可读。收货响应及当前批次详情返回 `evidenceFiles`（id/filename/mimeType/sizeBytes），供应商差异详情返回该差异所属收货版本的凭证。下载允许上传者、关联门店/供应商及总部财务/管理员，拒绝空scope和无关主体；旧版本凭证不被更正覆盖。真实相机/相册、断网和OSS尚待外部验收。

门店履约读模型补充：`fulfillmentStage` 为 pending/receive/completed/canceled，按当前商品归属和有效执行单计算；已改派/取消的历史拒单不计为未完成义务，同供应商新执行单可以接替旧拒单。详情历史执行单通过 `rejectionHandled` 标记保留历史，不删除原单。

2026-10-01 门店展示更新：目录增加 `store`（名称、地址、联系人/电话）及商品 `categoryName/unitName`、供应商 `supplierName`。订货列表增加 `supplierCount/completedSupplierCount/canceledSupplierCount/rejectedSupplierCount`，拒单不等同于取消；详情增加供应商名称及按批次 `shipments`（发货时间/物流号/当前收货时间和版本）。既有门店范围校验保持不变。订货及收货创建对同幂等键仍为 PROCESSING 的命令返回409 `COMMAND_PROCESSING`，客户端须保留原请求/编号核对，不再次执行业务写入。

2026-09-30 冻结发货差额更新：发货永久减量生成 `PERMANENT_REDUCTION`，冻结后新增运费生成独立 `FREIGHT_CHANGE`；B05 列表/详情返回 `sourceShipmentId`，商品/运费分别计入 `goodsAdjustmentAmount` / `freightAdjustmentAmount`。数据库以发货来源、侧别、REDUCTION/FREIGHT 分类唯一约束防重复，原冻结快照不变。减量行保留数量/单价快照；运费差额无商品行。已退入储值的商品差额不能二次退回；储值/挂账的门店正向运费差额仍不能走二次应收付款。资金不足使整次发货事务回滚，已清信用下降仍返回 `CLEARED_CREDIT_ADJUSTMENT_REQUIRED`。

基础路径 `/api/v1`。所有业务接口要求登录，除登录、会话建立和最小健康检查外无匿名访问。Web 和小程序使用同一业务接口；角色和数据范围从会话取得，不接受客户端传入角色绕过鉴权。

| 项目 | 约定 |
|---|---|
| ID | UUID 字符串；展示单号另有 `documentNo`，不以单号代替归属校验 |
| 金额/单价/数量 | 十进制字符串；金额 2 位、单价数量最多 6 位；禁止 NaN、Infinity、指数形式和浮点 JSON number |
| 时间 | 时间戳带时区，如 `2026-09-15T10:00:00+08:00`；日期 `YYYY-MM-DD`；业务周期统一上海时区 |
| 成功 | 单对象 `{data, traceId}`；分页 `{data:{items,page,pageSize,total},traceId}` |
| 错误 | `{code,message,traceId,details}`；details 不泄露其他主体或公司成本 |
| 状态码 | 创建 201；查询/动作 200；任务受理 202；参数 400；未登录 401；功能无权 403；无资源或无可见范围 404；状态/版本/资金冲突 409；限流 429；临时故障 503 |
| 分页 | 默认 page=1、pageSize=20，最大 100；排序字段白名单，默认时间倒序+ID 保证稳定 |
| 金额输入 | 客户端只能提交数量、允许录入的运费或线下金额；订单价格和应付由服务端生成 |
| 修改 | 所有可变对象修改必须带 `expectedVersion`；列表展示的旧版本不得静默覆盖新状态 |
| 操作权限提示 | 查询可返回 `availableActions`、`blockers`；命令执行时仍重新授权和校验 |

创建、修改、删除及业务命令使用 `Idempotency-Key` 请求头，最长 128 字符。纯查询、影响预览不需要。键按账号+动作隔离，请求摘要包含资源 ID 和标准化请求体；同键异参返回冲突。

同键已成功返回原业务结果并重新校验当前访问权限；处理中返回 202 及 commandId；已明确拒绝返回原拒绝结果。补充余额或修改输入后属于新尝试，使用新键；原操作结果不确定时必须先按原键查询，不能产生新的扣款尝试。

查询命令结果用 `GET /commands?key={key}&action={action}` 或 `GET /commands/{id}`，仅操作人或授权内部角色可见。业务提交及命令成功状态同事务；后台异步命令须有租约和恢复机制。

## 2. 公共数据结构与字段隔离

### 2.1 角色代码

`STORE` 门店、`STORE_FINANCE` 门店老板/财务、`SUPPLIER` 供应商、`PURCHASER` 采购、`HQ_FINANCE` 总部财务、`ADMIN` 管理员。下文“门店侧”读权限包括 STORE/STORE_FINANCE；下单和收货由 STORE，付款登记按门店账款权限执行。ADMIN 按 SRS 获得管理权限，代操作记录管理员身份。

### 2.2 查询投影

| 对象 | 门店侧 | 供应商侧 | 采购/总部财务/管理员 |
|---|---|---|---|
| 订单商品 | 商品、数量、销售价、门店应付 | 商品、数量、供货价、自身应收 | 两种价格及授权利润 |
| 资金 | 自店余额、挂账、付款缺口 | 自身待收款；不返回门店账户余额 | 全部有权字段；采购只读账户，不可充值清账 |
| 价格变更 | 对自身订单的销售金额变化 | 对自身订单的供货金额变化 | 原价新价、影响范围、两侧差额 |
| 账单 | 自店销售口径 | 本供应商供货口径 | 按单据方向分别查询 |
| 日志/文件 | 自己订单相关可见内容 | 自己订单相关可见内容 | 授权操作记录与凭证 |

禁止返回全实体再由前端隐藏成本。具体采用 `StoreOrderView / SupplierOrderView / InternalOrderView` 等不同 DTO；同一接口按活动身份返回一种投影，并带 `viewType`。

### 2.3 主要结构

```text
FundingSummary = {
  stored: { required, paid, remainingToDebit, available, shortfall },
  credit: { required, occupied, available, shortfall },
  canConfirm: boolean
}
OrderView = {
  id, documentNo, version, viewType, requestId, store, supplier,
  fulfillmentStatus, settlementMethod, storeFundingStatus?, supplierSettlementStatus?,
  firstShippedAt?, originalPeriod?, items, shipments,
  totals, availableActions, blockers
}
Period = { type, key, startDate, endDateExclusive, timezone: "Asia/Shanghai" }
FileReference = { id, filename, mimeType, sizeBytes, status }
Blocker = { code, message, itemId? }
```

`FundingSummary` 仅门店自身及授权公司人员可见；供应商只取得是否可发货及必要阻断理由，不取得门店余额。金额字段全部为字符串，未适用状态为空而不是伪装成已结清。

## 3. 登录、主数据和模板接口

### 3.1 身份、文件与公共服务

| 编号 | 方法与路径 | 输入/输出 | 权限及边界 |
|---|---|---|---|
| I01 | `POST /auth/login` | username、password、client；返回会话与本人角色范围 | 后台创建账号；登录限流；不开放自助注册 |
| I02 | `POST /auth/wechat-session` | 一次性平台 code；返回已绑定账号会话或短期绑定状态 | 服务端校验平台 code；不把 openid 作为登录凭证直接信任 |
| I03 | `POST /auth/bind-wechat` | 绑定会话、已有账号认证信息 | 绑定方式技术验证后锁定；已有身份禁止被他人覆盖 |
| I04 | `POST /auth/refresh`、`POST /auth/logout`、`GET /me` | 轮换、撤销、本人信息 | Web 安全 Cookie+CSRF，小程序令牌；权限变更及时失效 |
| I05 | `GET/POST /users`、`PATCH /users/{id}` | 账号、状态、角色、合法数据范围、expectedVersion；scope 为 COMPANY 或绑定一个 storeId/supplierId | ADMIN；停用撤销会话，不返回 passwordHash |
| I06 | `POST /files/upload-sessions` | purpose、filename、mimeType、sizeBytes、可选业务对象；返回短期上传凭据 | 登录且具有对应用途权限；业务对象先校验范围 |
| I07 | `POST /files/{id}/complete`、`GET /files/{id}/download` | 服务端验证完成；授权下载地址 | 真实类型、大小、对象存在与归属；凭证 READY 后才可提交单据 |
| I08 | `GET /notifications`、`POST /notifications/{id}/read` | 分页消息及已读 | 只可操作本人消息 |
| I09 | `GET /health/live`、`GET /health/ready` | 最小状态；不返回数据库凭据或内部拓扑 | 运维用途；readiness 检查必要依赖 |

当前 I06/I07 私有目录实现支持 `PAYMENT`（JPEG/PNG/PDF）和 `RECEIPT`（JPEG/PNG）用途，单文件最大10MiB；上传会话24小时有效，创建新会话时最多清理100条过期未完成、未关联记录及文件。内容签名与SHA-256在服务端校验，私有目录由 `PRIVATE_FILE_DIR` 指定。B07至少需要一个已完成付款凭证，且凭证必须由登记人上传；下载限上传者、关联门店/供应商及总部财务/管理员。内容类型不符时立即删除文件内容并保留REJECTED元数据。

### 3.2 主数据接口

| 编号 | 方法与路径 | 输入/输出 | 可操作角色 |
|---|---|---|---|
| M01 | `GET/POST /stores`、`GET/PATCH /stores/{id}` | 名称、分组、联系人、地址、收货信息、类型、状态 | 写 ADMIN；采购/财务按业务读取，门店只读自身 |
| M02 | `GET/POST /suppliers`、`GET/PATCH /suppliers/{id}`、`POST /suppliers/{id}/archive` | 联系和银行资料、唯一配送、默认结算、周期、运费开关等 | 写 PURCHASER/ADMIN；供应商只读自身非敏感配置 |

2026-10-04 目录资料实际增量：GET/POST /brands、PATCH/DELETE /brands/{id}，PATCH/DELETE /categories/{id}和/units/{id}；列表读ADMIN/PURCHASER/HQ_FINANCE，写ADMIN/PURCHASER。修改/删除要求expectedVersion；分类可改name/parentId（null回一级）/sortOrder，最多两级，子分类/商品引用拒绝删除。品牌名称唯一，单位/品牌可改name；引用商品或换算的单位禁止删除。商品新增可空brandId/barcode，旧brand文本与brandId不能同时提交；空值可清除，旧文本写会关联品牌库，品牌改名同步文本且使旧商品编辑版本失效，不新增价格版本。

2026-10-04 单位换算实际增量（替代此前“快照未完成”状态）：PATCH /products/{id}/purchase-unit，ADMIN/PURCHASER写，body为expectedVersion及conversion；conversion=null关闭，启用时为{purchaseUnitId,salesUnitsPerPurchaseUnit}。只维护一组采购→销售关系，比例为正、最多8位小数且符合Decimal(20,8)，两单位不同且存在，原子商品版本校验；修改不发布价格、不重算历史金额。

商品/门店目录增加purchaseUnitConversion，门店目录另有purchaseUnitName；目录供应商增加purchaseSalesPrice/purchaseSupplyPrice，按销售单位单价乘比例精确推导，仅用于展示，不作为另一套金额基准。申请预览/创建与PATCH商品行增加可选unitId/expectedProductVersion；省略单位仍是销售数量。采购输入换为销售数量后必须精确落入Decimal(20,6)，满足销售口径起订量与倍数，否则409 UNIT_CONVERSION_INVALID或INVALID_ITEM_QUANTITY；配置版本变化409 VERSION_CONFLICT，不悄悄按新比例提交。

RequestItem/OrderItem新增可空JSON unitSnapshot，记录salesUnitId/name、purchaseUnitId/name、salesUnitsPerPurchaseUnit、inputUnitId/inputQuantity和productVersion。新建/更换行保存快照；写入共享目录锁内重验元数据，确认拆单/拒单改派复制原快照。详情增加unitName/unitBasis及purchaseSalesUnitPrice/purchaseSupplyUnitPrice（按原比例与本行当前交易价推导）；金额、资金、发货、收货统一保留销售口径，未改变现有合法历史调价规则。账单商品/收货详情优先快照单位。旧记录不回填，unitBasis=LEGACY_UNKNOWN；有未知历史行的单位仍409 UNIT_HISTORY_SNAPSHOT_REQUIRED，快照齐全可改名且使相关商品版本失效。交易商品销售单位仍保护，不能把原数量重解释。目录记录不存在404、旧版本409、引用/层级冲突409；品牌迁移只连接真实旧文本。

下单明确业务拒绝使用现有CommandsService.perform登记FAILED，同幂等键仍返回原错误；成功重放仍返回原申请和原换算数量，配置变化不新建订单。未知结果仍保留PROCESSING，不宣称完成崩溃窗口与长期处理中处置。原生目录/购物车单位选择、报价及确认展示已接入；正常Web门店下单入口仍未迁移，Web提供配置与订单历史单位展示。

2026-10-04 模板操作实际增量：模板返回tag/remark（旧可空）；POST /templates要求code/name/tag，名称写事务串行拒绝TEMPLATE_NAME_EXISTS；PATCH /templates/{id}用expectedVersion编辑name/tag/remark；POST /templates/{id}/copy要求expectedVersion及新code/name/tag，不复制门店，保留商品/供货优先级/启用和结算配置。POST /templates/{id}/archive过期门店绑定、删除当前商品与覆盖，保留模板及历史订单。DELETE /templates/{id}/supplier-settings/{supplierId}要求expectedVersion，清除覆盖并返回usesDefault=true及当前供应商默认，保留直接账期等价校验。上述角色均ADMIN/PURCHASER；覆盖PUT仅允许商品已关联的供应商，周期限制四种枚举。模板商品规则及专属价格范围仍未完成，当前共享PriceScope不会因复制产生新版本；全写审计仍开放。

2026-10-03 资料字段实际交付：Store 列表/创建/PATCH 返回 groupName、storeType（DIRECT/FRANCHISE/JOINT）、receiptAddress/receiptContactName/receiptContactPhone；三收货字段一起填写或一起 null 使用门店地址与联系人。创建要求联系人/电话/地址/类型；旧资料允许未涉及字段的局部更新，不能清空必填字段。Supplier 返回 address、bankName、bankAccountName、bankAccount、taxpayerId、invoiceTitle、requiresFreight、supplierType（HEADQUARTERS/DIRECT，可空）、settlementCycleDescription、remark；创建要求地址/银行/税务/抬头与联系人，运费默认 false，周期限 IMMEDIATE/WEEKLY/HALF_MONTHLY/MONTHLY；可选字段可 null 清除。权限沿用管理列表角色与写边界；GET 单条自身资料和 archive 仍不是已实现声明。

迁移新增资料列可空，历史资料不伪造。新拆单/改派新单保存 requiresFreightSnapshot，并在订单详情返回；false 的非零运费申请/发货预览返回409 FREIGHT_NOT_ALLOWED，零运费保留原发货规则，true 仍须已有运费确认；旧订单 null 保持原行为，更新供应商资料不改变旧单快照。配送 destination 和门店 catalog.store 读取当前独立收货信息或门店回退值，不宣称历史收货快照。既有金融金额/价格版本不因资料更新而重算。
| M03 | `GET/POST /products`、`GET/PATCH /products/{id}`、`POST /products/{id}/archive` | 商品字段、默认价、起订量、倍数、图片、单位换算 | 写 PURCHASER/ADMIN；供应商只读自己商品；门店走可订目录 |
| M04 | `GET/POST /categories`、`PATCH/DELETE /categories/{id}` | name、parentId、expectedVersion | PURCHASER/ADMIN；二级限制；存在商品阻止删除 |
| M05 | `GET/POST /brands`、`PATCH/DELETE /brands/{id}`；单位同路径规则 `/units` | name、expectedVersion | PURCHASER/ADMIN；使用中不可删除 |
| M06 | `GET/PUT /suppliers/{id}/products` | 产品 ID 列表、expectedVersion；逐条检查 | PURCHASER/ADMIN；调整当前关系不删除历史 |
| M07 | `GET/POST /collection-accounts`、`PATCH /collection-accounts/{id}` | 公司收款账户资料、状态 | HQ_FINANCE/ADMIN |

供应商和商品写入字段与 [数据库设计 §3](./database-design.md) 一一对应；价格版本变更必须使用 P02，不允许 PATCH 商品或模板绕过价格历史及影响重算。`defaultSalesPrice` 只初始化配置，不改已有模板有效报价。

2026-10-04：POST /products 必须传字符串defaultSalesPrice（非负、最多6位小数、小于100000000000000），sku可省略/null/空白；PATCH支持货号修改/清空及默认价修改，仍须expectedVersion。默认价不能传null清空；历史NULL支持不含该字段的部分修改。重复货号409 PRODUCT_SKU_EXISTS。商品响应defaultSalesPrice和sku可为null。模板商品响应新增initialSalesPrice（字符串/null）：首次关联保存商品默认价，重复保存/复制保留原值；仅初始化快照，不参与当前有效价格查询或重算，模板独立价格范围仍开放。

后续模板价格批次覆盖上段“独立范围开放”的状态：POST /price-changes 和 /prices/impact-preview 支持可选templateId；省略仍为共享范围，指定仅维护有效模板中已关联商品/供应商的销售价。模板supplyPrice必须等于该生效时间的公共供货价，否则409 TEMPLATE_SUPPLY_PRICE_READ_ONLY，不借模板发布改供应商成本。模板价生效前共享销售价兼容，成本始终来自公共版本。POST /prices/quote（productId、supplierId、可选templateId/effectiveAt，缺时间取现在）返回真实有效价及销售versionId/供货supplyVersionId；未知有效价404，不以初始化值冒充。发布会更新模板版本；price versions中供货价及supplyVersionId是发布/复制时的来源快照，旧缺源允许NULL，不随当前公共价变动重写。

模板PUT items支持isEnabled、minOrderQty/orderMultiple（正字符串、最多6位、可传null继承商品；省略保留已有）；GET template显示规则及供应商当前有效两价。首次关联初始化值仍不是有效价格发布。复制只建当前/未来销售配置、不复刻旧任务；供货价仍共享。新申请增加supplyPriceVersionId，原priceVersionId标识销售来源；新订单分别记录salesPriceVersionId/supplyPriceVersionId，旧NULL不回填。提交前版本变化409 VERSION_CONFLICT；直接账期当前/未来两价必须一致，不平衡发布回滚。

供应商结算/配送配置变更影响后续配置匹配，不改写订单结算快照。直接账期两价一致校验失败返回关联配置项，不允许保存半套非法配置。

### 3.3 模板与价格接口

| 编号 | 方法与路径 | 核心字段与结果 |
|---|---|---|
| T01 | `GET/POST /templates`、`GET/PATCH /templates/{id}` | name、tag、remark、expectedVersion；PURCHASER/ADMIN |
| T02 | `PUT /templates/{id}/stores` | storeIds、expectedVersion；整批原子绑定，任一门店已绑定其他模板则全部失败 |
| T03 | `PUT /templates/{id}/items` | 商品、起订量、倍数、候选供应商和优先级、expectedVersion；返回逐项校验错误 |
| T04 | `PUT /templates/{id}/supplier-settings/{supplierId}` | settlementOverride（枚举或 null）、expectedVersion；null 清除覆盖 |
| T05 | `POST /templates/{id}/copy`、`POST /templates/{id}/archive` | copy 带新名称和来源版本；复制不带门店；归档解除当前绑定 |
| T06 | `GET /stores/{id}/catalog` | categoryId、keyword、page；返回当前模板可订商品、销售价、起订规则和可用状态 |

2026-10-03 正式 Web 增量：`GET /suppliers/{id}/products` 返回 supplierId、productIds、version，允许 ADMIN/PURCHASER/HQ_FINANCE；供应商不能读取其他供货方配置。`GET /templates/{id}` 允许 ADMIN/PURCHASER，返回模板、storeIds、商品/供货优先级、settings；模板列表同时返回有效 storeIds。模板三个写入口同事务锁定模板、验证版本、修改配置并单调更新版本；绑定跨模板串行校验，避免一门店并发双绑。门店/供应商 PATCH 原子版本更新，关联商品 PUT 锁定供应商并同事务更新版本。首次价格预览无范围时仍计算实际影响订单。以上不代表本表其余主数据字段/接口已完成，详见 formal-workspace-acceptance.md。
| P01 | `POST /prices/impact-preview` | productId、supplierId、salesPrice、supplyPrice、effectiveAt；只读返回生效区间内未完成执行单及两侧金额净变化，排除已完成单 |
| P02 | `POST /price-changes` | productId、supplierId、salesPrice、supplyPrice、effectiveAt、reason；按 scope 事务追加单调递增 revision，并持久化 500 字符内原因。当前接口尚未实现批量发布和后台重算任务 |
| P03 | `GET /price-scopes/{id}/versions`、`GET /jobs/{id}`、`POST /jobs/{id}/process`、`GET /jobs/{id}/adjustments` | 版本历史、价格变更 run 状态及影响汇总；处理待重算明细并查询调整来源；按采购或相关内部权限查询 |

 T01-T05、P01-P03 的修改只允许 PURCHASER/ADMIN，采购小程序和 Web 的快速改价都调用 P02。预览不锁订单，也不保证提交时影响数不变。P02 允许同一 scope 追加同一生效时间的修订，并以最大 revision 生效；直接账期相关两价需要同步调整时使用同一 changes 数组。

## 4. 订货、采购确认与拒单

| 编号 | 方法与路径 | 权限 | 请求和结果 |
|---|---|---|---|
| O01 | `POST /purchase-requests/preview` | STORE/PURCHASER/ADMIN 代操作 | storeId、orderDate、items[{productId,quantity,inputUnitId}]；返回服务端金额、规则、资金缺口及 quoteVersion |
| O02 | `POST /purchase-requests` | 同 O01 | 同上+quoteVersion；不接受门店指定供应商、结算方式、单价；201 返回订货单和资金状态 |
| O03 | `GET /purchase-requests`、`GET /purchase-requests/{id}` | 门店自店、公司授权角色 | 筛选门店、日期、状态、资金缺口；供应商不可见未确认订货单 |
| O03a | `GET /purchase-requests/rejection-todos` | PURCHASER/ADMIN | 从当前商品分配和有效供应商单计算拒单待办，不依赖最近50条通知；返回 supplierOrderId/supplierOrderNo/purchaseRequestId/requestNo/storeName/supplierName/reason/createdAt。已改派或取消后不再作为待办，历史订单/通知不删除；同供应商重新推送后再次拒单仅保留最新有效拒单 |
| O04 | `PATCH /purchase-requests/{id}/items` | PURCHASER/ADMIN | expectedVersion、完整目标商品列表及拟供应商、reason；仅待采购确认，重算差额 |
| O05 | `POST /purchase-requests/{id}/reassign-preview` | PURCHASER/ADMIN | itemIds、supplierId、expectedVersion；逐行 eligible/reason，不修改分配 |
| O06 | `POST /purchase-requests/{id}/assign` | PURCHASER/ADMIN | 与 O05 相同；全部合法才整批应用，不悄悄跳过不合格商品 |
| O07 | `POST /purchase-requests/{id}/confirm` | PURCHASER/ADMIN | expectedVersion；原子资金复核、补扣、拆单，200 返回执行单 ID 列表 |
| O08 | `POST /purchase-requests/{id}/reject` | PURCHASER/ADMIN | expectedVersion、reason；原单取消，冲回有效扣款/占用 |
| O09 | `POST /supplier-orders/{id}/reject` | SUPPLIER/ADMIN | expectedVersion、reason；仅未发货，退回采购，不替供应商删除商品历史 |
| O10 | `POST /purchase-requests/{id}/reallocate` | PURCHASER/ADMIN | expectedVersion、rejectedOrderId、assignments[{requestItemId,supplierId? ,cancel}]、reason；未通过资金则保留待处理，不推送 |
| O11 | `POST /supplier-orders/{id}/reconcile-funding` | PURCHASER/ADMIN | expectedVersion；充值或清账后重新校验已确认订单的资金差额、补扣/占用并解除阻断 |

O01 的价格预览发生变化时，O02 返回 `QUOTE_CHANGED` 和有权查看的新预览，用户重新确认后提交。O02 储值不足仍返回 201 成功，不是下单失败；挂账超额返回 409 且整单回滚。O07 余额不足返回 409、当前 funding 和 version，不创建执行单。

O10 只处理拒单留下的待重分配商品；同次订货中目标供应商已经首次发货时返回 `TARGET_SUPPLIER_ALREADY_SHIPPED`。O11 不确认原始待采购订单、不发送新拆单；待采购单充值后必须使用 O07。已发货待补差额可以由 O11 处理，收货无需等待其成功。

### 4.1 下单成功但待补足示例

```json
{
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "documentNo": "PR202609240001",
    "version": 1,
    "status": "PENDING_CONFIRMATION",
    "funding": {
      "stored": {
        "required": "500.00",
        "paid": "0.00",
        "remainingToDebit": "500.00",
        "available": "100.00",
        "shortfall": "400.00"
      },
      "credit": {
        "required": "0.00",
        "occupied": "0.00",
        "available": "0.00",
        "shortfall": "0.00"
      },
      "canConfirm": false
    },
    "supplierOrderIds": []
  },
  "traceId": "22222222-2222-4222-8222-222222222222"
}
```

混合结算的储值组不足不先扣 100 元；挂账组若合法占用则仍记录其占用，只有挂账超额使整次下单失败。充值补足后采购确认按净差额扣足，不重复扣已有款项。

当前已实现的商品货款资金范围：O02 实际扣款/占用、O04/O05 草稿编辑差额、O07 拆单关联资金分配、O08 取消释放、O09 拒单释放、O10 改派重新占用及 O11 补扣。预览不是扣款，`funding.stored.paid` 为 0；创建结果中的 `paid` 为实际储值扣款，`available` 为扣款后余额。商品行保存结算方式/周期快照，拆单不采用后来修改的供应商默认方式。运费、独立永久减量、调价资金同步及 B01 储值/挂账不重复账期应收仍待完成，不能以本段视为全资金验收通过。

发货资金实现更新：F03 未冻结永久减量与实际发货运费已进入同一资金事务；资金不足/挂账超限整笔回滚，费用确认不会提前标记 USED。同版本并发仅一个成功，另一笔 `VERSION_CONFLICT`。`paidAmount` 可以包含已扣运费，不可简单截断为 `salesGoodsAmount`；商品货款仍单独展示，利润不包含运费。冻结后永久减量目前返回 `FROZEN_REDUCTION_ADJUSTMENT_REQUIRED`，等待冻结差额来源实现。调价资金、首次/完成核价与 B01 重复账期应收仍待完成。

调价任务实现更新：P03 处理任务同步已有资金分配和申请行价格；储值余额足够只补扣差额，不足则保留原已扣款及 shortfall，后续 O11 补足。降价退实际多扣款，流水来源为 priceChangeAdjustment.id；已退储值的门店负调价差额标记 DISPOSED，B12 重复处置拒绝。挂账超限返回 CREDIT_LIMIT_EXCEEDED，处理事务回滚、发布版本保留且任务仍 PENDING，恢复额度后可重试。已清挂账降额返回 CLEARED_CREDIT_ADJUSTMENT_REQUIRED，等待结算差额流程；首次/最终核价、冻结永久减量和 B01 重复应收保护仍待完成。

核价点实现更新：未冻结 F03 首发按实际首次时间取价、同步真实资金，再保存发货单价快照；资金不足连同首次时间回滚。F04 最终收货及 F05 ACCEPT 完成前按原首次时间取最新已发布生效版本，未处理任务不能让订单以旧价完成；补发不按补发日取价。收货允许履约完成且 shortfall>0，保留原现金/信用占用，不超额度，后续 O11 恢复资金。价格发布和完成核价按事务锁顺序生效，完成后发布不追溯。冻结核价变化当前返回 FROZEN_PRICE_CHECKPOINT_ADJUSTMENT_REQUIRED，先走正常冻结调价任务；冻结永久减量、已清挂账差额及重复应收仍未关闭。

## 5. 发货、收货与差异接口

最新账单渠道实现：B01 只生成 COMPANY_TERM 门店应收基础行及门店调整项，储值/挂账不生成第二次账期待付，供应商应付和 SUPPLIER_TERM 直付渠道仍保留。B08/B09 及历史待确认 B10 拒绝账户订单二次门店付款，阻断项 `ACCOUNT_SETTLEMENT_NOT_PAYABLE`；B12 门店抵扣指向非公司账期返回 `TARGET_DEBIT_CHANNEL_MISMATCH`。已确认历史付款不自动撤销。模式专属扣款/清账汇总仍需补齐；上文各阶段“重复应收待完成”描述为此前状态，不覆盖本更新。

账期少收资金规则：无账户分配的 COMPANY_TERM/SUPPLIER_TERM 少收只调整货款与冻结差额，不把未登记账期付款伪造成账户资金缺口，也不改动申请中其他账户组已扣款或待补款。

冻结完成核价实现更新：F04 最终收货和 F05 ACCEPT 完成使用最新有效版本对应的真实 PENDING 调价任务/执行单来源，写入 PriceChangeAdjustment 并仅对已冻结侧生成差额，原快照不变。逐商品更新金额/资金，退款来源为价格差额 ID，B12 不能再次退回已退款部分；资金待补可完成履约。P03 锁后重读任务行，跳过收货已处理的 SUCCEEDED 行。差额行保存有效数量/新单价，B05 详情读取该快照。无匹配来源或来源已消耗却价格不一致返回 `FROZEN_PRICE_CHECKPOINT_RECONCILIATION_REQUIRED`，不能编造历史。原 `FROZEN_PRICE_CHECKPOINT_ADJUSTMENT_REQUIRED` 全面拦截由此替代；冻结永久减量、已清挂账降额和历史异常对账仍未完成。

| 编号 | 方法与路径 | 权限 | 请求和规则 |
|---|---|---|---|
| F01 | `GET /supplier-orders`、`GET /supplier-orders/{id}` | 各角色对应范围 | state、storeId、supplierId、资金阻断、待补标记及日期；按角色返回投影 |
| F01a | `GET /supplier-orders/{id}` 收货信息 | SUPPLIER/ADMIN 对应范围 | destination.name/address/contactName/contactPhone 为当前门店资料，空值不伪造；列表 storeName。不是历史收货地址快照，原 supplier scope 校验保持 |
| F02 | `POST /supplier-orders/{id}/shipment-preview` | SUPPLIER/ADMIN | expectedVersion、items、freight、trackingNo、freightConfirmationId?；返回本次量/剩余待补/永久减量和资金阻断 |
| F03 | `POST /supplier-orders/{id}/shipments` | SUPPLIER/ADMIN | 同 F02；服务端记录实际 shippedAt，不接受客户端回填首次发货日期 |
| F04 | `GET /shipments/{id}`、`POST /shipments/{id}/receipts` | STORE/ADMIN | 读取发货单明细、supplierOrderVersion、currentReceiptRevision 后提交 expectedOrderVersion、expectedReceiptRevision（首次 0）、items[{shipmentItemId,receivedQuantity}]、evidenceFileIds；整批完整提交 |
| F05 | `GET /discrepancies/{id}`、`POST /discrepancies/{id}/resolve` | SUPPLIER/ADMIN | 读取差异详情和版本；处理时提交 expectedVersion、action REPLENISH/RETURN/ACCEPT、reason?；REPLENISH 产生待补资格，不伪造已发货 |
| F06 | `POST /supplier-orders/{id}/freight-confirmations` | SUPPLIER/ADMIN | expectedVersion、amount、reason；补发额外运费待采购确认 |
| F06a | `GET /freight-confirmations` | PURCHASER/SUPPLIER/ADMIN | 可按 supplierOrderId、status 筛选；供应商只能查看自身订单，返回订单号、供应商和门店名称 |
| F07 | `POST /freight-confirmations/{id}/confirm` 或 `/reject` | PURCHASER/ADMIN | expectedVersion、reason；只确认此笔费用，不引入审批流 |

发货 items 结构：`{orderItemId, shipQuantity, permanentlyReduceQuantity, gapAllocations:[{gapId,quantity}]}`。数量不得为负；本次发货与永久减量不能超出当前可处理量。首次未发余量默认待补，界面必须明确展示；补发必须指向既有 gap，不能擅自增加目标数量。

F03 自动采用供应商唯一配送方式并保存快照；物流号只在物流配送填写。运费开关关闭时金额必须 0；补发非零运费必须有匹配且未使用的确认记录。首次发货重新取有效价；补发用原单有效价。资金不足返回 409 且无成功发货批次；供应商不能通过重复提交绕过。

F04 首次收货实收默认发货量；重确认读取 `currentReceivedQuantity` 与 `receiptLocked`。退回核对行可修改，已经同意少收或进入补发的行只能原样提交。允许 0 到本次发货量，至少一张有效凭证；少收进入差异，不直接替供应商同意。新 receiptRevision 替代旧有效版本，旧记录保留，累计数量只增加新旧有效版本的差量。RETURN 的动作记录虽为 RESOLVED，但待门店核对的差异仍阻止履约完成，不能当作 ACCEPT。

F05 的 REPLENISH 与 RETURN 不能对已解决差异重复执行。ACCEPT 降低有效目标、调整资金和两侧账单；只有所有待补和差异结束才完成履约。执行单完成时同步核价，若资金仍待补则返回 `fulfillmentStatus=COMPLETED`、资金未结清，不能混为同一个状态。

ACCEPT 的冻结侧差额类型为 `ACCEPTED_SHORTAGE`，`sourceDiscrepancyId` 指向真实差异；原结算快照保持不变。差额列表/详情通过 `disposalCreditItemId` 提供可处置来源。已通过资金流水退入门店储值余额的部分不再允许另行返还。RETURN 仅为收货核对历史，不能作为新退款或抵扣来源；B12 返回 `RETURN_REVIEW_NOT_CREDIT`，已退款差额再次处置返回 `DIFFERENCE_CREDIT_ALREADY_DISPOSED`。

## 6. 门店财务、账单与结算接口

### 6.1 充值、清账与账户

| 编号 | 方法与路径 | 请求/响应 | 权限 |
|---|---|---|---|
| A01 | `GET /stores/{id}/account`、`GET /stores/{id}/ledgers` | 当前余额、授权额度、累计发生、未清、剩余、流水；流水可筛选业务日期/发生时间 | 门店自身及公司授权角色只读 |
| A02 | `POST /stores/{id}/recharges` | amount、businessDate、collectionAccountId、remark?、evidenceFileIds；201 充值单和账户新值 | HQ_FINANCE/ADMIN |
| A03 | `PATCH /stores/{id}/credit-limit` | expectedVersion、limit、reason；不能低于当前占用 | HQ_FINANCE/ADMIN |
| A04 | `POST /stores/{id}/clearings/preview` | fundingAllocationIds；返回各来源未清、合计、版本 | HQ_FINANCE/ADMIN |
| A05 | `POST /stores/{id}/clearings` | items[{fundingAllocationId,expectedVersion,expectedAmount}]、businessDate、remark?、evidenceFileIds；201 清账单 | HQ_FINANCE/ADMIN |
| A06 | `GET /recharges/{id}`、`GET /clearings/{id}`及对应列表 | 原单、明细、流水、凭证、操作人 | 门店自身只读，财务/管理员全量 |

A02 不自动采购确认，A05 不变履约状态。清账按所选来源全部未清金额计算，不开放任意删改已生成流水；预览金额过期则整次 409，不能按用户未看见的新金额直接清账。

### 6.2 三种账单

| 编号 | 方法与路径 | 数据口径 |
|---|---|---|
| B01 | `GET /store-statements`、`GET /store-statements/{id}` | 门店+供应商+周期，销售价；储值/挂账展示相应扣款/清账，不生成重复账期待付款 |
| B02 | `GET /supplier-statements`、`GET /supplier-statements/{id}` | 公司向供应商供货价周期总单；明细带价格调整来源；供应商自身或公司授权角色 |
| B03 | `GET /supplier-store-statements`、`GET /supplier-store-statements/{id}` | 供货价分店单、parentStatementId、与总单共享的 settlementItemIds，明细带价格调整来源 |
| B04 | `GET /direct-statements`、`GET /direct-statements/{id}` | 供应商直接账期，门店与供应商结算；明细带价格调整来源；不混入公司应付总单 |
| B05 | `GET /adjustments`、`GET /adjustments/{id}` | 差额、原账单原周期、实际结算周期、来源修订、处理状态；单笔负向改价可返回 `disposalCreditItemId`，单笔正向改价可返回 `offsetTargetItemId`；关联处置返回其 `version` 供 B12 确认 |

公共筛选为 storeId、supplierId、cycle、periodStart、periodEndExclusive、settlementStatus、page。范围由服务端收窄。详情返回商品额、运费、调整额、调整结算项 ID、已确认支付、待确认支付、待支付、待返还/抵扣、待核对标记和修订号。正向调整结算项可进入 B06-B08；负向调整继续走 B12。门店销售账单不能跳转读供货价分店单。

### 6.3 付款和差额处置

| 编号 | 方法与路径 | 请求/结果 | 权限 |
|---|---|---|---|
| B06 | `POST /payment-records/preview` | settlementItemIds（普通结算项或 `ADJUSTMENT` 调整项）；返回同主体可付金额、已预占、来源版本和阻断项；正向调整带调整侧和来源修订，直接账期使用 `STORE_TO_SUPPLIER` | 该方向付款登记角色 |
| B07 | `POST /payment-records` | direction、items[{settlementItemId,expectedVersion,expectedAmount}]、businessDate、evidenceFileIds、remark?；201 待收款确认记录 | 门店侧登记对公司/供应商付款；HQ_FINANCE/ADMIN 登记公司付供应商 |
| B08 | `POST /payment-records/{id}/confirm` | expectedVersion；返回有效核销和任何多付款待处置额 | STORE_TO_COMPANY 仅 HQ_FINANCE/ADMIN；其他方向 SUPPLIER/ADMIN |
| B09 | `POST /payment-records/{id}/reject` | expectedVersion、reason；保留登记，释放预占 | 对应收款确认角色；仅待确认 |
| B10 | `POST /payment-records/{id}/cancel` | expectedVersion、reason | 原登记人或授权财务，仅未确认、未实际确认核销；不撤销已确认收款 |
| B11 | `GET /payment-records`、`GET /payment-records/{id}` | 付款单、分配、确认人与凭证 | 双方及授权公司人员，按方向隔离 |
| B12 | `POST /difference-disposals`、`POST /difference-disposals/{id}/confirm`、`GET /difference-disposals/{id}` | method、creditItemIds、targetDebitItemIds?、amount、businessDate、evidenceFileIds；抵扣/线下返还 | 公司通道由 HQ_FINANCE/ADMIN 登记；涉及对方收款由收款方确认；直接通道各方仅处理自身往来 |

B07 首版按选择明细的全部可付余额登记；可以选不同订单或正向调整项，但必须同付款方、收款方、方向。跨供应商界面按组逐笔登记，不在一笔付款里混合账户。公司账期对应门店应收含有效补收差额尚未结清时，返回 `STORE_RECEIVABLE_UNSETTLED`。

B08 不能覆盖原登记金额：期间降价造成多付款时记录真实已收及可核销分配，超额进入 differenceDisposal 待处理；不把超额默认为已抵扣。B12 只处理既有负调整或真实多付款，不允许凭空创建退款额度；抵扣必须同双方主体同通道，无后续订单时可线下返还。

## 7. 报表、导出与运行查询

| 编号 | 方法与路径 | 规则 |
|---|---|---|
| R01 | `GET /reports/order-amounts` | 已完成订货金额，按 completedAt；门店范围或公司全量 |
| R02 | `GET /reports/product-quantities` | 最终有效数量按完成日汇总；日期范围最大 3 个月 |
| R03 | `GET /reports/profit` | 首次发货日期筛选，只统计完成订单；销售商品金额减供货商品金额，运费单列，排除直接账期 |
| R04 | `POST /exports`、`GET /exports`、`GET /exports/{id}` | reportType、filters；202 jobId；列表和详情只返回本人且当前账号范围仍有权查看的任务；生成及下载复核角色和字段权限 |
| R05 | `GET /audit-logs`、`GET /reconciliation-issues` | 内部授权查询，敏感内容脱敏；不可通过这些接口直接修改财务事实 |

R03 仅 PURCHASER/HQ_FINANCE/ADMIN；导出不接受客户端自定义任意 SQL、字段或数据范围。每个报表响应含 `dateBasis`、`asOf`、`currency`、统计口径，防止把利润月份和清账月份混淆。

R04 `POST /exports` 返回 202 和 jobId；`GET /exports` 返回本人最近未过期导出任务；`GET /exports/{id}` 查询状态；`GET /exports/{id}/download` 下载私有 CSV。快照保存于数据库，7 天到期，且仅创建者可查/下载；列表、状态和下载均按当前角色及账号范围复核。

后台定时出账、任务续租和每日对账是内部服务，不开放无鉴权 HTTP 触发入口。需要重试任务时只允许授权角色重试已存在的失败项，不允许上传任意可执行任务内容。

## 8. 错误码与客户端恢复

| 错误码 | 场景 | 客户端行为 |
|---|---|---|
| `VALIDATION_FAILED` | 字段格式、数量精度、凭证缺失 | 定位字段保留输入 |
| `ORDER_VERSION_CONFLICT` | 别端已处理或编辑 | 刷新并比较，不自动覆盖 |
| `IDEMPOTENCY_KEY_REUSED` | 同键不同请求 | 视为客户端错误；禁止复用键修改输入 |
| `QUOTE_CHANGED` | 预览后价格/配置变化 | 展示新价格，重新确认 |
| `BALANCE_INSUFFICIENT` | 确认/发货/补扣不足 | 显示有权可见的缺口；保留状态，不显示成功推送 |
| `CREDIT_LIMIT_EXCEEDED` | 下单超额度或调整待补 | 下单失败；后续调整保留欠补，禁止发货 |
| `CREDIT_LIMIT_BELOW_USED` | 额度调低超过未清占用 | 显示当前最低可设置额度 |
| `INVALID_STATE_TRANSITION` | 已完成再发货、已核销再撤销 | 刷新状态，不重复尝试不合法动作 |
| `SUPPLIER_NOT_ELIGIBLE` | 批选供应商不供某商品 | 按商品显示原因；不部分应用 |
| `TARGET_SUPPLIER_ALREADY_SHIPPED` | 拒单改分配目标已发货 | 改选可用供应商或取消对应商品 |
| `DIRECT_PRICE_MISMATCH` | 直接账期两价不一致 | 引导采购修正关联价格配置 |
| `REPLENISHMENT_EXCEEDS_GAP` | 超量或重复补发 | 刷新缺口及历史批次 |
| `FREIGHT_CONFIRMATION_REQUIRED` | 补发录入未确认额外运费 | 等待采购费用确认 |
| `PAYMENT_ALREADY_ALLOCATED` | 总单和分店单重复登记 | 刷新共享已占用明细 |
| `STORE_RECEIVABLE_UNSETTLED` | 公司账期未满足先收后付 | 显示对应门店待收来源 |
| `FILE_NOT_READY` | 文件未验证或归属不符 | 重试合法上传；不先提交无凭证单据 |
| `ACCOUNT_RECONCILIATION_BLOCKED` | 账户存在待核查对账差异 | 显示人工核查状态，不自动修余额 |

网络超时不等于失败。客户端保存幂等键，先查原命令；成功跳到结果，处理中继续查询，明确拒绝再由用户修正。离线只保存订货草稿，不显示发货、收货、充值或清账成功。

## 9. 契约验收与后续交付

每个实现接口必须通过：请求校验、角色及越权、字段裁剪、状态冲突、幂等、版本冲突、错误恢复测试。财务和履约接口另加真实数据库事务/并发测试，不能只验证 HTTP 200。

文档确认后，按本清单生成 OpenAPI 3 契约及客户端类型，补齐逐字段 schema、枚举、必填项和每接口错误响应，并做契约漂移检查。尚未实现的路由不返回虚构成功数据；已部署接口文档与设计文档分别标记状态。

账号绑定方式、上传大小上限、会话有效期等上线配置沿用架构所列实施阶段事项；不借此更改已确认业务流程。页面对应关系见 [页面与交互设计](./page-interaction-design.md)，接口编号作为联调和测试引用。
