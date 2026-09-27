import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gateDefinitions = JSON.parse(await readFile('apps/web/m4-gates.json', 'utf8'));
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
  console.log(`    Manual evidence still required: ${gate.manualEvidence.map(([, label]) => label).join('; ')}`);
}

console.log('M4 automatic gate evidence is complete. Browser screenshots/recordings are still required before closing DEV-402/403/406.');
