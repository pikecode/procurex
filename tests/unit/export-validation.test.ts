import assert from 'node:assert/strict';
import test from 'node:test';
import { ExportsController } from '../../apps/api/src/reports/exports.controller.js';

test('export status, download and retry reject malformed IDs before reading storage', async () => {
  const controller = new ExportsController({} as never);
  await assert.rejects(controller.status('undefined', {} as never), /Request validation failed/);
  await assert.rejects(controller.retry('undefined', {} as never), /Request validation failed/);
  await assert.rejects(controller.download('undefined', {} as never, {} as never), /Request validation failed/);
});
