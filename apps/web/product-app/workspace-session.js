import { localApiPort } from './workspace-config.js';

export const SESSION_KEY = 'procurex-web-session-v1';

export function resolveApiBase(url, override) {
  const current = new URL(url);
  const configured = current.searchParams.get('api') || override;
  const base = configured ? new URL(configured) : new URL(
    ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname)
      ? `${current.protocol}//${current.hostname}:${localApiPort}/api/v1` : '/api/v1', current);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('接口地址无效');
  }
  return base.href.replace(/\/$/, '');
}

export function allowedRoutes(user) {
  const roles = user?.roles || [];
  const routes = [];
  if (roles.some(role => ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role))) routes.push('products', 'categories', 'brands', 'units', 'stores', 'suppliers');
  if (roles.some(role => ['ADMIN', 'PURCHASER'].includes(role))) routes.push('templates', 'prices', 'purchaser');
  if (roles.some(role => ['ADMIN', 'PURCHASER', 'SUPPLIER'].includes(role))) routes.push('supplier');
  if (roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role))) routes.push('store');
  if (roles.some(role => ['ADMIN', 'HQ_FINANCE', 'SUPPLIER', 'STORE', 'STORE_FINANCE'].includes(role))) routes.push('finance');
  if (roles.some(role => ['SUPPLIER', 'STORE', 'STORE_FINANCE'].includes(role))) routes.push('profile');
  if (roles.includes('SUPPLIER')) routes.push('supplier-products');
  return routes;
}

export function canEdit(user, resource) {
  const roles = user?.roles || [];
  return resource === 'stores' ? roles.includes('ADMIN') : roles.some(role => ['ADMIN', 'PURCHASER'].includes(role));
}

