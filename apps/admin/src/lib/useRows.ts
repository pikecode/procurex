import { useCallback, useEffect, useState } from 'react';
import { request } from './api';

export function useRows<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<T[]>(path, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setRows(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { rows, loading, error, reload };
}
