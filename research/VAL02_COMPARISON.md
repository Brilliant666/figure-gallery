# VAL-02 Wagtail 与 Payload CMS＋Next.js 对比

## 1. 比较边界与证据口径

本报告只比较 `spikes/val02_wagtail/` 与 `spikes/val02_payload/` 两个可丢弃原型，
用于决定当前证据下的**暂时领先方案**。它不选择最终技术栈，不把任一 spike
提升为正式项目，也不包含生产部署结论。

比较依据为：

- [`VAL02_ACCEPTANCE_SPEC.md`](VAL02_ACCEPTANCE_SPEC.md) 的同一领域合同、同一合成
  fixture 与固定九维评分权重；
- 两个当前机器结果：
  [`Wagtail acceptance-results.json`](../spikes/val02_wagtail/acceptance-results.json)
  与
  [`Payload acceptance-results.json`](../spikes/val02_payload/acceptance-results.json)；
- 两份最终结果报告与验证摘要：
  [`VAL02_WAGTAIL_RESULTS.md`](VAL02_WAGTAIL_RESULTS.md)、
  [`VAL02_PAYLOAD_RESULTS.md`](VAL02_PAYLOAD_RESULTS.md)、
  [`wagtail-validation-summary.json`](evidence/val02/wagtail-validation-summary.json)、
  [`payload-validation-summary.json`](evidence/val02/payload-validation-summary.json)；
- 原型的模型、权限、领域服务、后台组件、前台、导出、migration 和自动测试源码。

两个结果均为 **29 pass、0 fail、1 not_run**；唯一 `not_run` 都是 AC-29，原因是
当前环境无法控制真实 Chrome。静态 DOM/组件/JavaScript 检查没有被冒充为真实点击
证据。测试条数只说明各自 runner 的覆盖范围，下面的九维得分还单独考虑 Admin
实际可操作范围、代码量、运行拓扑、许可证和未验证风险，不能由 29/30 直接推导。

## 2. 实际基线与统一工作量口径

| 项目 | Wagtail | Payload CMS＋Next.js |
| --- | --- | --- |
| 实际版本 | Python 3.10.9、Django 5.2.16、Wagtail 7.4.2、django-storages 1.14.6 | Node.js 22.23.1、npm 10.9.8、Payload 3.86.0、Next.js 16.2.10、React/React DOM 19.2.7；共享 client 另用 Python 3.10.9 |
| 数据库 | SQLite | SQLite（`@payloadcms/db-sqlite`） |
| 本地运行拓扑 | 1 个 Python/Django/Wagtail 常驻进程＋SQLite＋本地媒体 | 1 个 Node/Payload/Next 常驻进程＋SQLite＋本地媒体；候选写入另有按需 Python client，形成双运行时边界 |
| 自定义实现 | **2,904 行** | **4,289 行** |
| 测试 | **1,499 行，52/52 Django 测试通过** | **2,122 行，36/36 Vitest 测试通过** |
| Admin 定制 | **220 行** | **413 行 Admin 组件**；若把 review endpoint 计入后台定制则为 **984 行** |
| Migration | **2 个 migration artifacts** | **1 组逻辑 migration、2 个 artifacts**（TypeScript migration＋schema snapshot） |
| 直接依赖 | **3 个** | **9 个 runtime＋8 个 dev** |
| 图片基础设施 | Wagtail Images、可重建 rendition、Django Storage | Payload Upload、Sharp、320px thumbnail、1280px preview、官方 S3 plugin 边界 |
| 主要运行警告 | 2 条未静默 `treebeard.E001`，指向未来 Treebeard 6 manager 兼容风险 | `output: 'standalone'` 下用 `next start` smoke 出现启动方式提示；正式 standalone 资产装配未验证 |

Payload 验收 runner 另报告 **6,212 行**，但该数包含测试和验证脚本，不能与 Wagtail
的 2,904 行纯实现口径直接比较。本报告统一使用“实现 2,904 vs 4,289、测试 1,499
vs 2,122”；migration、生成的类型/import map 和依赖目录不计入实现行数。

