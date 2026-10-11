const { requestNoParts } = require('../../utils/document-no');

Component({
  properties: {
    value: { type: String, value: '' },
  },
  observers: {
    value(next) {
      if (this.data.parts.full !== next) this.setData({ parts: requestNoParts(next) });
    },
  },
  data: { parts: { date: '', sequence: '', full: '', plain: true } },
});
