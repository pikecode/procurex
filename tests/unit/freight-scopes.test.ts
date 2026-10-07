import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedRequest } from '../../apps/api/src/auth/auth.guard.js';
import { FreightConfirmationsController } from '../../apps/api/src/freight-confirmations/freight-confirmations.controller.js';
import { FreightConfirmationsService } from '../../apps/api/src/freight-confirmations/freight-confirmations.service.js';
import { DiscrepanciesController } from '../../apps/api/src/discrepancies/discrepancies.controller.js';

function request(scope: { type: string; supplierId?: string }): AuthenticatedRequest {
  return { auth: { user: { scope } } } as AuthenticatedRequest;
}

test('freight list requires a configured supplier scope and validates status', () => {
  const controller = new FreightConfirmationsController({ list: async () => [] } as never, {} as never, {} as never);
  assert.throws(() => controller.list(request({ type: 'SUPPLIER' })), /Supplier scope is not configured/);
  assert.throws(() => controller.list(request({ type: 'SUPPLIER', supplierId: 's1' }), undefined, 'INVALID'));
});

test('freight list always narrows supplier reads to their own orders', async () => {
  let captured: unknown;
  const service = new FreightConfirmationsService({ client: { freightConfirmation: { findMany: async (args: unknown) => { captured = args; return []; } } } } as never);
  await service.list({ status: 'PENDING' }, { type: 'SUPPLIER', supplierId: 'supplier-1' });
  assert.deepEqual((captured as { where: unknown }).where, { supplierOrderId: undefined, status: 'PENDING', supplierOrder: { supplierId: 'supplier-1' } });
});

test('discrepancy reads cannot silently widen an unconfigured supplier scope', () => {
  const controller = new DiscrepanciesController({ get: async () => ({}) } as never, {} as never, {} as never);
  assert.throws(() => controller.get(request({ type: 'SUPPLIER' }), '11111111-1111-4111-8111-111111111111'), /Supplier scope is not configured/);
});
