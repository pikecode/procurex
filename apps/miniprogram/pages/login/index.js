const api = require('../../utils/api');

Page({
  data: {
    apiBase: 'http://127.0.0.1:3100/api/v1',
    username: '',
    password: '',
    loading: false,
    loadingText: '',
    error: ''
  },

  onLoad() {
    const app = getApp();
    this.setData({
      apiBase: wx.getStorageSync('procurexApiBase') || app.globalData.apiBase,
      username: wx.getStorageSync('procurexLastUsername') || ''
    });
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  fillDemo() {
    this.setData({ username: 'pxflow_store', password: 'correct-password' });
  },

  async submit() {
    const apiBase = this.data.apiBase.trim();
    if (!apiBase) {
      this.setData({ error: '请先填写 API 地址' });
      return;
    }

    this.setData({ loading: true, loadingText: '连接 API...', error: '' });
    try {
      api.setApiBase(apiBase);
      wx.setStorageSync('procurexLastUsername', this.data.username);
      await api.checkHealth();
      this.setData({ loadingText: '登录中...' });
      const user = await api.login(this.data.username, this.data.password);
      const roles = user.roles || [];
      if (roles.includes('STORE') || roles.includes('STORE_FINANCE')) {
        wx.switchTab({ url: '/pages/store/index' });
      } else if (roles.includes('SUPPLIER')) {
        wx.switchTab({ url: '/pages/supplier/index' });
      } else if (roles.includes('PURCHASER') || roles.includes('ADMIN')) {
        wx.switchTab({ url: '/pages/purchaser/index' });
      } else {
        this.setData({ error: '当前账号没有小程序角色入口' });
      }
    } catch (error) {
      this.setData({ error: explainError(error.message) });
    } finally {
      this.setData({ loading: false, loadingText: '' });
    }
  }
});

function explainError(message) {
  if (message.includes('request:fail') || message.includes('timeout')) {
    return `${message}。本地测试请确认 API 已启动；真机不能使用 127.0.0.1，需要填写电脑局域网 IP 或 HTTPS 域名。`;
  }

  return message;
}
