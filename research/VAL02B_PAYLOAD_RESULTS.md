# VAL-02B Payload CMS + Next.js 定向门禁结果

## 1. 范围与环境

- 测试日期：2026-07-14；环境：Windows、Node.js 22.23.1、npm 10.9.8、Payload CMS 3.86.0、Next.js 16.2.10。
- 本目录仍是 `spikes/val02_payload/` 下的可丢弃验证，不是正式项目，也不表示已经选择 Payload CMS + Next.js。
- 所有领域记录和 PNG/JPEG 均为离线合成 fixture；图片只在临时运行目录动态生成，没有提交图片、数据库、备份、对象或运行时凭据。
- Hpoi 网络 guard 保持启用；本轮 Hpoi 请求和请求尝试均为 0。
- 真实 Chrome、Payload/Next 功能和 SQLite 回归可运行；Docker/Compose 只有客户端而 daemon 不可用，且没有 PostgreSQL 客户端、服务或 5432 监听，也没有 MinIO/S3 服务或 9000/9001 监听。因此 BG-17—BG-29 按规范全部为 `environment_blocked`，不得由 SQLite、本地文件存储或 standalone smoke 替代。

机器证据：[`val02b-acceptance-results.json`](../spikes/val02_payload/val02b-acceptance-results.json)、[`environment.json`](evidence/val02b/environment.json)、[`payload-browser.json`](evidence/val02b/payload-browser.json)、[`payload-loopback.json`](evidence/val02b/payload-loopback.json)、[`infrastructure-gates.json`](evidence/val02b/infrastructure-gates.json)。

## 2. 真实浏览器

Playwright 1.61.1 通过 `channel="chrome"` 控制本机 Chrome 150.0.7871.102，headless 运行；未下载 Chromium，未使用控制扩展或 native host，也未提交截图、视频或完整浏览器报告。

### 2.1 后台审核

- BG-01 管理员登录：`pass`；1,582 ms、1 次点击、3 次主 frame 导航。
- BG-02 完整审核：`pass`；1,560 ms、6 次点击、5 次主 frame 导航。
- 同一工作项真实完成：打开候选、预览至少两张候选图、接受标题、拒绝比例字段、选择允许的正式目标、人工选择主图、归入版本、填写每步理由、完成工作项，并确认 OperationLog 数量大于 0。
- 审核流程没有控制台错误、网络失败或被 network guard 拒绝的请求；审核测试未使用键盘动作。因本次浏览器流程没有发生错误，所以没有浏览器内错误恢复步骤可计；上传失败与重试由后述 service/endpoint 测试覆盖。

### 2.2 前台图库

- BG-03、BG-04 均为 `pass`；完整图库流程 4,189 ms、15 次点击、1 次键盘操作、22 次主 frame 导航。
- 实测首页搜索、唯一角色直达、同名角色按作品消歧、分页（第 1 页 2 张、第 2 页 1 张）、桌面/平板/手机 computed grid 4/3/2 列。
- 图片使用 `object-fit: contain`，样本固有尺寸和显示尺寸均被读取；灯箱真实点击覆盖打开、缩放、当前页上一张/下一张、首尾循环边界、关闭按钮与 Escape 关闭。
- 成人图默认隐藏；通过审计的后台设置动作后可显示。前台没有下载按钮，也没有图片详情面板。
- 浏览器期间控制台错误、禁止域请求和 Hpoi 请求尝试均为 0。机器报告记录 9 个 `requestfailed`，全部是测试连续导航时对 `127.0.0.1:13082` 发出的本地 GET 被 Chrome 以 `net::ERR_ABORTED` 取消；没有外部主机、凭据或 Hpoi 请求。

## 3. 候选图片文件上传

BG-05—BG-08 均为 `pass`。共享 Python `CandidateClient` 通过真实 loopback Next/Payload 服务发送 `multipart/form-data`，而不是只调用内部函数。公开客户端仍只有候选 upsert 和候选媒体上传，没有正式 Work、Character、Manufacturer、FigurePrototype、FigureVersion 或主图写方法。

