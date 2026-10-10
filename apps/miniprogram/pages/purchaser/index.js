const api = require('../../utils/api');
const view = require('../../utils/store-view');

Page({
  data: {
    activeView: 'tasks',
    procurementTasks: [],
    pendingFreight: [],
    pendingCommand: null,
    commandHistory: [],
    recovering: false,
    search: '',
    statusFilter: 'all',
    visibleRequests: [],
    user: {},
    roleText: '未登录',
    requests: [],
    rejectionTodos: [],
    selectedRequest: null,
    requestId: '',
    rejectedOrderId: '',
    targetSupplierId: '',
    suppliers: [],
    supplierIndex: -1,
    reallocateReason: '供应商拒单后改派',
    reportRange: view.monthRange(),
    reports: {
      orderAmount: null,
      productQuantity: null,
      profit: null
    },
    loading: false,
    detailing: false,
    confirming: false,
    reallocating: false,
    result: null,
    freightConfirmations: [],
    selectedFreight: null,
    freightReason: '',
    freightReviewing: false,
    error: ''
  },

  onShow() {
    const user = api.openWorkspace('purchaser');
    if (!user) return;
    if (this.data.user.id !== user.id) {
      this.setData({ visibleRequests: [], search: '', statusFilter: 'all', activeView: 'tasks' });
      this.setData({ requests: [], rejectionTodos: [], selectedRequest: null, requestId: '', rejectedOrderId: '', targetSupplierId: '',
        suppliers: [], supplierIndex: -1, result: null, freightConfirmations: [], selectedFreight: null, procurementTasks: [], pendingFreight: [],
        reports: { orderAmount: null, productQuantity: null, profit: null } });
    }
    this.setData({ user, roleText: '采购', reportRange: view.monthRange() });
    this.syncCommands();
    this.loadWork();
  },

  syncCommands() {
    if (!api.roleCommandState) return;
    if (api.currentUser && !api.currentUser()) { this.setData({ pendingCommand: null, commandHistory: [] }); return; }
    const state = api.roleCommandState('purchaser');
    this.setData({ pendingCommand: state.pending ? { ...state.pending, dateText: view.dateText(state.pending.createdAt) } : null,
      commandHistory: state.history.map(item => ({ ...item, dateText: view.dateText(item.finishedAt) })) });
  },
  async submitCommand(path, options) {
    const actorId = api.currentUser ? (api.currentUser() || {}).id : undefined;
    try {
      const result = await api.roleCommand('purchaser', path, options);
      if (api.currentUser && (api.currentUser() || {}).id !== actorId) throw new Error('账号已切换，请刷新');
      return result;
    }
    finally { this.syncCommands(); }
  },
  async recoverCommand() {
    if (this.data.recovering || this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ recovering: true, error: '' });
    const actorId = api.currentUser ? (api.currentUser() || {}).id : undefined;
    try {
      await api.retryRoleCommand('purchaser');
      if (api.currentUser && (api.currentUser() || {}).id !== actorId) return;
      this.setData({ selectedRequest: null, requestId: '', selectedFreight: null, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1,
        result: { title: '提交结果已确认', status: 'SUCCEEDED', detail: '' } });
      await this.loadWork();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.syncCommands(); this.setData({ recovering: false }); }
  },

  changeView(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    if (event.currentTarget.dataset.view !== this.data.activeView) this.backToList();
    this.setData({ activeView: event.currentTarget.dataset.view, error: '' });
  },

  openTaskRequest(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ activeView: 'orders' });
    return this.selectRequest(event);
  },
  openTaskFreight(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ activeView: 'freight' });
    this.selectFreight(event);
  },

  openProducts() {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    wx.navigateTo({ url: '/pages/products/index' });
  },

  openPrices() {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    wx.navigateTo({ url: '/pages/prices/index' });
  },

  backToList() {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ requestId: '', selectedRequest: null, selectedFreight: null, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1 });
  },

  onSearch(event) {
    this.setData({ search: event.detail.value });
    this.refreshList();
  },

  filterStatus(event) {
    this.setData({ statusFilter: event.currentTarget.dataset.filter });
    this.refreshList();
  },

  nextOrders() { this.refreshList((this.data.orderLimit || 10) + 10); },
  refreshList(limit = 10) {
    const search = this.data.search.trim().toLowerCase();
    const filtered = this.data.requests.filter(item =>
      (this.data.statusFilter === 'all' || item.status === this.data.statusFilter) &&
      [item.requestNo, item.storeName].some(value => String(value || '').toLowerCase().includes(search)));
    this.setData({ visibleRequests: filtered.slice(0, limit), orderLimit: limit, orderTotal: filtered.length, moreOrders: filtered.length > limit });
  },

  onInput(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  selectSupplier(event) {
    if (this.data.confirming || this.data.reallocating) return;
    const supplierIndex = Number(event.detail.value);
    this.setData({ supplierIndex, targetSupplierId: this.data.suppliers[supplierIndex].id });
  },

  async loadSuppliers() {
    try {
      const suppliers = await api.request('/suppliers');
      this.setData({ suppliers: suppliers.filter(item => item.status === 'ACTIVE') });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  async selectRequest(event) {
    if (this.data.confirming || this.data.reallocating) return;
    const requestId = event.currentTarget.dataset.id;
    this.setData({ requestId, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1, selectedRequest: null });
    await this.loadRequestDetail(requestId);
  },

  async selectRejection(event) {
    if (this.data.confirming || this.data.reallocating) return;
    this.setData({
      requestId: event.currentTarget.dataset.requestId,
      rejectedOrderId: event.currentTarget.dataset.supplierOrderId,
      targetSupplierId: '', supplierIndex: -1, selectedRequest: null
    });
    await this.loadRequestDetail(this.data.requestId);
  },

  async loadWork() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([this.loadRequests(false), this.loadRejections(false), this.loadReports(false), this.loadSuppliers(), this.loadFreight()]);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadRequests(toggleLoading = true) {
    const actorId = this.data.user.id;
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const [requests, stores] = await Promise.all([api.request('/purchase-requests'), api.request('/stores')]);
      if (this.data.user.id !== actorId) return;
      const names = new Map((Array.isArray(stores) ? stores : []).map(item => [item.id, item.name]));
      const rows = Array.isArray(requests) ? requests.map(item => ({ ...item, storeName: item.storeName || names.get(item.storeId) || '', submittedText: view.dateText(item.submittedAt) })) : [];
      this.setData({ requests: rows, procurementTasks: rows.filter(item => item.status === 'PENDING_PROCUREMENT') });
      this.refreshList();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadFreight() {
    const actorId = this.data.user.id;
    try {
      const freightConfirmations = await api.request('/freight-confirmations');
      if (this.data.user.id !== actorId) return;
      this.setData({ freightConfirmations, pendingFreight: freightConfirmations.filter(item => item.status === 'PENDING') });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  selectFreight(event) {
    if (this.data.freightReviewing) return;
    const selectedFreight = this.data.freightConfirmations.find(item => item.id === event.currentTarget.dataset.id);
    this.setData({ selectedFreight: selectedFreight || null, freightReason: '', error: '' });
  },

  async reviewFreight(event) {
    const confirmation = this.data.selectedFreight;
    const action = event.currentTarget.dataset.action;
    if (this.data.freightReviewing || !confirmation || confirmation.status !== 'PENDING' || !['confirm', 'reject'].includes(action)) return;
    const reason = this.data.freightReason.trim();
    if (action === 'reject' && !reason) {
      this.setData({ error: '请填写运费驳回原因' });
      return;
    }
    this.setData({ freightReviewing: true, error: '' });
    try {
      const reviewed = await this.submitCommand(`/freight-confirmations/${confirmation.id}/${action}`, {
        method: 'POST', data: { expectedVersion: confirmation.version, ...(reason ? { reason } : {}) },
        header: { 'idempotency-key': `mini-freight-review-${action}-${Date.now()}` }
      });
      this.setData({ selectedFreight: { ...confirmation, ...reviewed },
        result: { title: confirmation.supplierOrderNo, status: reviewed.status, detail: `运费 ¥${reviewed.amount} ${action === 'confirm' ? '已确认' : '已驳回'}` } });
      await this.loadFreight();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ freightReviewing: false });
    }
  },

  async loadRejections(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const rejectionTodos = await api.request('/purchase-requests/rejection-todos');
      this.setData({ rejectionTodos });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadRequestDetail(id = this.data.requestId) {
    if (typeof id !== 'string') id = this.data.requestId;
    if (!id) {
      this.setData({ error: '请先选择或输入采购申请 ID' });
      return;
    }

    this.setData({ detailing: true, error: '' });
    try {
      const selectedRequest = await api.request(`/purchase-requests/${id}`);
      if (this.data.requestId !== id) return;
      this.setData({ selectedRequest });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ detailing: false });
    }
  },

  async loadReports(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const range = `from=${this.data.reportRange.from}&to=${this.data.reportRange.to}`;
      const [orderAmount, productQuantity, profit] = await Promise.all([
        api.request(`/reports/order-amounts?${range}`),
        api.request(`/reports/product-quantities?${range}`),
        api.request(`/reports/profit?${range}`)
      ]);
      this.setData({ reports: { orderAmount, productQuantity, profit } });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async confirmRequest() {
    if (this.data.confirming || this.data.reallocating || !this.data.requestId) return;
    this.setData({ confirming: true, error: '', result: null });
    try {
      const detail = this.data.selectedRequest || await api.request(`/purchase-requests/${this.data.requestId}`);
      this.setData({ selectedRequest: detail });
      const confirmed = await this.submitCommand(`/purchase-requests/${this.data.requestId}/confirm`, {
        method: 'POST',
        data: { expectedVersion: detail.version },
        header: { 'idempotency-key': `mini-purchaser-confirm-${Date.now()}` }
      });
      this.setData({
        result: {
          title: confirmed.requestNo || this.data.requestId,
          status: confirmed.status || 'CONFIRMED',
          detail: `已推送 ${(confirmed.supplierOrderIds || []).length} 张供应商单`
        }
      });
      await this.loadWork();
      await this.loadRequestDetail(this.data.requestId);
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ confirming: false });
    }
  },

  async reallocateRequest() {
    if (this.data.reallocating || this.data.confirming || !this.data.rejectedOrderId || !this.data.targetSupplierId) return;
    this.setData({ reallocating: true, error: '', result: null });
    try {
      const detail = this.data.selectedRequest || await api.request(`/purchase-requests/${this.data.requestId}`);
      this.setData({ selectedRequest: detail });
      const rejected = await api.request(`/supplier-orders/${this.data.rejectedOrderId}`);
      if (rejected.requestId !== detail.id || rejected.status !== 'REJECTED' || !detail.supplierOrders.some(order => order.id === rejected.id && !order.rejectionHandled)) throw new Error('拒单已处理，请刷新后重新选择');
      const productIds = new Set(rejected.items.map(item => item.productId));
      const reallocated = await this.submitCommand(`/purchase-requests/${this.data.requestId}/reallocate`, {
        method: 'POST',
        data: {
          expectedVersion: detail.version,
          rejectedOrderId: this.data.rejectedOrderId,
          reason: this.data.reallocateReason,
          assignments: (detail.items || []).filter(item => productIds.has(item.productId)).map((item) => ({
            requestItemId: item.id,
            supplierId: this.data.targetSupplierId
          }))
        },
        header: { 'idempotency-key': `mini-purchaser-reallocate-${Date.now()}` }
      });
      this.setData({
        result: {
          title: reallocated.requestNo || this.data.requestId,
          status: 'REALLOCATED',
          detail: `已改派到 ${(this.data.suppliers.find(item => item.id === this.data.targetSupplierId) || {}).name || '所选供应商'}`
        }
      });
      await this.loadWork();
      this.setData({ rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1 });
      await this.loadRequestDetail(this.data.requestId);
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ reallocating: false });
    }
  },

  logout() {
    if (this.data.recovering || this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    api.logout();
    wx.redirectTo({ url: '/pages/login/index' });
  }
});
