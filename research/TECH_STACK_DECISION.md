# ADR：手办图库技术底座选择

## 状态

`Proposed` —— 当前位于 VAL-02B Draft PR，尚未合并；阶段性技术决策为 `Undecided`。

## 决策日期

2026-07-14（Asia/Shanghai）

## 背景

项目需要一套能够表达作品、角色、别名、厂商、手办原型、版本、来源、候选记录和多张候选图片的技术底座。采集数据只能进入候选池；正式字段、版本归属和主图必须经人工审核，所有正式变更必须可审计。merge、split 和 undo 还必须具备稳定操作 ID、作用域、依赖和并发冲突控制。

VAL-02 已用可丢弃原型比较 Wagtail 与 Payload CMS + Next.js。VAL-02B 进一步验证真实浏览器交互、合成文件导入、每客户端身份和 owner 隔离、ReviewWorkItem、并发、指定 undo、最小正式管理入口，以及 PostgreSQL、对象存储、备份恢复和非生产部署门禁。本 ADR 只决定技术方向，不授权把 spike 迁移为正式项目。

## 候选

1. `Wagtail`（Django + Wagtail）；
2. `Payload CMS + Next.js`。

没有把其他框架重新加入本轮，也没有 Fork、复制或导入任何图库仓库作为项目底座。

## 证据

证据基线见 [VAL02B_ACCEPTANCE_SPEC.md](VAL02B_ACCEPTANCE_SPEC.md)、[VAL02B_COMPARISON.md](VAL02B_COMPARISON.md)、[VAL02B_WAGTAIL_RESULTS.md](VAL02B_WAGTAIL_RESULTS.md)、[VAL02B_PAYLOAD_RESULTS.md](VAL02B_PAYLOAD_RESULTS.md) 和 [双端机器校验摘要](evidence/val02b/val02b-pair-summary.json)。

- 双端均为 **17 pass / 0 fail / 0 not_run / 13 environment_blocked**，合同/fixture 哈希一致且 pair valid；
- 双端均在本机 Chrome 中通过管理员登录、完整候选审核、图库灯箱和 4/3/2 响应式布局；Wagtail 审核为 **5,896 ms / 6 clicks**，Payload 为 **1,560 ms / 6 clicks**；
- 双端均通过真实 loopback multipart、SHA-256/aHash、内容去重、非法文件拒绝、失败重试、per-client hash-only 凭据、撤销、owner 隔离、正式数据/主图/generic CRUD 攻击；
- 双端均通过工作项目标范围、乐观锁冲突、稳定 operation ID、无关作用域指定 undo、依赖操作保护和最小审计管理入口；
- Wagtail 当前实现/测试/Admin LOC 为 **5,263 / 2,476 / 331**；Payload 为 **6,019 / 2,885 / 641**；
- Payload 已通过 production build 和本地 standalone smoke，未出现 NFT tracing 警告；Wagtail 已完成本地 `DEBUG=false`、`collectstatic` 和 WSGI/health 补充检查，但完整生产形态均未验证；
- Wagtail 仍有两条可见 `treebeard.E001`，当前通过精确锁定 `django-treebeard==5.3.0`、版本不符 fail closed 和 tree mutation 测试设立升级门禁；
- 本轮九维新评分为 Wagtail **79.0/100**、Payload CMS + Next.js **78.5/100**。

本机 Docker daemon、PostgreSQL 和 MinIO/S3 不可用，任务又禁止安装或修改系统服务。因此 BG-17—BG-29 没有执行，不能由 SQLite、本地文件存储、production build 或单机 smoke 冒充通过。三族硬门禁仍未知：

1. PostgreSQL 恢复后数据一致性（BG-22）；
2. 来源删除后对象存储仍保留正式主图（BG-26）；
3. PostgreSQL + S3 完整生产形态从干净环境启动（BG-29）。

## 决策

**`Undecided`**

本轮不选择 Wagtail，也不选择 Payload CMS + Next.js。0 个硬门禁失败只表示已执行项没有观察到失败，不表示三个 `environment_blocked` 硬门禁族已经通过。

## 选择理由

