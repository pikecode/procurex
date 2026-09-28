const api = require('../../utils/api');

Page({
  data: {
    user: {},
    roleText: '未登录',
    storeId: '',
    productId: '',
    quantity: '10',
    preview: null,
    created: null,
    previewing: false,
    submitting: false,
    error: ''
  },

  onShow() {
    const user = api.currentUser();
    if (!user) {
      wx.redirectTo({ url: '/pages/login/index' });
      return;
    }
    this.setData({ user, roleText: (user.roles || []).join(' / ') });
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  orderInput() {
    return {
      storeId: this.data.storeId,
      items: [{ productId: this.data.productId, quantity: this.data.quantity }]
    };
  },

  async previewOrder() {
    this.setData({ previewing: true, error: '' });
    try {
      const preview = await api.request('/purchase-requests/preview', {
        method: 'POST',
        data: this.orderInput()
      });
      this.setData({ preview });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ previewing: false });
    }
  },

  async submitOrder() {
    this.setData({ submitting: true, error: '' });
    try {
      const created = await api.request('/purchase-requests', {
        method: 'POST',
        data: this.orderInput(),
        header: { 'idempotency-key': `mini-store-order-${Date.now()}` }
      });
      this.setData({ created });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
