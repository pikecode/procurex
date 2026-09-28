App({
  globalData: {
    apiBase: 'http://127.0.0.1:3100/api/v1'
  },
  onLaunch() {
    const configured = wx.getStorageSync('procurexApiBase');
    if (configured) this.globalData.apiBase = configured;
  }
});
