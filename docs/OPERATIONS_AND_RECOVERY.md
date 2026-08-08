# 手办图库运行、备份与恢复蓝图

## 1. 文档状态

本文定义未来正式产品的供应商中立运行接口和恢复门禁。当前没有正式应用、生产数据库、对象存储、商业监控服务或云部署；本任务不创建、不启动也不修改任何运行基础设施。

系统组件和数据边界见 [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)，已接受技术选择见 [`TECH_STACK_DECISION.md`](../research/TECH_STACK_DECISION.md)。既有 GitHub Actions 生产门禁是研究证据，不是正在运行的生产环境。

## 2. 环境模型

| 环境 | 用途 | 数据 | 网络与凭据 | 发布规则 |
| --- | --- | --- | --- | --- |
| Local | 单开发者功能与快速回归 | 仅合成 fixture；可使用隔离 SQLite 快速测试，但正式 adapter 回归用 PostgreSQL | 默认 loopback；本地临时凭据 | 不产生可发布结论，不连接生产资源 |
| CI | 全量 PostgreSQL/S3/standalone 门禁 | 运行时生成的合成数据与图片 | 临时 runner、随机凭据、loopback、结束销毁 | 只生成脱敏证据，不部署 |
| Staging | 未来的发布候选、迁移和恢复演练 | 独立的非生产数据；不得复制不必要的生产隐私数据 | 与 production 完全独立的身份、数据库、bucket/prefix | 只有独立授权后创建；通过门禁也不自动晋级 |
| Production | 未来公开只读图库与受控 Admin | 正式审核后的业务数据和正式媒体 | 最小权限运行身份、私有 PostgreSQL/S3、受控入口 | 当前不存在；发布与回滚必须人工授权 |

环境之间不得共享数据库、bucket/prefix、Payload secret、管理员账号或候选客户端凭据。配置结构可以一致，秘密值必须不同。

## 3. 版本、构建与配置清单

### 3.1 接受的版本线

- Payload CMS `3.87.x`
- Next.js `16.2.x`
- React `19.2.x`
- TypeScript strict
- Node.js `22.x`
- PostgreSQL `16.x`
- S3 兼容对象存储，通过 Payload S3 adapter 使用稳定 `storageKey`
- Next.js/Payload `.next/standalone`

每次发布锁定精确 patch；不能只记录兼容线。依赖或 runner 变化必须重跑生产门禁。

### 3.2 Release manifest

每个候选发布生成小型、不可含秘密的 `release-manifest.json`，至少记录：

| 字段 | 含义 |
| --- | --- |
| `releaseId` | 不透明、唯一的发布标识 |
| `gitCommit` | 构建输入 commit SHA |
| `builtAt` | UTC 时间 |
| `nodeVersion`、`npmVersion` | 构建工具版本 |
| `payloadVersion`、`nextVersion`、`reactVersion` | 精确运行时版本 |
| `lockfileSha256` | 锁文件摘要 |
| `migrationHead`、`migrationSetSha256` | 预期数据库 schema 历史 |
| `standaloneSha256` | 可发布 bundle manifest 的摘要，不把整个构建物写入 Git |
| `baseImageDigest` | 若未来容器化，记录实际不可变 digest |
| `configurationSchemaVersion` | 配置结构版本，不含配置值 |
| `ciRunId`、`ciArtifactDigest` | 对应完整绿色门禁 |

运行中的 `/health` 和结构化日志只返回 `releaseId`、commit 短摘要和 schema 版本，不暴露依赖树、路径或秘密。

### 3.3 配置边界

运行时配置必须由环境注入并经过启动时 schema 校验：

- `DATABASE_URI`：PostgreSQL 连接；不得出现在日志或浏览器 bundle。
- `PAYLOAD_SECRET`：Payload 会话/加密秘密；各环境唯一，可轮换。
- S3 endpoint、region、bucket、业务 prefix、access key 与 secret key：正式环境使用最小权限身份；公开 URL 与业务 key 分离。
- `PUBLIC_BASE_URL`、可信代理列表与 cookie secure/same-site 策略：只有明确环境值，不从请求头盲推断。
- 候选客户端凭据：明文只在创建时显示一次，数据库只保存强哈希、状态、owner 和轮换元数据。
- 管理员 bootstrap：不得硬编码；首次建立必须是单独、可审计的操作。

