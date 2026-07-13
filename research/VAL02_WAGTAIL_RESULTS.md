# VAL-02 Wagtail 可丢弃原型结果

## 1. 实际版本

- 测试日期：2026-07-14，Windows，Python 3.10.9。
- Django 5.2.16、Wagtail 7.4.2、django-storages 1.14.6（含 S3 extra）。
- 本地数据库为 SQLite；本地应用只需 1 个 Python 进程。
- 直接依赖固定为 3 个，`requirements.lock` 固定了 40 个已安装发行包。原型位于 `spikes/val02_wagtail/`，只作离线、可删除的技术验证，不是正式项目，也不构成最终技术栈选择。

证据：[`requirements.txt`](../spikes/val02_wagtail/requirements.txt)、[`requirements.lock`](../spikes/val02_wagtail/requirements.lock)、[`wagtail-validation-summary.json`](evidence/val02/wagtail-validation-summary.json)。

## 2. 架构

原型采用单进程 Django/Wagtail 应用：Django ORM 和 SQLite 保存关系数据，Wagtail Images 经 Django Storage API 保存运行时生成的合成 PNG 及 rendition，Django 模板提供只读前台。数据库、媒体、rendition、静态收集结果和导出默认写入系统临时目录，不进入仓库。

写入面分为两条边界：候选专用 HTTP endpoint 只调用 `candidate_service.upsert_candidate`；人工正式操作只调用需要 staff 身份、带事务和 OperationLog 的领域服务。厂商新建/激活/隐藏及成人图、分页大小、公开开关也有同样的 staff-only 事务化审计服务，但本 spike 没有为它们制作 Wagtail UI。`FigurePrototype` 是非 Page 模型，并组合 `RevisionMixin`、`DraftStateMixin`、`WorkflowMixin`；候选池、跨记录操作和开放导出均为自建实现。

共享 fixture 完全合成，seed 时动态生成 11 个 PNG 记录；本轮没有使用真实手办图片，没有把 Hpoi 作为运行时数据源，验证摘要记录 Hpoi 请求数为 0。

## 3. 启动方式

本地最小流程为创建项目内虚拟环境、安装 lock、设置临时运行目录、执行 migration、seed，再以 `python manage.py runserver 127.0.0.1:<空闲端口> --noreload` 启动。候选 API Token 和 Django secret 只从运行时环境取得；未设置 Django secret 时仅在当前进程内随机生成。seed 创建的 `fixture-admin` 使用不可用密码，没有提交可登录管理员凭据。

最终验证的命令耗时如下，均为小型合成数据环境的观察，不是容量测试：

| 命令/观察 | 实测 |
| --- | ---: |
| `pip check` | 521 ms |
| Django system check | 1,442 ms |
| migration check | 1,536 ms |
| 全新 migrate | 6,852 ms |
| 首次 seed | 1,527 ms |
| 重复 seed | 1,546 ms |
| 52 项 Django 测试 | 7,970 ms |
| `collectstatic` | 1,266 ms |
| 生成验收结果 | 12,161 ms |
| 新进程到首页 HTTP 200 | 1,728 ms |
| 首页热响应 5 次 | 39.79、1.28、0.78、0.95、0.72 ms；中位数 0.95 ms |

别名搜索的本地 HTTP smoke 最终返回 200，并发生了预期的图库重定向。验证时端口 8000 已被无关本地进程占用，因此改用已确认空闲的 loopback 端口；没有修改系统服务或永久代理配置。

## 4. 数据模型

模型覆盖统一合同中的 `Work`、`Character`、`Manufacturer`、`FigurePrototype`、`FigureVersion`、`SourceRecord`、`CandidateRecord`、`CandidateImage`、`OperationLog` 和单例 `SystemSetting`。已实测的关键关系与约束包括：

- 角色可关联作品并保存多语言名、别名、隐藏和软删除；同名角色由作品消歧。
- 原型通过多对多关联一个或多个角色，并关联作品、厂商、类型、比例、成人/多人/发布/合并状态及人工主图；版本只归属于原型，不单独成为图库卡片。
- 来源以 `source_type + source_item_id` 为稳定唯一键；没有来源 ID 时才使用规范化 URL 唯一键，随后可迁移到稳定 ID 而不重复。
- 候选与来源一对一，保留原始字段、匹配状态、逐字段决定、理由和正式目标引用；候选图片可先只保存元数据，之后再关联本地 Wagtail Image。
- 主图引用稳定的 Wagtail media ID；`storage_key` 和哈希保留在图片记录中，来源 URL 只是元数据。
- 当前项目包含 2 个 migration 文件；全新 migrate、`makemigrations --check --dry-run` 和重复 seed 均完成。

