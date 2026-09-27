import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const gates = JSON.parse(await readFile('apps/web/m4-gates.json', 'utf8'));

console.log('Preparing M4 manual browser acceptance');
console.log('');
console.log(run('npm', ['run', 'm4:check-browser-runtime']));
console.log('');
console.log(run('npm', ['run', 'm4:gate-status']));
console.log('');
console.log(run('npm', ['run', 'm4:check-manual-checklist']));
console.log('');

console.log('Start services and open Chrome with one command:');
console.log('  npm run m4:start-manual-acceptance');
console.log('');
console.log('Or start services in two terminals:');
console.log('  npm run start:api');
console.log('  npm run start:web');
console.log('');
console.log('Open these pages:');
console.log('  http://127.0.0.1:4173/m4-acceptance.html');
console.log('  http://127.0.0.1:4173/billing.html');
console.log('');
console.log('Seeded accounts use password: correct-password');
console.log('  pxacc_admin - ADMIN/HQ finance for all W09/W10 checks');
console.log('  pxacc_store - Store-scoped billing and direct statement view');
console.log('  pxacc_supplier_company - Company-term supplier view');
console.log('  pxacc_supplier_direct - Direct-term supplier view');
console.log('');
console.log('Manual acceptance path:');
for (const gate of gates) {
  console.log(`  ${gate.id} ${gate.title}`);
  for (const [index, step] of (gate.manualSteps || []).entries()) {
    console.log(`    ${index + 1}. ${step.account} / ${step.entry}`);
    console.log(`       Action: ${step.action}`);
    console.log(`       Expected: ${step.expected}`);
  }
}
console.log('');
console.log('Record screenshots/recordings in docs/m4-manual-acceptance.md and m4-acceptance.html checklist.');
