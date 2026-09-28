import { mkdir, readFile, writeFile } from 'node:fs/promises';

const checkOnly = process.argv.includes('--check');
const baseDir = 'docs/m6-evidence-templates';

const templates = {
  'wechat-device-manifest.json': {
    appId: 'wx1234567890abcdef',
    testAccounts: ['store-tester-openid', 'supplier-tester-openid', 'purchaser-tester-openid'],
    bindingOperationMode: 'test-account-binding-or-customer-approved-binding-mode',
    deviceModels: ['iPhone 15 / iOS 18', 'Android 14 representative device'],
    checkedFlows: [
      'login',
      'store order create',
      'store receive shipment',
      'supplier shipment',
      'supplier payment confirmation',
      'purchaser confirmation',
      'supplier rejection reallocation',
      'subscription message delivery',
    ],
    screenshotsOrRecording: [
      'var/m6-wechat-device-evidence/store-flow.png',
      'var/m6-wechat-device-evidence/supplier-flow.png',
      'var/m6-wechat-device-evidence/purchaser-flow.png',
    ],
    subscriptionMessageResult: 'PASS',
    signedBy: 'wechat acceptance owner',
    signedAt: '2026-09-28',
  },
  'production-storage-policy.json': {
    signed: true,
    owner: 'operations owner',
    storageProvider: 'object-storage-or-mounted-private-file-service',
    privateFileRoot: 'production-private-file-root',
    retentionDays: 365,
    accessReview: {
      roles: ['ADMIN', 'HQ_FINANCE'],
      lastReviewedAt: '2026-09-28',
      reviewer: 'security or operations owner',
    },
    backupSchedule: {
      frequency: 'hourly incremental plus daily full snapshot',
      retention: 'at least 30 days',
    },
    restoreTestReference: 'var/m6-production-recovery-drill.json',
    downloadAuditPolicy: 'payment evidence downloads must be authenticated and audit logged',
  },
  'production-recovery-drill.json': {
    signed: true,
    owner: 'release or operations owner',
    drillWindow: {
      startedAt: '2026-09-28T10:00:00+08:00',
      finishedAt: '2026-09-28T12:00:00+08:00',
    },
    rpoMinutes: 15,
    rtoMinutes: 240,
    databaseBackupReference: 'production-database-backup-id',
    privateFileBackupReference: 'production-private-file-backup-id',
    restoredEnvironment: 'production-like recovery environment',
    verification: [
      'database schema and migration status matched release target',
      'private payment evidence files restored and checksum verified',
      'login, order creation, receipt, statement, and payment smoke checks passed',
    ],
  },
  'production-initialization-signoff.json': {
    status: 'READY',
    cutoffDate: '2026-09-28',
    productionFinalSignoff: {
      signed: true,
      financeApprover: 'customer finance owner',
      signedAt: '2026-09-28',
      customerSourceFiles: [
        'stores.xlsx',
        'suppliers.xlsx',
        'products.xlsx',
        'opening-balances.xlsx',
        'uncleared-payables-receivables.xlsx',
      ],
    },
    reconciliationSummary: {
      storeOpeningBalanceTotal: '0.00',
      storeCreditReceivableTotal: '0.00',
      supplierPayableTotal: '0.00',
      unmatchedRows: 0,
    },
  },
  'customer-pilot-run.json': {
    status: 'READY',
    customerPilot: {
      signed: true,
      participantStores: ['customer-store-code-1'],
      participantSuppliers: ['customer-supplier-code-1'],
      pilotWindow: {
        startedAt: '2026-09-28T09:00:00+08:00',
        finishedAt: '2026-09-30T18:00:00+08:00',
      },
      handoverOwner: 'customer operations owner',
      signedAt: '2026-09-30',
    },
    executedFlows: [
      'one recharge or clearing operation',
      'one cross-period replenishment or approved equivalent evidence',
      'one full statement/payment cycle',
      'issue log closed or explicitly accepted',
      'handover notes reviewed',
    ],
    issueLog: {
      opened: 0,
      closed: 0,
      acceptedOpen: 0,
    },
  },
};

const markdown = `# M6 External Evidence Templates

Last updated: 2026-09-28

These templates define the shape of external launch evidence. They are examples, not launch approval by themselves. Real evidence should be reviewed, signed, and then recorded in the paths checked by \`npm run m6:external-evidence\`.

| Template | Target Evidence |
|---|---|
| \`${baseDir}/wechat-device-manifest.json\` | \`var/m6-wechat-device-evidence/manifest.json\` |
| \`${baseDir}/production-storage-policy.json\` | \`var/m6-production-storage-policy.json\` |
| \`${baseDir}/production-recovery-drill.json\` | \`var/m6-production-recovery-drill.json\` |
| \`${baseDir}/production-initialization-signoff.json\` | \`var/m6-initialization-signoff.json\` after customer finance sign-off |
| \`${baseDir}/customer-pilot-run.json\` | \`var/m6-pilot-run.json\` after customer pilot sign-off |

Use:

\`\`\`bash
npm run m6:write-external-templates
npm run m6:check-external-templates
npm run m6:external-evidence
\`\`\`
`;

async function writeIfChanged(path, content) {
  const previous = await readFile(path, 'utf8').catch(() => null);
  if (previous === content) return false;
  if (checkOnly) {
    throw new Error(`${path} is not synchronized with scripts/write-m6-external-evidence-templates.mjs`);
  }
  await writeFile(path, content);
  return true;
}

await mkdir(baseDir, { recursive: true });
let changed = false;
for (const [name, value] of Object.entries(templates)) {
  changed = await writeIfChanged(`${baseDir}/${name}`, `${JSON.stringify(value, null, 2)}\n`) || changed;
}
changed = await writeIfChanged('docs/m6-external-evidence-templates.md', markdown) || changed;

console.log(checkOnly ? 'M6 external evidence templates are synchronized.' : 'M6 external evidence templates written.');
if (!checkOnly) {
  console.log(`  Changed: ${changed ? 'yes' : 'no'}`);
}
