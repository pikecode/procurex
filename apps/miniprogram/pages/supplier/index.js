const api = require('../../utils/api');
const quantity = require('../../utils/quantity');
const view = require('../../utils/store-view');
const delivery = require('../../utils/delivery');

function shipmentQuantityError(value, max, unitName) {
  if (String(value).trim() === '') return '';
  try {
    quantity.validate(value, { allowZero: true, max });
    return '';
  } catch (error) {
    return error.message.includes('超过')
      ? `本次最多可发 ${max}${unitName ? ` ${unitName}` : ''}`
      : error.message;
  }
}

function createdTime(order) {
  const value = Date.parse(order.createdAt || '');
  return Number.isFinite(value) ? value : null;
}

function supplierOrderPriority(order) {
  return { DISPUTED: 0, pending: 1, REPLENISHING: 2, PARTIAL_SHIPPED: 3, SHIPPED: 4,
    WAITING_STORE_CONFIRM: 5, COMPLETED: 6, REJECTED: 7, CANCELED: 7 }[delivery.supplierOrderState(order)] ?? 7;
}

const orderTabs = [
  { value: 'all', label: '全部' }, { value: 'pending', label: '待发货' },
  { value: 'PARTIAL_SHIPPED', label: '发货中' }, { value: 'SHIPPED', label: '待收货' },
  { value: 'WAITING_STORE_CONFIRM', label: '待门店确认' },
  { value: 'DISPUTED', label: '异常处理' }, { value: 'REPLENISHING', label: '待补发' },
  { value: 'COMPLETED', label: '已完成' }, { value: 'closed', label: '已关闭' }
];

function sortSupplierOrders(orders) {
  return orders.map((order, index) => ({ order, index, priority: supplierOrderPriority(order), createdAt: createdTime(order) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.createdAt !== null && b.createdAt !== null && a.createdAt !== b.createdAt) {
        const inProgress = a.priority <= 5;
        return inProgress ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
      }
      return a.createdAt !== null && b.createdAt !== null
        ? String(a.order.id || '').localeCompare(String(b.order.id || '')) || a.index - b.index : a.index - b.index;
    }).map(item => item.order);
}

function oldestFirst(items) {
  return items.map((item, index) => ({ item, index, createdAt: createdTime(item) }))
    .sort((a, b) => a.createdAt !== null && b.createdAt !== null && a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.index - b.index)
    .map(entry => entry.item);
}

