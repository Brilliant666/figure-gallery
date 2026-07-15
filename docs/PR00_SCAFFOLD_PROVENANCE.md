# PR-00 官方脚手架溯源

## 记录目的

本文只记录 PR-00 正式应用技术骨架的来源，便于审核 `apps/web` 是否由固定版本的 Payload 官方工具干净生成。它不是业务实现说明，也不把官方 blank 模板中的技术 Collection 认定为 Figure Gallery 领域模型。

## 生成记录

| 项目              | 实际值                                           |
| ----------------- | ------------------------------------------------ |
| 日期              | 2026-07-15（Asia/Shanghai）                      |
| 工作目录          | 仓库根目录下的 `apps/`                           |
| CLI               | 官方 npm registry 的 `create-payload-app@3.86.0` |
| Payload 分支/版本 | `v3.86.0` / `3.86.0`                             |
| 模板              | `blank`                                          |
| 数据库选项        | PostgreSQL                                       |
| 包管理器          | npm                                              |
| Node.js           | `22.13.1`                                        |
| npm               | `10.9.2`                                         |
| Git 初始化        | 关闭（`--no-git`）                               |
| Agent 文件生成    | 关闭（`--no-agent`）                             |
| 脚手架提交        | `00f5f5675b968832cd4cb14a9ef6648b0d1886f8`       |

执行命令的脱敏形式如下。数据库连接值只是本机一次性占位输入，仅存在于被 Git 忽略并已移除的运行时 `.env`；没有把该值写入本文或提交历史。

```powershell
npx --yes create-payload-app@3.86.0 web `
  -t blank `
  --db postgres `
  --db-connection-string '<local-placeholder-removed>' `
  --version 3.86.0 `
  --branch v3.86.0 `
  --use-npm `
  --no-agent `
  --no-git
```

CLI 完成了模板下载与应用局部依赖安装，并生成 `package-lock.json`。后续 PR-00 改动只在该提交之后建立正式配置、测试、CI 和模块边界，因此 Git 历史可以将官方初始输出与项目增量分开审核。

## 正式 baseline migration

在完成 PostgreSQL-only 技术配置后，使用同一固定版本的官方 Payload CLI 执行
`npm run payload -- migrate:create pr00_baseline`，生成
`src/migrations/20260715_114831_pr00_baseline.ts`、对应 JSON schema 和静态
`index.ts`。该 CLI 流程在生成 migration 时禁用数据库连接，因此没有访问本机或生产数据库；
文件只包含 `Users`、基础设施 `Media` 和 Payload 内部技术表。生成后仅规范化 SQL 模板字符串的
行尾空白以满足 `git diff --check`，没有改写 SQL token 或 schema。

## 官方生成内容摘要

脚手架提交新增 `apps/web` 下 38 个文件，包括：

- Payload 与 Next.js App Router 集成骨架及 Admin/API 路由；
- blank 模板首页、样式与最小测试样例；
- `package.json`、npm 锁文件、TypeScript、ESLint、Vitest 与 Playwright 配置；
- Payload 配置、生成的类型与 import map；
- 官方 blank 模板要求的 `Users` 与 `Media` 两个技术 Collection；
- 模板随附的本地开发/容器示例文件。

`Users` 仅作为 Payload Admin 认证所需的技术管理员边界；`Media` 仅是 blank 模板随附的技术上传基线。二者都不承载 Work、Character、Manufacturer、FigurePrototype、FigureVersion、Candidate、Review 或其他 Figure Gallery 领域行为，`Media` 也不等于正式媒体生命周期模型。

## 来源与范围断言

- 没有复制、移动、重命名或导入 `spikes/` 的代码、migration、fixture、package、workflow 或脚本。
- `research/` 与 `spikes/` 都不是 `apps/web` 的运行时输入、依赖或构建上下文。
- 本次没有生成 Figure Gallery 业务 Collection、业务 API、搜索、图库、审核工作台或采集适配器。
- 本次没有导入真实数据或图片，没有访问 Hpoi，也没有部署任何环境。
- 后续业务模型只能在 PR-01 及之后获得新的明确授权后实现。
