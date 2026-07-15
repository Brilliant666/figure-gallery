# Figure Gallery 安全边界与威胁模型

## 1. 目标、适用范围与硬不变量

本文件定义第一阶段正式系统的认证、授权、数据隔离、媒体和外部网络边界。安全控制必须由服务端、数据库约束和领域服务共同执行；隐藏按钮、仅监听 loopback、客户端约定或 Payload 默认 Admin 均不能代替授权。

硬不变量：候选身份不能写正式数据或主图；Client A 不能读写 Client B 的非公开候选；所有正式变化均经过领域服务、原子事务、乐观锁和 `OperationLog`；来源或候选变化不能删除正式主图；上传失败不能产生正式记录或虚假成功日志；Hpoi 自动请求必须为 0。任一不变量失败即停止对应 PR。

## 2. 资产、信任区与参与者

受保护资产包括：正式目录及关系、正式主图和原图、候选及未发布媒体、ReviewWorkItem 决定、OperationLog、SystemSetting、CandidateClient 凭据摘要、数据库/对象备份、运行时 secret 和个人可识别的管理员审计信息。

信任区分为匿名公开面、候选接入面、管理员面、领域服务、PostgreSQL、S3 兼容存储和运维/备份面。跨区调用必须有独立认证、服务端授权和审计；数据库与对象存储不得直接暴露公网。

| Actor | 认证 | 最小授权 | 明确禁止 |
| --- | --- | --- | --- |
| 匿名访客 | 无会话 | 读取服务端过滤后的公开搜索、图库和允许媒体 | 候选、来源、版本、审计、设置、原始导出和成人隐藏内容 |
| CandidateClient | 独立 bearer token；服务端只存 hash | 自己 owner 下的 candidate upsert、候选媒体 multipart 上传和幂等结果查询 | 正式实体、主图、审核、设置、他人候选、通用 CRUD |
| Admin | Payload 管理员会话；首版只有一个 Admin 角色，可有多个独立同角色账号 | 在审核、目录维护、设置和运维动作上下文中调用各自受控服务 | 任意目标写入、通用正式保存、绕过事务/日志、读取明文 client token |
| 后台任务 | 工作负载身份和单一用途权限 | 派生图、完整性审计等明确任务 | 自动选择主图、自动发布、自动删除正式对象、外部采集 |

## 3. 认证与授权要求

**SEC-001 — 默认拒绝。** 每个 REST、GraphQL、Local API、Admin action、custom endpoint 和后台任务都必须显式声明 actor、动作与资源；未声明、未认证、错误角色和资源不匹配均拒绝。

**SEC-002 — 管理员会话。** 管理员身份使用 Payload 正式认证机制和安全 Cookie；首版只实现一个 Admin 角色，可创建多个独立同角色账号以支持归因和并发，审核/目录/设置/运维是动作上下文而不是可配置 RBAC。生产要求 HTTPS、`HttpOnly`、`Secure`、适当 `SameSite`、CSRF 防护、会话过期和登录限速。不得硬编码管理员或共享账号；多管理员角色与 MFA 只作未来预留。

**SEC-003 — 服务端资源授权。** 授权以当前数据库身份、owner、ReviewWorkItem allowed targets 和 lock version 为准，不信任请求中的 role、owner、prototype ID、转发 IP 或 UI 隐藏状态。

**SEC-004 — 生产 GraphQL。** 生产关闭 GraphQL introspection；正式 collection mutation 对候选和匿名身份不可达。关闭 introspection 不是授权控制，直接已知 mutation 仍必须由 resolver/access/hook 拒绝。

**SEC-005 — 领域写边界。** Work、Character、Manufacturer、FigurePrototype、FigureVersion、正式媒体关系、SystemSetting、ReviewWorkItem 完成、merge/split/undo 只能调用受控领域 service。generic REST/GraphQL/Local API/Admin save 即使由管理员调用也不得绕过同一事务与 OperationLog。

