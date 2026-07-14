# ADR：手办图库技术底座选择

## 状态

`Proposed — Payload CMS + Next.js`

Payload CMS + Next.js 是项目所有者基于实际后台体验、业务适配程度和既有验证结果确定的当前首选方向；Wagtail 保留为备用方案。由于 PostgreSQL、S3、备份恢复和完整 standalone 生产门禁尚未取得真实通过证据，本状态不是 `Accepted`，也不是最终正式技术选型。

## 决策日期

2026-07-14（Asia/Shanghai）

## 背景

项目需要一套能够表达作品、角色、别名、厂商、手办原型、版本、来源、候选记录和多张候选图片的技术底座。采集数据只能进入候选池；正式字段、版本归属和主图必须经人工审核，所有正式变更必须可审计。merge、split 和 undo 还必须具备稳定操作 ID、作用域、依赖和并发冲突控制。

VAL-02 已用可丢弃原型比较 Wagtail 与 Payload CMS + Next.js。VAL-02B 进一步验证真实浏览器交互、合成文件导入、每客户端身份和 owner 隔离、ReviewWorkItem、并发、指定 undo、最小正式管理入口，以及 PostgreSQL、对象存储、备份恢复和非生产部署门禁。本 ADR 只决定技术方向，不授权把 spike 迁移为正式项目。

## 候选

1. `Payload CMS + Next.js`：当前首选方向；
2. `Wagtail`（Django + Wagtail）：备用方案。

没有把其他框架重新加入本轮，也没有 Fork、复制或导入任何图库仓库作为项目底座。

## 证据

证据基线见 [VAL02B_ACCEPTANCE_SPEC.md](VAL02B_ACCEPTANCE_SPEC.md)、[VAL02B_COMPARISON.md](VAL02B_COMPARISON.md)、[VAL02B_WAGTAIL_RESULTS.md](VAL02B_WAGTAIL_RESULTS.md)、[VAL02B_PAYLOAD_RESULTS.md](VAL02B_PAYLOAD_RESULTS.md) 和 [双端机器校验摘要](evidence/val02b/val02b-pair-summary.json)。

- PR #5 合并时的 VAL-02B 机器结果记录双端均为 **17 pass / 0 fail / 0 not_run / 13 environment_blocked**，当时合同/fixture 哈希一致且 pair valid；
- 双端均在本机 Chrome 中通过管理员登录、完整候选审核、图库灯箱和 4/3/2 响应式布局；Wagtail 审核为 **5,896 ms / 6 clicks**，Payload 为 **1,560 ms / 6 clicks**；
- 双端均通过真实 loopback multipart、SHA-256/aHash、内容去重、非法文件拒绝、失败重试、per-client hash-only 凭据、撤销、owner 隔离、正式数据/主图/generic CRUD 攻击；
- 双端均通过工作项目标范围、乐观锁冲突、稳定 operation ID、无关作用域指定 undo、依赖操作保护和最小审计管理入口；
- VAL-02B 决策基线记录的实现/测试/Admin LOC 为：Wagtail **5,263 / 2,476 / 331**，Payload **6,019 / 2,885 / 641**；本轮 Payload 回归刷新后的对应值为 **6,085 / 2,926 / 641**，见 [`val02b-acceptance-results.json`](../spikes/val02_payload/val02b-acceptance-results.json)，未据此重算历史双端评分；
- Payload 已通过 production build 和本地 standalone smoke，未出现 NFT tracing 警告；Wagtail 已完成本地 `DEBUG=false`、`collectstatic` 和 WSGI/health 补充检查，但完整生产形态均未验证；
- Wagtail 仍有两条可见 `treebeard.E001`，当前通过精确锁定 `django-treebeard==5.3.0`、版本不符 fail closed 和 tree mutation 测试设立升级门禁；
- VAL-02B 当轮九维评分为 Wagtail **79.0/100**、Payload CMS + Next.js **78.5/100**；本次生产门禁没有重跑 Wagtail 或重算双端评分。

在上述 VAL-02/VAL-02B 历史证据之外，本次 Payload 生产门禁判定见 [PAYLOAD_PRODUCTION_GATE_DECISION.md](PAYLOAD_PRODUCTION_GATE_DECISION.md)：

