import { useEffect, useRef, useState } from 'react';
import { ApiError, hasRole, request, type User } from './api';

type Command = { key: string; path: string; method: 'POST' | 'PATCH'; body: Record<string, unknown>; label: string };
const keyFor = (userId: string) => `procurex-admin-purchase-command-v1:${userId}`;
export const adminCommandPath = (path: string) => /^\/commands\/[0-9a-f-]{36}\/(reviews|close-rolled-back-price|close-uncommitted-price)$/.test(path);
const financePath = (path: string) => /^\/stores\/[0-9a-f-]{36}\/(recharges|clearings|credit-limit)$/.test(path) || path === '/payment-records' || /^\/payment-records\/[0-9a-f-]{36}\/(confirm|reject|cancel)$/.test(path) || path === '/difference-disposals' || /^\/difference-disposals\/[0-9a-f-]{36}\/confirm$/.test(path);
const allowed = (path: string) => financePath(path) || path === '/purchase-requests' || /^\/purchase-requests\/[0-9a-f-]{36}\/(confirm|reject|items|assign|reallocate)$/.test(path) || /^\/supplier-orders\/[0-9a-f-]{36}\/(reject|reconcile-funding|shipments|freight-confirmations)$/.test(path) || /^\/freight-confirmations\/[0-9a-f-]{36}\/(confirm|reject)$/.test(path) || /^\/shipments\/[0-9a-f-]{36}\/receipts$/.test(path) || /^\/discrepancies\/[0-9a-f-]{36}\/resolve$/.test(path);
export const canRecoverWorkflow = (user: User, path?: string) => hasRole(user, 'ADMIN') || (hasRole(user, 'HQ_FINANCE') && Boolean(path && financePath(path))) || (hasRole(user, 'PURCHASER') && Boolean(path && (path.startsWith('/purchase-requests') || path.endsWith('/reconcile-funding') || path.startsWith('/freight-confirmations/'))));
export function useWorkflowCommand(userId: string) {
  const [pending, setPending] = useState<Command | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [ready, setReady] = useState(false); const [storageError, setStorageError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    setPending(null); setReady(false); setStorageError(''); setError('');
    try {
      const saved = localStorage.getItem(keyFor(userId));
      if (saved) {
        const command = JSON.parse(saved) as Command;
        if (!(allowed(command.path) || adminCommandPath(command.path)) || !['POST', 'PATCH'].includes(command.method) || typeof command.key !== 'string' || !command.key || !command.body || typeof command.body !== 'object' || Array.isArray(command.body)) throw new Error('提交恢复记录异常，请核查原提交，不能直接重新提交。');
        setPending(command);
      }
    } catch (failure) { setStorageError((failure as Error).message); }
    setReady(true);
  }, [userId]);
  async function run(command: Command): Promise<boolean> {
    if (lock.current || !ready || storageError) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(command)); setPending(command);
      await request(command.path, { method: command.method, body: command.body, headers: { 'Idempotency-Key': command.key } });
      localStorage.removeItem(keyFor(userId)); setPending(null); return true;
    } catch (failure) {
      setError((failure as Error).message);
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500 && ![401, 403, 408, 429].includes(failure.status)
        && !['COMMAND_PROCESSING', 'COMMAND_STATE_CHANGED', 'IDEMPOTENCY_KEY_REUSED'].includes(failure.code || '')) {
        try { localStorage.removeItem(keyFor(userId)); setPending(null); } catch { setStorageError('原提交记录无法清理，请核查后再操作。'); }
      }
      return false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function submit(input: Omit<Command, 'key'>) {
    if (pending || lock.current || !ready || storageError) return false;
    try {
      if (localStorage.getItem(keyFor(userId))) { setStorageError('检测到其他页面的待确认提交，请刷新恢复原提交。'); return false; }
    } catch { setStorageError('无法读取提交记录，暂不能提交操作。'); return false; }
    return run({ ...input, key: crypto.randomUUID() });
  }
  return { pending, busy, error: error || storageError, blocked: !ready || busy || Boolean(pending) || Boolean(storageError),
    clearError: () => setError(''), submit,
    recover: () => pending ? run(pending) : Promise.resolve(false) };
}