- 真实 HTTP 首次候选 upsert 的 `created` 为 `[true, true]`，重复执行为 `[false, false]`；multipart 首次/重复上传为 `[true, false]`，改文件名后的相同内容仍返回同一 media ID。
- 服务端从实际文件字节识别 PNG/JPEG，验证声明的 content type、文件大小、宽高、SHA-256 和 64 位 aHash；上限为 64 KiB。
- 原图进入专用候选媒体记录，并通过 Sharp 真实生成 `thumbnail` 和 `preview` 派生图；本项只证明本地 Payload upload/Storage 路径，不证明 S3。
- 同内容原样重试及改文件名重试复用同一内容记录；在复用同一幂等键时改变内容会明确返回 409，不会静默覆盖既有内容。
- 非图片文本、超限文件、声明 MIME 与实际不符均在正式数据变更前被拒绝；随后合法重试可创建仅候选媒体，正式 FigurePrototype 数量不变。
- 候选客户端的正式主图攻击在真实 loopback HTTP 返回 403，媒体保持 `selectedAsMain=false`；只有工作项范围内的人工审核 service 可以完成主图选择。

测试证据：`tests/integration.test.ts::closes the synthetic multipart candidate-media loop with validation, hashes, renditions, dedupe and retry`、`scripts/live_python_client_smoke.py` 与 [`payload-loopback.json`](evidence/val02b/payload-loopback.json)。

## 4. 候选客户端身份

BG-10—BG-12 均为 `pass`。

- 每个客户端有独立 `candidateClientID`、active/disabled 状态和运行时 token；数据库只保存 SHA-256 token digest，明文 token 只在创建时提供给当前运行时，不写报告或仓库。
- candidate upsert 与 multipart upload 都在服务端重新读取当前 client，执行身份、状态、owner 和操作类型检查；授权逻辑不以监听地址或请求来源 IP 作为信任依据。
- 无 token、错误 token、已撤销 token 均被拒绝；撤销动作写入 OperationLog，已经构造的旧 request 也必须通过服务端最新状态复核。
- 候选 endpoint、collection access 和字段 hook 均拒绝 FigurePrototype、FigureVersion 和主图写入；真实主图攻击返回 403。
- 本轮真实 socket 验证按安全要求只绑定 loopback，没有从另一台主机执行 LAN 请求；“非 loopback 仍拒绝未授权请求”的证据来自与地址无关的服务端鉴权路径和攻击自动测试，而不是一次真实远程网络绑定。

## 5. Owner 归属隔离

BG-09 为 `pass`。CandidateRecord 和上传媒体均绑定 candidate client owner；服务端从当前有效凭据导出 client identity，不信任请求体声明。攻击测试证明客户端 A 创建的来源、候选和候选媒体不能被客户端 B upsert 或追加图片，跨 owner 媒体请求返回 403，正式记录和主图保持不变。归属检查同时覆盖专用 JSON upsert、multipart endpoint 和 server-side collection boundary，不依赖调用端自律。

## 6. ReviewWorkItem 与目标权限

BG-13 为 `pass`。最小 ReviewWorkItem 保存候选、允许目标集合、审核人、状态、乐观锁版本、开始/完成时间和决定理由。

- 每次 review handler 写操作必须携带 `workItemID` 和 `expectedVersion`；缺失工作项上下文、候选不匹配或目标超出 allowed targets 均在正式写入前被拒绝。
- 新目标不能通过任意 `allowCreateTarget` 绕过：只能由 `createFormalTargetForReview` 在同一事务中创建正式原型并扩展当前工作项的允许集合。
- 工作项完成后普通入口不能继续修改；显式 reopen 才能恢复为 open，并新增 OperationLog。
- 浏览器审核和 service 测试均通过受控领域路径写正式数据；没有让 Payload 通用 Admin CRUD 承担跨记录审核操作。

## 7. 双管理员并发

BG-14 为 `pass`。两个管理员以相同 `expectedVersion` 修改同一 ReviewWorkItem 或 FigurePrototype 时，第一笔成功并推进版本；第二笔得到 HTTP 409/明确 `version conflict`，不会静默覆盖，且失败请求不会留下部分正式变更。此处是在 SQLite 回归环境验证的乐观锁语义，不等同于 PostgreSQL 的真实并发/行锁验证。

