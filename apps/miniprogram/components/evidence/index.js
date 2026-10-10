const api = require('../../utils/api');
Component({
  properties: { files: { type: Array, value: [], observer: 'loadFiles' } },
  data: { rows: [], opening: false, error: '' },
  lifetimes: { detached() { this.sequence = (this.sequence || 0) + 1; } },
  methods: {
    async loadFiles(files) {
      const sequence = this.sequence = (this.sequence || 0) + 1;
      const actor = api.currentUser()?.id;
      this.setData({ rows: files.map(file => ({ ...file, loading: String(file.mimeType || '').startsWith('image/') })), error: '' });
      await Promise.all(files.map(async (file, index) => {
        if (!String(file.mimeType || '').startsWith('image/')) return;
        try {
          const path = await api.downloadEvidence(file);
          if (sequence !== this.sequence || api.currentUser()?.id !== actor) return;
          this.setData({ [`rows[${index}].path`]: path, [`rows[${index}].loading`]: false });
        } catch (_) {
          if (sequence === this.sequence) this.setData({ [`rows[${index}].loading`]: false, [`rows[${index}].failed`]: true });
        }
      }));
    },
    async open(event) {
      if (this.data.opening) return;
      const file = this.data.rows.find(item => item.id === event.currentTarget.dataset.id);
      if (!file) return;
      this.setData({ opening: true, error: '' });
      try { await api.previewEvidence(file); }
      catch (error) { this.setData({ error: error.message }); }
      finally { this.setData({ opening: false }); }
    }
  }
});
