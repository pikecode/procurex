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
    this.restoreLogin();
  },

  async restoreLogin() {
    if (!wx.getStorageSync('procurexToken')) return;
    this.setData({ loading: true, loadingText: '恢复登录中...', error: '' });
    try {
      const user = await api.restoreSession();
      const workspace = api.workspaceNames(user)[0];
      if (workspace) {
        wx.switchTab({ url: `/pages/${workspace}/index` });
        return;
      }
      if (user) this.setData({ error: '当前账号没有小程序角色入口' });
    } catch {
      this.setData({ error: '登录态暂时无法验证，请检查网络后重试或重新登录' });
    } finally {
      this.setData({ loading: false, loadingText: '' });
    }
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
      const workspace = api.workspaceNames(user)[0];
      if (workspace) {
        wx.switchTab({ url: `/pages/${workspace}/index` });
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
