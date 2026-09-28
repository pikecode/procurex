import { mkdir, readFile, writeFile } from 'node:fs/promises';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function check(name, passed, detail, severity = 'required') {
  return { name, status: passed ? 'PASS' : severity === 'required' ? 'FAIL' : 'WARN', severity, detail };
}

const [
  m5Gate,
  interactive,
  miniFlow,
  billing,
  initialization,
  performance,
  rollback,
  progress,
  continuation,
] = await Promise.all([
  readJson('apps/web/m5-gate-status.json'),
  readJson('var/main-flow-demo-evidence/interactive-manifest.json'),
  readJson('apps/miniprogram/mini-flow-check.json'),
  readJson('apps/web/billing-acceptance-run.json'),
  readJson('var/m6-initialization-signoff.json'),
  readJson('var/m6-performance-report.json'),
  readJson('var/m6-rollback-drill.json'),
  readFile('docs/progress.md', 'utf8').catch(() => ''),
  readFile('docs/continuation.md', 'utf8').catch(() => ''),
]);

const m5Ready = (m5Gate?.gates || []).length > 0 && (m5Gate.gates || []).every((gate) => gate.status === 'READY');
const mainFlowReady =
  interactive?.state?.completedRows === 6 &&
  interactive?.viewports?.mobile?.state?.completedRows === 6 &&
  interactive?.roleWorkbenchAction?.status === 'BRANCHES_READY' &&
  interactive?.mobileRoleWorkbenchAction?.status === 'BRANCHES_READY';
const miniReady = miniFlow?.status === 'PASSED' && (miniFlow.coveredEndpoints || []).length >= 20;
const billingReady = billing?.status === 'PASSED' && (billing.steps || []).length >= 8;
const initializationReady = initialization?.status === 'LOCAL_READY' || initialization?.status === 'READY';
const performanceReady = performance?.status === 'LOCAL_READY';
const rollbackReady = rollback?.status === 'LOCAL_READY';
const hasStoreSupplierSelection =
  (initialization?.inventory?.stores ?? 0) > 0 &&
  (initialization?.inventory?.suppliers ?? 0) > 0 &&
  Boolean(miniFlow?.evidence?.store?.accountStoreId) &&
  Boolean(miniFlow?.evidence?.supplier?.supplierOrderId);
const hasRechargeOrClearingEvidence =
  progress.includes('clearing one selected 200 credit') &&
  (billing?.steps || []).some((step) => step.title.includes('Stored-value'));
const hasReplenishmentEvidence =
  interactive?.roleWorkbenchAction?.discrepancyBranchesResultText?.includes('REPLENISH_PENDING') &&
  interactive?.mobileRoleWorkbenchAction?.discrepancyBranchesResultText?.includes('REPLENISH_PENDING');
const hasStatementCycleEvidence =
  billingReady &&
  miniFlow?.evidence?.supplier?.paymentStatus === 'CONFIRMED' &&
  (billing.steps || []).some((step) => step.title.includes('Direct payment create and confirm'));
const hasIssueClosure =
  interactive?.roleWorkbenchAction?.hasResolvedDiscrepancy &&
  interactive?.roleWorkbenchAction?.hasReallocatedRejection &&
  interactive?.mobileRoleWorkbenchAction?.hasResolvedDiscrepancy &&
  interactive?.mobileRoleWorkbenchAction?.hasReallocatedRejection;
const hasHandoffLedger = progress.includes('M6 production-readiness ledger') && continuation.includes('Current State');