## 8. merge、split 与指定 undo

BG-15、BG-16 均为 `pass`。

- merge/split 操作都有稳定 UUID `operationID`、原型作用域、版本和依赖列表；唯一公开撤销动作要求指定 `operationID`，原有“撤销全局最近一次”路径已经移除。
- 场景 A：管理员 A 对 X/Y merge，管理员 B 对无关 M/N split；按各自 ID 撤销后，两组关系分别恢复且互不干扰。
- 场景 B：两个管理员对同一原型使用陈旧版本时，第一笔成功，第二笔被明确拒绝；数据和 OperationLog 保持第一笔后的状态。
- 场景 C：显式 `dependsOn` 会阻止直接撤销前置 merge；即使调用端遗漏依赖元数据，后续 active operation 与前置操作作用域重叠时也会阻止不安全撤销。必须先撤销依赖操作，再撤销前置操作。
- 关系修改、版本更新和 OperationLog 通过 Payload transaction 边界执行；本轮未取得 PostgreSQL 事务实现证据。

## 9. 最小管理入口

BG-30 为 `pass`。Payload Admin 提供候选审核页和 `Domain operations` 命令台。命令台覆盖：

- Work；Character 和 aliases；Manufacturer 新建与状态；FigurePrototype；FigureVersion；SystemSetting；
- SourceRecord 失效/恢复；CandidateRecord、CandidateImage 与 ReviewWorkItem 审核；OperationLog 只读；
- merge、split、按 operation ID undo；正式条目隐藏/恢复；主图人工选择；已完成工作项 reopen；candidate client 撤销。

所有变更动作要求管理员、理由和领域 service，并生成 OperationLog。正式 collections 和 SystemSettings 的通用 create/update/delete 默认关闭，OperationLog append-only；CandidateRecord、SourceRecord、Media 也不能通过通用 CRUD 绕过专用 endpoint。测试逐项证明管理员的合法维护命令仍可用，而 Generic REST/Local/Admin CRUD 不能绕开领域 service、主图保护或审计边界。这个入口证明了最小可操作性，不代表完成正式后台 UI 设计。

## 10. PostgreSQL

BG-17—BG-19 均为 `environment_blocked`。本机没有 `psql`、PostgreSQL Windows 服务或 loopback 5432 listener；Docker daemon 不可用，任务又禁止安装 Docker、启动或修改系统服务。因此没有执行 PostgreSQL fresh/repeated migration、两次 seed、共享合同或 PostgreSQL JSON/CSV 导出。

SQLite 下的 2 个 migration、重复 seed、44 项测试及 JSON/CSV 导出可作为功能回归证据，但不能替代 PostgreSQL 门禁，也不能证明 PostgreSQL adapter、锁或恢复行为。

## 11. S3 兼容对象存储

BG-23—BG-28 均为 `environment_blocked`。本机没有 MinIO/mc 或 loopback 9000/9001 listener，Docker daemon 不可用；没有使用真实云 bucket 或凭据。因而未实际验证 S3 原图上传/读取、派生图 I/O、去重、来源删除后的对象保留、服务中断/恢复、URL/prefix 变化、迁移或签名 URL。

Payload 官方 S3 plugin 的可选配置边界、Hpoi endpoint guard、本地媒体 content-addressed `storageKey`、Sharp 派生图、同内容去重、来源 URL 改变后正式主图与 storage key 不变均已验证。这些只是补充信号，不能将任何 S3 门禁写为通过。

## 12. 数据导出、备份与恢复

BG-20—BG-22 均为 `environment_blocked`。没有 PostgreSQL 可用于临时备份、删除重建、空库恢复及恢复后合同重跑，因此未产生备份文件、哈希、恢复记录数或恢复时间。

SQLite 回归中，开放 JSON 和 9 个 CSV 可重新解析，包含关系 ID、ReviewWorkItem、OperationLog UUID/作用域、SystemSetting、storage key、SHA-256 与 aHash；不包含媒体二进制、明文 token 或 token digest。正式主图引用和来源 URL 变化后的 storage key 保持稳定。这证明导出结构存在，不证明 PostgreSQL 备份/恢复闭环。

