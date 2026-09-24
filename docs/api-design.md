# 接口详细设计

> 版本：v1.0 详细设计评审稿，2026-09-24
> 基线：[需求 v1.4](./requirements.md)、[架构设计](./architecture-design.md)
> 配套：[数据库设计](./database-design.md)、[页面设计](./page-interaction-design.md)
> 状态：接口契约设计，本文所有业务接口均未实现。本轮不启动服务或生成业务代码。

## 1. 通用契约

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
| I05 | `GET/POST /users`、`PATCH /users/{id}` | 账号、状态、角色、合法数据范围、expectedVersion | ADMIN；停用撤销会话，不返回 passwordHash |
| I06 | `POST /files/upload-sessions` | purpose、filename、mimeType、sizeBytes、可选业务对象；返回短期上传凭据 | 登录且具有对应用途权限；业务对象先校验范围 |
| I07 | `POST /files/{id}/complete`、`GET /files/{id}/download` | 服务端验证完成；授权下载地址 | 真实类型、大小、对象存在与归属；凭证 READY 后才可提交单据 |
| I08 | `GET /notifications`、`POST /notifications/{id}/read` | 分页消息及已读 | 只可操作本人消息 |
| I09 | `GET /health/live`、`GET /health/ready` | 最小状态；不返回数据库凭据或内部拓扑 | 运维用途；readiness 检查必要依赖 |

### 3.2 主数据接口

| 编号 | 方法与路径 | 输入/输出 | 可操作角色 |
|---|---|---|---|
| M01 | `GET/POST /stores`、`GET/PATCH /stores/{id}` | 名称、分组、联系人、地址、收货信息、类型、状态 | 写 ADMIN；采购/财务按业务读取，门店只读自身 |
| M02 | `GET/POST /suppliers`、`GET/PATCH /suppliers/{id}`、`POST /suppliers/{id}/archive` | 联系和银行资料、唯一配送、默认结算、周期、运费开关等 | 写 PURCHASER/ADMIN；供应商只读自身非敏感配置 |
| M03 | `GET/POST /products`、`GET/PATCH /products/{id}`、`POST /products/{id}/archive` | 商品字段、默认价、起订量、倍数、图片、单位换算 | 写 PURCHASER/ADMIN；供应商只读自己商品；门店走可订目录 |
| M04 | `GET/POST /categories`、`PATCH/DELETE /categories/{id}` | name、parentId、expectedVersion | PURCHASER/ADMIN；二级限制；存在商品阻止删除 |
| M05 | `GET/POST /brands`、`PATCH/DELETE /brands/{id}`；单位同路径规则 `/units` | name、expectedVersion | PURCHASER/ADMIN；使用中不可删除 |
| M06 | `GET/PUT /suppliers/{id}/products` | 产品 ID 列表、expectedVersion；逐条检查 | PURCHASER/ADMIN；调整当前关系不删除历史 |
| M07 | `GET/POST /collection-accounts`、`PATCH /collection-accounts/{id}` | 公司收款账户资料、状态 | HQ_FINANCE/ADMIN |

供应商和商品写入字段与 [数据库设计 §3](./database-design.md) 一一对应；价格版本变更必须使用 P02，不允许 PATCH 商品或模板绕过价格历史及影响重算。`defaultSalesPrice` 只初始化配置，不改已有模板有效报价。

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
| P01 | `POST /prices/impact-preview` | productId、supplierId、salesPrice、supplyPrice、effectiveAt；只读返回生效区间内未完成执行单及两侧金额净变化，排除已完成单 |
| P02 | `POST /price-changes` | productId、supplierId、salesPrice、supplyPrice、effectiveAt、reason；按 scope 事务追加单调递增 revision，并持久化 500 字符内原因。当前接口尚未实现批量发布和后台重算任务 |
| P03 | `GET /price-scopes/{id}/versions`、`GET /jobs/{id}` | 版本历史、价格变更 run 状态及影响汇总；按采购或相关内部权限查询 |

 T01-T05、P01-P03 的修改只允许 PURCHASER/ADMIN，采购小程序和 Web 的快速改价都调用 P02。预览不锁订单，也不保证提交时影响数不变。P02 允许同一 scope 追加同一生效时间的修订，并以最大 revision 生效；直接账期相关两价需要同步调整时使用同一 changes 数组。