配置校验失败必须阻止 readiness，不能用默认生产凭据“继续运行”。

## 4. PostgreSQL migration 运行规则

1. Migration 只追加、进入版本控制并经过人工审查；生产禁止 schema push、自动推导和启动时隐式生成 migration。
2. SQLite 与 PostgreSQL migration 路径严格分离；SQLite 通过不能替代 PostgreSQL 结果。
3. CI 必须从空 PostgreSQL 运行全部 migration，再重复运行并核对 schema 签名、约束、索引、enum 和 migration 表。
4. 发布前生成数据库备份和共同 snapshot；高风险 migration 先在 staging 对恢复副本演练。
5. 只有一个 migrator 持有数据库 advisory lock；应用实例不得并发执行 schema 变更。
6. Migration 成功后再启动新 release 的 readiness；migration 失败时保留旧应用、不切流量并按 runbook 处理。
7. 已经成功提交的 migration 不原地修改。修复使用新的 forward migration；只有在明确证明安全且未对外使用时才允许重建未发布环境。
8. 涉及不可逆数据转换时，migration 必须分阶段：先兼容读写、回填并核对、切换读取、最后在后续发布清理旧字段。

## 5. Health、liveness 与 readiness

| 探针 | 目的 | 检查 | 失败语义 |
| --- | --- | --- | --- |
| `GET /health/live` | 判断 Node 进程能否处理事件循环 | 进程、事件循环和最小内存状态；不访问外部依赖 | 失败才重启进程；不能因数据库短暂故障制造重启风暴 |
| `GET /health/ready` | 判断是否可接收流量 | 配置 schema、目标 migration head、PostgreSQL 只读查询、S3 bucket/prefix 最小只读检查、必要密钥加载 | 任一关键依赖不满足返回 503 并退出负载均衡 |
| `GET /health` | 内部诊断摘要 | `releaseId`、commit、schema/config 版本、依赖状态分类 | 只返回 `ok/degraded/fail` 和稳定错误码，不返回 URI、bucket 凭据、SQL 或堆栈 |

媒体写入还需要独立的 S3 write 能力检查；readiness 的只读成功不应被误写成上传能力已验证。公开流量与 Admin 可使用不同 readiness policy：公开缓存读可以降级，正式写命令在 PostgreSQL、OperationLog 或 S3 所需能力不可用时必须 fail closed。

## 6. S3 与媒体运行边界

- 数据库只保存逻辑 `storageKey`、SHA-256、aHash、尺寸、格式、byte size 和派生关系；endpoint、签名 URL、CDN URL 不是身份。
- 原图写入后必须读回并验证 SHA-256，再提交数据库关系；数据库提交失败则补偿删除对象。
- `thumbnail` 和 `preview` 可从原图重建；原图缺失是完整性事件，不能生成占位对象冒充恢复。
- 来源失效、SourceRecord/CandidateRecord 软删除或客户端重放不能删除或替换正式主图。
- 对象删除只通过独立垃圾回收计划：先生成候选清单，证明无正式/候选/审计保留引用，人工批准后延迟删除；不在在线事务中物理删除。
- Provider、endpoint、bucket 或 prefix 迁移使用 manifest 驱动的逐项复制和 SHA-256 核对，业务关系中的逻辑 `storageKey` 保持稳定。

## 7. 联合备份协议

### 7.1 Snapshot 组成

一次可恢复备份必须共享一个不可重复的 `snapshotId`，并包含：

1. PostgreSQL `pg_dump --format=custom` 输出；
2. 对象清单及独立介质中的对象备份；
3. release manifest；
4. migration head 和 schema signature；
5. 全部核心业务 collection/实体的计数与关系 digest；
6. 正式主图、来源失效状态、SystemSetting、ReviewWorkItem 与 OperationLog 摘要；
7. 每个清单文件和数据库 dump 的 SHA-256；
8. 备份开始/结束时间、写入冻结或一致性窗口说明。

数据库 dump 不进入 Git、普通 CI Artifact 或应用节点长期磁盘。正式备份介质必须独立于运行数据库和主 S3 故障域；“同一个 MinIO 的另一个 prefix”只能验证流程，不能称为生产灾备。

### 7.2 Object manifest

每个对象条目至少包含：

