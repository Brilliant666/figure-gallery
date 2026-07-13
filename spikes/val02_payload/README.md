# VAL-02 Payload CMS + Next.js 可丢弃原型

本目录只用于比较 Payload CMS + Next.js 作为手办图库技术底座的可行性。它不是正式项目，不含真实 Hpoi 数据或图片，不访问 Hpoi，不部署，也不代表最终技术选型。

## 固定运行时与依赖

- Node.js `22.23.1`（要求 `>=22.12.0`）
- npm `10.9.8`
- Payload CMS、SQLite adapter、Next integration、S3 storage plugin `3.86.0`
- Next.js `16.2.10`
- React / React DOM `19.2.7`
- TypeScript `5.9.3`
- Vitest `4.0.18`
- 默认数据库：本地 SQLite；初始迁移在 `src/migrations/`
- 默认图片存储：本地 `MEDIA_DIR`；`S3_ENABLED=true` 时才加载 Payload 官方 S3 plugin

`package-lock.json` 固定完整依赖树。依赖通过官方 npm registry 安装，无全局安装。

## 快速运行

PowerShell 示例；所有 secret、API key 和数据库都只在运行时提供：

```powershell
cd spikes/val02_payload
npm ci --no-audit --no-fund

$env:PAYLOAD_SECRET = ([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))
$env:DATABASE_URI = "file:$($env:TEMP.Replace('\','/'))/figure-gallery-val02-payload.db"
$env:MEDIA_DIR = "$env:TEMP/figure-gallery-val02-payload-media"
$env:S3_ENABLED = 'false'

npx payload migrate
npm run seed
npm run dev
```

Seed 只读取共享合成 fixture，并在临时媒体目录动态生成小 PNG。不得把运行数据库、媒体目录或 secret 提交到仓库。

## 验证命令

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run generate:importmap

npm run export -- --out="$env:TEMP/figure-gallery-val02-payload-export"
python scripts/run_acceptance.py
```

全新数据库迁移检查：

```powershell
$env:NODE_ENV = 'production'
$env:DATABASE_URI = "file:$($env:TEMP.Replace('\','/'))/figure-gallery-val02-payload-fresh.db"
npx payload migrate
npx payload migrate:status
npm run seed
```

## 共享 Python CandidateClient 的真实 HTTP 验证

候选入口只接受 `candidate-client` API key；共享客户端只接受 loopback URL，且本地 `dev`/`start` 脚本默认绑定 `127.0.0.1`。endpoint handler 本身不把可伪造的转发头当作远端地址门禁；如果未来部署并暴露该路由，必须另加可信网络层限制。管理员 session、通用 Candidate/Source/Media REST/GraphQL 写入和正式实体字段均被拒绝。

```powershell
$env:NODE_ENV = 'production'
$env:VAL02_PAYLOAD_CANDIDATE_TOKEN = ([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))
$env:VAL02_PAYLOAD_CANDIDATE_ENDPOINT = 'http://127.0.0.1:3000/api/candidate-records/upsert'

