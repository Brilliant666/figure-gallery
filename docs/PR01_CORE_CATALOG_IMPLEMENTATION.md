# PR-01 核心目录实现

## 1. 状态、目标与证据边界

PR-00 已合并。本文描述 `feat/pr-01-core-catalog` 上的 PR-01 Draft 候选实现；它不记录 CAT-01—CAT-21 的结果状态。最终门禁状态只能取自最终 Head 对应的 Formal web CI 和 `research/evidence/pr01/catalog-results.json`，在该证据生成并核对前不得写成 pass。

本轮只实现 Work、Character、CharacterAlias、Manufacturer、FigurePrototype、FigurePrototypeCharacter、FigureVersion 和最小 OperationLog。CandidateClient、SourceRecord、CandidateRecord、CandidateImage、ReviewWorkItem、SystemSetting、正式 MediaAsset/FigureImage、主图、merge/split/undo、公开搜索/图库和部署均不在实现内；PR-02 明确未开始。

## 2. 正式 Collection 与字段

所有业务 Collection 都关闭 drafts、versions、trash、duplicate、bulk edit/delete；Admin 可 list/read，generic create/update/delete 为拒绝。Payload 自动维护 `createdAt`、`updatedAt`，下表列出领域字段。

| Collection / 数据库表 | 领域字段与关系 |
| --- | --- |
| Work / `works` | `stableId`；`displayName`、`originalName`、`normalizedName`；`workType`；`publicationStatus`；`lockVersion`；`createdBy`、`updatedBy`；`deletedAt`、`deletedBy`、`deleteReason` |
| Character / `characters` | `stableId`；可选 `work`；`displayName`、`nameZh`、`nameJa`、`nameEn`、`normalizedName`、派生 `searchDocument`；`status`；`lockVersion`；actor 与软删除字段 |
| CharacterAlias / `character_aliases` | `stableId`；必填 `character`；`value`、`normalizedValue`、`locale`、`aliasType`、`isPreferred`；`createdBy`；软删除字段 |
| Manufacturer / `manufacturers` | `stableId`；`canonicalName`、`normalizedName`；owned `aliases[]`（`value`、`normalizedValue`、`locale`）；`officialSiteUrl`、`authorizationNote`、`sourceEvidence`；`status`、`lockVersion`；actor 与软删除字段 |
| FigurePrototype / `figure_prototypes` | `stableId`；`title`、`normalizedTitle`；可选 `work`、必填 `manufacturer`；`figureType`、`scale`、`costumeText`、`isGroup`；只读 `adultEntryFlag=false`；authorization 字段；inclusion 字段；`publicationStatus`、保留但本轮不可写的 `mergedInto`；`lockVersion`；actor 与 archive 字段 |
| FigurePrototypeCharacter / `figure_prototype_characters` | `stableId`；必填 `prototype`、`character`；`displayOrder`、`role`；`createdBy`；软删除字段 |
| FigureVersion / `figure_versions` | `stableId`；必填 `prototype`；`name`、`normalizedVersionKey`、`kind`、`channelOrDistributorLabel`；`releaseStatus`、`grayModelCompleteness`、`releaseDate`、`skuOrCode`、`notes`；`lockVersion`；actor 与软删除字段 |
| OperationLog / `operation_logs` | `operationId`；`actorUser`、`actorType`、`dutyContext`；`action`、`scopeType`、`scopeStableId`、`reason`；`expectedVersion`、`resultVersion`；`beforeSnapshot`、`afterSnapshot`、`requestDigest`；`reversible=false`；Payload timestamps |

`figure-prototype-characters` 是承载 `displayOrder` 与 `role` 的正式关系 Collection，不用简单多选数组替代。Manufacturer alias 是 Manufacturer owned array；WorkAlias 不在 PR-01 范围。OperationLog 没有通用 stableId，它以 UUID `operationId` 为稳定身份。

业务身份采用 serial internal ID + immutable UUID `stableId` fallback，详见 [PR-01 业务身份实现](PR01_IDENTITY_IMPLEMENTATION.md)。所有命令、结果和审计作用域只使用稳定身份，不把 Payload internal ID 变成合同。

## 3. 框架无关合同与规范化

`packages/domain-contracts` 不导入 Payload、Next.js、数据库、`apps/web`、`spikes` 或 `research`，提供：