## 3. AC-01—AC-30 逐项对照

表中测试名是当前机器结果引用的实际测试/观察摘要；`pass` 不代表相应功能已经有
完整运营 UI，`not_run` 也不会按通过计分。

| ID | 验收条件 | Wagtail 状态与证据摘要 | Payload 状态与证据摘要 |
| --- | --- | --- | --- |
| AC-01 | 重复 upsert 不重复 | **pass** — `test_source_upsert_is_idempotent`；首次/重复保持一个来源与候选 | **pass** — `performs idempotent candidate/source/media metadata upsert`；created 后 unchanged，ID 不变 |
| AC-02 | ID 优先、URL fallback 可迁移 | **pass** — `test_url_fallback_migrates_to_stable_id_without_duplicate` | **pass** — `migrates a URL fallback source identity to a stable source ID`；来源/候选 ID 不变 |
| AC-03 | 候选同步不能创建角色 | **pass** — `test_unknown_names_stay_in_candidate_pool`，正式角色集合不变 | **pass** — idempotent upsert 测试断言 unknown candidate 前后 Character 数不变 |
| AC-04 | 候选同步不能创建厂商 | **pass** — `test_http_idempotence_and_formal_counts`，正式厂商数不变 | **pass** — idempotent upsert 测试断言 Manufacturer 数不变 |
| AC-05 | 新角色只进入待匹配 | **pass** — unknown names 保持 candidate pool | **pass** — unknown character 保持 `matchState=character_pending` |
| AC-06 | 新厂商仅 draft 且不公开 | **pass** — `test_new_manufacturer_defaults_draft`；另有受审计生命周期 service | **pass** — `creates a new manufacturer only as audited draft...`；generic active create 被拒，激活另行审计 |
| AC-07 | 候选 API 不可改正式原型 | **pass** — `test_http_rejects_direct_prototype_or_main_image_write`，HTTP 403 | **pass** — `keeps candidate access out of formal entities`；正式及通用候选写入口关闭 |
| AC-08 | 候选 API 不可换主图 | **pass** — shared Python client 权限测试；主图攻击 HTTP 403 且引用不变 | **pass** — access/hook 双边界，攻击 HTTP 403，既有 main media ID 不变 |
| AC-09 | 管理员从候选建原型 | **pass** — `test_admin_creates_prototype_from_candidate_with_audit` | **pass** — `keeps defer/reject/create review writes atomic and auditable`，创建 draft 并写日志 |
| AC-10 | 候选归入已有版本 | **pass** — `test_admin_attaches_candidate_to_existing_version` | **pass** — `applies accepted fields but only links...`，版本数不增加 |
| AC-11 | 逐字段采纳/拒绝并审计 | **pass** — `test_field_accept_and_reject_are_audited` | **pass** — accept/reject 测试回读字段、拒绝值、原因与日志 |
| AC-12 | deferred/ignored 保存原因 | **pass** — `test_deferred_and_ignored_keep_reason` | **pass** — defer/ignore 均回读原状态与非空原因 |
| AC-13 | merge→split→两次 undo 一致 | **pass** — `test_merge_split_and_two_undos_restore_cross_record_relations` | **pass** — `keeps candidate, media, source and version relations closed...`，完整恢复关联 |
| AC-14 | 所有领域写入有日志 | **pass** — `test_all_domain_write_services_emit_complete_operation_logs`，另测日志失败整组回滚 | **pass** — `records every prototype domain operation...`；通用正式/global CRUD 另行拒绝 |
| AC-15 | 多人原型可由任一角色搜索 | **pass** — `test_multi_character_prototype_is_queryable_from_each_character` | **pass** — formal query 测试从两个 Character 得到同一 prototype |
| AC-16 | 相似动作不同厂商仍独立 | **pass** — `test_similar_pose_different_manufacturers_remain_distinct` | **pass** — formal query 返回两个 prototype ID 与不同 manufacturer ID |
| AC-17 | 四版本只占一图库条目 | **pass** — `test_four_versions_are_one_gallery_prototype` | **pass** — 4 个 version relation，gallery 只返回 1 个 prototype |
| AC-18 | 成人图默认隐藏 | **pass** — `test_adult_main_is_hidden_by_default_and_visible_when_enabled` | **pass** — audited adult main 在默认设置关闭时不返回 |
| AC-19 | 开启设置后成人图可见 | **pass** — 同一测试切换单例设置并重新查询 | **pass** — 受审计设置开启后返回，再重置后隐藏 |
| AC-20 | 来源失效不下架/删本地主图 | **pass** — `test_stale_source_does_not_unpublish_or_remove_local_main` | **pass** — stale source 下 published prototype、main media 与公开图库均保留 |
| AC-21 | 主图身份不依赖 URL | **pass** — `test_manual_main_image_selection_requires_owned_local_media`；media ID/storage key 为身份 | **pass** — 修改 `Media.sourceUrl` 后 media ID、storageKey、prototype.mainImage 不变 |
| AC-22 | JSON/CSV 含核心关系/媒体元数据 | **pass** — `test_json_and_csv_exports_parse`；1 JSON＋10 关系 CSV（另有 manifest） | **pass** — local thumbnail/export 测试；1 JSON＋9 CSV 可解析 |
| AC-23 | 导出不含图片二进制 | **pass** — export binary scan 无 base64/data URL/图片字节 | **pass** — export scan 无 PNG marker、base64 或图片字节 |
| AC-24 | 角色别名可命中 | **pass** — `test_unique_alias_match_redirects_to_gallery` | **pass** — resolver 测试中 `Pilot Lin` 唯一匹配 |
| AC-25 | 唯一角色直达图库 | **pass** — 同一别名测试实际得到预期重定向；另有本地 HTTP 200 smoke | **pass** — executable resolver 返回 `kind=unique` 与精确 gallery target |
| AC-26 | 同名角色按作品消歧 | **pass** — `test_same_name_characters_render_work_disambiguation` | **pass** — resolver 返回两个“林”及两个不同 Work label |
| AC-27 | 默认每页 16 | **pass** — `test_default_page_size_and_stable_paginator` | **pass** — 17 条正式数据形成稳定、无重叠的 16＋1 两页 |
| AC-28 | 原始比例、不裁切 | **pass** — DOM 含宽高，CSS `height:auto`/`object-fit:contain`，4/3/2 列 | **pass** — SSR/组件/CSS 测试保留宽高与 `contain`，4/3/2 列 |
| AC-29 | 灯箱只在当前页切换 | **not_run** — Chrome 扩展/native host 不可用；静态 DOM/JS 替代检查通过但没有点击证据 | **not_run** — Chrome 控制不可用；静态组件检查只确认控件存在，没有执行交互状态/边界 |
| AC-30 | 无 Hpoi 实时请求 | **pass** — process network guard＋运行时模块静态扫描；记录请求数 0 | **pass** — fetch spy 证明 Hpoi 根域/深层子域在 transport 前被拒；记录请求数 0 |

