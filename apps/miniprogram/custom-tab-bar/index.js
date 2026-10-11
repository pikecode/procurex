const api = require('../utils/api');
const labels = { store: '门店', supplier: '供应商', purchaser: '采购', finance: '公司财务', region: '授权门店' };

Component({
  data: { items: [], visible: false, selected: '', switching: false, testEnabled: false, testLabel: '' },
  lifetimes: { attached() { this.refresh(); } },
  methods: {
    refresh() {
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route;
      const user = api.currentUser();
      const items = api.workspaceNames(user).map(name => ({ name, label: labels[name], path: `pages/${name}/index` }));
      this.setData({ items, visible: items.length > 1 && !(user?.roles || []).includes('ADMIN') && !user?.testWorkbenchEnabled,
        testEnabled: Boolean(user?.testWorkbenchEnabled), testLabel: user?.testIdentity ? user.testIdentity.displayName : '',
        selected: items.find(item => item.path === route)?.name || '' });
    },
    openTestWorkbench() { wx.navigateTo({ url: '/pages/test-workbench/index' }); },
    switchWorkspace(event) {
      this.refresh();
      const name = event.currentTarget.dataset.name;
      const item = this.data.items.find(entry => entry.name === name);
      if (!item || name === this.data.selected || this.data.switching) return;
      this.setData({ switching: true });
      wx.switchTab({ url: `/${item.path}`, complete: () => {
        this.setData({ switching: false });
        this.refresh();
      } });
    }
  }
});
