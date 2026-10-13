import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(arg => arg === '--apply'), 'Only --apply is supported; default is dry-run');
const host = 'root@8.138.19.56';
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
  assert.equal(result.status, 0, `${command}: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const ssh = command => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command]);
const release = ssh('readlink -f /opt/procurex/current');
assert.match(release, /^\/opt\/procurex\/releases\/[0-9]{8}-[a-zA-Z0-9-]+$/);
const prefix = 'apps/miniprogram/';
const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps/miniprogram']).split('\n')
  .filter(file => file.startsWith(prefix) && !file.slice(prefix.length).split('/').some(part => part.startsWith('.') || part === 'node_modules'))
  .filter(file => !file.endsWith('project.private.config.json'));
assert.ok(files.length, 'No mini-program files found');
const temp = mkdtempSync(join(tmpdir(), 'procurex-mini-sync-'));
try {
  const list = join(temp, 'files');
  writeFileSync(list, files.map(file => file.slice(prefix.length)).join('\n') + '\n');
  if (apply) {
    run('npm', ['run', 'mini:check']);
    run('npm', ['run', 'mini:test']);
    const tag = new Date().toISOString().replace(/[-:.]/g, '');
    const backup = `/opt/procurex/backups/miniprogram-${tag}`;
    ssh(`cp -a ${quote(`${release}/apps/miniprogram`)} ${quote(backup)}`);
    console.log(`Source backup: ${backup}`);
  }
  console.log(run('rsync', ['-az', '--itemize-changes', ...(apply ? [] : ['--dry-run']), `--files-from=${list}`,
    '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=10', `${prefix}`, `${host}:${release}/apps/miniprogram/`]));
  if (apply) {
    for (let start = 0; start < files.length; start += 50) {
      const chunk = files.slice(start, start + 50);
      const hashes = ssh(`sha256sum ${chunk.map(file => quote(`${release}/${file}`)).join(' ')}`).split('\n');
      assert.equal(hashes.length, chunk.length);
      chunk.forEach((file, index) => assert.equal(hashes[index].split(/\s+/)[0], createHash('sha256').update(readFileSync(file)).digest('hex'), `Hash mismatch: ${file}`));
    }
    const response = await fetch('https://pr.moshuo.fun/api/v1/health/ready', { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, 'Online API readiness failed');
    console.log(`Verified ${files.length} source files; API healthy. No restart or database migration. WeChat upload/publication is separate.`);
  } else console.log('Dry-run only. Use --apply to back up and synchronize source; this does not publish to WeChat.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
