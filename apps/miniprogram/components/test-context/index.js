const api = require('../../utils/api');
Component({
  data: { enabled: false, label: '' },
  lifetimes: { attached() { this.refresh(); } },
  pageLifetimes: { show() { this.refresh(); } },
  methods: {
    refresh() {
      const user = api.currentUser();
      this.setData({ enabled: Boolean(user?.testWorkbenchEnabled), label: user?.testIdentity ? `${user.testIdentity.displayName}（${user.testIdentity.username}）` : '管理员' });
    },
    open() { wx.navigateTo({ url: '/pages/test-workbench/index' }); }
  }
});
