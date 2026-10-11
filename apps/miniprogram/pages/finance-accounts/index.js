const api = require('../../utils/api');
const view = require('../../utils/store-view');

Page({
  data: { user: {}, loading: false, submitting: false, uploading: false, error: '', stores: [], visibleStores: [], search: '',
    store: null, account: null, credits: [], visibleCredits: [], suppliers: ['全部供应商'], supplierIndex: 0,
    from: '', to: '', chosen: [], history: [], document: null, mode: '', preview: null, confirming: false,
    amount: '', reason: '', remark: '', businessDate: '', collectionAccounts: [], collectionIndex: -1, evidenceFiles: [], pendingCommand: null },
  onShow() {
    const user = api.openWorkspace('finance');
    if (!user || !(user.roles || []).some(role => ['HQ_FINANCE', 'ADMIN'].includes(role))) return;
    this.setData({ user, store: null, account: null, mode: '', document: null, confirming: false, evidenceFiles: [], submitting: false, uploading: false });
    this.syncCommand(); return this.loadWork();
  },
  onHide() { this.sequence = (this.sequence || 0) + 1; },
  onUnload() { this.onHide(); },
  valid(sequence, actor) { return sequence === this.sequence && api.currentUser()?.id === actor; },
  busy() { return this.data.submitting || this.data.uploading; },
  writable() { return (this.data.user.roles || []).some(role => ['HQ_FINANCE', 'ADMIN'].includes(role)); },
  syncCommand() { this.setData({ pendingCommand: api.roleCommandState('finance').pending }); },
  onSearch(event) {
    this.setData({ search: event.detail.value });
    this.setData({ visibleStores: this.data.stores.filter(row => row.name.includes(this.data.search.trim())) });
  },
  async loadWork() {
    if (this.busy() || this.data.mode || !this.writable()) return;
    const sequence = this.sequence = (this.sequence || 0) + 1, actor = this.data.user.id;
    this.setData({ loading: true, error: '' });
    try {
      const [stores, accounts] = await Promise.all([api.request('/stores/finance-overview'), api.request('/collection-accounts')]);
      if (!this.valid(sequence, actor)) return;
      this.setData({ stores, collectionAccounts: accounts.filter(row => row.status === 'ACTIVE') });
      this.onSearch({ detail: { value: this.data.search } });
      if (this.data.store) await this.loadAccount(this.data.store, sequence, actor);
    } catch (error) { if (this.valid(sequence, actor)) this.setData({ error: error.message }); }
    finally { if (this.valid(sequence, actor)) this.setData({ loading: false }); }
  },
  async openStore(event) {
    if (this.busy() || this.data.loading) return;
    const store = this.data.stores.find(row => row.id === event.currentTarget.dataset.id);
    if (!store) return;
    const sequence = this.sequence = (this.sequence || 0) + 1, actor = this.data.user.id;
    this.setData({ store, account: null, document: null, mode: '', confirming: false, chosen: [], from: '', to: '', supplierIndex: 0, loading: true, error: '' });
    try { await this.loadAccount(store, sequence, actor); }
    catch (error) { if (this.valid(sequence, actor)) this.setData({ error: error.message }); }
    finally { if (this.valid(sequence, actor)) this.setData({ loading: false }); }
  },
  async loadAccount(store, sequence, actor) {
    const base = `/stores/${encodeURIComponent(store.id)}`;
    const [account, credits, ledgers, movements] = await Promise.all([
      api.request(`${base}/account`), api.request(`${base}/credit-items`), api.request(`${base}/ledgers`), api.request(`${base}/credit-movements`)
    ]);
    if (!this.valid(sequence, actor)) return;
    const history = ledgers.filter(row => row.sourceType === 'RECHARGE').map(row => ({ id: row.sourceId, kind: 'recharges', title: '充值', amount: row.amount, dateText: view.dateText(row.occurredAt) }));
    const clearings = new Map();
    for (const row of movements.filter(row => row.sourceType === 'CLEARING')) {
      const previous = clearings.get(row.sourceId);
      clearings.set(row.sourceId, { id: row.sourceId, kind: 'clearings', title: '销账', amount: ((previous ? Math.round(Number(previous.amount) * 100) : 0) + Math.round(Number(row.amount) * 100)) / 100, dateText: view.dateText(row.occurredAt) });
    }
    this.setData({ account, credits: credits.map(row => ({ ...row, dateText: view.dateText(row.occurredAt), date: view.dateText(row.occurredAt, false) })),
      suppliers: ['全部供应商', ...new Set(credits.map(row => row.supplierName).filter(Boolean))], history: [...history, ...clearings.values()].sort((a, b) => b.dateText.localeCompare(a.dateText)), chosen: [], preview: null, supplierIndex: 0 });
    this.setData({ stores: this.data.stores.map(row => row.id === store.id ? { ...row, account } : row) });
    this.onSearch({ detail: { value: this.data.search } });
    this.filterCredits();
  },
  back() {
    if (this.busy()) return;
    this.onHide(); this.setData({ store: null, account: null, mode: '', document: null, loading: false, error: '', confirming: false });
  },
  startAction(event) {
    if (this.busy() || this.data.loading || this.data.pendingCommand || !this.data.account || !this.writable()) return;
    const mode = event.currentTarget.dataset.mode;
    if (!['recharge', 'credit', 'clearing'].includes(mode)) return;
    this.setData({ mode, amount: mode === 'credit' ? this.data.account.creditLimit : '', reason: '', remark: '',
      businessDate: view.dateText(new Date().toISOString(), false), collectionIndex: -1, evidenceFiles: [], chosen: [], preview: null, confirming: false, error: '' });
    this.filterCredits();
  },
  cancelAction() { if (!this.busy()) this.setData({ mode: '', confirming: false, preview: null, error: '' }); },
  editForm() { if (!this.busy()) this.setData({ confirming: false }); },
  onField(event) {
    if (this.busy() || this.data.confirming) return;
    const field = event.currentTarget.dataset.field;
    if (['amount', 'reason', 'remark', 'businessDate'].includes(field)) this.setData({ [field]: event.detail.value });
  },
  chooseCollection(event) { if (!this.busy() && !this.data.confirming) this.setData({ collectionIndex: Number(event.detail.value) }); },
  onFilter(event) {
    if (this.busy() || this.data.confirming) return;
    const field = event.currentTarget.dataset.field;
    if (['from', 'to', 'supplierIndex'].includes(field)) this.setData({ [field]: field === 'supplierIndex' ? Number(event.detail.value) : event.detail.value, chosen: [], preview: null });
    this.filterCredits();
  },
  filterCredits() {
    const { from, to, supplierIndex, suppliers, chosen } = this.data;
    this.setData({ visibleCredits: this.data.credits.filter(row => (!from || row.date >= from) && (!to || row.date <= to) && (!supplierIndex || row.supplierName === suppliers[supplierIndex]))
      .map(row => ({ ...row, checked: chosen.includes(row.fundingAllocationId) })) });
  },
  chooseCredits(event) {
    if (this.busy() || this.data.confirming) return;
    const allowed = new Set(this.data.visibleCredits.map(row => row.fundingAllocationId));
    this.setData({ chosen: [...new Set(event.detail.value)].filter(id => allowed.has(id)), preview: null }); this.filterCredits();
  },
  selectAll() {
    if (this.busy() || this.data.confirming) return;
    this.setData({ chosen: this.data.chosen.length === this.data.visibleCredits.length ? [] : this.data.visibleCredits.map(row => row.fundingAllocationId), preview: null }); this.filterCredits();
  },
  async addEvidence() {
    if (this.busy() || this.data.confirming || this.data.pendingCommand || !['recharge', 'clearing'].includes(this.data.mode) || this.data.evidenceFiles.length >= 5) return;
    const sequence = this.sequence, actor = this.data.user.id, purpose = this.data.mode === 'recharge' ? 'RECHARGE' : 'CLEARING';
    this.setData({ uploading: true, error: '' });
    try {
      const files = await api.chooseEvidence(5 - this.data.evidenceFiles.length);
      for (const file of files) {
        if (!this.valid(sequence, actor)) return;
        const uploaded = await api.uploadEvidence(file.path, purpose);
        if (!this.valid(sequence, actor)) return;
        this.setData({ evidenceFiles: [...this.data.evidenceFiles, uploaded] });
      }
    } catch (error) { if (this.valid(sequence, actor)) this.setData({ error: error.message }); }
    finally { if (this.valid(sequence, actor)) this.setData({ uploading: false }); }
  },
  removeEvidence(event) { if (!this.busy() && !this.data.confirming) this.setData({ evidenceFiles: this.data.evidenceFiles.filter(file => file.id !== event.currentTarget.dataset.id) }); },
  async prepare() {
    if (this.busy() || this.data.loading || this.data.pendingCommand || !this.data.store || !this.data.account || !this.data.mode || !this.writable()) return;
    const { mode, amount, reason, businessDate, collectionIndex, collectionAccounts, chosen, from, to } = this.data;
    const fail = error => this.setData({ error });
    if (mode === 'credit') {
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || !reason.trim()) return fail('请填写有效额度和调整原因');
      if (Number(amount) < Number(this.data.account.creditUsed)) return fail('额度不能低于挂账未销账金额');
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return fail('请选择业务日期');
      if (!this.data.evidenceFiles.length) return fail('请上传图片凭证');
      if (mode === 'recharge' && (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !collectionAccounts[collectionIndex])) return fail('请填写有效充值金额并选择收款账户');
      if (mode === 'clearing' && (!chosen.length || (from && to && from > to))) return fail('请选择未销账订单并核对日期范围');
    }
    const sequence = this.sequence, actor = this.data.user.id;
    this.setData({ submitting: true, error: '' });
    try {
      if (mode === 'clearing') {
        const preview = await api.request(`/stores/${this.data.store.id}/clearings/preview`, { method: 'POST', data: { fundingAllocationIds: chosen } });
        if (!this.valid(sequence, actor)) return;
        this.setData({ preview });
      }
      if (this.valid(sequence, actor)) this.setData({ confirming: true });
    } catch (error) { if (this.valid(sequence, actor)) fail(error.message); }
    finally { if (this.valid(sequence, actor)) this.setData({ submitting: false }); }
  },
  async submit() {
    if (this.busy() || !this.data.confirming || this.data.pendingCommand || !this.writable()) return;
    const { store, mode, account, amount, reason, remark, businessDate, collectionAccounts, collectionIndex, evidenceFiles, preview } = this.data;
    if (!store || !account || !['credit', 'recharge', 'clearing'].includes(mode) || (mode === 'clearing' && !preview?.items?.length)) return;
    const [whole, fraction = ''] = amount.split('.'), amountText = `${whole}.${fraction.padEnd(2, '0')}`;
    const data = mode === 'credit' ? { expectedVersion: account.version, limit: amountText, reason: reason.trim() }
      : { businessDate, remark: remark.trim(), evidenceFileIds: evidenceFiles.map(file => file.id), ...(mode === 'recharge'
        ? { amount: amountText, collectionAccountId: collectionAccounts[collectionIndex].id }
        : { items: preview.items.map(item => ({ fundingAllocationId: item.fundingAllocationId, expectedVersion: item.version, expectedAmount: item.clearableAmount })) }) };
    const sequence = this.sequence, actor = this.data.user.id;
    this.setData({ submitting: true, error: '' });
    try {
      await api.roleCommand('finance', `/stores/${store.id}/${mode === 'credit' ? 'credit-limit' : mode === 'recharge' ? 'recharges' : 'clearings'}`, {
        method: mode === 'credit' ? 'PATCH' : 'POST', data, header: { 'idempotency-key': `mini-account-${mode}-${Date.now()}` }
      });
      if (!this.valid(sequence, actor)) return;
      this.setData({ mode: '', confirming: false, evidenceFiles: [] });
      await this.loadAccount(store, sequence, actor); wx.showToast({ title: '操作成功', icon: 'success' });
    } catch (error) { if (this.valid(sequence, actor)) this.setData({ error: error.message, confirming: false }); }
    finally { if (this.valid(sequence, actor)) { this.setData({ submitting: false }); this.syncCommand(); } }
  },
  async recoverCommand() {
    if (this.busy() || !this.writable() || !this.data.pendingCommand) return;
    const sequence = this.sequence, actor = this.data.user.id;
    this.setData({ submitting: true, error: '' });
    try {
      await api.retryRoleCommand('finance');
      if (this.valid(sequence, actor)) this.setData({ mode: '', confirming: false, evidenceFiles: [] });
    } catch (error) { if (this.valid(sequence, actor)) this.setData({ error: error.message }); }
    finally { if (this.valid(sequence, actor)) { this.setData({ submitting: false }); this.syncCommand(); await this.loadWork(); } }
  },
  async openDocument(event) {
    if (this.busy() || this.data.loading) return;
    const row = this.data.history.find(item => item.id === event.currentTarget.dataset.id && item.kind === event.currentTarget.dataset.kind);
    if (!row) return;
    const sequence = this.sequence = (this.sequence || 0) + 1, actor = this.data.user.id;
    this.setData({ loading: true, error: '' });
    try {
      const document = await api.request(`/stores/${this.data.store.id}/${row.kind}/${row.id}`);
      if (this.valid(sequence, actor)) this.setData({ document: { ...document, title: row.title } });
    } catch (error) { if (this.valid(sequence, actor)) this.setData({ error: error.message }); }
    finally { if (this.valid(sequence, actor)) this.setData({ loading: false }); }
  },
  closeDocument() { if (!this.busy()) this.setData({ document: null }); }
});
