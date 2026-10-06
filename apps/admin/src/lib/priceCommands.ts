import { ApiError, request } from './api';

export interface PendingPriceCommand { key: string; path: string; body: Record<string, unknown>; createdAt: string }
const storageKey = (userId: string) => `procurex-admin-price-command-v1:${userId}`;
export function readPriceCommand(userId: string): PendingPriceCommand | null {
  const saved = localStorage.getItem(storageKey(userId));
  if (!saved) return null;
  const value = JSON.parse(saved) as PendingPriceCommand;
  if (typeof value.key !== 'string' || !value.body || typeof value.body !== 'object' || Array.isArray(value.body)
    || !(value.path === '/price-changes' || /^\/jobs\/[0-9a-f-]{36}\/process$/.test(value.path))) throw new Error('价格提交恢复记录异常，请核查，不能直接重新发布。');
  return value;
}
export function keepPriceCommand(userId: string, command: PendingPriceCommand) {
  localStorage.setItem(storageKey(userId), JSON.stringify(command));
}
export function clearPriceCommand(userId: string) { localStorage.removeItem(storageKey(userId)); }
export async function executePriceCommand<T>(command: PendingPriceCommand): Promise<T> {
  return request<T>(command.path, { method: 'POST', body: command.body, headers: { 'Idempotency-Key': command.key } });
}
export function isDefinitePriceRejection(failure: unknown) {
  return failure instanceof ApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 401 && failure.status !== 408 && failure.status !== 429
    && !['COMMAND_PROCESSING', 'COMMAND_STATE_CHANGED', 'IDEMPOTENCY_KEY_REUSED'].includes(failure.code || '');
}