- Docker daemon 在两次无需系统修改的有限重启后仍因 `rpcbind` 崩溃及 CLI 超时不可用；
- 本地 PostgreSQL 与 MinIO 未能启动，PG-01—PG-14 全部为 `environment_blocked`；
- 生产门禁汇总为 **0 pass / 0 fail / 14 environment_blocked**；0 个硬失败不等于生产门禁通过；
- 因关键生产证据全部缺失，Payload 只能保持首选提案，不能更新为正式接受。

本机 Docker daemon、PostgreSQL 和 MinIO/S3 不可用，任务又禁止安装或修改系统服务。因此 BG-17—BG-29 没有执行，不能由 SQLite、本地文件存储、production build 或单机 smoke 冒充通过。三族硬门禁仍未知：

1. PostgreSQL 恢复后数据一致性（BG-22）；
2. 来源删除后对象存储仍保留正式主图（BG-26）；
3. PostgreSQL + S3 完整生产形态从干净环境启动（BG-29）。

## 决策

**`Proposed — Payload CMS + Next.js`**

Payload CMS + Next.js 作为当前首选技术方向继续进入下一次生产门禁验证；Wagtail 作为备用方案保留，不再平行投入同等验证成本。该决策只确定验证和投入优先级，不是 `Accepted`，不代表已经完成最终正式技术选型，也不授权初始化正式项目。

PG-01—PG-14 全部受基础设施阻塞。0 个硬门禁失败只表示没有执行出失败，不表示任何 `environment_blocked` 门禁已经通过。

## 选择理由

1. **项目所有者的实际体验与产品偏好明确指向 Payload。** Payload 的后台结构、交互方式和业务气质更符合项目所有者对图库审核与管理工作的预期；Wagtail 的内容/博客式产品气质不是当前偏好。这是确定验证优先级的有效输入，但不能覆盖生产硬门禁。
2. **既有功能证据支持优先继续 Payload。** Payload 已在 VAL-02/VAL-02B 中通过浏览器审核、候选文件导入、per-client 身份与 owner 隔离、主图保护、工作项范围、冲突、指定 undo、攻击回归、production build 和本地 standalone smoke；这些证据足以支持只对 Payload 补齐生产门禁。
3. **停止双轨投入不等于淘汰 Wagtail。** Wagtail 保留既有结果和备用地位，但不再与 Payload 平行投入同等验证成本；只有 Payload 出现硬失败或方向需要重新评估时，才重新打开 Wagtail 或其他经授权候选。
4. **生产证据仍不足以正式接受。** 本次 Docker daemon 在两次有限重启后仍不可用，PG-01—PG-14 为 0 pass / 0 fail / 14 environment_blocked。PostgreSQL、备份恢复、S3、联合恢复和完整 standalone 均没有实际执行。
5. **0 个硬失败不能外推为通过。** 当前没有观察到生产硬失败，仅因为生产门禁没有运行；在全部 PG 门禁取得真实 `pass` 前，Payload 只能是 `Proposed`，不能是 `Accepted`。

## 被拒绝方案

### Wagtail 不作为当前首选

Wagtail 不是因已发生硬失败而被淘汰。项目所有者更偏好 Payload 的后台结构与交互方式，因此当前不再对 Wagtail 平行投入同等验证成本。Wagtail 的 VAL-02/VAL-02B 历史证据继续保留，它仍是 Payload 出现硬失败时的备用方案；若未来重新启用，还必须处理 PostgreSQL/S3 生产证据和 Treebeard 版本/manager 风险。

### Payload 尚未被正式接受

Payload 是当前首选方向，但仍未被正式接受。PG-01—PG-14 全部 `environment_blocked`，它还必须在真实 PostgreSQL/S3 适配器和完整 standalone 环境中证明 migration、并发和事务、备份恢复关系一致、对象生命周期安全，以及 generic CRUD、Admin 和候选身份不能绕过领域服务。较快的合成浏览器审核和本地 standalone smoke 不能替代完整生产门禁。

“被拒绝”在本 ADR 中仅表示拒绝把对应方案现在写成最终正式选择：Wagtail 保留为备用，Payload 保持首选提案。

## 风险

