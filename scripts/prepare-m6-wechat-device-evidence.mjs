import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { requiredWechatFlows } from './m6-wechat-evidence-lib.mjs';

const force = process.argv.includes('--force');
const targetDir = 'var/m6-wechat-device-evidence';
const targetPath = `${targetDir}/manifest.json`;

function envList(name) {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const appId = process.env.WECHAT_APP_ID || '';
const testAccounts = envList('WECHAT_TEST_ACCOUNT');
const today = new Date().toISOString().slice(0, 10);

const draft = {
  appId,
  testAccounts,
  bindingOperationMode: 'experience-member-binding-to-pxflow-role-accounts',
  deviceModels: [
    'fill real device model, OS version, WeChat version',
  ],
  checkedFlows: requiredWechatFlows,
  screenshotsOrRecording: [
    `${targetDir}/store-flow.png`,
    `${targetDir}/supplier-flow.png`,
    `${targetDir}/purchaser-flow.png`,
  ],
  subscriptionMessageResult: 'PENDING',
  signedBy: '',
  signedAt: today,
  notes: [
    'Replace screenshot paths with real files after testing the experience build on device.',
    'Set subscriptionMessageResult to PASS only after the real device check passes.',
  ],
};

await mkdir(targetDir, { recursive: true });
const previous = await readFile(targetPath, 'utf8').catch(() => null);
if (previous && !force) {
  console.log(`M6 WeChat device evidence draft already exists: ${targetPath}`);
  console.log('Use --force only if you intentionally want to reset the local draft.');
} else {
  await writeFile(targetPath, `${JSON.stringify(draft, null, 2)}\n`);
  console.log(`M6 WeChat device evidence draft written: ${targetPath}`);
}
