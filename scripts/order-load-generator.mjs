import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { assertLoadIsolation, assertLoadApi, runArrivalLoad } from './sustained-load.mjs';

assertLoadIsolation(process.env);
assert.ok(process.send, 'Generator requires its isolated parent IPC channel');
process.once('message', async ({ base, stores, productId }) => {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  try {
    assertLoadApi(base);
    assert.equal(stores.length, 20);
    const successful = [], profiles = [];
    for (const rate of [10, 50, 200]) {
      delay.reset(); delay.enable();
      const profile = await runArrivalLoad({ rate, durationMs: 30000, concurrencyLimit: 128, execute: async index => {
        const store = stores[index % stores.length], key = `load-${rate}-${index}-${randomUUID()}`;
        const body = { storeId: store.id, items: [{ productId, quantity: '1' }] };
        const response = await fetch(base + '/purchase-requests', { method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${store.token}`, 'idempotency-key': key },
          body: JSON.stringify(body) });
        const result = await response.json();
        if (response.status !== 201) throw Object.assign(new Error('Load request failed'), { code: result.code || result.error?.code || `HTTP_${response.status}` });
        assert.equal(result.data.status, 'PENDING_PROCUREMENT');
        assert.equal(result.data.funding.stored.paid, '10.00');
        successful.push({ id: result.data.id, key, body, storeId: store.id });
      } });
      delay.disable();
      profile.generatorEventLoop = { p95Ms: delay.percentile(95) / 1e6, maxMs: delay.max / 1e6 };
      profiles.push(profile);
      process.send({ type: 'profile', profile });
    }
    process.send({ type: 'result', profiles, successful }, () => process.disconnect());
  } catch (error) {
    process.exitCode = 1;
    process.send({ type: 'failure', message: error.message }, () => process.disconnect());
  } finally { delay.disable(); }
});
