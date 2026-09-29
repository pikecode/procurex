import { mkdir, readFile, writeFile } from 'node:fs/promises';

const target = 'var/m6-production-storage-policy.json';
const strict = process.argv.includes('--strict');

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function present(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

function issueIf(condition, message, issues) {
  if (!condition) issues.push(message);
}

const draft = {
  signed: false,
  owner: '',
  storageProvider: '',
  privateFileRoot: '',
  retentionDays: 0,
  accessReview: {
    roles: [],
    lastReviewedAt: '',
    reviewer: '',
  },
  backupSchedule: {
    frequency: '',
    retention: '',
  },
  restoreTestReference: 'var/m6-production-recovery-drill.json',
  downloadAuditPolicy: '',
  signedAt: '',
};

const existing = await readJson(target);
const policy = existing ? { ...draft, ...existing } : draft;
policy.accessReview = { ...draft.accessReview, ...(existing?.accessReview || {}) };
policy.backupSchedule = { ...draft.backupSchedule, ...(existing?.backupSchedule || {}) };

const issues = [];
issueIf(policy.signed === true, 'signed must be true after operations/security approval', issues);
issueIf(present(policy.owner), 'owner must name the storage policy owner', issues);
issueIf(present(policy.storageProvider), 'storageProvider must name the production object-storage or private-file service', issues);
issueIf(present(policy.privateFileRoot) && !String(policy.privateFileRoot).startsWith('var/'), 'privateFileRoot must be a production path/service, not a local var/ path', issues);
issueIf(Number(policy.retentionDays) >= 365, 'retentionDays must be at least 365', issues);
issueIf(Array.isArray(policy.accessReview.roles) && policy.accessReview.roles.includes('HQ_FINANCE') && policy.accessReview.roles.includes('ADMIN'), 'accessReview.roles must include ADMIN and HQ_FINANCE', issues);
issueIf(present(policy.accessReview.lastReviewedAt), 'accessReview.lastReviewedAt is required', issues);
issueIf(present(policy.accessReview.reviewer), 'accessReview.reviewer is required', issues);
issueIf(present(policy.backupSchedule.frequency), 'backupSchedule.frequency is required', issues);
issueIf(present(policy.backupSchedule.retention), 'backupSchedule.retention is required', issues);
issueIf(present(policy.restoreTestReference), 'restoreTestReference is required', issues);
issueIf(present(policy.downloadAuditPolicy) && String(policy.downloadAuditPolicy).toLowerCase().includes('audit'), 'downloadAuditPolicy must mention authenticated audit logging', issues);
issueIf(present(policy.signedAt), 'signedAt is required', issues);

const result = {
  ...policy,
  status: issues.length === 0 ? 'READY' : 'BLOCKED',
  issues,
  checkedAt: new Date().toISOString(),
};

await mkdir('var', { recursive: true });
await writeFile(target, `${JSON.stringify(result, null, 2)}\n`);

console.log('M6 production storage policy check');
console.log(`  Status: ${result.status}`);
for (const issue of issues) console.log(`  - ${issue}`);
console.log(`  Wrote: ${target}`);

if (strict && result.status !== 'READY') {
  process.exitCode = 1;
}
