import assert from 'node:assert/strict';
import test from 'node:test';
import { effectivePriceVersion } from '../../apps/api/src/pricing/effective-price.js';

test('effective template prices take precedence regardless of newer shared prices', async () => {
  const queries: any[] = [];
  const client = { priceVersion: { findFirst: async (query: any) => {
    queries.push(query);
    return { id: query.where.scope.templateKey ? 'template-price' : 'shared-price', supplyPrice: query.where.scope.templateKey ? '999' : '8' };
  } } };
  const result = await effectivePriceVersion(client as never, 'product', 'supplier', new Date(), 'TEMPLATE');
  assert.equal(result?.id, 'template-price'); assert.equal(result?.supplyVersionId, 'shared-price');
  assert.deepEqual(queries.map(query => query.where.scope.templateKey), ['', 'template']);
  assert.equal(result?.scope.templateKey, 'template'); assert.ok(queries.every(query => query.include === undefined));
  assert.equal(result?.supplyPrice, '8');
});

test('a not-yet-effective template schedule falls back to the shared price at the same business time', async () => {
  const queries: any[] = [];
  const at = new Date('2026-10-04');
  const client = { priceVersion: { findFirst: async (query: any) => {
    queries.push(query);
    return query.where.scope.templateKey ? null : { id: 'shared-price' };
  } } };
  assert.equal((await effectivePriceVersion(client as never, 'product', 'supplier', at, 'template'))?.id, 'shared-price');
  assert.deepEqual(queries.map(query => query.where.effectiveAt.lte), [at, at]);
  assert.deepEqual(queries[0].orderBy, [{ effectiveAt: 'desc' }, { revision: 'desc' }]);
});

test('missing effective prices stay unknown instead of using the product initialization value', async () => {
  const client = { priceVersion: { findFirst: async () => null } };
  assert.equal(await effectivePriceVersion(client as never, 'product', 'supplier', new Date(), 'template'), null);
});

test('template-only versions cannot stand in for missing effective shared cost', async () => {
  const queries: string[] = [];
  const client = { priceVersion: { findFirst: async ({ where }: any) => {
    queries.push(where.scope.templateKey);
    return where.scope.templateKey ? { id: 'template-price', supplyPrice: '999' } : null;
  } } };
  assert.equal(await effectivePriceVersion(client as never, 'product', 'supplier', new Date(), 'template'), null);
  assert.deepEqual(queries, ['']);
});

test('unscoped quotes read only the shared scope and preserve its metadata', async () => {
  let query: any;
  const client = { priceVersion: { findFirst: async (input: any) => {
    query = input;
    return { id: 'shared-price', scopeId: 'shared-scope', supplyPrice: '8' };
  } } };
  const result = await effectivePriceVersion(client as never, 'product', 'supplier', new Date());
  assert.deepEqual(query.where.scope, { productId: 'product', supplierId: 'supplier', templateKey: '' });
  assert.equal(result?.id, 'shared-price'); assert.equal(result?.scopeId, 'shared-scope'); assert.equal(result?.scope.templateKey, '');
  assert.equal(result?.supplyVersionId, 'shared-price');
});