```json
{
  "mediaId": "opaque-id",
  "storageKey": "stable/logical/key.png",
  "backupKey": "snapshot-scoped/key.png",
  "kind": "original|preview|thumbnail",
  "parentMediaId": "opaque-id-or-null",
  "byteSize": 1234,
  "contentType": "image/png",
  "sha256": "hex",
  "aHash": "hex-or-null",
  "objectVersion": "provider-neutral-version-or-null"
}
```

Manifest 自身使用规范排序和稳定序列化后计算 SHA-256。凭据、签名 URL、Cookie、数据库 URI 和对象二进制不得进入 manifest。

### 7.3 完成门禁

备份只有在以下条件同时满足时才标记 `complete`：custom dump 退出 0；对象数、byte 总数和 SHA-256 清单闭合；dump/manifest/release/snapshot ID 一致；目标介质可读回；没有秘密扫描告警。任一条件失败，整次 snapshot 标记 `failed`，不得作为恢复候选。

RPO、RTO、保留周期和异地副本数量尚未通过真实运维测量，不在本文虚构承诺；正式上线前必须由项目所有者按成本和风险批准。

## 8. 八步恢复流程

### 8.1 前置动作（不计入八步）

先建立 incident ID，停止写流量或进入维护只读模式，记录恢复负责人和批准人。选择最后一个 `complete` snapshot，核对 database dump、object manifest、release manifest 的共同 `snapshotId` 与 SHA-256，并取得完全匹配的 standalone 构建。任一摘要或版本不符即停止，不进入恢复步骤。

### 8.2 规范八步顺序

1. **建立空 PostgreSQL。** 创建隔离的空 PostgreSQL 16 数据库，应用最小权限临时身份，并证明没有业务表或旧数据；同时准备隔离、不可被公开读取的恢复网络。
2. **恢复数据库。** 使用 PostgreSQL 16 官方 `pg_restore` 恢复 custom dump，核对 migration head、schema signature、全部核心 collection/实体计数、数据与关系 digest；不先运行会改变快照的自动 migration。
3. **恢复或挂载对象。** 准备空 S3 bucket/prefix，按 snapshot 恢复对象，或只读挂载已经属于该 snapshot 的独立对象副本；逻辑 `storageKey` 不因 endpoint/prefix 改变。
4. **检查 manifest。** 逐项验证 object manifest 的 count、byte size、content type、SHA-256、原图/派生关系与 DB 引用，输出 missing、orphaned、hash mismatch、metadata mismatch；核对正式主图、来源状态、成人设置、ReviewWorkItem 和 OperationLog。
5. **启动应用。** 用匹配 release 的 `.next/standalone` 仅绑定 loopback 启动，检查 live/ready、migration status、Admin、搜索、图库和媒体读取；此时仍不开放公开读取。
6. **重建可再生派生图。** 只在原图存在且 SHA-256 正确时重建缺失 thumbnail/preview，再次运行对象审计；原图缺失不得伪造恢复，也不得自动替换正式主图。
7. **运行共享合同。** 对恢复环境运行完整共享合同、schema/关系/幂等/正式主图/设置检查和 standalone restart smoke；任何失败都停止切换。
8. **权限攻击回归后开放公开读取。** 重跑无/错/撤销凭据、跨 owner、正式实体/主图、generic REST/GraphQL/Local API/Admin、Review target 和 OperationLog 绕过攻击；全部硬门禁通过并经双人批准后，才打开 `Public read` 并切换公开读取流量。

完成八步后保留旧环境只读且不立即删除，记录恢复 operation/incident，观察结构化指标并安排事后复盘。

任一步失败都停止切换，不把部分恢复写成成功。生产环境首次恢复演练和任何真实切流量都需要独立授权。

## 9. 对象完整性审计

审计输入是数据库媒体关系、正式主图引用、object manifest 和实际 S3 listing/head/read 结果。输出分类：

| 分类 | 定义 | 处理 |
| --- | --- | --- |
| `missing` | 数据库或 manifest 期望对象，但 S3 不存在 | 正式原图为硬失败；派生图可在原图 hash 正确时重建 |
| `orphaned` | S3 有对象，但数据库和有效 manifest 均无引用 | 记录并隔离；不自动删除，等待保留期与批准 |
| `hash_mismatch` | key 存在但 SHA-256 不同 | 视为损坏/错误覆盖，停止发布或恢复，从可信备份重建 |
| `metadata_mismatch` | byte size、content type、尺寸或派生关系不符 | 阻止提升为主图；校验内容后修复 metadata 或对象 |
| `dangling_main_image` | FigurePrototype 指向不存在或不完整 media | 硬失败；绝不自动选择另一张图替代 |
| `unexpected_delete` | 来源/候选变化导致正式对象减少 | 硬失败，停止相关 worker 并恢复对象和引用 |

