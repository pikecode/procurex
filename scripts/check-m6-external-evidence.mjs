import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

const strict = process.argv.includes('--strict');

async function fileExists(path) {
  try {
    const fileStats = await stat(path);
    return fileStats.size > 0;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

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

function httpsUrl(value) {
  return /^https:\/\/[^/]+/.test(value) && !value.includes('example.com');
}

function item(id, title, ready, detail, evidence) {
  return { id, title, status: ready ? 'READY' : 'BLOCKED', detail, evidence };
}

const initialization = await readJson('var/m6-initialization-signoff.json');
const pilot = await readJson('var/m6-pilot-run.json');
const storagePolicy = await readJson('var/m6-production-storage-policy.json');
const recoveryDrill = await readJson('var/m6-production-recovery-drill.json');
const wechatManifestExists = await fileExists('var/m6-wechat-device-evidence/manifest.json');

const checks = [
  item(
    'WECHAT_DEVICE',
    'WeChat real-device evidence',
    present(envValue('WECHAT_APP_ID')) && present(envValue('WECHAT_TEST_ACCOUNT')) && wechatManifestExists,
    present(envValue('WECHAT_APP_ID')) && present(envValue('WECHAT_TEST_ACCOUNT'))
      ? 'WeChat identifiers are present; real-device manifest is still required unless already attached.'
      : 'WECHAT_APP_ID, WECHAT_TEST_ACCOUNT, and real-device evidence manifest are required.',
    ['WECHAT_APP_ID', 'WECHAT_TEST_ACCOUNT', 'var/m6-wechat-device-evidence/manifest.json'],
  ),
  item(
    'PRODUCTION_RUNTIME',
    'Production runtime environment',
    notLocalDatabase(envValue('DATABASE_URL')) && notLocalFileDir(envValue('PRIVATE_FILE_DIR')) && httpsUrl(envValue('PUBLIC_API_BASE_URL')),
    'DATABASE_URL must not be local, PRIVATE_FILE_DIR must be a production storage path/service mount, and PUBLIC_API_BASE_URL must be a real HTTPS endpoint, not an example domain.',
    ['DATABASE_URL', 'PRIVATE_FILE_DIR', 'PUBLIC_API_BASE_URL'],
  ),
  item(
    'STORAGE_POLICY',
    'Object storage/private evidence policy',
    storagePolicy?.signed === true,
    'Need signed retention, access-control, backup, restore, and evidence-download policy for private payment files.',
    ['var/m6-production-storage-policy.json'],
  ),
  item(
    'PRODUCTION_RECOVERY',
    'Production backup and recovery drill',
    recoveryDrill?.signed === true && recoveryDrill?.rpoMinutes <= 15 && recoveryDrill?.rtoMinutes <= 240,
    'Need production recovery drill with RPO <= 15 minutes and RTO <= 4 hours, signed by release/ops owner.',
    ['var/m6-production-recovery-drill.json'],
  ),
  item(
    'FINANCE_SIGNOFF',
    'Customer initialization and finance sign-off',
    initialization?.status === 'READY' && initialization?.productionFinalSignoff?.signed === true,
    'Need customer source files, cutoff date, opening balances, uncleared receivables/payables, role binding review, and finance sign-off.',
    ['var/m6-initialization-signoff.json'],
  ),
  item(
    'CUSTOMER_PILOT',
    'Customer pilot and handover sign-off',
    pilot?.status === 'READY' && pilot?.customerPilot?.signed === true,
    'Need real pilot stores/suppliers, pilot window, recharge/clearing, statement/payment cycle, issue closure, and handover sign-off.',
    ['var/m6-pilot-run.json'],
  ),
];

const status = checks.every((check) => check.status === 'READY') ? 'READY' : 'BLOCKED';
const result = {
  generatedAt: new Date().toISOString(),
  title: 'M6 External Evidence Check',
  status,
  summary: status === 'READY'
    ? 'All external launch evidence is present.'
    : 'External launch evidence is still missing; local readiness remains useful but cannot close M6 production launch.',
  checks,
  expectedArtifacts: {
    wechatManifest: {
      path: 'var/m6-wechat-device-evidence/manifest.json',
      template: 'docs/m6-evidence-templates/wechat-device-manifest.json',
      fields: ['appId', 'testAccounts', 'deviceModels', 'screenshotsOrRecording', 'subscriptionMessageResult', 'signedBy'],
    },
    storagePolicy: {
      path: 'var/m6-production-storage-policy.json',
      template: 'docs/m6-evidence-templates/production-storage-policy.json',
      fields: ['signed', 'owner', 'retentionDays', 'accessReview', 'backupSchedule', 'restoreTestReference'],
    },
    recoveryDrill: {
      path: 'var/m6-production-recovery-drill.json',
      template: 'docs/m6-evidence-templates/production-recovery-drill.json',
      fields: ['signed', 'owner', 'rpoMinutes', 'rtoMinutes', 'databaseBackupReference', 'privateFileBackupReference'],
    },
    initializationSignoff: {
      path: 'var/m6-initialization-signoff.json',
      template: 'docs/m6-evidence-templates/production-initialization-signoff.json',
      fields: ['status=READY', 'productionFinalSignoff.signed=true', 'financeApprover', 'customerSourceFiles'],
    },
    pilotRun: {
      path: 'var/m6-pilot-run.json',
      template: 'docs/m6-evidence-templates/customer-pilot-run.json',
      fields: ['status=READY', 'customerPilot.signed=true', 'participantStores', 'participantSuppliers', 'pilotWindow', 'handoverOwner'],
    },
  },
};

await mkdir('var', { recursive: true });
await mkdir('apps/web', { recursive: true });
await writeFile('var/m6-external-evidence.json', `${JSON.stringify(result, null, 2)}\n`);
await writeFile('apps/web/m6-external-evidence.json', `${JSON.stringify(result, null, 2)}\n`);

console.log('M6 external evidence check complete.');
console.log(`  Status: ${status}`);
for (const check of checks) {
  console.log(`  ${check.status.padEnd(7)} ${check.id}: ${check.detail}`);
}
console.log('  Wrote: var/m6-external-evidence.json');
console.log('  Wrote: apps/web/m6-external-evidence.json');
if (strict && status !== 'READY') process.exitCode = 1;
