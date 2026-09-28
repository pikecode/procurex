const api = require('../../utils/api');

Page({
  data: {
    user: {},
    roleText: '未登录',
    requests: [],
    requestId: '',
    rejectedOrderId: '',
    targetSupplierId: '',
    loading: false,
    confirming: false,
    reallocating: false,
    result: null,
    error: ''
  },

  onShow() {
    const user = api.currentUser();
    if (!user) {
      wx.redirectTo({ url: '/pages/login/index' });
      return;
    }
    this.setData({ user, roleText: (user.roles || []).join(' / ') });
    this.loadRequests();
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  selectRequest(event) {
    this.setData({ requestId: event.currentTarget.dataset.id });
  },

  async loadRequests() {
    this.setData({ loading: true, error: '' });
    try {
      const requests = await api.request('/purchase-requests');
      this.setData({ requests: Array.isArray(requests) ? requests.slice(0, 20) : [] });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  async confirmRequest() {
    this.setData({ confirming: true, error: '', result: null });
    try {
      const detail = await api.request(`/purchase-requests/${this.data.requestId}`);
      const confirmed = await api.request(`/purchase-requests/${this.data.requestId}/confirm`, {
        method: 'POST',
        data: { expectedVersion: detail.version },
        header: { 'idempotency-key': `mini-purchaser-confirm-${Date.now()}` }
      });
      this.setData({
        result: {
          title: confirmed.requestNo || this.data.requestId,
          status: confirmed.status || 'CONFIRMED',
          detail: `生成供应商单 ${(confirmed.supplierOrders || []).map((order) => order.id).join(', ') || '已推送'}`
        }
      });
      await this.loadRequests();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ confirming: false });
    }
  },

  async reallocateRequest() {
    this.setData({ reallocating: true, error: '', result: null });
    try {
      const detail = await api.request(`/purchase-requests/${this.data.requestId}`);
      const reallocated = await api.request(`/purchase-requests/${this.data.requestId}/reallocate`, {
        method: 'POST',
        data: {
          expectedVersion: detail.version,
          rejectedOrderId: this.data.rejectedOrderId,
          assignments: (detail.items || []).map((item) => ({
            requestItemId: item.id,
            supplierId: this.data.targetSupplierId
          }))
        },
        header: { 'idempotency-key': `mini-purchaser-reallocate-${Date.now()}` }
      });
      this.setData({
        result: {
          title: reallocated.requestNo || this.data.requestId,
          status: reallocated.status || 'REALLOCATED',
          detail: `已改派到 ${this.data.targetSupplierId}`
        }
      });
      await this.loadRequests();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ reallocating: false });
    }
  },

  logout() {
    api.logout();
    wx.redirectTo({ url: '/pages/login/index' });
  }
});
