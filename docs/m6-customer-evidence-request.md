# M6 Customer Evidence Request

Last updated: 2026-09-29

This request lists the external materials still needed before M6 can be reviewed for production launch. Local evidence is already packaged as `LOCAL_READY`, but production launch remains `NOT_READY` because external evidence is `BLOCKED`.

## Current Local Package

| Item | Value |
|---|---|
| Local package status | LOCAL_READY |
| Packaged commit | 77c70c7c64b3c822b9403c9fdf97a665c6af39ed |
| Readiness counts | READY 1, LOCAL_READY 7, BLOCKED 3, PLANNED 0 |
| Evidence handoff | `docs/m6-local-evidence-handoff.md` |
| Visible readiness page | `apps/web/m6-readiness.html` |

## Evidence Request Table

| Blocker | Owner | Target Evidence | Template |
|---|---|---|---|
| WECHAT_DEVICE | 微信/小程序负责人 | var/m6-wechat-device-evidence/manifest.json | docs/m6-evidence-templates/wechat-device-manifest.json |
| PRODUCTION_RUNTIME | 运维/部署负责人 | DATABASE_URL<br>PRIVATE_FILE_DIR<br>PUBLIC_API_BASE_URL | n/a |
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

  - [ ] 微信主体、AppID、测试账号或体验成员名单
  - [ ] Store/Supplier/Purchaser 三类角色真机截图或录屏
  - [ ] 订阅消息、上传行为、账号绑定模式验收结果

### PRODUCTION_RUNTIME

Owner: 运维/部署负责人

Target evidence: `DATABASE_URL, PRIVATE_FILE_DIR, PUBLIC_API_BASE_URL`

Template: `n/a`

Current status: BLOCKED

Request:

  - [ ] 生产 DATABASE_URL，不允许指向 localhost 或本地 demo 数据库
  - [ ] 生产 PRIVATE_FILE_DIR 或对象存储挂载/服务路径
  - [ ] HTTPS PUBLIC_API_BASE_URL、域名和 TLS 路由说明

### STORAGE_POLICY

Owner: 运维/安全负责人

Target evidence: `var/m6-production-storage-policy.json`

Template: `docs/m6-evidence-templates/production-storage-policy.json`

Current status: BLOCKED

Request:

  - [ ] 私有付款凭证保存周期、访问角色、下载审计策略
  - [ ] 备份频率、保留周期、恢复测试引用
  - [ ] 负责人签字

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

The current packaged remote is `git@github.com:pikecode/procurex.git`. A proposed remote change must be verified with `git ls-remote --heads <repo>` before switching `origin`.
