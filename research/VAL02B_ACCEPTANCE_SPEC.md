# VAL-02B 技术决策门禁验收规范

## 1. 范围与证据边界

VAL-02B 只对 `spikes/val02_wagtail/` 与 `spikes/val02_payload/` 做影响最终技术决策的
最小补充验证。它不把任一 spike 迁移为正式项目，不开发正式产品，也不部署云资源。
所有角色、作品、厂商、候选、图片和管理员操作均使用离线合成数据；图片只在临时
运行目录动态生成，不进入 Git。

本轮禁止访问 `hpoi.net` 及任意子域。共享网络 guard 必须在 DNS/transport 之前拒绝
目标；任何 Hpoi 请求尝试都触发停止条件。

## 2. 状态定义

每个原型必须为 BG-01—BG-30 输出一个且仅一个状态：

- `pass`：真实自动测试、浏览器操作或本地基础设施验证已经成功执行；
- `fail`：验证已执行，但结果不满足门禁；
- `not_run`：非环境原因导致本轮未执行，必须给出具体 blocker；
- `environment_blocked`：缺少本机既有基础设施或工具，且任务禁止安装/修改系统，
  必须记录探测证据，不能按通过计分。

每项必须链接到测试名、机器结果或小型日志摘要。静态源码检查不能冒充真实浏览器、
PostgreSQL、对象存储、备份恢复或生产启动证据。

## 3. 环境前提

- 浏览器优先使用项目局部 Playwright 的 `channel="chrome"` 和本机 Chrome；失败后才
  允许使用项目局部 Chromium。不得依赖 ChatGPT Chrome 扩展或 native host。
- PostgreSQL 与 S3 只有在本机已有可用服务，或已安装且正在正常运行的 Docker/
  Compose 可启动 loopback-only 临时容器时执行。不得安装 Docker、修改系统服务、
  使用生产数据库、真实云 bucket 或生产凭据。
- 所有运行时 secret、管理员密码和 client token 仅在当前测试进程生成；仓库只保存
  不含秘密的摘要。数据库、备份、媒体、对象、截图、视频、完整日志和构建产物只放
  系统临时目录，并在验证后删除。

## 4. 三十项补充门禁

| ID | 门禁 | 最低证据 |
| --- | --- | --- |
| BG-01 | 真实浏览器管理员登录 | Playwright 使用临时管理员登录并到达受保护后台 |
| BG-02 | 完整候选审核流程 | 预览多图、接受/拒绝字段、选择或新建目标、选主图、理由、发布/归版本和 OperationLog |
| BG-03 | 灯箱、缩放和当前页切换 | 真实点击打开/关闭/缩放/上一张/下一张及首尾边界 |
| BG-04 | 4/3/2 响应式布局 | 三种 viewport 的 computed grid 列数与图片固有比例 |
| BG-05 | 合成图片 multipart 上传 | 共享 Python client 实际发送 multipart，文件进入候选媒体区 |
| BG-06 | 文件 SHA-256 与感知哈希 | 服务端从实际字节计算/验证 SHA-256、aHash、格式和尺寸 |
| BG-07 | 同内容重复上传幂等 | 改文件名/URL后的相同内容复用同一媒体内容身份 |
| BG-08 | 上传失败可重试且无残缺正式记录 | 非图片、超限、类型不符/中断被拒，重试成功且正式数据不变 |
| BG-09 | 客户端 A 不能修改客户端 B 候选 | 服务端 owner 强制检查及跨客户端攻击测试 |
| BG-10 | 客户端凭据可撤销 | 已撤销/disabled 凭据被拒，明文 token 不落库、不提交 |
| BG-11 | 候选身份不能写正式数据 | FigurePrototype/FigureVersion/正式维护及通用 CRUD 攻击被拒 |
| BG-12 | 候选身份不能替换主图 | endpoint、service/hook 双边界及主图引用不变 |
| BG-13 | 审核目标属于工作项允许范围 | ReviewWorkItem allowed-target 或明确新建动作强制校验 |
| BG-14 | 双管理员并发产生明确冲突 | optimistic version/行锁测试，后提交失败且不静默覆盖 |
| BG-15 | 可指定撤销某次 merge/split | 稳定 operation ID 的指定 undo 自动测试 |
| BG-16 | 撤销不是全局最近一次 | 两组无关操作按各自 ID 撤销且互不干扰；依赖操作阻止前置撤销或明确级联 |
| BG-17 | PostgreSQL fresh migration | 独立空数据库/schema 的真实 migration |
| BG-18 | PostgreSQL seed 幂等 | 两次 seed 的记录 ID、数量和关系一致 |
| BG-19 | PostgreSQL JSON/CSV 导出 | 开放导出可解析并覆盖 ReviewWorkItem/OperationLog/media manifest |
| BG-20 | 数据库备份 | 临时备份成功并记录哈希/大小，不提交备份 |
| BG-21 | 空数据库恢复 | 删除并重建空数据库后真实恢复 |
| BG-22 | 恢复后共享合同仍通过 | 记录数、关系、主图、来源状态、成人设置及合同重跑一致 |
| BG-23 | S3 上传原图 | loopback S3 兼容存储的真实 PUT/框架存储写入 |
| BG-24 | S3 读取原图 | 真实读取并核对字节哈希 |
| BG-25 | 生成和读取缩略图/预览图 | 派生图真实生成、存储和读取 |
| BG-26 | 删除来源不删除正式主图 | 来源/候选删除或失效后正式 storage key 和对象仍存在 |
| BG-27 | 对象存储不可用时失败可控 | 服务中断不产生半成品，恢复后可重试 |
| BG-28 | storage key 不依赖公开 URL | URL/签名 URL/prefix 变化不改变业务媒体身份 |
| BG-29 | 非生产部署可从干净环境重复启动 | loopback-only、生产模式、干净 DB、health、静态/媒体/Admin 均真实启动，不依赖开发服务器 |
| BG-30 | 正式数据和领域操作有最小管理入口 | Work/Character/alias/Manufacturer/Prototype/Version/Source/Candidate/Image/Setting/WorkItem/Log 及 merge/split/specified undo/hide/restore/main selection 可操作且不可绕过审计 |

