import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3114/api/v1';
const { LOCAL_ADMIN_USERNAME: adminName, LOCAL_ADMIN_PASSWORD: adminPassword, LOCAL_TEST_PASSWORD: initialPassword } = process.env;
if (!adminName || !adminPassword || !initialPassword) throw new Error('Provide local administrator and test-account credentials');
const username = `account_acceptance_${Date.now().toString(36)}`;
const nextPassword = `${initialPassword}2`; const finalPassword = `${initialPassword}3`;
let admin; const tokens = [];
async function call(path, token, body, method = body ? 'POST' : 'GET', expected) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (expected) { assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`); return result; }
  assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`); return result.data;
}
async function login(name, password) { const result = await call('/auth/login', null, { username: name, password, client: 'WEB' }); tokens.push(result.accessToken); return result.accessToken; }
try {
  admin = await login(adminName, adminPassword);
  const user = await call('/users', admin, { username, displayName: '账号管理验收', role: 'PURCHASER', password: initialPassword });
  const current = async id => (await call('/users', admin)).find(row => row.id === id);
  const actor = (await call('/me', admin)).user;
  await call(`/users/${actor.id}`, admin, { expectedVersion: (await current(actor.id)).version, status: 'DISABLED' }, 'PATCH', 400);
  const first = await login(username, initialPassword); const second = await login(username, initialPassword);
  await call(`/users/${user.id}/password`, first, { expectedVersion: user.version, password: nextPassword }, 'POST', 403);
  await call(`/users/${user.id}/password`, admin, { expectedVersion: user.version + 1, password: nextPassword }, 'POST', 409);
  await call(`/users/${user.id}/password`, admin, { expectedVersion: user.version, password: nextPassword });
  await call('/me', first, null, 'GET', 401); await call('/me', second, null, 'GET', 401);
  await call('/auth/login', null, { username, password: initialPassword, client: 'WEB' }, 'POST', 401);
  const third = await login(username, nextPassword);
  await call('/auth/password', third, { currentPassword: 'incorrect', password: finalPassword }, 'POST', 400);
  await call('/me', third);
  await call('/auth/password', third, { currentPassword: nextPassword, password: finalPassword });
  await call('/me', third, null, 'GET', 401);
  const fourth = await login(username, finalPassword);
  await call(`/users/${user.id}`, admin, { expectedVersion: (await current(user.id)).version, role: 'STORE', scope: { type: 'COMPANY' } }, 'PATCH', 400);
  await call(`/users/${user.id}`, admin, { expectedVersion: (await current(user.id)).version, role: 'HQ_FINANCE', scope: { type: 'COMPANY' } }, 'PATCH');
  await call('/me', fourth, null, 'GET', 401);
  const fifth = await login(username, finalPassword);
  assert.deepEqual((await call('/me', fifth)).user.roles, ['HQ_FINANCE']);
  const store = (await call('/stores', admin)).find(row => row.status === 'ACTIVE'); assert.ok(store);
  await call(`/users/${user.id}`, admin, { expectedVersion: (await current(user.id)).version, role: 'STORE', scope: { type: 'STORE', storeId: store.id } }, 'PATCH');
  await call('/me', fifth, null, 'GET', 401);
  const sixth = await login(username, finalPassword); assert.equal((await call('/me', sixth)).user.scope.storeId, store.id);
  await call(`/users/${user.id}/revoke-sessions`, admin, {}); await call('/me', sixth, null, 'GET', 401);
  const seventh = await login(username, finalPassword);
  await call(`/users/${user.id}`, admin, { expectedVersion: (await current(user.id)).version, status: 'DISABLED' }, 'PATCH');
  await call('/me', seventh, null, 'GET', 401);
  await call('/auth/login', null, { username, password: finalPassword, client: 'WEB' }, 'POST', 401);
  await call(`/users/${user.id}`, admin, { expectedVersion: (await current(user.id)).version, status: 'ACTIVE' }, 'PATCH');
  await call('/me', seventh, null, 'GET', 401); await login(username, finalPassword);
  const logs = await call(`/audit-logs?entityType=User&entityId=${user.id}`, admin);
  for (const action of ['user.password-reset', 'user.password-change', 'user.sessions-revoke', 'user.update']) assert.ok(logs.some(row => row.action === action), action);
  for (const secret of [initialPassword, nextPassword, finalPassword, 'passwordHash']) assert.ok(!JSON.stringify(logs).includes(secret));
  // Keep the real acceptance record, but leave this one-off account disabled.
  await call(`/users/${user.id}`, admin, { expectedVersion: (await current(user.id)).version, status: 'DISABLED' }, 'PATCH');
  console.log(JSON.stringify({ username, status: 'PASSED', finalStatus: 'DISABLED', auditRecords: logs.length, usesOnlyBusinessApis: true }));
} finally {
  for (const token of tokens) await call('/auth/logout', token, {}).catch(() => {});
}
