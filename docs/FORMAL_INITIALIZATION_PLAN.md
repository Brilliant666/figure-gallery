# PR-00 正式项目初始化计划

> 历史说明：本计划记录 PR-00 使用 Payload 3.86.0 官方脚手架的原始初始化过程。当前正式运行依赖已通过独立 SECURITY-02 门禁升级到 Payload 3.87.1；原始脚手架命令和来源记录保留不改写。

## 1. 任务定义

PR-00 的唯一目的，是从官方脚手架建立可重复验证的正式工程边界。它不实现 Figure Gallery 的业务功能，也不迁移任何 spike。执行 PR-00 需要新的明确任务授权；本文件只是计划，当前蓝图任务不得运行其中的脚手架、安装、数据库或构建命令。

### 交付范围

- 从最新 `main` 创建 PR-00 独立分支和 Draft PR。
- 用 Payload 官方 `create-payload-app` 在 `apps/web` 干净生成 Payload + Next.js 集成应用。
- 固定 Payload `3.86.x`、Next.js `16.2.x`、React `19.2.x`、TypeScript、Node.js `22.x` 与 npm，提交 `package-lock.json`。
- 建立计划中的 apps/packages/infra 目录与依赖方向。
- 配置 PostgreSQL 16 为唯一正式数据库 adapter；SQLite 不进入正式运行配置。
- 建立 S3 storage adapter 的配置接口；本地默认可使用临时文件存储，且业务引用只认 `storageKey`。
- 建立环境变量 schema、liveness/readiness、build version、空 migration、CI、Vitest/Playwright 测试基线。
- 验证 production build 和 `.next/standalone` 干净启动；不沿用 spike 配置。

### 明确非范围

- 不创建 Work、Character、Manufacturer、FigurePrototype、FigureVersion 或任何其他业务 Collection。
- 不实现 Candidate API、Review API、domain operation、搜索、图库、Admin 工作台或媒体生命周期。
- 不导入研究数据、真实手办图片、数据库备份或 S3 对象。
- 不复制 `spikes/` 的源码、migration、fixture、package 文件、workflow 或脚本。
- 不访问 Hpoi 或自动采集外部来源。
- 不部署云服务，不创建生产数据库/bucket，不开始 PR-01。

## 2. 起点门禁

执行者在任何脚手架或安装前必须：

1. 完整阅读 `AGENTS.md`、`CODEX_MASTER_INSTRUCTION.md`、根 `README.md`、本文件、[系统架构](SYSTEM_ARCHITECTURE.md)、[安全边界](SECURITY_BOUNDARIES.md)和[技术 ADR](../research/TECH_STACK_DECISION.md)。
2. 确认正式蓝图 PR 已合并，`main` 与 `origin/main` 一致且工作区干净。
3. 记录 Node/npm/Git 版本与磁盘空间；Node 必须为 `22.x`。
4. 确认 `apps/web` 不存在；如已存在，停止并调查，不能覆盖。
5. 确认当前任务明确授权依赖安装、PostgreSQL/S3 本地验证与 PR-00 文件范围。
6. 保留 Hpoi network guard；整个初始化请求数必须为 0。
7. 建立分支，例如 `feat/pr-00-formal-initialization`；分支名须以届时任务为准。

## 3. 正式目录与依赖方向

PR-00 计划建立：

```text
figure-gallery/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── collections/
│       │   ├── globals/
│       │   ├── domain/
│       │   ├── endpoints/
│       │   ├── access/
│       │   ├── hooks/
│       │   ├── jobs/
│       │   ├── migrations/
│       │   └── tests/
│       ├── public/
│       ├── package.json
│       └── payload.config.ts
├── packages/
│   ├── domain-contracts/
│   ├── candidate-client/
│   ├── media-contracts/
│   └── test-fixtures/
├── infra/
│   ├── compose/
│   ├── scripts/
│   └── examples/
├── docs/
├── research/
└── spikes/
```

依赖规则：

- `apps/web` 可以依赖 `packages/domain-contracts` 与 `packages/media-contracts`。
- `packages/candidate-client` 是独立 Python 客户端，只依赖公开的候选协议，不能导入 Web 应用内部模块。
- `packages/test-fixtures` 只生成完全合成数据，不得成为生产运行依赖。
- `packages/*` 不得依赖 Payload Collection 的具体实现，避免框架类型污染协议。
- `infra/` 只承载本地/非生产示例和脚本，不包含生产秘密。
- `research/` 与 `spikes/` 均不得被 package、TypeScript path alias、Docker build context 或运行时读取。

PR-00 只为尚未实现的模块建立最小目录说明或空入口；不得用占位业务逻辑冒充实现。

## 4. 版本和依赖基线

