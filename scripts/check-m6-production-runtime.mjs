import { mkdir, writeFile } from 'node:fs/promises';

function envValue(name) {
  return process.env[name] || '';
}

function present(value) {
  return Boolean(value);
}

function notLocalDatabase(value) {
  return present(value) && !value.includes('127.0.0.1') && !value.includes('localhost') && !value.includes('procurex_local_only');
}

function notLocalFileDir(value) {
  return present(value) && !value.startsWith('var/') && !value.includes('/var/private-files');
}

function productionHttpsUrl(value) {
  return /^https:\/\/[^/]+/.test(value) && !value.includes('example.com');
}

function maskDatabaseUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.username = url.username ? '***' : '';
    url.password = url.password ? '***' : '';
    return url.toString();
  } catch {
    return value.replace(/:\/\/[^:@/]+:[^@/]+@/, '://***:***@');
  }
}

function check(id, title, passed, detail, evidence = null) {
  return {
    id,
    title,
    status: passed ? 'PASS' : 'BLOCKED',
    detail,
    evidence,
  };
}

const databaseUrl = envValue('DATABASE_URL');
const privateFileDir = envValue('PRIVATE_FILE_DIR');
const publicApiBaseUrl = envValue('PUBLIC_API_BASE_URL');
const nodeEnv = envValue('NODE_ENV');
const host = envValue('HOST');
const port = envValue('PORT');

const checks = [
  check(
    'DATABASE_URL',
    'Production database URL',
    notLocalDatabase(databaseUrl),
    notLocalDatabase(databaseUrl)
      ? 'DATABASE_URL is configured and does not point at localhost or the local demo database.'
      : 'DATABASE_URL must point at the production PostgreSQL instance, not localhost, 127.0.0.1, or procurex_local_only.',
    maskDatabaseUrl(databaseUrl),
  ),
  check(
    'PRIVATE_FILE_DIR',
    'Private file storage path or mount',
    notLocalFileDir(privateFileDir),
    notLocalFileDir(privateFileDir)
      ? 'PRIVATE_FILE_DIR is configured outside the local var/private-files path.'
      : 'PRIVATE_FILE_DIR must be a production private-file mount or object-storage service path.',
    privateFileDir,
  ),
  check(
    'PUBLIC_API_BASE_URL',
    'Public HTTPS API base URL',
    productionHttpsUrl(publicApiBaseUrl),
    productionHttpsUrl(publicApiBaseUrl)
      ? 'PUBLIC_API_BASE_URL is a real HTTPS endpoint.'
      : 'PUBLIC_API_BASE_URL must be a real HTTPS domain and must not use example.com.',
    publicApiBaseUrl,
  ),
  check(
    'NODE_ENV',
    'Production Node environment',
    nodeEnv === 'production',
    nodeEnv === 'production'
      ? 'NODE_ENV is production.'
      : 'NODE_ENV should be production for launch rehearsal and production runtime evidence.',
    nodeEnv,
  ),
  check(
    'PROCESS_BINDING',
    'API process binding',
    present(host) && present(port),
    present(host) && present(port)
      ? 'HOST and PORT are configured for the API process.'
      : 'HOST and PORT should be recorded for the production API process.',
    { host, port },
  ),
];

const status = checks.every((item) => item.status === 'PASS') ? 'READY' : 'BLOCKED';
const result = {
  generatedAt: new Date().toISOString(),
  title: 'M6 Production Runtime Check',
  status,
  summary: status === 'READY'
    ? 'Production runtime environment variables are shaped for launch review.'
    : 'Production runtime is not ready; server, domain, database, or private-file storage configuration is still missing.',
  checks,
  requiredOperations: [
    'Provision production PostgreSQL and set DATABASE_URL.',
    'Provision private payment-evidence storage and set PRIVATE_FILE_DIR.',
    'Configure HTTPS domain and set PUBLIC_API_BASE_URL.',
    'Run API and worker with NODE_ENV=production.',
    'Run npm run db:migrate from one controlled shell before smoke validation.',
  ],
};

await mkdir('var', { recursive: true });
await writeFile('var/m6-production-runtime.json', `${JSON.stringify(result, null, 2)}\n`);

console.log('M6 production runtime check');
console.log(`  Status: ${status}`);
for (const item of checks) {
  console.log(`  ${item.status.padEnd(7)} ${item.id}: ${item.detail}`);
}
console.log('  Wrote: var/m6-production-runtime.json');

if (process.argv.includes('--strict') && status !== 'READY') {
  process.exitCode = 1;
}
