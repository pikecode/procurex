const api = require('../../utils/api');
const view = require('../../utils/store-view');
const quantity = require('../../utils/quantity');
const settlementLabels = { STORED_VALUE: '储值支付', CREDIT: '挂账支付', SUPPLIER_TERM: '供应商账期', COMPANY_TERM: '公司账期' };

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
    canReallocate: false,
    recordType: 'orders',
    sourceOrderReturn: false,
    orderRevision: 0,
    taskType: 'requests',
    taskOrigin: false,
    procurementTasks: [],
    pendingFreight: [],
    pendingCommand: null,
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
    fundingGroups: [],
    fundingSupplierRows: [],
    editCatalog: null,
    editingRequest: false,
    editItems: [],
    editProducts: [],
    visibleEditProducts: [],
    editSearch: '',
    editPrimaryCategoryId: '',
    editCategoryId: '',
    editCategories: [],
    editSubcategories: [],
    editEstimatedAmount: '0.00',
    editCartOpen: false,
    addableProducts: [],
    editReason: '',
    editRevision: 0,
    savingRequest: false,
    rejectingRequest: false,
    rejectReason: '',
    showPriceDetails: false,
    expandedOrders: {},
    showOriginalRequest: false,
    reallocateReason: '供应商拒单后改派',
    reportRange: view.reportPreset('month'),
    reportDraft: view.reportPreset('month'),
    reportPreset: 'month',
    reportsLoading: false,
    reportsError: '',
    reportSummary: null,
    visibleReportOrders: [],
    reportSupplierGroups: [],
    reportFilterDraft: { storeId: '', supplierId: '' },
    reportFilters: { storeId: '', supplierId: '' },
    reportStoreOptions: [{ id: '', name: '全部门店' }],
    reportSupplierOptions: [{ id: '', name: '全部供应商' }],
    reportStoreIndex: 0,
    reportSupplierIndex: 0,
    moreReportDetails: false,
    reports: {
      orderAmount: null,
      productQuantity: null,
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
      this.sourceOrderId = '';
      this.setData({ recordType: 'orders', sourceOrderReturn: false });
      this.setData({ reportRange: view.reportPreset('month'), reportDraft: view.reportPreset('month'), reportPreset: 'month', reportSummary: null, reportsError: '',
        reportFilterDraft: { storeId: '', supplierId: '' }, reportFilters: { storeId: '', supplierId: '' }, reportStoreIndex: 0, reportSupplierIndex: 0,
        reportStoreOptions: [{ id: '', name: '全部门店' }], reportSupplierOptions: [{ id: '', name: '全部供应商' }] });
      this.setData({ visibleRequests: [], search: '', statusFilter: 'all', activeView: 'tasks', taskType: 'requests', taskOrigin: false });
      this.setData({ requests: [], rejectionTodos: [], selectedRequest: null, requestId: '', rejectedOrderId: '', targetSupplierId: '',
        suppliers: [], supplierIndex: -1, assignmentItems: [], assignmentGroups: [], editCatalog: null, editingRequest: false, editItems: [], addableProducts: [], editReason: '', savingRequest: false, rejectReason: '', rejectingRequest: false, showPriceDetails: false, detailError: '', result: null, freightConfirmations: [], selectedFreight: null, procurementTasks: [], pendingFreight: [],
        reports: { orderAmount: null, productQuantity: null } });
    }
    this.setData({ user, roleText: '采购', canReallocate: (user.roles || []).some(role => ['ADMIN', 'PURCHASER'].includes(role)) });
    this.syncCommands();
    this.loadWork();
    if (this.data.requestId && !this.data.detailing && !this.data.confirming && !this.data.reallocating && !this.data.recovering && !this.data.savingRequest && !this.data.editingRequest && !this.data.rejectingRequest) this.loadRequestDetail();
  },

  syncCommands() {
    if (!api.roleCommandState) return;
    if (api.currentUser && !api.currentUser()) { this.setData({ pendingCommand: null }); return; }
    const state = api.roleCommandState('purchaser');
    this.setData({ pendingCommand: state.pending ? { ...state.pending, dateText: view.dateText(state.pending.createdAt) } : null });
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
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    this.sourceOrderId = '';
    if (event.currentTarget.dataset.view !== this.data.activeView) this.backToList();
    this.setData({ activeView: event.currentTarget.dataset.view, error: '', sourceOrderReturn: false });
  },

  changeTaskType(event) {
    const taskType = event.currentTarget.dataset.type;
    if (['requests', 'rejections', 'freight'].includes(taskType)) this.setData({ taskType });
  },
  changeRecordType(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    this.sourceOrderId = ''; this.backToList(); this.setData({ recordType: event.currentTarget.dataset.type });
  },
  openOrderSource(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    this.sourceOrderId = event.detail.orderId;
    this.setData({ recordType: 'requests', sourceOrderReturn: true });
    this.selectRequest({ currentTarget: { dataset: { id: event.detail.id } } });
  },
  openOrderReallocation(event) {
    if (!this.data.canReallocate) return;
    this.setData({ activeView: 'rejections', taskOrigin: true });
    this.selectRejection({ currentTarget: { dataset: event.detail } });
  },
  openGeneratedOrder(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    const id = event.currentTarget.dataset.id;
    this.backToList();
    this.setData({ activeView: 'orders', recordType: 'orders', taskOrigin: false });
    const open = () => this.selectComponent('#formal-orders').open({ currentTarget: { dataset: { id } } });
    if (wx.nextTick) wx.nextTick(open); else open();
  },

  openTaskRejection(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    this.setData({ activeView: 'rejections', taskOrigin: true, result: null });
    return this.selectRejection(event);
  },

  openTaskRequest(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    this.setData({ activeView: 'orders', taskOrigin: true, result: null });
    return this.selectRequest(event);
  },
  openTaskFreight(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    this.setData({ activeView: 'freight', taskOrigin: true, result: null });
    this.selectFreight(event);
  },

  backToList() {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest || this.data.freightReviewing) return;
    const orderId = this.sourceOrderId;
    this.sourceOrderId = '';
    this.setData({ sourceOrderReturn: false });
    this.setData({ ...(this.data.taskOrigin ? { activeView: 'tasks' } : {}), taskOrigin: false, result: null, requestId: '', selectedRequest: null, assignmentItems: [], assignmentGroups: [], editCatalog: null, editingRequest: false, editItems: [], addableProducts: [], editReason: '', rejectReason: '', rejectingRequest: false, showPriceDetails: false, detailError: '', selectedFreight: null, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1 });
    if (orderId) {
      this.setData({ activeView: 'orders', recordType: 'orders' });
      const open = () => { const center = this.selectComponent('#formal-orders'); if (center?.data.active) center.open({ currentTarget: { dataset: { id: orderId } } }); };
      if (wx.nextTick) wx.nextTick(open); else open();
    }
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

  clearOrderFilter() {
    this.setData({ search: '', statusFilter: 'all' });
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

  editInput(event) {
    if (this.data.savingRequest) return;
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
    if (event.currentTarget.dataset.field === 'editReason') this.markRequestEditChanged();
  },

  selectSupplier(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest) return;
    const supplierIndex = Number(event.detail.value);
    this.setData({ supplierIndex, targetSupplierId: this.data.suppliers[supplierIndex].id });
  },

  async loadSuppliers() {
    const actorId = this.data.user.id;
    try {
      const suppliers = await api.request('/suppliers');
      if (actorId !== this.data.user.id) return;
      this.setData({ suppliers: suppliers.filter(item => item.status === 'ACTIVE'), reportSupplierOptions: [{ id: '', name: '全部供应商' }, ...suppliers.map(row => ({ id: row.id, name: row.name }))] });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  async selectRequest(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest) return;
    const requestId = event.currentTarget.dataset.id;
    this.setData({ requestId, rejectedOrderId: '', targetSupplierId: '', supplierIndex: -1, selectedRequest: null, editCatalog: null, editingRequest: false, editItems: [], addableProducts: [], editReason: '', rejectReason: '', rejectingRequest: false, showPriceDetails: false });
    await this.loadRequestDetail(requestId);
  },

  async selectRejection(event) {
    if (this.data.confirming || this.data.reallocating || this.data.savingRequest) return;
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
      this.setData({ loading: false, orderRevision: this.data.orderRevision + 1 });
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
      this.setData({ requests: rows, procurementTasks: rows.filter(item => ['PENDING_PROCUREMENT', 'PENDING_FUNDS', 'PENDING_FINANCE'].includes(item.status)), reportStoreOptions: [{ id: '', name: '全部门店' }, ...(Array.isArray(stores) ? stores : []).map(row => ({ id: row.id, name: row.name }))] });
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
        result: { title: confirmation.supplierOrderNo, status: reviewed.status, detail: `运费 ¥${view.moneyText(reviewed.amount)} ${action === 'confirm' ? '已确认' : '已驳回'}` } });
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
    this.setData({ detailing: true, detailError: '', error: '', fundingView: null, fundingGroups: [] });
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
      this.setData({ selectedRequest, assignmentItems: [], assignmentGroups: [], editCatalog: null,
        ...(!sameRequest ? { expandedOrders: this.data.rejectedOrderId ? { [this.data.rejectedOrderId]: true } : {}, showOriginalRequest: false } : {}) });
      if (['PENDING_PROCUREMENT', 'PENDING_FUNDS', 'PENDING_FINANCE'].includes(selectedRequest.status) && !(selectedRequest.supplierOrders || []).length) {
        const catalog = await api.request(`/purchase-requests/${id}/edit-catalog`);
        if (this.data.requestId !== id || sequence !== this.detailRequestSequence) return;
        const assignmentItems = (selectedRequest.items || []).map(item => {
          const options = ((catalog.items || []).find(row => row.product.id === item.productId) || {}).suppliers || [];
          return { ...item, options, supplierIndex: options.findIndex(option => option.supplierId === item.supplierId) };
        });
        this.setData({ editCatalog: catalog, assignmentItems, assignmentGroups: groupAssignments(assignmentItems) });
      }
      this.loadProductImages(selectedRequest, sequence);
      if (!selectedRequest.supplierOrders.length && ['PENDING_PROCUREMENT', 'PENDING_FUNDS', 'PENDING_FINANCE'].includes(selectedRequest.status)) await this.refreshConfirmationFunding();
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

  chooseReportPreset(event) {
    const preset = event.currentTarget.dataset.preset;
    if (preset === 'custom') { this.setData({ reportPreset: 'custom' }); return; }
    if (!['today', 'week', 'month', 'lastMonth'].includes(preset)) return;
    const range = view.reportPreset(preset);
    this.setData({ reportPreset: preset, reportDraft: range });
  },

  changeReportDate(event) {
    const field = event.currentTarget.dataset.field;
    if (!['from', 'to'].includes(field)) return;
    this.setData({ reportPreset: 'custom', reportDraft: { ...this.data.reportDraft, [field]: event.detail.value } });
  },

  applyReportRange() {
    const error = view.reportRangeError(this.data.reportDraft);
    if (error) { this.setData({ reportsError: error }); return; }
    this.setData({ reportRange: { ...this.data.reportDraft }, reportFilters: { ...this.data.reportFilterDraft } });
    return this.loadReports();
  },

  chooseReportFilter(event) {
    const field = event.currentTarget.dataset.field;
    if (!['storeId', 'supplierId'].includes(field)) return;
    const index = Number(event.detail.value);
    const options = field === 'storeId' ? this.data.reportStoreOptions : this.data.reportSupplierOptions;
    if (!options[index]) return;
    this.setData({ reportFilterDraft: { ...this.data.reportFilterDraft, [field]: options[index].id },
      [field === 'storeId' ? 'reportStoreIndex' : 'reportSupplierIndex']: index });
  },

  refreshReportDetails(limit = 5) {
    const orders = this.data.reports.orderAmount?.orders || [];
    const groups = new Map();
    for (const order of orders) {
      const key = order.supplierId || order.supplierOrderId;
      if (!groups.has(key)) groups.set(key, { supplierId: key, supplierName: order.supplierName || '供应商', orders: [] });
      groups.get(key).orders.push(order);
    }
    const visibleGroups = [...groups.values()].slice(0, limit);
    this.setData({ visibleReportOrders: visibleGroups.flatMap(group => group.orders), reportSupplierGroups: visibleGroups, reportSupplierLimit: limit, moreReportDetails: groups.size > limit });
  },

  nextReportDetails() { this.refreshReportDetails((this.data.reportSupplierLimit || 5) + 5); },

  toggleReportOrder(event) {
    const id = event.currentTarget.dataset.id;
    const orders = this.data.reports.orderAmount?.orders;
    const order = orders?.find(row => row.supplierOrderId === id);
    if (!order) return;
    order.open = !order.open;
    this.setData({ reports: { ...this.data.reports, orderAmount: { ...this.data.reports.orderAmount, orders } } });
    this.refreshReportDetails(this.data.reportSupplierLimit);
    if (order.open) this.loadReportImages(id);
  },

  updateReportImage(fileId, state) {
    const report = this.data.reports.orderAmount;
    if (!report) return;
    const orders = report.orders.map(order => ({ ...order, items: (order.items || []).map(item => item.imageFile?.id === fileId ? { ...item, ...state } : item) }));
    this.setData({ reports: { ...this.data.reports, orderAmount: { ...report, orders } } });
    this.refreshReportDetails(this.data.reportSupplierLimit);
  },

  async loadReportImages(orderId) {
    const order = this.data.reports.orderAmount?.orders.find(row => row.supplierOrderId === orderId);
    if (!order) return;
    const sequence = this.reportSequence, actorId = this.data.user.id;
    const files = [...new Map(order.items.filter(item => item.imageFile?.id && !item.imageUrl && !item.imageLoading && !item.imageFailed).map(item => [item.imageFile.id, item.imageFile])).values()];
    for (const file of files) this.updateReportImage(file.id, { imageLoading: true });
    for (const file of files) {
      let imageUrl = '', imageFailed = false;
      try { imageUrl = await api.imagePath(file); } catch { imageFailed = true; }
      if (sequence !== this.reportSequence || actorId !== this.data.user.id) return;
      this.updateReportImage(file.id, { imageUrl, imageFailed, imageLoading: false });
    }
  },

  retryReportImage(event) {
    const orders = this.data.reports.orderAmount?.orders || [];
    const order = orders.find(row => row.items.some(item => item.id === event.detail?.productId));
    const item = order?.items.find(row => row.id === event.detail?.productId);
    if (!item?.imageFile?.id || item.imageLoading) return;
    this.updateReportImage(item.imageFile.id, { imageFailed: false });
    return this.loadReportImages(order.supplierOrderId);
  },

  async loadReports() {
    const sequence = this.reportSequence = (this.reportSequence || 0) + 1;
    const actor = this.data.user.id;
    const selectedRange = { ...this.data.reportRange };
    const invalid = view.reportRangeError(selectedRange);
    if (invalid) { this.setData({ reportsError: invalid }); return; }
    this.setData({ reportsLoading: true, reportsError: '', reportSummary: null, visibleReportOrders: [], reportSupplierGroups: [], moreReportDetails: false, reports: { orderAmount: null, productQuantity: null } });
    try {
      const filters = this.data.reportFilters;
      const range = `from=${selectedRange.from}&to=${selectedRange.to}${filters.storeId ? '&storeId=' + encodeURIComponent(filters.storeId) : ''}${filters.supplierId ? '&supplierId=' + encodeURIComponent(filters.supplierId) : ''}`;
      const [orderAmount, productQuantity] = await Promise.all([
        api.request(`/reports/order-amounts?${range}&includeItems=true`),
        api.request(`/reports/product-quantities?${range}`)
      ]);
      if (sequence !== this.reportSequence || actor !== this.data.user.id) return;
      if ((orderAmount.orders || []).some(row => !Array.isArray(row.items))) throw new Error('统计商品接口尚未更新，请更新 API 后重新查询');
      const orders = (orderAmount.orders || []).map(row => ({ ...row, open: false, completedText: view.dateText(row.completedAt),
        items: row.items.map(item => ({ ...item, quantityText: view.decimalText(item.receivedQuantity) })) }));
      const products = (productQuantity.products || []).map(row => ({ ...row, quantityText: view.decimalText(row.quantity) }));
      this.setData({ reports: { orderAmount: { ...orderAmount, orders }, productQuantity: { ...productQuantity, products } }, reportSummary: view.reportSummary(orderAmount, productQuantity) });
      this.refreshReportDetails();
    } catch (error) {
      if (sequence === this.reportSequence && actor === this.data.user.id) this.setData({ reportsError: error.message });
    } finally {
      if (sequence === this.reportSequence && actor === this.data.user.id) this.setData({ reportsLoading: false });
    }
  },

  async confirmRequest() {
    if (this.data.confirming || this.data.reallocating || this.data.detailing || this.data.detailError || this.data.pendingCommand || !this.data.requestId) return;
    this.setData({ confirming: true, error: '', result: null });
    try {
      const detail = this.data.selectedRequest || await api.request(`/purchase-requests/${this.data.requestId}`);
      this.setData({ selectedRequest: detail });
      const review = await api.request(`/purchase-requests/${this.data.requestId}/confirmation-preview`);
      this.setData({ fundingView: review.funding });
      if (!review.funding?.canConfirm) throw new Error('资金不足，补足储值或挂账额度后才能生成订单');
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

  async refreshConfirmationFunding() {
    const id = this.data.requestId;
    const revision = this.data.editRevision;
    this.setData({ fundingLoading: true });
    try {
      const review = this.data.editingRequest
        ? await api.request(`/purchase-requests/${id}/items-preview`, { method: 'POST', data: this.requestEditBody(true) })
        : await api.request(`/purchase-requests/${id}/confirmation-preview`);
      if (id === this.data.requestId && revision === this.data.editRevision) {
        const fundingGroups = review.settlementGroups || [];
        const supplierNames = new Map((this.data.editCatalog?.items || []).flatMap(item => item.suppliers.map(supplier => [supplier.supplierId, supplier.supplierName])));
        const fundingSupplierRows = fundingGroups.map(group => ({ ...group, supplierName: group.supplierName || supplierNames.get(group.supplierId) || '供应商', settlementLabel: settlementLabels[group.mode] || '结算方式待核验' }));
        this.setData({ fundingView: review.funding, fundingGroups, fundingSupplierRows, error: '',
          assignmentGroups: this.data.assignmentGroups.map(group => ({ ...group,
            settlementLabel: settlementLabels[fundingGroups.find(row => row.supplierId === group.supplierId)?.mode] || '结算方式待核验' })) });
        if (this.data.editingRequest) {
          this.refreshEditCatalog();
        }
      }
    } catch (error) { if (id === this.data.requestId && revision === this.data.editRevision) this.setData({ fundingView: null, error: error.message }); }
    finally { this.setData({ fundingLoading: false }); }
  },

  async saveRequestDraft() {
    if (this.data.savingRequest || this.data.pendingCommand) return;
    this.setData({ savingRequest: true, error: '' });
    try {
      const body = this.requestEditBody();
      await this.submitCommand(`/purchase-requests/${this.data.requestId}/items`, { method: 'PATCH', data: body,
        header: { 'idempotency-key': `procurement-save-${Date.now()}` } });
      this.setData({ editingRequest: false });
      await this.loadRequestDetail(); await this.loadWork();
      wx.showToast({ title: '调整已保存', icon: 'success' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ savingRequest: false }); }
  },

  refreshAddableProducts(editItems = this.data.editItems) {
    const selected = new Set(editItems.map(item => item.productId));
    const addableProducts = (this.data.editCatalog?.items || [])
      .filter(item => !selected.has(item.product.id) && item.suppliers.length)
      .map(item => ({ id: item.product.id, name: item.product.name, specification: item.product.specification || '' }));
    this.setData({ addableProducts });
  },

  refreshEditCatalog(editItems = this.data.editItems) {
    const search = this.data.editSearch.trim().toLowerCase();
    const editProducts = (this.data.editCatalog?.items || []).filter(row => row.product.isActive !== false).map(row => {
      const line = editItems.find(item => item.productId === row.product.id);
      const original = (this.data.selectedRequest?.items || []).find(item => item.productId === row.product.id);
      const visual = this.data.editProducts.find(item => item.id === row.product.id) || {};
      const supplierIndex = line ? line.supplierIndex : 0;
      const supplier = supplierIndex >= 0 ? row.suppliers[supplierIndex] || {} : {};
      const purchase = line?.unitId && line.unitId === row.product.purchaseUnitConversion?.purchaseUnitId;
      const maxRequestedQuantity = original ? String(original.unitSnapshot?.originalInputQuantity || original.unitSnapshot?.inputQuantity || original.quantity) : '';
      const mode = (this.data.fundingGroups || []).find(group => group.supplierId === supplier.supplierId)?.mode;
      return { ...row.product, settlementMode: mode || '', settlementLabel: settlementLabels[mode] || '结算方式待核验', imageUrl: visual.imageUrl || '', imageLoading: !!visual.imageLoading, imageFailed: !!visual.imageFailed,
        suppliers: row.suppliers, supplierIndex, supplierId: supplier.supplierId || '', supplierName: supplierIndex < 0 ? '请选择有效供应商' : supplier.supplierName || '暂无有效供应商',
        cartQuantity: line?.quantity || '0', usesPurchaseUnit: !!purchase, displayUnitName: purchase ? row.product.purchaseUnitName : row.product.unitName,
        displaySalesPrice: purchase ? supplier.purchaseSalesPrice : supplier.salesPrice,
        displaySupplyPrice: purchase ? supplier.purchaseSupplyPrice : supplier.supplyPrice,
        maxRequestedQuantity, atOriginalMaximum: !!maxRequestedQuantity && Number(line?.quantity || 0) >= Number(maxRequestedQuantity),
        canOrder: !!supplier.priceVersionId && !!supplier.supplyPriceVersionId };
    });
    const categories = [{ id: '', name: '全部商品' }];
    for (const product of editProducts) {
      const id = product.categoryParentId || product.categoryId;
      if (id && !categories.some(item => item.id === id)) categories.push({ id, name: product.categoryParentName || product.categoryName || '未分类' });
    }
    const primaryCategoryId = categories.some(item => item.id === this.data.editPrimaryCategoryId) ? this.data.editPrimaryCategoryId : '';
    const children = [];
    for (const product of editProducts) if (primaryCategoryId && product.categoryParentId === primaryCategoryId && !children.some(item => item.id === product.categoryId)) children.push({ id: product.categoryId, name: product.categoryName || '未分类' });
    const editCategoryId = children.some(item => item.id === this.data.editCategoryId) ? this.data.editCategoryId : '';
    const visibleEditProducts = editProducts.filter(product => (!primaryCategoryId || (product.categoryParentId || product.categoryId) === primaryCategoryId)
      && (!editCategoryId || product.categoryId === editCategoryId) && (!search || `${product.name} ${product.sku || ''}`.toLowerCase().includes(search)));
    const estimate = editProducts.reduce((total, product) => total + Number(product.cartQuantity || 0) * Number(product.displaySalesPrice || 0), 0);
    this.setData({ editProducts, visibleEditProducts, editCategories: categories, editSubcategories: children.length ? [{ id: '', name: '全部' }, ...children] : [],
      editPrimaryCategoryId: primaryCategoryId, editCategoryId, editEstimatedAmount: estimate.toFixed(2) });
  },

  onEditSearch(event) { this.setData({ editSearch: event.detail.value, editPrimaryCategoryId: '', editCategoryId: '' }); this.refreshEditCatalog(); },
  chooseEditPrimaryCategory(event) { this.setData({ editPrimaryCategoryId: event.currentTarget.dataset.id, editCategoryId: '', editSearch: '' }); this.refreshEditCatalog(); },
  chooseEditCategory(event) { this.setData({ editCategoryId: event.currentTarget.dataset.id, editSearch: '' }); this.refreshEditCatalog(); },
  toggleEditCart() { if (!this.data.savingRequest) this.setData({ editCartOpen: !this.data.editCartOpen }); },
  keepEditCartOpen() {},
  removeEditCartItem(event) {
    this.updateEditProduct(this.data.editProducts.find(item => item.id === event.currentTarget.dataset.id), '0');
  },
  updateEditProduct(product, value) {
    if (this.data.savingRequest || !product) return;
    try {
      let amount;
      try {
        amount = quantity.validate(String(value).trim(), { allowZero: true,
          max: product.maxRequestedQuantity || undefined,
          min: Number(value) === 0 ? undefined : product.usesPurchaseUnit ? '1' : product.minOrderQty,
          multiple: Number(value) === 0 || product.usesPurchaseUnit ? undefined : product.orderMultiple });
      } catch (error) {
        if (product.maxRequestedQuantity && error.message === '数量不能超过待处理数量') {
          throw new Error(`${product.name} 数量不能超过门店原下单数量 ${product.maxRequestedQuantity} ${product.displayUnitName}`);
        }
        throw error;
      }
      const existing = this.data.editItems.find(item => item.productId === product.id);
      const original = (this.data.selectedRequest?.items || []).find(item => item.productId === product.id);
      let editItems = this.data.editItems.filter(item => item.productId !== product.id);
      if (Number(amount) > 0) {
        const supplier = product.suppliers[product.supplierIndex] || product.suppliers[0];
        if (!supplier?.priceVersionId || !supplier?.supplyPriceVersionId) throw new Error(`${product.name} 当前供应商没有有效价格`);
        const restored = original ? this.requestEditLine(original) : null;
        editItems.push(existing ? { ...existing, quantity: amount } : restored ? {
          ...restored, quantity: amount, supplierId: supplier.supplierId, supplierIndex: product.supplierIndex >= 0 ? product.supplierIndex : 0,
          expectedProductVersion: product.version, unavailable: false
        } : {
          productId: product.id, productName: product.name, specification: product.specification || '', quantity: amount,
          unitId: product.baseUnitId, unitName: product.unitName, supplierId: supplier.supplierId, supplierIndex: product.supplierIndex,
          suppliers: product.suppliers, expectedProductVersion: product.version, currentSalesUnitPrice: null, currentSupplyUnitPrice: null,
          currentSalesLineAmount: null, currentSupplyLineAmount: null, unavailable: false
        });
      }
      this.setData({ editItems, error: '' });
      this.markRequestEditChanged();
      this.refreshEditCatalog(editItems);
    } catch (error) { this.setData({ error: error.message }); }
  },

  stepEditProduct(event) {
    const product = this.data.editProducts.find(item => item.id === event.currentTarget.dataset.id);
    if (!product) return;
    try { this.updateEditProduct(product, quantity.step(product.cartQuantity || '0', product.usesPurchaseUnit ? '1' : product.orderMultiple, product.usesPurchaseUnit ? '1' : product.minOrderQty, Number(event.currentTarget.dataset.direction))); }
    catch (error) { this.setData({ error: error.message }); }
  },

  setEditProductQuantity(event) {
    this.updateEditProduct(this.data.editProducts.find(item => item.id === event.currentTarget.dataset.id), event.detail.value);
  },

  async loadEditCatalogImages() {
    const requestId = this.data.requestId;
    const files = this.data.editProducts.filter(item => item.imageFile?.id || item.imageFileId);
    for (const product of files) {
      const file = product.imageFile || { id: product.imageFileId };
      this.updateEditProductImage(product.id, { imageLoading: true, imageFailed: false });
      try {
        const imageUrl = await api.imagePath(file);
        if (requestId !== this.data.requestId || !this.data.editingRequest) return;
        this.updateEditProductImage(product.id, { imageUrl, imageLoading: false, imageFailed: false });
      } catch {
        if (requestId !== this.data.requestId || !this.data.editingRequest) return;
        this.updateEditProductImage(product.id, { imageLoading: false, imageFailed: true });
      }
    }
  },

  updateEditProductImage(productId, state) {
    this.setData({ editProducts: this.data.editProducts.map(item => item.id === productId ? { ...item, ...state } : item),
      visibleEditProducts: this.data.visibleEditProducts.map(item => item.id === productId ? { ...item, ...state } : item) });
  },

  async retryEditProductImage(event) {
    const product = this.data.editProducts.find(item => item.id === event.currentTarget.dataset.id);
    const file = product?.imageFile || (product?.imageFileId ? { id: product.imageFileId } : null);
    if (!file) return;
    this.updateEditProductImage(product.id, { imageLoading: true, imageFailed: false });
    try { this.updateEditProductImage(product.id, { imageUrl: await api.imagePath(file), imageLoading: false, imageFailed: false }); }
    catch { this.updateEditProductImage(product.id, { imageLoading: false, imageFailed: true }); }
  },

  requestEditLine(item) {
    const catalogItem = (this.data.editCatalog?.items || []).find(row => row.product.id === item.productId);
    const snapshot = item.unitSnapshot || {};
    const supplierIndex = catalogItem ? catalogItem.suppliers.findIndex(row => row.supplierId === item.supplierId) : -1;
    return {
      productId: item.productId,
      productName: item.productName || catalogItem?.product.name || '商品已失效',
      specification: catalogItem?.product.specification || '',
      quantity: snapshot.inputQuantity || item.quantity,
      originalRequestedQuantity: snapshot.originalInputQuantity || snapshot.inputQuantity || item.quantity,
      unitId: snapshot.inputUnitId || catalogItem?.product.baseUnitId || '',
      unitName: snapshot.inputUnitName || item.unitName || catalogItem?.product.unitName || '',
      supplierId: supplierIndex >= 0 ? item.supplierId : '',
      supplierIndex,
      suppliers: catalogItem?.suppliers || [],
      expectedProductVersion: catalogItem?.product.version,
      currentSalesUnitPrice: item.salesUnitPrice,
      currentSupplyUnitPrice: item.supplyUnitPrice,
      currentSalesLineAmount: item.salesLineAmount,
      currentSupplyLineAmount: item.supplyLineAmount,
      unavailable: !catalogItem
    };
  },

  startRequestEdit() {
    const detail = this.data.selectedRequest;
    if (!this.data.canReallocate || !detail || !this.data.editCatalog || this.data.savingRequest || this.data.rejectingRequest) return;
    const editItems = detail.items.map(item => this.requestEditLine(item));
    this.setData({ editingRequest: true, editCartOpen: false, rejectReason: '', editItems, editProducts: [], visibleEditProducts: [], editSearch: '', editPrimaryCategoryId: '', editCategoryId: '', editReason: '', editRevision: this.data.editRevision + 1, error: '' });
    this.refreshAddableProducts(editItems);
    this.refreshEditCatalog(editItems);
    this.loadEditCatalogImages();
  },

  cancelRequestEdit() {
    if (this.data.savingRequest) return;
    this.setData({ editingRequest: false, editRevision: this.data.editRevision + 1, fundingView: null, editCartOpen: false, editItems: [], editProducts: [], visibleEditProducts: [], addableProducts: [], editReason: '', error: '' });
    this.refreshConfirmationFunding();
  },

  markRequestEditChanged() {
    this.setData({ editRevision: this.data.editRevision + 1, fundingView: null });
  },

  changeEditQuantity(event) {
    if (this.data.savingRequest) return;
    const productId = event.currentTarget.dataset.id;
    const product = this.data.editProducts.find(item => item.id === productId);
    if (product) this.updateEditProduct(product, event.detail.value);
  },

  changeEditSupplier(event) {
    if (this.data.savingRequest) return;
    const productId = event.currentTarget.dataset.id;
    const index = Number(event.detail.value);
    this.setData({ editItems: this.data.editItems.map(item => item.productId === productId && item.suppliers[index]
      ? { ...item, supplierIndex: index, supplierId: item.suppliers[index].supplierId } : item) });
    this.markRequestEditChanged();
    this.refreshEditCatalog();
  },

  removeEditItem(event) {
    if (this.data.savingRequest) return;
    if (this.data.editItems.length <= 1) {
      this.setData({ error: '下货单至少保留一种商品；如需全部取消，请使用采购拒单' });
      return;
    }
    const editItems = this.data.editItems.filter(item => item.productId !== event.currentTarget.dataset.id);
    this.setData({ editItems, error: '' });
    this.refreshAddableProducts(editItems);
    this.markRequestEditChanged();
  },

  addEditProduct(event) {
    if (this.data.savingRequest) return;
    const choice = this.data.addableProducts[Number(event.detail.value)];
    const catalogItem = choice && (this.data.editCatalog?.items || []).find(item => item.product.id === choice.id);
    if (!catalogItem || !catalogItem.suppliers.length) return;
    const product = catalogItem.product;
    const editItems = [...this.data.editItems, {
      productId: product.id, productName: product.name, specification: product.specification || '', quantity: product.minOrderQty,
      unitId: product.baseUnitId, unitName: product.unitName, supplierId: catalogItem.suppliers[0].supplierId,
      supplierIndex: 0, suppliers: catalogItem.suppliers, expectedProductVersion: product.version,
      currentSalesUnitPrice: null, currentSupplyUnitPrice: null, currentSalesLineAmount: null, currentSupplyLineAmount: null, unavailable: false
    }];
    this.setData({ editItems, error: '' });
    this.refreshAddableProducts(editItems);
    this.markRequestEditChanged();
  },

  requestEditBody(previewOnly = false) {
    const reason = this.data.editReason.trim() || (previewOnly ? '资金调整预览' : '');
    if (!reason) throw new Error('请填写修改原因');
    if (!this.data.editItems.length) throw new Error('下货单至少保留一种商品');
    return {
      expectedVersion: this.data.selectedRequest.version,
      reason,
      items: this.data.editItems.map(item => {
        if (item.unavailable) throw new Error(`${item.productName} 已失效，请移除后再保存`);
        if (!item.supplierId) throw new Error(`请为 ${item.productName} 选择有效供应商`);
        let checkedQuantity;
        try { checkedQuantity = quantity.validate(item.quantity, { max: item.originalRequestedQuantity || undefined }); }
        catch (error) {
          if (item.originalRequestedQuantity && error.message === '数量不能超过待处理数量') throw new Error(`${item.productName} 数量不能超过门店原下单数量 ${item.originalRequestedQuantity} ${item.unitName}`);
          throw error;
        }
        return { productId: item.productId, supplierId: item.supplierId, quantity: checkedQuantity, unitId: item.unitId,
          expectedProductVersion: item.expectedProductVersion };
      })
    };
  },

  async confirmRequestEdit() {
    if (this.data.savingRequest) return;
    let body;
    if (!this.data.editReason.trim()) {
      const decision = await new Promise((resolve, reject) => wx.showModal({ title: '填写调整原因', editable: true, placeholderText: '例如：门店确认调整数量', confirmText: '确认生成', success: resolve, fail: reject }));
      const reason = String(decision.content || '').trim();
      if (!decision.confirm || !reason) { if (decision.confirm) this.setData({ error: '请填写调整原因' }); return; }
      this.setData({ editReason: reason });
    }
    try { body = this.requestEditBody(); } catch (error) { this.setData({ error: error.message }); return; }
    const revision = this.data.editRevision;
    const requestId = this.data.requestId;
    this.setData({ savingRequest: true, error: '' });
    try {
      const preview = await api.request(`/purchase-requests/${requestId}/items-preview`, { method: 'POST', data: body });
      if (requestId !== this.data.requestId || revision !== this.data.editRevision) return;
      this.setData({ fundingView: preview.funding });
      if (!preview.funding?.canConfirm) throw new Error('资金不足，暂不能生成订单；可先保存调整，再联系财务补足');
      const prices = new Map((preview.items || []).map(item => [item.productId, item]));
      body.items = body.items.map(item => {
        const priced = prices.get(item.productId);
        if (!priced?.priceVersionId || !priced?.supplyPriceVersionId) throw new Error('商品价格已变化，请重新预览');
        return { ...item, expectedPriceVersionId: priced.priceVersionId, expectedSupplyPriceVersionId: priced.supplyPriceVersionId };
      });
      const confirmed = await this.submitCommand(`/purchase-requests/${requestId}/confirm-adjusted`, { method: 'POST', data: body,
        header: { 'idempotency-key': `mini-purchaser-confirm-adjusted-${Date.now()}` } });
      this.setData({ editingRequest: false, editItems: [], addableProducts: [], editReason: '',
        result: { title: '调整并确认成功', status: confirmed.status || 'CONFIRMED', detail: `已生成 ${(confirmed.supplierOrderIds || []).length} 张供应商订单` } });
      await this.loadWork();
      await this.loadRequestDetail(this.data.requestId);
      if (wx.pageScrollTo && (this.data.selectedRequest?.supplierOrders || []).length) {
        const scroll = () => wx.pageScrollTo({ selector: '#supplier-order-summary', duration: 200 });
        if (wx.nextTick) wx.nextTick(scroll); else scroll();
      }
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ savingRequest: false }); }
  },

  startRequestReject() {
    if (this.data.savingRequest || this.data.rejectingRequest) return;
    this.setData({ rejectingRequest: true, editingRequest: false, rejectReason: '', error: '' });
  },

  cancelRequestReject() {
    if (this.data.confirming) return;
    this.setData({ rejectingRequest: false, rejectReason: '', error: '' });
  },

  async rejectRequest() {
    const detail = this.data.selectedRequest;
    const reason = this.data.rejectReason.trim();
    if (!detail || this.data.confirming || this.data.savingRequest) return;
    if (!reason) { this.setData({ error: '请填写采购拒单原因' }); return; }
    const decision = await new Promise((resolve, reject) => wx.showModal({ title: '确认采购拒单',
      content: `拒单后下货单将取消，并释放未扣的资金占用。\n原因：${reason}`, confirmText: '确认拒单', confirmColor: '#b42318', success: resolve, fail: reject }));
    if (!decision.confirm) return;
    this.setData({ confirming: true, error: '' });
    try {
      const result = await this.submitCommand(`/purchase-requests/${detail.id}/reject`, { method: 'POST', data: { expectedVersion: detail.version, reason },
        header: { 'idempotency-key': `mini-purchaser-reject-${Date.now()}` } });
      this.setData({ rejectingRequest: false, rejectReason: '', result: { title: '采购已拒单', status: result.status || 'CANCELED', detail: reason } });
      await this.loadRequests();
      await this.loadRequestDetail(detail.id);
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ confirming: false }); }
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
        content: `${item.productName || '商品'} → ${target.supplierName}\n销售金额 ¥${view.moneyText(item.salesLineAmount)} → ¥${view.moneyText(line.salesLineAmount)}\n供应商金额 ¥${view.moneyText(item.supplyLineAmount)} → ¥${view.moneyText(line.supplyLineAmount)}`,
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