- Docker daemon 在两次无需系统修改的重启后仍因 `rpcbind` 崩溃或 CLI 超时不可用；在环境修复前，全部生产门禁仍无法取得真实证据；
- PG-01—PG-14 当前均为 `environment_blocked`；0 个硬失败不能降低这些未知项的风险等级；
- SQLite 上的事务、乐观锁和关系操作可能与 PostgreSQL 的真实并发、约束、迁移和回滚行为不同；
- 未执行数据库备份/空库恢复，无法证明关系、OperationLog、ReviewWorkItem、主图和设置在灾难恢复后保持一致；
- 未执行 S3 上传、读取、派生图、服务中断、prefix 迁移和来源删除，正式主图生命周期仍可能存在数据丢失风险；
- 未从 PostgreSQL + S3 的干净环境重复启动完整生产形态，依赖、静态文件、媒体、迁移、health 和 Admin 的组合风险未知；
- Wagtail 的 Treebeard 警告需要持续精确锁版，未来升级可能影响 manager、树变更、workflow 或 migration；
- Payload 的 generic Collections/Admin CRUD、hook 顺序和 adapter 升级可能重新打开绕过领域 service 的路径；
- 浏览器耗时来自单机、单用户、合成 fixture，不代表生产吞吐或长期审核效率；Payload 在反复导航期间记录的 9 次 loopback `ERR_ABORTED` 尚未进一步归因，仍应在下一轮持续观察；
- 两端均未取得可比较的文件导入耗时、冷启动时间、热页面响应、恢复时间和部署步骤数。

## 缓解措施

1. 在已有、可运行且只绑定 loopback 的 Docker/Compose 或等价本地基础设施上，为 Payload 创建独立 PostgreSQL 数据库/schema 和独立 MinIO bucket/prefix；不使用生产账号或云资源，也不为此安装或永久修改系统组件。
2. 对 Payload 逐项重跑 PG-01—PG-14，尤其是 migration 重入、双 seed、真实并发、备份、删库重建、恢复后共享合同、对象中断/恢复、prefix 迁移和来源/候选删除保留主图。
3. 从干净临时目录用 PostgreSQL + S3 的生产模式启动完整 Payload standalone，记录冷启动、health、静态/Admin/媒体读取、进程和步骤，并核对 standalone trace、Sharp 与 NFT 结果。
4. 对数据库备份和对象 manifest 记录哈希、记录数、关系 ID、storage key、SHA-256/aHash 和恢复后差异，不提交备份或对象本体。
5. 保留并扩展跨 owner、正式写入、主图、generic CRUD、并发和 specified undo 攻击回归；任何框架或 adapter 升级都必须重跑。
6. 不继续平行开发 Wagtail；保留其历史证据、Treebeard 风险记录和备用地位，只有 Payload 硬失败或用户明确重新授权时才恢复验证。
7. 只有 PG-01—PG-14 全部真实通过、无硬失败且无关键 `environment_blocked`，才把本 ADR 从 `Proposed` 更新为 `Accepted`；否则继续保持当前状态或在硬失败时重新评估。

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

满足以下条件后重新执行 Payload 生产门禁并评估是否可以正式接受：

1. 本地已有可用 PostgreSQL 和 S3 兼容服务，或已有可运行 Docker/Compose，且无需安装 Docker、修改 Windows 服务或使用真实云资源；
2. Payload 在干净、loopback 的 PostgreSQL + MinIO 环境中完成 PG-01—PG-14，并生成、校验机器可读证据；
3. PG-01—PG-14 全部取得真实 `pass`，没有硬 `fail`，也没有关键 `environment_blocked`；
4. 备份、空库恢复、恢复后共享合同、对象生命周期、联合恢复和完整生产启动证据均可复现；
5. Payload standalone、PostgreSQL/S3 adapter、generic CRUD/Admin/候选身份边界在目标依赖版本上重新验证；
6. 重新统计依赖、进程、导入耗时、冷启动、热响应、备份/恢复时间和部署步骤，确认实际维护成本可接受；
7. 若全部条件满足，可提议把 ADR 更新为 `Accepted — Payload CMS + Next.js`；若出现硬失败，则停止接受 Payload，并重新评估修复路径、Wagtail 备用方案或其他经授权方向。

本 ADR 将 Payload CMS + Next.js 记录为当前首选提案，但尚未完成最终正式技术选型；没有建立正式项目，没有部署云服务器，也没有开始原画图库或 VAL-03。既有 VAL-02B 证据中的 Hpoi 请求为 0，未使用真实手办图片。
