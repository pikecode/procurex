# M6 Customer Evidence Request

Last updated: 2026-09-29

This request lists the external materials still needed before M6 can be reviewed for production launch. Local evidence is already packaged as `LOCAL_READY`, but production launch remains `NOT_READY` because external evidence is `BLOCKED`.

## Current Local Package

| Item | Value |
|---|---|
| Local package status | LOCAL_READY |
| Packaged commit | 1bd60e43aaf443f61e7a02aeb67066bcb30cc773 |
| Readiness counts | READY 1, LOCAL_READY 7, BLOCKED 3, PLANNED 0 |
| Evidence handoff | `docs/m6-local-evidence-handoff.md` |
| Visible readiness page | `apps/web/m6-readiness.html` |

## Evidence Request Table

| Blocker | Owner | Target Evidence | Template |
|---|---|---|---|
| WECHAT_DEVICE | 微信/小程序负责人 | var/m6-wechat-device-evidence/manifest.json | docs/m6-evidence-templates/wechat-device-manifest.json |
| PRODUCTION_RUNTIME | 运维/部署负责人 | var/m6-production-runtime.json | docs/m6-evidence-templates/production-runtime.json |
| STORAGE_POLICY | 运维/安全负责人 | var/m6-production-storage-policy.json | docs/m6-evidence-templates/production-storage-policy.json |
| PRODUCTION_RECOVERY | 运维/发布负责人 | var/m6-production-recovery-drill.json | docs/m6-evidence-templates/production-recovery-drill.json |
| FINANCE_SIGNOFF | 客户财务负责人 | var/m6-initialization-signoff.json | docs/m6-evidence-templates/production-initialization-signoff.json |
| CUSTOMER_PILOT | 客户运营负责人 | var/m6-pilot-run.json | docs/m6-evidence-templates/customer-pilot-run.json |

## Detailed Requests

### WECHAT_DEVICE

Owner: 微信/小程序负责人

Target evidence: `var/m6-wechat-device-evidence/manifest.json`

Template: `docs/m6-evidence-templates/wechat-device-manifest.json`

Current status: BLOCKED

Request:

  - [ ] 按 docs/m6-wechat-device-evidence-guide.md 运行真机证据流程
  - [ ] Store/Supplier/Purchaser 三类角色真机截图或录屏分别放到 var/m6-wechat-device-evidence/store-flow.png、supplier-flow.png、purchaser-flow.png
  - [ ] manifest 填写真实设备型号、账号绑定模式、subscriptionMessageResult=PASS 和微信验收负责人签字

### PRODUCTION_RUNTIME

Owner: 运维/部署负责人

Target evidence: `var/m6-production-runtime.json`

Template: `docs/m6-evidence-templates/production-runtime.json`

Current status: BLOCKED

Request:

  - [ ] 按 docs/m6-production-runtime-guide.md 准备生产运行时
  - [ ] 生产 DATABASE_URL，不允许指向 localhost 或本地 demo 数据库
  - [ ] 生产 PRIVATE_FILE_DIR 或对象存储挂载/服务路径
  - [ ] HTTPS PUBLIC_API_BASE_URL、域名、TLS 路由、NODE_ENV=production、HOST/PORT，并运行 npm run m6:check-production-runtime

### STORAGE_POLICY

Owner: 运维/安全负责人

Target evidence: `var/m6-production-storage-policy.json`

Template: `docs/m6-evidence-templates/production-storage-policy.json`

Current status: BLOCKED

Request:

  - [ ] 按 docs/m6-storage-policy-guide.md 准备生产私有凭证存储策略
  - [ ] 私有付款凭证保存周期、访问角色、下载审计策略
  - [ ] 备份频率、保留周期、恢复测试引用
  - [ ] 运行 npm run m6:check-storage-policy，并由负责人签字

### PRODUCTION_RECOVERY

Owner: 运维/发布负责人

Target evidence: `var/m6-production-recovery-drill.json`

Template: `docs/m6-evidence-templates/production-recovery-drill.json`

Current status: BLOCKED

Request:

  - [ ] 生产或准生产恢复演练时间窗口
  - [ ] 数据库备份引用、私有文件备份引用
  - [ ] RPO <= 15 分钟、RTO <= 4 小时的实测值和负责人签字

### FINANCE_SIGNOFF

Owner: 客户财务负责人

Target evidence: `var/m6-initialization-signoff.json`

Template: `docs/m6-evidence-templates/production-initialization-signoff.json`

Current status: BLOCKED

Request:

  - [ ] 截止日、门店/供应商/商品/模板来源文件
  - [ ] 期初余额、未清应收/应付、角色绑定复核记录
  - [ ] 客户财务负责人签字

### CUSTOMER_PILOT

Owner: 客户运营负责人

Target evidence: `var/m6-pilot-run.json`

Template: `docs/m6-evidence-templates/customer-pilot-run.json`

Current status: BLOCKED

Request:

  - [ ] 试运行门店/供应商名单和试运行窗口
  - [ ] 充值或清账、跨期补发或等效证据、完整账单/付款周期
  - [ ] 问题关闭或接受清单、客户运营交接签字


## Validation Commands

Run after materials are filled:

```bash
npm run m6:external-evidence
npm run m6:prepare-wechat-evidence
npm run m6:check-wechat-evidence
npm run m6:check-production-runtime
npm run m6:check-storage-policy
npm run m6:readiness
npm run m6:package-local-evidence
npm run m6:write-local-handoff
```

Run strict gates only when launch review expects every external item to be complete:

```bash
npm run m6:external-evidence:strict
npm run m6:readiness:strict
```

## Remote Note

The current packaged remote is `git@github.com-pikecode:pikecode/procurex.git`. A proposed remote change must be verified with `git ls-remote --heads <repo>` before switching `origin`.
