const api = require('../../utils/api');

Page({
  data: {
    user: {},
    roleText: '未登录',
    storeId: '',
    productId: '',
    quantity: '10',
    requests: [],
    account: null,
    ledgers: [],
    shipmentId: '',
    shortReceivedQuantity: '0',
    shipmentTodos: [],
    reportRange: {
      from: '2026-09-01',
      to: '2026-09-30'
    },
    reports: {
      orderAmount: null,
      productQuantity: null
    },
    preview: null,
    created: null,
    receiptResult: null,
    previewing: false,
    submitting: false,
    loading: false,
    accounting: false,
    receiving: false,
    error: ''
  },

  onShow() {
    const user = api.currentUser();
    if (!user) {
      wx.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const scopedStoreId = user.scope && user.scope.storeId;
    this.setData({
      user,
      roleText: (user.roles || []).join(' / '),
      storeId: this.data.storeId || scopedStoreId || ''
    });
    this.loadWork();
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  selectShipment(event) {
    this.setData({ shipmentId: event.currentTarget.dataset.id });
  },

  selectRequest(event) {
    this.setData({
      created: {
        id: event.currentTarget.dataset.id,
        requestNo: event.currentTarget.dataset.no,
        status: event.currentTarget.dataset.status,
        paymentStatus: event.currentTarget.dataset.paymentStatus
      }
    });
  },

  async loadWork() {
    this.setData({ loading: true, error: '' });
    try {
      const tasks = [this.loadRequests(false), this.loadShipments(false), this.loadReports(false)];
      if (this.data.storeId) tasks.push(this.loadAccount(false));
      await Promise.all(tasks);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadRequests(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const requests = await api.request('/purchase-requests');
      this.setData({ requests: Array.isArray(requests) ? requests.slice(0, 20) : [] });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadShipments(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const data = await api.request('/notifications');
      const notifications = data.notifications || [];
      const shipmentTodos = notifications
        .filter((item) => item.payload && item.payload.type === 'SHIPMENT_CREATED' && item.payload.shipmentId)
        .map((item) => ({
          id: item.payload.shipmentId,
          shipmentNo: item.payload.shipmentNo || item.payload.shipmentId,
          supplierOrderId: item.payload.supplierOrderId,
          title: item.title,
          createdAt: item.createdAt
        }))
        .slice(0, 20);
      this.setData({ shipmentTodos });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadAccount(toggleLoading = true) {
    if (!this.data.storeId) {
      this.setData({ error: '请先填写门店 ID' });
      return;
    }
    if (toggleLoading) this.setData({ accounting: true, error: '' });
    try {
      const [account, ledgers] = await Promise.all([
        api.request(`/stores/${this.data.storeId}/account`),
        api.request(`/stores/${this.data.storeId}/ledgers`)
      ]);
      this.setData({
        account,
        ledgers: Array.isArray(ledgers) ? ledgers.slice(0, 5) : []
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ accounting: false });
    }
  },

  async loadReports(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const range = `from=${this.data.reportRange.from}&to=${this.data.reportRange.to}`;
      const [orderAmount, productQuantity] = await Promise.all([
        api.request(`/reports/order-amounts?${range}`),
        api.request(`/reports/product-quantities?${range}`)
      ]);
      this.setData({ reports: { orderAmount, productQuantity } });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
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
  },

  async receiveShipment(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!this.data.shipmentId) {
      this.setData({ error: '请先选择或输入发货单 ID' });
      return;
    }

    this.setData({ receiving: true, error: '', receiptResult: null });
    try {
      const shipment = await api.request(`/shipments/${this.data.shipmentId}`);
      const items = (shipment.items || []).map((item, index) => ({
        shipmentItemId: item.id,
        receivedQuantity: mode === 'SHORT' && index === 0 ? this.data.shortReceivedQuantity : item.shippedQuantity
      }));
      const receipt = await api.request(`/shipments/${this.data.shipmentId}/receipts`, {
        method: 'POST',
        data: {
          expectedOrderVersion: shipment.supplierOrderVersion,
          expectedReceiptRevision: shipment.currentReceiptRevision,
          items
        },
        header: { 'idempotency-key': `mini-store-receipt-${mode}-${Date.now()}` }
      });
      this.setData({
        receiptResult: {
          title: receipt.receiptNo || receipt.id,
          status: mode === 'SHORT' ? 'SHORT_RECEIVED' : 'RECEIVED',
          detail: `发货单 ${shipment.shipmentNo} 已提交第 ${receipt.revision} 版收货`
        }
      });
      await this.loadWork();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ receiving: false });
    }
  }
});
