# VAL-02B Wagtail 定向门禁结果

## 1. 范围与环境

- 测试日期：2026-07-14；环境：Windows、Python 3.10.9、Django 5.2.16、Wagtail 7.4.2。
- 本目录仍是 `spikes/val02_wagtail/` 下的可丢弃验证，不是正式项目，也不表示已经选择 Wagtail。
- 所有领域记录和 PNG/JPEG 均为离线合成 fixture；图片只在临时运行目录动态生成，没有提交图片、数据库、备份、对象或运行时凭据。
- Hpoi 网络 guard 保持启用；本轮 Hpoi 请求和请求尝试均为 0。
- 真实 Chrome、Wagtail 功能和 SQLite 回归可运行；Docker/Compose 只有客户端而 daemon 不可用，且没有 PostgreSQL 客户端、服务或 5432 监听，也没有 MinIO/S3 服务或 9000/9001 监听。因此 BG-17—BG-29 按规范全部为 `environment_blocked`，不得由 SQLite、本地文件存储或 WSGI smoke 替代。

机器证据：[`val02b-acceptance-results.json`](../spikes/val02_wagtail/val02b-acceptance-results.json)、[`environment.json`](evidence/val02b/environment.json)、[`wagtail-browser.json`](evidence/val02b/wagtail-browser.json)、[`MEASUREMENTS.md`](../spikes/val02_wagtail/MEASUREMENTS.md)。

## 2. 真实浏览器

Playwright 1.61.1 通过 `channel="chrome"` 控制本机 Chrome 150.0.7871.102，headless 运行；未下载 Chromium，未使用控制扩展或 native host，也未提交截图、视频或完整浏览器报告。

### 2.1 后台审核

- BG-01 管理员登录：`pass`；1,666 ms、1 次点击、2 次主 frame 导航。
- BG-02 完整审核：`pass`；5,896 ms、6 次点击、8 次主 frame 导航。
- 同一工作项真实完成：打开候选、预览至少两张候选图、接受标题、拒绝比例字段、选择允许的正式目标、人工选择主图、归入版本、填写每步理由、完成工作项，并确认 OperationLog 数量大于 0。
- 审核流程没有控制台错误、网络失败或被 network guard 拒绝的请求；审核测试未使用键盘动作。因本次浏览器流程没有发生错误，所以没有浏览器内错误恢复步骤可计；上传失败与重试由后述服务/HTTP 测试覆盖。

### 2.2 前台图库

- BG-03、BG-04 均为 `pass`；完整图库流程 5,406 ms、15 次点击、1 次键盘操作、13 次主 frame 导航。
- 实测首页搜索、唯一角色直达、同名角色按作品消歧、分页（第 1 页 2 张、第 2 页 1 张）、桌面/平板/手机 computed grid 4/3/2 列。
- 图片使用 `object-fit: contain`，样本固有尺寸和显示尺寸均被读取；灯箱真实点击覆盖打开、缩放、当前页上一张/下一张、首尾循环边界、关闭按钮与 Escape 关闭。
- 成人图默认隐藏；通过审计的后台设置动作后可显示。前台没有下载按钮，也没有图片详情面板。
- 浏览器期间控制台错误、网络失败、禁止域请求和 Hpoi 请求尝试均为 0。

## 3. 候选图片文件上传

BG-05—BG-08 均为 `pass`。共享 Python `CandidateClient.upload_candidate_image` 通过真实 loopback `LiveServerTestCase` 发送 `multipart/form-data`，而不是只调用内部函数。公开客户端仍只有候选 upsert 和候选媒体上传，没有正式 Work、Character、Manufacturer、FigurePrototype、FigureVersion 或主图写方法。

- 服务端从实际文件字节识别 PNG/JPEG，验证声明的 content type、文件大小、宽高、SHA-256 和 aHash；上限为 64 KiB。
- 原图进入专用 Wagtail Images collection，并真实生成 `fill-64x64` 缩略图和 `max-320x320` 预览图；本项只证明本地 Django Storage 路径，不证明 S3。
- 同内容原样重试返回既有 CandidateImage；改文件名和幂等键但字节不变仍复用同一内容记录。文件名相同而内容变化会产生新的 SHA-256 和媒体记录。
- 非图片文本、超限文件、声明 MIME 与实际不符均返回 400；记录数不变。模拟 OperationLog 写入失败时数据库事务回滚且新文件被清理，随后用同一幂等键重试成功。
- 候选客户端不能把上传图片直接设为正式主图；只有工作项范围内的人工审核服务可以完成主图选择。