- 目录枚举、命令 discriminated union、结果 DTO 与稳定错误码；
- `CATALOG_NORMALIZATION_VERSION = 1`；
- NFKC、trim、连续空白折叠和拉丁字母小写；保留中日韩字符，不翻译，原文值单独保存；
- Character `searchDocument` 和 FigureVersion `normalizedVersionKey` 的确定性构造；
- Work/Character/Manufacturer/Prototype PR-01 状态迁移表；
- 角色关系、完整灰模、授权与收录资格的纯函数不变量。

未来修改规范化规则必须使用新版本与独立 migration 重建派生值，不能静默改变既有匹配结果。

## 4. 关系、状态与资格门禁

### 4.1 状态

- Work：`draft → published|hidden`、`published → hidden`、`hidden → draft|published`；软删除后普通更新失败，必须 restore。
- Character：`matching_pending → active|hidden`、`active → hidden`、`hidden → active`；Work 可空，同名 Character 可通过 Work 消歧。
- Manufacturer：`draft → active|hidden`、`active → hidden`、`hidden → active`；激活必须是带 reason 的 Admin 命令。
- Prototype authorization：`official`、`authorized_third_party`、`rejected` 都由显式复审命令设置；rejected 同事务把 inclusion 设为 excluded 并记录 review actor/time/reason。
- Prototype inclusion：只接受 `eligible` 或 `excluded` 审核命令；两者都记录 reason/actor/time。
- Prototype publication：本轮可维护 `draft`、`hidden`、`archived`。archive/restore 使用专用命令保存归因；restore 回到 draft。

软删除或归档都不会物理删除关系。已软删除实体不能普通更新；恢复仍使用 `expectedVersion` 并产生新的 OperationLog。

### 4.2 Prototype 角色不变量

创建或整体替换关系时，服务在同一事务内要求：

1. 至少一个 Character；
2. 恰好一个 `primary`；
3. Character 不重复；
4. `displayOrder` 是不重复的非负整数；
5. 多于一个 Character 时 `isGroup=true`；非 group 不得有多角色。

数据库以部分唯一索引保证未删除关系的 pair、display order 和“至多一个 primary”；“至少一个”和“恰好一个 primary”由聚合 service 原子保证，不能只依赖 Admin UI。

### 4.3 eligible 门禁与持续保护

`inclusionStatus=eligible` 只有在下列条件同时成立时通过：

- authorization 是 `official` 或 `authorized_third_party`；
- Manufacturer 未删除且为 active；
- 至少一个未删除的 Character 关系，且恰好一个 primary；Character 的可见状态不替代删除判定；
- 至少一个未删除且满足收录资格的 FigureVersion；
- Prototype 未 archived。

可构成资格的 Version 为 `announced`、`painted_prototype`、`preorder`、`released`，或 `gray_prototype + complete`。`cancelled`、`unknown`、partial/unknown gray 都不构成资格。服务还阻止隐藏/删除 eligible Prototype 使用的 Character 或 Manufacturer，并在关系、授权、Prototype 或 Version 变化后重新检查，避免已 eligible 聚合被破坏。

### 4.4 PR-01 固定占位错误

- 请求 `publicationStatus=published` 固定返回 `FORMAL_MAIN_IMAGE_CAPABILITY_NOT_AVAILABLE`；数据库 CHECK 也禁止持久化 published。技术 Media 或空引用不能充当主图。
- 请求 `publicationStatus=merged` 固定返回 `MERGE_CAPABILITY_NOT_AVAILABLE`；generic 写入被关闭，`mergedInto` 本轮没有领域命令。
- `adultEntryFlag` 服务与数据库都固定为 false，直到 PR-04 的正式媒体关系实现。

## 5. 唯一正式写入入口

`apps/web/src/domain/catalog/` 提供 30 个显式命令：

- Work：`createWork`、`updateWork`、`setWorkPublicationStatus`、`softDeleteWork`、`restoreWork`；
- Character：`createCharacter`、`updateCharacter`、`addCharacterAlias`、`updateCharacterAlias`、`removeCharacterAlias`、`setCharacterStatus`、`softDeleteCharacter`、`restoreCharacter`；
- Manufacturer：`createManufacturer`、`updateManufacturer`、`setManufacturerStatus`、`softDeleteManufacturer`、`restoreManufacturer`；
- FigurePrototype：`createFigurePrototype`、`updateFigurePrototype`、`setPrototypeCharacters`、`reviewPrototypeAuthorization`、`reviewPrototypeInclusion`、`setPrototypePublicationStatus`、`archivePrototype`、`restorePrototype`；
- FigureVersion：`createFigureVersion`、`updateFigureVersion`、`softDeleteFigureVersion`、`restoreFigureVersion`。

