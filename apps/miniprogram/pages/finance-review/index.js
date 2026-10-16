const api = require('../../utils/api');
const view = require('../../utils/store-view');
const modes = { STORED_VALUE: '储值', CREDIT: '挂账', SUPPLIER_TERM: '供应商账期', COMPANY_TERM: '公司账期' };
const cycles = { IMMEDIATE: '现结', WEEKLY: '周结', SEMIMONTHLY: '半月结', HALF_MONTHLY: '半月结', MONTHLY: '月结' };

Page({
  data: { rows: [], visibleRows: [], search: '', loading: false, detailLoading: false, error: '', selected: null,
    reviewing: false, returning: false, reason: '', pendingCommand: null },
  onShow() {
    wx.redirectTo({ url: '/pages/profile/index' }); return;
    const user = api.currentUser();
    if (!user || !(user.roles || []).some(role => ['ADMIN', 'HQ_FINANCE', 'REGION_FINANCE'].includes(role))) {
      wx.navigateBack(); return;
    }
    if (this.userId !== user.id) this.setData({ selected: null, rows: [], visibleRows: [], search: '' });
    this.userId = user.id;
    this.setData({ canManageAccounts: user.roles.some(role => ['ADMIN', 'HQ_FINANCE'].includes(role)) });
    this.syncCommand();
    return this.loadWork();
  },
  onHide() { this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; },
  onUnload() { this.onHide(); },
  syncCommand() { this.setData({ pendingCommand: api.roleCommandState('finance').pending }); },
  async loadWork() {
    if (this.data.reviewing) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const [rows, stores] = await Promise.all([api.request('/purchase-requests?status=PENDING_FINANCE'), api.request('/stores')]);
      if (sequence !== this.sequence) return;
      this.storeNames = Object.fromEntries(stores.map(store => [store.id, store.name]));
      this.setData({ rows: rows.map(row => ({ ...row, storeName: this.storeNames[row.storeId] || '门店', dateText: view.dateText(row.procurementConfirmedAt) })) });
      this.filterRows();
      if (this.data.selected) await this.loadDetail(this.data.selected.id);
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  onSearch(event) { this.setData({ search: event.detail.value }); this.filterRows(); },
  filterRows() {
    const query = this.data.search.trim();
    this.setData({ visibleRows: this.data.rows.filter(row => `${row.storeName} ${row.requestNo}`.includes(query)) });
  },
  openRecord(event) { if (!this.data.reviewing) return this.loadDetail(event.currentTarget.dataset.id); },
  async loadDetail(id) {
    const sequence = this.detailSequence = (this.detailSequence || 0) + 1;
    const userId = this.userId;
    this.setData({ selected: null, detailLoading: true, error: '', returning: false, reason: '' });
    try {
      const detail = await api.request(`/purchase-requests/${id}/finance-review`);
      if (sequence !== this.detailSequence || api.currentUser()?.id !== userId) return;
      this.setData({ selected: { ...detail, storeName: this.storeNames[detail.storeId] || '门店',
        settlementGroups: detail.settlementGroups.map(group => ({ ...group, modeName: modes[group.mode] || group.mode, cycleName: cycles[group.cycle] || group.cycle })),
        items: detail.items.map(item => ({ ...item, quantityText: view.decimalText(item.quantity) })) } });
    } catch (error) { if (sequence === this.detailSequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.detailSequence) this.setData({ detailLoading: false }); }
  },
  backToList() { if (!this.data.reviewing) { this.detailSequence = (this.detailSequence || 0) + 1; this.setData({ selected: null, detailLoading: false, returning: false, error: '' }); } },
  openAccounts() { if (!this.data.reviewing && this.data.canManageAccounts) wx.navigateTo({ url: '/pages/finance-accounts/index' }); },
  startReturn() { if (!this.data.reviewing) this.setData({ returning: true, reason: '' }); },
  cancelReturn() { if (!this.data.reviewing) this.setData({ returning: false, reason: '' }); },
  onReason(event) { this.setData({ reason: event.detail.value }); },
  async decide(event) {
    const action = event.currentTarget.dataset.action, detail = this.data.selected, reason = this.data.reason.trim();
    if (!detail || this.data.reviewing || this.data.pendingCommand || !['approve', 'return'].includes(action)) return;
    if (action === 'return' && !reason) { this.setData({ error: '请填写退回原因' }); return; }
    if (action === 'approve' && !detail.funding.canConfirm) { this.setData({ error: '资金不足，请先补足储值或挂账额度' }); return; }
    const decision = await new Promise(resolve => wx.showModal({ title: action === 'approve' ? '审核通过' : '退回采购',
      content: action === 'approve' ? '通过后将生成供应商订单并进入发货流程。' : reason, success: resolve, fail: () => resolve({ confirm: false }) }));
    if (!decision.confirm || this.data.reviewing) return;
    this.setData({ reviewing: true, error: '' });
    let success = false;
    try {
      await api.roleCommand('finance', `/purchase-requests/${detail.id}/finance-${action}`, { method: 'POST',
        data: { expectedVersion: detail.version, ...(action === 'return' ? { reason } : {}) }, header: { 'idempotency-key': `finance-review-${Date.now()}` } });
      success = true;
      this.setData({ selected: null });
      wx.showToast({ title: action === 'approve' ? '订单已生成' : '已退回采购', icon: 'success' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ reviewing: false }); this.syncCommand(); }
    if (success) await this.loadWork();
  },
  async recoverCommand() {
    if (this.data.reviewing || !this.data.pendingCommand) return;
    this.setData({ reviewing: true, error: '' });
    try { await api.retryRoleCommand('finance'); this.setData({ selected: null }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ reviewing: false }); this.syncCommand(); }
    if (!this.data.error) await this.loadWork();
  }
});
