import { readFile, writeFile } from 'node:fs/promises';

const checkOnly = process.argv.includes('--check');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function table(rows) {
  return rows.map((row) => `| ${row.map((cell) => String(cell).replaceAll('\n', '<br>')).join(' | ')} |`).join('\n');
}

const pkg = await readJson('apps/web/m6-local-evidence-package.json');

const blockerRows = (pkg.externalEvidence.blocked || []).map((id) => [id, 'External evidence required before production READY']);
const fileRows = (pkg.files || []).map((file) => [
  file.path,
  file.exists ? 'present' : 'missing',
  file.sizeBytes,
  file.sha256 || '',
]);

const content = `# M6 Local Evidence Handoff

Last updated: 2026-09-29

This handoff summarizes the local M6 evidence package. It does not claim production launch readiness.

## Current Status

| Item | Value |
|---|---|
| Package status | ${pkg.status} |
| Readiness status | ${pkg.readiness.status} |
| Readiness counts | READY ${pkg.readiness.counts.ready}, LOCAL_READY ${pkg.readiness.counts.localReady}, BLOCKED ${pkg.readiness.counts.blocked}, PLANNED ${pkg.readiness.counts.planned} |
| External evidence status | ${pkg.externalEvidence.status} |
| Git branch | ${pkg.git.branch} |
| Packaged commit | ${pkg.git.commit} |
| Remote | ${pkg.git.remote} |
| Dirty at packaging | ${pkg.git.dirty ? 'yes' : 'no'} |

## Local Evidence

| Area | Status |
|---|---|
| Performance | ${pkg.localEvidence.performance} |
| Rollback | ${pkg.localEvidence.rollback} |
| Initialization | ${pkg.localEvidence.initialization} |
| Pilot rehearsal | ${pkg.localEvidence.pilot} |
| Browser evidence desktop | ${pkg.localEvidence.browserEvidence.desktopRows} readiness rows, ${pkg.localEvidence.browserEvidence.desktopExternalRows} external rows, overflow=${pkg.localEvidence.browserEvidence.desktopOverflow} |
| Browser evidence mobile | ${pkg.localEvidence.browserEvidence.mobileRows} readiness rows, ${pkg.localEvidence.browserEvidence.mobileExternalRows} external rows, overflow=${pkg.localEvidence.browserEvidence.mobileOverflow} |

## External Blockers

| Blocker | Meaning |
|---|---|
${table(blockerRows)}

## Evidence Files

| Path | State | Bytes | SHA-256 |
|---|---|---|---|
${table(fileRows)}

## Refresh Commands

\`\`\`bash
${pkg.commands.join('\n')}
npm run m6:package-local-evidence
npm run m6:write-local-handoff
\`\`\`

Use strict gates only after external materials are present:

\`\`\`bash
npm run m6:readiness:strict
npm run m6:external-evidence:strict
\`\`\`

## Remote Note

The packaged remote is \`${pkg.git.remote}\`. If the target repository changes, verify access with \`git ls-remote --heads <repo>\` before switching \`origin\`.
`;

const path = 'docs/m6-local-evidence-handoff.md';
const previous = await readFile(path, 'utf8').catch(() => null);
if (previous !== content) {
  if (checkOnly) {
    throw new Error(`${path} is not synchronized with apps/web/m6-local-evidence-package.json`);
  }
  await writeFile(path, content);
}

console.log(checkOnly ? 'M6 local handoff is synchronized.' : 'M6 local handoff written.');
