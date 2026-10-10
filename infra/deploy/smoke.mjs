import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = process.env.DEPLOY_BASE_URL ?? 'http://127.0.0.1:8080';
const credentials = JSON.parse(readFileSync(process.env.DEPLOY_CREDENTIALS_FILE ?? '/opt/procurex/shared/admin.json', 'utf8'));
const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
for (const path of ['/', '/products', '/templates', '/stores', '/suppliers']) {
  const response = await call(path);
  assert.equal(response.status, 200, path);
  assert.match(await response.text(), /<div id="root"><\/div>/);
}
assert.equal((await call('/api/v1/health/ready')).status, 200);
assert.equal((await call('/api/v1/products')).status, 401);
const login = await call('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, client: 'DEPLOY_SMOKE' }) });
assert.equal(login.status, 201);
const { data } = await login.json();
assert.ok(data.user.roles.includes('ADMIN'));
const headers = { Authorization: `Bearer ${data.accessToken}` };
try {
  for (const path of ['/me', '/products', '/stores', '/suppliers', '/templates', '/units', '/categories']) {
    assert.equal((await call(`/api/v1${path}`, { headers })).status, 200, path);
  }
} finally {
  assert.equal((await call('/api/v1/auth/logout', { method: 'POST', headers })).status, 201);
}
console.log('PASS: SPA routes, database readiness, unauthorized rejection, administrator login, catalog reads, logout');
