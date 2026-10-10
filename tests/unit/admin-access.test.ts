import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedPages, canAccessPage } from '../../apps/admin/src/lib/access.js';

test('admin page whitelist covers the six fixed roles and rejects direct unauthorized routes', () => {
  for (const role of ['ADMIN', 'PURCHASER', 'HQ_FINANCE', 'STORE', 'STORE_FINANCE', 'SUPPLIER']) {
    const user = { roles: [role], scope: { type: role === 'SUPPLIER' ? 'SUPPLIER' : role.startsWith('STORE') ? 'STORE' : 'COMPANY' } };
    assert.ok(canAccessPage(user, '/'));
    for (const page of allowedPages(user)) assert.ok(canAccessPage(user, page));
    assert.equal(canAccessPage(user, '/users'), role === 'ADMIN');
    assert.equal(canAccessPage(user, '/commands'), role === 'ADMIN');
    assert.equal(canAccessPage(user, '/templates'), ['ADMIN', 'PURCHASER'].includes(role));
    assert.equal(canAccessPage(user, '/collection-accounts'), ['ADMIN', 'HQ_FINANCE'].includes(role));
    assert.equal(canAccessPage(user, '/discrepancies'), ['ADMIN', 'SUPPLIER'].includes(role));
    assert.equal(canAccessPage(user, '/store-orders'), role.startsWith('STORE'));
    assert.equal(canAccessPage(user, '/prices'), ['ADMIN', 'PURCHASER', 'HQ_FINANCE'].includes(role));
    assert.equal(canAccessPage(user, '/unregistered'), false);
  }
});

test('unknown or unbound business roles have no pages and scoped roles cannot use company pages', () => {
  for (const roles of [[], ['UNKNOWN'], ['STORE'], ['STORE_FINANCE'], ['SUPPLIER']]) assert.deepEqual(allowedPages({ roles }), []);
  assert.equal(canAccessPage({ roles: ['ADMIN', 'STORE'], scope: { type: 'STORE' } }, '/users'), false);
  assert.equal(canAccessPage({ roles: ['ADMIN'], scope: { type: 'SUPPLIER' } }, '/users'), false);
});
