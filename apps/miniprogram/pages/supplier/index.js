const api = require('../../utils/api');
const quantity = require('../../utils/quantity');
const view = require('../../utils/store-view');

Page({
  data: {
    activeView: 'orders',
    pendingCommand: null,
    commandHistory: [],
    recovering: false,
    search: '',
    statusFilter: 'all',
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
    orderLoading: false,
    trackingNo: '',
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
      this.setData({ visibleOrders: [], search: '', statusFilter: 'all' });
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
    if (api.currentUser && !api.currentUser()) { this.setData({ pendingCommand: null, commandHistory: [] }); return; }
    const state = api.roleCommandState('supplier');
    this.setData({ pendingCommand: state.pending ? { ...state.pending, dateText: view.dateText(state.pending.createdAt) } : null,
      commandHistory: state.history.map(item => ({ ...item, dateText: view.dateText(item.finishedAt) })) });
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
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting || this.data.evidenceLoading) return;
    if (event.currentTarget.dataset.view !== this.data.activeView) {
      this.setData({ statementReturnId: '', statementParentId: '', statementKind: 'total' });
      this.backToList();
    }
    this.setData({ activeView: event.currentTarget.dataset.view, error: '' });
  },

  openProfile() {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting) return;
    wx.navigateTo({ url: '/pages/profile/index?kind=supplier' });
  },

  backToList() {
    if (this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting || this.data.evidenceLoading) return;
    const returnId = this.data.statementReturnId;
    const returnKind = this.data.statementReturnKind;
    const returnParentId = this.data.statementReturnParentId;
    const parentId = this.data.statementKind === 'store' ? this.data.statementParentId : '';
    this.statementRequestSequence = (this.statementRequestSequence || 0) + 1;
    this.setData({ selectedOrder: null, supplierOrderId: '', selectedDiscrepancy: null, discrepancyId: '', selectedPayment: null, paymentId: '', shipmentItems: [] });
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
    this.setData({ statusFilter: event.currentTarget.dataset.filter });
    this.refreshList();
  },

  refreshList() {
    const search = this.data.search.trim().toLowerCase();
    this.setData({ visibleOrders: this.data.orders.filter(item =>
      (this.data.statusFilter === 'all' || item.status === this.data.statusFilter) &&
      [item.supplierOrderNo, item.storeName].some(value => String(value || '').toLowerCase().includes(search))) });
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

  async loadOrder(id) {
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting) return;
    this.setData({ supplierOrderId: id, selectedOrder: null, shipmentItems: [], orderLoading: true, freightIndex: 0, freightChoices: [], error: '' });
    try {
      const selectedOrder = await api.request(`/supplier-orders/${id}`);
      if (this.data.supplierOrderId !== id) return;
      this.setData({ selectedOrder: { ...selectedOrder,
        canRequestFreight: selectedOrder.requiresFreightSnapshot !== false,
        canShip: ['PUSHED', 'ACCEPTED', 'PARTIAL_SHIPPED'].includes(selectedOrder.status) || (selectedOrder.status === 'SHIPPED' && selectedOrder.items.some(item => (item.replenishmentGaps || []).some(gap => ['PENDING', 'PARTIAL_FILLED'].includes(gap.status) && Number(gap.remainingQuantity) > 0))),
        canReject: ['PUSHED', 'ACCEPTED'].includes(selectedOrder.status) && !selectedOrder.firstShippedAt && selectedOrder.fulfillmentStatus === 'PENDING'
      }, freightChoices: [{ id: '', amount: '0.00', label: '无运费' }].concat((selectedOrder.freightConfirmations || [])
        .filter(item => selectedOrder.requiresFreightSnapshot !== false && item.status === 'CONFIRMED' && !item.usedAt).map(item => ({ ...item, label: `¥${item.amount} · ${item.reason}` }))),
      shipmentItems: selectedOrder.items.map(item => ({
        ...item, remainingQuantity: quantity.sum([quantity.remaining(item.quantity, item.shippedQuantity), ...(item.replenishmentGaps || []).filter(gap => Number(gap.remainingQuantity) > 0 && ['PENDING', 'PARTIAL_FILLED'].includes(gap.status)).map(gap => gap.remainingQuantity)]),
        shipQuantity: quantity.remaining(item.quantity, item.shippedQuantity),
        gaps: (item.replenishmentGaps || []).filter(gap => gap.status !== 'COMPLETED' && Number(gap.remainingQuantity) > 0)
          .map(gap => ({ ...gap, allocationQuantity: '0' }))
      })) });
    } catch (error) {
      if (this.data.supplierOrderId === id) this.setData({ error: error.message });
    } finally {
      if (this.data.supplierOrderId === id) this.setData({ orderLoading: false });
    }
  },

  onShipQuantity(event) {
    if (this.data.shipping || this.data.rejecting) return;
    this.setData({ shipmentItems: this.data.shipmentItems.map(item => item.id === event.currentTarget.dataset.id
      ? { ...item, shipQuantity: event.detail.value } : item) });
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
        freightRequestAmount: '', freightRequestReason: '', result: { title: this.data.selectedOrder.supplierOrderNo, status: 'PENDING', detail: `运费 ¥${confirmation.amount} 已提交采购确认` } });
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
      this.setData({ selectedDiscrepancy: detail, discrepancies: this.data.discrepancies.map(item => item.id === id ? { ...item, status: detail.status } : item) });
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
    this.setData({ activeView: 'orders', shipmentItems: this.data.shipmentItems.map(item => ({ ...item,
      shipQuantity: item.id === gap.orderItemId ? gap.remainingQuantity : '0',
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
      this.setData({ orders: Array.isArray(orders) ? orders : [] });
      this.refreshList();
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
      this.setData({ statements: Array.isArray(statements) ? statements.slice(0, 20).map(statement => ({ ...statement, periodText: view.statementPeriod(statement) })) : [] });
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
    if (this.data.shipping || this.data.rejecting || this.data.freightRequesting || !this.data.selectedOrder) return;
    this.setData({ shipping: true, error: '', result: null });
    try {
      const order = this.data.selectedOrder;
      const items = this.data.shipmentItems.map(item => {
        const shipQuantity = quantity.validate(item.shipQuantity, { allowZero: true, max: item.remainingQuantity });
        const gapAllocations = (item.gaps || []).map(gap => ({ gapId: gap.id,
          quantity: quantity.validate(gap.allocationQuantity, { allowZero: true, max: gap.remainingQuantity })
        })).filter(gap => Number(gap.quantity) > 0);
        quantity.validate(quantity.sum(gapAllocations.map(gap => gap.quantity)), { allowZero: true, max: shipQuantity });
        return { orderItemId: item.id, shipQuantity, permanentlyReduceQuantity: '0', ...(gapAllocations.length ? { gapAllocations } : {}) };
      }).filter(item => Number(item.shipQuantity) > 0);
      if (!items.length) throw new Error('至少填写一项发货数量');
      const freight = this.data.freightChoices[this.data.freightIndex] || { amount: '0.00' };
      const preview = await api.request(`/supplier-orders/${this.data.supplierOrderId}/shipment-preview`, {
        method: 'POST',
        data: { expectedVersion: order.version, items, freight: freight.amount, ...(freight.id ? { freightConfirmationId: freight.id } : {}) }
      });
      const shipment = await this.submitCommand(`/supplier-orders/${this.data.supplierOrderId}/shipments`, {
        method: 'POST',
        data: {
          expectedVersion: order.version,
          items,
          freight: freight.amount,
          ...(freight.id ? { freightConfirmationId: freight.id } : {}),
          trackingNo: this.data.trackingNo.trim() || undefined
        },
        header: { 'idempotency-key': `mini-supplier-ship-${Date.now()}` }
      });
      this.setData({
        result: {
          title: shipment.shipmentNo || shipment.id,
          status: shipment.status || 'SHIPPED',
          detail: `本次发货 ${items.length} 种商品，共 ${preview.totals.shipQuantity}`
        }
      });
      await this.loadWork();
      this.setData({ supplierOrderId: '', selectedOrder: null, shipmentItems: [], trackingNo: '' });
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
    if (!['ACCEPT', 'REPLENISH', 'RETURN'].includes(action)) return;
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
          detail: `${action === 'ACCEPT' ? '已同意少收' : action === 'REPLENISH' ? '已安排补发' : '已退回门店核对'}，差异数量 ${resolved.missingQuantity}`
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
          detail: `付款金额 ¥${handled.amount}，${action === 'confirm' ? '已确认收款' : '已驳回付款'}`
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
    if (this.data.recovering || this.data.shipping || this.data.rejecting || this.data.resolving || this.data.paying || this.data.freightRequesting) return;
    api.logout();
    wx.redirectTo({ url: '/pages/login/index' });
  }
});
