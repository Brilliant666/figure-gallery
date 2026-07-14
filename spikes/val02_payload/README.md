# VAL-02 Payload CMS + Next.js 可丢弃原型

本目录只用于比较 Payload CMS + Next.js 作为手办图库技术底座的可行性。它不是正式项目，不含真实 Hpoi 数据或图片，不访问 Hpoi，不部署，也不代表最终技术选型。

## 固定运行时与依赖

- Node.js `22.23.1`（要求 `>=22.12.0`）
- npm `10.9.8`
- Payload CMS、SQLite/PostgreSQL adapters、Next integration、S3 storage plugin `3.86.0`
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
$env:DATABASE_ADAPTER = 'sqlite'
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

### PostgreSQL migration fail-closed 门禁

配置已接入官方 `@payloadcms/db-postgres@3.86.0`，但本轮没有可安全使用的
PostgreSQL 运行环境，因此 `src/migrations-postgres/` 尚未生成迁移，PostgreSQL
验证保持 `environment_blocked`。当 `DATABASE_ADAPTER=postgres` 且迁移数组为空时，
普通启动和 `payload migrate` 会直接失败，不能产生“空迁移成功”的假阳性。

未来只有在一次性、可丢弃的 PostgreSQL 环境已经可用时，才允许通过双重门禁生成
迁移：显式打开 generation-only 开关，并且实际命令必须是 `migrate:create`：

```powershell
$env:DATABASE_ADAPTER = 'postgres'
$env:DATABASE_URI = 'postgresql://<runtime-user>:<runtime-password>@127.0.0.1:<runtime-port>/<runtime-db>'
$env:PAYLOAD_ALLOW_EMPTY_POSTGRES_MIGRATIONS_FOR_GENERATION = 'true'
npx payload migrate:create
Remove-Item Env:PAYLOAD_ALLOW_EMPTY_POSTGRES_MIGRATIONS_FOR_GENERATION
```

不得在 `payload migrate`、应用启动或部署时启用该开关。生成文件必须经过审查后，
再以默认关闭开关的方式执行 fresh migration 和重复 migration 验证。

## 共享 Python CandidateClient 的真实 HTTP 验证

候选入口只接受每客户端独立、可撤销的 `candidate-client` 运行时凭据；数据库只保存 token SHA-256，不保存明文。共享客户端只接受 loopback URL；本地 `dev` 脚本固定绑定 `127.0.0.1`，standalone `start` 必须通过运行时 `HOSTNAME=127.0.0.1` 绑定 loopback。endpoint 在服务端重新读取 client active/owner 状态；通用 Candidate/Source/Media CRUD、正式实体写入和主图替换均被拒绝。

```powershell
$env:NODE_ENV = 'production'
$env:HOSTNAME = '127.0.0.1'
$env:PORT = '3000'
$env:VAL02_PAYLOAD_CANDIDATE_TOKEN = ([guid]::NewGuid().ToString('N')) + ([guid]::NewGuid().ToString('N'))
$env:VAL02_PAYLOAD_CANDIDATE_CLIENT_ID = "payload-client-$([guid]::NewGuid().ToString('N'))"
$env:VAL02_PAYLOAD_CANDIDATE_ENDPOINT = 'http://127.0.0.1:3000/api/candidate-records/upsert'
$env:VAL02_PAYLOAD_CANDIDATE_UPLOAD_ENDPOINT = 'http://127.0.0.1:3000/api/val02b/candidate-media/upload'

npx payload migrate
npm run provision:client
npm start
```

在第二个 shell 继承相同 token 和 endpoint 后运行：

```powershell
npm run smoke:python-client
```

脚本实例化 `spikes/val02_contract/python_candidate_client/client.py` 的同一个 `CandidateClient`，执行候选幂等 upsert、真实 multipart 合成 PNG 上传、改名同内容去重和正式主图攻击。服务端验证 PNG/JPEG magic、声明 MIME、尺寸、大小、SHA-256 与 aHash，生成 thumbnail/preview；文本、超限文件和 MIME 欺骗在创建正式记录前被拒绝。脚本不会打印 token，也不会提交生成图片。

Node/Payload 与共享 Python 客户端构成双运行时边界。Python 可以发送候选 JSON 和受控图片 bytes，但没有任何正式实体或主图写 API。

## VAL-02B 浏览器与共享门禁

浏览器 fixture 使用运行时管理员，只生成/复用合成数据，并为同一角色准备 3 个图库卡片（`galleryPageSize=2` 时可验证两页）：

```powershell
$env:VAL02_PAYLOAD_ADMIN_EMAIL = "val02b-$([guid]::NewGuid().ToString('N'))@synthetic.invalid"
$env:VAL02_PAYLOAD_ADMIN_PASSWORD = ([guid]::NewGuid().ToString('N'))
npm run provision:browser
```

