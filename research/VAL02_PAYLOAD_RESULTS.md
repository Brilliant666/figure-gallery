# VAL-02 Payload CMS + Next.js 可丢弃原型结果

## 1. 实际版本

- 测试日期：2026-07-14，Windows；Node.js 22.23.1、npm 10.9.8，另由 Python 3.10.9 运行共享 CandidateClient 与验收生成器。
- Payload CMS、`@payloadcms/next`、SQLite adapter 与 S3 storage plugin 均为 3.86.0；Next.js 16.2.10；React / React DOM 19.2.7；TypeScript 5.9.3；Vitest 4.0.18。
- 本地数据库为 SQLite；本地媒体默认写入运行时 `MEDIA_DIR`。原型位于 `spikes/val02_payload/`，只作离线、可删除的技术验证，不是正式项目，也不构成最终技术栈选择。
- `package-lock.json` 固定完整依赖树；依赖从 npm registry 安装，没有进行全局安装。

证据：[`package.json`](../spikes/val02_payload/package.json)、[`package-lock.json`](../spikes/val02_payload/package-lock.json)、[`payload-validation-summary.json`](evidence/val02/payload-validation-summary.json)。

## 2. 架构

原型采用 Payload CMS 3 与 Next.js 16 的同一 Node.js 应用：Payload Collections/Globals 与 SQLite 保存关系数据，Payload Upload 和 Sharp 处理运行时合成图片，Next.js App Router 提供只读前台和 Payload Admin。SQLite adapter 配置了 `behavior: immediate` 的真实事务；数据库、媒体、构建结果和导出都留在运行时或临时目录，不提交到仓库。

写入面分为两条边界：共享 Python CandidateClient 只调用候选专用 endpoint，Payload 内部只允许 `candidate-client` API key 执行候选 upsert；人工正式写入则要求管理员身份，并进入自建的审核 endpoint、领域 service、SQLite 事务和 append-only OperationLog。通用 Candidate/Source/Media 写入口以及正式集合和全局设置的通用写入口均关闭。

共享 fixture 完全合成，seed 时用 Sharp 动态生成小 PNG；本轮未使用真实手办图片，未访问 Hpoi，Hpoi 请求数为 0。Node/Payload 与 Python client 构成两个运行时，但 Python client 只传候选 JSON 和图片元数据，不传图片字节。

## 3. 启动方式

本地最小流程为安装 lock、在运行时设置 `PAYLOAD_SECRET`、临时 SQLite `DATABASE_URI` 和 `MEDIA_DIR`，执行 `npx payload migrate` 与 `npm run seed`，再以默认显式绑定 `127.0.0.1` 的 `npm run dev` 启动。候选 API key 只在运行时生成并由 `npm run provision:client` 写入临时数据库；仓库没有提交可用 secret、Token 或管理员登录信息。

记录的验证包含：全新 SQLite migration 与 `migrate:status`、首次 seed、同一流程重复 seed、TypeScript typecheck、ESLint、生产构建、JSON/CSV 导出和本地 loopback HTTP smoke，均完成。最终一次 Vitest 全套为 6.43 秒；一次独立生产构建观察到编译 5.3 秒、TypeScript 3.6 秒、静态页生成 1.026 秒；loopback server readiness 的一次样本为 195 ms。这些都只是小型合成数据的本机样本，不是容量测试；页面响应时间没有留下可复核的最终样本，因此不报告。

`next build` 成功。由于 [`next.config.mjs`](../spikes/val02_payload/next.config.mjs) 使用 `output: 'standalone'`，以 `next start` 做 smoke 时出现应改为直接运行 `.next/standalone/server.js` 的启动提示；这不影响本地 smoke 的结果，但 standalone 静态资产打包和正式生产启动没有验证。本轮没有部署。

## 4. 数据模型

集合覆盖统一合同中的 `Work`、`Character`、`Manufacturer`、`FigurePrototype`、`FigureVersion`、`SourceRecord`、`CandidateRecord`、`Media`、`OperationLog`，另有 `SystemSettings` global。已实测的关键关系与约束包括：