## 5. 后台审核

Wagtail 提供管理后台外壳、Snippet 列表、Images/rendition、revision 与 workflow 基础设施。原型把候选、原型、厂商和全局设置的通用 Snippet 表单设为只读，即使 superuser 也不能通过默认 add/change/delete 路径绕过审计。

自建候选审核页可展示候选字段与多张实际 Wagtail rendition，并提供以下显式动作：新建草稿原型、归入已有版本、逐字段接受/拒绝、人工选择主图、defer 和 ignore。逐字段接受会把白名单字段写入明确选择的正式目标；拒绝、defer 和 ignore 会保留原因。当前 `decide_candidate_field` 允许可信 staff 显式传入 `target_prototype_id`，没有强制绑定候选原有 target；这在 spike 中用于人工选择目标，但正式设计必须增加更窄的目标授权/一致性约束。后台页、按钮、表单和服务端动作均有自动测试，但本轮没有完成真实浏览器中的高频审核操作体验测试。Wagtail Admin 中没有 merge/split/undo、厂商生命周期或 SystemSetting 控件；这些 audited services 已验证，但不能把“服务可调用”写成“后台已可操作”。

## 6. 权限隔离

候选 endpoint 仅接受 `candidate_upsert` 协议，要求运行时 `Bearer` Token，限制 JSON 内容类型和 256 KiB 请求体，并依据实际 `REMOTE_ADDR` fail-closed 为 loopback-only，不信任 `X-Forwarded-For`。实现中没有正式 Character、Manufacturer、FigurePrototype、FigureVersion 或主图的任意写入口；候选载荷出现正式字段时返回拒绝。图片对象中的非协议字段 `image`、`image_id` 也会在 service 与 HTTP 层拒绝，候选 Token 因而不能猜测数据库 ID 来关联任意 Wagtail Image。

当同一来源已经过人工审核并关联正式原型时，既有 CandidateRecord 仍允许重采来源与候选原始元数据；但命中已归属正式 prototype 或已选主图的 CandidateImage 时，入口只把字段差异写入审计结果，不修改其 `storage_key`、哈希、原 URL、本地 `image_id`、正式归属或主图引用。正式 SourceRecord 若没有既有 CandidateRecord，则不能由候选入口认领。该 spike 仍只有一个共享 candidate Token，没有 per-client owner 字段；多个采集器共享凭证时无法逐客户端归因或隔离，这是明确风险。

最终本地 loopback smoke 使用同一个共享 Python candidate client：seed 后第一次重采为 `updated`，重复请求为 `unchanged`，来源/候选身份保持稳定；尝试写正式原型返回 HTTP 403，尝试替换主图也返回 HTTP 403。候选同步前后的正式角色、厂商、原型数量和已选主图保持不变。候选 client 已修正为对 loopback 请求绕过进程环境代理，并新增回归测试；未修改永久代理配置。

所有人工正式操作另行要求 authenticated staff 身份。通用 Snippet 写入被只读 permission policy 阻断，主图字段也不出现在通用原型表单中。

## 7. 图片处理

seed 从共享描述动态生成小 PNG，计算 SHA-256 与 64 位平均哈希，再写入 Wagtail Images；生成媒体只存在于临时运行目录。Wagtail rendition 测试实际创建、删除并重建了 `max-24x24` rendition，证明原图与可重建预览分离。

主图只能由 staff 审核服务从已经归属该原型且存在本地 media 的候选图片中选择；选择新主图会清除该原型原有的 `selected_as_main` 标志。受保护图片的候选重采差异不会修改图片记录 ID、storage key、哈希、原 URL、media ID 和正式主图引用。来源失效测试也证明正式条目仍发布、本地主图文件仍存在。共享 Python client 只传输图片元数据，没有把候选文件端到端导入 Wagtail Images；因此“已有本地 media 可审核”已验证，“候选文件导入管线”未验证。

