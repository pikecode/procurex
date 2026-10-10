# ProcureX

采购协同系统：NestJS API、React 管理后台、微信原生小程序和后台 worker。

## 本地运行

需要 Node.js 22、Docker，以及已配置的本地 `.env`。密钥只放环境变量，不提交到仓库。已有业务库不要重置或重新导入演示种子。

```sh
npm ci
npm ci --prefix apps/admin
npm run db:up
npm run db:generate
npm run db:migrate
npm run build
```

在不同终端启动：

macOS 可直接双击根目录 `start-local.command`，调用 `start-local.sh` 自动启动本地 API 和 React 后台，并打开浏览器。数据库未启动时会尝试启动 Docker；关闭窗口会停止本次新启动的服务，已有服务不受影响。

```sh
PORT=3114 npm run start:api
npm start
npm run start:worker
```

- 默认后台是 React：http://127.0.0.1:4174 。`npm start`、`npm run start:web` 和 `npm run start:admin` 均启动它；端口占用时使用 Vite 输出的地址。
- API 使用3114，后台以同源 `/api` 代理访问，无需在浏览器URL传入API地址。API端口改变时通过 `ADMIN_API_TARGET` 配置后台代理目标。
- 小程序在微信开发者工具打开 `apps/miniprogram`；真机登录、合法域名与正式发布另行验收。
- 小程序当前默认连接本地 `http://127.0.0.1:3114/api/v1`，地址在 `apps/miniprogram/app.js` 统一配置。暂不部署；本地上传测试可使用 `FILE_STORAGE=local PORT=3114 npm run start:api`。
- 旧后台只用于回退和历史验收：`npm run start:web:legacy`，地址 http://127.0.0.1:4173/app.html 。两套后台共用业务数据，切换入口不会回退数据库或撤销业务操作。
- API默认端口为3100，因此本地启动务必显式设置 `PORT=3114`，不要仅运行 `start:api` 后期待3114可用。

## 构建与验证

```sh
npm run build
npm run build:admin
npm test
npm run test:admin:recovery
```

恢复验证仅接受受保护的本地数据库，使用临时账号和单据，真实写入后丢弃响应，再从React刷新恢复原键；结束清理夹具。不是银行转账或生产验收。先构建API，再运行脚本。

## 部署与回退

服务器隔离部署与实际验收记录见 [服务器部署](docs/server-deployment.md)。当前服务器后台通过 SSH 隧道访问，尚未完成域名/HTTPS 正式公网发布。

React生产产物在 `apps/admin/dist`，不要在生产运行Vite开发服务器。静态Nginx镜像和API代理配置见 `infra/admin`：

```sh
npm run build:admin
docker build -f infra/admin/Dockerfile -t procurex-admin .
docker run --rm -p 127.0.0.1:4175:80 -e ADMIN_API_UPSTREAM=http://host.docker.internal:3114 procurex-admin
```

该容器仅包含前端，不包含API、数据库或worker。Linux部署需将代理目标改为实际API服务地址。生产服务器、域名/HTTPS、微信合法域名、OSS保留/备份策略尚未签收。

入口回退：启动 `start:web:legacy` 并切回4173；生产应恢复上一个静态镜像和入口代理配置。入口回退不是数据库迁移回滚。React中的旧后台链接可在构建前通过 `VITE_LEGACY_URL` 指向已部署的旧后台；默认 `/legacy/` 需要独立配置，当前React镜像不内置旧后台。

## 接续资料

- [需求文档](docs/requirements.md)、[当前模板规则](docs/template-current-spec.md)：现行业务规则。
- [设计文档入口](docs/design-review-index.md)、[本地业务验收](docs/local-business-acceptance.md)：交互设计及测试依据。

- `docs/continuation.md`：最新接续与下一步。
- `docs/progress.md`：进度总账。
- `docs/react-admin-migration.md`：React迁移状态、验证边界和部署说明。
- `docs/completion-standard.md`、`docs/delivery-closure.md`：整体完成标准与外部依赖。
- `docs/development-log.md`：实施历史，不把历史“下一批”当当前待办。
