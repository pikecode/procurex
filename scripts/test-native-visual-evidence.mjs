import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkNativeVisualEvidence, groups } from './check-native-visual-evidence.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'procurex-visual-test-'));
  try {
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ee2244' } }).png().toBuffer(), left: 0, top: 0 }]).jpeg().toBuffer();
    for (const [group, count] of groups) {
      const directory = join(root, 'var', group);
      await mkdir(directory, { recursive: true });
      const screenshots = Array.from({ length: count }, (_, index) => `${index}.jpg`);
      for (const name of screenshots) await writeFile(join(directory, name), image);
      await writeFile(join(directory, 'manifest.json'), JSON.stringify({ status: 'PASSED', realDevice: false,
        screenshots, cleanup: 'PASSED', image: { width: 800, height: 800, nonblank: true } }));
    }
    await mkdir(join(root, 'var/native-profile-price-evidence'), { recursive: true });
    await writeFile(join(root, 'var/native-profile-price-evidence/manifest.json'),
      JSON.stringify({ status: 'PASSED', visualAcceptance: 'NOT_VERIFIED', screenshots: [] }));
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('complete files do not close visual or device acceptance', () => fixture(async root => {
  const report = await checkNativeVisualEvidence(root);
  assert.equal(report.closure, 'OPEN');
  assert.equal(report.realDevice, false);
  assert.equal(report.evidence.flatMap(item => item.screenshots).length, 75);
  assert.equal(report.remaining.length, 3);
}));
test('missing screenshot rejects evidence', () => fixture(async root => {
  await rm(join(root, 'var/role-ui-evidence/0.jpg'));
  await assert.rejects(checkNativeVisualEvidence(root), /ENOENT/);
}));
test('blank screenshot rejects evidence', () => fixture(async root => {
  await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } })
    .jpeg().toFile(join(root, 'var/role-ui-evidence/0.jpg'));
  await assert.rejects(checkNativeVisualEvidence(root), /blank screenshot/);
}));
test('unsafe paths reject evidence', () => fixture(async root => {
  await writeFile(join(root, 'var/role-ui-evidence/manifest.json'), JSON.stringify({ status: 'PASSED', realDevice: false,
    screenshots: Array.from({ length: 16 }, (_, index) => index ? `${index}.jpg` : '../escape.jpg') }));
  await assert.rejects(checkNativeVisualEvidence(root), /unsafe screenshot/);
}));
test('functional-only price evidence cannot silently become visual approval', () => fixture(async root => {
  await writeFile(join(root, 'var/native-profile-price-evidence/manifest.json'),
    JSON.stringify({ status: 'PASSED', visualAcceptance: 'PASSED', screenshots: [] }));
  await assert.rejects(checkNativeVisualEvidence(root), /boundary changed/);
}));
test('duplicate screenshots reject evidence', () => fixture(async root => {
  await writeFile(join(root, 'var/role-ui-evidence/manifest.json'), JSON.stringify({ status: 'PASSED', realDevice: false,
    screenshots: Array.from({ length: 16 }, () => '0.jpg') }));
  await assert.rejects(checkNativeVisualEvidence(root), /duplicate screenshot/);
}));
test('media cleanup failure rejects evidence', () => fixture(async root => {
  await writeFile(join(root, 'var/product-media-evidence/manifest.json'), JSON.stringify({ status: 'PASSED', realDevice: false,
    screenshots: Array.from({ length: 5 }, (_, index) => `${index}.jpg`), cleanup: 'FAILED',
    image: { width: 800, height: 800, nonblank: true } }));
  await assert.rejects(checkNativeVisualEvidence(root), /cleanup verification/);
}));

async function priceCapture(root) {
  const directory = join(root, 'var/native-price-recovery-evidence');
  await mkdir(directory, { recursive: true });
  const image = await readFile(join(root, 'var/role-ui-evidence/0.jpg'));
  const screenshots = Array.from({ length: 9 }, (_, index) => `${index}.jpg`);
  for (const name of screenshots) await writeFile(join(directory, name), image);
  const manifest = JSON.stringify({ status: 'PASSED', realDevice: false, screenshots,
    visualAcceptance: 'CAPTURED_PENDING_REVIEW', fixtureCleanup: 'PASSED',
    priceWorkflow: { orderSalesGoodsAmount: '28', orderSupplyGoodsAmount: '18', accountLedgerCount: 0 } });
  await writeFile(join(directory, 'manifest.json'), manifest);
  return { status: 'PASSED', manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    screenshots: screenshots.map(name => ({ name, sha256: createHash('sha256').update(image).digest('hex') })) };
}
test('price capture alone cannot close the visual gap', () => fixture(async root => {
  await priceCapture(root);
  await assert.rejects(checkNativeVisualEvidence(root, { priceRecovery: true }), /ENOENT/);
}));
test('review bound to current capture reduces remaining scope, not C3 closure', () => fixture(async root => {
  const review = await priceCapture(root);
  await writeFile(join(root, 'var/native-price-recovery-evidence/review.json'), JSON.stringify(review));
  const report = await checkNativeVisualEvidence(root, { priceRecovery: true });
  assert.equal(report.remaining.length, 2);
  assert.equal(report.priceRecoveryVisual, 'REVIEWED');
  assert.equal(report.closure, 'OPEN');
  assert.equal(report.evidence.flatMap(item => item.screenshots).length, 84);
}));
test('recaptured images invalidate an earlier review', () => fixture(async root => {
  const review = await priceCapture(root);
  review.screenshots[0].sha256 = 'stale';
  await writeFile(join(root, 'var/native-price-recovery-evidence/review.json'), JSON.stringify(review));
  await assert.rejects(checkNativeVisualEvidence(root, { priceRecovery: true }), /hash-bound visual review/);
}));

async function navigationCapture(root, workspaces = ['store', 'supplier', 'purchaser']) {
  const directory = join(root, 'var/native-multirole-navigation-evidence');
  await mkdir(directory, { recursive: true });
  const bytes = await readFile(join(root, 'var/role-ui-evidence/0.jpg'));
  const screenshots = Array.from({ length: 6 }, (_, index) => `${index}.jpg`);
  for (const name of screenshots) await writeFile(join(directory, name), bytes);
  const manifest = JSON.stringify({ status: 'PASSED', realDevice: false, screenshots,
    visualAcceptance: 'CAPTURED_PENDING_REVIEW', multiRoleWorkspaces: workspaces });
  await writeFile(join(directory, 'manifest.json'), manifest);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ status: 'PASSED',
    manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    screenshots: screenshots.map(name => ({ name, sha256: createHash('sha256').update(bytes).digest('hex') })) }));
}
test('reviewing all workspaces still leaves actual narrow viewport open', () => fixture(async root => {
  const review = await priceCapture(root);
  await writeFile(join(root, 'var/native-price-recovery-evidence/review.json'), JSON.stringify(review));
  await navigationCapture(root);
  const report = await checkNativeVisualEvidence(root, { priceRecovery: true, multiroleNavigation: true });
  assert.deepEqual(report.remaining, ['Actual narrow viewport']);
  assert.equal(report.closure, 'OPEN');
  assert.equal(report.evidence.flatMap(item => item.screenshots).length, 90);
}));
test('incomplete workspace mapping cannot pass navigation review', () => fixture(async root => {
  await navigationCapture(root, ['store', 'supplier']);
  await assert.rejects(checkNativeVisualEvidence(root, { multiroleNavigation: true }), /Three actual multi-role/);
}));
