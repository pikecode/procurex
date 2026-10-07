const api = require('../../utils/api');
const quantity = require('../../utils/quantity');
const storageOptions = [{ code: '', name: '未设置' }, { code: 'AMBIENT', name: '常温' }, { code: 'CHILLED', name: '冷藏' }, { code: 'FROZEN', name: '冷冻' }, { code: 'WARM', name: '保温' }];
const blank = () => ({ sku: '', defaultSalesPrice: '', name: '', categoryId: '', baseUnitId: '', minOrderQty: '1', orderMultiple: '1', specification: '', brand: '', storageCondition: '', imageFileId: null, isActive: true });

Page({
  data: { user: {}, products: [], visibleProducts: [], categories: [], units: [], brands: [], search: '', editing: false,
    draft: blank(), selectedId: '', categoryIndex: -1, unitIndex: -1, storageIndex: 0, storageOptions,
    imageUrl: '', imageFile: null, crop: null, loading: false, saving: false, uploading: false, error: '', conflict: false },

  onShow() {
    const user = api.currentUser();
    if (!user) { wx.redirectTo({ url: '/pages/login/index' }); return; }
    if (!(user.roles || []).some(role => ['PURCHASER', 'ADMIN'].includes(role))) { api.openWorkspace('purchaser'); return; }
    if (this.data.user.id !== user.id) {
      this.sequence = (this.sequence || 0) + 1;
      this.setData({ products: [], visibleProducts: [], editing: false, draft: blank(), selectedId: '', imageUrl: '', imageFile: null, crop: null, saving: false, uploading: false });
    }
    this.setData({ user });
    this.loadProducts();
  },
  onUnload() { this.sequence = (this.sequence || 0) + 1; },

  async loadProducts() {
    const sequence = this.sequence;
    this.setData({ loading: true, error: '' });
    try {
      const [products, categories, units, brands] = await Promise.all([api.request('/products'), api.request('/categories'), api.request('/units'), api.request('/brands')]);
      if (sequence !== this.sequence) return;
      this.setData({ products, categories, units, brands: [...new Set([...brands.map(brand => brand.name), ...products.map(product => product.brand)].filter(Boolean))].sort() });
      this.filterProducts();
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  filterProducts() {
    const search = this.data.search.trim().toLowerCase();
    this.setData({ visibleProducts: this.data.products.filter(product => [product.name, product.sku, product.specification, product.brand].some(value => String(value || '').toLowerCase().includes(search))) });
  },
  onSearch(event) { this.setData({ search: event.detail.value }); this.filterProducts(); },
  newProduct() { if (!this.data.saving && !this.data.uploading) this.editProduct(blank()); },
  selectProduct(event) {
    if (this.data.saving || this.data.uploading) return;
    const product = this.data.products.find(item => item.id === event.currentTarget.dataset.id);
    if (product) this.editProduct(product);
  },
  editProduct(product) {
    this.sequence = (this.sequence || 0) + 1;
    this.setData({ editing: true, selectedId: product.id || '', draft: { ...blank(), ...product }, error: '', conflict: false,
      categoryIndex: this.data.categories.findIndex(item => item.id === product.categoryId), unitIndex: this.data.units.findIndex(item => item.id === product.baseUnitId),
      storageIndex: Math.max(0, storageOptions.findIndex(item => item.code === product.storageCondition)), imageUrl: '', imageFile: product.imageFile || null, crop: null });
    if (product.imageFile) this.loadImage(product.imageFile);
  },
  closeEditor() { if (!this.data.saving && !this.data.uploading) { this.sequence++; this.setData({ editing: false, crop: null, imageUrl: '', conflict: false }); } },
  onField(event) {
    if (this.data.saving || this.data.uploading) return;
    const field = event.currentTarget.dataset.field;
    if (['sku', 'defaultSalesPrice', 'name', 'specification', 'brand', 'minOrderQty', 'orderMultiple'].includes(field)) this.setData({ draft: { ...this.data.draft, [field]: event.detail.value } });
  },
  chooseOption(event) {
    if (this.data.saving || this.data.uploading) return;
    const index = Number(event.detail.value), kind = event.currentTarget.dataset.kind;
    const item = (kind === 'category' ? this.data.categories : kind === 'unit' ? this.data.units : storageOptions)[index];
    if (!item) return;
    this.setData({ [`${kind}Index`]: index, draft: { ...this.data.draft, [kind === 'category' ? 'categoryId' : kind === 'unit' ? 'baseUnitId' : 'storageCondition']: item.id || item.code } });
  },
  chooseBrand(event) { if (!this.data.saving && !this.data.uploading) this.setData({ draft: { ...this.data.draft, brand: this.data.brands[Number(event.detail.value)] || '' } }); },
  toggleActive(event) { if (!this.data.saving && !this.data.uploading) this.setData({ draft: { ...this.data.draft, isActive: event.detail.value } }); },
  removeImage() { if (!this.data.saving && !this.data.uploading) this.setData({ draft: { ...this.data.draft, imageFileId: null }, imageFile: null, imageUrl: '' }); },
  async loadImage(file) {
    const sequence = this.sequence;
    try { const imageUrl = await api.imagePath(file); if (sequence === this.sequence && this.data.imageFile && this.data.imageFile.id === file.id) this.setData({ imageUrl }); }
    catch (error) { if (sequence === this.sequence && this.data.imageFile && this.data.imageFile.id === file.id) this.setData({ error: error.message }); }
  },
  async chooseImage() {
    if (this.data.saving || this.data.uploading) return;
    const sequence = this.sequence;
    this.setData({ uploading: true, error: '' });
    try {
      const files = await api.chooseEvidence(1);
      if (files.length && sequence === this.sequence) await this.prepareCrop(files[0].path);
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ uploading: false }); }
  },
  async prepareCrop(path) {
    const sequence = this.sequence;
    const info = await new Promise((resolve, reject) => wx.getImageInfo({ src: path, success: resolve, fail: () => reject(new Error('图片无法读取')) }));
    if (sequence !== this.sequence) return;
    const ratio = 240 / Math.min(info.width, info.height);
    const width = info.width * ratio, height = info.height * ratio;
    this.setData({ crop: { path: info.path || path, baseWidth: width, baseHeight: height, width, height, x: (240 - width) / 2, y: (240 - height) / 2, scale: 1 } });
  },
  onCropMove(event) { if (this.data.crop && !this.data.uploading) this.setData({ crop: { ...this.data.crop, x: event.detail.x, y: event.detail.y } }); },
  onCropZoom(event) {
    if (!this.data.crop || this.data.uploading) return;
    const scale = Number(event.detail.value), width = this.data.crop.baseWidth * scale, height = this.data.crop.baseHeight * scale;
    this.setData({ crop: { ...this.data.crop, scale, width, height, x: (240 - width) / 2, y: (240 - height) / 2 } });
  },
  cancelCrop() { if (!this.data.uploading) this.setData({ crop: null }); },
  async confirmCrop() {
    if (!this.data.crop || this.data.uploading || this.data.saving) return;
    const sequence = this.sequence, crop = this.data.crop;
    this.setData({ uploading: true, error: '' });
    try {
      const context = wx.createCanvasContext('product-crop', this);
      context.setFillStyle('#ffffff'); context.fillRect(0, 0, 240, 240);
      context.drawImage(crop.path, Math.max(240 - crop.width, Math.min(0, crop.x)), Math.max(240 - crop.height, Math.min(0, crop.y)), crop.width, crop.height);
      await new Promise(resolve => context.draw(false, resolve));
      const image = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvasId: 'product-crop', x: 0, y: 0, width: 240, height: 240,
        destWidth: 800, destHeight: 800, fileType: 'jpg', quality: 0.8, success: resolve, fail: () => reject(new Error('图片裁切失败，请重试')) }, this));
      const file = await api.uploadEvidence(image.tempFilePath, 'PRODUCT');
      if (sequence === this.sequence) this.setData({ imageFile: file, imageUrl: image.tempFilePath, crop: null, draft: { ...this.data.draft, imageFileId: file.id } });
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ uploading: false }); }
  },
  async reloadSelected() {
    if (this.data.saving || this.data.uploading) return;
    const id = this.data.selectedId;
    await this.loadProducts();
    const product = this.data.products.find(item => item.id === id);
    if (product) this.editProduct(product);
  },
  async saveProduct() {
    if (this.data.saving || this.data.uploading || this.data.crop) return;
    const sequence = this.sequence, draft = this.data.draft;
    this.setData({ saving: true, error: '', conflict: false });
    try {
      if (!draft.name.trim() || !draft.categoryId || !draft.baseUnitId) throw new Error('请填写商品名称、分类和销售单位');
      const price = String(draft.defaultSalesPrice ?? '').trim();
      if (!price && (!this.data.selectedId || this.data.products.some(product => product.id === this.data.selectedId && product.defaultSalesPrice != null))) throw new Error('请填写默认销售价');
      if (price && (!/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/.test(price))) throw new Error('默认销售价需为非负数字，最多六位小数');
      const body = { name: draft.name.trim(), categoryId: draft.categoryId, baseUnitId: draft.baseUnitId,
        sku: String(draft.sku ?? '').trim() || null,
        ...(price ? { defaultSalesPrice: price } : {}),
        minOrderQty: quantity.validate(draft.minOrderQty), orderMultiple: quantity.validate(draft.orderMultiple),
        specification: draft.specification || null, brand: draft.brand || null, storageCondition: draft.storageCondition || null, imageFileId: draft.imageFileId };
      if (this.data.selectedId) { body.expectedVersion = draft.version; body.isActive = draft.isActive; }
      const product = await api.request(this.data.selectedId ? `/products/${this.data.selectedId}` : '/products', { method: this.data.selectedId ? 'PATCH' : 'POST', data: body });
      if (sequence !== this.sequence) return;
      this.setData({ editing: false, draft: blank(), imageUrl: '', imageFile: null });
      await this.loadProducts();
      if (!product.id) throw new Error('商品保存结果未确认，请刷新列表');
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message, conflict: error.code === 'VERSION_CONFLICT' }); }
    finally { if (sequence === this.sequence) this.setData({ saving: false }); }
  }
});