## 4. 订货、采购确认与拒单

| 编号 | 方法与路径 | 权限 | 请求和结果 |
|---|---|---|---|
| O01 | `POST /purchase-requests/preview` | STORE/PURCHASER/ADMIN 代操作 | storeId、orderDate、items[{productId,quantity,inputUnitId}]；返回服务端金额、规则、资金缺口及 quoteVersion |
| O02 | `POST /purchase-requests` | 同 O01 | 同上+quoteVersion；不接受门店指定供应商、结算方式、单价；201 返回订货单和资金状态 |
| O03 | `GET /purchase-requests`、`GET /purchase-requests/{id}` | 门店自店、公司授权角色 | 筛选门店、日期、状态、资金缺口；供应商不可见未确认订货单 |
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

## 5. 发货、收货与差异接口

| 编号 | 方法与路径 | 权限 | 请求和规则 |
|---|---|---|---|
| F01 | `GET /supplier-orders`、`GET /supplier-orders/{id}` | 各角色对应范围 | state、storeId、supplierId、资金阻断、待补标记及日期；按角色返回投影 |
| F02 | `POST /supplier-orders/{id}/shipment-preview` | SUPPLIER/ADMIN | expectedVersion、items、freight、trackingNo、freightConfirmationId?；返回本次量/剩余待补/永久减量和资金阻断 |
| F03 | `POST /supplier-orders/{id}/shipments` | SUPPLIER/ADMIN | 同 F02；服务端记录实际 shippedAt，不接受客户端回填首次发货日期 |
| F04 | `POST /shipments/{id}/receipts` | STORE/ADMIN | expectedOrderVersion、expectedReceiptRevision（首次 0）、items[{shipmentItemId,receivedQuantity}]、evidenceFileIds；整批完整提交 |
| F05 | `POST /discrepancies/{id}/resolve` | SUPPLIER/ADMIN | expectedVersion、action REPLENISH/RETURN/ACCEPT、reason?；REPLENISH 产生待补资格，不伪造已发货 |
| F06 | `POST /supplier-orders/{id}/freight-confirmations` | SUPPLIER/ADMIN | expectedVersion、amount、reason；补发额外运费待采购确认 |
| F07 | `POST /freight-confirmations/{id}/confirm` 或 `/reject` | PURCHASER/ADMIN | expectedVersion、reason；只确认此笔费用，不引入审批流 |

发货 items 结构：`{orderItemId, shipQuantity, permanentlyReduceQuantity, gapAllocations:[{gapId,quantity}]}`。数量不得为负；本次发货与永久减量不能超出当前可处理量。首次未发余量默认待补，界面必须明确展示；补发必须指向既有 gap，不能擅自增加目标数量。

F03 自动采用供应商唯一配送方式并保存快照；物流号只在物流配送填写。运费开关关闭时金额必须 0；补发非零运费必须有匹配且未使用的确认记录。首次发货重新取有效价；补发用原单有效价。资金不足返回 409 且无成功发货批次；供应商不能通过重复提交绕过。

F04 每行实收默认发货量，允许 0 到本次发货量，至少一张有效凭证；少收进入差异，不直接替供应商同意。退回重确认时新 receiptRevision 替代旧有效版本；旧记录保留，不再次累计数量。

F05 的 REPLENISH 与 RETURN 不能对已解决差异重复执行。ACCEPT 降低有效目标、调整资金和两侧账单；只有所有待补和差异结束才完成履约。执行单完成时同步核价，若资金仍待补则返回 `fulfillmentStatus=COMPLETED`、资金未结清，不能混为同一个状态。

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
| B02 | `GET /supplier-statements`、`GET /supplier-statements/{id}` | 公司向供应商供货价周期总单；供应商自身或公司授权角色 |
| B03 | `GET /supplier-store-statements`、`GET /supplier-store-statements/{id}` | 供货价分店单、parentStatementId、与总单共享的 settlementItemIds |
| B04 | `GET /direct-statements`、`GET /direct-statements/{id}` | 供应商直接账期，门店与供应商结算；不混入公司应付总单 |
| B05 | `GET /adjustments`、`GET /adjustments/{id}` | 差额、原账单原周期、实际结算周期、来源修订、处理状态 |

