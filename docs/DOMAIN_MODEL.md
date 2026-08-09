# 正式产品领域模型（PR-01 核心目录实现基线）

## 1. 文档状态与适用范围

本文是正式产品的规范性领域模型。PR-00 和 PR-01 已合并，核心目录已映射为 Payload Collection、PostgreSQL migration、领域服务和最小审计；后续正式 PR-02—PR-08 当前暂停。PR-01 的实际字段、约束与临时边界见 [核心目录实现](PR01_CORE_CATALOG_IMPLEMENTATION.md)，业务身份映射见 [PR-01 业务身份实现](PR01_IDENTITY_IMPLEMENTATION.md)。最高层产品方向见 [产品北极星](PROJECT_NORTH_STAR.md)。

本文使用以下规范词：

- **必须**：正式实现不可弱化的安全或数据完整性要求；
- **应当**：默认采用，偏离时必须在新的 ADR 中说明；
- **不得**：任何 Payload Admin、REST、GraphQL、Local API、后台任务或脚本都不能绕过；
- **建议**：不影响领域正确性的实现选择。

本文不授权迁移 spike、部署、访问任何外部数据源或越过交付路线开始后续 PR。

## 2. 核心不变量

1. 外部采集只能通过候选领域命令写自己的 CandidateRecord 和 CandidateImage；命令可由服务端建立或关联全局 SourceRecord 身份，但客户端不能直接读写 SourceRecord，也不能创建或修改正式目录实体、正式关系、发布状态、系统设置或主图。
2. FigurePrototype 表示一个独立原型。不同厂商或不同原型即使姿态相似也必须分开；普通、豪华、再版、特典和纯异色等同原型变体归入 FigureVersion。
3. CandidateImage 是“某候选为何引用某内容”的来源关系；MediaAsset 是与 URL、文件名和候选无关的内容身份。二者不得合并为同一记录。
4. FigureImage 是“某正式原型允许使用某媒体”的正式关系；FigurePrototype.main_media_asset_id 必须同时存在对应的有效 FigureImage，且只能由人工命令设置。
5. SourceRecord 失效、候选归档、CandidateImage 删除或重新采集不得自动替换主图，也不得删除仍被正式数据引用的 MediaAsset。
6. 所有正式写入必须通过领域服务，在同一 PostgreSQL 事务中完成状态、关系、乐观锁版本和 OperationLog；对象存储写入采用可重试编排与补偿，不能伪装成数据库原子事务。
7. merge、split 和 undo 使用稳定 operation_id、明确作用域和依赖；不得实现“撤销全局最近一次”，不得静默覆盖并发修改。
8. 展示查询只读取 published 且未软删除的正式记录；成人内容还必须服从 SystemSetting 和记录级分级。
9. SHA-256 是媒体内容的精确身份；感知哈希仅用于提示人工查重，不能自动合并或证明版权、授权或相同原型。
10. storage_key、bucket/profile 和公开 URL 分离；公开 URL、签名 URL、来源 URL 都不得成为业务主键。
11. 领域方向是 `Work → Character → FigurePrototype → FigureVersion → SourceEvidence → Media`；角色图库最终每个 FigurePrototype 只出一张卡。
12. personal gallery 的 ProductRecord 和 DiscoveryCandidate 都是来源/发现层记录，不等于 FigurePrototype；`prototypeHint` 只提示疑似重复，不能自动 merge、发布或选择主图。
13. Hpoi 只提供第三方搜索索引中的 discovery/coverage 文本信号；Hpoi direct transport 为 0，正式事实和媒体必须来自受审非 Hpoi 来源。

## 3. 通用约定

### 3.1 标识、时间与版本

- 业务身份使用 UUID。Payload 3.87.1 支持 adapter 级 UUID ID，但已合并 PR-00 的技术表使用 serial ID；PR-01 因此保留内部 serial `id`，并给每个目录实体/关系增加不可变、唯一、非空的 UUID `stableId`。领域命令、审计、导出和未来公开接口只使用 `stableId`；内部 ID 不是合同。后续若全局迁移 UUID 主键，必须独立 ADR/migration 且不得改变 stableId。
- 本文实体表中写作概念 `id` 的领域身份，在 PR-01 物理实现中映射为 `stableId`；关系 FK 可在数据库内使用 Payload technical ID，但不得向领域/API 暴露。
- 时间统一保存为 UTC 的 timestamptz；至少包含 created_at、updated_at。操作者界面按用户时区显示。
- 可变聚合根必须有 lock_version，初值 1；每个命令携带 expected_version，并以条件更新或 SELECT FOR UPDATE 拒绝过期提交。
- 删除默认是软删除：deleted_at、deleted_by、delete_reason。硬删除只由保留策略任务执行，且必须先完成引用检查和审计。
- display_name、canonical_name 等原文保留；用于匹配的 normalized_name 由确定性规则生成。修改规则必须版本化并重建索引。
- raw_snapshot 只保存候选来源的脱敏原始字段；正式结构化字段不得只存在 JSON 中。

### 3.2 PR-01 实现切片

PR-01 只实现 Work、Character、CharacterAlias、Manufacturer、FigurePrototype、FigurePrototypeCharacter、FigureVersion 和最小 OperationLog。前七者使用 `stableId`；OperationLog 使用唯一 `operationId` 和 `scopeStableId`。所有 generic CRUD 写入关闭，Admin 只读，正式变化只能经 Catalog domain service 以 expectedVersion/CAS、PostgreSQL transaction 和同事务 OperationLog 完成。

Candidate/Source、Review、正式 Media/FigureImage、SystemSetting、merge/split/undo 与 public projection 在下文仍是后续规范，不表示已经创建 Collection 或 API。PR-02 明确未开始。

### 3.3 Actor

| Actor | 身份与能力 |
| --- | --- |
| CandidateClient | 独立、可撤销的机器身份；只可在专用端点 upsert 自己的候选、来源快照和候选图片 |
| Admin | 第一版唯一人工管理身份类型/角色，可有多个同角色账号；操作时记录“审核”或“目录维护”等 duty_context，但不配置多管理员角色 |
| MediaWorker | 只能执行已入队的校验、派生、复制、清理与审计任务；不能自行改变正式主图 |
| System | 运行确定性的状态推导、超时或完整性检查；每次领域变化仍需可归因的 service principal |

AdminUser 与 CandidateClient 必须是不同权限模型。第一版只有一个 Admin 角色但可有多个独立账号，以支持归因和并发；不以 reviewer/catalog_admin/security_admin 枚举拆权。allowed targets、owner、expected_version 和命令边界仍由服务端强制，duty_context 只用于审计而非授权。

## 4. 实体与字段

下表中的“唯一”均指未软删除记录的业务唯一性；精确 PostgreSQL 约束见第 7 节。

### 4.1 目录与名称

#### Work

作品是角色消歧的主要边界。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 内部稳定身份 |
| display_name | text，必填 | 当前主要展示名 |
| original_name | text，可空 | 原文名 |
| normalized_name | text，必填 | 搜索和重复提示使用 |
| work_type | enum，可空 | animation、game、comic、novel、other |
| publication_status | enum | draft、published、hidden |
| lock_version | integer | 乐观锁 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at / deleted_by / delete_reason | 可空 | 软删除信息 |

作品别名建议作为 WorkAlias 子表，字段与 CharacterAlias 相同；第一版若只使用数组，也必须保证 normalized_alias 可检索并可迁移到独立表。

