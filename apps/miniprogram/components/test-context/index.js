const api = require('../../utils/api');
const roles = { STORE: '门店厨政经理', STORE_FINANCE: '门店财务', SUPPLIER: '供应商', PURCHASER: '公司采购', HQ_FINANCE: '公司财务', ADMIN: '管理员' };
Component({
  data: { enabled: false, label: '', roleText: '' },
  lifetimes: { attached() { this.refresh(); } },
  pageLifetimes: { show() { this.refresh(); } },
  methods: {
    refresh() {
      const user = api.currentUser();
      this.setData({ enabled: Boolean(user?.testWorkbenchEnabled),
        roleText: user?.testIdentity ? roles[(user.roles || [])[0]] || '测试角色' : '管理员',
        label: user?.displayName ? `${user.displayName}（${user.username || ''}）` : '管理员' });
    },
    open() { wx.navigateTo({ url: '/pages/test-workbench/index' }); }
  }
});
