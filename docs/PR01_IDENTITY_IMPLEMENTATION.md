# PR-01 业务身份实现

## 1. 状态与结论

本文记录 PR-01 的已选实现，不把尚未完成的 CI 门禁写成通过。结论是：**保留 Payload 内部 serial 技术 ID，并为每个 PR-01 目录实体/关系增加不可变、唯一、非空的 UUID `stableId`**。`stableId` 是领域命令、审计作用域、未来导出和未来公开接口的业务身份；内部 `id` 只服务 Payload、PostgreSQL 外键和本次实现细节，不是长期合同。

OperationLog 不另设 `stableId`：它以唯一 UUID `operationId` 作为稳定操作身份，以 `scopeStableId` 指向目录业务身份。

## 2. Payload 3.86.0 能力调查

固定依赖 `@payloadcms/db-postgres@3.86.0` 的公开类型声明包含：

```ts
idType?: 'serial' | 'uuid' | 'uuidv7'
```

因此 PostgreSQL adapter **支持 adapter 级**原生 UUID/UUIDv7 ID；这不是需要手写 ID hook 的缺失能力。调查同时确认：

1. `idType` 是 `postgresAdapter(...)` 的 adapter 级选项，不是只切换某几个 PR-01 Collection 的局部迁移开关；
2. 已合并 PR-00 的 `users`、技术 `media`、Payload 内部表及关系使用 serial ID；
3. PR-00 baseline migration 和当前 `payload.config.ts` 未声明 UUID `idType`；
4. 在 PR-01 把 adapter 全局切换为 UUID，会要求同一轮可靠迁移既有技术主键、序列、关系表和 Payload 内部外键，超出“核心目录增量”范围，也会破坏 PR-01 down 回 PR-00 schema signature 的简单边界；
5. 自定义 Collection `id` 虽可建立文本身份，但不能在不迁移整个既有基线的前提下，可靠地把本轮新增表变成与 adapter 全局策略一致的原生 UUID 主键。

基于这些事实，本轮采用任务允许的 `stableId` fallback，而不伪造局部原生 UUID 主键，也不修改 PR-00 baseline migration。

## 3. 身份映射

| Collection | PostgreSQL/Payload 内部身份 | 领域稳定身份 |
| --- | --- | --- |
| Work | serial `id` | UUID `stableId` |
| Character | serial `id` | UUID `stableId` |
| CharacterAlias | serial `id` | UUID `stableId` |
| Manufacturer | serial `id` | UUID `stableId` |
| FigurePrototype | serial `id` | UUID `stableId` |
| FigurePrototypeCharacter | serial `id` | UUID `stableId` |
| FigureVersion | serial `id` | UUID `stableId` |
| OperationLog | serial row `id` | UUID `operationId`；另有 `scopeStableId` |

关系列（例如 `character_id`、`prototype_id`）在数据库内使用技术 FK。命令输入只接受 `workStableId`、`characterStableId`、`manufacturerStableId`、`prototypeStableId`、`aliasStableId` 等稳定身份；领域 repository 在事务内解析为技术 ID。命令结果只返回 `stableId`、可选 `relatedStableId`、`lockVersion`、状态和 `operationId`。

## 4. 生成与不可变性

- 正式目录 service 在创建实体或关系时调用 Node `crypto.randomUUID()`；不手写 UUIDv7。
- Collection 的 `stableId` field hook 也使用 `randomUUID()`，并拒绝更新时的值变化，作为未来受控 Payload 写路径的纵深防御。
- Catalog command 的显式 schema 不提供“指定新 stableId”或任意 patch；版本化命令中的 `stableId` 只用于定位目标。
- generic REST、GraphQL mutation、Local API、Admin save 及 `overrideAccess` 旁路均由 access 与 `beforeOperation` 拒绝；内部 domain context 不能由 HTTP 构造。
- 领域 SQL 的 update 集合不包含 `stable_id`。
- PostgreSQL 对七个 `stable_id` 列建立 NOT NULL、唯一索引和 UUID 形状 CHECK；`operation_id`、`scope_stable_id` 也有 UUID 形状 CHECK。

上述防线必须由 CAT-02、CAT-15、CAT-17 和 PostgreSQL 攻击测试证明；最终状态以机器证据为准。

## 5. 审计与幂等

每条命令要求独立 UUID `operationId`。事务先以该值取得 PostgreSQL advisory transaction lock，再读取 OperationLog：

- 同一 `operationId` 与相同规范请求 SHA-256 digest：返回已保存的稳定结果，不重复写业务行；
- 同一 `operationId` 与不同 digest：返回 `CATALOG_OPERATION_ID_CONFLICT`；
- 新操作：业务变化、`lockVersion` 和 OperationLog 在同一 PostgreSQL 事务提交。

OperationLog 的 `scopeStableId` 记录领域身份，before/after snapshot 也只保存小型、脱敏的业务视图；不得把 serial ID 变成对外审计合同。

## 6. Migration 与未来演进

`20260715_151314_pr01_core_catalog` 只新增 PR-01 表、索引、约束和 Payload locked-document 关系列，不改变 PR-00 的技术主键。其 down 路径在空的非生产测试数据库中删除 PR-01 schema 并恢复 PR-00 signature。

如果未来决定把整个 Payload adapter 切换到 UUID/UUIDv7，必须使用独立 ADR 和 migration：盘点所有技术表与 FK、建立双写/回填或停机迁移方案、验证 fresh/repeat/restore/rollback，并保留现有 `stableId` 不变。即使内部主键迁移成功，外部合同也不应改变；没有必要仅为隐藏实现细节而重发业务 ID。

PR-01 不为 CandidateClient、SourceRecord、ReviewWorkItem、MediaAsset 或后续实体预建表或 ID；它们只能在各自获授权 PR 中采用同一原则并独立迁移。