## 4. 能力、边界与缺口对照

### 4.1 数据、迁移与框架复用

| 方面 | Wagtail | Payload CMS＋Next.js |
| --- | --- | --- |
| 领域表达 | Django ORM 覆盖十类统一实体；`FigurePrototype` 组合非 Page revision/draft/workflow mixins；2 个 migration 在全新库实测 | Payload Collections/Global 覆盖相同语义；draft/version/trash 与关系字段可复用；1 组逻辑 migration（2 artifacts）在全新库实测 |
| 已复用 | ORM/事务、Wagtail Admin shell、Snippets、Images/rendition、Django Storage、非 Page revision/workflow | Collections/Relationships、认证/API key、Upload/Sharp、Admin shell、Local/REST API、SQLite migration、S3 plugin |
| 仍需自建 | 候选隔离、审核页、主图保护、跨记录操作/日志、开放导出和前台；manufacturer/settings 有受审计 service 但没有 Admin 控件 | 同样需要候选协议、审核台、主图保护、跨记录操作/日志、开放导出和前台；Work、Character、FigureVersion 的正式维护 service/UI 尚未实现，Manufacturer 维护 UI 也不完整 |
| 数据锁定 | 普通 Django/SQL 关系与开放导出降低退出成本；image/revision/workflow 仍绑定 Wagtail | 开放关系导出降低退出成本；collection schema、hooks/access、Admin component 与 Payload API 形成更大的框架专用面 |

