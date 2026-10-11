const api = require('../../utils/api');
const labels = { STORE: '门店厨政经理', STORE_FINANCE: '门店财务', SUPPLIER: '供应商', PURCHASER: '公司采购', HQ_FINANCE: '公司财务' };

Page({
  data: { user: null, items: [], filtered: [], search: '', loading: false, switching: false, error: '' },
  onShow() { this.load(); },
  async load() {
    const user = api.currentUser();
    this.setData({ user, items: [], filtered: [], loading: true, error: '' });
    if (!user?.testWorkbenchEnabled) { this.setData({ loading: false, error: '当前环境或账号未开放测试身份' }); return; }
    try {
      const items = await api.request('/auth/test-identities', { testControl: true });
      this.setData({ items: items.map(item => ({ ...item, roleText: labels[item.roles[0]] || item.roles[0] })) });
      this.filter();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  onSearch(event) { this.setData({ search: event.detail.value }); this.filter(); },
  filter() {
    const search = this.data.search.trim().toLowerCase();
    this.setData({ filtered: this.data.items.filter(item => [item.displayName, item.username, item.entityName, item.roleText].join(' ').toLowerCase().includes(search)) });
  },
  async select(event) {
    if (this.data.switching || this.data.loading) return;
    const id = event.currentTarget.dataset.id;
    const item = this.data.items.find(entry => entry.id === id);
    if (id && !item) return;
    this.setData({ switching: true, error: '' });
    try {
      const confirmation = await new Promise(resolve => wx.showModal({ title: item ? '切换测试身份' : '返回管理员',
        content: item ? `${item.displayName} · ${item.entityName || item.roleText}。操作会产生真实业务单据。` : '退出当前测试视角，返回管理员工作区。',
        success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!confirmation.confirm) return;
      const user = await api.switchTestIdentity(id || null);
      // Recreate cached tab pages so another identity cannot retain the previous account's data.
      wx.reLaunch({ url: `/pages/${api.workspaceNames(user)[0]}/index` });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ switching: false }); }
  }
});
