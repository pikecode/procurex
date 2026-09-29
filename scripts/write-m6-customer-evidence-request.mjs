import { readFile, writeFile } from 'node:fs/promises';

const checkOnly = process.argv.includes('--check');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const external = await readJson('apps/web/m6-external-evidence.json');
const pkg = await readJson('apps/web/m6-local-evidence-package.json');

const owners = {
  WECHAT_DEVICE: '微信/小程序负责人',
  PRODUCTION_RUNTIME: '运维/部署负责人',
  STORAGE_POLICY: '运维/安全负责人',
  PRODUCTION_RECOVERY: '运维/发布负责人',
  FINANCE_SIGNOFF: '客户财务负责人',
  CUSTOMER_PILOT: '客户运营负责人',
};

const requestDetails = {
  WECHAT_DEVICE: [
    '微信主体、AppID、测试账号或体验成员名单',
    'Store/Supplier/Purchaser 三类角色真机截图或录屏',
    '订阅消息、上传行为、账号绑定模式验收结果',
  ],
  PRODUCTION_RUNTIME: [
    '生产 DATABASE_URL，不允许指向 localhost 或本地 demo 数据库',
    '生产 PRIVATE_FILE_DIR 或对象存储挂载/服务路径',
    'HTTPS PUBLIC_API_BASE_URL、域名和 TLS 路由说明',
  ],
  STORAGE_POLICY: [
    '私有付款凭证保存周期、访问角色、下载审计策略',
    '备份频率、保留周期、恢复测试引用',
    '负责人签字',
  ],
  PRODUCTION_RECOVERY: [
    '生产或准生产恢复演练时间窗口',
    '数据库备份引用、私有文件备份引用',
    'RPO <= 15 分钟、RTO <= 4 小时的实测值和负责人签字',
  ],
  FINANCE_SIGNOFF: [
    '截止日、门店/供应商/商品/模板来源文件',
    '期初余额、未清应收/应付、角色绑定复核记录',
    '客户财务负责人签字',
  ],
  CUSTOMER_PILOT: [
    '试运行门店/供应商名单和试运行窗口',
    '充值或清账、跨期补发或等效证据、完整账单/付款周期',
    '问题关闭或接受清单、客户运营交接签字',
  ],
};

function checklist(items) {
  return items.map((item) => `  - [ ] ${item}`).join('\n');
}

const rows = external.checks.map((check) => {
  const artifact = Object.values(external.expectedArtifacts).find((item) => (check.evidence || []).includes(item.path));
  return `| ${check.id} | ${owners[check.id] || '待定'} | ${artifact?.path || check.evidence.join('<br>')} | ${artifact?.template || 'n/a'} |`;
}).join('\n');

const detailSections = external.checks.map((check) => {
  const artifact = Object.values(external.expectedArtifacts).find((item) => (check.evidence || []).includes(item.path));
  return `### ${check.id}

Owner: ${owners[check.id] || '待定'}

Target evidence: \`${artifact?.path || check.evidence.join(', ')}\`

Template: \`${artifact?.template || 'n/a'}\`

Current status: ${check.status}

Request:

${checklist(requestDetails[check.id] || [check.detail])}
`;
}).join('\n');

const content = `# M6 Customer Evidence Request

Last updated: 2026-09-29

This request lists the external materials still needed before M6 can be reviewed for production launch. Local evidence is already packaged as \`LOCAL_READY\`, but production launch remains \`${pkg.readiness.status}\` because external evidence is \`${external.status}\`.

## Current Local Package

| Item | Value |
|---|---|
| Local package status | ${pkg.status} |
| Packaged commit | ${pkg.git.commit} |
| Readiness counts | READY ${pkg.readiness.counts.ready}, LOCAL_READY ${pkg.readiness.counts.localReady}, BLOCKED ${pkg.readiness.counts.blocked}, PLANNED ${pkg.readiness.counts.planned} |
| Evidence handoff | \`docs/m6-local-evidence-handoff.md\` |
| Visible readiness page | \`apps/web/m6-readiness.html\` |

## Evidence Request Table

| Blocker | Owner | Target Evidence | Template |
|---|---|---|---|
${rows}

## Detailed Requests

${detailSections}

## Validation Commands

Run after materials are filled:

\`\`\`bash
npm run m6:external-evidence
npm run m6:readiness
npm run m6:package-local-evidence
npm run m6:write-local-handoff
\`\`\`

Run strict gates only when launch review expects every external item to be complete:

\`\`\`bash
npm run m6:external-evidence:strict
npm run m6:readiness:strict
\`\`\`

## Remote Note

The current packaged remote is \`${pkg.git.remote}\`. A proposed remote change must be verified with \`git ls-remote --heads <repo>\` before switching \`origin\`.
`;

const path = 'docs/m6-customer-evidence-request.md';
const previous = await readFile(path, 'utf8').catch(() => null);
if (previous !== content) {
  if (checkOnly) {
    throw new Error(`${path} is not synchronized with current M6 evidence outputs`);
  }
  await writeFile(path, content);
}

console.log(checkOnly ? 'M6 customer evidence request is synchronized.' : 'M6 customer evidence request written.');
