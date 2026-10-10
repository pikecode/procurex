const api = require('../../utils/api');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    loadingText: '',
    error: ''
  },

  onLoad() {
    this.setData({
      username: wx.getStorageSync('procurexLastUsername') || ''
    });
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async submit() {
    if (this.data.loading) return;
    if (!this.data.username.trim() || !this.data.password) {
      this.setData({ error: '请输入账号和密码' });
      return;
    }
    this.setData({ loading: true, loadingText: '连接中...', error: '' });
    try {
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
      } else if (roles.includes('HQ_FINANCE')) {
        wx.switchTab({ url: '/pages/finance/index' });
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
