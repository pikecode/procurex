import { readFile } from 'node:fs/promises';
import { validateWechatDeviceEvidence } from './m6-wechat-evidence-lib.mjs';

const manifestPath = 'var/m6-wechat-device-evidence/manifest.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => 'null'));
const result = await validateWechatDeviceEvidence(manifest, process.env.WECHAT_APP_ID || '');

console.log('M6 WeChat device evidence');
console.log(`  Status: ${result.ready ? 'READY' : 'BLOCKED'}`);
if (result.issues.length > 0) {
  for (const issue of result.issues) console.log(`  - ${issue}`);
}

if (!result.ready) process.exitCode = 1;