输出仅包含 `/admin`、`/admin/candidate-review`、候选/工作项 ID、合成角色 alias 和图库路径，不输出密码。审核页每个写动作都必须携带 `ReviewWorkItem` ID 与乐观锁版本；服务端强制候选归属和 allowedTargets，只有“新建正式原型”服务能在同一事务中创建并扩展目标集合。管理员领域命令位于 `/admin/domain-operations`，包含 settings、正式资料维护、merge/split 和按 operation ID undo；通用 Admin CRUD 不能绕过领域服务或 OperationLog。

共享 30 门禁结果由以下命令生成；浏览器与真实 loopback 结果必须显式传入，缺失时对应门禁只能是 `not_run`：

```powershell
npm run acceptance:val02b -- --browser-results "$env:TEMP/payload-browser.json" --loopback-results "$env:TEMP/payload-loopback.json"
```

## 领域模型与工作流

主要集合：

- `Works`、`Characters`、`Manufacturers`
- `FigurePrototypes`、`FigureVersions`
- `SourceRecords`、`CandidateRecords`、`Media`
- append-only `OperationLogs`
- `SystemSettings` global、`ReviewWorkItems`

候选 upsert 以稳定来源 ID 优先、规范化 URL 兜底；同来源只能有一个候选。候选来源带运行时 owner，候选媒体不能抢占正式或其他候选媒体。已被人工提升为主图的同候选媒体在后续同步中只复用稳定 ID，不会被降回候选或解绑正式原型。相同重采集返回 `unchanged`；已 accepted/merged 候选发生字段、来源或图片变化时进入 `update_pending`，不会自动改正式数据。

管理员审核工作台支持：创建 draft 厂商与原型、归入已有版本、逐字段采纳/拒绝、暂缓/忽略、人工选主图。每次审核写都推进工作项版本，完成后须审计 reopen；两个管理员的后提交者收到明确冲突。管理员通用 formal/global CRUD 已关闭；正式资料和公开图库设置只能通过管理员领域 service 修改，并与 OperationLog 位于同一事务。主图在默认 Admin 中只读。merge/split 使用稳定 operation ID、原型乐观锁、显式依赖和关系闭包；undo 必须指定 operation ID，依赖或后续重叠作用域会阻止不安全撤销。

公开前台提供极简搜索、唯一结果直达、同名作品消歧、角色图库、4/3/2 列、原比例图片、分页和当前页灯箱。没有前台详情或下载按钮。

## Payload 原生能力与自定义范围

直接复用的 Payload 能力：集合/关系、draft/version/trash、认证与 API key、Local/REST API、SQLite migration、上传与缩略图、Admin shell、官方 S3 storage boundary。

必须自建的部分：候选协议和 owner 隔离、审核工作台、不可绕过的审计入口、受控 formal 生命周期、主图保护、幂等/差异检测、merge/split/undo、开放 JSON/CSV 导出、公开图库查询、Hpoi 网络硬禁令（包括可选 S3 endpoint）。

当前机器生成统计（排除 migration、生成 types/import map）：实现 `6019` LOC、测试 `2885` LOC、Admin UI `641` LOC、endpoint `1439` LOC，说明该方案是“框架能力可复用、业务模型和治理仍需显著自建”，不是开箱即用图库。

## 导出和对象存储边界

`npm run export` 生成一个关系明确的 JSON 和 10 个 CSV（包括 `ReviewWorkItems`）；包含内部 ID、关系 ID、`storageKey`、来源 URL、SHA-256/pHash 元数据，不嵌入图片 bytes/base64，也不导出框架私有备份。

本地存储是本轮实际验证路径。`storageKey` 是不含 endpoint/public URL 的稳定业务标识；仅在 `S3_ENABLED=true` 时才写 document-level 内容前缀，并与运行时 `S3_PREFIX` 组合。S3 只验证官方 plugin 的配置边界和 SQLite 回归兼容，未连接真实 bucket，因此实际对象 key、读写和恢复仍为 `environment_blocked`；切换需要运行时 `S3_*` 环境变量，不能把 access key 提交到仓库。

## 已知限制与未运行项

- `publicReadEnabled` 同时约束前台查询和匿名 Works/Characters/Manufacturers/FigurePrototypes/Media collection read；FigureVersions、候选、来源与审计日志始终不对匿名访问开放。
- 本轮当前执行环境没有可安全使用的 PostgreSQL 或 MinIO；`src/migrations-postgres/` 仍为空，因此 PostgreSQL migration/backup/restore、S3 闭环和含 PostgreSQL+S3 的完整非生产启动必须记为 `environment_blocked`，不能用 SQLite/本地媒体结果替代。
- `next build` 与 standalone 只验证本地、合成、非生产形态；没有云部署、生产凭据、生产数据或真实邮件 adapter。
- 真实浏览器结果和共享 Python loopback 结果由外部 harness 以机器 JSON 注入；未传入时生成器明确写 `not_run`，不会以静态检查冒充浏览器或传输通过。

这些限制必须进入技术底座比较；不得据此选择最终栈或开始正式开发。
