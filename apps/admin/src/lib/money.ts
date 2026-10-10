export function money(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return '—';
  const fraction = (match[3] || '').padEnd(3, '0');
  const cents = BigInt(match[2]!) * 100n + BigInt(fraction.slice(0, 2)) + (fraction.charAt(2) >= '5' ? 1n : 0n);
  return `${match[1] && cents !== 0n ? '-' : ''}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
