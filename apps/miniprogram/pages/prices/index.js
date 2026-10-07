const api = require('../../utils/api');
const view = require('../../utils/store-view');

function localDate(value) {
  const date = new Date(value);
  const pad = part => String(part).padStart(2, '0');
  return { effectiveDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, effectiveTime: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}
function impactSignature(impact) {
  return JSON.stringify([impact.scopeId, impact.effectiveAt, impact.affectedOrderCount, impact.salesDelta, impact.supplyDelta,
    impact.orders.map(order => [order.supplierOrderId, order.salesDelta, order.supplyDelta]).sort((a, b) => a[0].localeCompare(b[0]))]);
}
Page({
  data: { templates: [], templateChoices: [{ id: '', name: '共享价格' }], templateIndex: 0, products: [], productChoices: [], productIndex: -1,
    suppliers: [], supplierChoices: [], supplierIndex: -1, template: null, salesPrice: '', supplyPrice: '', effectiveDate: '', effectiveTime: '', reason: '',
    loading: false, quoting: false, previewing: false, publishing: false, recovering: false, processing: false, allowed: false,
    impact: null, approvedBody: '', versions: [], published: null, run: null, runUncertain: false, pendingCommand: null, pendingRun: false,
    submissions: [], submissionsLoading: false, submissionsError: '', submissionsRunId: '', error: '', notice: '' },
  onShow() {
    this.sequence = (this.sequence || 0) + 1;
    this.quoteSequence = (this.quoteSequence || 0) + 1;
    const user = api.currentUser();
    if (!user) { wx.redirectTo({ url: '/pages/login/index' }); return; }
    const allowed = user.roles.some(role => ['ADMIN', 'PURCHASER'].includes(role));
    this.actorId = user.id;
    this.setData({ allowed, loading: false, quoting: false, previewing: false, publishing: false, recovering: false, processing: false, pendingCommand: null,
      ...localDate(new Date()), products: [], productChoices: [], suppliers: [], supplierChoices: [], template: null,
      templateIndex: 0, productIndex: -1, supplierIndex: -1, salesPrice: '', supplyPrice: '', reason: '', impact: null, approvedBody: '', versions: [],
      published: null, run: null, runUncertain: false, submissions: [], submissionsLoading: false, submissionsError: '', submissionsRunId: '',
      error: allowed ? '' : '当前账号无改价权限', notice: '' });
    if (!allowed) return;
    this.syncCommands(); this.loadChoices();
  },
  onHide() { this.sequence = (this.sequence || 0) + 1; this.quoteSequence = (this.quoteSequence || 0) + 1; this.submissionsSequence = (this.submissionsSequence || 0) + 1; },
  onUnload() { this.onHide(); },
  active(sequence) { return this.data.allowed && (api.currentUser() || {}).id === this.actorId && (sequence === undefined || sequence === this.sequence); },
  busy() { return !this.data.allowed || this.data.loading || this.data.quoting || this.data.previewing || this.data.publishing || this.data.recovering || this.data.processing || this.data.runUncertain || !!this.data.pendingCommand; },
  invalidate() { this.setData({ impact: null, approvedBody: '', error: '', notice: '' }); },
  syncCommands() {
    const state = api.roleCommandState('purchaser');
    this.setData({ pendingCommand: state.pending, pendingRun: !!state.pending && /^\/jobs\/[^/]+\/process$/.test(state.pending.path) });
    const latest = state.history.find(item => item.path === '/price-changes' && item.status === 'SUCCEEDED' && item.result);
    if (latest) this.setData({ published: latest.result });
  },
  async loadChoices() {
    if (!this.active() || this.data.loading) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const [products, suppliers, templates] = await Promise.all([api.request('/products'), api.request('/suppliers'), api.request('/templates')]);
      if (!this.active(sequence)) return;
      this.setData({ products: products.filter(item => item.isActive), suppliers: suppliers.filter(item => item.status === 'ACTIVE' && !item.isArchived),
        templates: templates.filter(item => !item.isArchived), templateChoices: [{ id: '', name: '共享价格' }, ...templates.filter(item => !item.isArchived)] });
      this.refreshProducts();
      if (this.data.published) await this.loadPublished();
    } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) this.setData({ loading: false }); }
  },
  refreshProducts() {
    const template = this.data.template;
    this.setData({ productChoices: this.data.products.filter(product => !template || template.items.some(item => item.productId === product.id && item.isEnabled)),
      productIndex: -1, supplierChoices: [], supplierIndex: -1, salesPrice: '', supplyPrice: '', versions: [] });
  },
  async chooseTemplate(event) {
    if (this.busy()) return;
    const index = Number(event.detail.value), choice = this.data.templateChoices[index];
    if (!choice) return;
    this.invalidate(); this.setData({ templateIndex: index, quoting: true });
    const sequence = this.quoteSequence = (this.quoteSequence || 0) + 1;
    try {
      const template = choice.id ? await api.request(`/templates/${choice.id}`) : null;
      if (!this.active() || sequence !== this.quoteSequence) return;
      this.setData({ template }); this.refreshProducts();
    } catch (error) { if (this.active() && sequence === this.quoteSequence) { this.setData({ templateIndex: 0, template: null, error: error.message }); this.refreshProducts(); } }
    finally { if (this.active() && sequence === this.quoteSequence) this.setData({ quoting: false }); }
  },
  async chooseProduct(event) {
    if (this.busy()) return;
    const index = Number(event.detail.value), product = this.data.productChoices[index];
    if (!product) return;
    this.invalidate();
    this.setData({ productIndex: index, supplierIndex: -1, supplierChoices: [], salesPrice: '', supplyPrice: '', versions: [], quoting: true });
    const sequence = this.quoteSequence = (this.quoteSequence || 0) + 1;
    try {
      const relations = await Promise.all(this.data.suppliers.map(supplier => api.request(`/suppliers/${supplier.id}/products`)));
      if (!this.active() || sequence !== this.quoteSequence) return;
      const item = this.data.template && this.data.template.items.find(item => item.productId === product.id && item.isEnabled);
      this.setData({ supplierChoices: this.data.suppliers.filter(supplier => relations.some(relation => relation.supplierId === supplier.id && relation.productIds.includes(product.id))
        && (!this.data.template || item.suppliers.some(link => link.supplierId === supplier.id))) });
    } catch (error) { if (this.active() && sequence === this.quoteSequence) this.setData({ error: error.message }); }
    finally { if (this.active() && sequence === this.quoteSequence) this.setData({ quoting: false }); }
  },
  async chooseSupplier(event) {
    if (this.busy()) return;
    const index = Number(event.detail.value);
    if (!this.data.supplierChoices[index]) return;
    this.invalidate(); this.setData({ supplierIndex: index, salesPrice: '', supplyPrice: '', versions: [] });
    await this.loadQuote();
  },
  async changeTimestamp(event) {
    if (this.busy()) return;
    const field = event.currentTarget.dataset.field;
    if (!['effectiveDate', 'effectiveTime'].includes(field)) return;
    this.invalidate(); this.setData({ [field]: event.detail.value });
    if (this.data.supplierIndex >= 0) { this.setData({ salesPrice: '', supplyPrice: '' }); await this.loadQuote(); }
  },
  onInput(event) {
    if (this.busy()) return;
    const field = event.currentTarget.dataset.field;
    if (!['salesPrice', 'supplyPrice', 'reason'].includes(field) || field === 'supplyPrice' && this.data.template) return;
    this.invalidate(); this.setData({ [field]: event.detail.value });
  },
  inputBody(requirePrices = true) {
    const product = this.data.productChoices[this.data.productIndex], supplier = this.data.supplierChoices[this.data.supplierIndex];
    if (!product || !supplier) throw new Error('请选择商品和有效供应商');
    const effective = new Date(`${this.data.effectiveDate}T${this.data.effectiveTime}:00`);
    if (Number.isNaN(effective.getTime())) throw new Error('请选择有效生效时间');
    const body = { productId: product.id, supplierId: supplier.id, effectiveAt: effective.toISOString(), ...(this.data.template ? { templateId: this.data.template.id } : {}) };
    if (!requirePrices) return body;
    for (const field of ['salesPrice', 'supplyPrice']) if (!/^\d+(\.\d{1,6})?$/.test(this.data[field].trim())) throw new Error('单价须为非负数字，最多六位小数');
    const reason = this.data.reason.trim();
    if (!reason || reason.length > 500) throw new Error('请填写500字以内的改价原因');
    return { ...body, salesPrice: this.data.salesPrice.trim(), supplyPrice: this.data.supplyPrice.trim(), reason };
  },
  async loadQuote() {
    const sequence = this.quoteSequence = (this.quoteSequence || 0) + 1;
    this.setData({ quoting: true });
    try {
      const quote = await api.request('/prices/quote', { method: 'POST', data: this.inputBody(false) }).catch(error => {
        if (error.code === 'PRICE_VERSION_NOT_FOUND') return null;
        throw error;
      });
      if (!this.active() || sequence !== this.quoteSequence) return;
      const product = this.data.productChoices[this.data.productIndex];
      const item = this.data.template && this.data.template.items.find(item => item.productId === product.id);
      this.setData({ salesPrice: quote && quote.templateId ? quote.salesPrice : item ? String(item.initialSalesPrice) : quote ? quote.salesPrice : String(product.defaultSalesPrice),
        supplyPrice: quote ? quote.supplyPrice : '', versions: [] });
      if (quote) {
        const versions = await api.request(`/price-scopes/${quote.scopeId}/versions`);
        if (this.active() && sequence === this.quoteSequence) this.setData({ versions: versions.map(item => ({ ...item, effectiveText: view.dateText(item.effectiveAt) })) });
      }
    } catch (error) { if (this.active() && sequence === this.quoteSequence) this.setData({ error: error.message }); }
    finally { if (this.active() && sequence === this.quoteSequence) this.setData({ quoting: false }); }
  },
  async previewPrice() {
    if (this.busy()) return;
    const sequence = this.sequence;
    this.setData({ previewing: true, error: '', approvedBody: '', impact: null });
    try {
      const body = this.inputBody();
      const impact = await api.request('/prices/impact-preview', { method: 'POST', data: body });
      if (this.active(sequence)) this.setData({ impact, approvedBody: JSON.stringify(body) });
    } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) this.setData({ previewing: false }); }
  },
  async publishPrice() {
    if (this.busy() || !this.data.approvedBody || !this.data.impact) return;
    const sequence = this.sequence;
    this.setData({ publishing: true, error: '', notice: '' });
    try {
      const body = this.inputBody();
      if (JSON.stringify(body) !== this.data.approvedBody) throw new Error('改价内容已改变，请重新预览');
      const fresh = await api.request('/prices/impact-preview', { method: 'POST', data: body });
      if (!this.active(sequence)) return;
      if (impactSignature(fresh) !== impactSignature(this.data.impact)) {
        this.setData({ impact: fresh, approvedBody: JSON.stringify(body), error: '影响订单已变化，请核对后再次确认发布' }); return;
      }
      const published = await api.roleCommand('purchaser', '/price-changes', { method: 'POST', data: body, header: { 'idempotency-key': `mini-price-${Date.now()}` } });
      if (!this.active(sequence)) return;
      this.setData({ published, impact: null, approvedBody: '', notice: '价格已发布', run: null });
      await this.loadPublished();
    } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) { this.syncCommands(); this.setData({ publishing: false }); } }
  },
  async recoverPrice() {
    const sequence = this.sequence;
    if (!this.active() || this.data.recovering || this.data.publishing || this.data.processing || !this.data.pendingCommand || this.data.pendingCommand.path !== '/price-changes') return;
    this.setData({ recovering: true, error: '' });
    try {
      const published = await api.retryRoleCommand('purchaser');
      if (!this.active(sequence)) return;
      this.setData({ published, impact: null, approvedBody: '', notice: '原价格发布结果已确认', run: null }); await this.loadPublished();
    } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) { this.syncCommands(); this.setData({ recovering: false }); } }
  },
  async recoverRun() {
    const sequence = this.sequence;
    if (!this.active() || this.data.recovering || this.data.publishing || this.data.processing || !this.data.pendingCommand || !/^\/jobs\/[^/]+\/process$/.test(this.data.pendingCommand.path)) return;
    this.setData({ recovering: true, error: '' });
    try {
      const run = await api.retryRoleCommand('purchaser');
      if (this.active(sequence)) { this.setData({ run, runUncertain: false, notice: '原重算结果已确认' }); await this.loadSubmissions(); }
    } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) { this.syncCommands(); this.setData({ recovering: false }); } }
  },
  async loadPublished() {
    const sequence = this.sequence;
    const quote = this.data.published;
    if (!quote) return;
    const [versions, run] = await Promise.all([api.request(`/price-scopes/${quote.scopeId}/versions`), quote.runId ? api.request(`/jobs/${quote.runId}`) : null]);
    if (this.active(sequence) && this.data.published && this.data.published.versionId === quote.versionId) {
      this.setData({ versions: versions.map(item => ({ ...item, effectiveText: view.dateText(item.effectiveAt) })), run, runUncertain: false });
      await this.loadSubmissions();
    }
  },
  async loadSubmissions() {
    const runId = this.data.run && this.data.run.id;
    if (!this.active() || !runId) return;
    const sequence = this.sequence, generation = this.submissionsSequence = (this.submissionsSequence || 0) + 1;
    const current = () => this.active(sequence) && generation === this.submissionsSequence && this.data.run && this.data.run.id === runId;
    this.setData({ submissionsLoading: true, submissionsError: '',
      ...(this.data.submissionsRunId !== runId ? { submissionsRunId: runId, submissions: [] } : {}) });
    try {
      const records = await api.request(`/jobs/${runId}/submissions`);
      if (!current()) return;
      if (!Array.isArray(records)) throw new Error('重算记录加载失败');
      const errors = { COMMAND_ROLLBACK_CONFIRMED: '已回滚，待管理员核验', COMMAND_ROLLED_BACK: '已回滚',
        COMMAND_NOT_COMMITTED: '未提交，已核验',
        COMMAND_OUTCOME_UNKNOWN: '结果待核验', CREDIT_LIMIT_EXCEEDED: '挂账额度不足', PRICE_CHANGE_RUN_ALREADY_PROCESSED: '任务已经处理' };
      this.setData({ submissions: records.map(item => ({ id: item.id, status: item.status, startedText: view.dateText(item.startedAt),
        errorText: item.errorCode ? errors[item.errorCode] || '业务校验未通过' : '' })) });
    } catch (error) { if (current()) this.setData({ submissionsError: error.message }); }
    finally { if (current()) this.setData({ submissionsLoading: false }); }
  },
  async refreshRun() {
    const sequence = this.sequence;
    if (!this.active() || this.data.processing || this.data.recovering || this.data.publishing) return;
    this.setData({ processing: true, error: '' });
    try { await this.loadPublished(); } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) this.setData({ processing: false }); }
  },
  async processRun() {
    const sequence = this.sequence;
    if (this.busy() || !this.data.run || this.data.run.status !== 'PENDING') return;
    this.setData({ processing: true, error: '' });
    try {
      const run = await api.roleCommand('purchaser', `/jobs/${this.data.run.id}/process`, {
        method: 'POST', data: {}, header: { 'idempotency-key': `mini-price-run-${Date.now()}` } });
      if (this.active(sequence)) this.setData({ run });
    } catch (error) { if (this.active(sequence)) this.setData({ error: error.message }); }
    finally { if (this.active(sequence)) { this.syncCommands(); await this.loadSubmissions(); if (this.active(sequence)) this.setData({ processing: false }); } }
  }
});
