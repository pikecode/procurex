import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import OSS from 'ali-oss';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/apps/api/src/app.module.js';
import { DatabaseService } from '../dist/apps/api/src/database/database.service.js';
import { ApiExceptionFilter } from '../dist/apps/api/src/common/api-exception.filter.js';
import { ResponseEnvelopeInterceptor } from '../dist/apps/api/src/common/response-envelope.interceptor.js';

const env = process.env;
assert.equal(env.FILE_STORAGE, 'oss', 'Run with FILE_STORAGE=oss');
assert.equal(env.OSS_BUCKET, 'moshuo-attachment-2026');
assert.equal(env.OSS_PREFIX, 'procurex-test/');
const dbUrl = new URL(env.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname), 'Local database only');
if (env.OSS_CHECK_API) {
  const api = new URL(env.OSS_CHECK_API);
  assert.ok(['127.0.0.1', 'localhost'].includes(api.hostname) && api.protocol === 'http:' && api.pathname === '/api/v1' && !api.username && !api.password && !api.search && !api.hash, 'Local API only');
}
const client = new OSS({ bucket: env.OSS_BUCKET, region: env.OSS_REGION, endpoint: env.OSS_ENDPOINT,
  accessKeyId: env.OSS_ACCESS_KEY_ID, accessKeySecret: env.OSS_ACCESS_KEY_SECRET, secure: true,
  cname: env.OSS_CNAME === 'true', timeout: 15000 });
const evidence = { checkedAt: new Date().toISOString(), status: 'FAILED', checks: [], cleanup: 'NOT_STARTED' };
const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix('api/v1');
app.useGlobalFilters(new ApiExceptionFilter());
app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
const db = app.get(DatabaseService).client;
let fileId;
let objectName;
let versionId;
const bytes = Buffer.from('%PDF-1.4\nProcureX private OSS attachment verification\n%%EOF');
try {
  if (!env.OSS_CHECK_API) await app.listen(0, '127.0.0.1');
  const base = env.OSS_CHECK_API ?? `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  evidence.api = base;
  const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(35000) });
  async function login(username) {
    const response = await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: env.OSS_CHECK_PASSWORD ?? 'correct-password', client: 'WEB' }) });
    assert.equal(response.status, 201);
    return (await response.json()).data.accessToken;
  }
  const owner = await login(env.OSS_CHECK_OWNER ?? 'pxflow_user');
  const other = await login(env.OSS_CHECK_OTHER ?? 'pxflow_supplier');
  const headers = { authorization: `Bearer ${owner}`, 'content-type': 'application/json' };
  const sessionResponse = await request('/files/upload-sessions', { method: 'POST', headers,
    body: JSON.stringify({ purpose: 'PAYMENT', filename: 'oss-acceptance.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length }) });
  assert.equal(sessionResponse.status, 201);
  const session = (await sessionResponse.json()).data;
  fileId = session.id;
  const file = await db.fileObject.findUniqueOrThrow({ where: { id: fileId } });
  assert.match(file.objectKey, /^oss:procurex-test\/[a-f0-9-]{36}$/);
  objectName = file.objectKey.slice(4);
  evidence.fileId = fileId;
  evidence.objectName = objectName;
  const upload = await request(`/files/${fileId}/content`, { method: 'POST',
    headers: { authorization: `Bearer ${owner}`, 'x-upload-token': session.uploadToken, 'content-type': 'application/octet-stream' }, body: bytes });
  assert.equal(upload.status, 201);
  versionId = (await client.head(objectName)).res.headers['x-oss-version-id'];
  evidence.versionId = versionId;
  const complete = await request(`/files/${fileId}/complete`, { method: 'POST', headers });
  assert.equal(complete.status, 201);
  assert.equal((await complete.json()).data.status, 'READY');
  const download = await request(`/files/${fileId}/download`, { headers });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  assert.equal((await db.fileObject.findUniqueOrThrow({ where: { id: fileId } })).checksum, checksum);
  evidence.checks.push('API upload/complete/download and SHA256 match');
  assert.equal((await request(`/files/${fileId}/download`)).status, 401);
  assert.equal((await request(`/files/${fileId}/download`, { headers: { authorization: `Bearer ${other}` } })).status, 404);
  evidence.checks.push('Anonymous API and unrelated supplier rejected');
  const url = new URL(env.OSS_ENDPOINT);
  if (env.OSS_CNAME !== 'true') url.hostname = `${env.OSS_BUCKET}.${url.hostname}`;
  url.pathname = `/${objectName}`;
  const anonymous = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(anonymous.status, 403);
  evidence.checks.push('Anonymous OSS request rejected');
  evidence.status = 'PASSED';
} catch (error) {
  evidence.error = { code: error.code ?? 'VerificationFailed', status: error.status, requestId: error.requestId };
  process.exitCode = 1;
} finally {
  try {
    if (objectName) {
      if (!versionId) {
        try { versionId = (await client.head(objectName)).res.headers['x-oss-version-id']; }
        catch (error) { if (error.code !== 'NoSuchKey') throw error; }
      }
      if (versionId) {
        await client.delete(objectName, { subres: { versionId } });
        await assert.rejects(client.head(objectName, { subres: { versionId } }), error => error.code === 'NoSuchKey' || error.code === 'NoSuchVersion');
      }
    }
    if (fileId) await db.fileObject.deleteMany({ where: { id: fileId, paymentId: null, receiptId: null, rechargeId: null, clearingId: null } });
    evidence.cleanup = 'PASSED';
  } catch (error) {
    evidence.cleanup = 'FAILED';
    evidence.cleanupError = { code: error.code ?? 'CleanupFailed', status: error.status, requestId: error.requestId };
    evidence.status = 'FAILED';
    process.exitCode = 1;
  }
  await app.close();
  await mkdir('var/oss-attachment-evidence', { recursive: true });
  await writeFile('var/oss-attachment-evidence/manifest.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}