每个命令要求已认证 Payload Admin、UUID `operationId`、非空 `reason`；所有修改/状态命令还要求正整数 `expectedVersion`。适配器使用显式 allowlist 和 discriminated schema，不接受任意 collection 或任意 patch。结果仅含 `stableId`、可选关系 stable ID、`lockVersion`、状态、`operationId` 和可选的非阻断 warning。Work 同名不设硬唯一约束；创建或重命名为与现有未删除 Work 相同的 normalized name 时仍保存，但返回 `WORK_NORMALIZED_NAME_DUPLICATE`，Catalog Operations 明确显示复核提示。

### 5.1 CAS、事务与幂等

service 直接在 PostgreSQL/Drizzle transaction 中执行受控 SQL；更新条件同时匹配 `stable_id` 与 `lock_version`，成功后原子 `lock_version + 1`。过期版本返回 `CATALOG_VERSION_CONFLICT`，业务行与日志一起回滚。

`operationId` 先取得 advisory transaction lock。规范化命令 JSON 计算 SHA-256 `requestDigest`：同 operation + 同 digest 返回已保存结果；同 operation + 不同 digest 返回 `CATALOG_OPERATION_ID_CONFLICT`。首次成功时，业务修改和 OperationLog 在同一事务提交。

### 5.2 OperationLog

OperationLog append-only，generic create/update/delete 全拒绝；PR-01 所有记录 `reversible=false`，不实现 undo。snapshot 只含小型、结构化、脱敏的业务字段和稳定结果，不保存 secret、headers、环境变量或完整请求。`catalog_review` 已作为枚举预留；当前 PR-01 mapper 以 `catalog_maintenance` 记录目录命令，未来细化 duty context 必须保持审计兼容。

合成 seed 计划含 43 个固定 operation ID；首次执行预期产生 43 次审计写入，再次执行应全部 replay 而不增加业务记录或日志。实际数量只由 PostgreSQL 集成证据确认。

## 6. Admin、API 与防旁路

正式命令端点是 `POST /api/admin/catalog/commands`：无登录 401、非 Admin 403、版本/幂等冲突 409、不变量与 schema 失败 422，未知服务失败为脱敏 500。端点不公开，不接受 CandidateClient，也不返回 internal ID。

所有八个业务 Collection：

- anonymous read/write 全拒绝；已认证 Admin 仅 read；
- `graphQL.disableMutations=true`；
- generic REST、GraphQL mutation、Admin save、普通 Local API 与 `overrideAccess=true` 写入均被 access + `beforeOperation` 拒绝；
- `stableId` field hook 再次阻止篡改；
- 内部写 context 使用模块私有 WeakSet，HTTP 不能构造；静态检查限制可疑 Payload CRUD 与 context import。

`/admin/catalog-operations` 是最小自定义 Admin View。服务端 wrapper 验证 Payload Admin session；客户端表单只调用 Catalog Command API，支持创建/维护核心目录、alias、Manufacturer 激活、Prototype 关系、Version、authorization/inclusion、隐藏/恢复和 published 失败提示。Collection 详情与 OperationLog 保持只读。本轮不实现品牌化 UI、审核工作台、批量操作或 merge/split/undo。

## 7. PostgreSQL migration 与约束

正式 migration：

- `apps/web/src/migrations/20260715_151314_pr01_core_catalog.ts`
- `apps/web/src/migrations/20260715_151314_pr01_core_catalog.json`

它由固定 Payload migration 流程生成基础 schema，再在同一个 migration 中加入显式约束；PR-00 baseline migration 未修改，schema push 仍关闭。

### 7.1 数据库强制项