审计必须有稳定 JSON 摘要：snapshot/release、expected/actual count、各分类数量和脱敏 key digest。高基数 storageKey 不作为长期指标 label，只出现在受控诊断或审计文件中。

## 10. 故障模式（Failure modes）与 Runbook

| 故障 | 立即动作 | 恢复与验证 | 禁止行为 |
| --- | --- | --- | --- |
| PostgreSQL 不可用 | readiness 503；停止所有写命令；公开读按缓存能力降级 | 恢复连接，检查 migration head、事务与 OperationLog；必要时按八步恢复 | 不切 SQLite，不在应用启动时自动改 schema |
| PostgreSQL 主从/数据不一致 | 冻结写入并保留证据 | 选择可信 snapshot，恢复到空目标，比较 digest/关系 | 不在原库上手工“补几行”掩盖差异 |
| S3 不可用 | 候选上传返回稳定 503 且 `retryable=true`；正式媒体读取明确失败 | 服务恢复后按同一 idempotency key 重试并运行对象审计 | 不返回假成功，不写成功 OperationLog，不替换主图 |
| 上传后 DB 提交失败 | 补偿删除本次对象，记录失败请求 ID | 验证 Media/OperationLog/关系增量为 0；补偿失败进入 orphan 队列 | 不留下半成品正式记录 |
| 派生图缺失 | 标记 degraded | 验证原图 SHA-256 后重建指定派生图并再次审计 | 不改变正式主图关系 |
| 原图缺失/损坏 | 阻止相关媒体发布和主图变更，触发完整性事件 | 从可信对象备份按原 storageKey 恢复并核哈希 | 不从缩略图伪造原图，不自动换主图 |
| Migration 失败 | 停止新 release；旧 release 保持服务（若 schema 兼容） | 收集短错误分类，在恢复副本复现，发布 forward fix 或恢复 | 不修改已应用 migration，不强制标记成功 |
| Standalone readiness 失败 | 不进入负载均衡 | 核对 release manifest、配置 schema、DB/S3、Sharp trace、静态资源 | 不退回 `next dev` 冒充生产启动 |
| 候选凭据泄露/滥用 | 立即 disabled/revoke 单 client，保留 owner 审计 | 轮换凭据，查询该 owner 的候选和操作，重跑跨 owner 攻击 | 不轮换所有 client 为共享 token，不删除审计 |
| 跨 owner 或正式写绕过 | 视为安全硬失败，冻结候选写入口 | 保存脱敏证据，修复服务端授权，回溯正式状态和 OperationLog | 不依赖 UI 隐藏或 loopback 作为授权 |
| Review/正式乐观冲突 | 后提交者得到 409 和当前版本摘要 | 管理员刷新、人工比较并重新提交新命令 | 不 last-write-wins，不静默覆盖 |
| OperationLog 写入失败 | 整个正式事务回滚 | 恢复审计写能力后由管理员重试原 command ID | 不先改正式记录再“补日志” |
| 前置 operation 有依赖却被请求 undo | 返回依赖冲突并展示阻塞 operation IDs | 管理员选择取消、先撤后续操作或经批准的显式级联计划 | 不执行全局最近一次撤销，不留下断裂关系 |
| Backup digest/manifest 不匹配 | 标记 snapshot failed 并隔离 | 重新生成完整 snapshot；调查传输或介质损坏 | 不用损坏快照恢复，不手改 hash |

每个 runbook 的完成条件都包括：用户可见状态合理、业务不变量成立、OperationLog/incident 记录完整、健康探针恢复、相关合同通过。

## 11. 供应商中立可观测性接口

本蓝图不选择或要求任何商业服务。正式实现只定义开放、可替换的接口：JSON stdout/stderr、OpenMetrics 文本端点、W3C Trace Context 和 OpenTelemetry 兼容 OTLP exporter（默认可关闭）。

### 11.1 结构化日志

每条应用日志至少包含：

