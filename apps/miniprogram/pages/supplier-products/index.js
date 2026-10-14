const api = require('../../utils/api');

Page({
  data: {
    products: [], categories: [], childCategories: [], subcategories: [], visibleProducts: [], primaryCategoryId: '', categoryId: '', search: '',
    supplierName: '', loading: false, saving: '', error: ''
  },
  onShow() { this.loadProducts(); },
  onHide() { this.sequence = (this.sequence || 0) + 1; },
  onUnload() { this.sequence = (this.sequence || 0) + 1; },
  onSearch(event) { this.setData({ search: event.detail.value, primaryCategoryId: '', categoryId: '', subcategories: [] }); this.filterProducts(); },
  choosePrimaryCategory(event) {
    const id = event.currentTarget.dataset.id || '';
    const children = this.data.childCategories.filter(item => item.parentId === id);
    this.setData({ primaryCategoryId: id, categoryId: '', subcategories: children.length ? [{ id: '', name: '全部' }, ...children] : [] });
    this.filterProducts();
  },
  chooseCategory(event) {
    const id = event.currentTarget.dataset.id || '';
    if (id && !this.data.subcategories.some(item => item.id === id)) return;
    this.setData({ categoryId: id }); this.filterProducts();
  },
  filterProducts() {
    const search = this.data.search.trim().toLowerCase();
    this.setData({ visibleProducts: this.data.products.filter(item => {
      const categoryMatch = (!this.data.primaryCategoryId || (item.categoryParentId || item.categoryId) === this.data.primaryCategoryId)
        && (!this.data.categoryId || item.categoryId === this.data.categoryId);
      return categoryMatch && [item.name, item.sku, item.specification].some(value => String(value || '').toLowerCase().includes(search));
    }) });
  },
  async changeListing(event) {
    if (this.data.saving) return;
    const item = this.data.products.find(row => row.id === event.currentTarget.dataset.id);
    const user = api.currentUser();
    if (!item || !item.productActive || !user?.scope?.supplierId) return;
    const sequence = this.sequence, actorId = user.id;
    this.setData({ saving: item.id, error: '' });
    const active = () => sequence === this.sequence && api.currentUser()?.id === actorId;
    try {
      const result = await new Promise(resolve => wx.showModal({
        title: item.supplyEnabled ? '确认下架商品' : '确认上架商品',
        content: item.supplyEnabled ? `${item.name} 下架后将不再分配新订单，历史订单不受影响。` : `${item.name} 上架后可重新参与新订单分配。`,
        confirmText: item.supplyEnabled ? '确认下架' : '确认上架', success: resolve, fail: () => resolve({ confirm: false })
      }));
      if (!result.confirm || !active()) return;
      await api.request(`/suppliers/${user.scope.supplierId}/managed-products/${item.id}`, {
        method: 'PATCH', data: { supplyEnabled: !item.supplyEnabled, expectedVersion: item.version }
      });
      if (active()) await this.loadProducts();
    } catch (error) { if (active()) this.setData({ error: error.message }); }
    finally { this.setData({ saving: '' }); }
  },
  async loadProducts() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const user = api.currentUser();
    const supplierId = user?.scope?.supplierId;
    if (!user) { wx.redirectTo({ url: '/pages/login/index' }); return; }
    if (!user.roles.includes('SUPPLIER') || !supplierId) { this.setData({ products: [], categories: [], childCategories: [], subcategories: [], primaryCategoryId: '', categoryId: '', visibleProducts: [], loading: false, error: '账号尚未配置所属供应商' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const catalog = await api.request(`/suppliers/${supplierId}/managed-products`);
      if (sequence !== this.sequence) return;
      const products = (Array.isArray(catalog.items) ? catalog.items : []).map(item => ({ ...item, imageUrl: '', imageFailed: false }));
      const primary = new Map(), children = new Map();
      for (const item of products) {
        const primaryId = item.categoryParentId || item.categoryId;
        const primaryName = item.categoryParentName || item.categoryName || '未分类';
        if (!primary.has(primaryId)) primary.set(primaryId, { id: primaryId, key: primaryId || 'uncategorized', name: primaryName, level: 1, count: 0 });
        primary.get(primaryId).count += 1;
        if (item.categoryParentId && !children.has(item.categoryId)) children.set(item.categoryId, { id: item.categoryId, key: item.categoryId, name: item.categoryName || '未分类', parentId: item.categoryParentId, level: 2, count: 0 });
        if (item.categoryParentId) children.get(item.categoryId).count += 1;
      }
      const categories = [{ id: '', key: 'all', name: '全部商品', level: 0, count: products.length }];
      categories.push(...primary.values());
      const primaryCategoryId = categories.some(item => item.id === this.data.primaryCategoryId) ? this.data.primaryCategoryId : '';
      const childCategories = [...children.values()];
      const selectedChildren = childCategories.filter(item => item.parentId === primaryCategoryId);
      const categoryId = selectedChildren.some(item => item.id === this.data.categoryId) ? this.data.categoryId : '';
      this.setData({ supplierName: user.displayName || '当前供应商', products, categories, childCategories, primaryCategoryId, categoryId,
        subcategories: selectedChildren.length ? [{ id: '', name: '全部' }, ...selectedChildren] : [] });
      this.filterProducts();
      this.loadImages(products, sequence);
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  async loadImages(products, sequence) {
    const images = products.filter(item => item.imageFile);
    for (let index = 0; index < images.length && sequence === this.sequence; index += 4) {
      await Promise.all(images.slice(index, index + 4).map(item => this.loadImage(item, sequence)));
    }
  },
  async loadImage(product, sequence = this.sequence) {
    if (!product.imageFile) return;
    let imageUrl = '', imageFailed = false;
    try { imageUrl = await api.imagePath(product.imageFile); } catch { imageFailed = true; }
    if (sequence !== this.sequence) return;
    this.setData({ products: this.data.products.map(item => item.id === product.id ? { ...item, imageUrl, imageFailed } : item) });
    this.filterProducts();
  },
  retryProductImage(event) {
    const item = this.data.products.find(row => row.id === event.detail.productId);
    if (item) this.loadImage(item);
  }
});
