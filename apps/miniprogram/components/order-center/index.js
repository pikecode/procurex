const api = require('../../utils/api');
const view = require('../../utils/store-view');

function stage(order) {
  if (order.status === 'REJECTED' || order.status === 'CANCELED') return 'closed';
  if (order.deliveryState === 'COMPLETED' || order.status === 'COMPLETED' || (!order.deliveryState && order.fulfillmentStatus === 'COMPLETED')) return 'completed';
  if (order.pendingReceiptCount > 0) return 'receiving';
  if (order.openReceiptExceptionCount > 0) return 'exception';
  if (!order.deliveryState && order.receiptExceptionCount > 0) return 'exception';
  if (['DISPUTED', 'DECLINED', 'REPLENISHING'].includes(order.deliveryState)) return 'exception';
  if (order.deliveryState === 'FINISHED' && order.pendingReceiptCount === 0) return 'confirm';
  if (order.deliveryState === 'IN_PROGRESS') return 'shipping';
  if (!order.deliveryState && (order.status === 'PARTIAL_SHIPPED' || order.fulfillmentStatus === 'PARTIAL_SHIPPED')) return 'shipping';
  if (!order.deliveryState && order.fulfillmentStatus === 'CANCELED') return 'closed';
  return ['PUSHED', 'ACCEPTED', 'DRAFT'].includes(order.status) ? 'pending' : 'receiving';
}

const tabs = [{ value: 'all', label: '全部' }, { value: 'receiving', label: '待收货' }, { value: 'confirm', label: '待整单确认' },
  { value: 'exception', label: '异常处理' }, { value: 'pending', label: '待发货' }, { value: 'shipping', label: '发货中' },
  { value: 'completed', label: '已完成' }, { value: 'closed', label: '已关闭 / 拒单' }];
function orderView(order) {
  const current = stage(order);
  const exceptionLabel = order.deliveryState === 'DISPUTED' || order.pendingSupplierReceiptExceptionCount > 0 ? '待供应商处理'
    : order.deliveryState === 'REPLENISHING' || order.pendingReplenishmentCount > 0 ? '待供应商补发'
      : order.deliveryState === 'DECLINED' ? '补发被拒 · 待门店确认'
        : order.openReceiptExceptionCount > 0 && order.pendingSupplierReceiptExceptionCount === 0 ? '待门店确认异常'
          : order.openReceiptExceptionCount > 0 || order.receiptExceptionCount > 0 ? '收货差异待处理' : '';
  const displayStatus = { pending: '待发货', receiving: '待核对收货', confirm: '待整单确认', shipping: '发货中', completed: '已完成',
    exception: exceptionLabel || '收货差异待处理',
    closed: order.status === 'REJECTED' ? '供应商拒单' : '已关闭' }[current];
  return { ...order, stage: current, displayStatus, exceptionLabel: ['closed', 'completed'].includes(current) ? '' : exceptionLabel, createdText: view.dateText(order.createdAt) };
}
function sortOrders(orders) {
  const priorities = { receiving: 0, confirm: 1, exception: 2, pending: 3, shipping: 4, completed: 5, closed: 6 };
  return orders.map((order, index) => ({ order, index })).sort((a, b) => {
    const priority = priorities[a.order.stage] - priorities[b.order.stage];
    if (priority) return priority;
    const first = Date.parse(a.order.createdAt), second = Date.parse(b.order.createdAt);
    if (Number.isFinite(first) && Number.isFinite(second)) return (priorities[a.order.stage] < 5 ? first - second : second - first)
      || String(a.order.id).localeCompare(String(b.order.id));
    return a.index - b.index;
  }).map(item => item.order);
}

