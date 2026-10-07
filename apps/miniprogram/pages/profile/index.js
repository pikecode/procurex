const api = require('../../utils/api');

const settlements = { STORED_VALUE: '储值', CREDIT: '授信', COMPANY_TERM: '公司账期', SUPPLIER_TERM: '供应商直接账期' };
const cycles = { IMMEDIATE: '现结', MONTHLY: '月结', HALF_MONTHLY: '半月结', WEEKLY: '周结' };
const storeTypes = { DIRECT: '直营店', FRANCHISE: '加盟店', JOINT: '联营店' };
Page({
  data: { kind: '', activeView: 'profile', profile: null, fields: [], products: [], visibleProducts: [], search: '', loading: false, error: '' },
  onLoad(options) { this.setData({ kind: options.kind === 'supplier' ? 'supplier' : options.kind === 'store' ? 'store' : '' }); },
  onShow() { this.loadProfile(); },
  onHide() { this.sequence = (this.sequence || 0) + 1; },
  onUnload() { this.sequence = (this.sequence || 0) + 1; },
  changeView(event) { this.setData({ activeView: event.currentTarget.dataset.view }); },
  onSearch(event) { this.setData({ search: event.detail.value }); this.filterProducts(); },
  filterProducts() {
    const search = this.data.search.trim().toLowerCase();
    this.setData({ visibleProducts: this.data.products.filter(item => [item.name, item.sku, item.specification].some(value => String(value || '').toLowerCase().includes(search))) });
  },
  async loadProfile() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ profile: null, fields: [], products: [], visibleProducts: [], loading: true, error: '' });
    const user = api.currentUser();
    if (!user) { this.setData({ loading: false }); wx.redirectTo({ url: '/pages/login/index' }); return; }
    const supplier = this.data.kind === 'supplier';
    const id = user.scope && user.scope[supplier ? 'supplierId' : 'storeId'];
    const allowed = supplier ? user.roles.includes('SUPPLIER') : user.roles.some(role => ['STORE', 'STORE_FINANCE'].includes(role));
    if (!this.data.kind || !allowed || !id) { this.setData({ loading: false, error: '账号尚未配置所属门店或供应商' }); return; }
    const active = () => sequence === this.sequence && (api.currentUser() || {}).id === user.id;
    try {
      const profile = await api.request(`/${supplier ? 'suppliers' : 'stores'}/${id}`);
      if (!active()) return;
      const entries = [['编号', profile.code], ['名称', profile.name], ['联系人', profile.contactName], ['联系电话', profile.contactPhone], ['地址', profile.address]];
      if (supplier) entries.push(['开户银行', profile.bankName], ['银行户名', profile.bankAccountName], ['银行账号', profile.bankAccount], ['纳税人识别号', profile.taxpayerId], ['开票抬头', profile.invoiceTitle], ['配送方式', profile.deliveryMode === 'SELF' ? '自配送' : '物流'], ['运费', profile.requiresFreight == null ? '未设置' : profile.requiresFreight ? '需要运费' : '无运费'], ['结算方式', settlements[profile.defaultSettlementMode]], ['结算周期', cycles[profile.defaultSettlementCycle] || profile.defaultSettlementCycle], ['周期说明', profile.settlementCycleDescription], ['备注', profile.remark]);
      else entries.push(['分组', profile.groupName], ['门店类型', storeTypes[profile.storeType] || profile.storeType], ['收货地址', profile.receiptAddress || profile.address], ['收货人', profile.receiptContactName || profile.contactName], ['收货电话', profile.receiptContactPhone || profile.contactPhone]);
      entries.push(['状态', profile.isArchived ? '已归档' : profile.status === 'ACTIVE' ? '启用' : '停用']);
      this.setData({ profile, fields: entries.map(([label, value]) => ({ label, value: value == null || value === '' ? '未配置' : value })) });
      if (supplier) {
        const catalog = await api.request(`/suppliers/${id}/catalog`);
        if (!active()) return;
        this.setData({ products: catalog.items }); this.filterProducts();
      }
    } catch (error) { if (active()) this.setData({ error: error.message }); }
    finally { if (active()) this.setData({ loading: false }); }
  }
});