#### Character

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 内部稳定身份 |
| work_id | FK Work，可空 | 已知作品时用于同名角色消歧；未知作品角色可以保持 matching_pending，状态仍由显式领域命令推进 |
| display_name | text，必填 | 页面大标题使用 |
| name_zh / name_ja / name_en | text，可空 | 常用语言名，不替代别名表 |
| normalized_name | text，必填 | 搜索规范化值 |
| search_document | tsvector/派生字段 | 由 display_name、中日英名称、别名和可选 Work 生成；可重建，不是第二份正式名称真值 |
| status | enum | active、matching_pending、hidden |
| lock_version | integer | 乐观锁 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at / deleted_by / delete_reason | 可空 | 软删除信息 |

#### CharacterAlias

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 别名身份 |
| character_id | FK Character，必填 | 所属角色 |
| value | text，必填 | 原始别名 |
| normalized_value | text，必填 | 搜索规范化值 |
| locale | text，可空 | zh-CN、ja、en 等 BCP 47 标签 |
| alias_type | enum | official、translation、common、romanization、source_only |
| is_preferred | boolean | 该 locale 的首选显示名 |
| source_record_id | FK SourceRecord，可空 | 仅作来历说明，不让来源控制正式值 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at | timestamptz，可空 | 软删除 |

#### Manufacturer

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 厂商身份 |
| canonical_name | text，必填 | 当前规范名 |
| normalized_name | text，必填 | 重复提示和搜索 |
| aliases | text[] 或子表 | 官方旧名、译名、常用名 |
| official_site_url | text，可空 | 人工维护的核验链接 |
| authorization_note | text，可空 | 授权范围的人工说明，不由采集器判定 |
| source_evidence | jsonb/受控关系 | 小型、脱敏的核验证据引用与说明；必须人工维护，不触发 URL 抓取 |
| status | enum | draft、active、hidden |
| lock_version | integer | 乐观锁 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at / deleted_by / delete_reason | 可空 | 软删除信息 |

### 4.2 正式手办目录

#### FigurePrototype

FigurePrototype 是正式目录的主聚合根，表示一个造型/原型，而不是某次发售 SKU。PR-01 已实现不依赖媒体的字段；正式主图字段与 FigureImage 仍属 PR-04，因此 PR-01 数据库和 service 明确禁止 published。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 原型身份 |
| title | text，必填 | 内部与管理端标题 |
| normalized_title | text，必填 | 搜索和重复提示 |
| work_id | FK Work，可空 | 已核验时关联主要作品；未知作品不阻止 draft |
| manufacturer_id | FK Manufacturer，必填 | 原型厂商 |
| figure_type | enum | scale、prize；扩展类型必须另行决策 |
| scale | text，可空 | 比例手办可填 1/7 等；景品通常为空 |
| costume_text | text，可空 | 服装或造型说明 |
| is_group | boolean | 是否多角色组合 |
| adultEntryFlag | boolean | 只读派生/缓存：由正式 FigureImage 所指 MediaAsset.adultFlag 汇总，不能人工绕过媒体分级 |
| authorization_status | enum | pending、official、authorized_third_party、rejected；原型级正式授权判断 |
| authorization_evidence | jsonb/受控关系 | 小型证据引用、核验来源和说明；不保存完整页面或触发网络请求 |
| inclusion_status | enum | pending、eligible、excluded；只由 Admin 收录审核命令决定 |
| inclusion_reason / inclusion_reviewed_by / inclusion_reviewed_at | 可空 | eligible/excluded 时必填的理由、Admin 与时间 |
| publication_status | enum | draft、published、hidden、merged、archived |
| main_media_asset_id | PR-04 计划字段，FK MediaAsset，可空 | PR-01 尚不存在；接入后才可人工选择且必须有有效 FigureImage |
| merged_into_id | FK FigurePrototype，可空 | merged 状态的保留目标 |
| lock_version | integer | 乐观锁和并发控制 |
| created_by / updated_by | FK AdminUser | 最近正式变更归因 |
| created_at / updated_at | timestamptz | 审计时间 |
| archived_at / archived_by / archive_reason | 可空 | publication_status=archived 的软删除信息 |

角色是多对多关系。FigurePrototypeCharacter 关联表至少包含 prototype_id、character_id、display_order、role 和 created_at；同一原型至少一个未删除角色，且 is_group=false 时通常只有一个，例外必须人工说明。

#### FigureVersion

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 版本身份 |
| prototype_id | FK FigurePrototype，必填 | 所属原型 |
| name | text，必填 | 普通版、豪华版、再版等 |
| normalized_version_key | text，必填 | 原型内去重键 |
| kind | enum | regular、deluxe、reissue、bonus、recolor、channel-exclusive |
| channel_or_distributor_label | text，可空 | 渠道限定说明；不能覆盖原型 Manufacturer，不同制造商必须新建 FigurePrototype |
| release_status | enum | announced、gray_prototype、painted_prototype、preorder、released、cancelled、unknown |
| gray_model_completeness | enum | not_applicable、complete、partial、unknown；gray_prototype 只有 complete 可进入公开收录 |
| release_date | date，可空 | 已核验日期 |
| sku_or_code | text，可空 | 厂商公开编号 |
| notes | text，可空 | 人工说明 |
| lock_version | integer | 乐观锁 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at | timestamptz，可空 | 软删除 |

#### FigureImage（PR-04 计划，PR-01 未实现）

FigureImage 是正式原型与媒体内容的关联，不与 CandidateImage 复用。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 关联身份 |
| prototype_id | FK FigurePrototype，必填 | 正式原型 |
| media_asset_id | FK MediaAsset，必填 | 已提升媒体 |
| promoted_from_candidate_image_id | FK CandidateImage，可空 | 可核验的候选来历 |
| role | enum | gallery_candidate、reference、detail |
| display_order | integer | 后台候选图排序 |
| is_eligible_for_main | boolean | 是否允许人工选为主图 |
| status | enum | active、hidden、retired |
| created_by / created_at | actor、时间 | 人工提升归因 |
| retired_at / retired_by / reason | 可空 | 退役信息 |

main_media_asset_id 不是 FigureImage.is_main 的第二份真相；主图只有 FigurePrototype 上一个权威引用。查询时通过 prototype_id + media_asset_id 验证关联有效。

### 4.3 来源、候选与身份（PR-02 以后计划，PR-01 未实现）

#### DiscoveryCandidate（方向模型；MVP-05 本地验证，正式 PR-02 未实现）

DiscoveryCandidate 表示第三方公开搜索索引返回的“可能存在某手办”的发现信号，不是 `SourceRecord`、`CandidateRecord`、`ProductRecord` 或 `FigurePrototype`。personal gallery 当前只在 `.local` 保存以下最小字段；正式实现若吸收该能力，必须在独立 PR 中重新建模：

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| candidateId / characterId | 稳定、非空 | 角色范围内的幂等候选身份 |
| discoverySource | `hpoi_search_index` | 明确它来自第三方索引而非 Hpoi 页面读取 |
| indexedUrl / indexedProductId | 文本证据 | 可规范化和比较，但不得请求、解析、预览或导航 |
| titleHint / snippetHint / discoveryQuery / rank | 可空/有界 | 搜索索引提示，不作为正式事实 |
| manufacturerHint / categoryHint / scaleHint / workHint | 可空 | 确定性推断；无法判断则为空 |
| status | discovered、in_scope、out_of_scope、already_collected、needs_resolution、official_resolved、collected、ambiguous | 自动处理阶段；未解决不造数据 |
| matchedProductId | 可空 | 当前 personal gallery 来源记录匹配，不是正式原型关系 |
| resolutionEvidence | 非 Hpoi 受审来源摘要 | 找到正式来源后仍须由确定性 parser 验证 |
| prototypeHint | 可空、非权威 | 厂商、规范标题、比例、造型词组合；只作重复提示和 coverage 统计 |

