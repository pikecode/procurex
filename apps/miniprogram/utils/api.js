const tokenKey = 'procurexToken';
const userKey = 'procurexUser';

function apiBase() {
  const app = getApp();
  return normalizeBase(wx.getStorageSync('procurexApiBase') || app.globalData.apiBase);
}

function request(path, options = {}) {
  const token = wx.getStorageSync(tokenKey);
  const url = `${apiBase()}${path}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 10000,
      header: {
        ...(options.data ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.header || {})
      },
      success(response) {
        const body = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body.data || body);
          return;
        }
        reject(new Error(body.message || (body.error && body.error.message) || `请求失败(${response.statusCode})`));
      },
      fail(error) {
        reject(new Error(`${error.errMsg || '网络请求失败'}：${url}`));
      }
    });
  });
}

function normalizeBase(value) {
  const base = String(value || '').trim();
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function setApiBase(value) {
  const base = normalizeBase(value);
  wx.setStorageSync('procurexApiBase', base);
  getApp().globalData.apiBase = base;
  return base;
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

function currentUser() {
  return wx.getStorageSync(userKey);
}

function logout() {
  wx.removeStorageSync(tokenKey);
  wx.removeStorageSync(userKey);
}

module.exports = {
  apiBase,
  setApiBase,
  request,
  checkHealth,
  login,
  currentUser,
  logout
};
