# Figure Gallery 交付路线（PR-00—PR-08）

## 1. 目的与推进规则

本路线把正式产品拆成九个可独立审核、验证和回滚的 PR。顺序是依赖顺序，不是自动执行许可；每个 PR 都必须由单独任务明确授权、从最新 `main` 创建独立分支，并默认以 Draft PR 交付。达到当前 PR 的停止条件后立即停止。

当前状态：PR-00 与 PR-01 已合并，PR-01 的 CAT-01—CAT-21 和最新 `main` Formal web CI 已通过。正式 PR-02—PR-08 暂停但不取消；当前优先用隔离 personal gallery 验证自动发现覆盖、柴郡/蕾姆补收录与 official source resolution。恢复 PR-02 仍需新的明确授权，MVP 源码和运行数据不得复制到正式应用。

共同规则：

- 技术底座固定为 Payload CMS `3.87.x`、Next.js `16.2.x`、React `19.2.x`、TypeScript、Node.js `22.x`、PostgreSQL 16 与 S3 兼容对象存储。
- `apps/web` 只能由 PR-00 使用 Payload 官方脚手架干净生成；不得复制或迁移 `spikes/`。
- 每个 PR 必须说明 migration、测试、回滚和数据兼容性；关键一致性不能只由 Admin UI 保证。
- 正式变更必须经过领域 service、数据库事务和 `OperationLog`；候选入口不能写正式聚合。
- Hpoi 是 discovery/coverage benchmark；direct Hpoi automation 仍禁止。明确授权的隔离工具可读取第三方公开搜索索引返回的 Hpoi URL/标题/摘要文本，但不得对 Hpoi 发起任何网络或浏览器访问；正式 Direct Hpoi Adapter 仍需独立授权和明确书面许可。
- 合并、部署和后续 PR 均需要另行授权。

## 2. 总览

在恢复正式 PR 路线前，近期产品价值顺序为：

1. 自动发现覆盖率；
2. 柴郡/蕾姆补收录；
3. candidate → official source 自动解析；
4. FigurePrototype 层去重；
5. 图片完整度；
6. 封面质量；
7. 更多角色。

第三个角色、公网部署、继续堆正式后台功能和无直接用户价值的基础设施优化均暂缓。详见 [产品北极星](PROJECT_NORTH_STAR.md) 与 [MVP-05 Hpoi 搜索索引发现](MVP05_HPOI_INDEX_DISCOVERY.md)。

| PR | 状态 | 主题 | 主要交付 | 依赖 |
| --- | --- | --- | --- | --- |
| PR-00 | 已合并 | 正式项目初始化 | 官方脚手架、目录边界、CI、health、空 migration | 本蓝图获批 |
| PR-01 | 已合并 | 核心目录数据模型 | Work、Character/Alias、Manufacturer、Prototype/Character relation/Version、OperationLog 骨架 | PR-00 |
| PR-02 | 未开始（暂缓） | 来源和候选池 | CandidateClient、SourceRecord、CandidateRecord、CandidateImage | PR-01 |
| PR-03 | 未开始（暂缓） | 审核工作流 | ReviewWorkItem、字段决定、允许目标、OperationLog | PR-02 |
| PR-04 | 未开始（暂缓） | 媒体和正式主图 | 内容寻址媒体、S3、派生图、提升与主图保护 | PR-03 |
| PR-05 | 未开始（暂缓） | Merge/Split/Undo | operation dependency、事务、乐观锁、管理操作 UI | PR-04 |
| PR-06 | 未开始（暂缓） | 公开搜索和图库 | 搜索、消歧、图库、分页、成人过滤、灯箱 | PR-05 |
| PR-07 | 未开始（暂缓） | 导出、备份和恢复 | JSON/CSV、对象 manifest、恢复与完整性审计 | PR-06 |
| PR-08 | 未开始（暂缓） | 部署准备 | standalone、readiness、可观测性、runbook、非生产验证 | PR-07 |

## 3. PR-00：正式项目初始化

**状态：已合并。** 后续 PR 必须保留 scaffold provenance、PR-00 migration 与 Formal web CI 回归，不能改写历史以迁就当前实现。

