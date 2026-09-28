const api = require('../../utils/api');

Page({
  data: {
    apiBase: 'http://127.0.0.1:3100/api/v1',
    username: '',
    password: '',
    loading: false,
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
    this.setData({ loading: true, error: '' });
    try {
      wx.setStorageSync('procurexApiBase', this.data.apiBase);
      wx.setStorageSync('procurexLastUsername', this.data.username);
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
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  }
});