Page({
  data: {
    activeView: 'tasks',
    shippingTasks: [],
    differenceTasks: [],
    pendingCommand: null,
    recovering: false,
    search: '',
    statusFilter: 'all',
    statusExpanded: false,
    statusScrollTarget: 'supplier-status-all',
    orderTabs: orderTabs.map(tab => ({ ...tab, count: 0 })),
    orderEmptyText: '当前供应商暂无订单',
    orderMode: 'detail',
    visibleOrders: [],
    user: {},
    roleText: '未登录',
    orders: [],
    discrepancies: [],
    statements: [],
    selectedStatement: null,
    statementId: '',
    statementKind: 'total',
    statementParentId: '',
    statementStores: [],
    statementStoresLoading: false,
    statementStoresError: '',
    expandedStatementOrderId: '',
    statementReturnKind: 'total',
    statementReturnParentId: '',
    statementLoading: false,
    statementPayments: [],
    statementPaymentsLoading: false,
    statementPaymentError: '',
    statementReturnId: '',
    selectedAdjustment: null,
    adjustmentId: '',
    adjustmentLoading: false,
    payments: [],
    reportRange: view.monthRange(),
    reports: {
      orderAmount: null,
      productQuantity: null
    },
    supplierOrderId: '',
    selectedOrder: null,
    shipmentItems: [],
    shipmentNeedsExplanation: false,
    revisionShipment: null,
    revisionItems: [],
    revisionNote: '',
    revisionEvidence: [],
    finishNeedsMaterials: false,
    exceptionReplyReceiptId: '',
    exceptionReplyDecision: '',
    exceptionReplyNote: '',
    exceptionReplyEvidence: [],
    exceptionReplyUploading: false,
    revisionNeedsEvidence: false,
    revisionUploading: false,
    revising: false,
    orderLoading: false,
    trackingNo: '',
    carrierId: '',
    carrierIndex: 0,
    carrierChoices: [{ id: '', name: '请选择物流公司' }],
    logisticsCompanies: [],
    deliveryIndex: 0,
    deliveryChoices: [{ value: 'SELF', label: '自配送' }, { value: 'LOGISTICS', label: '物流' }],
    rejectionReason: '',
    freightChoices: [],
    freightIndex: 0,
    freightRequestAmount: '',
    freightRequestReason: '',
    freightRequesting: false,
    discrepancyId: '',
    selectedDiscrepancy: null,
    discrepancyLoading: false,
    discrepancyReason: '',
    paymentId: '',
    selectedPayment: null,
    paymentLoading: false,
    evidenceLoading: false,
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
    const user = api.openWorkspace('supplier');
    if (!user) return;
    if (this.data.user.id !== user.id) {
      this.statementRequestSequence = (this.statementRequestSequence || 0) + 1;
      this.setData({ statementPayments: [], statementPaymentError: '', statementPaymentsLoading: false, statementReturnId: '', selectedAdjustment: null, adjustmentId: '', adjustmentLoading: false });
      this.setData({ visibleOrders: [], search: '', statusFilter: 'all', statusExpanded: false, statusScrollTarget: 'supplier-status-all', orderMode: 'detail', activeView: 'tasks', shippingTasks: [], differenceTasks: [] });
      this.setData({ selectedStatement: null, statementId: '', statementLoading: false });
      this.setData({ statementKind: 'total', statementParentId: '', statementStores: [], statementStoresLoading: false,
        statementStoresError: '', expandedStatementOrderId: '', statementReturnKind: 'total', statementReturnParentId: '' });
      this.setData({ orders: [], discrepancies: [], statements: [], payments: [], selectedOrder: null, shipmentItems: [], supplierOrderId: '',
        discrepancyId: '', paymentId: '', selectedDiscrepancy: null, selectedPayment: null, freightChoices: [], freightIndex: 0,
        result: null, reports: { orderAmount: null, productQuantity: null } });
    }
    this.setData({ user, roleText: '供应商', reportRange: view.monthRange() });
    this.syncCommands();
    this.loadWork();
  },

  syncCommands() {
    if (!api.roleCommandState) return;
    if (api.currentUser && !api.currentUser()) { this.setData({ pendingCommand: null }); return; }
    const state = api.roleCommandState('supplier');
    this.setData({ pendingCommand: state.pending ? { ...state.pending, dateText: view.dateText(state.pending.createdAt) } : null });
  },
  async submitCommand(path, options) {
    const actorId = api.currentUser ? (api.currentUser() || {}).id : undefined;
    try {
      const result = await api.roleCommand('supplier', path, options);
      if (api.currentUser && (api.currentUser() || {}).id !== actorId) throw new Error('账号已切换，请刷新');
      return result;
    }
    finally { this.syncCommands(); }
  },
  async recoverCommand() {
    if (this.data.recovering || this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting) return;
    this.setData({ recovering: true, error: '' });
    const actorId = api.currentUser ? (api.currentUser() || {}).id : undefined;
    try {
      await api.retryRoleCommand('supplier');
      if (api.currentUser && (api.currentUser() || {}).id !== actorId) return;
      this.setData({ selectedOrder: null, supplierOrderId: '', shipmentItems: [], selectedPayment: null, paymentId: '', selectedDiscrepancy: null, discrepancyId: '',
        result: { title: '提交结果已确认', status: 'SUCCEEDED', detail: '' } });
      await this.loadWork();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.syncCommands(); this.setData({ recovering: false }); }
  },

  changeView(event) {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting || this.data.evidenceLoading || this.data.revising || this.data.revisionUploading || this.data.exceptionReplyUploading || this.data.deliveryBusy) return;
    if (event.currentTarget.dataset.view === 'differences' && !this.data.discrepancies.length && !this.data.loading) {
      wx.showToast({ title: '暂无收货异常记录', icon: 'none' });
      return;
    }
    const changed = event.currentTarget.dataset.view !== this.data.activeView;
    if (changed) {
      this.setData({ statementReturnId: '', statementParentId: '', statementKind: 'total' });
      this.backToList();
    }
    this.setData({ activeView: event.currentTarget.dataset.view, error: '' });
    if (changed && this.data.activeView === 'orders') return this.loadOrders();
  },

  openTaskOrder(event) {
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || this.data.resolving) return;
    this.setData({ activeView: 'orders', result: null });
    return this.selectOrder(event);
  },
  openTaskDifference(event) {
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || this.data.resolving) return;
    this.setData({ activeView: 'differences', result: null });
    return this.loadDiscrepancy(event.currentTarget.dataset.id);
  },

  openProfile() {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting) return;
    wx.navigateTo({ url: '/pages/profile/index?kind=supplier' });
  },
  openProducts() {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting) return;
    wx.navigateTo({ url: '/pages/supplier-products/index' });
  },

  backToList() {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting || this.data.evidenceLoading || this.data.revising || this.data.revisionUploading || this.data.exceptionReplyUploading || this.data.deliveryBusy) return;
    const returnId = this.data.statementReturnId;
    const returnKind = this.data.statementReturnKind;
    const returnParentId = this.data.statementReturnParentId;
    const parentId = this.data.statementKind === 'store' ? this.data.statementParentId : '';
    this.statementRequestSequence = (this.statementRequestSequence || 0) + 1;
    this.setData({ selectedOrder: null, supplierOrderId: '', selectedDiscrepancy: null, discrepancyId: '', selectedPayment: null, paymentId: '', shipmentItems: [], orderMode: 'detail' });
    this.setData({ selectedStatement: null, statementId: '', statementLoading: false });
    this.setData({ statementKind: 'total', statementParentId: '', statementStores: [], statementStoresLoading: false,
      statementStoresError: '', expandedStatementOrderId: '' });
    this.setData({ statementReturnId: '', statementPayments: [], statementPaymentsLoading: false, statementPaymentError: '', selectedAdjustment: null, adjustmentId: '', adjustmentLoading: false });
    if (returnId) {
      this.setData({ activeView: 'reports' });
      return this.selectStatement({ currentTarget: { dataset: { id: returnId, statementKind: returnKind, parentId: returnParentId } } });
    }
    if (parentId) return this.selectStatement({ currentTarget: { dataset: { id: parentId } } });
  },

  async selectStatement(event) {
    const id = event.currentTarget.dataset.id;
    const statementKind = event.currentTarget.dataset.statementKind === 'store' ? 'store' : 'total';
    const statementParentId = statementKind === 'store' ? event.currentTarget.dataset.parentId : '';
    const sequence = this.statementRequestSequence = (this.statementRequestSequence || 0) + 1;
    this.setData({ statementId: id, selectedStatement: null, statementLoading: true, error: '', statementReturnId: '', statementPayments: [], statementPaymentError: '', statementPaymentsLoading: false });
    this.setData({ statementKind, statementParentId, statementStores: [], statementStoresError: '', statementStoresLoading: false, expandedStatementOrderId: '' });
    try {
      const endpoint = statementKind === 'store' ? '/supplier-store-statements' : '/supplier-statements';
      const statement = await api.request(`${endpoint}/${encodeURIComponent(id)}`);
      if (this.data.statementId !== id || this.statementRequestSequence !== sequence) return;
      if (statementKind === 'store' && statement.parentStatementId !== statementParentId) throw new Error('分店账单不属于当前账单');
      this.setData({ selectedStatement: { ...statement, periodText: view.statementPeriod(statement), lines: (statement.lines || []).map(line => ({ ...line,
        products: (line.products || []).map(product => ({ ...product, orderedText: view.decimalText(product.orderedQuantity),
          effectiveText: view.decimalText(product.effectiveQuantity), receivedText: view.decimalText(product.receivedQuantity), priceText: view.decimalText(product.supplyUnitPrice) })) })) }, statementLoading: false });
      await Promise.all([this.loadStatementPayments(statement, sequence), statement.type === 'SUPPLIER_TOTAL' ? this.loadStatementStores(statement, sequence) : undefined]);
    } catch (error) {
      if (this.data.statementId === id && this.statementRequestSequence === sequence) this.setData({ error: error.message });
    } finally {
      if (this.data.statementId === id && this.statementRequestSequence === sequence) this.setData({ statementLoading: false });
    }
  },

  retryStatement() {
    return this.selectStatement({ currentTarget: { dataset: { id: this.data.statementId, statementKind: this.data.statementKind, parentId: this.data.statementParentId } } });
  },

  async loadStatementStores(statement = this.data.selectedStatement, sequence = this.statementRequestSequence) {
    if (!statement || statement.type !== 'SUPPLIER_TOTAL') return;
    this.setData({ statementStoresLoading: true, statementStoresError: '' });
    try {
      const stores = await api.request(`/supplier-store-statements?supplierId=${encodeURIComponent(statement.supplierId)}&cycle=${encodeURIComponent(statement.cycle)}`);
      if (this.data.statementId !== statement.id || this.statementRequestSequence !== sequence) return;
      this.setData({ statementStores: (Array.isArray(stores) ? stores : []).filter(item => item.parentStatementId === statement.id) });
    } catch (error) {
      if (this.data.statementId === statement.id && this.statementRequestSequence === sequence) this.setData({ statementStoresError: error.message });
    } finally {
      if (this.data.statementId === statement.id && this.statementRequestSequence === sequence) this.setData({ statementStoresLoading: false });
    }
  },
  retryStatementStores() { if (!this.data.statementStoresLoading) return this.loadStatementStores(); },
  selectStoreStatement(event) {
    const statement = this.data.selectedStatement;
    const child = this.data.statementStores.find(item => item.id === event.currentTarget.dataset.id && item.parentStatementId === (statement || {}).id);
    if (child) return this.selectStatement({ currentTarget: { dataset: { id: child.id, statementKind: 'store', parentId: statement.id } } });
  },
  toggleStatementProducts(event) {
    const id = event.currentTarget.dataset.id;
    if ((this.data.selectedStatement?.lines || []).some(item => item.supplierOrderId === id)) this.setData({ expandedStatementOrderId: this.data.expandedStatementOrderId === id ? '' : id });
  },

  async loadStatementPayments(statement = this.data.selectedStatement, sequence = this.statementRequestSequence) {
    if (!statement) return;
    this.setData({ statementPaymentsLoading: true, statementPaymentError: '' });
    try {
      const supplier = statement.supplierId ? `&supplierId=${encodeURIComponent(statement.supplierId)}` : '';
      const payments = await api.request(`/payment-records?direction=COMPANY_TO_SUPPLIER${supplier}`);
      if (this.data.statementId !== statement.id || this.statementRequestSequence !== sequence) return;
      const sources = new Set([...(statement.lines || []), ...(statement.adjustmentItems || [])].map(item => item.settlementItemId));
      this.setData({ statementPayments: (Array.isArray(payments) ? payments : []).map(payment => ({ ...payment,
        statementAllocations: (payment.allocations || []).filter(item => sources.has(item.settlementItemId))
      })).filter(payment => payment.statementAllocations.length) });
    } catch (error) {
      if (this.data.statementId === statement.id && this.statementRequestSequence === sequence) this.setData({ statementPaymentError: error.message });
    } finally {
      if (this.data.statementId === statement.id && this.statementRequestSequence === sequence) this.setData({ statementPaymentsLoading: false });
    }
  },

  async retryStatementPayments() {
    if (this.data.statementPaymentsLoading) return;
    await this.loadStatementPayments();
  },

  async openStatementSource(event) {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting || this.data.evidenceLoading) return;
    const { id, kind } = event.currentTarget.dataset;
    const statement = this.data.selectedStatement;
    if (!statement || !id) return;
    const allowed = kind === 'order' ? (statement.lines || []).some(item => item.supplierOrderId === id)
      : kind === 'payment' ? this.data.statementPayments.some(item => item.id === id)
      : kind === 'adjustment' && (statement.adjustmentItems || []).some(item => item.adjustmentId === id);
    if (!allowed) return;
    this.statementRequestSequence = (this.statementRequestSequence || 0) + 1;
    this.setData({ statementReturnKind: this.data.statementKind, statementReturnParentId: this.data.statementParentId,
      statementReturnId: statement.id, statementId: '', selectedStatement: null, statementLoading: false,
      statementStores: [], statementStoresLoading: false, statementStoresError: '', expandedStatementOrderId: '',
      statementPayments: [], statementPaymentsLoading: false, selectedOrder: null, supplierOrderId: '', selectedPayment: null, paymentId: '', selectedAdjustment: null, adjustmentId: '',
      activeView: kind === 'order' ? 'orders' : kind === 'payment' ? 'payments' : 'reports' });
    if (kind === 'order') await this.loadOrder(id);
    else if (kind === 'payment') await this.loadPayment(id);
    else await this.loadAdjustment(id);
  },

  async loadAdjustment(id) {
    this.setData({ adjustmentId: id, selectedAdjustment: null, adjustmentLoading: true, error: '' });
    try {
      const adjustment = await api.request(`/adjustments/${encodeURIComponent(id)}`);
      if (this.data.adjustmentId !== id) return;
      this.setData({ selectedAdjustment: { ...adjustment, createdText: view.dateText(adjustment.createdAt),
        periodText: view.statementPeriod(adjustment), originalPeriodText: view.statementPeriod({ periodStart: adjustment.originalPeriodStart, periodEndExclusive: adjustment.originalPeriodEndExclusive }) } });
    } catch (error) {
      if (this.data.adjustmentId === id) this.setData({ error: error.message });
    } finally {
      if (this.data.adjustmentId === id) this.setData({ adjustmentLoading: false });
    }
  },

  onSearch(event) {
    this.setData({ search: event.detail.value });
    this.refreshList();
  },

  filterStatus(event) {
    const filter = event.currentTarget.dataset.filter;
    this.setData({ statusFilter: filter, statusExpanded: false, statusScrollTarget: `supplier-status-${filter}` });
    this.refreshList();
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  toggleStatusExpanded() {
    this.setData({ statusExpanded: !this.data.statusExpanded, statusScrollTarget: `supplier-status-${this.data.statusFilter}` });
  },

  // Empty groups point somewhere useful instead of dead-ending the page.
  gotoView(event) {
    const { view, filter } = event.currentTarget.dataset;
    if (filter) this.setData({ statusFilter: filter, statusExpanded: false, statusScrollTarget: `supplier-status-${filter}` });
    this.changeView({ currentTarget: { dataset: { view } } });
    if (filter) this.refreshList();
  },

  nextOrders() { this.refreshList((this.data.orderLimit || 10) + 10); },
  refreshList(limit = 10) {
    const search = this.data.search.trim().toLowerCase();
    const searched = sortSupplierOrders(this.data.orders).filter(item =>
      [item.supplierOrderNo, item.requestNo, item.storeName, item.productSummary].some(value => String(value || '').toLowerCase().includes(search)));
    const matches = (item, filter) => filter === 'all' || (filter === 'closed' ? ['REJECTED', 'CANCELED'].includes(delivery.supplierOrderState(item)) : delivery.supplierOrderState(item) === filter);
    const filtered = searched.filter(item => matches(item, this.data.statusFilter));
    const tab = orderTabs.find(item => item.value === this.data.statusFilter);
    this.setData({ visibleOrders: filtered.slice(0, limit), orderLimit: limit, orderTotal: filtered.length, moreOrders: filtered.length > limit,
      orderTabs: orderTabs.map(tab => ({ ...tab, count: searched.filter(item => matches(item, tab.value)).length })),
      orderEmptyText: search ? '当前搜索条件下没有匹配的订单' : `当前供应商暂无${tab?.value === 'all' ? '' : tab?.label || '该状态'}订单` });
  },

  changeOrderMode(event) {
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || this.data.revising || this.data.revisionUploading || this.data.exceptionReplyUploading || this.data.deliveryBusy) return;
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'ship' && !this.data.selectedOrder?.canShip) return;
    if (mode === 'reject' && !this.data.selectedOrder?.canReject) return;
    if (['detail', 'ship', 'reject'].includes(mode)) this.setData({ orderMode: mode, error: '', result: null,
      ...(mode === 'detail' && this.data.orderMode === 'revise' ? { revisionShipment: null, revisionItems: [], revisionNote: '', revisionEvidence: [], revisionNeedsEvidence: false } : {}) });
  },

  beginShipmentRevision(event) {
    if (this.data.shipping || this.data.revising || this.data.revisionUploading) return;
    const shipment = (this.data.selectedOrder?.shipments || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!shipment?.canRevise) return;
    const orderItems = new Map(this.data.selectedOrder.items.map(item => [item.id, item]));
    const revisionItems = shipment.items.map(item => ({ ...item, productName: orderItems.get(item.orderItemId)?.productName || '商品', orderedQuantity: orderItems.get(item.orderItemId)?.quantity || '0', explanationBaseline: this.data.selectedOrder.deliveryState ? item.quantity : orderItems.get(item.orderItemId)?.quantity || '0', revisedQuantity: item.quantity }));
    this.setData({ orderMode: 'revise', revisionShipment: shipment, revisionItems, revisionNote: '', revisionEvidence: [], revisionNeedsEvidence: revisionItems.some(item => Number(item.revisedQuantity) < Number(item.explanationBaseline)), error: '' });
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onRevisionQuantity(event) {
    if (this.data.revising || this.data.revisionUploading) return;
    const revisionItems = this.data.revisionItems.map(item => item.id === event.currentTarget.dataset.id ? { ...item, revisedQuantity: event.detail.value } : item);
    this.setData({ revisionItems, revisionNeedsEvidence: revisionItems.some(item => Number(item.revisedQuantity || 0) < Number(item.explanationBaseline ?? item.orderedQuantity)) });
  },

  async chooseRevisionEvidence() {
    if (this.data.shipping || this.data.revising || this.data.deliveryBusy || this.data.revisionUploading || this.data.revisionEvidence.length >= 6) return;
    const orderId = this.data.supplierOrderId, actorId = api.currentUser()?.id;
    const active = () => this.data.supplierOrderId === orderId && api.currentUser()?.id === actorId;
    this.setData({ revisionUploading: true, error: '' });
    try {
      const files = await api.chooseEvidence(6 - this.data.revisionEvidence.length);
      if (!active()) return;
      const evidence = [...this.data.revisionEvidence];
      for (const file of files) {
        const uploaded = await api.uploadEvidence(file.path, 'SHIPMENT_ADJUSTMENT');
        if (!active()) return;
        evidence.push({ ...uploaded, path: file.path });
        this.setData({ revisionEvidence: evidence });
      }
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ revisionUploading: false }); }
  },

  removeRevisionEvidence(event) {
    if (this.data.shipping || this.data.revising || this.data.deliveryBusy || this.data.revisionUploading) return;
    this.setData({ revisionEvidence: this.data.revisionEvidence.filter((_, index) => index !== Number(event.currentTarget.dataset.index)) });
  },

  async reviseShipment() {
    if (this.data.revising || this.data.revisionUploading || !this.data.revisionShipment || !this.data.selectedOrder) return;
    this.setData({ revising: true, error: '', result: null });
    try {
      const shipment = this.data.revisionShipment;
      const items = this.data.revisionItems.map(item => ({ shipmentItemId: item.id, quantity: quantity.validate(item.revisedQuantity, { allowZero: true, max: item.orderedQuantity }) }));
      const needsEvidence = items.some(line => {
        const item = this.data.revisionItems.find(item => item.id === line.shipmentItemId);
        return Number(line.quantity) < Number(item.explanationBaseline ?? item.orderedQuantity);
      });
      if (needsEvidence) {
        if (!this.data.revisionNote.trim()) throw new Error('请填写异常发货备注');
        if (!this.data.revisionEvidence.length) throw new Error('请上传发货差异凭证');
      }
      if (items.every(line => Number(line.quantity) === Number(this.data.revisionItems.find(item => item.id === line.shipmentItemId).quantity))) throw new Error('发货数量未变更');
      const orderId = this.data.supplierOrderId;
      const result = await this.submitCommand(`/supplier-orders/${orderId}/shipments/${shipment.id}/revisions`, {
        method: 'POST', data: { expectedOrderVersion: this.data.selectedOrder.version, expectedRevision: shipment.revision, items,
          ...(this.data.revisionNote.trim() ? { note: this.data.revisionNote.trim() } : {}), ...(this.data.revisionEvidence.length ? { evidenceFileIds: this.data.revisionEvidence.map(file => file.id) } : {}) },
        header: { 'idempotency-key': `mini-supplier-shipment-revision-${Date.now()}` }
      });
      this.setData({ orderMode: 'detail', revisionShipment: null, revisionItems: [], revisionNote: '', revisionEvidence: [], result: { title: shipment.shipmentNo, status: 'UPDATED', detail: `发货数量已修订到第 ${result.revision} 版` } });
      await this.loadOrder(orderId);
      await this.loadOrders(false);
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ revising: false }); }
  },

  onInput(event) {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting) return;
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async chooseOrder(event) {
    const order = this.data.orders[Number(event.detail.value)];
    if (order) await this.loadOrder(order.id);
  },

  async chooseDiscrepancy(event) {
    const discrepancy = this.data.discrepancies[Number(event.detail.value)];
    if (discrepancy) await this.loadDiscrepancy(discrepancy.id);
  },

  async choosePayment(event) {
    const payment = this.data.payments[Number(event.detail.value)];
    if (payment) await this.loadPayment(payment.id);
  },

  async selectOrder(event) {
    await this.loadOrder(event.currentTarget.dataset.id);
  },
  async openResultOrder() {
    if (!this.data.result?.supplierOrderId) return;
    const id = this.data.result.supplierOrderId;
    this.setData({ activeView: 'orders' });
    await this.loadOrder(id);
  },
  callContact() {
    const phone = this.data.selectedOrder?.destination?.contactPhone;
    if (phone) wx.makePhoneCall({ phoneNumber: phone });
  },

  async loadOrder(id) {
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || this.data.exceptionReplyUploading) return;
    this.setData({ exceptionReplyReceiptId: '', exceptionReplyNote: '', exceptionReplyEvidence: [] });
    const actorId = this.data.user.id;
    this.setData({ supplierOrderId: id, selectedOrder: null, shipmentItems: [], orderLoading: true, freightIndex: 0, freightChoices: [], error: '', orderMode: 'detail', trackingNo: '', carrierId: '', carrierIndex: 0, rejectionReason: '', freightRequestAmount: '', freightRequestReason: '', result: null, revisionNote: '', revisionEvidence: [], shipmentNeedsExplanation: false });
    try {
      const selectedOrder = await api.request(`/supplier-orders/${id}`);
      if (this.data.supplierOrderId !== id || this.data.user.id !== actorId) return;
      const shipmentItems = delivery.shipmentLines(selectedOrder);
      this.setData({ completeDelivery: true, deliveryBusy: false, finishNeedsMaterials: false });
      this.setData({ deliveryIndex: selectedOrder.defaultDeliveryMode === 'LOGISTICS' ? 1 : 0, selectedOrder: { ...selectedOrder,
        listState: delivery.supplierOrderState(selectedOrder), displayStatus: delivery.supplierOrderLabel(selectedOrder),
        canRequestFreight: selectedOrder.requiresFreightSnapshot !== false,
        shipments: (selectedOrder.shipments || []).map(shipment => {
          const items = shipment.items.map(line => ({ ...line, productName: selectedOrder.items.find(item => item.id === line.orderItemId)?.productName || '商品' }));
          return { ...shipment, shippedDate: view.dateText(shipment.shippedAt), items,
            receiptExceptionReplies: (shipment.receiptExceptionReplies || []).map(reply => ({ ...reply, createdText: view.dateText(reply.createdAt) })),
            productPreview: items.length ? `${items[0].productName}${items.length > 1 ? ` 等 ${items.length} 种` : ''}` : '暂无商品' };
        }),
        canFinish: selectedOrder.shipments?.length > 0 && ['IN_PROGRESS', 'REPLENISHING'].includes(selectedOrder.deliveryState),
        canShip: (!selectedOrder.deliveryState || ['IN_PROGRESS', 'REPLENISHING'].includes(selectedOrder.deliveryState)) && !['COMPLETED', 'REJECTED', 'CANCELED'].includes(selectedOrder.status) && shipmentItems.some(item => Number(item.remainingQuantity) > 0),
        canReject: ['PUSHED', 'ACCEPTED'].includes(selectedOrder.status) && !selectedOrder.firstShippedAt && selectedOrder.fulfillmentStatus === 'PENDING'
      }, freightChoices: [{ id: '', amount: '0.00', label: '无运费' }].concat((selectedOrder.freightConfirmations || [])
        .filter(item => selectedOrder.requiresFreightSnapshot !== false && item.status === 'CONFIRMED' && !item.usedAt).map(item => ({ ...item, label: `¥${view.moneyText(item.amount)} · ${item.reason}` }))),
      shipmentItems });
      this.loadOrderImages(id);
    } catch (error) {
      if (this.data.supplierOrderId === id) this.setData({ error: error.message });
    } finally {
      if (this.data.supplierOrderId === id) this.setData({ orderLoading: false });
    }
  },

  async loadOrderImages(orderId) {
    const items = this.data.shipmentItems.filter(item => item.imageFile?.id || item.imageFileId);
    await Promise.all(items.map(async item => {
      let imageUrl = '', imageFailed = false;
      try { imageUrl = await api.imagePath(item.imageFile || { id: item.imageFileId }); } catch { imageFailed = true; }
      if (this.data.supplierOrderId !== orderId) return;
      this.updateOrderItemImage(item.id, { imageUrl, imageFailed, imageLoading: false });
    }));
  },

  updateOrderItemImage(itemId, imageState) {
    const update = item => item.id === itemId ? { ...item, ...imageState } : item;
    this.setData({ shipmentItems: this.data.shipmentItems.map(update),
      selectedOrder: this.data.selectedOrder ? { ...this.data.selectedOrder, items: (this.data.selectedOrder.items || []).map(update) } : null });
  },

  async retryProductImage(event) {
    const itemId = event.detail?.productId;
    const item = this.data.shipmentItems.find(row => row.id === itemId);
    if (!item || !(item.imageFile?.id || item.imageFileId)) return;
    const orderId = this.data.supplierOrderId;
    this.updateOrderItemImage(itemId, { imageLoading: true, imageFailed: false });
    let imageUrl = '', imageFailed = false;
    try { imageUrl = await api.imagePath(item.imageFile || { id: item.imageFileId }); } catch { imageFailed = true; }
    if (this.data.supplierOrderId === orderId) this.updateOrderItemImage(itemId, { imageUrl, imageFailed, imageLoading: false });
  },

  onShipQuantity(event) {
    if (this.data.shipping || this.data.rejecting) return;
    this.setData({ shipmentItems: this.data.shipmentItems.map(item => item.id === event.currentTarget.dataset.id
      ? { ...item, shipQuantity: event.detail.value, shipQuantityError: shipmentQuantityError(event.detail.value, item.remainingQuantity, item.unitName) } : item) });
    this.refreshShipmentExplanation();
  },

  refreshShipmentExplanation() {
    this.setData({ shipmentNeedsExplanation: delivery.needsExplanation(this.data.shipmentItems, this.data.completeDelivery) });
  },
  selectShipmentItem(event) {
    if (this.data.shipping) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ shipmentItems: this.data.shipmentItems.map(item => item.id === id ? { ...item, selectedForShipment: !item.selectedForShipment } : item), completeDelivery: false });
    this.refreshShipmentExplanation();
  },
  toggleCompleteDelivery(event) {
    if (this.data.shipping) return;
    this.setData({ completeDelivery: event.detail.value });
    this.refreshShipmentExplanation();
  },
  async deliveryAction(event) {
    if (this.data.deliveryBusy || this.data.revisionUploading || !this.data.selectedOrder) return;
    const action = event.currentTarget.dataset.action;
    if (!['finish-delivery', 'REPLENISH', 'DECLINE'].includes(action)) return;
    const order = this.data.selectedOrder;
    const needsReason = action === 'DECLINE' || (action === 'finish-delivery' && this.data.shipmentItems.some(item => Number(item.remainingQuantity) > 0));
    const finishingShort = action === 'finish-delivery' && needsReason;
    if (finishingShort) {
      this.setData({ finishNeedsMaterials: true, error: '' });
      if (!this.data.revisionNote.trim()) { this.setData({ error: '请填写异常发货备注' }); return; }
      if (!this.data.revisionEvidence.length) { this.setData({ error: '请上传发货差异凭证' }); return; }
    }
    const prompt = await new Promise(resolve => wx.showModal({ title: action === 'finish-delivery' ? '结束本单发货' : action === 'REPLENISH' ? '确认安排补发' : '拒绝补发',
      content: finishingShort ? this.data.revisionNote.trim() : needsReason ? '' : '确认后将通知门店。', editable: needsReason && !finishingShort, placeholderText: '填写原因（必填）', success: resolve, fail: () => resolve({ confirm: false }) }));
    if (!prompt.confirm) return;
    const reason = finishingShort ? this.data.revisionNote.trim() : (prompt.content || '').trim();
    if (needsReason && !reason) { this.setData({ error: '请填写原因' }); return; }
    this.setData({ deliveryBusy: true, error: '' });
    try {
      await this.submitCommand(`/supplier-orders/${order.id}/${action === 'finish-delivery' ? action : 'respond-objection'}`, { method: 'POST',
        data: { expectedVersion: order.version, ...(reason ? { reason } : {}), ...(finishingShort ? { evidenceFileIds: this.data.revisionEvidence.map(file => file.id) } : {}), ...(action !== 'finish-delivery' ? { response: action } : {}) },
        header: { 'idempotency-key': `mini-delivery-${Date.now()}` } });
      await this.loadOrders(false);
      await this.loadOrder(order.id);
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ deliveryBusy: false }); }
  },

  respondReceiptException(event) {
    if (this.data.deliveryBusy || this.data.exceptionReplyUploading || !this.data.selectedOrder) return;
    const { receiptId, decision } = event.currentTarget.dataset;
    const batch = this.data.selectedOrder.shipments.find(item => item.receiptId === receiptId);
    const changingPlan = batch?.receiptExceptionStatus === 'RESPONDED' && batch.receiptExceptionDecision === 'REPLENISH' && decision === 'ACCEPT_SHORTAGE';
    if ((!changingPlan && batch?.receiptExceptionStatus !== 'SUBMITTED') || !['HANDLED', 'DECLINED', 'REPLENISH', 'ACCEPT_SHORTAGE'].includes(decision)) return;
    this.setData({ exceptionReplyReceiptId: receiptId, exceptionReplyDecision: decision, exceptionReplyNote: '', exceptionReplyEvidence: [], error: '' });
  },
  cancelReceiptExceptionReply() {
    if (this.data.deliveryBusy || this.data.exceptionReplyUploading) return;
    this.setData({ exceptionReplyReceiptId: '', exceptionReplyDecision: '', exceptionReplyNote: '', exceptionReplyEvidence: [] });
  },
  async chooseReceiptReplyEvidence() {
    if (this.data.deliveryBusy || this.data.exceptionReplyUploading || !this.data.exceptionReplyReceiptId || this.data.exceptionReplyEvidence.length >= 6) return;
    const receiptId = this.data.exceptionReplyReceiptId, orderId = this.data.supplierOrderId, actorId = api.currentUser()?.id;
    const active = () => this.data.exceptionReplyReceiptId === receiptId && this.data.supplierOrderId === orderId && api.currentUser()?.id === actorId;
    this.setData({ exceptionReplyUploading: true, error: '' });
    try {
      const files = await api.chooseEvidence(6 - this.data.exceptionReplyEvidence.length);
      for (const file of files) {
        if (!active()) return;
        const uploaded = await api.uploadEvidence(file.path, 'RECEIPT_EXCEPTION_REPLY');
        if (active()) this.setData({ exceptionReplyEvidence: [...this.data.exceptionReplyEvidence, { ...uploaded, path: file.path }] });
      }
    } catch (error) { if (active()) this.setData({ error: error.message }); }
    finally { this.setData({ exceptionReplyUploading: false }); }
  },
  removeReceiptReplyEvidence(event) {
    if (!this.data.deliveryBusy && !this.data.exceptionReplyUploading) this.setData({ exceptionReplyEvidence: this.data.exceptionReplyEvidence.filter((_, index) => index !== Number(event.currentTarget.dataset.index)) });
  },
  async submitReceiptExceptionReply() {
    if (this.data.deliveryBusy || this.data.exceptionReplyUploading || !this.data.selectedOrder) return;
    const receiptId = this.data.exceptionReplyReceiptId, decision = this.data.exceptionReplyDecision;
    const batch = this.data.selectedOrder.shipments.find(item => item.receiptId === receiptId);
    const changingPlan = batch?.receiptExceptionStatus === 'RESPONDED' && batch.receiptExceptionDecision === 'REPLENISH' && decision === 'ACCEPT_SHORTAGE';
    if ((!changingPlan && batch?.receiptExceptionStatus !== 'SUBMITTED') || !['HANDLED', 'DECLINED', 'REPLENISH', 'ACCEPT_SHORTAGE'].includes(decision)) return;
    const reason = this.data.exceptionReplyNote.trim();
    if (!reason) { this.setData({ error: '请填写处理说明' }); return; }
    if (reason.length > 500) { this.setData({ error: '处理说明最多500字' }); return; }
    if (this.data.exceptionReplyEvidence.some(file => !file.id)) { this.setData({ error: '请等待凭证上传完成' }); return; }
    const order = this.data.selectedOrder;
    this.setData({ deliveryBusy: true, error: '' });
    try {
      await this.submitCommand(`/supplier-orders/${order.id}/respond-receipt-exception`, { method: 'POST', data: { expectedVersion: order.version, receiptId, decision, reason, ...(this.data.exceptionReplyEvidence.length ? { evidenceFileIds: this.data.exceptionReplyEvidence.map(file => file.id) } : {}) }, header: { 'idempotency-key': `mini-receipt-response-${Date.now()}` } });
      this.setData({ exceptionReplyReceiptId: '', exceptionReplyNote: '', exceptionReplyEvidence: [] });
      await this.loadOrders(false);
      await this.loadOrder(order.id);
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ deliveryBusy: false }); }
  },

  selectDelivery(event) {
    if (this.data.shipping || this.data.rejecting) return;
    const index = Number(event.detail.value);
    if (index !== 0 && index !== 1) return;
    this.setData({ deliveryIndex: index, trackingNo: '', carrierId: '', carrierIndex: 0 });
  },

  selectCarrier(event) {
    const index = Number(event.detail.value);
    const choice = this.data.carrierChoices[index];
    if (!choice || this.data.shipping || this.data.rejecting) return;
    this.setData({ carrierIndex: index, carrierId: choice.id });
  },

  onGapQuantity(event) {
    if (this.data.shipping || this.data.rejecting) return;
    const { id, gapId } = event.currentTarget.dataset;
    this.setData({ shipmentItems: this.data.shipmentItems.map(item => item.id === id
      ? { ...item, gaps: item.gaps.map(gap => gap.id === gapId ? { ...gap, allocationQuantity: event.detail.value } : gap) } : item) });
  },

  selectFreight(event) {
    if (this.data.shipping || this.data.rejecting) return;
    this.setData({ freightIndex: Number(event.detail.value) });
  },
  async refreshFreight() {
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || this.data.freightRefreshing || !this.data.selectedOrder) return;
    const id = this.data.supplierOrderId, actorId = this.data.user.id;
    const chosenId = this.data.freightChoices[this.data.freightIndex]?.id || '';
    this.setData({ freightRefreshing: true });
    try {
      const order = await api.request(`/supplier-orders/${id}`);
      if (this.data.supplierOrderId !== id || this.data.user.id !== actorId) return;
      const freightChoices = [{ id: '', amount: '0.00', label: '无运费' }].concat((order.freightConfirmations || [])
        .filter(item => order.requiresFreightSnapshot !== false && item.status === 'CONFIRMED' && !item.usedAt)
        .map(item => ({ ...item, label: `¥${view.moneyText(item.amount)} · ${item.reason || '已确认运费'}` })));
      this.setData({ freightChoices, freightIndex: Math.max(0, freightChoices.findIndex(item => item.id === chosenId)),
        selectedOrder: { ...this.data.selectedOrder, freightConfirmations: order.freightConfirmations || [] } });
    } catch (error) { if (this.data.supplierOrderId === id && this.data.user.id === actorId) this.setData({ error: error.message }); }
    finally { this.setData({ freightRefreshing: false }); }
  },

  async requestFreight() {
    if (this.data.freightRequesting || this.data.shipping || this.data.rejecting || !this.data.selectedOrder) return;
    if (this.data.selectedOrder.requiresFreightSnapshot === false) { this.setData({ error: '该订单不允许收取运费，请使用零运费。' }); return; }
    this.setData({ freightRequesting: true, error: '' });
    try {
      const amount = this.data.freightRequestAmount.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error('请填写大于零的运费金额，最多两位小数');
      const reason = this.data.freightRequestReason.trim();
      if (!reason) throw new Error('请填写运费原因');
      const confirmation = await this.submitCommand(`/supplier-orders/${this.data.supplierOrderId}/freight-confirmations`, {
        method: 'POST', data: { expectedVersion: this.data.selectedOrder.version, amount, reason },
        header: { 'idempotency-key': `mini-freight-${Date.now()}` }
      });
      this.setData({ selectedOrder: { ...this.data.selectedOrder, freightConfirmations: [confirmation].concat(this.data.selectedOrder.freightConfirmations || []) },
        freightRequestAmount: '', freightRequestReason: '', result: { title: this.data.selectedOrder.supplierOrderNo, status: 'PENDING', detail: `运费 ¥${view.moneyText(confirmation.amount)} 已提交采购确认` } });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ freightRequesting: false });
    }
  },

  async selectDiscrepancy(event) {
    await this.loadDiscrepancy(event.currentTarget.dataset.id);
  },

  async loadDiscrepancy(id) {
    if (this.data.resolving || this.data.shipping || this.data.freightRequesting) return;
    this.setData({ discrepancyId: id, selectedDiscrepancy: null, discrepancyLoading: true, discrepancyReason: '', error: '' });
    try {
      const detail = await api.request(`/discrepancies/${this.data.discrepancyId}`);
      if (this.data.discrepancyId !== id) return;
      this.setData({ selectedDiscrepancy: { ...detail, canReplenish: Number(detail.replenishmentGap?.remainingQuantity) > 0 && ['PENDING', 'PARTIAL_FILLED'].includes(detail.replenishmentGap.status) }, discrepancies: this.data.discrepancies.map(item => item.id === id ? { ...item, status: detail.status } : item) });
    } catch (error) {
      if (this.data.discrepancyId === id) this.setData({ error: error.message });
    } finally {
      if (this.data.discrepancyId === id) this.setData({ discrepancyLoading: false });
    }
  },

  async startReplenishment() {
    const discrepancy = this.data.selectedDiscrepancy;
    const gap = discrepancy && discrepancy.replenishmentGap;
    if (!gap || Number(gap.remainingQuantity) <= 0 || this.data.resolving || this.data.shipping || this.data.freightRequesting) return;
    await this.loadOrder(discrepancy.supplierOrderId);
    if (!this.data.selectedOrder || this.data.selectedOrder.id !== discrepancy.supplierOrderId) return;
    this.setData({ activeView: 'orders', orderMode: 'ship', shipmentItems: this.data.shipmentItems.map(item => ({ ...item,
      shipQuantity: item.id === (gap.orderItemId || discrepancy.orderItemId) ? gap.remainingQuantity : '0',
      gaps: item.gaps.map(value => ({ ...value, allocationQuantity: value.id === gap.id ? gap.remainingQuantity : '0' }))
    })) });
  },

  async selectPayment(event) {
    await this.loadPayment(event.currentTarget.dataset.id);
  },

  async loadPayment(id) {
    if (this.data.paying || this.data.evidenceLoading) return;
    this.setData({ paymentId: id, selectedPayment: null, paymentLoading: true, paymentReason: '', error: '' });
    try {
      const payment = await api.request(`/payment-records/${this.data.paymentId}`);
      if (this.data.paymentId !== id) return;
      this.setData({ selectedPayment: payment });
    } catch (error) {
      if (this.data.paymentId === id) this.setData({ error: error.message });
    } finally {
      if (this.data.paymentId === id) this.setData({ paymentLoading: false });
    }
  },

  async viewEvidence(event) {
    if (this.data.evidenceLoading || !this.data.selectedPayment) return;
    const file = (this.data.selectedPayment.evidenceFiles || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!file) return;
    this.setData({ evidenceLoading: true, error: '' });
    try { await api.previewEvidence(file); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ evidenceLoading: false }); }
  },

  async viewReceiptEvidence(event) {
    if (this.data.evidenceLoading || !this.data.selectedDiscrepancy) return;
    const file = (this.data.selectedDiscrepancy.evidenceFiles || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!file) return;
    this.setData({ evidenceLoading: true, error: '' });
    try { await api.previewEvidence(file); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ evidenceLoading: false }); }
  },

  async loadWork() {
    this.setData({ loading: true, error: '' });
    try {
      await Promise.all([
        this.loadOrders(false),
        this.loadDiscrepancies(false),
        this.loadStatements(false),
        this.loadPayments(false),
        this.loadReports(false),
        this.loadLogisticsCompanies()
      ]);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadLogisticsCompanies() {
    try {
      const rows = await api.request('/logistics-companies');
      const logisticsCompanies = (Array.isArray(rows) ? rows : []).filter(row => row.isActive);
      this.setData({ logisticsCompanies, carrierChoices: [{ id: '', name: '请选择物流公司' }, ...logisticsCompanies.map(row => ({ id: row.id, name: row.name }))] });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  async loadOrders(toggleLoading = true) {
    const actorId = this.data.user.id;
    const sequence = this.orderRequestSequence = (this.orderRequestSequence || 0) + 1;
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const orders = await api.request('/supplier-orders');
      if (this.data.user.id !== actorId || this.orderRequestSequence !== sequence) return;
      const rows = Array.isArray(orders) ? orders.map(order => {
        const names = (order.items || []).map(item => item.productName || '商品');
        const fallbackNames = String(order.productSummary || '').split('、').filter(Boolean);
        const products = names.length ? names : fallbackNames;
        const state = delivery.supplierOrderState(order);
        return { ...order, listState: state,
          displayStatus: delivery.supplierOrderLabel(order),
          createdText: view.dateText(order.createdAt), itemCount: products.length || order.itemCount || 0,
          productPreview: products.slice(0, 2).join('、'), productMoreCount: Math.max(0, products.length - 2),
          productSummary: order.productSummary || (order.items || []).map(item => `${item.productName || '商品'} ${view.decimalText(item.quantity)}${item.unitName || ''}`).join('、') };
      }) : [];
      const sortedRows = sortSupplierOrders(rows);
      this.setData({ orders: sortedRows, objectionTasks: oldestFirst(sortedRows.filter(item => item.listState === 'DISPUTED')),
        shippingTasks: oldestFirst(sortedRows.filter(item => ['pending', 'PARTIAL_SHIPPED', 'REPLENISHING'].includes(item.listState))) });
      this.refreshList();
      return true;
    } catch (error) {
      if (this.data.user.id === actorId && this.orderRequestSequence === sequence) {
        this.setData({ error: error.message, orders: [], visibleOrders: [], shippingTasks: [], objectionTasks: [], orderTotal: 0, moreOrders: false,
          orderTabs: orderTabs.map(tab => ({ ...tab, count: 0 })) });
        return false;
      }
    } finally {
      if (toggleLoading && this.data.user.id === actorId && this.orderRequestSequence === sequence) this.setData({ loading: false });
    }
  },

  async loadDiscrepancies(toggleLoading = true) {
    const actorId = this.data.user.id;
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const pending = await api.request('/discrepancies');
      if (this.data.user.id !== actorId) return;
      const data = await api.request('/notifications');
      if (this.data.user.id !== actorId) return;
      const notifications = data.notifications || [];
      const discrepancies = [];
      const seen = new Set();
      const statuses = new Map(this.data.discrepancies.map(item => [item.id, item.status]));
      for (const item of notifications) {
        const ids = item.payload && item.payload.discrepancyIds;
        if (!Array.isArray(ids)) continue;
        for (const id of ids) {
          if (seen.has(id)) continue;
          seen.add(id);
          discrepancies.push({
            id,
            status: statuses.get(id) || '',
            title: item.title,
            receiptId: item.payload.receiptId,
            createdAt: item.createdAt
          });
        }
      }
      for (const item of Array.isArray(pending) ? pending : []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        discrepancies.push(item);
      }
      const details = [];
      for (let index = 0; index < discrepancies.length; index += 5) {
        details.push(...await Promise.all(discrepancies.slice(index, index + 5).map(async item => ({ ...item, ...await api.request(`/discrepancies/${encodeURIComponent(item.id)}`) }))));
        if (this.data.user.id !== actorId) return;
      }
      const legacyDetails = details.filter(item => !item.deliveryState);
      this.setData({ discrepancies: legacyDetails, differenceTasks: oldestFirst(legacyDetails.filter(item => item.status === 'OPEN' || Number(item.replenishmentGap?.remainingQuantity) > 0)) });
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
      this.setData({ statements: Array.isArray(statements) ? statements.map(statement => ({ ...statement, periodText: view.statementPeriod(statement) })) : [] });
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
      this.setData({ payments: Array.isArray(payments) ? payments : [] });
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
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || this.data.revisionUploading || !this.data.selectedOrder) return;
    if (this.data.deliveryIndex === 1 && !this.data.carrierId) {
      this.setData({ error: this.data.logisticsCompanies.length ? '请选择物流公司' : '暂无启用的物流公司，请联系管理员配置' });
      return;
    }
    this.setData({ shipping: true, error: '', result: null });
    try {
      const order = this.data.selectedOrder;
      const items = delivery.shipmentPayload(this.data.shipmentItems);
      if (!items.length) throw new Error('至少填写一项发货数量');
      const shortShipment = delivery.needsExplanation(this.data.shipmentItems, this.data.completeDelivery);
      if (shortShipment && !this.data.revisionNote.trim()) throw new Error('请填写异常发货备注');
      if (shortShipment && !this.data.revisionEvidence.length) throw new Error('请上传发货差异凭证');
      const freight = this.data.freightChoices[this.data.freightIndex] || { amount: '0.00' };
      const preview = await api.request(`/supplier-orders/${this.data.supplierOrderId}/shipment-preview`, {
        method: 'POST',
        data: { expectedVersion: order.version, completeDelivery: this.data.completeDelivery, items, freight: freight.amount, deliveryMode: this.data.deliveryChoices[this.data.deliveryIndex].value, ...(freight.id ? { freightConfirmationId: freight.id } : {}), ...(this.data.deliveryIndex === 1 ? { carrierId: this.data.carrierId } : {}) }
      });
      await this.submitCommand(`/supplier-orders/${this.data.supplierOrderId}/shipments`, {
        method: 'POST',
        data: {
          expectedVersion: order.version,
          completeDelivery: this.data.completeDelivery,
          items,
          ...(this.data.revisionNote.trim() ? { note: this.data.revisionNote.trim() } : {}),
          ...(this.data.revisionEvidence.length ? { evidenceFileIds: this.data.revisionEvidence.map(file => file.id) } : {}),
          freight: freight.amount,
          ...(freight.id ? { freightConfirmationId: freight.id } : {}),
          deliveryMode: this.data.deliveryChoices[this.data.deliveryIndex].value,
          ...(this.data.deliveryIndex === 1 ? { carrierId: this.data.carrierId, trackingNo: this.data.trackingNo.trim() || undefined } : {})
        },
        header: { 'idempotency-key': `mini-supplier-ship-${Date.now()}` }
      });
      this.setData({ result: null, supplierOrderId: '', selectedOrder: null, orderMode: 'detail', shipmentItems: [],
        trackingNo: '', carrierId: '', carrierIndex: 0, revisionNote: '', revisionEvidence: [],
        visibleOrders: [], shippingTasks: [], objectionTasks: [] });
      const refreshed = await this.loadOrders();
      if (refreshed === false) this.setData({ error: `发货已成功，订单列表刷新失败，请刷新重试。${this.data.error || ''}` });
      if (wx.showToast) wx.showToast({ title: refreshed === false ? '已发货，列表待刷新' : '发货成功', icon: refreshed === false ? 'none' : 'success' });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ shipping: false });
    }
  },

  async rejectOrder() {
    if (this.data.rejecting || this.data.shipping || !this.data.selectedOrder) return;
    if (!this.data.rejectionReason.trim()) {
      this.setData({ error: '请填写拒单原因' });
      return;
    }
    this.setData({ rejecting: true, error: '', result: null });
    try {
      const order = this.data.selectedOrder;
      const rejected = await this.submitCommand(`/supplier-orders/${this.data.supplierOrderId}/reject`, {
        method: 'POST',
        data: { expectedVersion: order.version, reason: this.data.rejectionReason.trim() },
        header: { 'idempotency-key': `mini-supplier-reject-${Date.now()}` }
      });
      this.setData({
        result: {
          title: order.supplierOrderNo,
          status: rejected.status || 'REJECTED',
          detail: '已通知采购处理拒单改派'
        }
      });
      this.setData({ supplierOrderId: '', selectedOrder: null, shipmentItems: [], rejectionReason: '' });
      await this.loadWork();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ rejecting: false });
    }
  },

  async resolveDiscrepancy(event) {
    if (this.data.resolving || this.data.discrepancyLoading || !this.data.selectedDiscrepancy || this.data.selectedDiscrepancy.status !== 'OPEN') return;
    const action = event.currentTarget.dataset.action;
    if (action !== 'RETURN') return;
    if (action === 'RETURN' && !this.data.discrepancyReason.trim()) {
      this.setData({ error: '请填写退回核对原因' });
      return;
    }
    this.setData({ resolving: true, error: '', result: null });
    try {
      const discrepancy = this.data.selectedDiscrepancy;
      const resolved = await this.submitCommand(`/discrepancies/${this.data.discrepancyId}/resolve`, {
        method: 'POST',
        data: {
          expectedVersion: discrepancy.version,
          action,
          reason: this.data.discrepancyReason || undefined
        },
        header: { 'idempotency-key': `mini-discrepancy-${action}-${Date.now()}` }
      });
      this.setData({
        selectedDiscrepancy: { ...discrepancy, ...resolved },
        discrepancies: this.data.discrepancies.map(item => item.id === discrepancy.id ? { ...item, status: resolved.status } : item),
        result: {
          title: discrepancy.productName || '收货差异',
          status: resolved.status,
          detail: `已退回门店核对，差异数量 ${resolved.missingQuantity}`
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
    if (this.data.paying || this.data.paymentLoading) return;
    const action = event.currentTarget.dataset.action;
    if (!['confirm', 'reject'].includes(action)) return;
    if (!this.data.selectedPayment || this.data.selectedPayment.status !== 'PENDING') {
      this.setData({ error: '请选择待确认付款记录' });
      return;
    }
    if (action === 'reject' && !this.data.paymentReason.trim()) {
      this.setData({ error: '请填写驳回原因' });
      return;
    }

    this.setData({ paying: true, error: '', result: null });
    try {
      const payment = this.data.selectedPayment;
      const payload = action === 'confirm'
        ? { expectedVersion: payment.version }
        : { expectedVersion: payment.version, reason: this.data.paymentReason.trim() };
      const handled = await this.submitCommand(`/payment-records/${this.data.paymentId}/${action}`, {
        method: 'POST',
        data: payload,
        header: { 'idempotency-key': `mini-supplier-payment-${action}-${Date.now()}` }
      });
      this.setData({
        selectedPayment: { ...payment, ...handled },
        result: {
          title: handled.paymentNo || handled.id,
          status: handled.status,
          detail: `付款金额 ¥${view.moneyText(handled.amount)}，${action === 'confirm' ? '已确认收款' : '已驳回付款'}`
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
    if (this.data.recovering || this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting || this.data.exceptionReplyUploading || this.data.deliveryBusy) return;
    api.logout();
    wx.redirectTo({ url: '/pages/login/index' });
  }
});