### 目标

- 使用官方脚手架在 `apps/web` 创建 Payload + Next.js 集成应用。
- 锁定接受的版本和 `package-lock.json`，声明 Node.js `22.x` 与 npm。
- 建立 `apps/`、`packages/`、`infra/` 的模块边界，但只创建必要空骨架。
- 配置 PostgreSQL adapter 边界、S3 抽象边界和本地临时文件存储策略。
- 建立环境变量 schema、liveness/readiness health、空 migration、测试框架和正式 CI 基线。

### 非目标

- 不创建 Work 等业务 Collection，不实现候选、审核、媒体或公开页面。
- 不复制 spike 源码、migration、测试 fixture 或 workflow。
- 不部署，不接生产数据库、生产 bucket 或真实来源。

### 数据迁移

- 只生成并验证空基线 migration；无业务表、无历史数据导入。
- migration 必须在空 PostgreSQL 16 上 fresh/repeat 均成功；SQLite 不能成为正式配置。

### 测试

- lock install、typecheck、ESLint、Vitest 空基线、Playwright smoke。
- PostgreSQL fresh/repeat migration、health、构建与 `.next/standalone` 干净启动。
- S3 配置缺失/不可用的可控失败测试；仓库、凭据、二进制和 Artifact 扫描。

### 回滚

- 删除未合并分支与临时数据库/bucket；不影响现有 `main` 或 research/spikes。
- 已合并后如需撤销，以独立 revert PR 移除正式骨架，不改写历史。

### 停止条件

- 脚手架、锁文件、边界、health、空 migration、CI 和测试基线全部可复现。
- 未出现业务实现或 spike 复制；Draft PR 已创建后停止，不开始 PR-01。

## 4. PR-01：核心目录数据模型

**状态：已合并。** 具体实现见 [PR-01 核心目录实现](PR01_CORE_CATALOG_IMPLEMENTATION.md) 和 [业务身份实现](PR01_IDENTITY_IMPLEMENTATION.md)；最终 `CAT-01`—`CAT-21` 与合并后 `main` Formal web CI 已通过。

### 目标

- 实现 Work、Character、CharacterAlias、Manufacturer、FigurePrototype、FigurePrototypeCharacter、FigureVersion 和最小 OperationLog。
- 保留 Payload serial technical ID，并建立不可变、唯一 UUID `stableId` 业务身份、状态、软删除、时间戳、关系、原型级授权/收录审核、完整灰模门禁和数据库约束。
- 提供基础只读或受限 Payload Collection Admin 页面。
- 建立正式写入的领域 service 和 `OperationLog` 最小骨架。

### 非目标

- 不实现来源、候选上传、审核工作流、媒体提升、merge/split/undo 或公开图库。
- 不导入真实手办数据或图片。

### 数据迁移

- 新增八个核心目录/审计表、Manufacturer owned alias 表、枚举/检查约束和部分唯一索引；不修改 PR-00 baseline migration。
- migration 必须提供向下回滚或明确的 forward-fix 方案；seed 只含合成测试数据。

### 测试

- 关系、多角色/可选作品、别名搜索文档、状态、稳定身份、软删除和 CAS/事务单元/集成测试。
- 正版/正式授权第三方、排除未授权类别、不同制造商必须独立原型，以及 gray_prototype 只有 completeness=complete 才可发布的收录测试。
- published prototype 的主图与 active Manufacturer 前置约束先以不可发布占位策略验证。
- REST、GraphQL、Local API、Admin save 与 overrideAccess 不能绕过领域 service 的攻击测试；Catalog Operations 使用真实浏览器验证。
- 最终机器证据必须覆盖 `CAT-01`—`CAT-21`，未运行项不得写成通过。

### 回滚

- 在无生产数据阶段回退 schema；存在数据后只允许 forward migration 或独立 revert PR。
- 回滚前导出实体计数与关系摘要。

### 停止条件

- 核心模型和约束通过 PostgreSQL 集成测试，Admin 仅暴露授权入口；停止，不开始 PR-02。