## 13. 非生产部署

BG-29 为 `environment_blocked`。本轮补充执行了 production `next build`，并从 `.next/standalone` 通过 `node .next/standalone/server.js` 在 loopback 启动；health、首页、Payload Admin 和静态资源真实返回 HTTP 200，且不依赖 `next dev`。但是缺少可用 PostgreSQL 与 S3，未能从干净环境启动用户指定的完整生产形态。因此没有可比较的完整冷生产启动时间、热页面响应或部署步骤数，且未部署云服务器。

## 14. Payload standalone 与 NFT tracing 结论

- `next.config.mjs` 使用 `output: 'standalone'`；`npm start` 最终固定为 `node .next/standalone/server.js`，不是开发服务器。
- production build 和 standalone loopback smoke 均实际成功；`/health`、首页、`/admin` 与静态资源返回 HTTP 200。
- standalone tracing 中包含 Sharp 所需的 `sharp`/`@img` 原生文件；本轮 build 没有观察到 NFT tracing 警告，也没有发现因 tracing 缺文件导致的启动错误。
- `Media` 的默认目录用有界运行目录和 tracing hint，`outputFileTracingIncludes` 显式覆盖 Sharp 原生依赖。Payload Admin 使用本地默认 avatar，避免 Gravatar 外联；Payload telemetry 为 `false`。
- 构建产物、运行数据库和媒体均只存在于临时目录或被 Git ignore，没有提交；运行服务在测试后停止。

证据：[`infrastructure-gates.json`](evidence/val02b/infrastructure-gates.json)、[`payload-remediation-log.json`](evidence/val02b/payload-remediation-log.json) 与 `tests/configuration.test.ts`。验证期间曾真实发现并修复四个问题：`next start` 与 standalone 配置不兼容、默认 Gravatar 外联尝试、live probe 与 seed 来源身份冲突，以及 Playwright 严格选择器歧义。最终 `npm run start`、真实 loopback client 和三项 Chrome 测试全部通过；Hpoi 尝试始终为 0。修复日志不包含凭据或完整服务日志。这些结果关闭了 standalone/NFT tracing 的局部不确定性，但由于 PostgreSQL 与 S3 未实际接入，不能据此把 BG-29 写为通过。

## 15. 重新统计

以下数字来自 VAL-02B 当前源代码重新统计，不沿用 VAL-02：

| 指标 | Payload CMS + Next.js 实测/状态 |
| --- | ---: |
| 自定义业务实现 LOC | 6,019 |
| 测试 LOC | 2,885（3 个测试模块） |
| Admin UI 定制 LOC | 641 |
| 候选 endpoint/service LOC | 1,439 |
| migration 数量 | 2 |
| 直接依赖 | 9 |
| Vitest | 44/44 通过 |
| TypeScript / ESLint / build | typecheck、ESLint、production build 均通过 |
| 本地应用进程 | 1 个 Next standalone Node 进程 |
| 浏览器候选审核 | 1,560 ms；6 次点击；5 次导航 |
| 浏览器图库流程 | 4,189 ms；15 次点击；22 次导航；9 个本地导航取消 |
| 文件导入 | 真实 loopback multipart 通过；未单独记录可靠耗时 |
| merge/split/undo | 每项一个审计命令提交；未单独记录浏览器耗时 |
| 冷生产启动/热页面 | standalone smoke 通过，但未取得完整生产形态的可比较数据 |
| 非生产部署步骤 | 环境阻塞，未统计 |

实现 LOC 排除测试、migration、生成的 Payload types/import map、运行时文件和生成的 acceptance JSON；Admin LOC 为自定义 Admin review/domain operation 组件；endpoint/service LOC 为 candidate upsert/upload/review、管理员领域 endpoint、身份与领域 service。直接依赖按 `package.json` 的 9 个 `dependencies` 计数。

## 16. 三十项 BG 门禁

