import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateDefinitions = JSON.parse(await readFile('apps/web/m4-gates.json', 'utf8'));
const result = JSON.parse(await readFile('apps/web/billing-acceptance-run.json', 'utf8'));
assert.equal(result.status, 'PASSED', 'M4 billing acceptance output must be PASSED');
const nativeEvidence = await readFile('var/miniprogram-extended-evidence/manifest.json', 'utf8')
  .then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (nativeEvidence?.settlementCheck) {
  assert.equal(nativeEvidence.settlementCheck.status, 'PASSED',
    `AC-E08 reopened: native expected payable ${nativeEvidence.settlementCheck.expectedPayable}, preview ${nativeEvidence.settlementCheck.previewPayable}; quantity-to-money reconciliation is required`);
}

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
  if (gate.state === 'Closed') {
    console.log('    Manual evidence: tracked by npm run m4:check-manual-evidence');
  } else {
    console.log(`    Manual evidence still required: ${gate.manualEvidence.map(([, label]) => label).join('; ')}`);
  }
}

console.log('M4 automatic gate evidence is complete. Run npm run m4:check-manual-evidence or npm run acceptance:m4-close for the browser evidence close gate.');