正式 `package.json` 应使用 exact pin 并由 Dependabot/独立升级 PR 管理。PR-00 初始候选以已通过生产门禁的补丁版本为基线：

| 类别 | 初始 pin/边界 |
| --- | --- |
| Runtime | Node.js `22.x`，`engines` 至少 `>=22.12.0 <23`；npm，提交 `package-lock.json` |
| Core | `payload@3.86.0`、`@payloadcms/next@3.86.0`、`next@16.2.11` |
| UI | `react@19.2.7`、`react-dom@19.2.7` |
| Database | `@payloadcms/db-postgres@3.86.0`；正式配置不得依赖 SQLite |
| Media | `@payloadcms/storage-s3@3.86.0`、`sharp@0.35.3` |
| Language | TypeScript；具体 patch 由脚手架锁文件记录 |
| Quality | ESLint、Vitest、Playwright；版本由 PR-00 锁定并在 CI 验证 |

若官方脚手架在执行日解析到接受 minor 内更高 patch，PR-00 必须先记录差异并通过依赖升级门禁；不得使用未审计的 `latest` 浮动版本，也不得为了复刻 spike 而降级。GraphQL 等传递/直接依赖以官方模板和实际需要为准，禁止无用途依赖。

## 5. 脚手架与初始化命令计划

下列命令只允许在未来 PR-00 执行，并须在执行前用该固定版本的 `--help` 核对参数；禁止在本蓝图任务运行：

```powershell
git switch main
git pull --ff-only origin main
git switch -c feat/pr-00-formal-initialization

node --version
npm --version
npx --yes create-payload-app@3.86.0 --help

New-Item -ItemType Directory -Path apps -ErrorAction Stop
Push-Location apps
npx --yes create-payload-app@3.86.0 web
Pop-Location
```

对官方交互提示采用固定答案：目录 `apps/web`、空白/blank 模板、PostgreSQL、npm、不生成示例业务内容。若 `3.86.0` CLI 的实际提示或参数与本计划不同，停止并把官方 CLI 输出摘要提交到 PR 描述；不得改用非官方模板或从 spike 复制。

脚手架完成后，未来任务在 `apps/web` 内按锁文件执行：

