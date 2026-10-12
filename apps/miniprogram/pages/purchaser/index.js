const api = require('../../utils/api');
const view = require('../../utils/store-view');

function groupAssignments(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.supplierId)) {
      const supplier = item.options.find(option => option.supplierId === item.supplierId);
      groups.set(item.supplierId, { supplierId: item.supplierId, supplierName: item.supplierName || supplier?.supplierName || '供应商不可用', items: [], salesCents: 0, supplyCents: 0 });
    }
    const group = groups.get(item.supplierId);
    group.items.push(item);
    group.salesCents += Math.round(Number(item.salesLineAmount || 0) * 100);
    group.supplyCents += Math.round(Number(item.supplyLineAmount || 0) * 100);
  }
  return Array.from(groups.values(), group => ({ supplierId: group.supplierId, supplierName: group.supplierName, items: group.items,
    itemCount: group.items.length, salesAmount: (group.salesCents / 100).toFixed(2), supplyAmount: (group.supplyCents / 100).toFixed(2) }));
}

Page({
  data: {
    activeView: 'tasks',
    taskType: 'requests',
    taskOrigin: false,
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
    rejectionContext: {},
    targetSupplierId: '',
    suppliers: [],
    supplierIndex: -1,
    assignmentItems: [],
    assignmentGroups: [],
    showPriceDetails: false,
    expandedOrders: {},
    showOriginalRequest: false,
    reallocateReason: '供应商拒单后改派',
    reportRange: view.monthRange(),
    reports: {
      orderAmount: null,
      productQuantity: null,
      profit: null
    },
    loading: false,
    detailing: false,
    detailError: '',
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
      this.setData({ visibleRequests: [], search: '', statusFilter: 'all', activeView: 'tasks', taskType: 'requests', taskOrigin: false });
      this.setData({ requests: [], rejectionTodos: [], selectedRequest: null, requestId: '', rejectedOrderId: '', targetSupplierId: '',
        suppliers: [], supplierIndex: -1, assignmentItems: [], assignmentGroups: [], showPriceDetails: false, detailError: '', result: null, freightConfirmations: [], selectedFreight: null, procurementTasks: [], pendingFreight: [],
        reports: { orderAmount: null, productQuantity: null, profit: null } });
    }
    this.setData({ user, roleText: '采购', reportRange: view.monthRange() });
    this.syncCommands();
    this.loadWork();
    if (this.data.requestId && !this.data.detailing && !this.data.confirming && !this.data.reallocating && !this.data.recovering) this.loadRequestDetail();
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

  changeTaskType(event) {
    const taskType = event.currentTarget.dataset.type;
    if (['requests', 'rejections', 'freight'].includes(taskType)) this.setData({ taskType });
  },

  openTaskRejection(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ activeView: 'rejections', taskOrigin: true, result: null });
    return this.selectRejection(event);
  },

  openTaskRequest(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ activeView: 'orders', taskOrigin: true, result: null });
    return this.selectRequest(event);
  },
  openTaskFreight(event) {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ activeView: 'freight', taskOrigin: true, result: null });
    this.selectFreight(event);
  },

  backToList() {
    if (this.data.confirming || this.data.reallocating || this.data.freightReviewing) return;
    this.setData({ ...(this.data.taskOrigin ? { activeView: 'tasks' } : {}), taskOrigin: false, result: null, requestId: '', selectedRequest: null, assignmentItems: [], assignmentGroups: [], showPriceDetails: false, detailError: '', selectedFreight: null, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1 });
  },

  togglePriceDetails(event) {
    this.setData({ showPriceDetails: !!event.detail.value });
  },

  toggleSupplierOrder(event) {
    const id = event.currentTarget.dataset.id;
    if (!this.data.selectedRequest?.supplierOrders?.some(order => order.id === id)) return;
    this.setData({ expandedOrders: { ...this.data.expandedOrders, [id]: !this.data.expandedOrders[id] } });
  },

  toggleOriginalRequest() {
    if (!this.data.selectedRequest?.supplierOrders?.length) return;
    this.setData({ showOriginalRequest: !this.data.showOriginalRequest });
  },

  onSearch(event) {
    this.setData({ search: event.detail.value });
    this.refreshList();
  },

  filterStatus(event) {
    this.setData({ statusFilter: event.currentTarget.dataset.filter });
    this.refreshList();
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 });
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
    this.setData({ requestId, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1, selectedRequest: null, showPriceDetails: false });
    await this.loadRequestDetail(requestId);
  },

  async selectRejection(event) {
    if (this.data.confirming || this.data.reallocating) return;
    this.setData({
      requestId: event.currentTarget.dataset.requestId,
      rejectedOrderId: event.currentTarget.dataset.supplierOrderId,
      rejectionContext: this.data.rejectionTodos.find(row => row.supplierOrderId === event.currentTarget.dataset.supplierOrderId) || {},
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

    const sequence = this.detailRequestSequence = (this.detailRequestSequence || 0) + 1;
    this.setData({ detailing: true, detailError: '', error: '' });
    try {
      const selectedRequest = await api.request(`/purchase-requests/${id}`);
      selectedRequest.storeName = selectedRequest.storeName || (this.data.requests || []).find(row => row.id === id)?.storeName || '';
      selectedRequest.supplierOrders = await Promise.all((selectedRequest.supplierOrders || []).map(async order => {
        try {
          const detail = await api.request(`/supplier-orders/${order.id}`);
          return { ...order, items: detail.items || [] };
        } catch (error) {
          return { ...order, items: [], itemsError: error.message || '商品清单加载失败' };
        }
      }));
      if (this.data.requestId !== id || sequence !== this.detailRequestSequence) return;
      const sameRequest = this.data.selectedRequest?.id === selectedRequest.id;
      this.setData({ selectedRequest, assignmentItems: [], assignmentGroups: [],
        ...(!sameRequest ? { expandedOrders: this.data.rejectedOrderId ? { [this.data.rejectedOrderId]: true } : {}, showOriginalRequest: false } : {}) });
      if (['PENDING_PROCUREMENT', 'PENDING_FUNDS'].includes(selectedRequest.status) && !(selectedRequest.supplierOrders || []).length) {
        const catalog = await api.request(`/purchase-requests/${id}/edit-catalog`);
        if (this.data.requestId !== id || sequence !== this.detailRequestSequence) return;
        const assignmentItems = (selectedRequest.items || []).map(item => {
          const options = ((catalog.items || []).find(row => row.product.id === item.productId) || {}).suppliers || [];
          return { ...item, options, supplierIndex: options.findIndex(option => option.supplierId === item.supplierId) };
        });
        this.setData({ assignmentItems, assignmentGroups: groupAssignments(assignmentItems) });
      }
      this.loadProductImages(selectedRequest, sequence);
    } catch (error) {
      if (this.data.requestId === id && sequence === this.detailRequestSequence) this.setData({ detailError: error.message, error: error.message });
    } finally {
      if (sequence === this.detailRequestSequence) this.setData({ detailing: false });
    }
  },

  async loadProductImages(request, sequence) {
    const items = [...(request.items || []), ...(request.supplierOrders || []).flatMap(order => order.items || [])];
    const files = [...new Map(items.map(item => item.imageFile || (item.imageFileId ? { id: item.imageFileId } : null)).filter(file => file?.id).map(file => [file.id, file])).values()];
    for (const file of files) this.updateProductImage(file.id, { imageLoading: true, imageFailed: false });
    for (const file of files) {
      let imageUrl = '', imageFailed = false;
      try { imageUrl = await api.imagePath(file); } catch { imageFailed = true; }
      if (this.data.requestId !== request.id || this.detailRequestSequence !== sequence) return;
      this.updateProductImage(file.id, { imageUrl, imageFailed, imageLoading: false });
    }
  },

  updateProductImage(fileId, imageState) {
    const update = item => (item.imageFile?.id || item.imageFileId) === fileId ? { ...item, ...imageState } : item;
    const current = this.data.selectedRequest;
    if (!current) return;
    this.setData({ selectedRequest: { ...current, items: (current.items || []).map(update),
      supplierOrders: (current.supplierOrders || []).map(order => ({ ...order, items: (order.items || []).map(update) })) },
      assignmentItems: this.data.assignmentItems.map(update),
      assignmentGroups: this.data.assignmentGroups.map(group => ({ ...group, items: group.items.map(update) })) });
  },

  async retryProductImage(event) {
    const productId = event.detail?.productId;
    const items = [...(this.data.selectedRequest?.items || []), ...(this.data.selectedRequest?.supplierOrders || []).flatMap(order => order.items || [])];
    const item = items.find(row => row.id === productId);
    const file = item?.imageFile || (item?.imageFileId ? { id: item.imageFileId } : null);
    if (!file?.id || !this.data.requestId) return;
    this.updateProductImage(file.id, { imageLoading: true, imageFailed: false });
    let imageUrl = '', imageFailed = false;
    try { imageUrl = await api.imagePath(file); } catch { imageFailed = true; }
    this.updateProductImage(file.id, { imageUrl, imageFailed, imageLoading: false });
  },

  previewProductImage(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.previewImage({ current: url, urls: [url] });
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
    if (this.data.confirming || this.data.reallocating || this.data.detailing || this.data.detailError || this.data.pendingCommand || !this.data.requestId) return;
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
          title: '采购确认成功',
          status: confirmed.status || 'CONFIRMED',
          detail: `已生成 ${(confirmed.supplierOrderIds || []).length} 张供应商订单`
        }
      });
      await this.loadWork();
      await this.loadRequestDetail(this.data.requestId);
      if (wx.pageScrollTo && (this.data.selectedRequest?.supplierOrders || []).length) {
        const scroll = () => wx.pageScrollTo({ selector: '#supplier-order-summary', duration: 200 });
        if (wx.nextTick) wx.nextTick(scroll); else scroll();
      }
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ confirming: false });
    }
  },

  async changeItemSupplier(event) {
    if (this.data.reallocating || this.data.confirming || this.data.detailing || this.data.detailError || this.data.pendingCommand) return;
    const detail = this.data.selectedRequest;
    const item = this.data.assignmentItems.find(row => row.id === event.currentTarget.dataset.id);
    const target = item && item.options[Number(event.detail.value)];
    if (!detail || !target || target.supplierId === item.supplierId) return;
    this.setData({ reallocating: true, error: '' });
    try {
      const body = { expectedVersion: detail.version, itemIds: [item.id], supplierId: target.supplierId };
      const preview = await api.request(`/purchase-requests/${detail.id}/reassign-preview`, { method: 'POST', data: body });
      const line = preview.items && preview.items[0];
      if (preview.requestId !== detail.id || preview.supplierId !== target.supplierId || preview.items.length !== 1 || !line || line.requestItemId !== item.id || !line.eligible || !line.priceVersionId || !line.supplyPriceVersionId) throw new Error('该供应商当前不可供货，请刷新后重新选择');
      const decision = await new Promise((resolve, reject) => wx.showModal({ title: '核对供应商调整',
        content: `${item.productName || '商品'} → ${target.supplierName}\n销售金额 ¥${item.salesLineAmount} → ¥${line.salesLineAmount}\n供应商金额 ¥${item.supplyLineAmount} → ¥${line.supplyLineAmount}`,
        confirmText: '保存调整', success: resolve, fail: reject }));
      if (!decision.confirm) return;
      if (this.data.requestId !== detail.id) throw new Error('下货单已切换，请刷新');
      await this.submitCommand(`/purchase-requests/${detail.id}/assign`, { method: 'POST', data: { ...body,
        expectedPrices: [{ requestItemId: item.id, priceVersionId: line.priceVersionId, supplyPriceVersionId: line.supplyPriceVersionId }] },
        header: { 'idempotency-key': `mini-purchaser-assign-${Date.now()}` } });
      await this.loadRequestDetail(detail.id);
      await this.loadRequests();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ reallocating: false }); }
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