两个原型的模型都证明“业务语义可以表达”，但都没有证明生产数据库、大数据量、
多实例 migration 或备份恢复。`pass` 的模型测试不能替代正式 schema 设计。

### 4.2 Admin 实际可操作范围

| 操作 | Wagtail | Payload CMS＋Next.js |
| --- | --- | --- |
| 候选列表/详情与多图预览 | 自建 Wagtail candidate review 页面可操作并有 HTTP/表单测试 | 自建 React Candidate Review view 可操作并有组件/endpoint 测试 |
| 从候选建草稿原型、归已有版本 | 有实际按钮/表单和 staff-only service | 有实际按钮/endpoint 和 admin-only service |
| 字段接受/拒绝、defer/ignore、选主图 | 有实际页面动作；允许 staff 显式选 `target_prototype_id`，未绑定候选既定 target | 有实际页面动作；允许 admin 显式传 `prototypeID`，同样未绑定候选既定 target；可采纳字段目前限 title/scale/category |
| merge/split/undo | 只有受审计 service 与集成测试，**无 Admin 控件** | 只有受控 service/endpoint 与集成测试，**无 Admin 控件** |
| 厂商、发布生命周期、settings | 厂商生命周期与 settings 有受审计 service，但无 UI；通用 Snippet 写入关闭 | 厂商 draft/activation 与 settings 有受审计 service，但 UI 不完整；通用正式/global CRUD 关闭；Work/Character/Version 正式维护未实现 |
| 实际浏览器审核效率 | **未验证**；没有真实 Chrome 高频操作或可访问性证据 | **未验证**；没有真实 Chrome 高频操作或可访问性证据 |

因此两者都只能称为“最小候选审核台成立”，不能称为完整业务后台。Wagtail 的
220 行与 Payload 的 413 行（连 review endpoint 为 984 行）只是当前最小范围的实测
工作量，不是正式后台的最终估算。

### 4.3 候选隔离、正式写保护与公开读取

- **共同成立：**候选 API 只有 `candidate_upsert`；通用候选/来源/媒体写入口与正式
  写入口都被关闭；候选不能创建 Character/Manufacturer/FigurePrototype/Version，
  不能换主图。真实 loopback smoke 的重复写入保持身份稳定，正式/主图攻击为 403。
- **Wagtail 优势：**handler 直接按实际 `REMOTE_ADDR` fail-closed 为 loopback-only，
  不信任 `X-Forwarded-For`；service 还拒绝候选载荷伪造 `image`/`image_id`，并保护
  已审核来源和正式媒体元数据。
- **Wagtail 缺口：**只有一个共享 candidate Token，没有 owner/per-client 归因；多个
  采集器共享凭证时不能互相隔离。
- **Payload 优势：**`candidate-client` 角色、owner 检查、collection access 和 media/
  source hooks 形成多层边界；另实测 `publicReadEnabled=false` 时匿名 Works、Characters、
  Manufacturers、FigurePrototypes、Media 均拒绝读取。
- **Payload 缺口：**共享 client 与 `dev/start` 默认绑定 loopback，但 candidate handler
  自身没有按远端地址 fail-closed；一旦路由暴露，需要可信网络层另行门禁。