- 角色可关联作品并保存中、日、英名称和多个别名；同名角色由作品消歧。
- 原型通过多对多关联一个或多个角色，并关联作品、厂商、类型、比例、成人/多人/发布/软删除/合并状态及人工主图；版本只归属于原型，不独占图库卡片。
- 来源优先使用 `sourceType + sourceItemId` 唯一身份，没有稳定 ID 时使用规范化 URL；URL fallback 可迁移到稳定 ID 而不新增来源或候选。
- 候选保留原始字段、匹配状态、审核状态、逐字段接受/拒绝结果、理由、正式目标与图片关系；已 accepted/merged 候选在重采集发生变化时转为 `update_pending`，不会自动修改正式记录。
- 主图引用稳定的 Payload Media ID，`storageKey` 与哈希保存在媒体记录，`sourceUrl` 只是元数据。来源失效不会自动下架正式原型或删除本地主图。
- 仓库包含一组初始 Payload migration（TypeScript migration 及其 schema snapshot）；全新 migrate、状态检查及重复 seed 均完成。

## 5. 后台审核

Payload 提供 Admin shell、Collections/Relationships、认证与 API key、draft/version/trash 及 Upload 基础设施。自建 Candidate review view 可展示候选字段和本地预览，并提供：创建草稿厂商、创建草稿原型、归入已有版本、对允许字段逐项接受或拒绝、人工选主图、defer 与 ignore。候选切换、页面守卫、按钮对应的 endpoint 与服务端动作有组件或集成测试。

需要对实际可用范围作对称披露：当前 Admin 页面没有 merge、split、undo、原型发布生命周期或全局 settings 控件；这些能力只有受控 service/endpoint 和集成测试。通用正式 CRUD 为保证审计而全部关闭，但 POC 尚未实现 Work、Character、FigureVersion 的正式维护 service/UI，也没有完整的 Manufacturer 编辑 UI。因此不能把 Payload 自带 drafts、settings 或生命周期描述为已经开箱可操作的业务后台。

逐字段接受目前只把 `title`、`scale`、`category` 映射到正式原型，其余字段可记录拒绝但不能直接采纳。它允许可信管理员在请求中显式传入 `prototypeID`；当前 service 会验证 ID 存在，却没有强制该 ID 等于候选既定的 `targetPrototype`。这在受信管理员 POC 中被允许，正式设计必须收紧绑定关系并补充相应审计/UI 测试。

## 6. 权限隔离

候选 endpoint 只接受协议版本 1 的 `candidate_upsert`，且只接受 `candidate-client` API key。共享客户端只允许 loopback endpoint，本地 `dev`/`start` 脚本也默认绑定 `127.0.0.1`；handler 本身没有依赖可伪造转发头的远端地址判断，未来若暴露该路由仍须由可信网络层限制。管理员会话不能借用该入口；候选身份不能通过通用 REST/GraphQL 写 Candidate、Source、Media，也不能创建或更新正式 Character、Manufacturer、FigurePrototype、FigureVersion 或主图。来源与候选媒体还带 owner/归属检查，不能抢占正式记录、其他 client 的来源或其他候选的媒体。

真实 loopback smoke 使用共享 Python CandidateClient，对两个合成候选首次写入得到 `created=[true,true]`，重复写入得到 `created=[false,false]`，来源、候选和媒体 ID 保持一致；带正式主图字段的攻击返回 HTTP 403。运行结果没有输出或保存 API key。

管理员正式动作另外要求 `admin` 角色。OperationLog 对普通 API 为只读且不可删改；正式集合 create/update/delete 和 `SystemSettings` update 的通用入口均关闭，只允许受控 service 在事务内以内部上下文写入。`publicReadEnabled=false` 的集成测试确认匿名 Works、Characters、Manufacturers、FigurePrototypes 和 Media 五类读取全部被拒绝；FigureVersions、候选、来源和审计日志始终不向匿名访问开放。

## 7. 图片处理

seed 从共享生成描述动态创建小 PNG，使用 Sharp 计算实际字节、SHA-256 和 64 位平均哈希，再写入 Payload Media。Upload 配置实际生成了 320px thumbnail 与 1280px preview；所有生成媒体只存在于临时媒体目录。本轮没有真实手办图片。

人工选主图只能选择属于当前候选、已经匹配目标原型、具有本地 `filename/url` 和稳定 `storageKey` 的媒体；受控动作会把它提升为正式媒体、清除原主图标记，并在同一事务中更新原型和 OperationLog。测试证明修改 `Media.sourceUrl` 后，Media ID、storage key 与 `FigurePrototype.mainImage` 引用保持不变；同一候选已提升的主图在后续 upsert 中也不会被降回候选池。

这里仍有一条未闭环链路：共享 Python client 按合同只传媒体元数据，POC 没有受控的图片文件下载/导入服务，而 Media 通用写入口又已关闭。因此真实 client 创建的媒体会显示“Preview pending local upload”，不能直接进入要求本地文件的主图选择；`client → 本地候选预览 → 人工主图` 只通过 seed 生成的合成文件验证，未完成真实端到端验证。