1. **核心生产证据不足。** 13/30 门禁受阻，占 43.3%，且全部集中于 PostgreSQL、备份恢复、S3 和完整生产启动；这些正是实际维护和数据安全最难由 SQLite 或本地文件推断的部分。
2. **硬门禁仍未知。** 数据库恢复一致性、对象生命周期与干净生产启动任一失败，都按验收规则直接淘汰对应技术栈；在未执行前不能做乐观推断。
3. **当前分差没有决策强度。** Wagtail 只领先 0.5 分。Wagtail 的较小代码面和 Payload 的更强 standalone 信号分别形成优势，任何一个受阻生产门禁都可能轻易反转排序。
4. **本地功能证据足以保留两端，不足以淘汰或选中一端。** 两端都关闭了候选越权、主图越权、跨 owner、任意审核目标、静默并发覆盖和全局最近一次 undo 等已知缺口。
5. **维护风险仍需在真实适配器上检验。** Wagtail 有 Treebeard 版本/manager 风险；Payload 有 generic CRUD、Admin hooks、Next/Payload/存储适配器组合和更大定制面的升级风险。

## 被拒绝方案

### 当前不选择 Wagtail

Wagtail 不是因已发生硬失败而被淘汰。当前拒绝把它确定为最终技术栈，是因为 PostgreSQL 恢复、S3 正式主图保留和完整生产启动尚未执行；两条 `treebeard.E001` 也仍需通过明确版本锁和升级复验长期管理。较少 LOC 和 Python/Django 贴合度不能替代这些生产证据。

### 当前不选择 Payload CMS + Next.js

Payload 也不是因已发生硬失败而被淘汰。当前拒绝把它确定为最终技术栈，是因为相同的三族生产硬门禁尚未执行；它还需要在 PostgreSQL/S3 适配器和完整 standalone 环境中重新证明 generic CRUD 不能绕过领域服务、备份恢复关系一致、对象生命周期安全。较快的合成浏览器审核和本地 standalone smoke 不能替代完整门禁。

“被拒绝”在本 ADR 中仅表示**拒绝现在做最终选择**，不表示永久排除任一候选。

## 风险

- SQLite 上的事务、乐观锁和关系操作可能与 PostgreSQL 的真实并发、约束、迁移和回滚行为不同；
- 未执行数据库备份/空库恢复，无法证明关系、OperationLog、ReviewWorkItem、主图和设置在灾难恢复后保持一致；
- 未执行 S3 上传、读取、派生图、服务中断、prefix 迁移和来源删除，正式主图生命周期仍可能存在数据丢失风险；
- 未从 PostgreSQL + S3 的干净环境重复启动完整生产形态，依赖、静态文件、媒体、迁移、health 和 Admin 的组合风险未知；
- Wagtail 的 Treebeard 警告需要持续精确锁版，未来升级可能影响 manager、树变更、workflow 或 migration；
- Payload 的 generic Collections/Admin CRUD、hook 顺序和 adapter 升级可能重新打开绕过领域 service 的路径；
- 浏览器耗时来自单机、单用户、合成 fixture，不代表生产吞吐或长期审核效率；Payload 在反复导航期间记录的 9 次 loopback `ERR_ABORTED` 尚未进一步归因，仍应在下一轮持续观察；
- 两端均未取得可比较的文件导入耗时、冷启动时间、热页面响应、恢复时间和部署步骤数。

## 缓解措施

1. 在已有、可运行且只绑定 loopback 的 Docker/Compose 或等价本地基础设施上，为两端创建独立 PostgreSQL 数据库/schema 和独立 MinIO bucket/prefix；不使用生产账号或云资源。
2. 对两端逐项重跑 BG-17—BG-29，尤其是 migration 重入、双 seed、真实并发、备份、删库重建、恢复后共享合同、对象中断/恢复、prefix 迁移和来源删除保留主图。
3. 从干净临时目录用生产模式启动完整服务，记录冷启动、health、静态/Admin/媒体读取、进程和步骤；Payload 继续核对 standalone trace，Wagtail 使用正式 WSGI/ASGI server。
4. 对数据库备份和对象 manifest 记录哈希、记录数、关系 ID、storage key、SHA-256/aHash 和恢复后差异，不提交备份或对象本体。
5. 保留并扩展跨 owner、正式写入、主图、generic CRUD、并发和 specified undo 攻击回归；任何框架或 adapter 升级都必须重跑。
6. Wagtail 继续精确锁定 Treebeard 并 fail closed；仅在上游兼容结论变化且 tree mutation/system check 回归通过后升级。
7. 在生产门禁补齐后重新按九维 100 分评分；只有无硬失败、核心门禁不再大量受阻且出现足以支撑维护的明确优势，才修改本 ADR。

