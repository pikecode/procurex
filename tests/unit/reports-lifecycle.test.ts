import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportsService } from '../../apps/api/src/reports/reports.service.js';

test('export shutdown stops the timer and waits for in-flight maintenance', async () => {
  let finish!: () => void;
  let calls = 0;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const service = new ReportsService({ client: {} } as any);
  (service as any).processQueuedExports = async () => { calls++; await blocked; };
  service.onModuleInit();
  const maintenance = (service as any).runMaintenance();
  assert.equal((service as any).runMaintenance(), maintenance);
  let stopped = false;
  const shutdown = service.onModuleDestroy().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  await (service as any).runMaintenance();
  assert.equal(calls, 1);
  finish();
  await shutdown;
  assert.equal(stopped, true);
  assert.equal((service as any).timer._destroyed, true);
  await (service as any).runMaintenance();
  assert.equal(calls, 1);
});
