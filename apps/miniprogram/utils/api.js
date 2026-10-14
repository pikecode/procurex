const tokenKey = 'procurexToken';
const userKey = 'procurexUser';
let activeRequests = 0;

function authHeaders(testControl = false) {
  const token = wx.getStorageSync(tokenKey);
  const identity = currentUser()?.testIdentity;
  return { ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(!testControl && identity ? { 'x-test-user-id': identity.userId } : {}) };
}

function apiBase() {
  const app = getApp();
  return normalizeBase(app.globalData.apiBase);
}

function request(path, options = {}) {
  const url = `${apiBase()}${path}`;
  activeRequests++;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 10000,
      header: {
        ...(options.data ? { 'content-type': 'application/json' } : {}),
        ...authHeaders(options.testControl),
        ...(options.header || {})
      },
      success(response) {
        const body = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body.data || body);
          return;
        }
        const code = body.code || (body.error && body.error.code);
        const messages = {
          COMMAND_ROLLED_BACK: '原价格重算已回滚，请刷新任务核对后重新提交。',
          COMMAND_NOT_COMMITTED: '原价格重算未提交，请刷新任务核对后重新提交。',
          FREIGHT_NOT_ALLOWED: '该订单不允许收取运费，请使用零运费。',
          CLEARED_CREDIT_ADJUSTMENT_REQUIRED: '调整金额低于已清挂账金额，请联系财务处理独立结算调整；原清账记录保持不变。',
          CLEARED_CREDIT_REINCREASE_RECONCILIATION_REQUIRED: '该挂账仍有未确认的退回或抵扣差额，完成差额处置确认后才能涨价；有效已付金额以确认结果为准。'
        };
        const error = new Error(messages[code] || body.message || (body.error && body.error.message) || `请求失败(${response.statusCode})`);
        error.status = response.statusCode;
        error.code = code;
        error.uncertain = response.statusCode >= 500 || [408, 429].includes(response.statusCode) || error.code === 'COMMAND_PROCESSING';
        reject(error);
      },
      fail(error) {
        const failure = new Error('网络连接失败，请检查网络后重试');
        failure.uncertain = true;
        reject(failure);
      }
    });
  }).finally(() => { activeRequests--; });
}