测试证据：`Val02bIdentityAndMediaTests.test_multipart_upload_hash_renditions_receipts_and_content_deduplication`、`test_upload_rejections_are_atomic_and_retry_succeeds`、`Val02bRealLoopbackCandidateClientTests.test_shared_candidate_client_uploads_and_retries_over_real_http`。

## 4. 候选客户端身份

BG-10—BG-12 均为 `pass`。

- 每个客户端有独立 `client_id`、active/disabled 状态和 bearer secret；数据库只保存 SHA-256 token digest，明文 token 只在创建时返回给运行时调用者一次。
- metadata upsert 与 multipart upload 都在服务端执行身份、状态、owner 和操作类型检查；loopback 限制只是 spike 的纵深防御，不是授权依据。
- 无 token、错误 token、已撤销 token 均被拒绝；撤销动作写入 OperationLog。
- 协议和服务均拒绝 FigurePrototype、FigureVersion 和主图字段；通用 Wagtail Snippet 的 add/change/delete 即使对 superuser 也为只读，候选身份没有通用正式数据写面。

## 5. Owner 归属隔离

BG-09 为 `pass`。CandidateRecord 和上传回执均绑定 CandidateClientCredential；服务端以 owner 校验稳定来源与 `client_candidate_id`。攻击测试证明客户端 A 创建的候选不能被客户端 B 更新，跨 owner 请求返回拒绝且原候选标题、正式记录数量和正式主图保持不变。归属检查同时覆盖 JSON upsert 与 multipart 上传，不依赖调用端自律。

## 6. ReviewWorkItem 与目标权限

BG-13 为 `pass`。最小 ReviewWorkItem 保存候选、允许目标集合、审核人、状态、乐观锁版本、开始/完成时间、决定理由和 reopen 次数。

- 字段决定和主图选择只能作用于工作项允许的正式目标；外部目标及不属于当前候选的图片被拒绝。
- 工作项完成后普通决定入口不能继续修改；显式 reopen 才能恢复为 open，并新增审计记录。
- 浏览器审核和服务测试均通过领域 service 写正式数据；没有让 Snippet 的普通 model save 承担跨记录操作。

## 7. 双管理员并发

BG-14 为 `pass`。两个管理员以相同 `expected_version` 修改同一 ReviewWorkItem 或 FigurePrototype 时，第一笔成功并增加版本；第二笔得到明确 `conflict`，不会静默覆盖，且失败请求不会新增 OperationLog。此处是在 SQLite 回归环境验证的乐观锁语义，不等同于 PostgreSQL 的真实并发/行锁验证。

## 8. merge、split 与指定 undo

BG-15、BG-16 均为 `pass`。

- merge/split 操作都有稳定 UUID `operation_id`、作用域、作用域版本和依赖列表；`undo_operation` 必须接收指定 ID，不存在“撤销全局最近一次”的公开入口。
- 场景 A：管理员 A 对 X/Y merge，管理员 B 对无关 M/N split；先撤销较早 merge、再撤销较晚且无关的 split，两组关系分别恢复且互不干扰。
- 场景 B：同一原型的陈旧版本写入被明确拒绝，数据与 OperationLog 保持第一笔成功后的状态。
- 场景 C：后续操作声明依赖前置 merge 时，直接撤销前置操作会因 active dependants 被拒绝；先撤销依赖操作后才可撤销前置操作。
- 关系修改、版本更新与 OperationLog 位于 `transaction.atomic` 边界，并用框架行锁 API；本轮未取得 PostgreSQL 事务实现证据。

## 9. 最小管理入口

BG-30 为 `pass`。Wagtail Admin 提供只读 Snippet 列表、候选审核页和 `Audited domain operations` 命令台。命令台覆盖：

- Work；Character 和 aliases；Manufacturer 新建与状态；FigurePrototype；FigureVersion；SystemSetting；
- SourceRecord 失效/恢复；CandidateRecord、CandidateImage 与 ReviewWorkItem 审核；OperationLog 只读；
- merge、split、按 operation ID undo；正式条目隐藏/恢复；主图人工选择；已完成工作项 reopen。

所有变更动作要求 staff、理由和领域 service，并生成 OperationLog。测试逐个确认 Work、Character、Manufacturer、FigurePrototype、FigureVersion、SourceRecord、CandidateRecord、CandidateImage、SystemSetting、ReviewWorkItem、OperationLog、CandidateClientCredential 和 CandidateUploadReceipt 的通用 Admin add/change/delete 权限均被拒绝。因此这个最小入口证明了审计边界和可操作性，但不代表完成正式后台 UI 设计。