Hpoi URL 不得进入会触发 fetch、unfurl、DNS、favicon 或浏览器预取的字段/组件。`official_resolved` 只表示找到受审非 Hpoi 页面，`collected` 只表示进入隔离 personal gallery；两者都不等于正式发布。

#### CandidateClient

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 机器客户端身份 |
| client_key | text，唯一 | 稳定公开标识，不是秘密 |
| display_name | text，必填 | 审计显示名 |
| client_kind | enum | api、internal_manual；后者只供 Admin 人工录入归属，不能认证 API |
| credential_hash | text，条件必填且唯一 | api client 必填单向哈希；internal_manual 必须为空；明文只在 api client 创建时返回一次 |
| credential_version | integer | 轮换版本 |
| status | enum | active、disabled、revoked |
| scopes | text[] | 固定为 candidate:upsert、candidate:media-upload、candidate:result-read 的子集 |
| last_used_at | timestamptz，可空 | 使用记录 |
| expires_at / revoked_at | timestamptz，可空 | 有效期与撤销时间 |
| created_by / created_at | AdminUser、时间 | 配置归因 |

不得保存明文 Token，不得给 CandidateClient Payload 通用 Collection 写权限或数据库凭据。candidate:result-read 只允许按 owner 读取自己的命令/同步结果，不开放候选或正式 Collection 的任意查询。api client 可执行 active→disabled（临时停用）、disabled→active（明确启用）、active/disabled→revoked（不可逆）；rotate 在一次事务中替换摘要并令旧 Token 立即失效，明文新 Token 只在该响应显示一次。internal_manual client 无 API scope，不能通过 Token 路径认证。

#### CandidateCommandReceipt

CandidateCommandReceipt 是候选同步命令账本，支持断线后的 sync result 与严格幂等结果查询；它属于 Candidate 聚合，不是 OperationLog 的替代品。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 收据身份 |
| owner_client_id | FK CandidateClient，必填 | owner 边界 |
| client_run_id | text，必填 | 客户端一次同步批次 ID |
| client_operation_id | text，必填 | 同一 run 内稳定的单次 upsert/upload 身份 |
| idempotency_key | text，必填 | 命令幂等键 |
| command_type | enum | candidate_upsert、candidate_media_upload |
| request_digest | char(64)，必填 | 规范化请求摘要 |
| status | enum | pending、succeeded、failed |
| result | jsonb，可空 | 小型、脱敏结果；只含自身候选/收据 ID 和状态 |
| error_code | text，可空 | 稳定失败分类 |
| operation_id | FK OperationLog，可空 | 成功领域操作 |
| created_at / started_at / completed_at | timestamptz，可空 | 生命周期时间 |
| retain_until | timestamptz | 幂等结果保留期限 |

UNIQUE (owner_client_id, idempotency_key) 和 UNIQUE (owner_client_id, client_run_id, client_operation_id) 必须成立；`request_digest` 用于比较而不是放宽唯一键。同键或同 run/operation 不同 request_digest 返回冲突。sync result 是按 client_run_id 聚合这些服务端收据的只读结果，不是第三种客户端写命令；pending 可轮询，succeeded/failed 在保留期内稳定返回原结果。

#### SourceRecord

SourceRecord 既可处于候选区，也可在人工接受后关联正式实体，但来源状态永远不直接驱动正式删除。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 来源记录身份 |
| owner_client_id | FK CandidateClient，必填 | 首次发现/人工录入的不可变归因；Admin 人工录入归入不可认证 API 的 internal_manual client，不作为跨 client 授权边界 |
| sourceType | text，必填 | 数据源类型；数据库列 source_type |
| sourceItemId | text，可空 | 稳定来源 ID，优先用于身份；数据库列 source_item_id |
| sourceUrl | text，可空 | 首次观察到的公开 URL；离线文件来源可以为空且不得触发 fetch，后续 client 的不同观察 URL 留在其 CandidateRecord，不能直接覆盖本字段 |
| canonicalSourceUrl | text，可空 | Web 来源公开的规范详情页 URL，不作 fallback 唯一键；离线来源可空 |
| normalizedFallbackUrl | text，可空 | 仅 sourceItemId 为空时生成的去跟踪参数规范 URL |
| sourceKey | text，必填 | sourceType + sourceItemId；无 ID 时才用 normalizedFallbackUrl；两者不可同时为空 |
| status | enum | active、stale、dead |
| accessBlocked | boolean | 独立合规停止标志，不改变主状态 |
| stopReason | text，可空 | accessBlocked=true 时必填 |
| observed_title | text，可空 | 服务端保存的首次观察标题或 Admin 明确确认的规范标题；客户端不能直接覆盖 |
| raw_snapshot | jsonb，必填 | 首次观察时由服务端复制的最小脱敏基线，或经 Admin 审计命令替换的规范来源快照；不是任一 client 的最新私有观察 |
| snapshot_digest | char(64)，必填 | 上述规范来源快照的 SHA-256；与 raw_snapshot 同一事务更新 |
| collected_at / last_seen_at / last_sync_at | timestamptz | 首次录入、任一有效候选最近观察时间的单调最大值、最近一次经授权同步的时间；只由服务端推导，人工录入可令 sync 与录入时间相同 |
| dead_at / status_reason | 可空 | dead 状态时间与证据 |
| prototype_id / version_id | FK，可空 | 人工建立的正式来源关系 |
| lock_version | integer | 并发控制 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at | timestamptz，可空 | 软删除 |

#### CandidateRecord

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 候选身份 |
| owner_client_id | FK CandidateClient，必填 | 所有权边界 |
| client_candidate_id | text，必填 | 客户端内稳定 ID |
| idempotency_key | text，必填 | 本次写入幂等键 |
| source_record_id | FK SourceRecord，必填 | 候选来源 |
| source_revision | integer | 同一候选的新快照序号 |
| payload_digest | char(64) | 规范化候选字段摘要 |
| raw_title | text，必填 | 原始标题 |
| raw_character_names | text[] | 原始角色名 |
| raw_work_name | text，可空 | 原始作品名 |
| raw_manufacturer | text，可空 | 原始厂商 |
| raw_category / raw_scale | text，可空 | 原始分类与比例 |
| raw_release_status / raw_release_date | text，可空 | 原始发售信息 |
| raw_snapshot | jsonb，必填 | 其余脱敏原始数据 |
| raw_diff | jsonb，必填 | 相对上一 source_revision 的规范化字段/图片差异 |
| proposed_fields | jsonb | 只作为审核提案，不是正式值 |
| match_state | enum | character_pending、manufacturer_pending、matched |
| status | enum | pending、accepted、merged、update_pending、deferred、ignored |
| validation_state | enum | pending、passed、failed；不是主状态 |
| validation_errors | jsonb | 机器校验结果，不改变主状态枚举 |
| target_prototype_id / target_version_id | FK，可空 | 仅为建议；必须受工作项 allowed targets 约束 |
| decision_reason | text，可空 | 最近人工决定理由 |
| lock_version | integer | 并发控制 |
| received_at / reviewed_at | timestamptz，可空 | 生命周期时间 |
| created_at / updated_at | timestamptz | 审计时间 |
| soft_deleted_at | timestamptz，可空 | 独立保留/软删除标记，不是主状态 |

同一 owner_client_id + client_candidate_id 标识一个候选流；同一 idempotency_key 重放必须返回同一结果。跨 owner 请求即使猜中 ID 也必须拒绝。多个 client 发现同一全局 SourceRecord 时只共享其规范身份和服务端维护的非私密来源元数据；各自完整 raw_snapshot、diff、决定和图片仍留在各自 CandidateRecord。客户端不能直接读取或修改 SourceRecord，不能改首次归因，也不能读取或修改他人的候选。候选 upsert 命中既有 source key 时，服务端仅单调推进 last_seen_at；只有明确的授权同步或 Admin 审计命令才能改变 last_sync_at 或规范快照。

