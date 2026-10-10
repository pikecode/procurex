# 服务器部署

更新：2026-10-08。

## 方案

- 服务器 `8.138.19.56`，SSH 用户 `root`。保留 `/opt/fin-hub` 及其端口、容器、数据。
- Procurex 独立目录 `/opt/procurex/releases/<release>`，`current` 指向当前版本；配置和密码位于 `shared`，权限 600。
- 独立 Compose 项目 `procurex`：PostgreSQL 18、Node 22 API、Nginx React 静态页面。同源 `/api/` 代理，SPA 路由回退。
- 默认发布 `127.0.0.1:8080`；用户确认临时向所有 IP 开放 HTTP 后，服务器 `shared/compose.env` 已设置 `ADMIN_BIND_ADDRESS=0.0.0.0`。无需开放数据库/API 内部端口。
- 使用空业务数据库，不导入本地测试订单或默认测试密码。只初始化随机密码管理员。
- OSS 预定使用既有私有桶和独立前缀 `procurex-server/`，但实测返回 `403 UserDisable`。本次实际改用 `FILE_STORAGE=local`，私有附件持久化到 `shared/private-files`，不由 Nginx 直接公开，随数据库每日备份。OSS 修复及对象备份/保留策略仍待确认。
- worker 当前为空实现，不启动空 worker，不宣称后台任务已验收。

## 发布步骤

1. 本地运行 `npm run build`、`npm test`、`npm run build:admin`。
2. 打包源码，排除 `.git`、环境文件、node_modules、var、后端生成产物。上传到新的 release 目录；另用 `scp -r apps/admin/dist root@8.138.19.56:/opt/procurex/releases/<release>/apps/admin/` 上传前端构建产物，避免递归排除 `dist` 时误删它。
3. 生成独立数据库随机密码，写入 `shared/compose.env`；运行环境写入 `shared/runtime.env`。各 release 的 `.env.runtime` 链接到后者。不得打印/提交凭据。
4. `docker compose --env-file /opt/procurex/shared/compose.env -f infra/deploy/compose.yaml build api admin`。
5. 使用同一 Compose 命令 `up -d --wait postgres`；再 `run --rm api npm run db:migrate`。迁移由单一发布操作员执行。
6. 首次空库用 `run --name procurex-bootstrap api node infra/deploy/bootstrap-admin.mjs` 初始化管理员；取出凭据到 root 私有文件后移除该临时容器。
7. `up -d --wait`，检查 API readiness、登录、后台路由及未认证 API 拒绝访问。`smoke.mjs` 使用受限管理员凭据，仅进行只读业务检查和登录/退出，不创建测试订单。
8. 设置 `current` 链接；安装每日备份定时任务并执行一次。备份仅为同机副本，异地备份/恢复演练待补。

## 访问

```sh
ssh -N -L 4180:127.0.0.1:8080 root@8.138.19.56
```

访问 `http://127.0.0.1:4180`。管理员凭据只在受限本地/服务器文件中交付。
提供域名后配置 HTTPS 反向代理与微信合法域名，再开放正式公网入口。

临时公网入口为 `http://8.138.19.56:8080`。2026-10-08 已重建 admin 容器并确认监听 `0.0.0.0:8080`，API readiness 正常，fin-hub 仍返回 200；UFW 未启用，iptables INPUT 接受且 Docker 转发允许该服务。外部连接测试超时，尚未确认公网可达，需云端安全组/网络放行 TCP 8080、来源 `0.0.0.0/0`。本次无云控制台权限，未修改安全组。
关闭临时公网：将 `ADMIN_BIND_ADDRESS` 改回 `127.0.0.1`，执行 Compose `up -d --no-build --no-deps admin`，同时删除云端 8080 放行规则。HTTP 不加密，已有依赖告警未消除，不能作为正式上线验收。

## 运维与回退