默认使用本地存储。`S3_ENABLED=true` 时可装载 Payload 官方 S3 plugin，配置只从运行时环境变量取得，并由网络 guard 拒绝 Hpoi hostname；本轮没有提供 S3 凭据、没有连接 bucket，云连接数为 0。验证的是插件配置边界，不是实际对象存储 I/O、迁移或恢复。

## 8. merge/split/undo

`mergePrototypes`、`splitPrototype` 与 `undoLastMergeOrSplit` 使用 Payload SQLite transaction，迁移候选、媒体、来源和版本关系，并写入带 before/after/inverse snapshot 的 OperationLog。merge 保留被合并原型并设为 merged；split 强制关系闭包、拒绝移动仍被其他候选引用的局部关系，也不隐式复制或移动原主图。

自动测试完成了 `merge → split → undo split → undo merge`，恢复候选、媒体、来源和版本的原始归属，并把两个原操作标记为 undone；另有测试证明不完整 split 被拒绝，OperationLog 晚期写入失败会使整个候选或审核事务回滚。AC-13 与 AC-14 均为 pass。

限制是 undo 只能撤销全局时间上最新的一条未撤销 merge/split，不能由管理员指定操作，也没有按原型、管理员或操作链做并发作用域与冲突检测；而且 Admin 当前没有 merge/split/undo 控件。多管理员并发和复杂操作链必须另行设计。

## 9. 导出

`npm run export` 生成 1 个开放关系 JSON 和 9 个集合 CSV；全新数据库 seed 与重复 seed 后均完成导出，JSON 与 9 个 CSV 已解析。导出覆盖 works、characters、manufacturers、figure-prototypes、figure-versions、source-records、candidate-records、media 和 operation-logs，并在 JSON 中另含 SystemSettings。

导出保留记录 ID、关系 ID、fixture/external identity、`storageKey`、来源 URL、SHA-256、感知哈希、尺寸与审计关系；排除上传文件名、派生 URL、密码/API key 字段和图片字节，不包含 base64 或 data URL，也不依赖 Payload 私有备份格式。AC-22 与 AC-23 均为 pass。

## 10. 前台

Next.js 最小前台实现中央角色搜索、标准名/别名精确匹配、唯一匹配直达、同名角色按作品消歧、角色大标题、每个原型一张主图、多人标记、默认每页 16、成人主图默认隐藏，以及桌面/平板/手机 4/3/2 列。图片输出固有宽高，CSS 使用 `height: auto` 和 `object-fit: contain`；四个版本不会产生四张图库卡片。

服务端/组件测试覆盖别名解析、作品消歧、多人原型、相似动作不同厂商、版本去重、成人开关、来源失效、17 条数据的 16+1 稳定分页、原比例和无下载按钮。GalleryGrid 的灯箱代码提供关闭、缩放及基于当前页 `images` 数组的上一张/下一张；但没有取得真实 Chrome 点击、循环边界和交互状态证据，因此 AC-29 仍为 not_run，不能以静态断言替代浏览器结果。

## 11. 测试结果

- Payload/Vitest 测试：36/36 通过，失败 0。
- 统一 30 项验收：29 pass、0 fail、1 not_run；唯一 not_run 为 AC-29。
- AC-01—AC-28 与 AC-30 都映射到实际通过的 Vitest 名称；验收 runner 从 Vitest JSON 读取 36/36 计数，不是手写“全部通过”。
- `acceptance-results.json` 当前为 17,572 bytes，SHA-256 为 `18bb27483e64e103ff156532bcf627fdb348f67d38fc1e8d5bc7ed68345a106d`；共享 fixture SHA-256 为 `3ff832622a8b9d4244ec39fc70668c270cb78204ca975004941761ddb9df9529`。验收结果覆盖 68 个实现、测试、配置与共享合同文件，source digest 为 `993a600fc97894083f2a2641bf2c8d6974b10533447004e22a08291fdd07a7b1`。
- 已执行并通过的检查包括全新 migrate/状态检查、首次与重复 seed、36 项 Vitest、TypeScript typecheck、ESLint、`next build`、JSON/9 CSV 导出与解析、候选/API/主图攻击权限测试、本地 thumbnail、事务回滚、前台服务端/组件测试、loopback Python client smoke 和 Hpoi 网络 guard。Hpoi 请求数为 0，真实图片使用为 false，云连接数为 0。

