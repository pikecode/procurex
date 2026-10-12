const api = require('../utils/api');
const labels = { store: '门店', supplier: '供应商', purchaser: '采购', finance: '公司财务', region: '授权门店' };

Component({
  data: { items: [], visible: false, selected: '', switching: false, testEnabled: false, testLabel: '' },
  lifetimes: { attached() { this.refresh(); } },
  methods: {
    // 页面自己不知道切换栏是否可见（条件在工作区权限里），由这里统一回传，
    // 页面据此把角色导航、操作条整体上移，避免被切换栏盖住。
    publishVisibility(visible) {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      if (!page || typeof page.setData !== 'function') return;
      if (page.data?.workspaceTabbarVisible === visible) return;
      try { page.setData({ workspaceTabbarVisible: visible }); } catch (error) { /* 页面尚未就绪，下次 refresh 会补发 */ }
    },
    refresh() {
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route;
      const user = api.currentUser();
      const items = api.workspaceNames(user).map(name => ({ name, label: labels[name], path: `pages/${name}/index` }));
      const visible = items.length > 1 && !(user?.roles || []).includes('ADMIN') && !user?.testWorkbenchEnabled;
      this.setData({ items, visible,
        testEnabled: Boolean(user?.testWorkbenchEnabled), testLabel: user?.testIdentity ? user.testIdentity.displayName : '',
        selected: items.find(item => item.path === route)?.name || '' });
      this.publishVisibility(visible);
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