## 5. PR-02：来源和候选池

### 目标

- 实现 CandidateClient、SourceRecord、CandidateRecord、CandidateCommandReceipt、UploadReceipt、CandidateImage，以及 CandidateImage 必需的最小 candidate-only MediaAsset 内容身份。
- 实现 per-client 独立、只存摘要的凭据与完整生命周期：active/disabled/revoked、disable/enable、rotate、不可逆 revoke，以及 owner 隔离；rotate 后旧 Token 立即失效，新明文只显示一次。
- 实现 candidate upsert、multipart 原图上传、服务端 SHA-256 内容身份、稳定来源键、规范 URL fallback 与幂等结果；只通过 PR-00 的存储抽象写 candidate namespace。
- 实现 Admin 人工候选表单和明确允许的离线 JSON/CSV 导入；URL 只作为文本保存，不 unfurl、不 fetch。离线行必须提供稳定 source item ID，或提供可规范化 URL。
- 建立只读的 SystemSetting 单例及五项默认值，上传服务从 `candidateUploadSizeLimit`、`allowedImageFormats` 读取限制；本 PR 不提供任意设置修改入口。
- 候选入口只写 Candidate aggregate。

### 非目标

- 不直接访问 Hpoi，不把 personal gallery 的索引发现实现复制进正式应用；其他外部 adapter 仍需独立许可与任务。不实现正式数据写入与主图选择。
- 不实现完整人工审核 UI、thumbnail/preview、正式媒体关系、正式提升、主图、完整 S3 生命周期或来源定时任务。

### 数据迁移

- 新增客户端、来源、候选、命令/上传 receipt、最小 MediaAsset 内容身份、候选图片关联和五项 SystemSetting 默认值；这些采用最终稳定 ID，PR-04 只能扩展，不能另建一套候选媒体真值。
- 建立 `(sourceType, sourceItemId)` 唯一与仅在 ID 为空时适用的 fallback URL 部分唯一索引。

### 测试

- 无/错/disabled/revoked/轮换前旧 Token、Client A 修改 Client B、generic REST/GraphQL/Local API 绕过攻击；验证 enable 只恢复 disabled、revoked 不可恢复、新明文 Token 只显示一次。
- 重复 upsert、同内容换 URL/文件名、同 URL 内容变化、中断重试、非法 MIME/尺寸/大小。
- Admin 人工录入和离线 JSON/CSV 导入的 schema/幂等/无网络测试；无 URL 的离线记录必须靠稳定 item ID 建立身份。
- 上传限制必须从五项 SystemSetting 的只读真值读取；candidate client 不能修改设置。
- 确认候选身份不能写正式实体、SystemSetting 或主图。

### 回滚

- 删除合成候选对象前核对数据库引用；撤销 migration 时先导出来源键与 receipt 摘要。
- 不删除任何已被后续正式媒体引用的对象。

### 停止条件

- owner、最小权限、幂等和失败补偿通过；所有数据仍在候选聚合；停止，不开始 PR-03。

## 6. PR-03：审核工作流

### 目标

- 实现 ReviewWorkItem、field decisions、allowed targets、reviewer、lock version 和原因。
- 支持 open、accept/reject field、create formal prototype、attach version、defer、ignore、complete、reopen。
- 每次决定写入 `OperationLog`，完成后的普通入口不得继续改写。
- 为五项 SystemSetting 提供带 expected version、理由和 OperationLog 的 Admin 专用修改命令；不增加额外首版设置。
- 建立最小自定义 Admin Review View。

### 非目标

- 不完成正式媒体对象生命周期，不实现 merge/split/undo 或公开前台。
- 不追求品牌化后台 UI 或多人权限体系。

### 数据迁移

- 新增工作项、字段决定、允许目标、审计关系和乐观锁字段；沿用 PR-02 SystemSetting 表并增加受审计命令，不重建设置真值。
- 为已有合成候选幂等创建 open 工作项，不自动接受数据。

### 测试

