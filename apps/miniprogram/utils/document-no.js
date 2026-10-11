// Purchase request numbers look like PR20261011082926786622: a PR prefix, a
// 14-digit timestamp and a 4-digit sequence. Rendering all 20 characters makes
// two adjacent rows hard to tell apart, so the date carries the weight and the
// sequence recedes. The full number stays available for copying.
function requestNoParts(value) {
  const text = String(value || '').trim();
  const match = /^([A-Z]+)(\d{4})(\d{2})(\d{2})\d*?(\d{4})$/.exec(text);
  if (!match) return { date: text, sequence: '', full: text, plain: true };
  return {
    date: `${match[1]}${match[2]}-${match[3]}-${match[4]}`,
    sequence: match[5],
    full: text,
    plain: false,
  };
}

module.exports = { requestNoParts };