## 10. PostgreSQL

BG-17—BG-19 均为 `environment_blocked`。本机没有 `psql`、PostgreSQL Windows 服务或 loopback 5432 listener；Docker daemon 不可用，任务又禁止安装 Docker、启动/修改系统服务。因此没有执行 PostgreSQL fresh/repeated migration、两次 seed、共享合同或 PostgreSQL JSON/CSV 导出。

SQLite 下的 3 个 migration、重复 seed、70 项测试及 JSON/CSV 导出可作为功能回归证据，但不能替代 PostgreSQL 门禁，也不能证明数据库适配器、锁或恢复行为。

## 11. S3 兼容对象存储

BG-23—BG-28 均为 `environment_blocked`。本机没有 MinIO/mc 或 loopback 9000/9001 listener，Docker daemon 不可用；没有使用真实云 bucket 或凭据。因而未实际验证 S3 原图上传/读取、派生图 I/O、去重、来源删除后的对象保留、服务中断/恢复、URL/prefix 变化、迁移或签名 URL。

本地 FileSystemStorage 已验证 content-addressed key、Wagtail rendition、同内容去重、来源失效后正式主图仍存在及 public URL 不作为业务身份；这些只是补充信号，不能将任何 S3 门禁写为通过。

## 12. 数据导出、备份与恢复

BG-20—BG-22 均为 `environment_blocked`。没有 PostgreSQL 可用于临时备份、删除重建、空库恢复及恢复后合同重跑，因此未产生备份文件、哈希、恢复记录数或恢复时间。

SQLite 回归中，开放 JSON 和多表 CSV 可重新解析，包含关系 ID、ReviewWorkItem、OperationLog UUID/作用域、SystemSetting、storage key、SHA-256 与 aHash；不包含媒体二进制、明文 token 或 token digest。机器结果记录 13 个关系列表。这证明导出结构存在，不证明 PostgreSQL 备份/恢复闭环。

## 13. 非生产部署

BG-29 为 `environment_blocked`。本轮补充执行了 `DEBUG=false` 配置、`collectstatic`、WSGI/health 和本地单进程 smoke，但缺少可用 PostgreSQL 与 S3，未能从干净环境启动用户指定的完整生产形态，也没有验证正式 WSGI/ASGI server、静态/媒体/S3/Admin 的整套重复启动。因此没有冷生产启动时间或部署步骤数，且未部署云服务器。

## 14. Treebeard 结论

采用允许结论 2：锁定明确兼容版本，并设置升级门禁。

- Wagtail 7.4.2 的上游元数据允许 `django-treebeard>=4.8,<6.0`；spike 将直接依赖和 lock 都精确固定为 5.3.0。
- 两条 `treebeard.E001` 仍由 `manage.py check` 可见，`SILENCED_SYSTEM_CHECKS` 为空；没有屏蔽或声称警告无影响。
- `GalleryConfig.ready()` 在安装版本不是 5.3.0 时 fail closed。自动测试实际创建/删除 Page 和 Collection tree 节点，并模拟 6.0.0 以确认升级会被拒绝。
- 上游 issue #44 仍为 Open。Treebeard 6 目前不受支持；升级 Wagtail/treebeard 前必须有意识地重跑 manager、tree mutation、workflow、migration 和 system-check 门禁。

证据：[`treebeard-upstream.json`](evidence/val02b/treebeard-upstream.json)。这控制了当前 spike 的版本漂移，但仍是正式维护的升级风险。

## 15. 重新统计

以下数字来自 VAL-02B 当前源代码重新统计，不沿用 VAL-02：

| 指标 | Wagtail 实测/状态 |
| --- | ---: |
| 自定义业务实现 LOC | 5,263 |
| 测试 LOC | 2,476（5 个测试模块） |
| Admin UI 定制 LOC | 331 |
| 候选 endpoint/service LOC | 1,280 |
| migration 数量 | 3 |
| 直接依赖 | 4 |
| Django 测试 | 70/70 通过 |
| 本地应用进程 | 1 |
| 浏览器候选审核 | 5,896 ms；6 次点击；8 次导航 |
| 浏览器图库流程 | 5,406 ms；15 次点击；13 次导航 |
| 文件导入 | 真实 loopback multipart 通过；未单独记录可靠耗时 |
| merge/split/undo | 每项一个审计命令提交；未单独记录浏览器耗时 |
| 冷生产启动/热页面 | 本轮未取得可比较的生产形态数据 |
| 非生产部署步骤 | 环境阻塞，未统计 |

