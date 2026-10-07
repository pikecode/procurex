import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { assertLoadIsolation } from './sustained-load.mjs';

export function observeLoadDatabase(service) {
  const connectionString = assertLoadIsolation(process.env);
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
  let queries = new Map(), samples = 0, samplingErrors = 0, pending, stopped = false;
  let waits = new Map();
  const original = service.client;
  service.client = original.$extends({ query: { $allOperations: async ({ model, operation, args, query }) => {
    const started = performance.now();
    try { return await query(args); }
    finally {
      const key = `${model ?? 'RAW'}.${operation}`, duration = performance.now() - started;
      const value = queries.get(key) ?? { operation: key, count: 0, totalMs: 0, maxMs: 0 };
      value.count++; value.totalMs += duration; value.maxMs = Math.max(value.maxMs, duration); queries.set(key, value);
    }
  } } });
  async function sample() {
    if (stopped || pending) return;
    pending = (async () => {
      try {
        const result = await pool.query(`SELECT state, wait_event_type, wait_event, count(*)::int AS connections
          FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
          GROUP BY state, wait_event_type, wait_event`);
        samples++;
        for (const row of result.rows) {
          const key = `${row.state}/${row.wait_event_type ?? 'NONE'}/${row.wait_event ?? 'NONE'}`;
          const value = waits.get(key) ?? { state: row.state, waitType: row.wait_event_type, waitEvent: row.wait_event, observedConnections: 0, maxConnections: 0 };
          value.observedConnections += row.connections; value.maxConnections = Math.max(value.maxConnections, row.connections); waits.set(key, value);
        }
      } catch { samplingErrors++; }
    })();
    try { await pending; } finally { pending = undefined; }
  }
  const timer = setInterval(() => { void sample(); }, 500);
  return {
    snapshot() {
      const result = { scope: 'Diagnostic run only; Prisma operation counts are not SQL statement counts; timing includes client wait, not pure SQL time; no SQL parameters recorded',
        queries: [...queries.values()].sort((a, b) => b.totalMs - a.totalMs).map(value => ({ ...value, averageMs: value.totalMs / value.count })),
        connectionSampling: { intervalMs: 500, samples, errors: samplingErrors, states: [...waits.values()] } };
      queries = new Map(); waits = new Map(); samples = 0; samplingErrors = 0;
      return result;
    },
    async close() { stopped = true; clearInterval(timer); if (pending) await pending; service.client = original; await pool.end(); },
  };
}
