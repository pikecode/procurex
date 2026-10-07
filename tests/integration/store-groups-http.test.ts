import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ApiExceptionFilter } from '../../apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../../apps/api/src/common/response-envelope.interceptor.js';
import { PrismaClient } from '../../packages/backend/generated/prisma/client.js';
import { hashPassword } from '../../packages/domain/src/password.js';
import { AuditService } from '../../apps/api/src/audit/audit.service.js';

test('store groups enforce roles, uniqueness, versions, membership, disabled assignment and audited deletion', async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public' }) });
  const prefix = `ITGROUP${Date.now()}`;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  const actorIds: string[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const tokenFor = async (code: string) => {
      const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
      const username = `${prefix}${code}`;
      const user = await db.user.create({ data: { username, displayName: code, passwordHash: await hashPassword('correct-password'), roles: { create: { roleId: role.id } } } });
      actorIds.push(user.id);
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-password', client: 'WEB' }) });
      assert.equal(response.status, 201); return (await response.json() as any).data.accessToken as string;
    };
    const admin = await tokenFor('ADMIN'), purchaser = await tokenFor('PURCHASER'), finance = await tokenFor('HQ_FINANCE'), supplier = await tokenFor('SUPPLIER');
    const call = async (path: string, method = 'GET', body?: object, token = admin) => {
      const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() as any };
    };
    assert.equal((await call('/store-groups', 'GET', undefined, '')).status, 401);
    assert.equal((await call('/store-groups', 'GET', undefined, supplier)).status, 403);
    for (const token of [purchaser, finance]) {
      assert.equal((await call('/store-groups', 'GET', undefined, token)).status, 200);
      assert.equal((await call('/store-groups', 'POST', { name: prefix }, token)).status, 403);
    }
    for (const name of ['', '   ', 'x'.repeat(121), null]) assert.equal((await call('/store-groups', 'POST', { name })).status, 400);
    const creates = await Promise.all([call('/store-groups', 'POST', { name: ` ${prefix} ` }), call('/store-groups', 'POST', { name: prefix })]);
    assert.deepEqual(creates.map(result => result.status).sort(), [201, 409]);
    const group = creates.find(result => result.status === 201)!.body.data;
    const payload = { code: prefix, name: 'Group store', contactName: 'Contact', contactPhone: '13800000000', address: 'Test address', storeType: 'DIRECT', groupName: prefix };
    assert.equal((await call('/stores', 'POST', { ...payload, groupName: `${prefix}MISSING` })).status, 404);
    const created = await call('/stores', 'POST', payload); assert.equal(created.status, 201);
    const store = created.body.data;
    assert.equal(store.code, prefix);
    const { code: unusedCode, ...automaticPayload } = payload;
    const automatic = await Promise.all([1, 2].map(index => call('/stores', 'POST', { ...automaticPayload, name: `${prefix}自动门店${index}` })));
    for (const result of automatic) {
      assert.equal(result.status, 201);
      assert.match(result.body.data.code, /^MD[A-F0-9]{32}$/);
    }
    assert.notEqual(automatic[0]!.body.data.code, automatic[1]!.body.data.code);
    await db.store.deleteMany({ where: { name: { startsWith: `${prefix}自动门店` } } });
    for (const code of ['', '   ', null, 12, 'x'.repeat(81)]) assert.equal((await call('/stores', 'POST', { ...payload, code })).status, 400);
    const audit = app.get(AuditService), originalAudit = audit.record.bind(audit);
    try {
      audit.record = async (input, tx) => { await originalAudit(input, tx); if (input.entityType === 'StoreGroup') throw new Error('Injected group audit failure'); };
      assert.equal((await call('/store-groups', 'POST', { name: `${prefix}FAIL` })).status, 500);
      assert.equal(await db.storeGroup.count({ where: { name: `${prefix}FAIL` } }), 0);
      assert.equal((await call(`/store-groups/${group.id}`, 'PATCH', { name: `${prefix}FAIL`, status: 'DISABLED', expectedVersion: group.version })).status, 500);
      const preserved = await db.storeGroup.findUniqueOrThrow({ where: { id: group.id } });
      assert.equal(preserved.name, prefix); assert.equal(preserved.status, 'ACTIVE'); assert.equal(preserved.version, group.version);
      assert.equal((await db.store.findUniqueOrThrow({ where: { id: store.id } })).updatedAt.getTime(), store.version);
      assert.equal((await db.store.findUniqueOrThrow({ where: { id: store.id } })).groupName, prefix);
    } finally { audit.record = originalAudit; }
    assert.equal((await call('/store-groups')).body.data.find((row: any) => row.id === group.id).storeCount, 1);
    assert.equal((await call(`/store-groups/${group.id}`, 'DELETE', { expectedVersion: group.version })).body.code, 'STORE_GROUP_IN_USE');
    await assert.rejects(db.storeGroup.delete({ where: { id: group.id } }));
    assert.equal((await call(`/store-groups/${group.id}`, 'PATCH', { name: 'Forbidden', expectedVersion: group.version }, finance)).status, 403);
    assert.equal((await call(`/store-groups/${group.id}`, 'DELETE', { expectedVersion: group.version }, purchaser)).status, 403);
    assert.equal((await call(`/store-groups/${group.id}`, 'PATCH', { status: 'OTHER', expectedVersion: group.version })).status, 400);
    assert.equal((await call(`/store-groups/${group.id}`, 'PATCH', { name: null, expectedVersion: group.version })).status, 400);
    const rename = await call(`/store-groups/${group.id}`, 'PATCH', { name: `${prefix}RENAMED`, expectedVersion: group.version });
    assert.equal(rename.status, 200);
    const currentStore = (await call(`/stores/${store.id}`)).body.data;
    assert.equal(currentStore.groupName, `${prefix}RENAMED`); assert.ok(currentStore.version > store.version);
    assert.equal((await call(`/stores/${store.id}`, 'PATCH', { expectedVersion: store.version, name: 'Stale' })).status, 409);
    assert.equal((await call(`/store-groups/${group.id}`, 'PATCH', { expectedVersion: group.version, name: `${prefix}STALE` })).status, 409);
    const edits = await Promise.all(['DISABLED', 'ACTIVE'].map(status => call(`/store-groups/${group.id}`, 'PATCH', { status, expectedVersion: rename.body.data.version })));
    assert.deepEqual(edits.map(result => result.status).sort(), [200, 409]);
    const changed = edits.find(result => result.status === 200)!.body.data;
    const disabled = await call(`/store-groups/${group.id}`, 'PATCH', { status: 'DISABLED', expectedVersion: changed.version });
    assert.equal(disabled.status, 200);
    const kept = await call(`/stores/${store.id}`, 'PATCH', { expectedVersion: currentStore.version, groupName: currentStore.groupName, name: 'Kept disabled membership' });
    assert.equal(kept.status, 200);
    assert.equal((await call('/stores', 'POST', { ...payload, code: `${prefix}NEW`, groupName: currentStore.groupName })).body.code, 'STORE_GROUP_DISABLED');
    const ungrouped = await call(`/stores/${store.id}`, 'PATCH', { expectedVersion: kept.body.data.version, groupName: null });
    assert.equal(ungrouped.status, 200); assert.equal(ungrouped.body.data.groupName, null);
    assert.equal((await call(`/stores/${store.id}`, 'PATCH', { expectedVersion: ungrouped.body.data.version, groupName: currentStore.groupName })).body.code, 'STORE_GROUP_DISABLED');
    const other = (await call('/store-groups', 'POST', { name: `${prefix}OTHER` })).body.data;
    try {
      audit.record = async (input, tx) => { await originalAudit(input, tx); if (input.action === 'store-group.delete') throw new Error('Injected delete audit failure'); };
      assert.equal((await call(`/store-groups/${other.id}`, 'DELETE', { expectedVersion: other.version })).status, 500);
      assert.equal(await db.storeGroup.count({ where: { id: other.id } }), 1);
    } finally { audit.record = originalAudit; }
    assert.equal((await call(`/store-groups/${group.id}`, 'PATCH', { expectedVersion: disabled.body.data.version, name: other.name })).body.code, 'STORE_GROUP_NAME_EXISTS');
    assert.equal((await call(`/store-groups/${group.id}`, 'DELETE', { expectedVersion: rename.body.data.version })).status, 409);
    assert.equal((await call(`/store-groups/${group.id}`, 'DELETE', { expectedVersion: disabled.body.data.version })).status, 200);
    assert.equal((await call(`/store-groups/${group.id}`, 'DELETE', { expectedVersion: disabled.body.data.version })).status, 404);
    assert.ok(await db.auditLog.count({ where: { actorUserId: { in: actorIds }, entityType: 'StoreGroup', action: 'store-group.create' } }) >= 2);
    assert.equal(await db.auditLog.count({ where: { entityId: group.id, entityType: 'StoreGroup', action: 'store-group.delete' } }), 1);
    const raceGroup = (await call('/store-groups', 'POST', { name: `${prefix}RACE` })).body.data;
    const race = await Promise.all([
      call(`/store-groups/${raceGroup.id}`, 'DELETE', { expectedVersion: raceGroup.version }),
      call('/stores', 'POST', { ...payload, code: `${prefix}RACE`, groupName: raceGroup.name }),
    ]);
    if (race[0]!.status === 200) {
      assert.equal(race[1]!.status, 404); assert.equal(await db.store.count({ where: { code: `${prefix}RACE` } }), 0);
    } else {
      assert.equal(race[0]!.status, 409); assert.equal(race[1]!.status, 201);
      assert.equal((await db.store.findUniqueOrThrow({ where: { code: `${prefix}RACE` } })).groupName, raceGroup.name);
    }
  } finally {
    await app.close();
    await db.store.deleteMany({ where: { OR: [{ code: { startsWith: prefix } }, { name: { startsWith: `${prefix}自动门店` } }] } });
    await db.storeGroup.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
