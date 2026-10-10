const api = require('../../utils/api');
const view = require('../../utils/store-view');

Page({
  data: { user: {}, activeView: 'tasks', book: 'payments', loading: false, error: '', search: '',
    payments: [], storeStatements: [], supplierStatements: [], visibleRecords: [], tasks: [],
    selected: null, selectedKind: '', detailLoading: false, reviewing: false, evidenceLoading: false,
    reviewMode: '', reason: '', pendingCommand: null, storeNames: {}, supplierNames: {} },

  onShow() {
    const user = api.openWorkspace('finance');
    if (!user) return;
    if (this.data.user.id !== user.id) this.setData({ activeView: 'tasks', book: 'payments', selected: null,
      payments: [], storeStatements: [], supplierStatements: [], visibleRecords: [], tasks: [], search: '', pendingCommand: null });
    this.setData({ user });
    this.syncCommand();
    return this.loadWork();
  },
  onHide() { this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; },
  syncCommand() { this.setData({ pendingCommand: api.roleCommandState ? api.roleCommandState('finance').pending : null }); },
  busy() { return this.data.reviewing || this.data.evidenceLoading; },
  changeView(event) {
    if (this.busy()) return;
    const activeView = event.currentTarget.dataset.view;
    if (!['tasks', 'books', 'mine'].includes(activeView)) return;
    this.detailSequence = (this.detailSequence || 0) + 1;
    this.setData({ activeView, selected: null, detailLoading: false, error: '', reviewMode: '' });
    this.refreshRecords();
  },
  chooseBook(event) {
    if (this.busy()) return;
    const book = event.currentTarget.dataset.book;
    if (!['payments', 'stores', 'suppliers'].includes(book)) return;
    this.detailSequence = (this.detailSequence || 0) + 1;
    this.setData({ book, selected: null, detailLoading: false, error: '' }); this.refreshRecords();
  },
  onSearch(event) { this.setData({ search: event.detail.value }); this.refreshRecords(); },
  nextRecords() { this.refreshRecords((this.data.recordLimit || 10) + 10); },
  refreshRecords(limit = 10) {
    const source = this.data.book === 'payments' ? this.data.payments : this.data.book === 'stores' ? this.data.storeStatements : this.data.supplierStatements;
    const search = this.data.search.trim().toLowerCase();
    const filtered = source.filter(item => [item.title, item.subtitle, item.periodText].some(value => String(value || '').toLowerCase().includes(search)));
    this.setData({ visibleRecords: filtered.slice(0, limit), recordLimit: limit, moreRecords: filtered.length > limit });
  },
  async loadWork() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const [payments, storeStatements, supplierStatements, stores, suppliers] = await Promise.all([
        api.request('/payment-records'), api.request('/store-statements'), api.request('/supplier-statements'),
        api.request('/stores'), api.request('/suppliers')
      ]);
      if (sequence !== this.sequence) return;
      const storeNames = Object.fromEntries(stores.map(item => [item.id, item.name]));
      const supplierNames = Object.fromEntries(suppliers.map(item => [item.id, item.name]));
      const mappedPayments = payments.map(item => ({ ...item, title: item.paymentNo,
        subtitle: item.direction === 'COMPANY_TO_SUPPLIER' ? supplierNames[item.supplierId] || '供应商付款' : storeNames[item.storeId] || '门店付款',
        dateText: view.dateText(item.createdAt), kind: 'payment' }));
      const statement = (item, kind) => ({ ...item, title: kind === 'store' ? storeNames[item.storeId] || '门店账单' : supplierNames[item.supplierId] || '供应商账单',
        periodText: view.statementPeriod(item), kind, amount: item.payableAmount, status: item.settlementStatus || item.status });
      this.setData({ payments: mappedPayments, tasks: mappedPayments.filter(item => item.direction === 'STORE_TO_COMPANY' && item.status === 'PENDING'),
        storeStatements: storeStatements.map(item => statement(item, 'store')), supplierStatements: supplierStatements.map(item => statement(item, 'supplier')),
        storeNames, supplierNames });
      this.refreshRecords();
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  async openRecord(event) {
    if (this.busy()) return;
    const { id, kind } = event.currentTarget.dataset;
    if (!['payment', 'store', 'supplier'].includes(kind)) return;
    const sequence = this.detailSequence = (this.detailSequence || 0) + 1;
    this.setData({ selected: null, selectedKind: kind, detailLoading: true, error: '', reviewMode: '', reason: '' });
    try {
      const endpoint = kind === 'payment' ? 'payment-records' : kind === 'store' ? 'store-statements' : 'supplier-statements';
      const item = await api.request(`/${endpoint}/${encodeURIComponent(id)}`);
      if (sequence !== this.detailSequence) return;
      this.setData({ selected: { ...item, title: kind === 'payment' ? item.paymentNo : kind === 'store' ? this.data.storeNames[item.storeId] || '门店账单' : this.data.supplierNames[item.supplierId] || '供应商账单',
        periodText: kind === 'payment' ? '' : view.statementPeriod(item),
        canReview: kind === 'payment' && item.direction === 'STORE_TO_COMPANY' && item.status === 'PENDING' } });
    } catch (error) { if (sequence === this.detailSequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.detailSequence) this.setData({ detailLoading: false }); }
  },
  backToList() {
    if (this.busy()) return;
    this.detailSequence = (this.detailSequence || 0) + 1;
    this.setData({ selected: null, detailLoading: false, reviewMode: '', error: '' });
  },
  startReview(event) {
    if (this.busy() || !this.data.selected?.canReview || this.data.pendingCommand) return;
    const reviewMode = event.currentTarget.dataset.action;
    if (['confirm', 'reject'].includes(reviewMode)) this.setData({ reviewMode, reason: '', error: '' });
  },
  onReason(event) { if (!this.busy()) this.setData({ reason: event.detail.value }); },
  cancelReview() { if (!this.busy()) this.setData({ reviewMode: '', reason: '', error: '' }); },
  async submitReview() {
    const item = this.data.selected, action = this.data.reviewMode;
    if (this.busy() || !item?.canReview || !['confirm', 'reject'].includes(action) || this.data.pendingCommand) return;
    const reason = this.data.reason.trim();
    if (action === 'reject' && !reason) { this.setData({ error: '请填写驳回原因' }); return; }
    this.setData({ reviewing: true, error: '' });
    const actorId = this.data.user.id;
    try {
      const result = await api.roleCommand('finance', `/payment-records/${item.id}/${action}`, {
        method: 'POST', data: { expectedVersion: item.version, ...(action === 'reject' ? { reason } : {}) },
        header: { 'idempotency-key': `mini-finance-${action}-${Date.now()}` }
      });
      if (api.currentUser && api.currentUser()?.id !== actorId) return;
      this.setData({ selected: { ...item, ...result, canReview: false }, reviewMode: '' });
      await this.loadWork();
    } catch (error) { if (!api.currentUser || api.currentUser()?.id === actorId) this.setData({ error: error.message }); }
    finally { this.setData({ reviewing: false }); this.syncCommand(); }
  },
  async recoverCommand() {
    if (this.busy() || !this.data.pendingCommand) return;
    const actorId = this.data.user.id;
    this.setData({ reviewing: true, error: '' });
    try {
      await api.retryRoleCommand('finance');
      if (api.currentUser && api.currentUser()?.id !== actorId) return;
      this.setData({ selected: null }); await this.loadWork();
    }
    catch (error) { if (!api.currentUser || api.currentUser()?.id === actorId) this.setData({ error: error.message }); }
    finally { this.setData({ reviewing: false }); this.syncCommand(); }
  },
  async viewEvidence(event) {
    if (this.busy()) return;
    const file = (this.data.selected?.evidenceFiles || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!file) return;
    this.setData({ evidenceLoading: true, error: '' });
    try { await api.previewEvidence(file); } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ evidenceLoading: false }); }
  },
  logout() { if (this.busy()) return; api.logout(); wx.redirectTo({ url: '/pages/login/index' }); }
});
