import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function runGate(settlementStatus?: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'procurex-m4-gate-'));
  try {
    await mkdir(join(cwd, 'apps/web'), { recursive: true });
    await writeFile(join(cwd, 'apps/web/m4-gates.json'), '[]');
    await writeFile(join(cwd, 'apps/web/billing-acceptance-run.json'), JSON.stringify({ status: 'PASSED', steps: [] }));
    if (settlementStatus) {
      await mkdir(join(cwd, 'var/miniprogram-extended-evidence'), { recursive: true });
      await writeFile(join(cwd, 'var/miniprogram-extended-evidence/manifest.json'), JSON.stringify({
        settlementCheck: { status: settlementStatus, expectedPayable: '84.50', previewPayable: settlementStatus === 'PASSED' ? '84.50' : '94.00' },
      }));
    }
    return execFileSync(process.execPath, [resolve('scripts/check-m4-gate-status.mjs')], { cwd, encoding: 'utf8', stdio: 'pipe' });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('native amount failure blocks legacy M4 closure', async () => {
  await assert.rejects(runGate('FAILED'), error => {
    assert.match(String((error as { stderr: string }).stderr), /AC-E08 reopened.*84\.50.*94\.00/);
    return true;
  });
});

test('reconciled native amounts allow the remaining M4 checks', async () => {
  assert.match(await runGate('PASSED'), /M4 automatic gate evidence is complete/);
});

test('legacy fixtures without native captures remain readable', async () => {
  assert.match(await runGate(), /M4 automatic gate evidence is complete/);
});