## 正式项目必须遵守的架构约束

即使未来重新评估后选择任一技术栈，正式项目也必须遵守以下约束：

1. 不直接把任一 `spikes/` 原型移动、复制或重命名为正式项目；正式初始化必须是后续明确授权的独立任务。
2. 候选区与正式区保持独立写边界。采集器只能候选 upsert 和候选媒体上传，不能写 Work、Character、Manufacturer、FigurePrototype、FigureVersion、SystemSetting 或正式主图。
3. 每个采集客户端使用独立、可撤销、可归因的凭据；服务端只保存凭据哈希，并强制校验 active 状态和 owner。不得以 loopback、客户端 UI 或隐藏按钮代替授权。
4. 所有正式数据变化必须经过领域 service、原子事务和不可绕过的 OperationLog；通用 Admin/CRUD 只能只读或调用同一受控服务。
5. 审核必须绑定 ReviewWorkItem、allowed targets、审核人和乐观版本。越界目标只能通过显式“新建正式原型”动作原子创建；完成、reopen 和冲突都必须审计。
6. merge、split 与 undo 必须使用稳定 operation ID、作用域、版本和依赖；只能指定撤销安全操作，禁止“全局最近一次”语义和静默覆盖。
7. 媒体身份使用内容哈希与稳定 storage key，不把公开 URL 当业务主键。来源失效或候选删除不得自动删除已经人工确认的正式主图；主图永不由采集器自动替换。
8. 正式数据层采用 PostgreSQL，正式媒体层采用可迁移的 S3 兼容对象存储；本地/对象适配器切换不得改变业务关系 ID 或 storage key 语义。
9. JSON、关系化 CSV 和图片 manifest 必须覆盖 ReviewWorkItem、OperationLog、SystemSetting、关系 ID、storage key、SHA-256 和 aHash，排除图片二进制、明文 token 及不必要的 token digest。
10. 生产形态必须从干净环境执行 migration 后启动，具有 health endpoint、正式 server、静态/媒体/Admin 验证、可重复备份恢复和无硬编码 secret；所有服务最初只绑定 loopback 验证。
11. 真实浏览器回归必须继续覆盖搜索、同名消歧、分页、4/3/2、原比例图片、灯箱边界、成人设置、无下载按钮和无详情面板。
12. Hpoi 或其他外部来源的网络访问必须继续遵守仓库治理：公开、有限、低频、只读，不使用 Cookie/私人 Token，不绕过访问控制；任何来源内容都只能进入候选池。

## 重新评估触发条件

满足以下全部条件后才重新打开技术选型：

1. 本地已有可用 PostgreSQL 和 S3 兼容服务，或已有可运行 Docker/Compose，且无需安装 Docker、修改 Windows 服务或使用真实云资源；
2. 两端在等价的干净基础设施上完成 BG-17—BG-29，并重新生成、校验同合同机器结果；
3. BG-22、BG-26、BG-29 三个受阻硬门禁均取得真实 `pass`，或者某端出现硬 `fail` 并按规则淘汰；
4. 备份、空库恢复、恢复后共享合同、对象生命周期和完整生产启动证据均可复现；
5. Wagtail Treebeard 升级门禁和 Payload standalone/adapter/generic CRUD 边界在目标依赖版本上重新验证；
6. 重新统计 LOC、依赖、进程、审核/导入耗时、冷启动、热响应、恢复时间和部署步骤，并按同一九维规则评分；
7. 胜出方案没有硬失败、核心生产门禁不再大量 `environment_blocked`，且优势足以支持实际长期维护，而不是当前 0.5 分的噪声级差异。

本 ADR 没有选择最终技术栈，没有建立正式项目，没有部署云服务器，没有合并 VAL-02B，也没有开始原画图库或 VAL-03。VAL-02B 全程 Hpoi 请求为 0，未使用真实手办图片。
