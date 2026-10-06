export interface User { id: string; username?: string; displayName?: string; roles: string[]; scope?: { type?: string; storeId?: string; supplierId?: string } }
export interface Session { accessToken: string; expiresAt: string; user: User }
const sessionKey = 'procurex-react-admin-session-v1';
let session: Session | null = null;
let epoch = 0;
let expired = () => {};
try {
  const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null') as Session | null;
  if (saved?.accessToken && Date.parse(saved.expiresAt) > Date.now()) session = saved;
} catch { /* Session storage can be unavailable. */ }

export function getSession() { return session; }
export function onExpired(callback: () => void) { expired = callback; }
export function clearSession() {
  epoch += 1; session = null;
  try { sessionStorage.removeItem(sessionKey); } catch { /* Clear the in-memory session too. */ }
}
function persist(next: Session) {
  session = next;
  try { sessionStorage.setItem(sessionKey, JSON.stringify(next)); } catch { /* This login still works in memory. */ }
}
const messages: Record<string, string> = {
  ADJUSTMENT_NOT_FOUND: '结算差异不存在或不在当前范围。', DIFFERENCE_DISPOSAL_NOT_FOUND: '差额处置单不存在或不在当前范围。',
  DIFFERENCE_DISPOSAL_NOT_CONFIRMABLE: '处置单已处理，不能重复确认。', DIFFERENCE_DISPOSAL_AMOUNT_CHANGED: '差额金额已变化，请重新核对。',
  DIFFERENCE_CREDIT_ALREADY_DISPOSED: '所选差额已登记处置，请刷新核对。', DIFFERENCE_CREDIT_ITEM_NOT_FOUND: '差额来源已变更或不存在，请重新读取。',
  DIFFERENCE_CREDIT_SUBJECT_MISMATCH: '所选差额不属于同一门店和供应商。', DIFFERENCE_ADJUSTMENT_NOT_CREDIT: '所选调整不是可返还差额。',
  RETURN_REVIEW_NOT_CREDIT: '所选退货尚未形成可处置差额。', TARGET_DEBIT_AMOUNT_INSUFFICIENT: '抵扣目标可用金额不足，请重新选择。',
  TARGET_DEBIT_NOT_PAYABLE: '抵扣目标当前不能结算。', TARGET_ADJUSTMENT_NOT_PAYABLE: '抵扣目标须为有效正向调整。',
  TARGET_DEBIT_ITEM_NOT_FOUND: '抵扣目标不存在，请刷新。', TARGET_DEBIT_SUBJECT_MISMATCH: '抵扣目标的门店或供应商不匹配。',
  TARGET_DEBIT_CHANNEL_MISMATCH: '门店差额只能抵扣公司账期应收。', TARGET_DEBIT_KIND_NOT_SUPPORTED: '抵扣目标类型不支持。',
  EXPORT_NOT_FOUND: '导出记录不存在或已过期。', EXPORT_NOT_READY: '导出尚未生成或已过期。', EXPORT_NOT_RETRYABLE: '仅失败的导出任务可以重新生成。',
  INVALID_REPORT_RANGE: '请选择完整有效的起止日期。', REPORT_RANGE_TOO_LARGE: '商品数量查询区间不能超过三个月。',
  PAYMENT_RECORD_NOT_FOUND: '付款记录不存在或不在当前权限范围。', PAYMENT_EVIDENCE_REQUIRED: '请先上传付款凭证。',
  PAYMENT_EVIDENCE_INVALID: '付款凭证未完成上传、已被使用或不属于当前账号。', PAYMENT_PREVIEW_BLOCKED: '所选结算项不能付款，请刷新账单重新选择。',
  PAYMENT_PREVIEW_EMPTY: '没有可付款的结算项。', PAYMENT_DIRECTION_MISMATCH: '付款方向不一致，请分别登记。',
  PAYMENT_PAYER_MISMATCH: '付款方不一致，请分别登记。', PAYMENT_PAYEE_MISMATCH: '收款方不一致，请分别登记。',
  PAYMENT_PARTICIPANT_MISMATCH: '直付明细须属于同一门店和供应商。', SETTLEMENT_CHANNEL_MISMATCH: '结算通道不一致，请重新选择。',
  SETTLEMENT_ITEM_VERSION_CONFLICT: '结算版本已变化，请重新预览。', SETTLEMENT_ITEM_AMOUNT_CHANGED: '结算金额已变化，请重新预览。',
  SETTLEMENT_ITEM_NOT_PAYABLE: '该结算项当前不可付款。', SETTLEMENT_ITEM_NOT_FOUND: '结算项不存在，请刷新账单。',
  ACCOUNT_SETTLEMENT_NOT_PAYABLE: '储值和挂账订单须通过门店账户结算，不能重复登记付款。',
  PAYMENT_RECORD_NOT_CONFIRMABLE: '付款记录当前不能确认，请重新读取。', PAYMENT_RECORD_NOT_REJECTABLE: '付款记录当前不能驳回，请重新读取。',
  PAYMENT_RECORD_NOT_CANCELLABLE: '付款记录当前不能撤销，请重新读取。',
  ACCOUNT_EVIDENCE_INVALID: '账户凭证须已上传完成、属于当前账号且未被使用。', ACCOUNT_DOCUMENT_NOT_FOUND: '账户单据不存在。',
  INVALID_RECHARGE_AMOUNT: '充值金额须大于零，最多两位小数。', COLLECTION_ACCOUNT_UNAVAILABLE: '收款账户已停用或不存在，请重新读取。',
  CREDIT_LIMIT_BELOW_USED: '挂账额度不能低于当前未销账金额。', CLEARING_AMOUNT_CHANGED: '销账金额已变化，请重新核对。',
  FUNDING_ALLOCATION_NOT_CLEARABLE: '所选明细当前不能销账，请刷新。', FUNDING_ALLOCATION_INACTIVE: '所选挂账明细已失效，请刷新。',
  FUNDING_ALLOCATION_STORE_MISMATCH: '挂账明细不属于当前门店。', CREDIT_USED_BELOW_CLEARING: '未销账总额已变化，请刷新核对。',
  SHIPMENT_NOT_FOUND: '发货单不存在，请刷新。', INVALID_RECEIPT_ITEMS: '收货清单须逐项覆盖发货明细，请重新读取。',
  INVALID_RECEIVED_QUANTITY: '实际收货数量须在零和发货数量之间。', SHIPMENT_ITEM_NOT_FOUND: '收货明细不属于此发货单，请重新读取。',
  RECEIPT_REVISION_CONFLICT: '收货修订已变更，请重新读取。', RECEIPT_REVISION_NOT_REPLACEABLE: '收货数量已锁定，不能再修订。',
  RECEIPT_EVIDENCE_INVALID: '收货凭证未完成上传、已被关联或不属于当前账号，请重新上传。',
  DISCREPANCY_NOT_FOUND: '收货差异不存在，请刷新。', DISCREPANCY_NOT_RESOLVABLE: '差异已处理或待补发，不能重复处理。',
  FILE_CONTENT_INVALID: '凭证内容与图片类型不符，请重新选择。', FILE_METADATA_INVALID: '凭证格式或大小不符合要求。',
  SUPPLIER_ORDER_NOT_SHIPPABLE: '订单当前状态不能发货，请刷新。', INVALID_SHIPMENT_QUANTITY: '发货与永久减量超过可处理数量，请重新核对。',
  INVALID_REPLENISHMENT_GAP_QUANTITY: '补发分配数量不符合缺口或发货数量，请重新核对。', REPLENISHMENT_GAP_NOT_ALLOCATABLE: '补发缺口已处理，请刷新。',
  REPLENISHMENT_GAP_NOT_FOUND: '补发缺口不存在，请刷新。', REPLENISHMENT_GAP_ITEM_MISMATCH: '补发缺口与商品不一致，请刷新。',
  FREIGHT_NOT_ALLOWED: '此订单不允许申请运费。', FREIGHT_CONFIRMATION_REQUIRED: '正运费须关联已确认的运费申请。',
  FREIGHT_CONFIRMATION_NOT_USABLE: '运费申请尚未确认或已使用，请刷新。', FREIGHT_CONFIRMATION_AMOUNT_MISMATCH: '运费金额与申请不一致，请刷新。',
  FREIGHT_CONFIRMATION_NOT_FOUND: '运费申请不存在，请刷新。', FREIGHT_CONFIRMATION_ORDER_MISMATCH: '运费申请不属于此订单。',
  INVALID_CREDENTIALS: '账号或密码不正确', VERSION_CONFLICT: '资料已变更，请刷新后重新编辑。',
  STORE_GROUP_NAME_EXISTS: '分组名称已存在', STORE_GROUP_IN_USE: '分组仍有关联门店，请先调整门店归属。',
  STORE_GROUP_DISABLED: '该分组已停用，请重新选择。', STORE_GROUP_NOT_FOUND: '分组不存在，请刷新后重新选择。',
  COLLECTION_ACCOUNT_NAME_EXISTS: '收款账户名称已存在',
  CATEGORY_DEPTH_EXCEEDED: '分类最多支持两级，请选择一级分类。', CATEGORY_HAS_CHILDREN: '该分类还有子分类，请先处理子分类。',
  CATALOG_RECORD_IN_USE: '该资料已被商品或单位换算引用，不能删除。', BRAND_NAME_EXISTS: '品牌名称已存在。',
  UNIT_HISTORY_SNAPSHOT_REQUIRED: '历史订单仍引用此单位名称，暂不能更名。',
  PRODUCT_NOT_FOUND: '商品不存在，请刷新列表。', SUPPLIER_NOT_FOUND: '供应商不存在，请刷新列表。',
  UNIT_CONVERSION_INVALID: '采购单位换算不符合规则，请检查单位与换算数量。',
  SUPPLIER_ARCHIVED: '供应商已归档，请刷新列表。',
  TEMPLATE_NAME_EXISTS: '模板名称已存在。', TEMPLATE_NOT_FOUND: '模板不存在或已归档，请刷新。',
  STORE_ALREADY_BOUND: '所选门店已绑定其他有效模板，请刷新后检查。', DUPLICATE_TEMPLATE_ITEM: '商品和供货方不能重复。',
  SUPPLIER_NOT_IN_TEMPLATE: '该供应商未关联模板商品。', DIRECT_TERM_PRICES_MUST_MATCH: '直供供应商账期的销售价与供货价必须一致。',
  TEMPLATE_PRICE_PAIR_NOT_ALLOWED: '商品和供应商必须关联有效模板。', TEMPLATE_SUPPLY_PRICE_READ_ONLY: '模板供货价须沿用生效的共享供货价，请先在共享范围维护。',
  PRICE_VERSION_NOT_FOUND: '尚未设置当前生效价格。', COMMAND_PROCESSING: '提交仍在处理中，请保留原提交记录并稍后恢复查询。',
  IDEMPOTENCY_KEY_REUSED: '提交标识与原请求不一致，请核查原提交记录。',
  PURCHASE_REQUEST_NOT_FOUND: '采购申请不存在，请刷新列表。', PURCHASE_REQUEST_ITEMS_NOT_EDITABLE: '申请已进入履约流程，不能修改明细。',
  PURCHASE_REQUEST_NOT_CONFIRMABLE: '申请当前状态不能确认采购，请刷新核对。', PURCHASE_REQUEST_NOT_REJECTABLE: '申请当前状态不能取消，请刷新核对。',
  PRODUCT_NOT_IN_CATALOG: '商品已不在门店有效目录，请重新读取。', PRICE_NOT_AVAILABLE: '商品尚无生效供货价格，请先维护价格。',
  INVALID_ITEM_QUANTITY: '数量须满足起订量和订货倍数，请检查所选单位。', SUPPLIER_NOT_ALLOWED_FOR_PRODUCT: '供应商未关联此模板商品，请重新选择。',
  STORE_TEMPLATE_NOT_FOUND: '门店尚未关联有效订货模板。', SUPPLIER_ORDER_NOT_FOUND: '供应商订单不存在，请刷新列表。',
  PURCHASE_REQUEST_NOT_REALLOCATABLE: '申请当前状态不能重分配，请重新读取拒单。',
  REJECTED_SUPPLIER_ORDER_NOT_FOUND: '拒单不属于此采购申请或状态已变更，请重新读取。',
  INVALID_REALLOCATION_ASSIGNMENTS: '处理清单须逐项覆盖拒单商品，请重新读取。',
  REALLOCATION_ITEM_NOT_REJECTED: '商品已不属于当前拒单，请重新读取。',
  REALLOCATION_SUPPLIER_REQUIRED: '请选择供应商或取消该商品。',
  TARGET_SUPPLIER_ALREADY_SHIPPED: '目标供应商订单已发货，请重新读取并选择其他供应商。',
  REASSIGNMENT_NOT_ELIGIBLE: '所选商品不能调整至该供应商，请重新预览。',
};
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
export async function request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  const currentEpoch = epoch; const token = session?.accessToken;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method || 'GET',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new Error(options.method && options.method !== 'GET' ? '提交结果暂未确认，请刷新列表核对后再操作。' : '连接失败，请重试。');
  }
  if (currentEpoch !== epoch) throw new Error('登录状态已变更，请重新读取数据。');
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') { clearSession(); expired(); }
    const detail = envelope?.error || envelope || {};
    throw new ApiError(messages[detail.code] || (response.status === 403 ? '当前账号无权执行此操作。'
      : response.status === 401 ? '登录已失效，请重新登录。' : response.status >= 500 && options.method
        ? '提交结果暂未确认，请刷新列表核对后再操作。' : detail.message || `请求失败（${response.status}）`), response.status, detail.code);
  }
  if (!envelope || !Object.hasOwn(envelope, 'data')) throw new Error('接口返回异常，请刷新核对。');
  return envelope.data as T;
}
export async function login(username: string, password: string) {
  clearSession();
  const next = await request<Session>('/auth/login', { method: 'POST', body: { username, password, client: 'WEB' } });
  persist(next); return next.user;
}
export async function restore() {
  if (!session) return null;
  const current = session;
  const result = await request<{ user: User; session: { expiresAt: string } }>('/me');
  persist({ ...current, user: result.user, expiresAt: result.session.expiresAt }); return result.user;
}
export async function logout() { try { await request('/auth/logout', { method: 'POST' }); } finally { clearSession(); } }
export const hasRole = (user: User, ...roles: string[]) => roles.some(role => user.roles.includes(role));