export function createWorkspaceClient({ base, storage, fetcher = fetch, onExpired = () => {} }) {
  const key = `${SESSION_KEY}:${base}`;
  let session = null;
  let epoch = 0;
  let commandInFlight = false;
  try {
    const stored = JSON.parse(storage.getItem(key));
    if (typeof stored?.accessToken === 'string' && Date.parse(stored.expiresAt) > Date.now()) session = stored;
  } catch { /* A blocked storage provider must not prevent an in-memory login. */ }

  function clear() {
    epoch += 1;
    session = null;
    try { storage.removeItem(key); } catch { /* Keep the in-memory session cleared. */ }
  }

  const commandKey = () => `${key}:command:${session?.user.id}`;
  function pendingCommand() {
    try { return JSON.parse(storage.getItem(commandKey())); }
    catch { return null; }
  }
  async function runCommand(command) {
    if (commandInFlight) throw new Error('正在查询提交结果，请稍候。');
    commandInFlight = true;
    const persistedKey = commandKey();
    try {
      const result = await request(command.path, { method: command.method || 'POST', body: command.body, headers: { 'idempotency-key': command.key } });
      storage.removeItem(persistedKey);
      return result;
    } catch (error) {
      if (!error.uncertain && ![401, 408, 429].includes(error.status) && error.code !== 'COMMAND_PROCESSING') storage.removeItem(persistedKey);
      throw error;
    }
    finally { commandInFlight = false; }
  }

  async function request(path, options = {}) {
    const startEpoch = epoch;
    const token = session?.accessToken;
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        ...options,
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        headers: { ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
        body: options.body === undefined ? undefined : options.rawBody ? options.body : JSON.stringify(options.body),
      });
    } catch {
      const error = new Error(options.method && options.method !== 'GET'
        ? '提交结果暂未确认，请刷新列表核对后再操作。' : '连接失败，请检查接口地址后重试。');
      error.uncertain = Boolean(options.method && options.method !== 'GET');
      throw error;
    }
    if (startEpoch !== epoch) {
      const error = new Error('账号已切换，请重新读取数据。');
      error.uncertain = Boolean(options.method && options.method !== 'GET');
      throw error;
    }
    if (response.ok && options.binary) return response.blob();
    const envelope = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = envelope?.error || envelope || {};
      const code = detail.code;
      const messages = { SUPPLIER_ARCHIVED: '供应商已归档，不能修改或重新关联商品。', INVALID_CREDENTIALS: '账号或密码不正确', VERSION_CONFLICT: '资料已被其他人修改，请刷新后重新编辑。', COMMAND_PROCESSING: '提交仍在处理中，请稍后查询结果；若持续未完成，需要管理员核对。',
        STORE_ALREADY_BOUND: '所选门店已绑定其他有效模板。', DIRECT_TERM_PRICES_MUST_MATCH: '供应商账期结算要求销售价与供货价一致。',
        FREIGHT_NOT_ALLOWED: '该订单不允许收取运费，请使用零运费。',
        CLEARED_CREDIT_ADJUSTMENT_REQUIRED: '调整金额低于已清挂账金额，请联系财务处理独立结算调整；原清账记录保持不变。',
        CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED: '该挂账仍有未确认的退回或抵扣差额，完成差额处置确认后才能涨价；有效已付金额以确认结果为准。',
        STORE_RECEIVABLE_UNSETTLED: '门店对应应收尚未结清，暂不能向供应商付款。',
        STORE_TEMPLATE_NOT_FOUND: '原申请模板已不可用，请核对配置或采购拒单。',
        TEMPLATE_NAME_EXISTS: '模板名称已存在，请使用不同名称。',
        SUPPLIER_NOT_IN_TEMPLATE: '请先为模板商品关联该供应商。',
        TEMPLATE_PRICE_PAIR_NOT_ALLOWED: '请为有效模板选择已关联的商品和供货方。',
        TEMPLATE_SUPPLY_PRICE_READ_ONLY: '模板供货价取供应商共享价格，请在共享价格范围维护成本。',
        PRICE_VERSION_NOT_FOUND: '该商品和供货方尚无已生效价格。',
        BRAND_NAME_EXISTS: '品牌名称已存在。', CATEGORY_DEPTH_EXCEEDED: '分类最多支持两级，不能关联到自身或二级分类。',
        STORE_GROUP_NAME_EXISTS: '分组名称已存在，请使用其他名称。', STORE_GROUP_NOT_FOUND: '分组已变更或删除，请刷新后重新选择。',
        STORE_GROUP_DISABLED: '该分组已停用，不能再分配门店。', STORE_GROUP_IN_USE: '该分组仍有门店，不能删除，请先调整门店归属。',
        CATEGORY_HAS_CHILDREN: '该分类还有子分类，不能删除或改为二级分类。', CATALOG_RECORD_IN_USE: '该资料已被商品或单位换算引用，不能删除。',
        UNIT_HISTORY_SNAPSHOT_REQUIRED: '该单位已用于历史交易或换算，不能修改交易单位。',
        UNIT_CONVERSION_INVALID: '单位或换算数量无效，请检查采购单位、比例和数量精度。',
        PRODUCT_SKU_EXISTS: '该货号已被其他商品使用。',
        INVALID_ITEM_QUANTITY: '销售单位数量不满足起订量或订货倍数。',
        PRICE_SCOPE_NOT_FOUND: '该商品和供应商尚未设置价格。', DUPLICATE_TEMPLATE_ITEM: '商品或供货方不能重复。' };
      const blockedMessage = code === 'PAYMENT_PREVIEW_EMPTY' && Array.isArray(detail.details?.blockedItems)
        ? detail.details.blockedItems.map(item => messages[item.code] || item.message).filter(message => typeof message === 'string' && message).join('；') : '';
      const error = new Error(blockedMessage || messages[code] || (response.status === 403 ? '当前账号无权执行此操作。'
        : response.status === 401 ? '登录已失效，请重新登录。' : detail.message || `请求失败（${response.status}）`));
      error.code = code;
      error.status = response.status;
      error.uncertain = response.status >= 500 && Boolean(options.method && options.method !== 'GET');
      if (response.status === 401 && path !== '/auth/login') { clear(); onExpired(); }
      throw error;
    }
    if (!envelope || !Object.hasOwn(envelope, 'data')) {
      const error = new Error('接口返回异常，请刷新后核对。');
      error.uncertain = Boolean(options.method && options.method !== 'GET');
      throw error;
    }
    return envelope.data;
  }

  return {
    base,
    get session() { return session; },
    get pendingCommand() { return pendingCommand(); },
    request,
    clear,
    async login(username, password) {
      clear();
      const result = await request('/auth/login', { method: 'POST', body: { username, password, client: 'WEB' } });
      session = result;
      try { storage.setItem(key, JSON.stringify(result)); } catch { /* Login can continue for this tab. */ }
      return result;
    },
    async restore() {
      if (!session) return false;
      const result = await request('/me');
      session = { ...session, user: result.user, expiresAt: result.session.expiresAt };
      return true;
    },
    async logout() {
      try { if (session) await request('/auth/logout', { method: 'POST' }); }
      finally { clear(); }
    },
    async command(path, body, method = 'POST') {
      if (!['POST', 'PATCH'].includes(method)) throw new Error('提交方法无效。');
      if (pendingCommand()) throw new Error('上次提交尚未确认，请先查询提交结果。');
      const command = { path, body, method, key: `web-${crypto.randomUUID()}` };
      try { storage.setItem(commandKey(), JSON.stringify(command)); }
      catch { throw new Error('无法保存提交记录，本次未发送。'); }
      return runCommand(command);
    },
    async recoverCommand() {
      const command = pendingCommand();
      if (!command) throw new Error('没有待确认的提交。');
      return runCommand(command);
    },
  };
}
