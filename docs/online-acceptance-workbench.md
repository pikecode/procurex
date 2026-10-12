# 线上管理员验收身份

2026-10-12 部署版本：20261012-acceptance-workbench。服务器继续使用 NODE_ENV=production，不复用开发环境测试开关。

运行配置位于服务器 /opt/procurex/shared/runtime.env：

```dotenv
ACCEPTANCE_WORKBENCH_ENABLED=true
ACCEPTANCE_WORKBENCH_ADMIN_USERNAMES=admin
ACCEPTANCE_WORKBENCH_USERNAMES=store1,store2,store3,store4,store_fin1,store_fin2,store_fin3,store_fin4,supplier1,supplier2,supplier3,supplier4,supplier5,buyer,fin
```

三个条件必须同时满足：独立开关开启、管理员用户名在白名单中、目标名单非空。服务端继续检查 ADMIN 角色，目标账号必须启用、单角色且具有相应业务范围；名单外账号不可切换。身份切换不改变原登录凭证，业务权限及数据范围取目标账号，actorUserId 保留原管理员身份。

小程序使用原 admin 登录，在“我的”页点击“切换角色”。若已登录需重新进入或重新登录，让 /me 刷新账号能力。测试动作产生真实业务单据，切换前必须处理未确认提交；该开关不是无审计的模拟权限。

结束验收时设置 ACCEPTANCE_WORKBENCH_ENABLED=false，再从当前发布目录重建 API 容器配置：

```sh
docker compose --env-file /opt/procurex/shared/compose.env -f /opt/procurex/current/infra/deploy/compose.yaml up -d --no-build --force-recreate --wait api
```

关闭后服务端即时拒绝测试身份请求，不依赖客户端隐藏入口。原运行配置备份为 runtime.env.before-acceptance-workbench；上一版本为 20261012-acceptance-todos。此次不改密码、不重置业务数据、不修改数据库结构。
