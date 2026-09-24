import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function readProjectFile(path) {
  return readFile(resolve(root, path), 'utf8');
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing expected contract fragment: ${expected}`);
  }
}

const [apiDesign, packageJson, apiMain, healthController] = await Promise.all([
  readProjectFile('docs/api-design.md'),
  readProjectFile('package.json'),
  readProjectFile('apps/api/main.ts'),
  readProjectFile('apps/api/src/health.controller.ts'),
]);

const pkg = JSON.parse(packageJson);

assertIncludes(apiDesign, '基础路径 `/api/v1`', 'api design');
assertIncludes(apiMain, "app.setGlobalPrefix('api/v1')", 'api bootstrap');

assertIncludes(apiDesign, '`GET /health/live`、`GET /health/ready`', 'api design');
assertIncludes(healthController, "@Get('live')", 'health controller');
assertIncludes(healthController, "@Get('ready')", 'health controller');

if (pkg.scripts?.['contract:check'] !== 'node scripts/check-contract.mjs') {
  throw new Error('package.json contract:check script must run scripts/check-contract.mjs');
}

console.log('Contract check passed.');