- 七个目录实体/关系的 `stable_id`：NOT NULL、唯一和 UUID 形状 CHECK；OperationLog 的 operation/scope UUID 和 64 位小写十六进制 digest CHECK；
- Work、Character、Manufacturer、Prototype、Version：`lock_version > 0`；
- Work、Character、Alias、Manufacturer、PrototypeCharacter、Version：删除时间存在时，删除 actor 与非空 reason 必须同时存在；
- 未删除 Manufacturer 的 normalized name 部分唯一；Work/Character 名称不设全局唯一；
- 未删除 CharacterAlias 的 `(character, normalizedValue, coalesced locale)` 唯一，同 Character/locale 至多一个 preferred；
- 未删除 PrototypeCharacter 的 `(prototype, character)` 与 `(prototype, displayOrder)` 唯一，同 Prototype 至多一个 primary；
- 未删除 Version 的 `(prototype, normalizedVersionKey)` 唯一；gray release/completeness CHECK；
- `figureType` 由 PostgreSQL enum 限制为 scale/prize；
- archive 状态与 `archivedAt`/actor/non-empty reason 的双向一致性 CHECK；rejected authorization、eligible/excluded review 归因和 eligible authorization CHECK；
- `adultEntryFlag=false`、`publicationStatus<>published`；merged 行必须有 `mergedInto`，而 service 在 PR-01 进一步一律拒绝 merged；
- 正式关系 FK 使用 RESTRICT，owned Manufacturer alias 和 Payload locked-document 技术关系按框架生命周期处理；
- OperationLog operation ID 唯一、版本为正、reason/action/scope 非空且 `reversible=false`。

跨行“至少一个角色、恰好一个 primary、eligible 仍有效”由同一 PostgreSQL transaction 内的领域查询和 CAS 强制，并由并发/回滚测试覆盖。

手工加入 migration、需要在 drift/down 检查中保持稳定的名称如下（Payload 生成的普通 FK/时间戳索引不在此重复列出）：

| 类别 | 约束/索引名称 |
| --- | --- |
| stable UUID | `works_stable_id_uuid_chk`、`characters_stable_id_uuid_chk`、`character_aliases_stable_id_uuid_chk`、`manufacturers_stable_id_uuid_chk`、`figure_prototypes_stable_id_uuid_chk`、`figure_prototype_characters_stable_id_uuid_chk`、`figure_versions_stable_id_uuid_chk` |
| lock/soft delete/archive | `works_lock_version_positive_chk`、`characters_lock_version_positive_chk`、`manufacturers_lock_version_positive_chk`、`figure_prototypes_lock_version_positive_chk`、`figure_versions_lock_version_positive_chk`；`works_soft_delete_attribution_chk`、`characters_soft_delete_attribution_chk`、`character_aliases_soft_delete_attribution_chk`、`manufacturers_soft_delete_attribution_chk`、`figure_prototype_characters_soft_delete_attribution_chk`、`figure_versions_soft_delete_attribution_chk`；`figure_prototypes_archive_attribution_chk` |
| alias/manufacturer partial unique | `manufacturers_active_normalized_name_uq`、`character_aliases_active_value_locale_uq`、`character_aliases_active_preferred_locale_uq` |
| Prototype relation/version partial unique | `figure_prototype_characters_active_pair_uq`、`figure_prototype_characters_active_display_order_uq`、`figure_prototype_characters_active_primary_uq`、`figure_versions_active_prototype_key_uq` |
| Figure/version checks | `figure_prototype_characters_display_order_nonnegative_chk`、`figure_versions_gray_completeness_chk`、`figure_prototypes_adult_entry_false_chk`、`figure_prototypes_publication_unavailable_chk`、`figure_prototypes_merged_target_chk`、`figure_prototypes_rejected_authorization_chk`、`figure_prototypes_inclusion_review_chk`、`figure_prototypes_eligible_authorization_chk` |
| OperationLog checks | `operation_logs_operation_id_uuid_chk`、`operation_logs_scope_stable_id_uuid_chk`、`operation_logs_request_digest_chk`、`operation_logs_expected_version_positive_chk`、`operation_logs_result_version_positive_chk`、`operation_logs_required_text_chk`、`operation_logs_not_reversible_chk` |

### 7.2 Up/down 验证与回滚

CI 必须验证 PR-00 baseline → PR-01 up、repeat、status、drift、独立数据库 down 回 PR-00 logical schema signature、再 up 和最终 logical signature 一致。logical signature 比较列名/类型/可空/default、约束、索引和 enum，不使用 PostgreSQL 在 DROP COLUMN 后不会复用的物理 attribute ordinal。down 只适用于无生产数据的 PR-01 测试数据库；一旦存在保留数据，回滚使用独立 revert/forward-fix PR，先导出计数与关系摘要，绝不手工改写已合并 baseline。

本文只说明验证合同；未拿到最终 CI 机器结果前，不对 fresh/repeat/down/up/drift 作成功结论。

## 8. 完全合成 fixture