#### UploadReceipt

UploadReceipt 是 Candidate 聚合内一次 multipart 尝试的不可变收据；它使失败重试、幂等重放和对象补偿可审计，但绝不代表正式媒体已创建。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 服务端 upload_id |
| candidate_record_id / owner_client_id | FK，必填 | 候选与 owner |
| idempotency_key | text，必填 | owner 内唯一 |
| declared_filename / declared_mime | text | 脱敏声明值 |
| declared_size / actual_size | bigint，可空 | 限制和核对 |
| computed_sha256 | char(64)，可空 | 服务端流式摘要 |
| media_asset_id | FK MediaAsset，可空 | 成功去重后的内容 |
| state | enum | receiving、validating、stored、bound、failed、compensated |
| error_code | text，可空 | 脱敏失败分类 |
| started_at / completed_at | timestamptz，可空 | 尝试时间 |

#### CandidateImage

CandidateImage 只描述候选与内容的关系，不能充当文件实体或正式主图。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 候选图片关系身份 |
| candidate_record_id | FK CandidateRecord，必填 | 所属候选 |
| media_asset_id | FK MediaAsset，必填 | 内容身份 |
| owner_client_id | FK CandidateClient，必填 | 冗余 owner，用于约束和授权 |
| client_image_id | text，必填 | 客户端内图片身份 |
| upload_idempotency_key | text，必填 | multipart 重放键 |
| source_url | text，可空 | 观察到的来源 URL，不是内容身份 |
| original_filename | text，可空 | 脱敏显示用途 |
| sourceHomepage | boolean | 是否来源首页图；只作审核提示 |
| sourceExists | boolean | 最近来源快照是否仍出现 |
| proposedAdult | boolean | 候选成人分级提案；不覆盖 MediaAsset.adultFlag |
| promotedToFormal | boolean | 只读派生/缓存：是否已有 promoted_from_candidate_image_id 指向本记录的 active FigureImage |
| sort_order | integer | 审核预览顺序 |
| status | enum | active、superseded、rejected、archived |
| supersedes_id | FK CandidateImage，可空 | 同 URL 内容变化时的前一关系 |
| created_at / updated_at | timestamptz | 审计时间 |
| deleted_at | timestamptz，可空 | 软删除 |

同 URL 内容变化会创建或关联新的 MediaAsset，并用 supersedes_id 保留关系；URL 或文件名变化但 SHA-256 相同则复用 MediaAsset。

### 4.4 媒体内容（PR-04 完成，PR-01 未实现正式模型）

#### MediaAsset

MediaAsset 是不可变媒体内容的逻辑身份。它不属于单一 CandidateRecord，也不直接保存公开 URL。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 内容身份 |
| sha256 | char(64)，唯一 | 原始字节精确身份 |
| perceptual_hash | char(16) 或算法指定长度，可空 | 相似性提示 |
| perceptual_hash_algorithm | text，可空 | ahash-v1 等，必须版本化 |
| adultFlag | boolean | 成人分级的唯一权威真值；只允许人工审核/专用领域命令修改 |
| media_type | enum | image |
| mime_type | text | 经魔数和解码确认的类型 |
| format | text | PNG、JPEG、WebP 等规范值 |
| byte_size | bigint | 原始字节数 |
| pixel_width / pixel_height | integer | 解码后的像素尺寸 |
| aspect_ratio_num / aspect_ratio_den | integer | 约分后的固有比例 |
| lifecycle_status | enum | quarantined、candidate_ready、promotion_pending、formal_ready、delete_pending、deleted、error |
| validation_version | text | 校验策略版本 |
| formal_reference_count | integer | 缓存值；删除前仍以真实引用查询为准 |
| candidate_reference_count | integer | 缓存值 |
| first_seen_at / verified_at | timestamptz | 生命周期时间 |
| delete_after / deleted_at | timestamptz，可空 | 延迟删除 |
| lock_version | integer | 并发控制 |
| created_at / updated_at | timestamptz | 审计时间 |

#### MediaObject

MediaObject 是 MediaAsset 在对象存储中的一个可验证对象；属于 MediaAsset 聚合。

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 对象记录身份 |
| media_asset_id | FK MediaAsset，必填 | 所属内容 |
| namespace | enum | candidate、formal |
| variant | enum | original、thumbnail、preview |
| recipe_version | text，可空 | 派生图规则版本；original 为空 |
| storage_profile | text | 逻辑 provider/bucket 配置名，不含凭据 |
| storage_key | text，唯一 | bucket 内稳定相对 key |
| object_sha256 | char(64) | 对象字节哈希；original 等于 MediaAsset.sha256 |
| byte_size | bigint | 对象大小 |
| width / height | integer | 原图或派生图尺寸 |
| state | enum | staging、available、copying、delete_pending、deleted、error |
| etag | text，可空 | 只作传输校验，不能替代 SHA-256 |
| verified_at | timestamptz，可空 | 最近完整读取校验 |
| created_at / updated_at | timestamptz | 审计时间 |
| delete_after / deleted_at | timestamptz，可空 | 延迟清理 |

对象 key、提升、迁移、恢复和补偿流程见 [媒体生命周期](MEDIA_LIFECYCLE.md)。

### 4.5 审核、配置与审计

本节的 ReviewWorkItem/SystemSetting 属于后续 PR。PR-01 只实现下文 OperationLog 字段的最小子集：operationId、actor、duty context、action/scope/reason、expected/result version、before/after snapshot、request digest、`reversible=false` 和 timestamps；dependency/undo/revert 字段留到 PR-05 migration。

#### AdminUser

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 人工 Actor |
| email / display_name | text | 登录与审计显示 |
| status | enum | active、disabled |
| duty_context | text，可空 | 审计时的逻辑职责说明；第一版不是可配置角色或授权枚举 |
| auth_provider_subject | text，唯一 | 外部或本地认证主体，不保存可逆密码 |
| last_login_at | timestamptz，可空 | 安全审计 |
| created_at / updated_at | timestamptz | 审计时间 |

#### ReviewWorkItem

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 工作项身份 |
| candidate_record_id | FK CandidateRecord，必填 | 被审核候选 |
| reviewer_id | FK AdminUser，可空 | 领取后必填 |
| status | enum | open、in_review、completed、reopened、cancelled |
| allowed_new_prototype | boolean | 是否允许显式“新建正式原型”命令 |
| accepted_fields / rejected_fields | jsonb | 按字段记录决定与理由 |
| selected_target_prototype_id | FK，可空 | 必须在 allowed targets 中或由明确新建命令产生 |
| selected_target_version_id | FK，可空 | 必须属于选定原型 |
| selected_candidate_image_id | FK，可空 | 主图提议；完成时经 FigureImage 提升并人工确认 |
| decision | enum，可空 | accept、defer、ignore |
| decision_reason | text，可空 | 完成必填 |
| lock_version | integer | 并发控制 |
| opened_at / started_at / completed_at / reopened_at | timestamptz，可空 | 生命周期时间；status=reopened 时 reopened_at 必填 |
| reopened_from_id | FK ReviewWorkItem，可空 | status=reopened 时必填；新工作项关联不可修改的 completed/cancelled 前项 |
| created_at / updated_at | timestamptz | 审计时间 |

ReviewAllowedTarget 关联表包含 review_work_item_id、prototype_id、target_lock_version、reason 和 created_at。工作项开始后不得静默扩大集合；扩大范围必须由 Admin 的专用命令、理由和 OperationLog 记录。