```json
{
  "timestamp": "RFC3339 UTC",
  "level": "info|warn|error",
  "service": "figure-gallery",
  "environment": "local|ci|staging|production",
  "releaseId": "opaque-id",
  "requestId": "opaque-id",
  "traceId": "opaque-id-or-null",
  "actorType": "public|admin|candidate-client|system",
  "actorIdHash": "bounded-hash-or-null",
  "routeTemplate": "/api/review-items/{id}/complete",
  "operationId": "opaque-id-or-null",
  "workItemId": "opaque-id-or-null",
  "result": "success|rejected|failed",
  "errorCode": "stable-code-or-null",
  "durationMs": 0
}
```

禁止记录：Authorization、Cookie、明文 token、密码、数据库 URI、S3 secret、签名 URL、multipart 二进制、完整外部来源页面、原始 SQL 参数和不必要的用户输入。安全拒绝用稳定错误码，内部堆栈只进入受控错误输出，不返回客户端。

### 11.2 指标

计划暴露低基数 OpenMetrics 指标：

- `http_requests_total{route,status_class,actor_type}`
- `http_request_duration_seconds{route}`
- `domain_commands_total{command,result}`
- `domain_conflicts_total{command,reason}`
- `candidate_uploads_total{result,media_type}`
- `candidate_upload_bytes{media_type}`
- `object_store_operations_total{operation,result}`
- `review_work_items{status}`
- `backup_runs_total{result}` 与 `backup_last_success_timestamp_seconds`
- `object_audit_findings{kind}`
- `migration_head_info{schema_version}`（值恒为 1）

不得把 user ID、candidate ID、storageKey、source URL、operation ID 或 error message 作为 metric label。

### 11.3 Trace 与审计

- 接受并传播 W3C `traceparent`；只有可信入口生成/覆盖 request ID。
- 跨 PostgreSQL、S3 和领域命令使用 OTel span，但 span attribute 遵守同一脱敏规则。
- OperationLog 是持久业务审计，不由应用日志或 trace 替代；日志系统不可用不应丢失正式审计，OperationLog 写失败必须回滚业务事务。
- 备份、恢复、migration、凭据轮换、Review reopen、merge/split/undo 和正式主图变化都需要稳定 operation/incident 关联。

## 12. 发布、回滚与清理边界

### 12.1 发布前门禁

发布候选必须同时具备：完整 15 阶段 CI 绿色结果、与 commit 对应的脱敏 Artifact、精确 release manifest、目标 migration 演练、最近一次可验证联合备份，以及正式批准。Draft PR、旧 commit 的绿色结果或本地 smoke 均不能替代。

### 12.2 发布顺序

未来发布顺序规划为：生成联合备份 → 验证配置与 release manifest → 单 migrator 执行 migration → loopback 启动 standalone → readiness 与 smoke → 人工批准切流量 → 观察 → 保留旧 release 供受控回退。

应用回退只在 schema 向后兼容时成立。不可逆 migration 不能靠启动旧二进制回滚，必须使用 forward fix 或从已验证 snapshot 恢复到隔离目标。

### 12.3 清理

- CI 和恢复演练结束使用 `always()` 停止进程/临时基础设施，删除运行时 `.env`、临时凭据、dump、对象、合成图片和 clean tree，并断言零残留端口/容器/volume（若对应环境使用容器）。
- 生产数据和备份不得由普通发布清理步骤删除。
- Artifact 只保存小型脱敏 JSON/文本摘要和 manifest，不保存数据库、dump、对象、图片、秘密或完整日志。

## 13. 当前未决事项

以下事项必须在正式上线前由后续授权任务决定并验证：

- 托管位置、反向代理、TLS、域名和网络隔离实现；
- PostgreSQL 与 S3 的实际 provider、版本升级节奏和最小权限策略；
- 独立备份介质、加密、保留期、RPO/RTO 和跨故障域恢复；
- 日志、指标与 trace 的开源或自托管实现；不强制商业服务；
- 容量、峰值并发、长期稳定性、成本和告警阈值；
- 管理员身份生命周期、MFA/SSO 需求和紧急访问流程；
- 正式发布、回滚和灾备演练的审批人及频率。

本文没有部署任何服务，没有访问外部数据源或 Hpoi，没有运行 Docker，也没有创建正式应用代码。任何环境创建、真实凭据使用、数据导入或部署仍需独立明确授权。