实现 LOC 排除测试、migration、`__init__.py`、运行时文件和生成的 acceptance JSON；Admin LOC 为 `forms.py`、`wagtail_hooks.py` 和两个自定义后台模板；endpoint/service LOC 为 `views.py`、`candidate_service.py`、`candidate_media.py` 和 `client_identity.py`。

## 16. 三十项 BG 门禁

| ID | 状态 | 核心证据或阻塞项 |
| --- | --- | --- |
| BG-01 | `pass` | Playwright/Chrome 临时管理员真实登录 |
| BG-02 | `pass` | Playwright 完整候选审核、版本归入和 OperationLog |
| BG-03 | `pass` | Playwright 灯箱、缩放、当前页切换和边界 |
| BG-04 | `pass` | 三 viewport computed grid 为 4/3/2，图片 `contain` |
| BG-05 | `pass` | 共享 Python client 真实 loopback multipart 上传 |
| BG-06 | `pass` | 服务端从文件字节验证 SHA-256、aHash、尺寸和格式 |
| BG-07 | `pass` | 同内容改名/换幂等键仍复用同一 CandidateImage |
| BG-08 | `pass` | 非图片/超限/MIME 不符拒绝；事务失败清理且可重试 |
| BG-09 | `pass` | 服务端 owner 强制检查，A 不能修改 B 候选 |
| BG-10 | `pass` | 独立 digest 凭据、active/disabled 和撤销审计 |
| BG-11 | `pass` | 候选协议无正式写面，正式字段与通用写入被拒绝 |
| BG-12 | `pass` | 候选身份不能设置或替换正式主图 |
| BG-13 | `pass` | ReviewWorkItem allowed target 与候选图片归属校验 |
| BG-14 | `pass` | 陈旧版本明确 conflict，无静默覆盖或多余日志 |
| BG-15 | `pass` | 稳定 operation ID 可指定撤销 merge/split |
| BG-16 | `pass` | 无关作用域独立撤销；依赖操作阻止前置撤销 |
| BG-17 | `environment_blocked` | 无 PostgreSQL/可运行 Docker，未做 fresh migration |
| BG-18 | `environment_blocked` | 无 PostgreSQL，未做两次 seed 幂等验证 |
| BG-19 | `environment_blocked` | 无 PostgreSQL，SQLite 导出不替代本门禁 |
| BG-20 | `environment_blocked` | 无 PostgreSQL，未创建临时数据库备份 |
| BG-21 | `environment_blocked` | 无 PostgreSQL，未执行空库恢复 |
| BG-22 | `environment_blocked` | 无 PostgreSQL 恢复实例，未重跑恢复后合同 |
| BG-23 | `environment_blocked` | 无本地 S3/可运行 Docker，未真实上传原图 |
| BG-24 | `environment_blocked` | 无本地 S3，未真实读取并核对字节 |
| BG-25 | `environment_blocked` | 本地 rendition 通过，但 S3 派生图闭环未执行 |
| BG-26 | `environment_blocked` | 本地主图保留通过，但对象存储删除场景未执行 |
| BG-27 | `environment_blocked` | 无本地 S3 服务，未执行中断与恢复 |
| BG-28 | `environment_blocked` | 本地 storage key 信号不替代 S3 URL/prefix 验证 |
| BG-29 | `environment_blocked` | 缺 PostgreSQL/S3，未从干净环境启动完整生产形态 |
| BG-30 | `pass` | 只读通用 Admin + 完整最小审计命令入口 |

汇总：**17 pass / 0 fail / 0 not_run / 13 environment_blocked**。

## 17. 硬门禁与阶段结论

Wagtail 本轮硬门禁失败数为 **0**：没有观察到候选身份写正式数据/替换主图、跨 owner 越权、merge/split/undo 关系断裂或管理入口绕过 OperationLog。不过 PostgreSQL 恢复一致性、S3 来源删除保护和干净生产启动对应门禁均因环境而未执行，不能据“0 个 hard fail”推断它们已经通过。

Wagtail 的浏览器审核、候选文件闭环、客户端隔离、工作项目标约束、乐观冲突、指定 undo 和最小管理入口已经取得直接证据；生产数据库、对象存储、备份恢复和完整非生产部署仍是关键未解决风险。本报告不选择最终技术栈，不建立正式项目，不部署，也不开始后续阶段。