Payload 在“每 client owner＋受控 publicRead/settings”上更强；Wagtail 在“endpoint
自身 loopback 门禁”上更完整。两者的管理员正式动作都依赖内部受信上下文，正式设计
还必须把可选 target 约束到当前审核工作项。

### 4.4 图片、缩略图与存储边界

- Wagtail seed 动态生成合成 PNG，实际创建、删除并重建 `max-24x24` rendition；主图
  要求归属匹配且已有本地 Wagtail Image。默认 FileSystemStorage，可切换
  `storages.backends.s3.S3Storage`，同一 Django Storage 合同已检查。
- Payload seed 通过 Sharp 动态生成合成 PNG，并实际生成 320px thumbnail 与 1280px
  preview；主图要求候选归属、稳定 `storageKey` 及本地 `filename/url`。默认本地，
  `S3_ENABLED=true` 时装载官方 S3 plugin。
- 两边都证明了“本地合成文件→预览/缩略图→人工主图”和“URL 不是身份”；也都只
  验证了 S3 配置/抽象边界，**没有真实 bucket I/O、迁移、签名 URL 或恢复**。
- 共享 Python client 在两端都只传媒体元数据，不传文件。尚无受控的候选文件导入
  管线，因此“真实 client→本地候选预览→选主图”两边都未闭环。

Wagtail Images/rendition 与 Django Storage 的成熟度、可重建 rendition 证据和较少
胶水代码使其在本轮图片维度略占优势；Payload 的 Upload/imageSizes/S3 plugin 也已
证明可行，但不能把 plugin 配置写成真实对象存储通过。

### 4.5 merge/split/undo 与日志

两边都完成真实 `merge → split → undo split → undo merge`，恢复 Candidate、Media/
CandidateImage、Source 和 Version 关系；都拒绝不完整关系闭包，并证明日志晚期失败
会使事务整体回滚。Wagtail 使用 `transaction.atomic` 和行锁，Payload 使用 SQLite
adapter 的 `behavior: immediate` 事务；两边都保留被合并对象而非物理删除。

共同限制也相同：undo 只能针对**全局最新**未撤销 merge/split，不能由 reviewer
选择操作；没有 reviewer/work-item scope、并发冲突测试或复杂操作链恢复；Admin
也都没有 merge/split/undo 控件。因此 AC-13/14 的通过证明领域服务正确，不证明
运营人员已经能安全高效地使用它。

### 4.6 开放导出、前台与迁移能力

- Wagtail 输出 1 个关系 JSON、10 张关系 CSV 与 1 个 manifest；Payload 输出 1 个
  关系 JSON 与 9 张 CSV。两者均重新解析，保留稳定 ID、关系 ID、storage key、来源
  URL 与哈希，排除媒体字节和凭据字段。
- 两边都实现别名、唯一命中直达、同名作品消歧、多角色、多版本一条目、成人开关、
  每页 16、4/3/2 列和原比例图片；AC-24—28 通过。
- 灯箱源码/组件都有限定当前页的上一张/下一张、缩放和关闭，也都没有下载按钮；
  但 AC-29 没有真实 Chrome 交互，不能确认点击状态、首尾边界和真实响应式体验。
- 开放导出降低迁移锁定，但没有做反向恢复、跨框架导入或生产数据库迁移，不能据此
  宣称可无损换栈。

## 5. 实测命令、响应与运维复杂度

本节只列实际保留的观察，不外推为容量或生产性能。