Component({
  properties: {
    active: { type: Boolean, value: false },
    revision: { type: Number, value: 0 },
    mode: { type: String, value: 'store' },
    canReceive: { type: Boolean, value: false },
    canReallocate: { type: Boolean, value: false },
    receiptNotice: { type: Object, value: null }
  },
  data: { orders: [], visible: [], selected: null, selectedId: '', loading: false, detailing: false,
    tabs: tabs.map(tab => ({ ...tab, count: 0 })), statusExpanded: false, statusScrollTarget: 'store-status-all',
    error: '', detailError: '', search: '', filter: 'all', from: '', to: '', dateError: '', limit: 10, total: 0, more: false, showPrices: false,
    deliveryBusy: false, pendingDelivery: false, objectionOpen: false, objectionReason: '', objectionItems: [], deliveryError: '', detailTab: 'products', orderInfoOpen: false },
  observers: {
    'active, revision': function(active) {
      if (!active) { const hadDetail = Boolean(this.data.selectedId); this.sequence = (this.sequence || 0) + 1; this.detailSequence = (this.detailSequence || 0) + 1; this.setData({ selected: null, selectedId: '', detailing: false }); if (hadDetail) this.triggerEvent('detailchange', { open: false }); return; }
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
      this.syncDeliveryCommand();
      const sequence = this.sequence = (this.sequence || 0) + 1;
      const actor = (api.currentUser() || {}).id;
      if (actor !== this.actor) {
        this.actor = actor;
        this.detailSequence = (this.detailSequence || 0) + 1;
        this.setData({ orders: [], visible: [], selected: null, selectedId: '', search: '', filter: 'all', statusExpanded: false, statusScrollTarget: 'store-status-all', from: '', to: '', dateError: '', detailError: '', detailing: false, showPrices: false });
      }
      this.setData({ loading: true, error: '' });
      try {
        const orders = await api.request('/supplier-orders');
        if (sequence !== this.sequence || actor !== (api.currentUser() || {}).id || !this.data.active) return;
        this.setData({ orders: sortOrders(orders.map(orderView)) });
        this.filterRows();
      } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message, orders: [], visible: [], total: 0, more: false }); }
      finally { if (sequence === this.sequence) this.setData({ loading: false }); }
    },
    filterRows(limit = 10) {
      const search = this.data.search.trim().toLowerCase();
      const searched = this.data.orders.filter(order => (!this.data.from || order.createdText.slice(0, 10) >= this.data.from) && (!this.data.to || order.createdText.slice(0, 10) <= this.data.to)
        && [order.supplierOrderNo, order.requestNo, order.storeName, order.supplierName, order.productSummary].some(value => String(value || '').toLowerCase().includes(search)));
      const rows = searched.filter(order => this.data.filter === 'all' || order.stage === this.data.filter);
      this.setData({ visible: rows.slice(0, limit), total: rows.length, limit, more: rows.length > limit,
        tabs: tabs.map(tab => ({ ...tab, count: searched.filter(order => tab.value === 'all' || order.stage === tab.value).length })) });
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
    chooseFilter(event) {
      const filter = event.currentTarget.dataset.filter;
      this.setData({ filter, statusExpanded: false, statusScrollTarget: `store-status-${filter}` });
      this.filterRows();
    },
    toggleStatusExpanded() { this.setData({ statusExpanded: !this.data.statusExpanded, statusScrollTarget: `store-status-${this.data.filter}` }); },
    more() { this.filterRows(this.data.limit + 10); },
    async open(event) {
      const id = event.currentTarget.dataset.id || this.data.selectedId;
      const sequence = this.detailSequence = (this.detailSequence || 0) + 1;
      const actor = (api.currentUser() || {}).id;
      this.setData({ selectedId: id, selected: null, detailing: true, detailError: '', showPrices: false, objectionOpen: false, objectionReason: '', deliveryError: '', detailTab: 'products', orderInfoOpen: false });
      this.triggerEvent('detailchange', { open: true });
      this.top();
      try {
        const order = await api.request(`/supplier-orders/${encodeURIComponent(id)}`);
        if (sequence !== this.detailSequence || actor !== (api.currentUser() || {}).id || !this.data.active) return;
        const pendingReceiptCount = order.pendingReceiptCount ?? order.shipments?.filter(batch => !batch.currentReceiptRevision).length;
        const ready = ['FINISHED', 'DECLINED'].includes(order.deliveryState) && order.shipments?.length > 0 && pendingReceiptCount === 0 && !order.openReceiptExceptionCount;
        const shortageAgreementRequired = order.shortageAgreementRequired ?? order.items.some(item => Number(item.quantity) > Number(item.receivedQuantity));
        const canFinalize = ready && !shortageAgreementRequired;
        const unagreed = order.unagreedShortageItems && order.deliveryState !== 'DECLINED' ? new Map(order.unagreedShortageItems.map(item => [item.orderItemId, item.quantity])) : null;
        const objectionItems = order.items.filter(item => unagreed ? unagreed.has(item.id) : Number(item.quantity) > Number(item.receivedQuantity)).map(item => ({ ...item, checked: true,
          objectionQuantity: unagreed?.get(item.id) || String(Number(item.quantity) - Number(item.receivedQuantity)) }));
        const canRaiseObjection = ready && (shortageAgreementRequired || (order.deliveryState === 'DECLINED' && objectionItems.length > 0));
        const shipments = (order.shipments || []).map((shipment, index) => ({ ...shipment, batchNumber: index + 1, shippedText: view.dateText(shipment.shippedAt),
          receiptExceptionReplies: (shipment.receiptExceptionReplies || []).map(reply => ({ ...reply, createdText: view.dateText(reply.createdAt) })),
          receiptHasException: Boolean(shipment.receiptHasException || shipment.receiptExceptionStatus || shipment.receiptDifferences?.length),
          receiptExceptionLabel: shipment.receiptExceptionDecision === 'REPLENISH' && shipment.canConfirmReceiptException === false ? '补发处理中' : ({ REGISTERED: '已登记 · 未提交', SUBMITTED: '待供应商处理', RESPONDED: '待门店确认', RESOLVED: '已解决' })[shipment.receiptExceptionStatus] || (shipment.receiptDifferences?.length ? '数量差异已登记' : '异常已登记') }));
        const receiptExceptions = shipments.filter(shipment => shipment.receiptHasException);
        this.setData({ detailTab: receiptExceptions.some(item => item.receiptExceptionStatus !== 'RESOLVED') && order.status !== 'COMPLETED' ? 'exceptions' : pendingReceiptCount > 0 ? 'shipments' : 'products',
          selected: { ...orderView({ ...order, pendingReceiptCount }),
          canFinalize, canRaiseObjection, shortageAgreementRequired,
          items: order.items.map(item => ({ ...item, imageLoading: !!item.imageFile })),
          shipments,
          receiptExceptions } });
        this.setData({ objectionItems, objectionOpen: Boolean(this.data.canReceive && canRaiseObjection && shortageAgreementRequired && objectionItems.length) });
        for (const item of order.items) if (item.imageFile) this.loadImage(item, sequence);
      } catch (error) { if (sequence === this.detailSequence) this.setData({ detailError: error.message }); }
      finally { if (sequence === this.detailSequence) {
        this.setData({ detailing: false });
        const top = () => { if (sequence === this.detailSequence && this.data.active) this.top(); };
        if (wx.nextTick) wx.nextTick(top); else top();
      } }
    },
    async loadImage(item, sequence = this.detailSequence) {
      let imageUrl = '', imageFailed = false;
      try { imageUrl = await api.imagePath(item.imageFile); } catch { imageFailed = true; }
      if (sequence !== this.detailSequence || !this.data.selected) return;
      this.setData({ 'selected.items': this.data.selected.items.map(row => row.id === item.id ? { ...row, imageUrl, imageFailed, imageLoading: false } : row) });
    },
    retryImage(event) { const item = this.data.selected?.items.find(row => row.id === event.detail.productId); if (item?.imageFile) this.loadImage(item); },
    top() { if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 }); },
    close() { if (this.data.deliveryBusy) return; this.detailSequence = (this.detailSequence || 0) + 1; this.setData({ selectedId: '', selected: null, detailing: false, detailError: '' }); this.triggerEvent('detailchange', { open: false }); this.top(); },
    source() { if (this.data.selected) this.triggerEvent('source', { id: this.data.selected.requestId, orderId: this.data.selected.id }); },
    receipt(event) { if (this.data.canReceive && !this.data.deliveryBusy) this.triggerEvent('receipt', { id: event.currentTarget.dataset.id, orderId: this.data.selected?.id }); },
    differences() { if (this.data.canReceive && this.data.selected) this.triggerEvent('differences', { orderId: this.data.selected.id }); },
    showReceiptExceptions(event) {
      this.setData({ detailTab: 'exceptions' });
      const id = event?.currentTarget?.dataset?.id;
      const batch = this.data.selected?.receiptExceptions?.find(item => item.id === id);
      const selector = batch ? `#receipt-exception-${batch.id}` : '.receipt-exception';
      if (!this.createSelectorQuery) { this.top(); return; }
      const locate = () => this.createSelectorQuery().select(selector).boundingClientRect().selectViewport().scrollOffset().select('.detail-tabs').boundingClientRect().exec(result => {
        if (result[0] && wx.pageScrollTo) wx.pageScrollTo({ scrollTop: Math.max(0, result[0].top + (result[1]?.scrollTop || 0) - (result[2]?.height || 0) - 12), duration: 200 });
      });
      if (wx.nextTick) wx.nextTick(locate); else locate();
    },
    reallocate() { if (this.data.mode === 'purchaser' && this.data.canReallocate && this.data.selected) this.triggerEvent('reallocate', { requestId: this.data.selected.requestId, supplierOrderId: this.data.selected.id }); },
    prices(event) { this.setData({ showPrices: event.detail.value }); },
    chooseDetailTab(event) { const tab = event.currentTarget.dataset.tab; if (['products', 'shipments', 'exceptions'].includes(tab) && !this.data.deliveryBusy) this.setData({ detailTab: tab }); },
    toggleOrderInfo() { this.setData({ orderInfoOpen: !this.data.orderInfoOpen }); },
    syncDeliveryCommand() {
      this.setData({ pendingDelivery: Boolean(this.data.canReceive && api.roleCommandState && api.roleCommandState('store').pending) });
    },
    async recoverDelivery() {
      if (!this.data.canReceive || this.data.deliveryBusy) return;
      this.setData({ deliveryBusy: true });
      try {
        await api.retryRoleCommand('store');
        await this.load();
        if (this.data.selectedId) await this.open({ currentTarget: { dataset: { id: this.data.selectedId } } });
      } catch (error) { this.setData({ error: error.message, deliveryError: error.message }); }
      finally { this.setData({ deliveryBusy: false }); this.syncDeliveryCommand(); }
    },
    toggleObjection() { if (!this.data.deliveryBusy) this.setData({ objectionOpen: !this.data.objectionOpen }); },
    async receiptExceptionAction(event) {
      if (!this.data.canReceive || this.data.deliveryBusy || !this.data.selected) return;
      const { receiptId, action } = event.currentTarget.dataset;
      if (!['submit-receipt-exception', 'confirm-receipt-exception'].includes(action)) return;
      const batch = this.data.selected.shipments.find(item => item.receiptId === receiptId);
      if (!batch || !['REGISTERED', 'RESPONDED'].includes(batch.receiptExceptionStatus)) return;
      const submitting = action === 'submit-receipt-exception';
      if (!submitting && (batch.receiptExceptionStatus !== 'RESPONDED' || batch.canConfirmReceiptException === false)) return;
      if (submitting && batch.receiptExceptionDecision === 'REPLENISH') return;
      const prompt = await new Promise(resolve => wx.showModal({ title: submitting ? '提交供应商处理' : '确认异常已解决', editable: true,
        content: submitting ? batch.receiptNote : batch.receiptDifferences?.length && ['ACCEPT_SHORTAGE', 'DECLINED'].includes(batch.receiptExceptionDecision) ? '接受供应商不再补发，按实际收货数量结算。' : '', placeholderText: submitting ? '填写处理要求（必填）' : '填写解决情况（必填）', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!prompt.confirm) return;
      const reason = (prompt.content || '').trim();
      if (!reason) { this.setData({ deliveryError: '请填写处理说明' }); return; }
      const order = this.data.selected;
      this.setData({ deliveryBusy: true, deliveryError: '' });
      try {
        await api.roleCommand('store', `/supplier-orders/${order.id}/${action}`, { method: 'POST', data: { expectedVersion: order.version, receiptId, reason }, header: { 'idempotency-key': `mini-receipt-exception-${Date.now()}` } });
        await this.open({ currentTarget: { dataset: { id: order.id } } });
        await this.load();
      } catch (error) { this.setData({ deliveryError: error.message }); }
      finally { this.setData({ deliveryBusy: false }); this.syncDeliveryCommand(); }
    },
    objectionReason(event) { if (!this.data.deliveryBusy) this.setData({ objectionReason: event.detail.value }); },
    selectObjection(event) {
      if (!this.data.deliveryBusy) this.setData({ objectionItems: this.data.objectionItems.map(item => item.id === event.currentTarget.dataset.id ? { ...item, checked: !item.checked } : item) });
    },
    async finalize(event) {
      const objection = event.currentTarget.dataset.action === 'raise-objection';
      if (!this.data.canReceive || this.data.deliveryBusy || !(objection ? this.data.selected?.canRaiseObjection : this.data.selected?.canFinalize)) return;
      const items = this.data.objectionItems.filter(item => item.checked).map(item => ({ orderItemId: item.id, quantity: item.objectionQuantity }));
      const reason = this.data.objectionReason.trim();
      if (objection && (!reason || !items.length)) { this.setData({ deliveryError: '请选择异议商品并填写原因' }); return; }
      const confirmed = await new Promise(resolve => wx.showModal({ title: objection ? '提交订单异议' : '确认整单收货',
        content: objection ? '将通知供应商处理所选商品的缺量，处理并经门店确认前不能完成订单。' : this.data.selected.deliveryState === 'DECLINED' ? '供应商已说明不再补发。确认即接受剩余数量不再补发，按最终实收结算并完成订单；不接受请继续提出异议。' : '全部收货及异常处理已核对，按双方确认的实际收货数量结算本单。确认后订单完成。', success: value => resolve(value.confirm), fail: () => resolve(false) }));
      if (!confirmed) return;
      const order = this.data.selected;
      const actor = api.currentUser()?.id;
      this.setData({ deliveryBusy: true, deliveryError: '' });
      try {
        await api.roleCommand('store', `/supplier-orders/${order.id}/${objection ? 'raise-objection' : 'confirm-receipt'}`, {
          method: 'POST', data: { expectedVersion: order.version, ...(objection ? { reason, items } : {}) },
          header: { 'idempotency-key': `mini-order-receipt-${Date.now()}` }
        });
        if (actor !== api.currentUser()?.id || this.data.selectedId !== order.id) return;
        await this.open({ currentTarget: { dataset: { id: order.id } } });
        await this.load();
      } catch (error) { if (actor === api.currentUser()?.id) this.setData({ deliveryError: error.message }); }
      finally { this.setData({ deliveryBusy: false }); this.syncDeliveryCommand(); }
    },
    callContact(event) {
      const phoneNumber = String(event.currentTarget.dataset.phone || '').trim();
      if (phoneNumber) wx.makePhoneCall({ phoneNumber });
    }
  }
});