const checks = [
  check('M5 close gate still ready', m5Ready, `gates=${m5Gate?.gates?.length ?? 0}`),
  check('Desktop/mobile role-workbench pilot rehearsal', mainFlowReady, `desktopRows=${interactive?.state?.completedRows ?? 0}, mobileRows=${interactive?.viewports?.mobile?.state?.completedRows ?? 0}`),
  check('Mini-program role API rehearsal', miniReady, `status=${miniFlow?.status ?? 'MISSING'}, endpoints=${miniFlow?.coveredEndpoints?.length ?? 0}`),
  check('Selected store and supplier sample exists', hasStoreSupplierSelection, `stores=${initialization?.inventory?.stores ?? 0}, suppliers=${initialization?.inventory?.suppliers ?? 0}`),
  check('Recharge or clearing evidence exists', hasRechargeOrClearingEvidence, 'progress ledger contains selected-credit clearing evidence and billing evidence contains stored-value flow'),
  check('Replenishment branch evidence exists', hasReplenishmentEvidence, `desktop=${interactive?.roleWorkbenchAction?.discrepancyBranchesResultText ?? 'MISSING'}, mobile=${interactive?.mobileRoleWorkbenchAction?.discrepancyBranchesResultText ?? 'MISSING'}`),
  check('Full statement and payment cycle evidence exists', hasStatementCycleEvidence, `billing=${billing?.status ?? 'MISSING'}, miniPayment=${miniFlow?.evidence?.supplier?.paymentStatus ?? 'MISSING'}`),
  check('Issue closure evidence exists', hasIssueClosure, 'discrepancy resolution and supplier rejection reallocation are present in desktop/mobile role-workbench evidence'),
  check('Initialization prerequisite exists', initializationReady, `status=${initialization?.status ?? 'MISSING'}`),
  check('Performance prerequisite exists', performanceReady, `status=${performance?.status ?? 'MISSING'}`),
  check('Rollback prerequisite exists', rollbackReady, `status=${rollback?.status ?? 'MISSING'}`),
  check('Continuation handoff ledger exists', hasHandoffLedger, 'docs/progress.md and docs/continuation.md contain current-state handoff notes'),
  check('Customer pilot participants confirmed', false, 'selected real stores/suppliers and pilot dates must be confirmed outside local evidence', 'customer-evidence'),
  check('Customer handover signoff confirmed', false, 'operations owner and customer owner must sign the pilot close notes before production READY', 'customer-evidence'),
  check('Customer cross-period pilot window confirmed', false, 'a real cross-period replenishment/statement window requires calendar time or customer-provided evidence', 'customer-evidence'),
];

const blockers = checks.filter((item) => item.severity === 'required' && item.status !== 'PASS');
const status = blockers.length === 0 ? 'LOCAL_READY' : 'BLOCKED';
const result = {
  generatedAt: new Date().toISOString(),
  title: 'M6 Local Pilot Rehearsal Check',
  status,
  summary: status === 'LOCAL_READY'
    ? 'Required local pilot rehearsal evidence is present; real customer pilot participants, handover, and sign-off are still required before production READY.'
    : 'Required local pilot rehearsal evidence is missing.',
  customerPilot: {
    signed: false,
    participantStores: [],
    participantSuppliers: [],
    pilotWindow: null,
    handoverOwner: null,
    requiredBeforeReady: [
      'selected real stores and suppliers',
      'one recharge or clearing operation in the pilot environment',
      'one cross-period replenishment or equivalent customer-approved evidence',
      'one full statement/payment cycle',
      'issue log closed or explicitly accepted',
      'handover notes signed by operations owner and customer owner',
    ],
  },
  evidence: {
    m5GateStatus: 'apps/web/m5-gate-status.json',
    interactiveMainFlow: 'var/main-flow-demo-evidence/interactive-manifest.json',
    miniProgramFlow: 'apps/miniprogram/mini-flow-check.json',
    billingAcceptance: 'apps/web/billing-acceptance-run.json',
    initializationSignoff: 'var/m6-initialization-signoff.json',
    performanceReport: 'var/m6-performance-report.json',
    rollbackDrill: 'var/m6-rollback-drill.json',
  },
  rehearsalCoverage: {
    storeSupplierSelection: hasStoreSupplierSelection,
    rechargeOrClearing: hasRechargeOrClearingEvidence,
    replenishmentBranch: hasReplenishmentEvidence,
    statementAndPaymentCycle: hasStatementCycleEvidence,
    issueClosure: hasIssueClosure,
    handoffLedger: hasHandoffLedger,
  },
  checks,
  blockers: blockers.map((item) => item.name),
};

await mkdir('var', { recursive: true });
await writeFile('var/m6-pilot-run.json', `${JSON.stringify(result, null, 2)}\n`);

console.log('M6 local pilot rehearsal check complete.');
console.log(`  Status: ${result.status}`);
for (const item of checks) {
  console.log(`  ${item.status.padEnd(4)} ${item.name}: ${item.detail}`);
}
console.log('  Wrote: var/m6-pilot-run.json');
if (result.status !== 'LOCAL_READY') process.exitCode = 1;
