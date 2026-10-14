const api = require('../../utils/api');
const view = require('../../utils/store-view');

function stage(order) {
  if (order.status === 'REJECTED' || order.status === 'CANCELED') return 'closed';
  if (order.fulfillmentStatus === 'COMPLETED' || order.status === 'COMPLETED') return 'completed';
  return ['PUSHED', 'ACCEPTED', 'DRAFT'].includes(order.status) ? 'pending' : 'receiving';
}

Component({
  properties: {
    active: { type: Boolean, value: false },
    revision: { type: Number, value: 0 },
    mode: { type: String, value: 'store' },
    canReceive: { type: Boolean, value: false },
    canReallocate: { type: Boolean, value: false }
  },
  data: { orders: [], visible: [], selected: null, selectedId: '', loading: false, detailing: false,
    error: '', detailError: '', search: '', filter: 'all', from: '', to: '', dateError: '', limit: 10, total: 0, more: false, showPrices: false },
  observers: {
    'active, revision': function(active) {
      if (!active) { this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; this.setData({ selected: null, selectedId: '', detailing: false }); return; }
      this.load();
    }
  },
  lifetimes: {
    detached() { this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; }
  },
  pageLifetimes: {
    show() {
      if (this.data.active) {
        this.load();
        if (this.data.selectedId) this.open({ currentTarget: { dataset: { id: this.data.selectedId } } });
      }
    },
    hide() { this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; }
  },
  methods: {
    async load() {
      const sequence = this.sequence = (this.sequence || 0) + 1;
      const actor = (api.currentUser() || {}).id;
      if (actor !== this.actor) {
        this.actor = actor;
        this.detailSequence = (this.detailSequence || 0) + 1;
        this.setData({ orders: [], visible: [], selected: null, selectedId: '', search: '', filter: 'all', from: '', to: '', dateError: '', detailError: '', detailing: false, showPrices: false });
      }
      this.setData({ loading: true, error: '' });
      try {
        const orders = await api.request('/supplier-orders');
        if (sequence !== this.sequence || actor !== (api.currentUser() || {}).id || !this.data.active) return;
        this.setData({ orders: orders.map(order => ({ ...order, stage: stage(order), createdText: view.dateText(order.createdAt) })) });
        this.filterRows();
      } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message, orders: [], visible: [], total: 0, more: false }); }
      finally { if (sequence === this.sequence) this.setData({ loading: false }); }
    },
    filterRows(limit = 10) {
      const search = this.data.search.trim().toLowerCase();
      const rows = this.data.orders.filter(order => (this.data.filter === 'all' || order.stage === this.data.filter)
        && (!this.data.from || order.createdText.slice(0, 10) >= this.data.from) && (!this.data.to || order.createdText.slice(0, 10) <= this.data.to)
        && [order.supplierOrderNo, order.requestNo, order.storeName, order.supplierName, order.productSummary].some(value => String(value || '').toLowerCase().includes(search)));
      this.setData({ visible: rows.slice(0, limit), total: rows.length, limit, more: rows.length > limit });
    },
    onSearch(event) { this.setData({ search: event.detail.value }); this.filterRows(); },
    chooseDate(event) {
      const key = event.currentTarget.dataset.field;
      if (!['from', 'to'].includes(key)) return;
      const from = key === 'from' ? event.detail.value : this.data.from;
      const to = key === 'to' ? event.detail.value : this.data.to;
      if (from && to && from > to) { this.setData({ dateError: '开始日期不能晚于结束日期' }); return; }
      this.setData({ [key]: event.detail.value, dateError: '' }); this.filterRows();
    },
    clearDates() { this.setData({ from: '', to: '', dateError: '' }); this.filterRows(); },
    chooseFilter(event) { this.setData({ filter: event.currentTarget.dataset.filter }); this.filterRows(); },
    more() { this.filterRows(this.data.limit + 10); },
    async open(event) {
      const id = event.currentTarget.dataset.id || this.data.selectedId;
      const sequence = this.detailSequence = (this.detailSequence || 0) + 1;
      const actor = (api.currentUser() || {}).id;
      this.setData({ selectedId: id, selected: null, detailing: true, detailError: '', showPrices: false });
      this.top();
      try {
        const order = await api.request(`/supplier-orders/${encodeURIComponent(id)}`);
        if (sequence !== this.detailSequence || actor !== (api.currentUser() || {}).id || !this.data.active) return;
        this.setData({ selected: { ...order, stage: stage(order), createdText: view.dateText(order.createdAt),
          items: order.items.map(item => ({ ...item, imageLoading: !!item.imageFile })),
          shipments: (order.shipments || []).map(shipment => ({ ...shipment, shippedText: view.dateText(shipment.shippedAt) })) } });
        for (const item of order.items) if (item.imageFile) this.loadImage(item, sequence);
      } catch (error) { if (sequence === this.detailSequence) this.setData({ detailError: error.message }); }
      finally { if (sequence === this.detailSequence) this.setData({ detailing: false }); }
    },
    async loadImage(item, sequence = this.detailSequence) {
      let imageUrl = '', imageFailed = false;
      try { imageUrl = await api.imagePath(item.imageFile); } catch { imageFailed = true; }
      if (sequence !== this.detailSequence || !this.data.selected) return;
      this.setData({ 'selected.items': this.data.selected.items.map(row => row.id === item.id ? { ...row, imageUrl, imageFailed, imageLoading: false } : row) });
    },
    retryImage(event) { const item = this.data.selected?.items.find(row => row.id === event.detail.productId); if (item?.imageFile) this.loadImage(item); },
    top() { if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 }); },
    close() { this.detailSequence = (this.detailSequence || 0) + 1; this.setData({ selectedId: '', selected: null, detailing: false, detailError: '' }); this.top(); },
    source() { if (this.data.selected) this.triggerEvent('source', { id: this.data.selected.requestId, orderId: this.data.selected.id }); },
    receipt(event) { if (this.data.canReceive) this.triggerEvent('receipt', { id: event.currentTarget.dataset.id }); },
    reallocate() { if (this.data.mode === 'purchaser' && this.data.canReallocate && this.data.selected) this.triggerEvent('reallocate', { requestId: this.data.selected.requestId, supplierOrderId: this.data.selected.id }); },
    prices(event) { this.setData({ showPrices: event.detail.value }); },
    callContact(event) {
      const phoneNumber = String(event.currentTarget.dataset.phone || '').trim();
      if (phoneNumber) wx.makePhoneCall({ phoneNumber });
    }
  }
});