默认使用 `FileSystemStorage`。可选配置把同一 Django Storage API 边界切换到 `storages.backends.s3.S3Storage`，并验证两个 backend 都实现 Django `Storage` 合同；本轮没有提供 S3 凭据、没有连接对象存储，云连接数为 0。因此这里验证的是配置和抽象边界，不是实际云端读写或迁移。

## 8. merge/split/undo

`merge_prototypes`、`split_prototype` 和 `undo_last_operation` 都使用 `transaction.atomic`、行锁和 OperationLog。merge 会迁移版本、来源、候选及候选图片，保留被合并记录并设为 merged/hidden；split 要求待迁移关系形成完整一致组，新原型不隐式复制主图；undo 会恢复整组关系，并为被撤销操作建立关联审计记录。

自动测试完成了真实的 `merge → split → undo split → undo merge`，恢复版本、来源、候选、图片和候选审核理由。另有测试证明外来或不完整关系组会被拒绝，以及 OperationLog 写入故障时 merge 的关系改动整体回滚。AC-13 与 AC-14 均为 pass。当前 undo 只能撤销全局最新的未撤销 merge/split，没有 reviewer/work-item 作用域，也没有验证并发执行；同时 Admin 没有这些操作的 UI。

## 9. 导出

管理命令可输出单个开放关系 JSON，或 10 张关系表 CSV 加 1 个 `manifest.json`。提交的样本 JSON 为 25,807 bytes，CSV 共 11 个文件；两种输出均已重新解析。导出包含稳定记录 ID、关系 ID、来源 URL、storage key、media ID、SHA-256、感知哈希和审计关系，不包含图片字节、base64 或 data URL，也不依赖 Wagtail 私有备份格式表达业务关系。

字段边界见 [`EXPORT_SCHEMA.md`](../spikes/val02_wagtail/EXPORT_SCHEMA.md)。AC-22 和 AC-23 均为 pass。

## 10. 前台

最小前台实现了中央角色搜索、标准名/别名精确匹配、唯一匹配直达、同名角色按作品消歧、角色大标题、每个原型一张主图、多人轻量标记、每页 16、成人主图默认隐藏，以及桌面/平板/手机 4/3/2 列。模板输出图片固有宽高，CSS 使用 `height: auto` 与 `object-fit: contain`，版本不会产生重复图库卡片。

服务端 HTTP/DOM 测试覆盖别名重定向、同名消歧、多人原型从任一角色可见、相似动作不同厂商保持两个条目、四个版本只显示一个原型、成人开关、来源失效和稳定分页。灯箱源码包含打开、关闭、缩放及只基于当前页卡片集合的上一张/下一张，并且没有下载按钮；但这些灯箱交互只完成静态 DOM/JavaScript 替代检查，未取得真实 Chrome 点击证据。

## 11. 测试结果

- Django 测试：52/52 通过，失败 0。
- 共享合同测试：48/48 通过，失败 0。
- 统一 30 项验收：29 pass、0 fail、1 not_run；唯一 not_run 为 AC-29。
- AC-01—AC-28 与 AC-30 均由映射的真实测试结果生成，不是手写“全部通过”；共享结果文件还记录实际源文件 digest。
- `acceptance-results.json` 当前为 18,976 bytes，SHA-256 为 `03f5543263c0ab4104e8ac4e3e779bf345f799041f8cc21be28bfa4001368223`，与最终验证摘要一致；其中共享 fixture SHA-256 为 `3ff832622a8b9d4244ec39fc70668c270cb78204ca975004941761ddb9df9529`，当前实现/测试源文件 digest 为 `89b09dc4d3fa7b9a9a9dacd40eebb6eb9cb25796b425441526b2c21e18a409ee`。
- 已执行并通过的可运行检查包括 `pip check`、Django system check（带下述警告）、migration check、全新 migrate、首次/重复 seed、52 项测试、`collectstatic`、验收生成、单份共享 validator 重算、JSON/CSV 解析、本地启动/HTTP smoke、候选权限/主图攻击/非 loopback 攻击检查、受保护媒体不可变性、rendition、事务回滚和 Hpoi 进程网络 guard。Hpoi 请求数为 0，真实图片使用为 false。

机器结果：[`acceptance-results.json`](../spikes/val02_wagtail/acceptance-results.json)；汇总：[`wagtail-validation-summary.json`](evidence/val02/wagtail-validation-summary.json)。

## 12. 失败项

统一验收没有 `fail`，但有以下未执行或警告，不能写作通过：