function normalizeBase(value) {
  const base = String(value || '').trim();
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function checkHealth() {
  return request('/health/live', { timeout: 5000 });
}

async function login(username, password) {
  const result = await request('/auth/login', {
    method: 'POST',
    data: { username, password, client: 'MINIPROGRAM' }
  });
  wx.setStorageSync(tokenKey, result.accessToken);
  wx.setStorageSync(userKey, result.user);
  return result.user;
}

async function restoreSession() {
  const token = wx.getStorageSync(tokenKey);
  if (!token) return null;
  try {
    const result = await request('/me');
    wx.setStorageSync(userKey, result.user);
    return result.user;
  } catch (error) {
    if (error.status === 401) {
      wx.removeStorageSync(tokenKey);
      wx.removeStorageSync(userKey);
      return null;
    }
    throw error;
  }
}

function assertTestSwitchSafe() {
  if (activeRequests || roleFlights.size) throw new Error('请等待当前操作完成后再切换身份');
  if (typeof getCurrentPages === 'function' && getCurrentPages().some(page => {
    if (page.route === 'pages/test-workbench/index') return false;
    const data = page.data || {};
    return ['submitting', 'receiving', 'receiptUploading', 'uploading', 'confirming', 'shipping', 'rejecting', 'resolving', 'paying', 'freightRequesting', 'freightReviewing', 'reallocating', 'reviewing', 'recovering', 'saving'].some(key => Boolean(data[key]));
  })) throw new Error('请完成或取消当前操作后再切换身份');
  const user = currentUser();
  if (!user?.testWorkbenchEnabled) throw new Error('当前账号未开放测试身份');
  for (const name of ['purchaser', 'supplier', 'finance']) {
    if (roleCommandState(name).pending) throw new Error('请先确认原提交结果，再切换身份');
  }
  if (user.scope?.storeId) {
    for (const kind of ['order', 'receipt']) {
      if (wx.getStorageSync(`procurex-${kind}-${user.id}-${user.scope.storeId}`)) throw new Error('请先完成待确认的订货或收货，再切换身份');
    }
  }
}

async function switchTestIdentity(userId) {
  assertTestSwitchSafe();
  const result = userId ? await request('/auth/test-identity', { method: 'POST', data: { userId }, testControl: true })
    : await request('/me', { testControl: true });
  wx.setStorageSync(userKey, result.user);
  return result.user;
}

function currentUser() {
  return wx.getStorageSync(userKey);
}

const roleFlights = new Set();
function roleStorage(workspace) {
  const user = currentUser();
  if (!user || !user.id || !['purchaser', 'supplier', 'finance'].includes(workspace)) throw new Error('请重新登录');
  return `procurexRoleCommands:${encodeURIComponent(apiBase())}:${user.id}:${workspace}`;
}
function roleCommandState(workspace) {
  const state = wx.getStorageSync(roleStorage(workspace));
  return state && typeof state === 'object' ? state : { pending: null, history: [] };
}
async function sendRoleCommand(workspace, command) {
  const storage = roleStorage(workspace);
  if (roleFlights.has(storage)) throw new Error('正在确认提交结果');
  roleFlights.add(storage);
  try {
    let result;
    try { result = await request(command.path, { method: command.method || 'POST', data: command.body, header: { 'idempotency-key': command.key } }); }
    catch (error) {
      // Authentication loss does not resolve an earlier uncertain submission.
      if (!error.uncertain && ![401, 403].includes(error.status) && error.code !== 'IDEMPOTENCY_KEY_REUSED') finish('FAILED', error.message, undefined, error.code);
      throw error;
    }
    finish('SUCCEEDED', undefined, command.path === '/price-changes' || /^\/jobs\/[^/]+\/process$/.test(command.path) ? result : undefined);
    return result;
  } finally { roleFlights.delete(storage); }
  function finish(status, message, result, code) {
    const state = wx.getStorageSync(storage);
    wx.setStorageSync(storage, { pending: null, history: [{ title: command.title, path: command.path, key: command.key,
      status, finishedAt: new Date().toISOString(), ...(message ? { message } : {}), ...(code ? { code } : {}), ...(result ? { result } : {}) }, ...(state.history || [])].slice(0, 20) });
  }
}
function roleCommand(workspace, path, options) {
  const state = roleCommandState(workspace);
  if (state.pending) return Promise.reject(new Error('有待确认的提交，请先确认原提交结果'));
  const action = path.split('/').pop();
  const subject = path.startsWith('/purchase-requests/') ? '采购' : path.startsWith('/payment-records/') ? '收款'
    : path.startsWith('/freight-confirmations/') ? '运费' : path.startsWith('/supplier-orders/') ? '供货' : '';
  const operation = ({ confirm: '确认', reject: '驳回', reallocate: '改派', shipments: '发货', resolve: '差异处理', 'freight-confirmations': '申请运费' })[action] || '业务提交';
  const accountTitle = /^\/stores\/[^/]+\/(recharges|clearings|credit-limit)$/.test(path)
    ? ({ recharges: '门店充值', clearings: '门店销账', 'credit-limit': '挂账额度调整' })[action] : '';
  const title = accountTitle || (path === '/price-changes' ? '价格发布' : /^\/jobs\/[^/]+\/process$/.test(path) ? '价格重算' : `${subject}${operation}`);
  const command = { path, method: options.method || 'POST', body: JSON.parse(JSON.stringify(options.data || {})), key: `${options.header['idempotency-key']}-${Math.random().toString(36).slice(2, 10)}`, title, createdAt: new Date().toISOString() };
  wx.setStorageSync(roleStorage(workspace), { ...state, pending: command });
  return sendRoleCommand(workspace, command);
}
function retryRoleCommand(workspace) {
  const state = roleCommandState(workspace);
  if (!state.pending) return Promise.reject(new Error('没有待确认的提交'));
  return sendRoleCommand(workspace, state.pending);
}

function workspaceNames(user) {
  if (!user) return [];
  const roles = user.roles || [];
  // The administrator root identity is only an identity picker in the mini-program.
  // Business and master-data work must use an explicit target identity or the desktop admin.
  if (roles.includes('ADMIN') && !user.testIdentity) return [];
  const workspaces = [];
  if (roles.includes('STORE') || roles.includes('STORE_FINANCE')) workspaces.push('store');
  if (roles.includes('SUPPLIER')) workspaces.push('supplier');
  if (roles.includes('PURCHASER') || roles.includes('ADMIN')) workspaces.push('purchaser');
  if (roles.includes('HQ_FINANCE') || roles.includes('ADMIN')) workspaces.push('finance');
  if (user.scope?.type === 'MULTI_STORE' && user.scope.storeIds?.length && roles.some(role => ['REGION_MANAGER', 'REGION_FINANCE', 'PURCHASE_FOLLOWER'].includes(role))) workspaces.push('region');
  return workspaces;
}

function refreshWorkspaceNavigation() {
  if (typeof getCurrentPages !== 'function') return;
  const pages = getCurrentPages();
  const bar = pages[pages.length - 1]?.getTabBar?.();
  if (bar?.refresh) bar.refresh();
}

function openWorkspace(name) {
  const user = currentUser();
  refreshWorkspaceNavigation();
  if (!user) {
    wx.redirectTo({ url: '/pages/login/index' });
    return null;
  }
  if (user.testWorkbenchEnabled && (user.roles || []).includes('ADMIN') && !user.testIdentity) {
    wx.reLaunch({ url: '/pages/test-workbench/index' });
    return null;
  }
  const workspaces = workspaceNames(user);
  if (!workspaces.includes(name)) {
    if (workspaces.length) wx.switchTab({ url: `/pages/${workspaces[0]}/index` });
    else wx.redirectTo({ url: '/pages/login/index' });
    return null;
  }
  return user;
}

function logout() {
  wx.removeStorageSync(tokenKey);
  wx.removeStorageSync(userKey);
  refreshWorkspaceNavigation();
}

function downloadEvidence(file) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${apiBase()}/files/${file.id}/download`,
      header: authHeaders(),
      timeout: 10000,
      success(response) {
        if (response.statusCode !== 200 || !response.tempFilePath) {
          reject(new Error('凭证下载失败，请刷新单据后重试'));
          return;
        }
        resolve(response.tempFilePath);
      },
      fail() { reject(new Error('凭证下载失败，请检查网络连接')); }
    });
  });
}

async function previewEvidence(file) {
  const path = await downloadEvidence(file);
  return new Promise((resolve, reject) => {
    const callbacks = { success: resolve, fail: () => reject(new Error('凭证无法打开，请稍后重试')) };
    if (file.mimeType === 'application/pdf') wx.openDocument({ filePath: path, fileType: 'pdf', showMenu: true, ...callbacks });
    else wx.previewImage({ urls: [path], ...callbacks });
  });
}

function chooseEvidence(count) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({ count, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: result => resolve(result.tempFiles.map(file => ({ path: file.path, size: file.size }))),
      fail: error => { if (String(error.errMsg || '').includes('cancel')) resolve([]); else reject(new Error('无法选择图片')); }
    });
  });
}

async function uploadEvidence(path, purpose) {
  const bytes = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path,
    success: result => resolve(result.data), fail: () => reject(new Error('图片读取失败，请重新选择')) }));
  const signature = new Uint8Array(bytes);
  const mimeType = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff ? 'image/jpeg'
    : signature[0] === 137 && signature[1] === 80 && signature[2] === 78 && signature[3] === 71 ? 'image/png' : '';
  const maxBytes = (purpose === 'PRODUCT' ? 2 : 10) * 1024 * 1024;
  if (!mimeType || !bytes.byteLength || bytes.byteLength > maxBytes) throw new Error(purpose === 'PRODUCT' ? '商品图片需为2MB以内的JPEG或PNG' : '请选择10MB以内的JPEG或PNG图片');
  const prefix = purpose === 'PRODUCT' ? 'product' : purpose === 'SHIPMENT_ADJUSTMENT' ? 'shipment-adjustment' : 'receipt';
  const filename = `${prefix}-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const session = await request('/files/upload-sessions', { method: 'POST', data: { purpose, filename, mimeType, sizeBytes: bytes.byteLength } });
  await request(`/files/${session.id}/content`, { method: 'POST', data: bytes,
    header: { 'content-type': 'application/octet-stream', 'x-upload-token': session.uploadToken }, timeout: 30000 });
  const completed = await request(`/files/${session.id}/complete`, { method: 'POST' });
  if (completed.status !== 'READY') throw new Error('图片尚未完成上传，请重试');
  return { id: session.id, filename, mimeType, sizeBytes: String(bytes.byteLength) };
}

function imagePath(file) {
  return new Promise((resolve, reject) => wx.downloadFile({ url: `${apiBase()}/files/${file.id}/download`,
    header: authHeaders(), timeout: 10000,
    success: result => result.statusCode === 200 && result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('图片加载失败')),
    fail: () => reject(new Error('图片加载失败，请检查网络')) }));
}

module.exports = {
  apiBase,
  request,
  checkHealth,
  login,
  restoreSession,
  currentUser,
  switchTestIdentity,
  authHeaders,
  roleCommand,
  roleCommandState,
  retryRoleCommand,
  openWorkspace,
  workspaceNames,
  previewEvidence,
  downloadEvidence,
  chooseEvidence,
  uploadEvidence,
  imagePath,
  logout
};
