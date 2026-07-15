# Figure Gallery（手办图库）

Figure Gallery 是一个以“角色—官方手办原型—主图”为核心的 Cos 动作参考图库：多来源资料先进入候选池，经人工审核后，才成为可审计、可迁移的正式数据和公开只读图库。

## 当前状态

项目处于 **Product blueprint** 阶段。技术决策已经接受，但正式应用尚未初始化；下一步只能按 [正式初始化计划](docs/FORMAL_INITIALIZATION_PLAN.md)执行 PR-00，不得在本轮或从研究原型直接开始产品实现。

已接受的技术底座：

- Payload CMS `3.86.x`、Next.js `16.2.x`、React `19.2.x`、TypeScript、Node.js `22.x`；
- PostgreSQL 16 作为正式业务数据库；
- S3 兼容对象存储，以稳定 `storageKey` 建立业务关系；
- npm、`package-lock.json`、ESLint、TypeScript typecheck、Vitest、Playwright 和 GitHub Actions；
- 当前验证过的生产输出为 `.next/standalone`，正式项目初始化后仍须重建 CI 与部署验证。

上述 `x` 表示已接受的兼容版本线，不代表任意补丁可免审升级。当前生产门禁的精确基线是 Payload `3.86.0`、Next.js `16.2.10`、React `19.2.7`；PR-00 必须锁定精确版本，采用其他补丁前须重跑依赖与生产门禁。

## 第一阶段

第一阶段面向两类用户：管理员维护作品、角色、厂商、手办原型、版本、来源、候选图片和审核操作；公开访客按角色搜索并浏览每个手办原型的一张人工主图。

范围包括候选客户端受限接入、人工审核、主图保护、merge/split/指定 undo、搜索与同名消歧、分页图库、响应式灯箱、成人图片后台控制，以及 JSON/CSV/媒体 manifest 导出、PostgreSQL 和 S3 兼容存储。

第一阶段不包含用户账号、评论、收藏、投稿、交易、价格或发售提醒、前台下载、AI 内容生成、原画图库、自动外部采集和云部署。

## 仓库目录

- `docs/`：正式产品蓝图、架构、安全、运维和交付计划。
- `research/`：历史研究结论与验证报告，不作为运行时输入。
- `research/evidence/`：小型、必要、脱敏的历史证据。
- `spikes/`：可丢弃技术验证，永远不得进入正式依赖图。

正式目录规划见 [系统架构](docs/SYSTEM_ARCHITECTURE.md)。`apps/web` 只能由后续 PR-00 使用 Payload 官方脚手架干净生成；**不要复制、移动或改造 `spikes/` 来启动正式项目。**

## 权威文档

- [产品需求](docs/PRODUCT_REQUIREMENTS.md)
- [系统架构](docs/SYSTEM_ARCHITECTURE.md)
- [领域模型](docs/DOMAIN_MODEL.md)
- [安全边界](docs/SECURITY_BOUNDARIES.md)
- [媒体生命周期](docs/MEDIA_LIFECYCLE.md)
- [运维与恢复](docs/OPERATIONS_AND_RECOVERY.md)
- [交付路线](docs/DELIVERY_ROADMAP.md)
- [正式初始化计划](docs/FORMAL_INITIALIZATION_PLAN.md)
- [需求追踪矩阵](docs/TRACEABILITY_MATRIX.md)
- [技术决策 ADR](research/TECH_STACK_DECISION.md)

## 来源与 Hpoi 边界

Hpoi 当前只可作为人工参考，不得自动访问；未取得明确书面许可前，不得编写正式 Hpoi adapter。会员购和厂商官网也只作人工补充与核验，不自动访问。第一阶段资料只能人工录入、人工粘贴来源 URL、从明确允许的离线文件导入，或由未来获得授权的 Source Adapter 提交。所有来源数据必须先进入候选池，不能自动覆盖正式数据或正式主图。

## 开发状态

当前仓库没有正式 Payload/Next.js 应用、正式 migration 或生产部署。正式变化必须使用任务独立分支和独立 PR；未经明确授权不得合并或部署。实施顺序为 [PR-00—PR-08](docs/DELIVERY_ROADMAP.md)，当前不得越过蓝图阶段开始 PR-00。