在 `current` 目录使用上述 Compose 环境文件执行 `ps`、`logs --tail 100 api`、`restart api`。
每日运行 `infra/deploy/backup.sh`，数据库及私有文件保留 14 天，升级前另留备份。当前备份未冻结业务写入，不能冒充跨数据库/文件一致性快照；正式上线前补维护窗口备份与恢复演练。
应用回退：将 compose.env 的 RELEASE 改为上一个已验证镜像标签，执行 `up -d --no-build` 并验证兼容性。不得执行 `down -v`，不得自动逆向迁移或恢复数据库。
数据库恢复会丢失备份后的写入，必须先暂停业务、保留当前备份并取得业务负责人明确确认。

## 验收边界

HTTPS、异地备份、OSS 保留策略、微信真机、客户财务签收未完成前，不标记为正式生产上线。

依赖审计：2026-10-08 的 `npm audit --omit=dev --json` 返回 4 high、1 moderate，涉及 Prisma 依赖链中的 deepmerge-ts、mysql2 和上游包。当前使用 PostgreSQL，不使用 MySQL；这不等于所有告警已消除。公网发布前需单独评估、升级并回归，不运行未经验证的 `audit fix --force`。

## 实际执行记录

### 2026-10-09 更新

- 发布标签 `20261009-0923-review`，使用当前工作区源码（包含尚未提交的修改），保留上一版本 `20261008-196b9f7` 镜像和目录。
- 发布前已执行数据库及私有附件备份；不修改服务器凭据，不导入本地测试数据。
- 本地 React 生产构建通过；新版 Linux API、admin 镜像构建成功。
- 数据库已应用供应商配送联系号码、发货配送方式快照两条新增迁移，共67条迁移。
- API、PostgreSQL 健康检查通过；`current` 和共享 RELEASE 配置均已切换到新版。
- 新版镜像内只读 smoke 通过：SPA主要路由、数据库 readiness、匿名401、管理员登录、目录读取和退出。
- 从本机访问 `http://8.138.19.56:8080/api/v1/health/ready` 返回200，公网入口可达；fin-hub 的80端口仍返回200且容器未重启。
- 没有执行微信小程序上传发布；没有将定向 smoke 等同于完整业务、浏览器视觉或真机验收。完整回归缺口见 `requirements-0923-execution.md`。

- 发布标签 `20261008-196b9f7`：基于提交 `196b9f7` 加本次部署配置；本次配置尚未提交。`current` 已指向此版本。
- 本地后端构建、React 构建、188/188 单元测试通过；Linux 镜像内 Prisma 生成和后端构建通过。
- 65 条迁移全部成功；只初始化 `admin` 和角色，不导入本地演示业务。随机密码保存在服务器 `shared/admin.json` 和本地 `.env.deploy-access.json`，权限 600，均不提交。
- API、数据库健康检查通过；React 静态页面及 `/products`、`/templates`、`/stores`、`/suppliers` 路由返回正确 SPA 页面。
- 真实管理员登录、目录读取、退出及未登录 401 拦截通过；切换本地私有存储后重新运行 smoke 通过。
- 真实 16×16 PNG 商品图片上传、完成校验、认证下载、匿名 401 拦截通过；验证对象和数据库记录已清理。
- OSS 返回 `403 UserDisable`，没有标记为可用。待修复身份后再次验证；当前已有本地对象不能通过仅修改环境变量完成 OSS 数据迁移。
- `/etc/cron.d/procurex-db-backup` 已配置每天服务器时间 03:15 执行；手动数据库/附件备份已生成。异地副本和实际恢复演练仍未完成。
- SSH 隧道已启动，本机 `http://127.0.0.1:4180` 可访问服务器后台，不是本地 Vite。
- fin-hub 容器未重启，原入口仍返回 200。
- 浏览器截图验证受本机沙箱限制，Chrome 启动 SIGABRT，未取得截图；没有用接口验证冒充浏览器视觉验收。
