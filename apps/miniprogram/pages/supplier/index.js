const api = require('../../utils/api');

Page({
  data: {
    user: {},
    roleText: '未登录',
    orders: [],
    discrepancies: [],
    statements: [],
    payments: [],
    reportRange: {
      from: '2026-09-01',
      to: '2026-09-30'
    },
    reports: {
      orderAmount: null,
      productQuantity: null
    },
    supplierOrderId: '',
    shipQuantity: '10',
    discrepancyId: '',
    discrepancyReason: '',
    paymentId: '',
    paymentReason: '',
    loading: false,
    shipping: false,
    rejecting: false,
    resolving: false,
    paying: false,
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
    this.loadWork();
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  selectOrder(event) {
    this.setData({ supplierOrderId: event.currentTarget.dataset.id });
  },

  selectDiscrepancy(event) {
    this.setData({ discrepancyId: event.currentTarget.dataset.id });
  },

  selectPayment(event) {
    this.setData({ paymentId: event.currentTarget.dataset.id });
  },

  async loadWork() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadOrders(false),
        this.loadDiscrepancies(false),
        this.loadStatements(false),
        this.loadPayments(false),
        this.loadReports(false)
      ]);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadOrders(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const orders = await api.request('/supplier-orders');
      this.setData({ orders: Array.isArray(orders) ? orders.slice(0, 20) : [] });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadDiscrepancies(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const data = await api.request('/notifications');
      const notifications = data.notifications || [];
      const discrepancies = [];
      for (const item of notifications) {
        const ids = item.payload && item.payload.discrepancyIds;
        if (!Array.isArray(ids)) continue;
        for (const id of ids) {
          discrepancies.push({
            id,
            title: item.title,
            receiptId: item.payload.receiptId,
            createdAt: item.createdAt
          });
        }
      }
      this.setData({ discrepancies: discrepancies.slice(0, 20) });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadStatements(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const statements = await api.request('/supplier-statements');
      this.setData({ statements: Array.isArray(statements) ? statements.slice(0, 20) : [] });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadPayments(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const payments = await api.request('/payment-records?direction=COMPANY_TO_SUPPLIER');
      this.setData({ payments: Array.isArray(payments) ? payments.slice(0, 20) : [] });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
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

  async shipOrder() {
    this.setData({ shipping: true, error: '', result: null });
    try {
      const order = await api.request(`/supplier-orders/${this.data.supplierOrderId}`);
      const items = (order.items || []).map((item, index) => ({
        orderItemId: item.id,
        shipQuantity: index === 0 ? this.data.shipQuantity : item.quantity,
        permanentlyReduceQuantity: '0'
      }));
      const preview = await api.request(`/supplier-orders/${this.data.supplierOrderId}/shipment-preview`, {
        method: 'POST',
        data: { expectedVersion: order.version, items, freight: '0.00' }
      });
      const shipment = await api.request(`/supplier-orders/${this.data.supplierOrderId}/shipments`, {
        method: 'POST',
        data: {
          expectedVersion: order.version,
          items,
          freight: '0.00',
          trackingNo: `MP${Date.now()}`
        },
        header: { 'idempotency-key': `mini-supplier-ship-${Date.now()}` }
      });
      this.setData({
        result: {
          title: shipment.shipmentNo || shipment.id,
          status: shipment.status || 'SHIPPED',
          detail: `预览 ${preview.kind || 'SHIPMENT'}，本次发货 ${this.data.shipQuantity}`
        }
      });
      await this.loadWork();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ shipping: false });
    }
  },

  async rejectOrder() {
    this.setData({ rejecting: true, error: '', result: null });
    try {
      const order = await api.request(`/supplier-orders/${this.data.supplierOrderId}`);
      const rejected = await api.request(`/supplier-orders/${this.data.supplierOrderId}/reject`, {
        method: 'POST',
        data: { expectedVersion: order.version, reason: '小程序供应商拒单' },
        header: { 'idempotency-key': `mini-supplier-reject-${Date.now()}` }
      });
      this.setData({
        result: {
          title: this.data.supplierOrderId,
          status: rejected.status || 'REJECTED',
          detail: '已通知采购处理拒单改派'
        }
      });
      await this.loadWork();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ rejecting: false });
    }
  },

  async resolveDiscrepancy(event) {
    const action = event.currentTarget.dataset.action;
    this.setData({ resolving: true, error: '', result: null });
    try {
      const discrepancy = await api.request(`/discrepancies/${this.data.discrepancyId}`);
      const resolved = await api.request(`/discrepancies/${this.data.discrepancyId}/resolve`, {
        method: 'POST',
        data: {
          expectedVersion: discrepancy.version,
          action,
          reason: this.data.discrepancyReason || undefined
        },
        header: { 'idempotency-key': `mini-discrepancy-${action}-${Date.now()}` }
      });
      this.setData({
        result: {
          title: resolved.id,
          status: resolved.status,
          detail: `处理动作 ${action}，差异数量 ${resolved.missingQuantity}`
        }
      });
      await this.loadWork();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ resolving: false });
    }
  },

  async handlePayment(event) {
    const action = event.currentTarget.dataset.action;
    if (!this.data.paymentId) {
      this.setData({ error: '请先选择或输入付款记录 ID' });
      return;
    }

    this.setData({ paying: true, error: '', result: null });
    try {
      const payment = await api.request(`/payment-records/${this.data.paymentId}`);
      const payload = action === 'confirm'
        ? { expectedVersion: payment.version }
        : { expectedVersion: payment.version, reason: this.data.paymentReason || '供应商小程序驳回付款' };
      const handled = await api.request(`/payment-records/${this.data.paymentId}/${action}`, {
        method: 'POST',
        data: payload,
        header: { 'idempotency-key': `mini-supplier-payment-${action}-${Date.now()}` }
      });
      this.setData({
        result: {
          title: handled.paymentNo || handled.id,
          status: handled.status,
          detail: `付款金额 ${handled.amount}，动作 ${action}`
        }
      });
      await this.loadPayments(false);
      await this.loadStatements(false);
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ paying: false });
    }
  },

  logout() {
    api.logout();
    wx.redirectTo({ url: '/pages/login/index' });
  }
});
