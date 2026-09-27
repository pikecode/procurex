import { readFile, writeFile } from 'node:fs/promises';

const gates = JSON.parse(await readFile('apps/web/m4-gates.json', 'utf8'));
const generatedAt = new Date().toISOString().slice(0, 10);
const outputPath = 'docs/m4-manual-acceptance.md';
const checkOnly = process.argv.includes('--check');

const lines = [
  '# M4 Manual Acceptance Checklist',
  '',
  `Last generated: ${generatedAt}`,
  '',
  'This checklist is generated from `apps/web/m4-gates.json`. Update that source file first when DEV-402/403/406 acceptance evidence changes.',
  '',
  'Before recording manual evidence, run:',
  '',
  '```bash',
  'npm run acceptance:m4-browserless',
  '```',
  '',
  'Then open:',
  '',
  '```text',
  'http://127.0.0.1:4173/m4-acceptance.html',
  'http://127.0.0.1:4173/billing.html',
  '```',
  '',
];

for (const gate of gates) {
  lines.push(`## ${gate.id} ${gate.title}`);
  lines.push('');
  lines.push(`Current state: ${gate.state}`);
  lines.push('');
  lines.push('Automatic evidence:');
  for (const [, label] of gate.autoEvidence) lines.push(`- [x] ${label}`);
  lines.push('');
  lines.push('Manual evidence to collect:');
  const manualChecked = gate.state === 'Closed' ? 'x' : ' ';
  for (const [, label] of gate.manualEvidence) lines.push(`- [${manualChecked}] ${label}`);
  lines.push('');
  lines.push('Manual acceptance path:');
  for (const [index, step] of (gate.manualSteps || []).entries()) {
    lines.push(`${index + 1}. Account: \`${step.account}\``);
    lines.push(`   Entry: \`${step.entry}\``);
    lines.push(`   Action: ${step.action}`);
    lines.push(`   Expected: ${step.expected}`);
  }
  lines.push('');
}

lines.push('M4 closes when the manual evidence boxes above are completed and reviewed alongside the browserless baseline. Run `npm run acceptance:m4-close` for the local close check.');
lines.push('');

const nextContent = `${lines.join('\n')}\n`;

if (checkOnly) {
  const currentContent = await readFile(outputPath, 'utf8');
  if (currentContent !== nextContent) {
    throw new Error(`${outputPath} is out of date. Run npm run m4:write-manual-checklist.`);
  }
  console.log(`${outputPath} is up to date.`);
} else {
  await writeFile(outputPath, nextContent);
  console.log(`Wrote ${outputPath} from apps/web/m4-gates.json`);
}