| ID | 状态 | 核心证据或阻塞项 |
| --- | --- | --- |
| BG-01 | `pass` | Playwright/Chrome 临时管理员真实登录 |
| BG-02 | `pass` | Playwright 完整候选审核、版本归入和 OperationLog |
| BG-03 | `pass` | Playwright 灯箱、缩放、当前页切换和边界 |
| BG-04 | `pass` | 三 viewport computed grid 为 4/3/2，图片 `contain` |
| BG-05 | `pass` | 共享 Python client 真实 loopback multipart 上传 |
| BG-06 | `pass` | 服务端从文件字节验证 SHA-256、aHash、尺寸和格式 |
| BG-07 | `pass` | 同内容改名仍复用同一媒体；幂等键内容冲突返回 409 |
| BG-08 | `pass` | 非图片/超限/MIME 不符拒绝；合法重试不产生正式残缺记录 |
| BG-09 | `pass` | 服务端 owner 强制检查，A 不能修改 B 候选或媒体 |
| BG-10 | `pass` | 独立 digest 凭据、active/disabled 和撤销审计 |
| BG-11 | `pass` | 候选 endpoint 和 generic CRUD 都不能写正式数据 |
| BG-12 | `pass` | 候选身份不能设置或替换正式主图；真实攻击为 HTTP 403 |
| BG-13 | `pass` | ReviewWorkItem/expectedVersion/allowed target 强制校验 |
| BG-14 | `pass` | 陈旧管理员提交 HTTP 409，无静默覆盖或部分变更 |
| BG-15 | `pass` | 稳定 operation ID 可指定撤销 merge/split |
| BG-16 | `pass` | 无关作用域独立撤销；显式依赖或作用域重叠阻止前置撤销 |
| BG-17 | `environment_blocked` | 无 PostgreSQL/可运行 Docker，未做 fresh migration |
| BG-18 | `environment_blocked` | 无 PostgreSQL，未做两次 seed 幂等验证 |
| BG-19 | `environment_blocked` | 无 PostgreSQL，SQLite 导出不替代本门禁 |
| BG-20 | `environment_blocked` | 无 PostgreSQL，未创建临时数据库备份 |
| BG-21 | `environment_blocked` | 无 PostgreSQL，未执行空库恢复 |
| BG-22 | `environment_blocked` | 无 PostgreSQL 恢复实例，未重跑恢复后合同 |
| BG-23 | `environment_blocked` | 无本地 S3/可运行 Docker，未真实上传原图 |
| BG-24 | `environment_blocked` | 无本地 S3，未真实读取并核对字节 |
| BG-25 | `environment_blocked` | 本地 Sharp 派生图通过，但 S3 派生图闭环未执行 |
| BG-26 | `environment_blocked` | 本地主图引用保持通过，但对象存储删除场景未执行 |
| BG-27 | `environment_blocked` | 无本地 S3 服务，未执行中断与恢复 |
| BG-28 | `environment_blocked` | 本地 storage key 信号不替代 S3 URL/prefix 验证 |
| BG-29 | `environment_blocked` | standalone smoke 通过，但缺 PostgreSQL/S3 完整生产形态 |
| BG-30 | `pass` | 完整最小审计命令入口 + generic CRUD 绕过攻击被拒 |

汇总：**17 pass / 0 fail / 0 not_run / 13 environment_blocked**。

## 17. 硬门禁与阶段结论

Payload CMS + Next.js 本轮硬门禁失败数为 **0**：没有观察到候选身份写正式数据/替换主图、跨 owner 越权、merge/split/undo 关系断裂或管理入口绕过 OperationLog。Generic CRUD 的 create/update/delete 不能绕开受控 service，服务端身份检查也不依赖 loopback 作为授权条件。

不过 PostgreSQL 恢复一致性、S3 来源删除保护和从干净环境启动完整生产形态这 3 个硬门禁因环境而未执行，不能据“0 个 hard fail”、SQLite 回归或 standalone smoke 推断它们已经通过。Payload 的浏览器审核、候选文件闭环、客户端隔离、工作项目标约束、乐观冲突、指定 undo、最小管理入口和 standalone/NFT 局部风险已经取得直接证据；生产数据库、对象存储、备份恢复和完整非生产部署仍是关键未解决风险。本报告不选择最终技术栈，不建立正式项目，不部署，也不开始后续阶段。