```powershell
npm ci
npm install --save-exact @payloadcms/storage-s3@3.86.0 sharp@0.35.3
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

如果脚手架已包含依赖，不重复安装；修改依赖后必须由 npm 生成并审核 `package-lock.json`。不得全局安装包，不得手写锁文件。Playwright 浏览器只能项目局部安装，且仅在任务明确授权后执行。

## 6. 环境变量 schema

PR-00 必须建立启动时验证且不回显值的 schema，并提交只含占位符的 `.env.example`：

| 变量 | 必需性 | 约束 |
| --- | --- | --- |
| `NODE_ENV` | 必需 | `development/test/production` |
| `PAYLOAD_SECRET` | 必需 | 运行时 secret；禁止默认值、日志和提交 |
| `DATABASE_URI` | 正式运行必需 | PostgreSQL URI；拒绝 SQLite URI |
| `PUBLIC_READ_ENABLED` | 必需 | 默认 `false`，初始化阶段不开公开读取 |
| `MEDIA_STORAGE_DRIVER` | 必需 | `filesystem` 或 `s3`；production 只允许 `s3` |
| `MEDIA_LOCAL_ROOT` | 本地 filesystem 时 | Git 忽略目录，只绑定本地测试 |
| `S3_ENDPOINT` | S3 时 | HTTPS 或显式 loopback 测试 endpoint |
| `S3_REGION` | S3 时 | 非空 |
| `S3_BUCKET` | S3 时 | 非空；不硬编码生产值 |
| `S3_ACCESS_KEY_ID` | S3 时 | 运行时 secret，不提交 |
| `S3_SECRET_ACCESS_KEY` | S3 时 | 运行时 secret，不提交 |
| `S3_FORCE_PATH_STYLE` | 可选 | 本地兼容服务可为 `true` |
| `BUILD_VERSION` | CI/build 必需 | commit SHA 或不可变 build ID |

schema 失败必须 fail fast 并只报告变量名/原因。配置对象不得向 Client Component 暴露 server-only secret。

## 7. 最小运行骨架

### Payload 与 Next.js

- 保持官方集成结构和 import map 生成方式。
- `payload.config.ts` 只注册 PostgreSQL adapter、媒体 adapter 边界、空 migration path 和最小管理员认证配置。
- 不注册任何 Figure Gallery 业务 Collection；官方必需的用户/媒体基线若模板强制生成，必须在 PR 描述中逐项解释，不能承载正式领域行为。
- production GraphQL introspection 默认关闭；REST/GraphQL/Local API 均不得预留无约束正式写入口。

### Health

- `/api/health/live`：只证明进程/event loop 可服务，不访问依赖。
- `/api/health/ready`：只读检查 PostgreSQL、migration 版本、配置有效性；S3 配置启用时执行有界 metadata/readiness 检查。
- 响应包含状态、`BUILD_VERSION`、migration 状态和依赖类别，不包含 URI、bucket secret 或异常堆栈。
- readiness 失败返回 503，liveness 不因短暂 S3 故障误杀进程。

### Migration

- 创建一个空正式 baseline migration，只建立 Payload 官方基础 schema。
- 禁止复制 `spikes/val02_payload/src/migrations-postgres/`。
- 空 PostgreSQL 16 上 fresh、repeat、启动检查均必须通过；生成 migration 后工作区必须无隐式 drift。

## 8. 正式 CI 基线

PR-00 新建正式 workflow，不能重命名或复制 research 专用 workflow。至少包含：

1. repository safety 与禁止 spike 依赖检查；
2. Node 22 + `npm ci` lock install；
3. TypeScript typecheck；
4. ESLint；
5. Vitest 单元/health/config 测试；
6. PostgreSQL 16 fresh/repeat migration；
7. 配置与权限边界 smoke；
8. Next.js production build；
9. `.next/standalone` 干净目录启动与 health；
10. 凭据、大文件、数据库、媒体、构建产物和 Artifact 扫描。

[系统架构](SYSTEM_ARCHITECTURE.md)定义的 contract、S3、browser、attack matrix、backup/restore 等完整阶段，必须随对应能力在 PR-02—PR-07 加入，最迟 PR-08 全部成为正式门禁；未实现阶段应明确为 roadmap requirement，不能用永远跳过的绿色空 job 冒充通过。

正式 workflow：

- 固定 Action 完整 commit SHA；最小 `contents: read` 权限；
- 服务只绑定 loopback，凭据运行时随机生成；
- 缓存不能包含 `.env`、数据库或媒体；
- 失败也执行清理，Artifact 只含小型脱敏摘要；
- PR 必跑静态、单元、migration 和 build；`main` 必跑全部已实现门禁；依赖升级触发完整门禁。

## 9. PR-00 测试与验收

| ID | 验收 | 通过条件 |
| --- | --- | --- |
| INIT-01 | 官方来源 | Git 历史显示 `apps/web` 来自固定版本官方脚手架，无 spike 复制 |
| INIT-02 | 版本锁定 | 接受的版本 exact pin，`npm ci` 在干净目录通过 |
| INIT-03 | 目录边界 | apps/packages/infra 方向有机器检查，research/spikes 不在依赖图/build context |
| INIT-04 | 环境 schema | 缺失/非法值 fail fast，secret 不输出，production 拒绝 SQLite/filesystem |
| INIT-05 | PostgreSQL | 空库 fresh/repeat migration 和 schema drift 检查通过 |
| INIT-06 | S3 抽象 | storage driver 配置可验证；未提供 S3 时 production readiness 失败可控 |
| INIT-07 | Health | live/ready 语义、503、build/migration 状态通过自动测试 |
| INIT-08 | Quality | typecheck、ESLint、Vitest 全通过，无 warning-as-success |
| INIT-09 | Build | production build 与干净 `.next/standalone` 启动成功，不依赖 `next dev` |
| INIT-10 | Browser | Playwright 只验证 health/空 Admin 登录边界，不验证未实现业务 |
| INIT-11 | Safety | 无真实凭据、图片、数据库、备份、构建产物或大文件进入 Git |
| INIT-12 | Scope | 没有正式业务 Collection/API/page/migration 数据，也没有 Hpoi 请求 |

所有未执行项必须标为 `not_run` 或 `environment_blocked`；不得写成通过。INIT-01—12 只有全部为 `pass` 才允许建议合并。任一项为 `fail`、`not_run` 或 `environment_blocked` 时，PR 必须保持 Draft，记录证据并停止等待环境或后续授权；不得以范围小或历史 spike 结果豁免。

## 10. 审核与停止条件

提交前执行：

- 完整 CI 与 `git diff --check`；
- 依赖/许可证和 lockfile 审核；
- `git diff main...HEAD` 范围审核；
- 复制相似度/路径检查，证明没有从 `spikes/` 导入实现；
- 凭据、大文件、二进制、数据库、备份、媒体和构建产物扫描；
- Hpoi 请求计数 0；
- 本地临时数据库、对象、进程和 runtime secret 清理。

PR-00 的停止条件：官方脚手架、锁定依赖、环境 schema、health、空 migration、正式 CI、测试框架与目录边界完成；正式业务实体和功能仍为 0；分支已推送且 Draft PR 已创建；工作区干净。达到后立即停止，不合并、不部署、不开始 PR-01。

后续工作必须回到 [交付路线](DELIVERY_ROADMAP.md)，由新的明确任务授权。
