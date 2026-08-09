# Figure Gallery（手办图库）

Figure Gallery 是一个以角色为入口、以独立手办造型为核心实体的二次元拍摄姿势数据库：系统尽可能自动发现正版手办、静态完成品和景品，再以“一种独立造型一张完整参考封面”的方式提供多角度拍摄参考。完整手办数据库与拍摄姿势资料库是同一产品能力。

## 当前状态

PR-00 正式工程基线和 PR-01 核心目录模型均已进入 `main`，对应 Formal web CI 已通过。来源/候选池、审核工作流、正式媒体与主图、merge/split/undo、公开搜索和图库仍未实现。

**personal gallery MVP-05 自动发现覆盖验证已完成**：`tools/personal-gallery-mvp/` 仍是可删除、只在本机运行、与正式应用完全隔离的个人拍摄参考工具。第三方搜索索引自动得到柴郡 3 个、蕾姆 35 个 Hpoi indexed candidates，并完成范围判断、已有商品匹配和非 Hpoi 官方来源反查；Hpoi 直连请求为 0。真实索引信号精度和官方解析命中率不足，本轮未增加商品，图库保持柴郡 7 款/65 图、蕾姆 11 款/89 图；Hpoi-index 当前是补充 coverage 信号，不能单独替代 broad official search。每个临时 ProductRecord 仍只是一条来源级展示记录，**不等于最终 `FigurePrototype`**；本轮不自动合并普通版、再版或重复来源。

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
- [产品北极星](docs/PROJECT_NORTH_STAR.md)
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
- [MVP-03A 柴郡拍摄参考索引](docs/MVP03A_SHOOTING_REFERENCE_INDEX.md)
- [MVP-04 多角色图库泛化](docs/MVP04_MULTI_CHARACTER_GENERALIZATION.md)
- [MVP-05 Hpoi 搜索索引发现](docs/MVP05_HPOI_INDEX_DISCOVERY.md)
- [需求追踪矩阵](docs/TRACEABILITY_MATRIX.md)
- [技术决策 ADR](research/TECH_STACK_DECISION.md)

## 来源与 Hpoi 边界

Hpoi 的正式角色是自动发现信号与覆盖率基准，而不是图片或事实权威。经明确授权的 personal gallery 可以让第三方 Firecrawl Search 返回已索引 Hpoi 结果的 URL、标题和摘要文本，但不会请求、解析、预览或跳转这些 URL；Hpoi 的 HTTP、HEAD、DNS、scrape、API、图片和浏览器请求必须全部为 0。正式商品事实与图片只来自受审的非 Hpoi 厂商、品牌、发行方或明确允许的 distributor/retailer。正式 Payload 应用仍没有 Hpoi adapter，未取得明确书面许可前不得建立 Direct Hpoi adapter。工具不使用 crawl、Agent、浏览器动作、增强代理、Cookie、登录或验证码处理。

## 开发状态

PR-00、PR-01 与 personal gallery MVP-01—MVP-05 均已完成对应门禁；MVP-05 的真实候选、零直连、效率限制与 Chrome 结果见 `research/evidence/mvp05/`。当前近期优先级依次是自动发现覆盖率、柴郡/蕾姆补收录、candidate→official source 解析、FigurePrototype 去重证据、图片完整度和封面质量；第三个角色与公网部署暂缓。正式 PR-02—PR-08 仍保留但暂停，正式 PR-02 尚未开始。正式变化必须使用任务独立分支和独立 PR；未经明确授权不得合并或部署。
