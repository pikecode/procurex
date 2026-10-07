# 主数据审计验收

更新：2026-10-05。对应固定收尾项C5，不扩展产品范围或新增历史中心。

## 覆盖范围

| 资源 | 审计action | 写入及关联边界 |
|---|---|---|
| 分类 | category.create/update/delete | 创建、排序/父级修改、引用安全删除 |
| 单位 | unit.create/update/delete | 创建、改名及关联商品版本刷新、删除 |
| 品牌 | brand.create/update/delete | 创建、改名及旧商品品牌文本同步、删除 |
| 商品 | product.create/update/purchase-unit.set | 创建、资料/启停修改、采购单位转换 |
| 供应商 | supplier.create/update/archive/products.replace | 创建、资料/状态、归档移除模板与商品关联、供货商品替换 |
| 模板 | template.create/update/copy/archive/stores.replace/items.replace/supplier-setting.set/supplier-setting.clear | 创建、修改、连价格日程复制、归档、门店/商品绑定、结算覆盖设置与清除 |
| 门店 | store.create/update | 创建、资料/状态修改 |
| 用户 | user.update | 资料/状态/业务范围修改，事务内版本条件更新 |

共27个HTTP写入口。既有资金、采购、履约和价格有键审计不由本批重做；价格无键兼容路径仍归C7。

## 合同

- 控制器只从认证会话构建actorUserId/activeScope，traceId沿用服务器请求上下文；请求体不能覆盖身份、角色或trace。
- 每个成功请求在原业务事务中保存一条AuditLog。审计失败使主表、版本刷新、关联替换、复制的价格日程一并回滚；删除成功保留被删资源ID及DELETED结果。
- after仅投影SUCCEEDED/DELETED、可用版本、关联数量及模板结算的supplierId。不复制整份业务响应，不保存银行账号、联系方式、备注、密码或附件信息。没有新增before全量敏感快照。
- 原锁、引用保护和权限规则保留；用户修改新增事务内版本条件校验，范围upsert与资料、审计一起提交，旧版本不能覆盖并发修改。
- 无身份上下文的内部服务/夹具调用保留兼容，不造假操作者；这不是所有CLI/直接数据库写入都已有审计的声明。主数据没有新增幂等命令合同，也不能据此声称C7全局恢复完成。

## 证据

tests/integration/master-data-audit-http.test.ts共54项通过，真实HTTP及数据库：27入口×成功/审计插入后抛错。每项还验证HQ_FINANCE写入403、不改业务数据、请求体身份伪造无效、正确资源类型及唯一审计、敏感字段不进入审计。带版本的修改验证旧版本拒绝（归档模板按原行为404）；用户成功场景额外验证范围及两方并发仅一方成功。

故障前后对比分类、单位、品牌、商品/转换、供应商/供货、模板/商品供应商/设置/门店绑定、价格日程、门店、用户/范围的完整隔离快照；失败后审计0条，原输入重试成功且审计1条。

专项日志：/tmp/master-data-audit-focused.log。首轮清理外键顺序错误及创建夹具缺必填字段已修正，首轮48份夹具按精确时间命名范围清理，不将失败运行计作通过。最终完整回归结果见progress.md和development-log.md。

本批没有新增页面截图、微信真机、OSS或生产证据；C6全角色/隐私矩阵与L5整包仍需独立关闭。
