const api = require('../../utils/api');
const quantity = require('../../utils/quantity');
function orderError(error) {
  const messages = { VERSION_CONFLICT: '商品资料已更新，请返回商品目录刷新并重新选择数量。',
    UNIT_CONVERSION_INVALID: '采购单位或数量换算无效，请刷新商品目录后重试。',
    INVALID_ITEM_QUANTITY: '换算后的销售数量不满足起订量或订货倍数。' };
  return messages[error.code] || error.message;
}
const storeView = require('../../utils/store-view');

Page({
  data: {
    activeView: 'order',
    orderStep: 'catalog',
    store: {},
    orderDate: '',
    search: '',
    categoryId: '',
    categories: [],
    visibleProducts: [],
    estimatedAmount: '0.00',
    cartCount: 0,
    cartOpen: false,
    previewGroups: [],
    orderFilter: 'all',
    fundingFilter: 'all',
    filteredRequests: [],
    requestLoading: false,
    pendingOrder: null,
    pendingReceipt: null,
    canWrite: false,
    catalogLoaded: false,
    catalogError: '',
    user: {},
    roleText: '未登录',
    storeId: '',
    productId: '',
    products: [],
    productIndex: -1,
    quantity: '10',
    cart: [],
    selectedRequest: null,
    selectedShipment: null,
    receiptItems: [],
    receiptEvidence: [],
    receiptEvidenceReady: false,
    receiptUploading: false,
    receiptHasDifference: false,
    receiptCanSubmit: false,
    shipmentLoading: false,
    requests: [],
    account: null,
    ledgers: [],
    shipmentId: '',
    shortReceivedQuantity: '0',
    shipmentTodos: [],
    reportRange: {
      from: '2026-09-01',
      to: '2026-09-30'
    },
    reports: {
      orderAmount: null,
      productQuantity: null
    },
    preview: null,
    created: null,
    receiptResult: null,
    previewing: false,
    submitting: false,
    loading: false,
    accounting: false,
    receiving: false,
    error: ''
  },

  onShow() {
    const user = api.openWorkspace('store');
    if (!user) return;
    const scopedStoreId = user.scope && user.scope.storeId;
    if (this.data.user.id !== user.id || this.data.storeId !== scopedStoreId) {
      this.catalogRequestSequence = (this.catalogRequestSequence || 0) + 1;
      this.receiptUploadSequence = (this.receiptUploadSequence || 0) + 1;
      this.setData({ cart: [], requests: [], account: null, ledgers: [], products: [], productId: '', productIndex: -1,
        created: null, preview: null, selectedRequest: null, selectedShipment: null, shipmentId: '', receiptItems: [], receiptEvidence: [], receiptEvidenceReady: false, receiptUploading: false, shipmentTodos: [], receiptResult: null,
        reports: { orderAmount: null, productQuantity: null }, orderStep: 'catalog', pendingOrder: null, pendingReceipt: null, store: {}, catalogLoaded: false });
    }
    this.setData({
      user,
      roleText: '门店',
      storeId: scopedStoreId || '', canWrite: (user.roles || []).includes('STORE'),
      orderDate: storeView.dateText(new Date().toISOString(), false), reportRange: storeView.monthRange()
    });
    const saved = wx.getStorageSync && wx.getStorageSync(`procurex-order-${user.id}-${scopedStoreId}`);
    if (saved && saved.key && saved.body && saved.body.storeId === scopedStoreId) this.setData({ pendingOrder: saved, orderStep: 'confirm' });
    const receipt = wx.getStorageSync && wx.getStorageSync(`procurex-receipt-${user.id}-${scopedStoreId}`);
    if (receipt && receipt.key && receipt.shipmentId && receipt.body) this.setData({ pendingReceipt: receipt, activeView: 'receive' });
    this.refreshCatalogView();
    this.loadWork();
  },

  changeView(event) {
    if (this.data.submitting || this.data.receiving || this.data.receiptUploading) return;
    this.setData({ activeView: event.currentTarget.dataset.view, error: '' });
  },

  refreshCatalogView() {
    const search = this.data.search.trim().toLowerCase();
    const products = this.data.products.map(product => ({ ...product,
      displayPrice: product.unitIndex === 1 ? product.purchaseSalesPrice || '' : product.salesPrice,
      displayUnitName: product.unitIndex === 1 ? product.purchaseUnitName : product.unitName,
      cartQuantity: (this.data.cart.find(line => line.productId === product.id) || {}).quantity || '0' }));
    const visibleProducts = products.filter(product => (!this.data.categoryId || product.categoryId === this.data.categoryId) && (!search || `${product.name} ${product.sku || ''}`.toLowerCase().includes(search)));
    const estimated = this.data.cart.reduce((total, line) => {
      const product = products.find(product => product.id === line.productId);
      const ratio = product?.purchaseUnitConversion && line.unitId === product.purchaseUnitConversion.purchaseUnitId ? Number(product.purchaseUnitConversion.salesUnitsPerPurchaseUnit) : 1;
      return total + Number(line.quantity) * ratio * Number(product && product.salesPrice || 0);
    }, 0);
    this.setData({ visibleProducts, cartCount: this.data.cart.length, estimatedAmount: estimated.toFixed(2) });
  },

  onSearch(event) { this.setData({ search: event.detail.value }); this.refreshCatalogView(); },
  chooseCategory(event) { this.setData({ categoryId: event.currentTarget.dataset.id }); this.refreshCatalogView(); },
  toggleCart() { this.setData({ cartOpen: !this.data.cartOpen }); },
  keepSheetOpen() {},
  chooseProductUnit(event) {
    if (this.data.submitting || this.data.previewing || this.data.pendingOrder) return;
    const product = this.data.products.find(item => item.id === event.currentTarget.dataset.id);
    if (!product || !product.purchaseUnitConversion) return;
    const unitIndex = Number(event.detail.value);
    if (![0, 1].includes(unitIndex) || unitIndex === product.unitIndex) return;
    this.setData({ products: this.data.products.map(item => item.id === product.id ? { ...item, unitIndex } : item),
      cart: this.data.cart.filter(item => item.productId !== product.id), preview: null, error: '' });
    this.refreshCatalogView();
  },
  openPendingOrder() { this.setData({ activeView: 'order', orderStep: 'confirm', error: '' }); },
  openProfile() { if (!this.data.submitting && !this.data.receiving) wx.navigateTo({ url: '/pages/profile/index?kind=store' }); },
  backToCatalog() { if (!this.data.submitting && !this.data.pendingOrder) this.setData({ orderStep: 'catalog', error: '' }); },
  closeRequest() { this.setData({ selectedRequest: null, selectedRequestId: '', requestLoading: false }); },
  closeShipment() { if (!this.data.receiving && !this.data.pendingReceipt && !this.data.receiptUploading) this.setData({ selectedShipment: null, shipmentId: '', receiptItems: [], receiptEvidence: [], receiptEvidenceReady: false }); },

  updateCart(product, value) {
    if (!this.data.canWrite || this.data.submitting || this.data.previewing || this.data.pendingOrder) return;
    try {
      if (product.canOrder === false) throw new Error('该商品暂不可订货');
      const normalized = String(value).trim();
      const purchase = product.unitIndex === 1 && product.purchaseUnitConversion;
      const amount = quantity.validate(normalized, { allowZero: true, min: purchase || Number(normalized) === 0 ? undefined : product.minOrderQty, multiple: purchase ? undefined : product.orderMultiple });
      const cart = this.data.cart.filter(line => line.productId !== product.id);
      if (Number(amount) > 0) cart.push({ productId: product.id, name: product.name, unitName: purchase ? product.purchaseUnitName : product.unitName || '', quantity: amount,
        ...(product.purchaseUnitConversion ? { unitId: purchase ? product.purchaseUnitConversion.purchaseUnitId : product.baseUnitId, expectedProductVersion: product.version } : {}) });
      this.setData({ cart, preview: null, error: '' });
      this.refreshCatalogView();
    } catch (error) { this.setData({ error: error.message }); }
  },

  stepProduct(event) {
    const product = this.data.products.find(product => product.id === event.currentTarget.dataset.id);
    if (!product) return;
    const line = this.data.cart.find(line => line.productId === product.id);
    const purchase = product.unitIndex === 1 && product.purchaseUnitConversion;
    try { this.updateCart(product, quantity.step(line && line.quantity || '0', purchase ? '1' : product.orderMultiple, purchase ? '1' : product.minOrderQty, Number(event.currentTarget.dataset.direction))); }
    catch (error) { this.setData({ error: error.message }); }
  },

  setProductQuantity(event) {
    const product = this.data.products.find(product => product.id === event.currentTarget.dataset.id);
    if (product) this.updateCart(product, event.detail.value);
  },

  filterOrders(event) { this.setData({ orderFilter: event.currentTarget.dataset.filter }); this.refreshOrders(); },
  filterFunding(event) { this.setData({ fundingFilter: event.detail.value ? 'unpaid' : 'all' }); this.refreshOrders(); },
  refreshOrders() {
    this.setData({ filteredRequests: this.data.requests.filter(order => (this.data.orderFilter === 'all' || storeView.orderStage(order) === this.data.orderFilter) &&
      (this.data.fundingFilter === 'all' || order.paymentStatus !== 'PAID')) });
  },

  savePending(kind, value) {
    const key = `procurex-${kind}-${this.data.user.id}-${this.data.storeId}`;
    if (value && wx.setStorageSync) wx.setStorageSync(key, value);
    else if (!value && wx.removeStorageSync) wx.removeStorageSync(key);
  },

  logout() {
    if (this.data.receiving || this.data.receiptUploading || this.data.pendingReceipt) return;
    api.logout();
    wx.redirectTo({ url: '/pages/login/index' });
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, preview: null });
  },

  async selectShipment(event) {
    if (this.data.receiving || this.data.pendingReceipt || this.data.receiptUploading) return;
    const shipmentId = event.currentTarget.dataset.id;
    this.receiptUploadSequence = (this.receiptUploadSequence || 0) + 1;
    this.setData({ shipmentId, selectedShipment: null, receiptItems: [], receiptEvidence: [], receiptEvidenceReady: false, shipmentLoading: true, error: '' });
    try {
      const selectedShipment = await api.request(`/shipments/${this.data.shipmentId}`);
      if (this.data.shipmentId !== shipmentId) return;
      this.setData({ activeView: 'receive', selectedShipment: { ...selectedShipment, shippedDate: storeView.dateText(selectedShipment.shippedAt), canReceive: selectedShipment.items.some(item => !item.receiptLocked) },
        receiptItems: selectedShipment.items.map(item => ({ ...item, receivedQuantity: item.currentReceivedQuantity == null ? item.shippedQuantity : item.currentReceivedQuantity })) });
      this.refreshReceiptSummary();
    } catch (error) {
      if (this.data.shipmentId === shipmentId) this.setData({ error: error.message });
    } finally {
      if (this.data.shipmentId === shipmentId) this.setData({ shipmentLoading: false });
    }
  },

  chooseShipment(event) {
    const shipment = this.data.shipmentTodos[Number(event.detail.value)];
    if (shipment) this.selectShipment({ currentTarget: { dataset: { id: shipment.id } } });
  },

  async chooseReceiptEvidence() {
    if (!this.data.canWrite || this.data.receiving || this.data.pendingReceipt || this.data.receiptUploading || !this.data.selectedShipment?.canReceive || !this.data.receiptCanSubmit) return;
    const count = 6 - this.data.receiptEvidence.length;
    if (count < 1) return;
    const sequence = this.receiptUploadSequence;
    this.setData({ receiptUploading: true, error: '' });
    try {
      const files = await api.chooseEvidence(count);
      for (const file of files.slice(0, count)) {
        if (sequence !== this.receiptUploadSequence) return;
        if (this.data.receiptEvidence.some(item => item.path === file.path)) continue;
        this.setReceiptEvidence([...this.data.receiptEvidence, { path: file.path, status: 'UPLOADING' }]);
        await this.uploadReceiptEvidence(file.path);
      }
    } catch (error) { if (sequence === this.receiptUploadSequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.receiptUploadSequence) this.setData({ receiptUploading: false }); }
  },

  setReceiptEvidence(files) {
    this.setData({ receiptEvidence: files, receiptEvidenceReady: files.length > 0 && files.every(file => file.status === 'READY' && file.id) });
  },

  async uploadReceiptEvidence(path) {
    const sequence = this.receiptUploadSequence;
    try {
      const file = await api.uploadEvidence(path, 'RECEIPT');
      if (sequence === this.receiptUploadSequence) this.setReceiptEvidence(this.data.receiptEvidence.map(item => item.path === path ? { ...item, ...file, status: 'READY', error: '' } : item));
    } catch (error) {
      if (sequence === this.receiptUploadSequence) this.setReceiptEvidence(this.data.receiptEvidence.map(item => item.path === path ? { ...item, status: 'FAILED', error: error.message } : item));
    }
  },

  async retryReceiptEvidence(event) {
    if (this.data.receiptUploading || this.data.receiving || this.data.pendingReceipt || !this.data.canWrite) return;
    const file = this.data.receiptEvidence[Number(event.currentTarget.dataset.index)];
    if (!file || file.status !== 'FAILED') return;
    const sequence = this.receiptUploadSequence;
    this.setData({ receiptUploading: true });
    try { await this.uploadReceiptEvidence(file.path); } finally { if (sequence === this.receiptUploadSequence) this.setData({ receiptUploading: false }); }
  },

  removeReceiptEvidence(event) {
    if (this.data.receiptUploading || this.data.receiving || this.data.pendingReceipt || !this.data.canWrite) return;
    const index = Number(event.currentTarget.dataset.index);
    this.setReceiptEvidence(this.data.receiptEvidence.filter((_, position) => position !== index));
  },

  async previewReceiptEvidence(event) {
    const file = this.data.selectedShipment?.evidenceFiles?.find(item => item.id === event.currentTarget.dataset.id);
    if (!file) return;
    try { await api.previewEvidence(file); } catch (error) { this.setData({ error: error.message }); }
  },

  onReceiptQuantity(event) {
    if (this.data.receiving || this.data.pendingReceipt) return;
    const receiptItems = this.data.receiptItems.map(item => !item.receiptLocked && item.id === event.currentTarget.dataset.id
      ? { ...item, receivedQuantity: event.detail.value } : item);
    this.setData({ receiptItems });
    this.refreshReceiptSummary();
  },

  refreshReceiptSummary() {
    const shipment = this.data.selectedShipment;
    this.setData({ receiptHasDifference: this.data.receiptItems.some(item => !item.receiptLocked && Number(item.receivedQuantity) !== Number(item.shippedQuantity)),
      receiptCanSubmit: !!shipment && (!shipment.currentReceiptRevision || this.data.receiptItems.some(item => !item.receiptLocked && Number(item.receivedQuantity) !== Number(item.currentReceivedQuantity))) });
  },

  fillReceipt() {
    if (this.data.receiving || this.data.pendingReceipt) return;
    this.setData({ receiptItems: this.data.receiptItems.map(item => item.receiptLocked ? item : { ...item, receivedQuantity: item.shippedQuantity }) });
    this.refreshReceiptSummary();
  },

  addToCart() {
    if (this.data.submitting || this.data.previewing || this.data.pendingOrder) return;
    try {
      const product = this.data.products[this.data.productIndex];
      if (!product) throw new Error('请选择商品');
      this.updateCart(product, this.data.quantity);
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  removeCartItem(event) {
    if (this.data.submitting || this.data.previewing || this.data.pendingOrder) return;
    this.setData({ cart: this.data.cart.filter(item => item.productId !== event.currentTarget.dataset.id), preview: null });
    this.refreshCatalogView();
  },

  selectProduct(event) {
    if (this.data.submitting || this.data.previewing) return;
    const productIndex = Number(event.detail.value);
    const product = this.data.products[productIndex];
    this.setData({ productIndex, productId: product.id, quantity: product.minOrderQty, preview: null });
  },

  async loadCatalog() {
    const sequence = this.catalogRequestSequence = (this.catalogRequestSequence || 0) + 1;
    this.setData({ catalogError: '' });
    try {
      const catalog = await api.request(`/stores/${this.data.storeId}/catalog`);
      if (sequence !== this.catalogRequestSequence) return;
      const products = catalog.items.filter(item => item.product.isActive).map(item => {
        const supplier = item.suppliers[0] || {};
        const cartLine = this.data.cart.find(line => line.productId === item.product.id);
        return { ...item.product, unitIndex: cartLine?.unitId === item.product.purchaseUnitConversion?.purchaseUnitId && item.product.purchaseUnitConversion ? 1 : 0,
          unitChoices: [item.product.unitName, item.product.purchaseUnitName].filter(Boolean),
          salesPrice: supplier.salesPrice == null ? '' : supplier.salesPrice,
          purchaseSalesPrice: supplier.purchaseSalesPrice == null ? '' : supplier.purchaseSalesPrice,
          supplierName: supplier.supplierName || '配送供应商', supplierId: supplier.supplierId || '',
          canOrder: supplier.salesPrice != null && !!supplier.priceVersionId,
          imageUrl: '', imageFailed: false };
      });
      const categories = [{ id: '', name: '全部商品' }];
      for (const product of products) if (!categories.some(category => category.id === product.categoryId)) categories.push({ id: product.categoryId, name: product.categoryName || '未分类' });
      this.setData({ products, categories, store: catalog.store || {}, catalogLoaded: true });
      this.refreshCatalogView();
      this.loadCatalogImages(products, sequence);
    } catch (error) {
      if (sequence === this.catalogRequestSequence) this.setData({ catalogError: error.code === 'STORE_TEMPLATE_NOT_FOUND' ? '当前门店暂无可订商品' : '商品目录加载失败，请重试', catalogLoaded: false });
    }
  },

  async loadCatalogImages(products, sequence) {
    const images = products.filter(product => product.imageFile);
    for (let index = 0; index < images.length && sequence === this.catalogRequestSequence; index += 4) {
      await Promise.all(images.slice(index, index + 4).map(product => this.loadProductImage(product, sequence)));
    }
  },

  async loadProductImage(product, sequence = this.catalogRequestSequence) {
    if (!product.imageFile) return;
    let imageUrl = '', imageFailed = false;
    try { imageUrl = await api.imagePath(product.imageFile); } catch { imageFailed = true; }
    if (sequence !== this.catalogRequestSequence) return;
    this.setData({ products: this.data.products.map(item => item.id === product.id && item.imageFileId === product.imageFileId ? { ...item, imageUrl, imageFailed } : item) });
    this.refreshCatalogView();
  },

  retryProductImage(event) {
    const product = this.data.products.find(item => item.id === event.currentTarget.dataset.id);
    if (product) this.loadProductImage(product);
  },

  async selectRequest(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selectedRequest: null, selectedRequestId: id, requestLoading: true, error: '' });
    try {
      const detail = await api.request(`/purchase-requests/${id}`);
      if (this.data.selectedRequestId !== id) return;
      const names = new Map(this.data.products.map(product => [product.id, product.name]));
      this.setData({ selectedRequest: { ...detail, stage: storeView.orderStage(detail), submittedDate: storeView.dateText(detail.submittedAt),
        items: detail.items.map(item => ({ ...item, productName: item.productName || names.get(item.productId) || '商品' })),
        supplierOrders: (detail.supplierOrders || []).map(order => ({ ...order, shipments: (order.shipments || []).map(shipment => ({ ...shipment,
          shippedDate: storeView.dateText(shipment.shippedAt), receivedDate: storeView.dateText(shipment.receivedAt) })) })) } });
    } catch (error) {
      if (this.data.selectedRequestId === id) this.setData({ error: error.message });
    } finally {
      if (this.data.selectedRequestId === id) this.setData({ requestLoading: false });
    }
  },

  async loadWork() {
    this.setData({ loading: true, error: '' });
    try {
      const tasks = [this.loadRequests(false), this.loadShipments(false), this.loadReports(false)];
      if (this.data.storeId) tasks.push(this.loadAccount(false), this.loadCatalog());
      await Promise.all(tasks);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadRequests(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const requests = await api.request('/purchase-requests');
      this.setData({ requests: Array.isArray(requests) ? requests.map(order => ({ ...order, submittedDate: storeView.dateText(order.submittedAt),
        stage: storeView.orderStage(order), progressText: order.supplierCount ? `${order.supplierCount}家供应商 · ${order.completedSupplierCount || 0}家已完成` : '等待采购分配' })) : [] });
      this.refreshOrders();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadShipments(toggleLoading = true) {
    if (toggleLoading) this.setData({ loading: true, error: '' });
    try {
      const data = await api.request('/notifications');
      const notifications = data.notifications || [];
      const shipmentTodos = notifications
        .filter((item) => item.payload && item.payload.shipmentId && (item.payload.type === 'SHIPMENT_CREATED' || (item.payload.type === 'DISCREPANCY_RESOLVED' && item.payload.action === 'RETURN')))
        .map((item) => ({
          id: item.payload.shipmentId,
          shipmentNo: item.payload.shipmentNo || item.payload.shipmentId,
          supplierOrderId: item.payload.supplierOrderId,
          title: item.title,
          label: `${item.payload.shipmentNo || '发货单'} · ${item.title}`,
          createdAt: item.createdAt, createdDate: storeView.dateText(item.createdAt)
        }))
        .filter((item, index, items) => items.findIndex(value => value.id === item.id) === index).slice(0, 20);
      this.setData({ shipmentTodos });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ loading: false });
    }
  },

  async loadAccount(toggleLoading = true) {
    if (!this.data.storeId) {
      this.setData({ error: '请先填写门店 ID' });
      return;
    }
    if (toggleLoading) this.setData({ accounting: true, error: '' });
    try {
      const [account, ledgers] = await Promise.all([
        api.request(`/stores/${this.data.storeId}/account`),
        api.request(`/stores/${this.data.storeId}/ledgers`)
      ]);
      this.setData({
        account,
        ledgers: Array.isArray(ledgers) ? ledgers.slice(0, 20).map(ledger => ({ ...ledger, occurredDate: storeView.dateText(ledger.occurredAt) })) : []
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      if (toggleLoading) this.setData({ accounting: false });
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

  orderInput() {
    if (!this.data.storeId) throw new Error('账号尚未绑定门店');
    if (!this.data.cart.length) throw new Error('请先添加订货商品');
    return {
      storeId: this.data.storeId,
      items: this.data.cart.map(item => ({ productId: item.productId, quantity: item.quantity, ...(item.unitId ? { unitId: item.unitId, expectedProductVersion: item.expectedProductVersion } : {}) }))
    };
  },

  async previewOrder() {
    if (!this.data.canWrite || this.data.previewing || this.data.submitting || this.data.pendingOrder) return;
    this.setData({ previewing: true, error: '' });
    try {
      const preview = await api.request('/purchase-requests/preview', {
        method: 'POST',
        data: this.orderInput()
      });
      this.setData({ preview, previewGroups: storeView.previewGroups(preview, this.data.products), orderStep: 'confirm', cartOpen: false });
    } catch (error) {
      this.setData({ error: orderError(error) });
    } finally {
      this.setData({ previewing: false });
    }
  },

  async submitOrder() {
    if (!this.data.canWrite || this.data.submitting) return;
    if (!this.data.pendingOrder && !this.data.preview) { await this.previewOrder(); return; }
    this.setData({ submitting: true, error: '' });
    try {
      if (!this.data.pendingOrder) {
        const latest = await api.request('/purchase-requests/preview', { method: 'POST', data: this.orderInput() });
        if (storeView.previewSignature(latest) !== storeView.previewSignature(this.data.preview)) {
          this.setData({ preview: latest, previewGroups: storeView.previewGroups(latest, this.data.products), error: '报价或资金状态已变化，请重新核对后提交' });
          return;
        }
        if (latest.funding.credit && Number(latest.funding.credit.shortfall) > 0) throw new Error('挂账额度不足，请联系财务调整额度后重试');
        const pendingOrder = { key: `mini-store-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, body: this.orderInput() };
        this.setData({ pendingOrder }); this.savePending('order', pendingOrder);
      }
      const pending = this.data.pendingOrder;
      const created = await api.request('/purchase-requests', {
        method: 'POST',
        data: pending.body,
        header: { 'idempotency-key': pending.key }
      });
      if (!created.id) { const error = new Error('提交结果尚未确认'); error.uncertain = true; throw error; }
      this.savePending('order', null);
      this.setData({ created, cart: [], preview: null, previewGroups: [], activeView: 'orders', orderStep: 'catalog', pendingOrder: null });
      this.refreshCatalogView();
      await this.loadRequests(false);
      await this.selectRequest({ currentTarget: { dataset: { id: created.id } } });
    } catch (error) {
      if (!error.uncertain) { this.savePending('order', null); this.setData({ pendingOrder: null }); }
      this.setData({ error: error.uncertain ? '提交结果尚未确认，请核对提交结果，勿重复创建订货单' : orderError(error) });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async receiveShipment(event) {
    if (!this.data.canWrite || this.data.receiving || this.data.shipmentLoading || this.data.receiptUploading) return;
    const mode = this.data.pendingReceipt ? this.data.pendingReceipt.mode : event.currentTarget.dataset.mode;
    if (!this.data.selectedShipment && !this.data.pendingReceipt) {
      this.setData({ error: '请先选择待收货单据' });
      return;
    }

    this.setData({ receiving: true, error: '', receiptResult: null });
    try {
      const shipment = this.data.selectedShipment;
      const items = this.data.pendingReceipt ? null : this.data.receiptItems.map(item => ({
        shipmentItemId: item.id,
        receivedQuantity: mode === 'FULL' && !item.receiptLocked ? item.shippedQuantity : quantity.validate(item.receivedQuantity, { allowZero: true, max: item.shippedQuantity })
      }));
      if (!this.data.pendingReceipt && shipment.currentReceiptRevision > 0 && this.data.receiptItems.every(item => {
        const next = items.find(line => line.shipmentItemId === item.id);
        return item.currentReceivedQuantity != null && Number(next.receivedQuantity) === Number(item.currentReceivedQuantity);
      })) throw new Error('收货数量未变化，无需重复提交');
      if (!this.data.pendingReceipt) {
        if (!this.data.receiptEvidence.length || this.data.receiptEvidence.some(file => file.status !== 'READY' || !file.id)) throw new Error('请先完成收货凭证上传');
        const pendingReceipt = { key: `mini-store-receipt-${mode}-${Date.now()}`, mode, shipmentId: this.data.shipmentId, shipmentNo: shipment.shipmentNo,
          body: { expectedOrderVersion: shipment.supplierOrderVersion, expectedReceiptRevision: shipment.currentReceiptRevision, items, evidenceFileIds: this.data.receiptEvidence.map(file => file.id) } };
        this.setData({ pendingReceipt }); this.savePending('receipt', pendingReceipt);
      }
      const pending = this.data.pendingReceipt;
      const receipt = await api.request(`/shipments/${pending.shipmentId}/receipts`, {
        method: 'POST',
        data: pending.body,
        header: { 'idempotency-key': pending.key }
      });
      if (!receipt.id && !receipt.revision) { const error = new Error('收货结果尚未确认'); error.uncertain = true; throw error; }
      this.savePending('receipt', null);
      this.setData({
        shipmentId: '', selectedShipment: null, receiptItems: [], receiptEvidence: [], receiptEvidenceReady: false, pendingReceipt: null,
        receiptResult: {
          title: receipt.receiptNo || receipt.id,
          status: mode === 'SHORT' ? 'SHORT_RECEIVED' : 'RECEIVED',
          detail: `发货单 ${pending.shipmentNo} 已提交第 ${receipt.revision} 版收货`
        }
      });
      await this.loadWork();
    } catch (error) {
      if (!error.uncertain) { this.savePending('receipt', null); this.setData({ pendingReceipt: null }); }
      this.setData({ error: error.uncertain ? '收货结果尚未确认，请核对提交结果，勿重复提交' : error.message });
    } finally {
      this.setData({ receiving: false });
    }
  }
});