## 4. CandidateClient 凭据生命周期与 owner 隔离

**SEC-006 — 创建。** 每个 client 独立生成至少 256 bit 随机 token；明文只在创建响应/受控终端显示一次，不写 Git、日志、Artifact、数据库或前端存储。数据库只保存带版本和 salt 的单向 KDF/hash、client ID、状态、创建/轮换/撤销时间及最小 scope。

**SEC-007 — 校验。** 服务端以恒定时间比较摘要，同时验证 active 状态、scope、到期/撤销时间；无 token、格式错误、错误 token、disabled、revoked 或过期 token 使用一致的非泄露式拒绝响应。日志只记录 client ID 和失败类别。

**SEC-008 — 停用、轮换与撤销。** `disabled` 是 Admin 可明确恢复的临时停用；`revoked` 不可逆。轮换在同一受控命令中生成新 token 并令旧 token 立即失效，明文新 token 只在该响应显示一次；第一阶段不使用重叠窗口。泄露处置必须支持停用或撤销单个 client，而不影响其他 client。Admin 人工录入使用不可认证、无 API scope 的 internal-manual owner 身份，不通过共享 Token 冒充外部 client。

**SEC-009 — owner。** CandidateRecord、CandidateImage、upload/command receipt 和幂等键均绑定 client owner。服务端从认证上下文写 owner，忽略/拒绝请求 owner；查询、更新、重试和候选关系不得跨 owner，除非 Admin 通过明确、审计的迁移动作。SourceRecord 使用全局稳定来源键，并保存不可变的首次发现 client 作为归因；client 只能通过自己的 CandidateRecord 解析/引用该全局身份，不能直接修改 SourceRecord、读取其他 client 的候选或取得首次发现者的私有数据。

**SEC-010 — 最小 API。** 候选客户端只获得 candidate upsert、候选媒体上传和自己的只读 sync/idempotency 结果查询；sync result 由服务端聚合 upsert/upload 收据，不增加第三种客户端写命令。client 不能调用正式写、审核、主图、设置、导出、操作撤销或通用 collection CRUD。

## 5. 候选与正式数据隔离、主图保护

**SEC-011 — 聚合隔离。** 外部/离线输入先写 Candidate aggregate。候选字段不得直接映射到正式 collection save；审核接受是新的人工领域命令，而不是把候选对象“改名”为正式对象。

**SEC-012 — 审核目标。** 每个 ReviewWorkItem 保存 allowed target 集合、审核人和 lock version。正式目标必须在允许集合内，或通过明确“新建正式原型”动作原子创建；完成后的普通入口锁定，reopen 新增审计。

**SEC-013 — 主图保护。** 主图选择要求授权人工、当前工作项、已经验证并提升的正式媒体、匹配目标和显式理由。candidate endpoint、同步任务、通用媒体 CRUD、来源更新和重采集都不能设置、清空或替换主图。

**SEC-014 — 原子与并发。** 正式关系、lock version 和 OperationLog 在同一 PostgreSQL 事务中提交；后提交者遇到明确 409/领域冲突。merge/split/undo 使用稳定 operation ID、scope、version 和 dependency，不允许“全局最近一次”或静默覆盖。

## 6. 上传、对象存储与失败补偿

**SEC-015 — 输入验证。** multipart 端点限制请求体、文件数、单文件大小、像素尺寸和解码资源；只允许配置的 PNG/JPEG。服务端核对扩展名、声明 MIME、magic bytes、完整解码、尺寸和实际字节哈希，拒绝 polyglot、路径名、SVG/脚本、压缩炸弹及不一致元数据；文件名永不直接成为 storage key。

**SEC-016 — 安全存储。** 服务端生成不可猜测且稳定的 `storageKey`，bucket 默认私有，访问使用短期签名或受控代理；上传内容不在应用源目录执行。SHA-256 是内容身份，aHash 仅作人工相似提示，不作安全或唯一性判断。

