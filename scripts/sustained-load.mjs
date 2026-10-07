import assert from 'node:assert/strict';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export function assertLoadIsolation(env) {
  assert.notEqual(env.NODE_ENV, 'production');
  const url = new URL(env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/load_acceptance');
  assert.ok(url.port && url.port !== '55438');
  assert.match(env.LOAD_RUN_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(env.LOAD_ROOT, `/private/tmp/procurex-load-${env.LOAD_RUN_ID}`);
  assert.equal(env.PRIVATE_FILE_DIR, join(env.LOAD_ROOT, 'files'));
  return url.toString();
}

export function assertLoadApi(base) {
  const url = new URL(base);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(url.port && !['3114', '3000'].includes(url.port));
  assert.equal(url.pathname, '/api/v1');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  return base;
}

export function summarizeLoad(samples, { rate, durationMs, dropped, maxInFlight, elapsedMs }) {
  const durations = samples.map(item => item.durationMs).sort((a, b) => a - b);
  const successful = samples.filter(item => !item.error);
  const steadyStart = 5000, steadyEnd = durationMs - 5000;
  const steady = successful.filter(item => item.completedAtMs >= steadyStart && item.completedAtMs < steadyEnd);
  const steadyQps = steady.length * 1000 / (steadyEnd - steadyStart);
  return { offeredQps: rate, durationMs, planned: Math.floor(rate * durationMs / 1000),
    dispatched: samples.length, succeeded: successful.length, errors: samples.length - successful.length, dropped,
    maxInFlight, elapsedMs, completedQpsIncludingDrain: successful.length * 1000 / elapsedMs,
    steadyWindow: { fromMs: steadyStart, toMs: steadyEnd, completions: steady.length, qps: steadyQps },
    p50Ms: durations[Math.max(0, Math.ceil(durations.length * 0.5) - 1)] ?? 0,
    p95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0,
    errorsByCode: samples.filter(item => item.error).reduce((counts, item) => {
      counts[item.error] = (counts[item.error] || 0) + 1; return counts;
    }, {}),
    targetMet: dropped === 0 && successful.length === Math.floor(rate * durationMs / 1000) && steadyQps >= rate };
}

export async function runArrivalLoad({ rate, durationMs, concurrencyLimit, execute }) {
  assert.ok(Number.isInteger(rate) && rate > 0 && durationMs >= 15000 && concurrencyLimit > 0);
  const started = performance.now(), count = Math.floor(rate * durationMs / 1000);
  const flights = new Set(), samples = [];
  let dropped = 0, maxInFlight = 0;
  const droppedByReason = { schedulerLate: 0, inFlightLimit: 0 };
  for (let index = 0; index < count; index++) {
    const due = started + index * 1000 / rate;
    const delay = due - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    // Missed arrivals are counted, never converted into a later burst or hidden queue.
    if (performance.now() - due > 100) { dropped++; droppedByReason.schedulerLate++; continue; }
    if (flights.size >= concurrencyLimit) { dropped++; droppedByReason.inFlightLimit++; continue; }
    const requestStarted = performance.now();
    let flight;
    flight = (async () => {
      let error;
      try { await execute(index); } catch (failure) { error = typeof failure?.code === 'string' ? failure.code : failure?.name || 'UNKNOWN'; }
      samples.push({ durationMs: performance.now() - requestStarted, completedAtMs: performance.now() - started,
        ...(error ? { error } : {}) });
    })().finally(() => flights.delete(flight));
    flights.add(flight); maxInFlight = Math.max(maxInFlight, flights.size);
  }
  await Promise.all(flights);
  while (performance.now() - started < durationMs) {
    await new Promise(resolve => setTimeout(resolve, durationMs - (performance.now() - started)));
  }
  return { ...summarizeLoad(samples, { rate, durationMs, dropped, maxInFlight, elapsedMs: performance.now() - started }), droppedByReason };
}