| 观察 | Wagtail | Payload CMS＋Next.js |
| --- | --- | --- |
| 测试 | 52 项 Django 测试 7,970 ms | 36 项 Vitest 6.43 s |
| 构建/静态资产 | `collectstatic` 1,266 ms | `next build`：编译 5.3 s、TypeScript 3.6 s、静态生成 1.026 s |
| 全新数据库 | migrate 6,852 ms；首次 seed 1,527 ms；重复 seed 1,546 ms | 全新 migrate、状态、首次/重复 seed 均通过，但最终摘要未保留可对称比较的毫秒值 |
| 服务就绪 | 新进程到首页 HTTP 200：1,728 ms | loopback server readiness 单样本：195 ms |
| 页面响应 | 首页热响应 39.79、1.28、0.78、0.95、0.72 ms，中位数 0.95 ms；别名重定向最终 200 | **没有保留最终页面响应样本，故不报告或推算** |
| 生产形态验证 | 未部署；真实对象存储/生产 DB 未验证 | 未部署；standalone 正式启动/资产装配、真实对象存储/生产 DB 未验证 |

上述启动数字测试路径不同，不能用 1,728 ms 与 195 ms 直接宣布性能胜负。运维评分
主要依据可复核命令、常驻拓扑、依赖面和未验证项：Wagtail 是单 Python runtime、
3 个直接依赖且保存了较完整命令/HTTP 小样本；Payload 是 Node 应用加按需 Python
client、9＋8 个直接依赖，并额外存在 build/standalone 资产边界。

## 6. 九维加权评分

固定权重为 20/20/15/15/10/5/5/5/5，总计 100。每项分数均保留一位小数；
AC-29 的 `not_run` 没有按通过计分，未运行的浏览器、S3、生产数据库、部署与并发验证
也都在相应维度扣分。

| 维度 | 权重 | Wagtail 证据与得分 | Payload CMS＋Next.js 证据与得分 |
| --- | ---: | --- | --- |
| 领域模型适配 | 20 | AC-01/02/05/06/15/16/17/20/21 全通过；Django 关系模型、约束、2 migrations、非 Page revision/workflow 实测。扣分：仍是自建领域层、staff target 未绑定、生产 schema 未验证。**18.5** | 同组 AC 全通过；Collections/Global、稳定来源/媒体身份、1 组 migration 与 draft/version/trash 可用。扣分：Work/Character/Version 正式维护未实现、target 未绑定、Payload schema/hook 专用面更大。**17.5** |
| 候选审核体验 | 20 | AC-09—12 通过；220 行审核定制包含真实页面、表单、rendition 与动作测试。扣分：无真实 Chrome，merge/settings/manufacturer 无 UI。**14.5** | AC-09—12 通过；413 行组件（连 endpoint 984）提供真实 review view/actions。扣分：无真实 Chrome，正式维护、merge、发布/settings 控件缺失，可采纳字段有限。**13.5** |
| 候选与正式数据隔离 | 15 | AC-03/04/07/08、真实 403 与主图不变通过；handler 自身按真实远端 fail-closed。扣分：单共享 Token、无 owner 隔离。**12.8** | 同组 AC、真实 403、access/hook、owner、publicRead=false 测试通过。扣分：handler 自身无远端地址门禁，暴露时依赖可信网络层。**13.5** |
| merge/split/undo 可控性 | 15 | AC-13/14、事务回滚与两次 undo 通过。扣分：只撤全局最新、无并发 scope、无 Admin 控件。**11.5** | AC-13/14、SQLite immediate transaction、关系闭包/回滚通过。相同的 global-latest、并发与 UI 缺口。**11.5** |
| 图片与存储能力 | 10 | AC-18/19/21/28；Wagtail Image、可重建 rendition、Storage 边界与本地主图实测。扣分：metadata-only client、无真实 S3。**8.5** | 同组 AC；Payload Upload/Sharp thumbnail/preview、稳定 storageKey、S3 plugin 边界实测。扣分：metadata-only client、无真实 S3。**8.0** |
| 前台实现效率 | 5 | AC-24—28 与本地 HTTP smoke 通过；模板/CSS/JS 维持 4/3/2 和原比例。AC-29 未运行。**4.0** | AC-24—28 与 resolver/SSR/组件测试通过；Next 前台路径成立，但未保留最终页面响应，AC-29 未运行。**3.8** |
| 导出与数据可迁移性 | 5 | AC-22/23；JSON＋10 关系 CSV＋manifest 解析且无二进制，关系覆盖完整。未做反向恢复。**4.7** | AC-22/23；JSON＋9 CSV 解析且无二进制，排除认证字段。未做反向恢复。**4.5** |
| 本地及云端运维复杂度 | 5 | 单 Python 常驻进程、3 直接依赖；migrate/seed/test/collectstatic/HTTP 数值已保留。无部署/S3/生产 DB。**4.0** | Node 常驻＋按需 Python 双运行时、9＋8 依赖；测试/build/readiness 有数据，但 standalone 正式启动和页面响应未保留，且无部署/S3/生产 DB。**3.2** |
| 许可证和锁定风险 | 5 | Django/Wagtail BSD-3-Clause；普通 SQL/开放导出，锁定低至中。image/revision/workflow 有 Wagtail 绑定及 Treebeard 升级警告。**4.5** | Payload/Next.js MIT；开放导出和多 adapter 有利。Collection schema、hooks/access、Admin/Next 构建面带来低至中锁定。**4.1** |
| **总分** | **100** | **83.0 / 100** | **79.6 / 100** |