#### SystemSetting

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | 固定单例键 | 例如 public-gallery |
| showAdultImages | boolean，默认 false | 前台成人图总开关 |
| galleryPageSize | integer，默认 16 | 1—100 |
| publicReadEnabled | boolean，默认 true | 前台只读总开关 |
| candidateUploadSizeLimit | bigint，必填 | multipart 候选文件上限 |
| allowedImageFormats | text[]，必填 | 允许的实际解码格式白名单 |
| lock_version | integer | 并发控制 |
| updated_by / updated_at | AdminUser、时间 | 变更归因 |

设置只能通过领域命令更新；环境 secret、bucket 凭据和数据库连接不得存入此实体。

#### OperationLog

| 字段 | 类型/要求 | 含义 |
| --- | --- | --- |
| id | UUID，主键 | 日志行身份 |
| operation_id | UUID，唯一 | 对外稳定操作身份 |
| operation_type | enum/text | 明确命令类型 |
| operation_version | integer | 操作载荷版本 |
| outcome | enum | applied、rejected、conflict；原操作被撤销后仍保持 applied |
| actor_type / actor_id / actor_label | 标识 | 完整归因 |
| aggregate_type / aggregate_id | 标识 | 主作用域 |
| scope | jsonb | 所有被锁定/修改记录的类型、ID、版本 |
| idempotency_key | text，可空 | 命令重放键 |
| reason | text，必填 | 人工操作必须填写 |
| before_state / after_state | jsonb | 最小、脱敏、可恢复快照 |
| inverse_payload | jsonb，可空 | 允许撤销时的版本化反向命令 |
| reversible | boolean | 是否具备受控反向命令；为 true 时 inverse_payload 必填 |
| depends_on_operation_ids | UUID[] 或关联表 | 依赖图 |
| undo_of_operation_id | UUID，可空 | 指定撤销目标 |
| undone_by_operation_id | UUID，可空 | 原操作被哪次 undo 撤销 |
| revert_state | 派生值 | `not_reverted/reverted`，只由 undone_by_operation_id 派生，不单独写入 |
| reverted_at | 派生时间 | 取 undo 操作 occurred_at；不建立第二份可写真值 |
| transaction_id | UUID | 同一数据库事务关联 |
| occurred_at | timestamptz | 服务端时间 |

before_state、after_state、actor、reason、scope 和 outcome 写入后不可改。指定 undo 必须追加 outcome=applied 且 undo_of_operation_id 非空的新 OperationLog；原操作仍为 applied，只允许由同一事务填入 undone_by_operation_id，不能用 outcome 形成第二份“是否撤销”真值。

## 5. 关系总览

