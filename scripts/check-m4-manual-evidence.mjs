import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const allowMissing = process.argv.includes('--allow-missing');
const evidenceRoot = 'var/m4-manual-evidence';
const acceptedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.pdf']);

function printLine(label, status, detail) {
  console.log(`${label.padEnd(36)} ${status.padEnd(9)} ${detail}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function listFiles(path) {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function matchingEvidenceFiles(gateId, evidenceId) {
  const dir = join(evidenceRoot, gateId);
  const files = await listFiles(dir);
  const matches = [];

  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (!acceptedExtensions.has(extension)) continue;
    if (!file.startsWith(evidenceId)) continue;

    const fullPath = join(dir, file);
    const fileStats = await stat(fullPath).catch(() => null);
    if (fileStats?.size) matches.push(fullPath);
  }

  return matches;
}

const gates = await readJson('apps/web/m4-gates.json');
const missing = [];

console.log('M4 manual evidence package');
console.log('');
console.log(`Evidence root: ${evidenceRoot}`);
console.log('Expected file pattern: var/m4-manual-evidence/<gate>/<manualEvidenceId>.<png|jpg|jpeg|webp|mp4|mov|webm|pdf>');
console.log('');

for (const gate of gates) {
  for (const [evidenceId, label] of gate.manualEvidence || []) {
    const matches = await matchingEvidenceFiles(gate.id, evidenceId);
    const key = `${gate.id}/${evidenceId}`;
    if (matches.length) {
      printLine(key, 'READY', `${label}; ${matches.join(', ')}`);
    } else {
      missing.push(key);
      printLine(key, 'MISSING', label);
    }
  }
}

console.log('');
if (missing.length) {
  console.log(`Missing manual evidence: ${missing.length}`);
  for (const key of missing) console.log(`  ${key}`);
  if (!allowMissing) process.exit(1);
} else {
  console.log('Manual evidence package is complete.');
}