分差 **3.4 分**，属于阶段性而非决定性领先。Payload 在候选 owner 隔离、access/hook
纵深防御和受控 `publicReadEnabled` 上领先；Wagtail 在单运行时、统一口径实现量、
成熟 Images/Storage/revision workflow、依赖面和可复核运维样本上领先。二者相同的
29/0/1 结果并没有消除这些工程差异。

## 7. 共同未证明事项与非对称风险

### 共同未证明

- 真实 Chrome 下的候选审核效率、灯箱点击/首尾边界、响应式和可访问性；
- 共享 Python client 的文件传输、受控候选文件导入、预览与人工主图端到端闭环；
- 多管理员并发 merge/split/undo、按工作项撤销、冲突检测与大关系图恢复；
- 真实 S3/对象存储 I/O、媒体迁移、签名 URL、故障恢复和凭据轮换；
- 生产数据库、备份/恢复、大数据量、多实例一致性、任务队列与云端部署；
- staff/admin 显式选择 target 时的审核工作项绑定与更细权限模型；
- merge/split/undo、settings、生命周期等缺失 Admin 控件的实际工作量。

### Wagtail 特有

- 单共享 Token 无 per-client owner/归因；
- 2 条 `treebeard.E001` 指向未来升级兼容风险；
- 非 Page revision/workflow 仅验证最小 round-trip，不能替代完整多人审批。

### Payload 特有

- Work、Character、FigureVersion 的正式维护 service/UI 未实现，Manufacturer UI 也
  不完整；关闭通用 CRUD 后仍缺少这些必要运营入口；
- candidate handler 本身不验证远端地址，路由暴露时须另设可信网络门禁；
- Node/Python 双运行时、依赖和构建/standalone 资产边界扩大运维面。

## 8. 阶段性比较结论

按固定九维证据评分，**Wagtail 83.0 分，Payload CMS＋Next.js 79.6 分，Wagtail
暂时领先**。领先原因不是 AC 数量——两边 AC 结果完全相同——而是 Wagtail 用更少
统一口径实现和依赖，在一个 Python runtime 内给出了成熟图片/存储能力、非 Page
revision/workflow 复用，以及更完整的本地命令和 HTTP 小样本。

Payload 仍是有效候选，尤其是 per-client owner、access/hook 纵深边界、受控 settings/
public read 和 React Admin 扩展能力；若下一轮证明其正式维护 UI、远端 endpoint 门禁、
媒体导入和生产部署成本可控，3.4 分差可能改变。

这只是 VAL-02 的阶段性比较，**不是最终技术栈选择**。本轮没有使用真实手办图片，
没有发起 Hpoi 请求，没有部署，也没有把任一原型转为正式项目。
