const api = require('../../utils/api');
const labels = { STORE: '门店厨政经理', STORE_FINANCE: '门店财务', SUPPLIER: '供应商', PURCHASER: '公司采购', HQ_FINANCE: '公司财务' };
const roleOrder = ['STORE', 'STORE_FINANCE', 'SUPPLIER', 'PURCHASER', 'HQ_FINANCE'];
const tones = { STORE: 'store', STORE_FINANCE: 'store-finance', SUPPLIER: 'supplier', PURCHASER: 'purchaser', HQ_FINANCE: 'finance' };

Page({
  data: { user: null, currentUserId: '', items: [], groups: [], loading: false, switching: false, error: '' },
  onShow() { this.load(); },
  async load() {
    const user = api.currentUser();
    this.setData({ user, currentUserId: user?.testIdentity?.userId || '', items: [], groups: [], loading: true, error: '' });
    if (!user?.testWorkbenchEnabled) { this.setData({ loading: false, error: '当前环境或账号未开放测试身份' }); return; }
    try {
      const items = await api.request('/auth/test-identities', { testControl: true });
      this.setData({ items: items.map(item => ({ ...item, roleText: labels[item.roles[0]] || item.roles[0] })) });
      this.groupItems();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  groupItems() {
    const groups = roleOrder.map(role => ({ role, label: labels[role], tone: tones[role],
      items: this.data.items.filter(item => item.roles[0] === role) })).filter(group => group.items.length);
    this.setData({ groups });
  },
  async select(event) {
    if (this.data.switching || this.data.loading) return;
    const id = event.currentTarget.dataset.id;
    const item = this.data.items.find(entry => entry.id === id);
    if (id && !item) return;
    this.setData({ switching: true, error: '' });
    try {
      const confirmation = await new Promise(resolve => wx.showModal({ title: item ? '进入业务身份' : '返回管理员',
        content: item ? `${item.displayName} · ${item.entityName || item.roleText}。操作会产生真实业务单据。` : '退出当前业务身份，返回管理员身份入口。',
        success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!confirmation.confirm) return;
      const user = await api.switchTestIdentity(id || null);
      // Recreate cached tab pages so another identity cannot retain the previous account's data.
      const workspace = api.workspaceNames(user)[0];
      wx.reLaunch({ url: workspace ? `/pages/${workspace}/index` : '/pages/test-workbench/index' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ switching: false }); }
  },
  logout() {
    if (this.data.switching || this.data.loading) return;
    api.logout();
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
