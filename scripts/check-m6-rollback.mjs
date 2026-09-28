import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function fileExists(path) {
  try {
    const fileStats = await stat(path);
    return fileStats.size > 0;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function runCommand(command, args) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    return {
      command: [command, ...args].join(' '),
      status: 'PASS',
      durationMs: Date.now() - started,
      stdout: stdout.trim().split('\n').slice(-8),
      stderr: stderr.trim().split('\n').filter(Boolean).slice(-8),
    };
  } catch (error) {
    return {
      command: [command, ...args].join(' '),
      status: 'FAIL',
      durationMs: Date.now() - started,
      stdout: String(error.stdout ?? '').trim().split('\n').filter(Boolean).slice(-8),
      stderr: String(error.stderr ?? error.message ?? '').trim().split('\n').filter(Boolean).slice(-8),
    };
  }
}

function requireScript(packageJson, name, expectedFragment) {
  const value = packageJson.scripts?.[name] ?? '';
  return {
    name,
    expectedFragment,
    status: value.includes(expectedFragment) ? 'PASS' : 'FAIL',
    value,
  };
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const migrationEntries = (await readdir('database/migrations', { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const latestMigration = migrationEntries.at(-1) ?? null;
const readinessDoc = await readFile('docs/m6-production-readiness.md', 'utf8');
const readiness = await readJson('apps/web/m6-readiness.json');

const commands = [
  await runCommand('npx', ['prisma', 'validate']),
  await runCommand('npx', ['prisma', 'migrate', 'status']),
];
const scripts = [
  requireScript(packageJson, 'db:migrate', 'prisma migrate deploy'),
  requireScript(packageJson, 'start:api', 'dist/apps/api/main.js'),
  requireScript(packageJson, 'start:worker', 'dist/apps/worker/main.js'),
  requireScript(packageJson, 'm6:readiness', 'report-m6-readiness.mjs'),
  requireScript(packageJson, 'm6:performance', 'check-m6-performance.mjs'),
  requireScript(packageJson, 'mini:flow-check', 'check-miniprogram-flow.mjs'),
];
const artifacts = [
  { path: 'database/schema.prisma', status: await fileExists('database/schema.prisma') ? 'PASS' : 'FAIL' },
  { path: 'database/migrations/migration_lock.toml', status: await fileExists('database/migrations/migration_lock.toml') ? 'PASS' : 'FAIL' },
  { path: 'infra/compose/compose.yaml', status: await fileExists('infra/compose/compose.yaml') ? 'PASS' : 'FAIL' },
  { path: 'docs/m6-production-readiness.md', status: await fileExists('docs/m6-production-readiness.md') ? 'PASS' : 'FAIL' },
  { path: 'apps/web/m6-readiness.json', status: readiness?.status ? 'PASS' : 'FAIL' },
];
const policy = [
  {
    name: 'one-instance migration rule',
    status: readinessDoc.includes('one-instance migration rule') || readinessDoc.includes('one-instance migration') ? 'PASS' : 'FAIL',
  },
  {
    name: 'failed-release decision point',
    status: readinessDoc.includes('failed-release decision point') ? 'PASS' : 'FAIL',
  },
  {
    name: 'rollback package',
    status: readinessDoc.includes('rollback package') ? 'PASS' : 'FAIL',
  },
];

const blockers = [
  ...commands.filter((item) => item.status !== 'PASS').map((item) => item.command),
  ...scripts.filter((item) => item.status !== 'PASS').map((item) => `script:${item.name}`),
  ...artifacts.filter((item) => item.status !== 'PASS').map((item) => item.path),
  ...policy.filter((item) => item.status !== 'PASS').map((item) => `policy:${item.name}`),
];
const status = blockers.length === 0 ? 'LOCAL_READY' : 'BLOCKED';
const result = {
  generatedAt: new Date().toISOString(),
  title: 'M6 Local Rollback Check',
  status,
  summary: status === 'LOCAL_READY'
    ? 'Local migration, release, and rollback readiness checks passed; production-specific rollback rehearsal remains required.'
    : 'Local rollback readiness checks found missing commands, artifacts, or policy text.',
  migration: {
    provider: 'postgresql',
    migrationCount: migrationEntries.length,
    latestMigration,
    commandOwner: 'Release owner runs npm run db:migrate once per release window.',
  },
  commands,
  scripts,
  artifacts,
  policy,
  rollbackPlan: [
    'Freeze traffic and stop worker before a failed release is rolled back.',
    'Preserve database backup and private-file snapshot taken immediately before migration.',
    'Redeploy the previous application build; do not run destructive down migrations in production.',
    'Restore database/private files only when release owner and finance owner approve data rewind impact.',
    'Run npm run m6:readiness after rollback and record production incident notes.',
  ],
  blockers,
};

await mkdir('var', { recursive: true });
await writeFile('var/m6-rollback-drill.json', `${JSON.stringify(result, null, 2)}\n`);

console.log('M6 local rollback check complete.');
console.log(`  Status: ${status}`);
console.log(`  Migrations: ${migrationEntries.length}, latest ${latestMigration}`);
for (const command of commands) {
  console.log(`  ${command.status.padEnd(4)} ${command.command} (${command.durationMs}ms)`);
}
console.log('  Wrote: var/m6-rollback-drill.json');
if (status !== 'LOCAL_READY') process.exitCode = 1;