`packages/test-fixtures` 只依赖 framework-independent contracts，并通过 `CatalogFixtureExecutor` 调用 catalog domain service。固定计划包含：2 个虚构 Work、4 个虚构 Character（其中两个同名但 Work 不同）、多语言名字和 5 个 alias、3 个 draft/active/hidden Manufacturer、5 个 Prototype、同 normalized title/不同 Manufacturer 的两个 Prototype、一个 group、一个 authorized-third-party、一个 rejected/excluded，以及 regular/deluxe/reissue/recolor、完整/部分 gray Version。

fixture 没有真实作品、角色、厂商、手办、图片、Hpoi URL 或外部请求。固定 operation ID 让 seed 可重复执行；相同 digest 必须 replay，不能使用 direct SQL 或 generic CRUD 绕过 service。

## 9. CAT-01—CAT-21 验收映射

下表是测试和证据路由，不是通过声明。状态只能由最终 `catalog-results.json` 记录为 `pass`、`fail`、`not_run` 或 `environment_blocked`。

| Gate | 实现/测试路由 |
| --- | --- |
| CAT-01 | Collection config、payload types、catalog boundary/static entity allowlist |
| CAT-02 | stableId unit/PG uniqueness、UUID CHECK、generic mutation/篡改攻击 |
| CAT-03 | `catalog-contracts.test.ts` 的 NFKC/空白/Latin/CJK/确定性测试 |
| CAT-04 | Work service、状态、soft-delete、CAS 集成测试 |
| CAT-05 | Character optional Work、同名跨 Work、matching_pending fixture/集成测试 |
| CAT-06 | Alias partial unique/preferred、事务内 searchDocument rebuild |
| CAT-07 | Manufacturer 状态、partial unique、active/eligible 保护 |
| CAT-08 | Prototype Character pure invariant、PG partial unique、transaction rollback |
| CAT-09 | 同 normalized title、不同 Manufacturer fixture 与关系断言 |
| CAT-10 | Version kind/normalized key/同 Prototype 复合唯一 |
| CAT-11 | gray pure function、service 拒绝和 PostgreSQL CHECK |
| CAT-12 | official/authorized-third-party/rejected 复审与归因 |
| CAT-13 | eligible/excluded 前置和持续保护 |
| CAT-14 | published/merged 固定错误、PG placeholder、技术 Media 非领域模型 |
| CAT-15 | domain service + 同事务 OperationLog、静态写入口检查 |
| CAT-16 | expectedVersion CAS、并发、失败整体回滚 |
| CAT-17 | REST/GraphQL/Local API/Admin/overrideAccess 攻击矩阵 |
| CAT-18 | `catalog.e2e.spec.ts` 的登录、Catalog Operations、只读详情和稳定错误流程 |
| CAT-19 | `migration-cycle.ts` 的 fresh/repeat/down/up/status/drift/signature |
| CAT-20 | 合成 fixture 首次/重复 seed、真实性/二进制/网络静态检查 |
| CAT-21 | network guard、禁止后续实体/功能、Hpoi requests=0 |

相关测试入口包括 `tests/unit/catalog-contracts.test.ts`、`tests/unit/catalog-commands.test.ts`、`tests/integration/catalog.integration.ts`、`tests/integration/migration-cycle.ts`、`tests/e2e/catalog.e2e.spec.ts` 和 `infra/scripts/check-catalog-boundaries.mjs`。Formal web CI 继续回归 PR-00 environment、health、S3 readiness、build、standalone、Admin、安全、no-spike 与 repository safety。

## 10. 依赖与安全审计

PR-01 未新增运行时依赖，也未运行 `npm audit fix`，Payload/Next/React/Sharp/adapter 精确版本保持不变。本地使用官方 npm registry 对 production dependencies 的一次完整审计结果为：320 个 production dependencies，info 0、low 0、moderate 7、high 0、critical 0；moderate 数量与 PR-00 已知基线相同。此前默认淘宝镜像因证书过期产生的传输失败不是漏洞结果，未被计入审计结论。

最终 PR 仍须记录 Formal web CI 的 lock install、typecheck、ESLint、Vitest、PostgreSQL、Playwright、production build、standalone、artifact 与凭据/二进制扫描结果。

## 11. 明确停止边界

PR-01 完成 CAT 门禁并创建 Draft PR 后立即停止。它没有复制 `spikes/`，不访问 Hpoi 或任何外部来源，不使用真实数据/图片，不部署，也不合并自身。PR-02 的 Candidate/Source 能力以及 PR-03—PR-06 的 Review、正式媒体、merge/split/undo、搜索和图库均保持未开始。
