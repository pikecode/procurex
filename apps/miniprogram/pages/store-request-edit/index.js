const api = require('../../utils/api');
const view = require('../../utils/store-view');

Page({
  data: { detail: null, rows: [], visibleRows: [], search: '', total: '0.00', count: 0, loading: false, submitting: false, error: '', pending: null, editable: false },
  onLoad(options) { this.id = options.id; },
  onShow() {
    const user = api.currentUser();
    if (!user || !user.roles.includes('STORE') || !user.scope?.storeId) { wx.navigateBack(); return; }
    this.userId = user.id; this.storeId = user.scope.storeId;
    this.storageKey = `procurex-request-edit-${user.id}-${this.storeId}-${this.id}`;
    this.setData({ pending: wx.getStorageSync(this.storageKey) || null });
    return this.load();
  },
  async load() {
    if (this.data.submitting) return;
    this.setData({ loading: true, error: '' });
    try {
      const [detail, catalog] = await Promise.all([api.request(`/purchase-requests/${this.id}`), api.request(`/stores/${this.storeId}/catalog`)]);
      if (api.currentUser()?.id !== this.userId) return;
      const editable = !detail.procurementConfirmedAt && ['PENDING_PROCUREMENT', 'PENDING_FUNDS'].includes(detail.status) && !detail.supplierOrders.length && catalog.templateId === detail.templateId;
      const rows = catalog.items.map(item => {
        const old = detail.items.find(row => row.productId === item.product.id);
        return { ...item.product, quantity: old ? view.decimalText(old.quantity) : '0', salesPrice: item.suppliers[0]?.salesPrice,
          available: item.product.isActive && item.suppliers[0]?.salesPrice != null, imageUrl: '' };
      });
      for (const old of detail.items) if (!rows.some(row => row.id === old.productId)) rows.unshift({ id: old.productId, name: old.productName, quantity: view.decimalText(old.quantity), unitName: old.unitName, salesPrice: old.salesUnitPrice, available: false });
      this.setData({ detail, editable, rows, error: editable ? '' : '采购已确认或模板已变更，不能修改该下货单' });
      this.refresh();
      for (const row of rows.filter(item => item.imageFile?.id)) {
        try {
          const imageUrl = await api.imagePath(row.imageFile);
          if (api.currentUser()?.id !== this.userId) return;
          this.setData({ rows: this.data.rows.map(item => item.id === row.id ? { ...item, imageUrl } : item) }); this.refresh();
        } catch (_) { /* Image failure does not block editing. */ }
      }
    } catch (error) { this.setData({ error: error.message, editable: false }); }
    finally { this.setData({ loading: false }); }
  },
  onSearch(event) { this.setData({ search: event.detail.value }); this.refresh(); },
  refresh() {
    const chosen = this.data.rows.filter(row => Number(row.quantity) > 0);
    this.setData({ visibleRows: this.data.rows.filter(row => row.name.includes(this.data.search.trim())), count: chosen.length,
      total: chosen.reduce((sum, row) => sum + (Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0) * Number(row.salesPrice || 0), 0).toFixed(2) });
  },
  changeQuantity(event) {
    if (!this.data.editable || this.data.submitting || this.data.pending) return;
    this.setData({ rows: this.data.rows.map(row => row.id === event.currentTarget.dataset.id ? { ...row, quantity: event.detail.value } : row) }); this.refresh();
  },
  removeItem(event) { this.changeQuantity({ currentTarget: event.currentTarget, detail: { value: '0' } }); },
  async save() {
    if (!this.data.editable || this.data.submitting || this.data.pending) return;
    const selected = this.data.rows.filter(row => Number(row.quantity) > 0);
    if (!selected.length) { this.setData({ error: '请至少保留一种商品' }); return; }
    if (this.data.rows.some(row => !/^\d+(\.\d+)?$/.test(String(row.quantity)) || Number(row.quantity) < 0) || selected.some(row => !row.available)) {
      this.setData({ error: '请填写有效数量，并移除已不可订的商品' }); return;
    }
    const result = await new Promise(resolve => wx.showModal({ title: '保存下货单修改', content: `${selected.length}种商品，金额以保存时模板销售价格为准。`, success: resolve, fail: () => resolve({}) }));
    if (!result.confirm || this.data.submitting || this.data.pending) return;
    const pending = { key: `request-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`, body: {
      expectedVersion: this.data.detail.version, expectedTemplateId: this.data.detail.templateId,
      items: selected.map(row => ({ productId: row.id, quantity: row.quantity, expectedProductVersion: row.version })) } };
    wx.setStorageSync(this.storageKey, pending); this.setData({ pending });
    return this.submitPending();
  },
  async submitPending() {
    if (this.data.submitting || !this.data.pending) return;
    this.setData({ submitting: true, error: '' });
    try {
      await api.request(`/purchase-requests/${this.id}/store-items`, { method: 'PATCH', data: this.data.pending.body, header: { 'idempotency-key': this.data.pending.key } });
      wx.removeStorageSync(this.storageKey); this.setData({ pending: null });
      wx.showToast({ title: '已保存修改', icon: 'success' }); wx.navigateBack();
    } catch (error) {
      if (!error.uncertain && ![401, 403].includes(error.status) && error.code !== 'IDEMPOTENCY_KEY_REUSED') { wx.removeStorageSync(this.storageKey); this.setData({ pending: null }); }
      this.setData({ error: ['VERSION_CONFLICT', 'PURCHASE_REQUEST_ITEMS_NOT_EDITABLE'].includes(error.code) ? '下货单已更新或采购已确认，请刷新后查看' : error.message });
    } finally { this.setData({ submitting: false }); }
  }
});
