Component({
  properties: {
    product: { type: Object, value: {} },
    variant: { type: String, value: '' }
  },
  methods: {
    previewImage() {
      const url = this.data.product.imageUrl;
      if (url) wx.previewImage({ current: url, urls: [url] });
    },
    retryImage() {
      this.triggerEvent('retryimage', { productId: this.data.product.id });
    }
  }
});