**SEC-017 — 补偿与清理。** 采用“验证临时对象→数据库候选事务→提交/提升”的明确状态机。对象写成功但数据库失败时记录可重试补偿；数据库不得引用未确认对象。清理只处理超过窗口且无引用的候选对象；正式主图及其原图永不因来源/候选删除级联删除。missing/orphan 默认只报告。

**SEC-018 — 媒体响应。** 响应设置正确 `Content-Type`、`Content-Disposition: inline`、`X-Content-Type-Options: nosniff` 和缓存策略；不提供前台下载端点，不把 bucket 凭据、内部 key 前缀或候选原图 URL 暴露给匿名用户。

## 7. Hpoi 与外部来源硬门禁

**SEC-019 — Manual-only。** Hpoi 及其所有子域只能由项目所有者在普通浏览器中人工参考；正式应用、后台任务、测试、链接预览、图片代理、健康检查和 Source Adapter 均不得请求。人工粘贴 Hpoi URL 只保存文本，不解析、不 unfurl、不 DNS 解析、不下载图片。

**SEC-020 — Network guard。** 应用 HTTP 客户端、DNS/URL 验证、测试 transport 与可控网络出口共同拒绝 `hpoi.net`、任意子域、大小写/尾点/IDN/重定向和解析后地址绕过；发现尝试立即失败并记录不含 URL 查询秘密的安全事件。未经明确书面许可、独立任务和安全评审，不得解除。

其他外部来源同样不得使用 Cookie、私人 Token、验证码规避或反自动化绕过。第一阶段自动外联默认关闭；只有明确许可的离线文件或未来授权 adapter 才能进入候选池。

## 8. 威胁模型

| 威胁 | 攻击路径 | 必须控制 | 主要残余风险 |
| --- | --- | --- | --- |
| 凭据泄露/重放 | 日志、Git、浏览器存储、长期 token | hash-only、一次展示、mask、轮换/撤销、限速、最小 scope | 被盗 token 在撤销前可写其 owner 候选 |
| IDOR/跨 owner | 篡改 candidate/source/media ID | 认证上下文 owner 查询、复合约束；Source ID 只能在 owner 候选命令内解析且无 client 直接端点；攻击回归 | 管理员显式迁移流程实现错误 |
| 候选越权正式写 | REST/GraphQL/Local API/Admin/custom endpoint | 默认拒绝、领域 service、hook、事务和状态不变量 | 框架/插件升级重新开放通用 CRUD |
| 审核越界/并发覆盖 | 篡改 target、重复提交、旧 lock version | allowed targets、乐观锁、幂等命令、409 冲突 | 复杂多人操作链 |
| 主图丢失 | 来源/候选删除、清理任务、对象故障 | 正式引用保护、延迟清理、manifest、恢复合同 | 跨区域灾难未在首阶段验证 |
| 恶意上传 | 伪 MIME、巨图、脚本、多格式文件 | magic/decode/limits、私有对象、nosniff、资源隔离 | 图像库新漏洞 |
| SSRF/自动采集 | 粘贴 URL、预览、重定向、DNS rebinding | 不自动取 URL、域名/解析 guard、出口策略 | 新增插件暗含网络请求 |
| 审计篡改 | generic save/delete、日志缺失 | append-only 权限、同事务写、备份、完整性测试 | 高权限数据库人工操作 |
| 数据泄露 | 导出、错误日志、备份、签名 URL | 字段 allowlist、短期 URL、脱敏、访问审计 | 运维误配置 |
| 供应链 | npm Action/包、构建脚本 | lockfile、固定 Action SHA、依赖审查、最小 workflow 权限 | 上游受信包被攻陷 |

## 9. 必跑攻击回归矩阵

