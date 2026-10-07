import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const suites = ['test:admin', 'test:admin:r2', 'test:admin:r3', 'test:admin:r3-exceptions',
  'test:admin:r3-shipping', 'test:admin:r3-receipts', 'test:admin:r3-store',
  'test:admin:r4-accounts', 'test:admin:r4-billing', 'test:admin:r4-reports',
  'test:admin:supplier', 'test:admin:supplier-finance'];
const output = 'var/react-admin-r5-evidence';
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), status: 'RUNNING',
  boundary: 'Browser regression, not full real-business or production acceptance. Base suite creates/edits/deletes a temporary store group; remaining business writes use response fixtures. No real funds or OSS writes.',
  suites: [] };
const save = () => writeFile(`${output}/manifest.json`, JSON.stringify(report, null, 2));
await save();
for (const suite of suites) {
  const script = JSON.parse(await readFile('package.json', 'utf8')).scripts[suite];
  const sourcePath = script.split(' ')[1];
  const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  const start = Date.now(); let log = '';
  console.log(`Starting ${suite}`);
  const code = await new Promise(resolve => {
    const child = spawn('npm', ['run', suite], { stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 300000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
    child.on('error', error => { clearTimeout(timer); log += `\n${error.message}\n`; resolve(1); });
    child.on('close', code => { clearTimeout(timer); resolve(timedOut ? 124 : code ?? 1); });
  });
  const logPath = `${output}/${suite.replaceAll(':', '-')}.log`;
  await writeFile(logPath, log);
  report.suites.push({ suite, sourceSha256, status: code === 0 ? 'PASS' : 'FAIL', exitCode: code, elapsedMs: Date.now() - start, logPath });
  await save(); console.log(`${suite}: ${code === 0 ? 'PASS' : 'FAIL'} (${Date.now() - start}ms)`);
}
report.status = report.suites.every(suite => suite.status === 'PASS') ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString(); await save();
console.log(`${report.suites.filter(suite => suite.status === 'PASS').length}/${suites.length} suites passed. Evidence: ${output}/manifest.json`);
if (report.status !== 'PASS') process.exitCode = 1;