- allowed target 越界、已完成修改、reopen 审计、双管理员并发冲突。
- 接受一个字段/拒绝一个字段/创建或选择目标/保存原因/完成操作的浏览器流程。
- 五项设置的 allowlist、乐观冲突、审计和 candidate/generic CRUD 越权测试。
- 事务失败时正式目标、工作项和 OperationLog 全部回滚。

### 回滚

- 工作项状态通过受审计的领域操作回退；不得直接删除审计历史。
- schema 回滚前导出 work item 与 operation 关系。

### 停止条件

- 完整审核闭环、目标约束、乐观锁和审计通过；停止，不开始 PR-04。

## 7. PR-04：媒体和正式主图

### 目标

- 在 PR-02 的最小 candidate-only MediaAsset/CandidateImage 身份上，完成 MediaObject、candidate/formal namespace、正式 FigureImage 关联和完整生命周期；不得重建或复制候选媒体真值。
- 使用内容 SHA-256 去重和稳定 `storageKey`；写入 S3 原图并生成 thumbnail/preview。
- 实现人工 promote 与主图选择，保证来源失效或候选软删不删除正式主图。
- 生成对象 manifest，建立 orphan/missing 只审计流程。

### 非目标

- 不做相似图搜索、AI 重复判断、自动主图替换或危险自动清理。
- 不提供前台下载，不使用真实手办图片完成测试。

### 数据迁移

- 向已有 MediaAsset/CandidateImage 增加 MediaObject、派生图、正式关联、稳定 storage key、尺寸与生命周期状态；migration 必须保持 PR-02 的 media/candidate ID 与 SHA-256 不变。
- 对象上传与数据库提交采用补偿流程；migration 不嵌入图片二进制。

### 测试

- PNG/JPEG magic bytes、MIME、大小、dimensions、SHA-256、aHash、去重与内容变化。
- S3 中断/恢复、prefix 迁移、URL 变化、派生图重建、引用保护和主图攻击。
- 数据库与 manifest 一致性、缺失/孤儿只报告不删除。

### 回滚

- 回滚关联前保留正式原图与 manifest；派生图可重建。
- 对象删除必须经过引用检查和延迟清理窗口，禁止随 schema rollback 直接删除。

### 停止条件

- 上传、派生、提升、主图保护、S3 故障与 manifest 闭环通过；停止，不开始 PR-05。

## 8. PR-05：Merge/Split/Undo

### 目标

- 为 merge、split 和按 operation ID 指定 undo 实现 PostgreSQL 原子领域操作。
- 建立稳定 operation UUID、scope、version、dependencies、before/after snapshot 和可撤销状态。
- 实现依赖冲突拒绝、乐观锁和最小自定义 Operations Admin View。

### 非目标

- 不实现“撤销全局最近一次”、静默覆盖或无审计的任意 Collection 保存。
- 不扩展到通用批处理或自动实体合并。

### 数据迁移

- 扩充 OperationLog dependency/scope/version/revert 字段和受影响实体关联。
- 不改写历史日志；需要补充的旧记录标记为不可撤销并说明原因。

### 测试

- 无关 X/Y merge 与 M/N split 分别撤销且互不干扰。
- 两管理员同一原型并发，后提交明确冲突，数据与日志一致。
- 依赖前置 merge 的操作存在时，直接 undo 被拒绝或按明确级联策略执行。

### 回滚

- 业务回滚通过指定 undo，不通过手工 SQL；代码回滚使用独立 PR 并保留日志 schema。
- 发现关系断裂即触发硬失败并禁止合并。

### 停止条件

- 三个规定并发/撤销场景全部通过，Admin 不可绕过领域 service；停止，不开始 PR-06。

## 9. PR-06：公开搜索和图库

### 目标

- 实现极简搜索首页、标准名/中日英名/别名部分匹配、唯一跳转和同名作品消歧。
- 实现角色图库：每原型一张主图、多人关联可发现、每页 16、默认按正式记录创建时间。
- 实现 4/3/2 响应式列、原始宽高比、成人默认隐藏与当前页灯箱导航。
- 公开查询只读消费 `showAdultImages`、`galleryPageSize` 和 `publicReadEnabled`，缓存键包含设置版本；上传两项设置仍由候选服务消费。

