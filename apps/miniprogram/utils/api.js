const tokenKey = 'procurexToken';
const userKey = 'procurexUser';

function apiBase() {
  const app = getApp();
  return wx.getStorageSync('procurexApiBase') || app.globalData.apiBase;
}

function request(path, options = {}) {
  const token = wx.getStorageSync(tokenKey);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase()}${path}`,
      method: options.method || 'GET',
      data: options.data,
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
        reject(new Error(error.errMsg || '网络请求失败'));
      }
    });
  });
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
  request,
  login,
  currentUser,
  logout
};
