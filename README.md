# Figure Gallery（手办图库）

Figure Gallery 是一个以“角色—官方手办原型—主图”为核心的 Cos 动作参考图库：多来源资料先进入候选池，经人工审核后，才成为可审计、可迁移的正式数据和公开只读图库。

## 当前状态

PR-00 正式工程基线和 PR-01 核心目录模型均已进入 `main`，对应 Formal web CI 已通过。来源/候选池、审核工作流、正式媒体与主图、merge/split/undo、公开搜索和图库仍未实现。

**personal gallery MVP-02 柴郡覆盖补齐已完成本机验收**：`tools/personal-gallery-mvp/` 是一个可删除、只在本机运行、与正式应用完全隔离的个人拍摄参考工具。当前柴郡图库收录 7 个第一阶段静态/比例手办商品卡片和 56 个字节不同的本地图片对象；6 个商品有本地图，APEX 商品页公开列出的 3 个图片 URL 当前返回 HTTP 404，故只保留条目和失败记录。系统 Google Chrome 的真实 loopback-only 验收已通过；这 7 个条目不把 Hpoi 中的黏土人、可动、盲盒/Q 版、GK、抱枕等非第一阶段类别计入，也尚未做感知去重。正式 PR-02—PR-08 路线继续暂停但不删除；MVP 不是正式 Candidate、Review 或 Media 实现，也不会把自动数据写入正式目录。

已接受的技术底座：

- Payload CMS `3.87.x`、Next.js `16.2.x`、React `19.2.x`、TypeScript、Node.js `22.x`；
- PostgreSQL 16 作为正式业务数据库；
- S3 兼容对象存储，以稳定 `storageKey` 建立业务关系；
- npm、`package-lock.json`、ESLint、TypeScript typecheck、Vitest、Playwright 和 GitHub Actions；
- 目标生产输出为 `.next/standalone`；PR-00 为正式骨架重新建立 CI 与本地 clean-start 验证，但不执行部署。

上述 `x` 表示已接受的兼容版本线，不代表任意补丁可免审升级。当前精确基线是 Payload `3.87.1`、Next.js `16.2.11`、React `19.2.7`、React DOM `19.2.7` 与 Sharp `0.35.3`；采用其他补丁前须通过独立依赖升级和生产门禁。

## 第一阶段

第一阶段面向两类用户：管理员维护作品、角色、厂商、手办原型、版本、来源、候选图片和审核操作；公开访客按角色搜索并浏览每个手办原型的一张人工主图。

范围包括候选客户端受限接入、人工审核、主图保护、merge/split/指定 undo、搜索与同名消歧、分页图库、响应式灯箱、成人图片后台控制，以及 JSON/CSV/媒体 manifest 导出、PostgreSQL 和 S3 兼容存储。

第一阶段不包含用户账号、评论、收藏、投稿、交易、价格或发售提醒、前台下载、AI 内容生成、原画图库、自动外部采集和云部署。

## 仓库目录

- `apps/web/`：由 Payload 官方脚手架干净生成的正式集成应用；PR-01 在此加入目录 Collection、领域命令端点、Catalog Operations 与 migration。
- `packages/domain-contracts/`：框架无关的 PR-01 枚举、命令、DTO、规范化和不变量。
- `packages/test-fixtures/`：只含完全虚构、可幂等重放的 PR-01 目录 fixture；不含图片或外部 URL。
- `packages/candidate-client/`、`packages/media-contracts/`：后续阶段边界；PR-01 未实现其业务能力。
- `infra/`：本地/CI 非生产配置、脚本和示例；不保存生产凭据或部署状态。
- `docs/`：正式产品蓝图、架构、安全、运维和交付计划。
- `research/`：历史研究结论与验证报告，不作为运行时输入。
- `research/evidence/`：小型、必要、脱敏的历史证据。
- `spikes/`：可丢弃技术验证，永远不得进入正式依赖图。
- `tools/personal-gallery-mvp/`：独立、可删除的个人图库 MVP；不属于 `apps/web` dependency、正式构建上下文或正式数据边界。

正式目录规划见 [系统架构](docs/SYSTEM_ARCHITECTURE.md)。`apps/web` 的脚手架来源见 [PR-00 脚手架溯源](docs/PR00_SCAFFOLD_PROVENANCE.md)。**不要复制、移动、改造或导入 `spikes/`；它们不属于正式 workspace、构建上下文或运行时依赖。**

## 权威文档

- [产品需求](docs/PRODUCT_REQUIREMENTS.md)
- [系统架构](docs/SYSTEM_ARCHITECTURE.md)
- [领域模型](docs/DOMAIN_MODEL.md)
- [安全边界](docs/SECURITY_BOUNDARIES.md)
- [媒体生命周期](docs/MEDIA_LIFECYCLE.md)
- [运维与恢复](docs/OPERATIONS_AND_RECOVERY.md)
- [交付路线](docs/DELIVERY_ROADMAP.md)
- [正式初始化计划](docs/FORMAL_INITIALIZATION_PLAN.md)
- [PR-00 脚手架溯源](docs/PR00_SCAFFOLD_PROVENANCE.md)
- [PR-01 核心目录实现](docs/PR01_CORE_CATALOG_IMPLEMENTATION.md)
- [PR-01 业务身份实现](docs/PR01_IDENTITY_IMPLEMENTATION.md)
- [MVP-01 个人自动手办图库](docs/MVP01_PERSONAL_AUTO_GALLERY.md)
- [MVP-02 柴郡官方来源图库](docs/MVP02_CHESHIRE_OFFICIAL_GALLERY.md)
- [需求追踪矩阵](docs/TRACEABILITY_MATRIX.md)
- [技术决策 ADR](research/TECH_STACK_DECISION.md)

## 来源与 Hpoi 边界

Hpoi 当前只可作为人工参考；在 personal gallery MVP 中也已经因连续 captcha 阻塞而冻结为 `blocked_by_source`，`retryAllowed=false`。MVP-02 不重试 Hpoi、不访问缓存或镜像，也不尝试规避；正式应用、MVP-02 和 CI 的 Hpoi 请求数必须保持 0。MVP-02 仅在项目所有者主动开启独立官方来源实时门禁后，使用 Firecrawl v2 Search（明确排除 Hpoi）和 `scrape` 访问受审查 allowlist 内的公开厂商商品页；AmiAmi 只允许明确、逐页审核的 seed，不会由搜索结果自动扩展。工具不使用 crawl、Agent、浏览器动作、增强代理、Cookie 或登录。会员购仍只作人工补充与核验，不自动访问。所有未来正式来源数据必须先进入候选池，不能自动覆盖正式数据或正式主图。

## 开发状态

PR-00、PR-01、personal gallery MVP-01 与 MVP-02 柴郡覆盖补齐均已完成本机验证；MVP-02 的真实首轮、第二轮幂等及系统 Chrome 验收以 `research/evidence/mvp02/personal-gallery-results.json` 为准，不能由合成 CI fixture 代替。项目所有者可先把本地图库用于拍摄准备；正式 PR-02—PR-08 仍暂停，正式 PR-02 尚未开始。正式变化必须使用任务独立分支和独立 PR；未经明确授权不得合并或部署。恢复任何路线仍需新的明确授权。