~~~mermaid
erDiagram
    Work |o--o{ Character : classifies
    Character ||--o{ CharacterAlias : has
    Work |o--o{ FigurePrototype : classifies
    Manufacturer ||--o{ FigurePrototype : makes
    FigurePrototype }o--o{ Character : depicts
    FigurePrototype ||--o{ FigureVersion : groups
    FigurePrototype ||--o{ FigureImage : owns
    FigureImage }o--|| MediaAsset : references
    CandidateClient ||--o{ CandidateRecord : owns
    CandidateClient ||--o{ CandidateCommandReceipt : submits
    CandidateClient ||--o{ SourceRecord : observes
    SourceRecord ||--o| CandidateRecord : feeds
    CandidateRecord ||--o{ UploadReceipt : receives
    CandidateRecord ||--o{ CandidateImage : proposes
    CandidateImage }o--|| MediaAsset : references
    MediaAsset ||--o{ MediaObject : materializes
    CandidateRecord ||--o{ ReviewWorkItem : reviewed_by
    ReviewWorkItem }o--o{ FigurePrototype : allows
    AdminUser ||--o{ ReviewWorkItem : reviews
    AdminUser ||--o{ OperationLog : acts
    FigurePrototype ||--o{ SourceRecord : provenanced_by
~~~

关键基数：

- Character 和 FigurePrototype 的 Work 均可空；已知 Work 时用于同名消歧，未知时可以保持待匹配且不能伪造作品关系。
- 一个 FigurePrototype 至少关联一个 Character，可有多个 FigureVersion、FigureImage 和 SourceRecord。
- 一个 CandidateRecord 属于且只属于一个 CandidateClient；CandidateImage 的 owner 必须与 CandidateRecord 相同。
- 一个 MediaAsset 可被多个 CandidateImage 和 FigureImage 引用；共享内容不等于共享来源或共享审核决定。
- 一个 CandidateRecord 在同一时刻最多一个 open、in_review 或 reopened 的 ReviewWorkItem。

## 6. 四个聚合与事务边界

| 聚合 | 根与成员 | 聚合内原子事务 | 跨聚合规则 |
| --- | --- | --- | --- |
| Candidate | CandidateRecord；CandidateImage；CandidateCommandReceipt；UploadReceipt；引用 CandidateClient、全局 SourceRecord、MediaAsset | owner、全局 source identity 的建立/关联、raw diff、修订、同步/上传结果、图片关系、lock_version 和 OperationLog | SourceRecord 只由领域服务按稳定键锁定并维护，客户端无直接 CRUD；不得在此事务写正式目录；媒体字节走 supporting Media boundary |
| Formal Figure | FigurePrototype；FigureVersion；FigureImage；原型角色关系；Work/Character/CharacterAlias/Manufacturer 受控引用 | 正式字段、版本、发布/隐藏/归档、主图、lock_version 和 OperationLog | 只能接收 Admin 或已验证 Review 命令；不得信任 Candidate target ID |
| Review | ReviewWorkItem；ReviewAllowedTarget；字段决定 | open/in_review/completed/reopened/cancelled、allowed target、expected version 和 OperationLog | 完成审核由领域编排器同时锁 Candidate、Review、Formal Figure 和所选 Media |
| Merge/Split | 以 operation_id 为根的结构命令、完整 scope、依赖和 inverse payload | merge、split、指定 undo、所有关系移动、版本和 OperationLog | 固定锁顺序；禁止“全局最近一次”撤销和部分提交 |

MediaAsset、MediaObject 和对象任务构成 **supporting Media boundary**，服务以上四个聚合，但不替代四个业务聚合。其数据库状态原子更新；对象存储不参与 PostgreSQL ACID，必须使用 staging、事务性 outbox/任务和补偿，详见媒体文档。

跨聚合写命令采用一个应用层领域编排器。所有关系状态都在同一 PostgreSQL 事务中更新；锁顺序固定为 ReviewWorkItem、CandidateRecord、FigurePrototype 按 UUID 升序、FigureVersion、MediaAsset 按 UUID 升序，最后写 OperationLog。任何 expected_version 不匹配都回滚整个事务并返回明确冲突。

对象存储步骤采用“准备对象 → 校验 → 数据库事务提交引用/任务 → 最终化或补偿”的协议。不得先提交正式主图再异步祈望对象最终出现。

## 7. PostgreSQL 完整性约束

### 7.1 通用约束

- 所有 FK 显式指定删除行为；正式引用使用 RESTRICT，软删除不触发级联物理删除。
- lock_version CHECK (lock_version >= 1)；时间顺序、非负计数、尺寸和页大小都有 CHECK。
- enum 使用 PostgreSQL enum 或受迁移管理的 text + CHECK；不得接受任意未知状态。
- updated_at 由应用统一写入并经测试；数据库触发器只用于不可绕过且可迁移的审计字段。
- JSONB 限于 raw_snapshot、提案、状态快照和 operation scope；必须有 schema_version，且服务层做 JSON Schema 校验。

### 7.2 业务唯一与关系约束

| 对象 | 必需约束 |
| --- | --- |
| CharacterAlias | 未删除范围 UNIQUE (character_id, locale, normalized_value)；同一 character + locale 至多一个 is_preferred=true 的部分唯一索引 |
| Manufacturer | status 仅 draft/active/hidden；hidden 厂商不得用于新发布或继续编辑已发布原型，既有已发布原型保持可见但 Admin 必须显示警告 |
| FigurePrototype | published 必须有至少一个角色、active Manufacturer、authorization_status in (official, authorized_third_party)、inclusion_status=eligible、完整收录审核理由、非空主图及对应 active/eligible FigureImage；Work 可空；merged 必须有 merged_into_id；archived 使用 archived_at/by/reason |
| FigureVersion | 未删除范围 UNIQUE (prototype_id, normalized_version_key)；kind 仅 regular/deluxe/reissue/bonus/recolor/channel-exclusive；不得覆盖 prototype Manufacturer；release_status=gray_prototype 时公开收录要求 gray_model_completeness=complete；prototype 不得 merged 或 archived |
| FigureImage | 未退役范围 UNIQUE (prototype_id, media_asset_id) |
| 主图 | main_media_asset_id 非空时，提交事务内必须存在相同 prototype_id + media_asset_id 且 status=active、is_eligible_for_main=true 的 FigureImage |
| CandidateRecord | owner_client_id NOT NULL；UNIQUE (owner_client_id, client_candidate_id)；UNIQUE (owner_client_id, idempotency_key)；status in (deferred, ignored) 时 decision_reason 必填；跨 client 共用 SourceRecord 不代表共享 Candidate owner |
| SourceRecord | owner_client_id NOT NULL 且创建后不可改，但仅表示首次发现归因；sourceItemId 非空时全局部分唯一 UNIQUE (source_type, source_item_id)；仅 sourceItemId 为空时全局部分唯一 UNIQUE (source_type, normalized_fallback_url)；Web 来源 canonicalSourceUrl 必填，离线来源必须有 sourceItemId；fallback 不使用 canonicalSourceUrl；客户端无直接 read/write access，last_seen_at 只允许单调增加，规范快照只允许首次建立或 Admin 审计更新 |
| CandidateClient / SourceRecord | SourceRecord.owner_client_id NOT NULL；api client 必须有 credential_hash，internal_manual client 必须无 credential_hash 且不能认证 API |
| CandidateCommandReceipt | UNIQUE (owner_client_id, idempotency_key)；UNIQUE (owner_client_id, client_run_id, client_operation_id)；相同键/operation 的 request_digest 不同必须冲突 |
| UploadReceipt | UNIQUE (owner_client_id, idempotency_key)；bound 必须有 media_asset_id，failed/compensated 必须有稳定结果 |
| CandidateImage | UNIQUE (owner_client_id, upload_idempotency_key)；UNIQUE (candidate_record_id, client_image_id)；owner 必须等于 CandidateRecord owner |
| MediaAsset | adultFlag 是唯一成人分级真值；UNIQUE (sha256) 同时提供 SHA-256 索引；SHA 格式、byte_size > 0、尺寸 > 0、比例分母 > 0 |
| MediaObject | UNIQUE (storage_key)；storageKey 不含 provider/public URL；同 asset/namespace/variant/recipe_version 至多一个 available 对象 |
| ReviewWorkItem | 每个 candidate 至多一个 status in (open, in_review, reopened) 的部分唯一索引；completed 必须有 completed_at、decision 和 reason |
| OperationLog | UNIQUE (operation_id)；actor + idempotency_key 非空时唯一；undo_of 指向可撤销 applied 操作；一项 applied 操作至多一个成功 undo |
| 软删除/归档 | 所有正式 FK 使用 RESTRICT 或保留关系；软删除、archive、source dead 和 candidate soft delete 均不得破坏历史关系或级联删除正式媒体 |

跨行的主图、至少一个角色、依赖图无环和 owner 一致性不能只靠 Payload 校验。正式实现应优先使用事务内锁定查询、可延迟约束触发器或受控存储过程，并用集成测试证明绕过 UI 仍会失败。

### 7.3 数据库角色

- migration_role：只在部署迁移阶段使用，可修改 schema；运行时不可获得。
- app_runtime_role：只能访问应用所需表和序列；不拥有 schema，不得 DISABLE TRIGGER。
- backup_role：只读和备份所需最小权限；不能写业务数据。
- CandidateClient、AdminUser 都不直接获得数据库账号。
- 若采用行级安全，RLS 是额外防线而不是替代领域服务；owner 条件和正式写禁令仍必须在应用与测试中存在。

## 8. Payload 到数据库的分层

| 层 | 必须负责 | 明确禁止 |
| --- | --- | --- |
| PostgreSQL constraints | FK、唯一性、检查约束、事务、锁和最终完整性 | 依赖 UI 约定；用级联删除正式媒体 |
| Payload access control | 默认拒绝 Collection create/update/delete；按 public/admin/candidate actor 限制读取和专用命令入口 | 因请求来自 loopback、Admin UI 或 Local API 就 overrideAccess |
| Payload hooks | 单记录规范化、派生 source_key、不可变字段保护、调用上下文断言 | 在多个 afterChange 中拼接跨记录业务事务；静默写 OperationLog |
| Domain services | 所有正式命令、owner/allowed target 校验、固定锁顺序、expected_version、同事务 OperationLog、幂等和反向操作 | 暴露任意 patch；接受客户端提供 actor、owner、正式状态或主图真值 |
| Endpoint / command adapter | 鉴权、输入 schema、速率/大小限制，把 actor 与命令传给 service | 直接调用 Payload generic CRUD 完成正式写入 |
| Admin UI | 展示差异、allowed targets、版本冲突、理由和操作结果；提交 command、expected_version、idempotency_key | 隐藏按钮来代替授权；直接保存正式 Collection；冲突后自动覆盖 |

正式 Collection 的 Admin 表单可以只读展示，但保存按钮必须调用领域命令。Payload Local API 和后台 job 默认同样执行 access；只有领域服务内部、带不可伪造 request context 且在已开启事务中，才允许最小范围 overrideAccess。任何新 Collection、hook、GraphQL mutation 或 plugin 升级都必须重跑通用 CRUD 绕过攻击。

## 9. 状态机与逐迁移合同

所有允许迁移都必须由服务端根据当前持久化状态判定。表中未列出的迁移一律禁止，并返回 409 domain_transition_forbidden；权限不足返回 403。被拒请求不得修改业务数据，且安全相关拒绝要写最小审计事件。成功迁移的 OperationLog 与状态更新同事务提交。

### 9.1 CandidateRecord

~~~mermaid
stateDiagram-v2
    [*] --> pending: authenticated upsert
    pending --> accepted: review accepts
    pending --> deferred: review defers
    pending --> ignored: review ignores
    pending --> merged: duplicate candidate merge
    accepted --> update_pending: changed source revision
    accepted --> merged: later duplicate decision
    update_pending --> accepted: update accepted
    update_pending --> deferred: update deferred
    update_pending --> ignored: update ignored
    update_pending --> merged: update merged
    deferred --> pending: reopen
    ignored --> pending: reopen
    merged --> pending: specified undo
~~~

| 迁移 | Actor | 前置条件与事务 | OperationLog | 可撤销性 |
| --- | --- | --- | --- | --- |
| new → pending | CandidateClient | active、owner 匹配；CandidateCommandReceipt pending→succeeded、Source/Candidate/raw_diff 同事务；validation_state 独立记录 | candidate_upsert；重放返回原 receipt/result | 不撤销原始观察；可独立 soft delete |
| pending/update_pending → accepted | Admin（审核职责） | ReviewWorkItem=in_review、validation_state=passed、allowed target、字段决定和媒体提升全部成功 | review_completed_accept 及正式子操作 IDs | 指定 undo 正式子操作并创建 reopened 工作项 |
| pending/update_pending → deferred | Admin（审核职责） | 工作项 in_review、reason 必填；不得留下部分正式变更 | review_completed_defer | 通过 reopened 工作项再审 |
| pending/update_pending → ignored | Admin（审核职责） | 工作项 in_review、reason 必填；媒体与来源保留 | review_completed_ignore | Admin 创建 reopened 工作项 |
| pending/update_pending/accepted → merged | Admin（审核职责） | 明确 duplicate_of_candidate_id、owner/关系/依赖检查；不是 Figure merge | candidate_merged | 仅指定 operation_id 且无依赖时回 pending |
| accepted → update_pending | CandidateClient | source revision 或 payload/media digest 变化；正式字段和主图保持不变 | candidate_update_received | 可忽略该修订；不能回滚正式数据 |
| deferred/ignored → pending | Admin（审核职责） | 新建 status=reopened 的 ReviewWorkItem；旧决定保持 | candidate_reopened | 可取消新工作项 |
| merged → pending | Admin | 指定 candidate merge、当前版本与 inverse payload 匹配、无后续依赖 | undo_candidate_merge | 可通过新命令再次 merge |

禁止：CandidateClient 直接设置 accepted/merged/deferred/ignored；validation_state 或 ReviewWorkItem 进度不得伪装成新的 Candidate 主状态；相同 digest 重放不得产生 update_pending；soft_deleted_at 非空时拒绝普通 upsert；任何迁移不得写 main_media_asset_id。

### 9.2 ReviewWorkItem

~~~mermaid
stateDiagram-v2
    [*] --> open: create
    [*] --> reopened: explicit reopen creates new item
    open --> in_review: claim
    in_review --> completed: decide
    open --> cancelled: cancel
    in_review --> cancelled: cancel
    reopened --> in_review: claim reopened item
    reopened --> cancelled: cancel
    completed --> [*]: old item remains immutable
    cancelled --> [*]: old item remains immutable
~~~

| 迁移 | Actor | 前置条件与事务 | OperationLog | 可撤销性 |
| --- | --- | --- | --- | --- |
| new → open | Admin/System queue | Candidate=pending/update_pending、validation_state=passed、无 active item；冻结 allowed targets 与版本 | review_work_item_opened | 可取消 |
| open/reopened → in_review | Admin（审核职责） | 条件更新当前状态 + expected_version；记录 reviewer | review_work_item_claimed | 可取消 |
| in_review → completed | 同一 Admin | expected_version、allowed target、全部字段决定、reason；一次跨聚合事务 | review_work_item_completed 与子操作 IDs | 完成行不可编辑；按下行 reopen |
| open/in_review/reopened → cancelled | Admin | reason；补偿未完成媒体准备任务 | review_work_item_cancelled | 可发起 reopen |
| new → reopened（from completed/cancelled） | Admin | 指定不可变旧项；事务只给旧项追加关联审计，并创建新行 status=reopened、reopened_from_id=旧项 | review_work_item_reopened | 可取消新行；不能抹除旧决定 |

禁止：把原 completed 行改回 open；绕过 reopened 状态；更换 Admin 后继续用旧 expected_version；目标不在 allowed set；工作项内任意 Candidate 写任意 Figure；后提交静默覆盖。版本冲突保持原状态并记录 outcome=conflict。

### 9.3 FigurePrototype

下图描述第一阶段最终状态机。PR-01 的临时子集只允许 draft、hidden、archived：published 固定返回 `FORMAL_MAIN_IMAGE_CAPABILITY_NOT_AVAILABLE` 并受数据库 CHECK 阻止；merged 固定返回 `MERGE_CAPABILITY_NOT_AVAILABLE`，且本轮没有写 mergedInto 的命令。PR-04/PR-05 只能通过显式 migration 和独立测试解除各自门禁。

~~~mermaid
stateDiagram-v2
    [*] --> draft: explicit create
    draft --> published: publish
    published --> hidden: hide
    hidden --> published: restore visibility
    draft --> hidden: hold
    draft --> merged: merge
    published --> merged: merge
    hidden --> merged: merge
    merged --> draft: specified undo
    merged --> published: specified undo
    merged --> hidden: specified undo
    draft --> archived: soft delete
    published --> archived: soft delete
    hidden --> archived: soft delete
    archived --> draft: restore
    archived --> published: restore
    archived --> hidden: restore
    draft --> draft: split structure
    published --> published: split structure
    hidden --> hidden: split structure
~~~

| 迁移 | Actor | 前置条件与事务 | OperationLog | 可撤销性 |
| --- | --- | --- | --- | --- |
| new → draft | Admin（审核/目录职责） | 工作项允许新建或独立命令；Work 可空，Manufacturer 与至少一个 Character 必须有效；reason | create_prototype | 未被依赖时可指定撤销到 archived |
| draft → published | Admin | active Manufacturer、至少一个角色、authorization=official/authorized_third_party、inclusion=eligible、灰模版本均为 complete、有效主图及对应 FigureImage；Work 可空 | publish_prototype | 无依赖时指定 undo 回 draft |
| published → hidden | Admin | reason；不删除关系或媒体 | hide_prototype | 指定 undo 回 published |
| hidden → published | Admin | 发布约束重新通过；hidden Manufacturer 必须先恢复 active | restore_prototype_visibility | 指定 undo 回 hidden |
| draft → hidden | Admin | reason | hold_prototype | 指定 undo 回 draft |
| draft/published/hidden → merged | Admin | merge 目标有效、作用域锁定、依赖检查；见第 10 节 | merge | 仅按 operation_id 且无后续依赖时 undo |
| merged → 先前状态 | Admin | 指定原 merge；当前版本、关系和 inverse payload 一致 | undo_merge | undo 是新 applied 操作 |
| draft/published/hidden → archived | Admin | reason、引用/主图保留检查；填写 archived_at/by | archive_prototype | 保留期内指定 undo |
| archived → 先前状态 | Admin | 指定 archive operation；唯一性和发布约束仍成立 | restore_prototype | 可再次 archived |
| 非 merged/archived → 同状态的结构 split | Admin | 显式移动集合，结果双方有效；见第 10 节 | split | 仅按 operation_id 且无依赖时 undo_split |

禁止：从 merged 直接发布/隐藏/编辑；从 archived 直接 merge/split；CandidateClient 创建或修改原型；发布缺少主图或主图关系；引用 hidden Manufacturer 的原型新发布或继续编辑；merge/split 自动替换保留目标主图。

### 9.4 Manufacturer

~~~mermaid
stateDiagram-v2
    [*] --> draft: explicit create
    draft --> active: verify
    draft --> hidden: hold
    active --> hidden: hide
    hidden --> active: restore
~~~

| 迁移 | Actor | 前置条件与事务 | OperationLog | 可撤销性 |
| --- | --- | --- | --- | --- |
| new → draft | Admin（审核/目录职责） | 工作项允许新建；canonical_name 和重复搜索完成 | create_manufacturer | 无依赖时可归档业务记录，但不新增状态 |
| draft → active | Admin | 名称与授权说明已人工核验，无 active 重复 | activate_manufacturer | 指定 undo 回 draft |
| draft/active → hidden | Admin | reason；既有 published 原型保持可见并在 Admin 显示风险警告，但不得新发布或继续编辑引用该厂商的 published 原型 | hide_manufacturer | 指定 undo 回原状态 |
| hidden → active | Admin | 核验通过且唯一性仍成立；解除正式编辑阻断 | restore_manufacturer | 指定 undo 回 hidden |

禁止：任何 merged 或其他额外主状态；CandidateClient 激活厂商；hidden 厂商被用于新发布或继续编辑正式原型；隐藏导致级联删除或自动隐藏既有原型/媒体；没有 operation_id 的“恢复最近厂商”。

### 9.5 SourceRecord

~~~mermaid
stateDiagram-v2
    [*] --> active: first verified observation
    active --> stale: not seen in expected refresh
    stale --> active: seen again
    active --> dead: confirmed gone
    stale --> dead: confirmed gone
    dead --> active: verified return
~~~

| 迁移 | Actor | 前置条件与事务 | OperationLog | 可撤销性 |
| --- | --- | --- | --- | --- |
| new → active | Candidate 领域服务（由 CandidateClient 或 Admin 候选命令触发） | 合法 sourceKey、首次发现归因、有限基线快照；sourceItemId 为空时 normalizedFallbackUrl 必填；client 无 Source 直接 CRUD，候选来源不能绑定正式目标 | source_observed | 可转 stale/dead；不硬删除 |
| active → stale | System 或 Admin | 汇总获准观察后到达预定窗口且未见；不能仅凭单一 client 或一次网络错误 | source_marked_stale | 见到后恢复 |
| stale → active | System 或 Admin | 同一稳定身份在获准候选观察中再次出现，更新 last_seen | source_seen_again | 可再次 stale |
| active/stale → dead | Admin 或经批准的确定性规则 | 多次证据或人工确认；填写 dead_at/reason；正式关系和主图保持 | source_marked_dead | 真实再次出现后可恢复 active |
| dead → active | Admin 或经批准的 System 规则 | 稳定身份匹配且新的获准观察有效；不是普通 client 重放 | source_restored | 可再次转 dead |

accessBlocked/stopReason 是正交合规门禁：System/Admin 设置 accessBlocked=true 时，主状态保持 active/stale/dead，但所有自动访问立即停止并写 source_access_blocked；只有 Admin 记录新的合规依据后才能清除。它不是第四种主状态。

禁止：missing、blocked、invalidated 或其他额外主状态；状态迁移自动删除/隐藏 FigurePrototype、替换主图或删除对象；CandidateClient 修改不属于自己的来源；accessBlocked=true 时继续自动访问；dead 被普通幂等重放隐式复活。

## 10. merge、split、指定 undo 与操作语义

### 10.1 通用操作模型

每个结构操作包含 operation_id、operation_version、actor、reason、expected_versions、scope、depends_on、before_state、after_state 和 inverse_payload。scope 必须列出所有会改变的原型、版本、角色关系、FigureImage、SourceRecord、Candidate 目标建议及主图引用。

服务按 UUID 排序锁定整个 scope，重新检查版本与依赖后才执行。关系写入、lock_version、OperationLog 和 undone_by_operation_id 在同一 PostgreSQL 事务内提交；任一步失败全部回滚。

### 10.2 Merge

1. 命令明确一个 retained_prototype_id 和一个或多个 merged_prototype_ids，不允许链式隐式选目标。
2. 源和目标必须不是 archived 或 merged；类型/厂商/角色差异只作为人工警告，不自动判断同一原型。
3. FigureVersion、FigureImage、SourceRecord 和候选 target 建议按显式映射迁移；唯一冲突必须由命令提供 keep、coalesce 或 reject 策略。
4. 保留目标 main_media_asset_id 默认保持不变。若要改主图，必须是同一审核动作中独立的 select_main_image 子命令、独立理由和日志。
5. 被合并原型设为 merged，merged_into_id 指向保留目标；不物理删除，公开读取可返回规范目标重定向。
6. inverse_payload 保存每条关系原 owner、次序、状态和版本；OperationLog 记录依赖的前置操作。

### 10.3 Split

1. 命令明确 source_prototype_id、new 或 existing target、以及逐项 moved_version_ids、moved_source_ids、moved_figure_image_ids 和角色关系。
2. 未列项目留在源原型；禁止依靠筛选条件在事务执行时动态扩张集合。
3. 拆分后双方必须满足最小关系约束；目标默认 draft。
4. 新目标主图默认空。只有明确选择、且对应 FigureImage 已移动或提升时，才能在同一编排中设置。
5. 若移动源主图对应的 FigureImage，源必须先显式选择替代主图或转为 draft/hidden；不得留下悬空 main_media_asset_id。
6. inverse_payload 保存完整归属映射；OperationLog 与所有关系移动同事务。

### 10.4 指定 Undo

1. undo 命令必须携带 target_operation_id；不存在“最近一次”默认值。
2. 目标必须 outcome=applied、未被撤销、具有受支持的 inverse_payload，且 actor 有权限。
3. 若后续 applied 操作 depends_on 目标，默认拒绝并返回依赖 operation IDs。级联撤销必须是另一个显式命令，列出完整有向无环依赖闭包并按逆拓扑顺序执行。
4. 当前记录版本和关系必须与目标 after_state 一致；否则返回 conflict，不做部分恢复。
5. 成功 undo 追加新的 OperationLog，undo_of_operation_id 指向目标，并在同事务将目标 undone_by_operation_id 指向新操作。
6. undo 失败也记录 outcome=rejected 或 conflict 的最小审计，不写业务 before/after 假象。

### 10.5 并发场景

- 无关 X/Y merge 与 M/N split 可并发；各自 scope 和 operation_id 独立，可分别撤销。
- 两管理员修改同一原型时，第一个 expected_version 成功，第二个得到 409；数据、主图和 OperationLog 不被第二次覆盖。
- merge 后存在依赖操作时，直接 undo 前置 merge 必须拒绝或执行显式级联；不得留下断裂 FK、重复版本或悬空媒体关系。

## 11. 查询与管理端投影

- 公共搜索投影只包含 Work、Character、已 published FigurePrototype 和 main media 的安全派生图；不暴露 SourceRecord、候选、内部 ID 映射、审核理由或 OperationLog。
- 角色唯一匹配时可直接进入图库；同名且 Work 已知时按 Work 消歧，未知 Work 显示待核验。投影按 galleryPageSize 分页，图片保持固有比例。
- Admin UI 的候选审核页读取 ReviewWorkItem 快照、Candidate 原始字段、CandidateImage/MediaAsset 和 allowed targets；每个决定显式显示将产生的领域命令。
- 管理端正式维护、merge、split、undo、隐藏/恢复和主图选择都必须显示 expected_version、影响 scope、reason 与最终 operation_id。
- OperationLog、SourceRecord 和媒体对象状态默认只读；修复通过专用命令完成。

## 12. 实现与演进门禁

PR-00 已完成正式初始化；PR-01 正在把核心目录切片转为：

1. PostgreSQL migration 和约束清单；
2. Payload Collections/Globals 的默认拒绝 access；
3. 领域命令、事务和固定锁顺序；
4. Admin UI 的 command-only 写入；
5. PR-01 的 generic CRUD、stableId、CAS、并发和发布占位攻击测试。

owner/allowed target、主图、merge/split/undo、数据库与对象 manifest 联合恢复分别属于 PR-02—PR-07，不能在 PR-01 伪实现或宣称验证。

任何字段或状态变化都必须提供向前 migration、回滚/补偿策略和导出兼容说明。Payload、hook、adapter 或 Admin 插件升级后，应重跑 [Payload 生产门禁](../research/PAYLOAD_PRODUCTION_GATE_SPEC.md) 所定义的权限、恢复、对象存储和 standalone 边界。