| ID | 攻击 | 期望结果与不变量 | 首次引入 PR |
| --- | --- | --- | --- |
| ATK-01 | 无、错误、撤销/禁用 token 调候选 API | 401/403；候选、正式状态和日志无成功变化 | PR-02 |
| ATK-02 | Client A 读写 Client B 候选/媒体/receipt | 拒绝且不泄露存在性；owner 不变 | PR-02 |
| ATK-03 | 候选身份写 Prototype/Version/Setting/主图 | 所有 surface 拒绝；正式 digest、主图、成功日志不变 | PR-02/PR-04 |
| ATK-04 | 绕过专用 endpoint 使用 generic REST CRUD | access/hook 拒绝 | PR-02 |
| ATK-05 | 直接 GraphQL 正式 mutation；尝试 introspection | mutation access denied；生产 introspection 关闭 | PR-02/PR-08 |
| ATK-06 | Local API `overrideAccess`、custom endpoint 或 Admin generic save | 不能绕过领域 service；无未审计正式变化 | PR-01—PR-05 |
| ATK-07 | 越界 ReviewWorkItem target、完成后修改 | 拒绝；工作项、目标和日志一致 | PR-03 |
| ATK-08 | 两管理员用同一旧 lock version 提交 | 仅一人成功，另一人明确冲突 | PR-03/PR-05 |
| ATK-09 | 撤销有后续依赖的前置 merge | 明确拒绝或测试覆盖的级联；关系不断裂 | PR-05 |
| ATK-10 | 非图片、超限、MIME/magic 不符、解码失败、重复/中断上传 | 拒绝或幂等重试；无半成品正式记录/成功日志 | PR-02/PR-04 |
| ATK-11 | MinIO/S3 中断期间上传、读图、提升 | 可控失败；主图不变；恢复后重试幂等 | PR-04 |
| ATK-12 | 来源失效/删除、候选删除、清理任务 | 正式主图引用和对象保持 | PR-04 |
| ATK-13 | URL 混淆、重定向、DNS/子域形式尝试访问 Hpoi | transport 前拒绝；实际 Hpoi 请求为 0 | PR-00 起持续 |
| ATK-14 | 匿名绕过 adult/publicRead server filter 或缓存污染 | 隐藏内容不返回；设置维度缓存隔离 | PR-06 |
| ATK-15 | 恢复后重复 ATK-01—14 核心攻击 | 与恢复前相同拒绝；数据/关系/主图差异 0 | PR-07/PR-08 |

每个攻击测试必须同时比较正式数据 digest、主图引用和成功 `OperationLog`；仅断言 HTTP 状态不足以证明安全。

## 10. Secret、日志、备份与运行边界

- 所有 secret 只从运行时 secret 管理边界注入；不得写 `.env`、Git、构建输出、截图或普通 Artifact；
- 结构化日志允许 actor/client ID、request ID、operation ID、资源类型、结果和错误类别；禁止 token、Cookie、Authorization、密码、数据库 URI、签名 URL、文件字节和完整候选快照；
- 导出和备份最小权限、加密传输/静态加密、访问审计和保留策略必须在部署前明确；普通产品导出不含 token hash；
- 工作流权限保持只读，第三方 Action 禁止或需固定来源与 commit SHA；不使用 `pull_request_target` 执行不可信代码；
- 依赖、schema、授权 hook、GraphQL、存储 provider 或 standalone 变化后，必须重跑完整攻击矩阵和恢复后回归。

## 11. 验收、追踪与参考

- 安全要求在 [需求追踪矩阵](TRACEABILITY_MATRIX.md) 映射到 PR、实现面、测试与风险；
- 任一候选正式越权、跨 owner、主图丢失、关系断裂、恢复不一致或 Admin/CRUD 审计旁路为硬失败；
- 详见 [产品需求](PRODUCT_REQUIREMENTS.md)、[交付路线](DELIVERY_ROADMAP.md)、[技术 ADR](../research/TECH_STACK_DECISION.md) 与 [Hpoi 门禁](../research/HPOI_TRANSPORT_GATE.md)。