1. **AC-29：not_run。** 选定的 Chrome profile 没有控制扩展，native host 也不可用，因此没有执行灯箱点击、上一张/下一张及页首/页尾边界的真实浏览器交互。对应静态 DOM/JavaScript 合同测试通过，但只作为替代证据，不等同于浏览器结果。
2. **两条未静默的 `treebeard.E001`。** Wagtail 7.4.2 当前解析到 django-treebeard 5.3.0，检查警告 Wagtail 生成的 manager 与未来 Treebeard 6 的兼容风险。当前 migration、seed、revision/workflow、rendition、后台和前台测试仍通过；升级前必须重新验证。

验证中还发现并修复了两项本地问题：Wagtail filesystem storage 的 location 从 `pathlib.Path` 改为字符串，使 Windows 上重复 seed reset 可用；共享 Python client 对 loopback 禁用环境代理，避免本机代理截获，并加入回归测试。这两项不再是最终验收失败。端口 8000 被无关进程占用时，验证改用了空闲 loopback 端口。

本轮加固的第一次 acceptance 命令指向一个尚未执行 migration 的全新隔离运行目录，因缺少 `gallery_work` 表失败；随后在另一个已确认不存在的全新目录执行完整 migrate 和两次成功 reset seed，再生成最终通过结果。一次 PowerShell HTTP 计时探针也因未先加载 `System.Net.Http` assembly 而没有产生有效 HTTP 观察；修正后明确禁用代理并取得 5 次 HTTP 200。两次失败均没有被描述为通过，最终数值只来自修正后的命令。

S3 实际连接、云端迁移和生产拓扑没有执行，这是任务范围限制，不应被描述为已经通过。

## 13. 自定义工作量

最终物理行数统计为：自定义实现 2,904 行（21 个 Python/HTML/CSS/JS 文件，不含测试、migration 和生成文件），测试 1,499 行（4 个测试模块），其中后台 UI 定制 220 行（`forms.py`、`wagtail_hooks.py` 与审核模板）。另有 2 个项目 migration 文件、3 个直接依赖。

Wagtail 实际减少的工作是 Images/rendition、Django Storage、管理后台外壳、Snippet 列表，以及非 Page revision/draft/workflow 的基础设施。仍需自建的部分包括整个关系领域模型、候选与正式数据隔离、逐字段决定、候选审核页、主图写保护、跨记录 merge/split/undo、OperationLog、候选 API、开放导出和极简前台。非 Page revision/workflow 的真实调用已通过测试，但它不能替代跨记录事务与可撤销审计。当前 220 行审核定制只能证明最小工作台成立，不能证明高频审核体验已经足够。

## 14. 已知风险

- AC-29 缺少真实浏览器交互证据；响应式列数、原比例和灯箱当前主要由服务端/静态合同测试支撑。
- Treebeard 的未来主版本兼容警告仍开放，升级 Wagtail 或 django-treebeard 前必须重跑 system check、migration、workflow 和后台测试。
- SQLite、单进程 runserver 和小型合成 fixture 只证明本地原型路径；没有验证并发审核、数据量增长、任务队列、生产数据库或多实例一致性。
- S3 只验证 Storage API/配置边界，未验证真实凭据、对象存储 I/O、既有媒体迁移、签名 URL 或故障恢复。
- 共享 candidate client 只传元数据，没有完成候选文件到 Wagtail Images 的端到端导入；单一共享 Token 也没有 per-client owner/权限隔离。
- `decide_candidate_field` 信任 staff 显式选择 `target_prototype_id`，未强绑定候选既定 target；正式权限模型需约束可选目标并防止跨审核工作项误写。
- 非 Page workflow 仅验证 revision round-trip、publish 和一次 workflow start；没有验证完整多人审批、队列效率或长期升级成本。
- merge/split/undo 已覆盖统一合成关系和事务失败，但 undo 只能针对全局最新操作，且没有证明任意大规模关系图、并发冲突或跨外部系统恢复。
- 管理后台虽然把通用表单设为只读并集中到审计服务，但没有 merge/split/undo、厂商生命周期或 settings 控件，仍需在正式设计前验证操作效率、权限角色拆分和浏览器可访问性。
- 本报告仅记录 Wagtail spike 的阶段性实测结果，不选择最终技术栈，不把该目录提升为正式项目，也不包含部署结论。
