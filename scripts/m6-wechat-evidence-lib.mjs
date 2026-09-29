import { stat } from 'node:fs/promises';

export const requiredWechatFlows = [
  'login',
  'store order create',
  'store receive shipment',
  'supplier shipment',
  'supplier payment confirmation',
  'purchaser confirmation',
  'supplier rejection reallocation',
  'subscription message delivery',
];

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlaceholder(value) {
  return !hasText(value) || /placeholder|example|tester-openid|wx1234567890abcdef|acceptance owner/i.test(value);
}

async function fileExists(path) {
  try {
    const fileStats = await stat(path);
    return fileStats.size > 0;
  } catch {
    return false;
  }
}

export async function validateWechatDeviceEvidence(manifest, expectedAppId = '') {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ready: false, issues: ['manifest is missing or is not valid JSON'] };
  }

  if (!hasText(manifest.appId) || isPlaceholder(manifest.appId)) {
    issues.push('appId must be the real mini-program AppID');
  } else if (expectedAppId && manifest.appId !== expectedAppId) {
    issues.push('appId must match WECHAT_APP_ID from the environment');
  }

  if (!Array.isArray(manifest.testAccounts) || manifest.testAccounts.length < 3) {
    issues.push('testAccounts must include Store, Supplier, and Purchaser experience members or account identifiers');
  } else if (manifest.testAccounts.some((account) => isPlaceholder(account))) {
    issues.push('testAccounts still contains placeholder values');
  }

  if (isPlaceholder(manifest.bindingOperationMode)) {
    issues.push('bindingOperationMode must describe the approved account binding mode');
  }

  if (!Array.isArray(manifest.deviceModels) || manifest.deviceModels.length === 0 || manifest.deviceModels.some((device) => isPlaceholder(device))) {
    issues.push('deviceModels must include at least one real test device');
  }

  const checkedFlows = new Set(Array.isArray(manifest.checkedFlows) ? manifest.checkedFlows : []);
  for (const flow of requiredWechatFlows) {
    if (!checkedFlows.has(flow)) issues.push(`checkedFlows is missing: ${flow}`);
  }

  if (!Array.isArray(manifest.screenshotsOrRecording) || manifest.screenshotsOrRecording.length < 3) {
    issues.push('screenshotsOrRecording must include Store, Supplier, and Purchaser screenshots or recordings');
  } else {
    for (const artifact of manifest.screenshotsOrRecording) {
      if (isPlaceholder(artifact)) {
        issues.push('screenshotsOrRecording contains placeholder values');
      } else if (!(await fileExists(artifact))) {
        issues.push(`screenshot or recording file is missing: ${artifact}`);
      }
    }
  }

  if (manifest.subscriptionMessageResult !== 'PASS') {
    issues.push('subscriptionMessageResult must be PASS');
  }
  if (isPlaceholder(manifest.signedBy)) {
    issues.push('signedBy must name the WeChat acceptance owner');
  }
  if (isPlaceholder(manifest.signedAt)) {
    issues.push('signedAt must be filled');
  }

  return { ready: issues.length === 0, issues };
}