## 5. 统一候选文件协议

共享客户端在既有 metadata-only `candidate_upsert` 之外只增加
`candidate_media_upload`。multipart 请求包含 `metadata` JSON 与一个合成图片文件；
metadata 至少包含协议版本、client identity、candidate/client-candidate ID、幂等键、
文件名、content type、尺寸、大小、SHA-256 和感知哈希。client ID 与明文 token 只从
运行时环境读取。

客户端公开 API 不得包含 Character、Manufacturer、FigurePrototype、FigureVersion、
SystemSetting、正式发布或主图写方法。两个原型使用相同的无 token、错误 token、撤销
token、跨 owner、正式实体、主图和通用 CRUD 攻击用例。

## 6. ReviewWorkItem 与操作语义

ReviewWorkItem 至少保存候选、allowed targets、审核人、状态、optimistic version、
开始/完成时间和决定原因。已完成工作项的普通入口不能继续修改；重新打开必须审计。
领域操作必须具有稳定 operation ID、关系作用域、版本和依赖；指定 undo 只能撤销仍
可安全撤销的操作。跨记录写入与 OperationLog 必须位于同一数据库事务或等价原子
边界，冲突必须明确拒绝。

## 7. 硬失败条件

下列任一项出现 `fail`，对应技术栈不得被 ADR 选择：

1. 候选身份可修改正式数据；
2. 候选身份可替换主图；
3. 跨客户端归属隔离失败；
4. merge/split/undo 导致关系断裂；
5. PostgreSQL 恢复后数据不一致；
6. 对象存储因来源删除而丢失正式主图；
7. 生产形态无法从干净环境启动；
8. 管理入口可以绕过 OperationLog。

`environment_blocked` 不等于 `fail`，但不取得相应分数，并降低 ADR 置信度。核心生产
门禁大量受阻时，即使本地功能分数领先，也不得强行选型。

## 8. 九维评分

沿用 VAL-02 固定权重，总计 100：领域模型适配 20、候选审核体验 20、候选与正式
数据隔离 15、merge/split/undo 可控性 15、图片与存储能力 10、前台实现效率 5、
导出与数据迁移性 5、本地和云端运维复杂度 5、许可证和锁定风险 5。

评分必须引用本轮重新执行的 BG、浏览器、代码量、依赖、操作步骤、启动、导出和
基础设施证据；不得直接沿用 VAL-02 分数或 LOC。`fail/not_run/environment_blocked`
均不按通过计分。最终 ADR 只有在胜出方案无硬失败、分数领先、核心生产门禁没有大量
环境阻塞且证据足以支持实际维护时，才能选择具体技术栈，否则必须为 `Undecided`。

## 9. 交付卫生

只提交研究报告、小型脱敏 JSON/CSV/manifest、源代码和测试。禁止提交截图、视频、
数据库、备份、对象、合成图片、token、`.env`、完整服务日志、依赖目录、虚拟环境、
构建产物或生产凭据。最终必须执行共享 VAL-02/VAL-02B 合同、两原型测试、Hpoi guard、
JSON/CSV 解析、凭据/大文件/二进制扫描和 `git diff --check`。