公共筛选为 storeId、supplierId、cycle、periodStart、periodEndExclusive、settlementStatus、page。范围由服务端收窄。详情返回商品额、运费、调整额、已确认支付、待确认支付、待支付、待返还/抵扣、待核对标记和修订号。门店销售账单不能跳转读供货价分店单。

### 6.3 付款和差额处置

| 编号 | 方法与路径 | 请求/结果 | 权限 |
|---|---|---|---|
| B06 | `POST /payment-records/preview` | settlementItemIds；返回同主体可付金额、已预占、来源版本和阻断项 | 该方向付款登记角色 |
| B07 | `POST /payment-records` | direction、items[{settlementItemId,expectedVersion,expectedAmount}]、businessDate、evidenceFileIds、remark?；201 待收款确认记录 | 门店侧登记对公司/供应商付款；HQ_FINANCE/ADMIN 登记公司付供应商 |
| B08 | `POST /payment-records/{id}/confirm` | expectedVersion；返回有效核销和任何多付款待处置额 | STORE_TO_COMPANY 仅 HQ_FINANCE/ADMIN；其他方向 SUPPLIER/ADMIN |
| B09 | `POST /payment-records/{id}/reject` | expectedVersion、reason；保留登记，释放预占 | 对应收款确认角色；仅待确认 |
| B10 | `POST /payment-records/{id}/cancel` | expectedVersion、reason | 原登记人或授权财务，仅未确认、未实际确认核销；不撤销已确认收款 |
| B11 | `GET /payment-records`、`GET /payment-records/{id}` | 付款单、分配、确认人与凭证 | 双方及授权公司人员，按方向隔离 |
| B12 | `POST /difference-disposals`、`POST /difference-disposals/{id}/confirm`、`GET /difference-disposals/{id}` | method、creditItemIds、targetDebitItemIds?、amount、businessDate、evidenceFileIds；抵扣/线下返还 | 公司通道由 HQ_FINANCE/ADMIN 登记；涉及对方收款由收款方确认；直接通道各方仅处理自身往来 |

B07 首版按选择明细的全部可付余额登记；可以选不同订单，但必须同付款方、收款方、方向。跨供应商界面按组逐笔登记，不在一笔付款里混合账户。公司账期对应门店应收含有效补收差额尚未结清时，返回 `STORE_RECEIVABLE_UNSETTLED`。

B08 不能覆盖原登记金额：期间降价造成多付款时记录真实已收及可核销分配，超额进入 differenceDisposal 待处理；不把超额默认为已抵扣。B12 只处理既有负调整或真实多付款，不允许凭空创建退款额度；抵扣必须同双方主体同通道，无后续订单时可线下返还。

## 7. 报表、导出与运行查询

| 编号 | 方法与路径 | 规则 |
|---|---|---|
| R01 | `GET /reports/order-amounts` | 已完成订货金额，按 completedAt；门店范围或公司全量 |
| R02 | `GET /reports/product-quantities` | 最终有效数量按完成日汇总；日期范围最大 3 个月 |
| R03 | `GET /reports/profit` | 首次发货日期筛选，只统计完成订单；销售商品金额减供货商品金额，运费单列，排除直接账期 |
| R04 | `POST /exports`、`GET /exports/{id}` | reportType、filters；202 jobId；生成及下载复核角色和字段权限 |
| R05 | `GET /audit-logs`、`GET /reconciliation-issues` | 内部授权查询，敏感内容脱敏；不可通过这些接口直接修改财务事实 |

R03 仅 PURCHASER/HQ_FINANCE/ADMIN；导出不接受客户端自定义任意 SQL、字段或数据范围。每个报表响应含 `dateBasis`、`asOf`、`currency`、统计口径，防止把利润月份和清账月份混淆。

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