机器结果：[`acceptance-results.json`](../spikes/val02_payload/acceptance-results.json)；汇总：[`payload-validation-summary.json`](evidence/val02/payload-validation-summary.json)。

## 12. 失败项

统一验收没有 `fail`，但有以下未执行项或警告，不能写作通过：

1. **AC-29：not_run。** 当前环境无法控制 Chrome，因此没有执行灯箱点击、缩放、上一张/下一张及当前分页边界的真实浏览器交互。SSR、CSS 和组件源码静态测试通过，但只作为替代证据。
2. **standalone 启动提示。** `next build` 成功，但 `output: 'standalone'` 配置下用 `next start` 做 smoke 会提示应直接运行 `.next/standalone/server.js`。本轮没有验证 standalone 目录的生产静态资产装配或正式启动方式。
3. **未执行的外部/生产验证。** 真实 S3、云端部署、备份恢复、生产数据库、并发压测、邮件 adapter 和多实例一致性均未执行。

本地 loopback CandidateClient smoke 已执行并通过；首次 `[true,true]`、重复 `[false,false]` 与 HTTP 403 是实际观察，不是未执行项。没有向 Hpoi 发起请求，也没有用真实图片补足上述缺口。

## 13. 自定义工作量

验收 runner 对原型 `src/`、`scripts/`、`tests/` 的 Python/TypeScript 文件做物理行统计，排除 migration、生成的 `payload-types.ts` 和 import map，得到 6,212 行；该指标包含测试，不能直接与纯实现行数混用。按可复核的统一口径另计：`src/` 与 `scripts/` 中一方 `.py/.ts/.tsx/.js/.mjs/.css` 实现为 43 个文件、4,289 行，4 个测试文件为 2,122 行。Admin 两个组件为 413 行；若把候选审核 endpoint 一并计入后台定制，则为 984 行。前台页面、样式和 GalleryGrid 为 428 行，另有 146 行公开图库查询 service。

项目含 1 组逻辑 migration（1 个 TypeScript migration 加 1 个 schema snapshot），9 个直接运行依赖和 8 个直接开发依赖。本地常驻最小拓扑为 1 个 Node/Payload/Next 进程加 SQLite 与本地媒体；候选写入另需独立、可按需运行的 Python client，因此是双运行时边界。云端最小拓扑没有实际部署验证。

直接复用的能力包括 Collections/Relationships、draft/version/trash、认证与 API key、Local/REST API、SQLite migration、Upload/thumbnail、Admin shell 和官方 S3 plugin 边界。自建部分包括候选协议、owner 隔离、审核工作台、不可绕过的审计入口、正式生命周期 service、主图保护、幂等与差异检测、merge/split/undo、开放导出、公开图库查询和 Hpoi 网络硬禁令。

6,212 行 runner 指标中还包含自动化测试与验证脚本，不能直接当作产品代码估算；同样，现有 Candidate review 页面只证明最小候选流程成立，不能抵消缺失的正式数据维护 UI、merge/split/undo UI、发布/settings 控件和真实媒体导入链路。

## 14. 已知风险

- AC-29 缺少真实 Chrome 交互证据；响应式、原比例和灯箱当前主要由 SSR/CSS/源码测试支撑。
- 通用正式 CRUD 已关闭，但 Work、Character、FigureVersion 的正式维护 service/UI 未实现，Manufacturer 也没有完整编辑 UI；业务后台仍不完整。
- merge/split/undo、原型发布生命周期和 settings 只有受控 service/endpoint 与集成测试，没有 Admin 控件；操作效率和权限角色拆分未验证。
- undo 只面向全局最新未撤销 merge/split；并发管理员、多原型操作链、冲突检测和指定撤销尚未设计。
- `accept-field` 允许可信管理员显式传入 `prototypeID`，没有强绑定候选既定 target；正式设计必须收紧该边界，避免误写其他原型。
- 共享 CandidateClient 只传媒体元数据且没有受控媒体文件导入，真实 `client → 本地预览 → 主图` 链路未闭环。
- SQLite 与小型合成 fixture 只证明本地原型路径；没有验证生产数据库、任务队列、大数据量、并发审核或多实例一致性。
- S3 只验证官方 plugin 配置边界，未验证真实 bucket I/O、既有媒体迁移、签名 URL、故障恢复或凭据轮换。
- `output: 'standalone'` 的构建成功，但其正式启动和静态资产打包未验证；本轮没有部署。
- 本报告仅记录 Payload CMS + Next.js spike 的阶段性实测结果，不选择最终技术栈，不把该目录提升为正式项目，也不包含部署结论。
