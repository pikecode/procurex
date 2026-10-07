import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const groups = [
  ['role-ui-evidence', 16], ['store-ui-evidence', 14],
  ['store-layout-stress-evidence', 1], ['native-entry-visual-evidence', 19],
  ['native-entry-error-evidence', 3], ['product-media-evidence', 5],
  ['miniprogram-extended-evidence', 17],
];

export async function checkNativeVisualEvidence(root, { priceRecovery = false, multiroleNavigation = false } = {}) {
  const evidence = [];
  for (const [group, count] of [...groups, ...(priceRecovery ? [['native-price-recovery-evidence', 9]] : []),
    ...(multiroleNavigation ? [['native-multirole-navigation-evidence', 6]] : [])]) {
    const directory = resolve(root, 'var', group);
    const manifestBytes = await readFile(resolve(directory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.status !== 'PASSED' || manifest.realDevice !== false) {
      throw new Error(`${group}: expected passed simulator evidence`);
    }
    if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== count ||
        new Set(manifest.screenshots).size !== count) {
      throw new Error(`${group}: incomplete or duplicate screenshot inventory`);
    }
    if (group === 'product-media-evidence' && (manifest.cleanup !== 'PASSED' ||
        manifest.image?.width !== 800 || manifest.image?.height !== 800 ||
        manifest.image?.nonblank !== true)) {
      throw new Error(`${group}: missing actual image/cleanup verification`);
    }
    const screenshots = [];
    for (const name of manifest.screenshots) {
      if (typeof name !== 'string' || basename(name) !== name || !/\.jpg$/.test(name)) {
        throw new Error(`${group}: unsafe screenshot name`);
      }
      const bytes = await readFile(resolve(directory, name));
      const metadata = await sharp(bytes).metadata();
      const stats = await sharp(bytes).stats();
      if (!metadata.width || !metadata.height || !stats.channels.some(channel => channel.stdev > 1)) {
        throw new Error(`${group}/${name}: empty or blank screenshot`);
      }
      screenshots.push({ name, width: metadata.width, height: metadata.height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        acceptedAsLargeAmount: group === 'store-layout-stress-evidence',
        excludedFromLargeAmountAcceptance: group === 'store-ui-evidence' && name === 'long-text-large-money.jpg' });
    }
    if (group === 'native-price-recovery-evidence') {
      if (manifest.fixtureCleanup !== 'PASSED' ||
          manifest.priceWorkflow?.orderSalesGoodsAmount !== '28' || manifest.priceWorkflow?.orderSupplyGoodsAmount !== '18' ||
          manifest.priceWorkflow?.accountLedgerCount !== 0) throw new Error('Price recovery capture/cleanup missing');
    }
    if (group === 'native-multirole-navigation-evidence' &&
        JSON.stringify(manifest.multiRoleWorkspaces) !== JSON.stringify(['store', 'supplier', 'purchaser'])) {
      throw new Error('Three actual multi-role workspaces required');
    }
    if (['native-price-recovery-evidence', 'native-multirole-navigation-evidence'].includes(group)) {
      const review = JSON.parse(await readFile(resolve(directory, 'review.json'), 'utf8'));
      if (manifest.visualAcceptance !== 'CAPTURED_PENDING_REVIEW' || review.status !== 'PASSED' ||
          review.manifestSha256 !== createHash('sha256').update(manifestBytes).digest('hex') ||
          !Array.isArray(review.screenshots) || review.screenshots.length !== screenshots.length ||
          screenshots.some(item => !review.screenshots.some(approved => approved.name === item.name && approved.sha256 === item.sha256))) {
        throw new Error(`${group}: hash-bound visual review missing`);
      }
    }
    evidence.push({ group, generatedAt: manifest.generatedAt, screenshots });
  }
  const prices = JSON.parse(await readFile(resolve(root, 'var/native-profile-price-evidence/manifest.json'), 'utf8'));
  if (prices.status !== 'PASSED' || prices.visualAcceptance !== 'NOT_VERIFIED' ||
      !Array.isArray(prices.screenshots) || prices.screenshots.length !== 0) {
    throw new Error('Price recovery evidence boundary changed; requires explicit visual review');
  }
  return { generatedAt: new Date().toISOString(), status: 'PASSED',
    scope: 'Existing file integrity and evidence mapping, not a fresh capture or visual sign-off',
    closure: 'OPEN', realDevice: false, evidence,
    functionalOnly: { group: 'native-profile-price-evidence', visualAcceptance: 'NOT_VERIFIED' },
    priceRecoveryVisual: priceRecovery ? 'REVIEWED' : 'NOT_CHECKED',
    multiroleNavigationVisual: multiroleNavigation ? 'REVIEWED' : 'NOT_CHECKED',
    remaining: ['Actual narrow viewport', ...(multiroleNavigation ? [] : ['Multi-role navigation layout review']),
      ...(priceRecovery ? [] : ['Native price publication and committed-response-loss recovery screenshots'])],
    limitations: ['Pixel variance does not establish layout correctness',
      'Historical extended workflow is not a fresh run of the current UI',
      'Simulated loading/error states are not real network failures',
      'No camera, album, real-device or production acceptance'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = await checkNativeVisualEvidence(root, { priceRecovery: process.argv.includes('--with-price-recovery'),
    multiroleNavigation: process.argv.includes('--with-multirole-navigation') });
  const output = resolve(root, 'var/native-visual-acceptance/manifest.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PASSED: ${report.evidence.reduce((sum, item) => sum + item.screenshots.length, 0)} screenshots checked; C3 remains OPEN`);
}