npx payload migrate
npm run provision:client
npm start -- -p 3000
```

在第二个 shell 继承相同 token 和 endpoint 后运行：

```powershell
npm run smoke:python-client
```

脚本实例化 `spikes/val02_contract/python_candidate_client/client.py` 的同一个 `CandidateClient`，对两个合成候选执行首次写入、重复写入，并发送正式主图字段攻击。它强制断言首次均为 `created=true`、重复均为 `created=false`、候选/来源/媒体 ID 不变、攻击为 HTTP 403；不会打印 token。

Node/Payload 与共享 Python 客户端构成双运行时边界。Python 只发送候选 JSON 和图片元数据，不发送图片字节，也没有正式实体写 API。

## 领域模型与工作流

主要集合：

- `Works`、`Characters`、`Manufacturers`
- `FigurePrototypes`、`FigureVersions`
- `SourceRecords`、`CandidateRecords`、`Media`
- append-only `OperationLogs`
- `SystemSettings` global

候选 upsert 以稳定来源 ID 优先、规范化 URL 兜底；同来源只能有一个候选。候选来源带运行时 owner，候选媒体不能抢占正式或其他候选媒体。已被人工提升为主图的同候选媒体在后续同步中只复用稳定 ID，不会被降回候选或解绑正式原型。相同重采集返回 `unchanged`；已 accepted/merged 候选发生字段、来源或图片变化时进入 `update_pending`，不会自动改正式数据。

管理员审核工作台支持：创建 draft 厂商与原型、归入已有版本、逐字段采纳/拒绝、暂缓/忽略、人工选主图。管理员通用 formal/global CRUD 已关闭；厂商状态、原型发布生命周期和公开图库设置只能通过管理员专用 action 修改，并与 OperationLog 位于同一 SQLite 事务。主图在默认 Admin 中只读，只有审核 action 的受控 context 可修改。merge、split、undo 也使用事务、完整关系归属和 split 闭包检查。

公开前台提供极简搜索、唯一结果直达、同名作品消歧、角色图库、4/3/2 列、原比例图片、分页和当前页灯箱。没有前台详情或下载按钮。

## Payload 原生能力与自定义范围

直接复用的 Payload 能力：集合/关系、draft/version/trash、认证与 API key、Local/REST API、SQLite migration、上传与缩略图、Admin shell、官方 S3 storage boundary。

必须自建的部分：候选协议和 owner 隔离、审核工作台、不可绕过的审计入口、受控 formal 生命周期、主图保护、幂等/差异检测、merge/split/undo、开放 JSON/CSV 导出、公开图库查询、Hpoi 网络硬禁令（包括可选 S3 endpoint）。

当前 `src/`、`scripts/`、`tests/` 中排除生成迁移/types/import map 后约 5.1k 行，说明该方案是“框架能力可复用、业务模型和治理仍需显著自建”，不是开箱即用图库。

## 导出和对象存储边界

`npm run export` 生成一个关系明确的 JSON 和 9 个 CSV；包含内部 ID、关系 ID、`storageKey`、来源 URL、SHA-256/pHash 元数据，不嵌入图片 bytes/base64，也不导出框架私有备份。

本地存储是本轮实际验证路径。S3 只验证官方 plugin 的配置边界，未连接真实 bucket；切换需要运行时 `S3_*` 环境变量，不能把 access key 提交到仓库。

## 已知限制与未运行项

- AC-29 未运行真实浏览器/DOM 灯箱交互；当前环境 Chrome 控制不可用，只保留 SSR/CSS 静态替代证据。
- 自定义 Admin 候选切换做了 ID 归一化单测，但没有完整浏览器交互回归；merge/split/undo、原型发布生命周期和公开设置目前只有受控 service 与集成测试，没有对应的 Admin 控件。
- 为确保所有已暴露领域写都可审计，通用 Works/Characters/Manufacturers/FigureVersions/FigurePrototypes/SystemSettings 写入口均关闭。当前 POC 尚未提供 Work/Character/Version 的正式元数据维护 service，也没有完整的 Manufacturer 编辑 UI；这是真实的审核体验和领域适配缺口，不能把 Payload 原生 drafts/settings/lifecycle 当作已开箱可操作。
- 当前 undo 只撤销全局最新一条未撤销的 merge/split，不能由管理员指定某条操作；并发管理员或多条操作链需要额外的作用域、冲突检测和 UI。
- 共享 Python client 按合同只发送图片元数据；当前没有受控的候选图片 bytes 下载/导入服务，而 Media 通用写入口已关闭。因此真实 client 写入会显示“Preview pending local upload”，不能直接进入要求 `filename/url` 的主图选择；client → 本地候选预览 → 主图的完整链路仅由 seed 合成文件验证，尚未端到端闭合。
- `publicReadEnabled` 同时约束前台查询和匿名 Works/Characters/Manufacturers/FigurePrototypes/Media collection read；关闭后集成测试确认五类公开查询都被拒绝。FigureVersions、候选、来源与审计日志始终不对匿名访问开放。
- S3、云端部署、生产备份恢复、并发压测、真实邮件 adapter 均未验证。
- `next build` 可通过；本轮没有部署。`output: standalone` 的实际生产启动/静态资产打包仍需 VAL-02 后续决策，不在本轮定案。

这些限制必须进入技术底座比较；不得据此选择最终栈或开始正式开发。
