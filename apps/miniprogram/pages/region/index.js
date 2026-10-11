const api = require('../../utils/api');
const view = require('../../utils/store-view');
const roles = { REGION_MANAGER: '区域经理', REGION_FINANCE: '区域财务', PURCHASE_FOLLOWER: '采购跟单' };
const books = { company: 'store-statements', direct: 'direct-statements' };

Page({
  data: { user: {}, roleText: '', canConfirm: false, activeView: 'orders', stores: [], storeOptions: [], storeIndex: 0,
    search: '', rows: [], visibleRows: [], tasks: [], selected: null, selectedKind: '', book: 'company',
    range: view.monthRange(), report: null, loading: false, detailing: false, saving: false, error: '', pendingCommand: null },
  onShow() {
    const user = api.openWorkspace('region');
    if (!user) return;
    const role = user.roles.includes('PURCHASE_FOLLOWER') ? 'PURCHASE_FOLLOWER' : user.roles.includes('REGION_FINANCE') ? 'REGION_FINANCE' : 'REGION_MANAGER';
    if (this.data.user.id !== user.id || JSON.stringify(this.data.user.scope) !== JSON.stringify(user.scope) || JSON.stringify(this.data.user.roles) !== JSON.stringify(user.roles)) this.setData({ stores: [], storeOptions: [], storeIndex: 0, search: '', rows: [], visibleRows: [], tasks: [],
      selected: null, report: null, range: view.monthRange(), book: 'company', activeView: role === 'PURCHASE_FOLLOWER' ? 'tasks' : role === 'REGION_FINANCE' ? 'books' : 'orders' });
    this.setData({ user, roleText: roles[role], canConfirm: role === 'PURCHASE_FOLLOWER', selected: null, detailing: false });
    this.syncCommand();
    return this.loadWork();
  },
  onHide() { this.invalidate(); },
  onUnload() { this.invalidate(); },
  invalidate() { this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; },
  active(sequence, actor) { return sequence === this.sequence && api.currentUser()?.id === actor; },
  busy() { return this.data.saving; },
  syncCommand() {
    const pending = api.roleCommandState('purchaser').pending;
    const allowed = this.data.canConfirm && pending && /^\/purchase-requests\/[^/]+\/(confirm|reject)$/.test(pending.path);
    this.setData({ pendingCommand: allowed ? pending : null, blockedCommand: Boolean(pending && !allowed) });
  },
  async changeView(event) {
    const next = event.currentTarget.dataset.view;
    if (this.busy() || !['tasks', 'orders', 'books', 'reports', 'mine'].includes(next) || next === 'tasks' && !this.data.canConfirm) return;
    this.invalidate();
    this.setData({ activeView: next, selected: null, detailing: false, rows: [], visibleRows: [], error: '' });
    return this.loadWork();
  },
  async chooseStore(event) {
    if (this.busy()) return;
    const storeIndex = Number(event.detail.value);
    if (!Number.isInteger(storeIndex) || !this.data.storeOptions[storeIndex]) return;
    this.invalidate();
    this.setData({ storeIndex, selected: null, report: null });
    return this.loadWork();
  },
  async chooseBook(event) {
    if (this.busy() || !books[event.currentTarget.dataset.book]) return;
    this.invalidate();
    this.setData({ book: event.currentTarget.dataset.book, selected: null });
    return this.loadWork();
  },
  onSearch(event) { this.setData({ search: event.detail.value }); this.filterRows(); },
  onDate(event) {
    const field = event.currentTarget.dataset.field;
    if (!this.busy() && ['from', 'to'].includes(field)) { this.invalidate(); this.setData({ range: { ...this.data.range, [field]: event.detail.value }, report: null, loading: false }); }
  },
  query() {
    const id = this.data.storeOptions[this.data.storeIndex]?.id;
    return id ? `storeId=${encodeURIComponent(id)}` : '';
  },
  filterRows(limit = 10) {
    const search = this.data.search.trim().toLowerCase();
    const source = this.data.activeView === 'tasks' ? this.data.rows.filter(row => row.status === 'PENDING_PROCUREMENT') : this.data.rows;
    const rows = source.filter(row => [row.title, row.subtitle, row.requestNo].some(value => String(value || '').toLowerCase().includes(search)));
    this.setData({ visibleRows: rows.slice(0, limit), rowLimit: limit, moreRows: rows.length > limit, tasks: this.data.rows.filter(row => row.status === 'PENDING_PROCUREMENT') });
  },
  nextRows() { this.filterRows((this.data.rowLimit || 10) + 10); },
  async loadWork() {
    if (this.busy()) return;
    const sequence = this.sequence = (this.sequence || 0) + 1, actor = this.data.user.id;
    const activeView = this.data.activeView;
    this.setData({ loading: true, error: '', rows: [], visibleRows: [], report: null });
    try {
      const stores = await api.request('/stores');
      if (!this.active(sequence, actor)) return;
      const allowed = stores.filter(store => this.data.user.scope.storeIds.includes(store.id));
      const previous = this.data.storeOptions[this.data.storeIndex]?.id;
      const storeOptions = [{ id: '', name: '全部授权门店' }, ...allowed];
      this.setData({ stores: allowed, storeOptions, storeIndex: Math.max(0, storeOptions.findIndex(store => store.id === previous)) });
      if (activeView === 'mine') return;
      const query = this.query();
      if (activeView === 'reports') {
        const { from, to } = this.data.range;
        if (!from || !to || from > to) throw new Error('开始日期不能晚于结束日期');
        const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${query ? '&' + query : ''}`;
        const [amount, quantity] = await Promise.all([api.request(`/reports/order-amounts?${range}`), api.request(`/reports/product-quantities?${range}`)]);
        if (!this.active(sequence, actor)) return;
        this.setData({ report: { months: amount.months || [], products: quantity.products || [] } });
      } else {
        const endpoint = activeView === 'books' ? books[this.data.book] : 'purchase-requests';
        const [rows, supplierOrders] = await Promise.all([
          api.request(`/${endpoint}${query ? '?' + query : ''}`),
          activeView === 'books' ? api.request(`/supplier-orders${query ? '?' + query : ''}`) : Promise.resolve([])
        ]);
        if (!this.active(sequence, actor)) return;
        const names = Object.fromEntries(allowed.map(store => [store.id, store.name]));
        const supplierNames = Object.fromEntries(supplierOrders.map(order => [order.supplierId, order.supplierName]));
        this.setData({ rows: rows.filter(row => names[row.storeId]).map(row => ({ ...row,
          title: row.storeName || names[row.storeId], subtitle: activeView === 'books' ? row.supplierName || supplierNames[row.supplierId] || (this.data.book === 'company' ? '公司结算' : '供应商结算') : row.requestNo,
          dateText: activeView === 'books' ? view.statementPeriod(row) : view.dateText(row.submittedAt || row.createdAt),
          status: row.settlementStatus || row.status, amount: row.payableAmount || row.salesGoodsAmount })) });
        this.filterRows();
      }
    } catch (error) { if (this.active(sequence, actor)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence, actor)) this.setData({ loading: false }); }
  },
  async openRecord(event) {
    if (this.busy()) return;
    const row = this.data.rows.find(item => item.id === event.currentTarget.dataset.id);
    if (!row) return;
    const sequence = this.detailSequence = (this.detailSequence || 0) + 1, actor = this.data.user.id;
    const kind = this.data.activeView === 'books' ? this.data.book : 'order';
    this.setData({ selected: null, selectedKind: kind, detailing: true, error: '' });
    try {
      const result = await api.request(`/${kind === 'order' ? 'purchase-requests' : books[kind]}/${encodeURIComponent(row.id)}`);
      if (sequence !== this.detailSequence || api.currentUser()?.id !== actor) return;
      this.setData({ selected: { ...result, title: row.title, subtitle: row.subtitle, dateText: row.dateText,
        lines: (result.lines || []).map(line => ({ ...line, dateText: view.dateText(line.firstShippedAt) })) } });
    } catch (error) { if (sequence === this.detailSequence && api.currentUser()?.id === actor) this.setData({ error: error.message }); }
    finally { if (sequence === this.detailSequence && api.currentUser()?.id === actor) this.setData({ detailing: false }); }
  },
  backToList() { if (!this.busy()) { this.detailSequence = (this.detailSequence || 0) + 1; this.setData({ selected: null, detailing: false, error: '' }); } },
  async submitDecision(event) {
    const action = event.currentTarget.dataset.action, item = this.data.selected;
    if (this.busy() || !this.data.canConfirm || this.data.selectedKind !== 'order' || item?.status !== 'PENDING_PROCUREMENT' || this.data.pendingCommand || this.data.blockedCommand || !['confirm', 'reject'].includes(action)) return;
    const actor = this.data.user.id, sequence = this.sequence;
    this.setData({ saving: true, error: '' });
    try {
      const decision = await new Promise(resolve => wx.showModal({ title: action === 'confirm' ? '确认并推送订货' : '取消订货申请',
        content: action === 'confirm' ? `${item.title} · ${item.requestNo}` : '', editable: action === 'reject', placeholderText: '填写取消原因',
        success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!decision.confirm || !this.active(sequence, actor)) return;
      const reason = String(decision.content || '').trim();
      if (action === 'reject' && !reason) throw new Error('请填写取消原因');
      await api.roleCommand('purchaser', `/purchase-requests/${item.id}/${action}`, { data: { expectedVersion: item.version, ...(reason ? { reason } : {}) }, header: { 'idempotency-key': `mini-follower-${action}-${Date.now()}` } });
      if (!this.active(sequence, actor)) return;
      this.setData({ selected: null });
      wx.showToast({ title: action === 'confirm' ? '已确认订货' : '已取消订货', icon: 'success' });
    } catch (error) { if (this.active(sequence, actor)) this.setData({ error: error.message }); }
    finally { this.setData({ saving: false }); if (this.active(sequence, actor)) this.syncCommand(); }
    if (this.active(sequence, actor) && !this.data.error) return this.loadWork();
  },
  async recoverCommand() {
    if (this.busy() || !this.data.canConfirm || !this.data.pendingCommand) return;
    const actor = this.data.user.id, sequence = this.sequence;
    this.setData({ saving: true, error: '' });
    try {
      await api.retryRoleCommand('purchaser');
      if (this.active(sequence, actor)) this.setData({ selected: null });
    } catch (error) { if (this.active(sequence, actor)) this.setData({ error: error.message }); }
    finally { this.setData({ saving: false }); if (this.active(sequence, actor)) this.syncCommand(); }
    if (this.active(sequence, actor) && !this.data.error) return this.loadWork();
  },
  logout() { if (!this.busy()) { this.invalidate(); api.logout(); wx.redirectTo({ url: '/pages/login/index' }); } }
});
