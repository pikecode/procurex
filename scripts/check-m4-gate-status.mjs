import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateDefinitions = [
  {
    id: 'DEV-402',
    title: 'Settlement amount and period acceptance',
    autoEvidence: [
      ['stored-value-payable', 'Stored-value supplier payable exists'],
      ['credit-period', 'Credit-backed statement uses half-month period'],
      ['direct-term-preview', 'Direct supplier-term preview uses DIRECT channel'],
      ['company-term-block', 'Company-term supplier payment is blocked before store receivable settlement'],
    ],
    manualEvidence: ['W09/S05/S08 settlement mode screenshots', 'Period label and payment status review'],
  },
  {
    id: 'DEV-403',
    title: 'Statement-family acceptance',
    autoEvidence: [
      ['store-view', 'Store statement view'],
      ['supplier-total-view', 'Supplier total statement view'],
      ['supplier-store-view', 'Supplier-store statement view'],
      ['direct-view', 'Direct statement view'],
      ['shared-pending-reservation', 'Shared settlement item pending amount'],
      ['shared-payment-visible', 'Shared payment record visibility'],
    ],
    manualEvidence: ['Four statement-family browser recording', 'Shared item cannot be paid twice review'],
  },
  {
    id: 'DEV-406',
    title: 'Adjustment and difference acceptance',
    autoEvidence: [
      ['adjustment-list', 'W10 adjustment list'],
      ['adjustment-detail', 'W10 adjustment detail'],
      ['offset-target', 'Positive adjustment can be used as offset target'],
      ['offset-created', 'Offset disposal is created'],
      ['receiver-confirmed', 'Receiver confirmation is completed'],
      ['disposed-state', 'Disposed state is visible'],
    ],
    manualEvidence: ['W10 list/detail screenshots', 'Offline return, offset, and confirmation browser recording'],
  },
];

const result = JSON.parse(await readFile('apps/web/billing-acceptance-run.json', 'utf8'));
assert.equal(result.status, 'PASSED', 'M4 billing acceptance output must be PASSED');

const evidenceByGate = new Map();
for (const step of result.steps || []) {
  for (const gate of step.gates || []) {
    if (!evidenceByGate.has(gate.gateId)) evidenceByGate.set(gate.gateId, new Set());
    evidenceByGate.get(gate.gateId).add(gate.evidenceId);
  }
}

console.log('M4 gate status from billing acceptance output');
console.log(`  Generated: ${result.generatedAt}`);

for (const gate of gateDefinitions) {
  const passed = evidenceByGate.get(gate.id) || new Set();
  const missing = gate.autoEvidence.filter(([id]) => !passed.has(id));
  assert.deepEqual(
    missing,
    [],
    `${gate.id} is missing automatic evidence: ${missing.map(([, label]) => label).join(', ')}`,
  );
  console.log(`  ${gate.id} ${gate.title}`);
  console.log(`    Automatic evidence: ${gate.autoEvidence.length}/${gate.autoEvidence.length}`);
  console.log(`    Manual evidence still required: ${gate.manualEvidence.join('; ')}`);
}

console.log('M4 automatic gate evidence is complete. Browser screenshots/recordings are still required before closing DEV-402/403/406.');