### 非目标

- 不显示手办详情、数量、价格或版本卡；不提供下载按钮。
- 不实现用户注册、评论、收藏、投稿、推荐或热门内容。

### 数据迁移

- 只增加必要搜索索引/文档字段与公开查询索引；不复制媒体。
- 索引必须可从正式数据重建。

### 测试

- 唯一/同名/无结果、多语言/别名/部分匹配、多人手办和版本不重复。
- 分页边界、4/3/2 列、宽高比、灯箱 Esc/缩放/首尾、无下载与无详情。
- `showAdultImages=false/true` 与 `publicReadEnabled` 的服务端过滤和缓存隔离。

### 回滚

- 可关闭 `publicReadEnabled` 并回退公开路由；保持 Admin 与正式数据不变。
- 搜索索引可删除并重建，不删除源实体。

### 停止条件

- 公共行为和隐私/成人过滤浏览器验收通过；停止，不开始 PR-07。

## 10. PR-07：导出、备份和恢复

### 目标

- 实现可解析 JSON、多表 CSV 和媒体 manifest 导出。
- 实现 PostgreSQL custom dump、S3 manifest、统一 snapshot ID/SHA-256 与空环境恢复 runbook。
- 恢复后验证关系、主图、来源状态、成人设置、OperationLog 和 ReviewWorkItem。

### 非目标

- 不决定生产保留期或采购商业备份服务。
- 不在 Git、Artifact 或导出中提交数据库备份、对象、Token、Token 哈希/摘要或其他凭据与敏感信息。

### 数据迁移

- 如需新增 snapshot/audit 元数据，使用向前 migration；导出格式提供 `schemaVersion`。
- 不把备份文件存入业务数据库。

### 测试

- JSON/CSV parse、关系 ID、storageKey、SHA-256/aHash、manifest 完整性。
- 空 PostgreSQL + 空 bucket 恢复，随后运行合同、权限攻击、主图/来源/成人设置检查。
- missing/orphan 对象只报告；备份与对象 manifest snapshot 必须配对。

### 回滚

- 导出工具可独立禁用；不删除已有快照。
- 恢复失败时保持公开读取关闭，清理本次空目标环境后重试。

### 停止条件

- 联合备份、空环境恢复和恢复后合同闭合；停止，不开始 PR-08。

## 11. PR-08：部署准备

### 目标

- 验证 `.next/standalone` 在干净非生产环境的 build、migration、启动和重启。
- 完成 liveness/readiness、build version、migration 与 storage manifest health。
- 定义 structured log、request/operation/review/upload trace、metrics/alerts 接口。
- 编写 migration、rollback、故障、备份恢复和公开读取开关 runbook。

### 非目标

- 不执行生产或云部署，不绑定真实域名，不接商业监控服务。
- 不扩大产品功能，不开始原画图库。

### 数据迁移

- 只验证截至 PR-07 的 migration 在干净 PostgreSQL 16 上 fresh/repeat；不为部署工具添加业务 schema。

### 测试

- 正式 CI 全链：安全、lock install、typecheck、lint、unit、contract、PG、S3、browser、attack、migration、restore、build、clean standalone、artifact scan。
- loopback 非生产启动、静态/Admin/媒体读取、受控依赖故障、重启与 rollback 演练。

### 回滚

- 使用前一已验证构建和向前兼容 migration；公开读取在 readiness 失败时保持关闭。
- 生产回滚策略必须在未来部署任务根据实际环境再次批准。

### 停止条件

- 非生产运行形态和 runbook 可重复，所有硬门禁通过；Draft PR 创建后停止，不部署。

## 12. 跨 PR 验收与变更控制

每个 PR 的描述必须列出目标、非目标、migration、测试、回滚、已知风险和停止条件；审查时映射到 [需求追踪矩阵](TRACEABILITY_MATRIX.md)。任何需要改变领域边界、状态机、正式技术栈、Hpoi 策略或 PR 顺序的提议，必须先更新相应 ADR/蓝图并通过独立 PR，不能隐含在实现中。
