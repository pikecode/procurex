export function createCommandId(source: Crypto = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  // HTTP IP addresses lack randomUUID, but still support secure random bytes.
  if (typeof source?.getRandomValues !== 'function') throw new Error('当前浏览器不支持安全提交，请更换浏览器。');
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
