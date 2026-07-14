# VAL-02B Wagtail 与 Payload CMS + Next.js 补充门禁比较

## 1. 比较范围与证据边界

本比较记录 2026-07-14 在 Windows 本机、离线合成数据上的 VAL-02B 结果。两个原型使用同一份 30 项 BG 合同、同一组攻击用例、同一共享 Python 候选客户端和同一套 Playwright 浏览器脚本。机器结果的合同与 fixture 哈希一致，双端 acceptance pair 有效。

- Wagtail：**17 pass / 0 fail / 0 not_run / 13 environment_blocked**；
- Payload CMS + Next.js：**17 pass / 0 fail / 0 not_run / 13 environment_blocked**；
- 两端已执行硬门禁均无失败，但 PostgreSQL 恢复一致性、对象存储中的正式主图保留、干净环境完整生产启动三族硬门禁都因环境受阻而仍是未知；
- Docker/Compose CLI 存在，但 Docker daemon 不可用；本机没有可用 PostgreSQL 或 loopback S3 服务。因此 BG-17—BG-29 不以 SQLite、本地文件存储或单机 smoke 代替；
- 本轮 Hpoi 请求及请求尝试为 0，只使用运行时生成的合成图片，未提交图片、数据库、备份、对象、凭据、截图、视频或构建产物。

核心证据：

- [VAL02B_ACCEPTANCE_SPEC.md](VAL02B_ACCEPTANCE_SPEC.md)
- [VAL02B_WAGTAIL_RESULTS.md](VAL02B_WAGTAIL_RESULTS.md)
- [VAL02B_PAYLOAD_RESULTS.md](VAL02B_PAYLOAD_RESULTS.md)
- [Wagtail acceptance JSON](../spikes/val02_wagtail/val02b-acceptance-results.json)
- [Payload acceptance JSON](../spikes/val02_payload/val02b-acceptance-results.json)
- [双端结果校验摘要](evidence/val02b/val02b-pair-summary.json)
- [环境探测](evidence/val02b/environment.json)
- [Wagtail 浏览器证据](evidence/val02b/wagtail-browser.json)
- [Payload 浏览器证据](evidence/val02b/payload-browser.json)
- [Payload 真实 loopback 客户端证据](evidence/val02b/payload-loopback.json)

## 2. 三十项 BG 逐项比较

| 门禁 | Wagtail | Payload CMS + Next.js | 比较结论 |
| --- | --- | --- | --- |
| BG-01 真实浏览器管理员登录 | `pass`：Chrome 登录 1,666 ms，1 次点击 | `pass`：Chrome 登录 1,582 ms，1 次点击 | 均为真实 Chrome；Payload 样本略快，不构成容量结论 |
| BG-02 完整候选审核流程 | `pass`：5,896 ms，6 次点击，8 次主 frame 导航 | `pass`：1,560 ms，6 次点击，5 次主 frame 导航 | 均完成字段接受/拒绝、允许目标、主图、理由、归版本和 OperationLog；Payload 本次 fixture 更快 |
| BG-03 灯箱、缩放及当前页切换 | `pass`：真实点击覆盖打开、缩放、前后切换、边界和关闭 | `pass`：同一浏览器脚本全部通过 | 功能等价；Wagtail 无网络失败，Payload 在反复导航期间记录 9 次 loopback `ERR_ABORTED`，无外部请求 |
| BG-04 4/3/2 响应式布局 | `pass`：computed columns 4/3/2，图片 `contain` | `pass`：computed columns 4/3/2，图片 `contain` | 等价；均验证分页、成人图设置、无下载按钮及无详情面板 |
| BG-05 合成图片 multipart 上传 | `pass`：共享 Python client 经真实 Django loopback socket 上传 | `pass`：共享 Python client 经真实 Next/Payload loopback socket 上传 | 均关闭真实 HTTP 文件导入闭环，仅进入候选媒体区 |
| BG-06 SHA-256 与感知哈希 | `pass`：服务端由字节校验 SHA-256、aHash、MIME、尺寸 | `pass`：服务端由字节校验同一字段集合 | 等价；两端 aHash 语义已与共享 Python fixture 对齐 |
| BG-07 同内容重复上传幂等 | `pass`：改名或改幂等键仍复用内容身份 | `pass`：改名后复用 media ID；同键不同内容返回 409 | 均以内容身份去重，不依赖公开 URL 或文件名 |
| BG-08 失败可重试且无残缺正式记录 | `pass`：文本、超限、MIME 不符被拒，事务失败清理后可重试 | `pass`：相同拒绝用例在正式记录变更前结束，合法重试成功 | 等价；候选上传失败不能污染正式数据 |
| BG-09 跨客户端 owner 隔离 | `pass`：服务端拒绝 A 修改 B | `pass`：专用 handler 与通用路径均拒绝 A 修改 B | 等价；归属校验不依赖客户端自律或 loopback 绑定 |
| BG-10 凭据可撤销 | `pass`：每客户端独立、只存 digest，disabled 后拒绝并审计 | `pass`：每客户端 hash-only 凭据，服务端撤销后返回 403 | 等价；明文 token 只存在于运行时且未提交 |
| BG-11 候选身份不能写正式数据 | `pass`：候选协议无正式写面，通用 Admin 正式写被关闭 | `pass`：专用 endpoint 与 generic CRUD 攻击均被拒绝 | 等价；当前已执行硬门禁通过 |
| BG-12 候选身份不能替换主图 | `pass`：仅审核领域服务可人工选择主图 | `pass`：主图攻击返回 403，候选媒体未被标为正式主图 | 等价；当前已执行硬门禁通过 |
| BG-13 审核目标受工作项范围约束 | `pass`：ReviewWorkItem allowed targets 与图片归属均强制校验 | `pass`：缺少工作项、过期版本及越界目标均在正式写入前拒绝 | 等价；新目标只能经显式、原子的审核动作创建 |
| BG-14 双管理员并发冲突 | `pass`：陈旧 `expected_version` 明确冲突，无多余日志 | `pass`：后提交者得到 version conflict，不静默覆盖 | SQLite 上的乐观锁语义均通过；真实 PostgreSQL 并发仍未验证 |
| BG-15 按 operation ID 指定 undo | `pass`：merge/split 产生稳定 UUID，可分别指定撤销 | `pass`：merge/split 产生稳定 UUID，可分别指定撤销 | 等价；不依赖全局最近一次操作 |
| BG-16 非全局 undo 与依赖保护 | `pass`：无关作用域互不干扰，active dependant 阻止前置撤销 | `pass`：显式依赖及作用域重叠后备校验阻止不安全撤销 | 等价；关系、版本和 OperationLog 处于框架事务边界，PostgreSQL 原子性待证 |
| BG-17 PostgreSQL fresh migration | `environment_blocked` | `environment_blocked` | 无 Docker daemon、PostgreSQL 客户端/服务或 5432 listener；未执行 |
| BG-18 PostgreSQL seed 幂等 | `environment_blocked` | `environment_blocked` | SQLite 重复 seed 只作补充信号，不能替代本门禁 |
| BG-19 PostgreSQL JSON/CSV 导出 | `environment_blocked` | `environment_blocked` | 两端 SQLite 导出可解析，但未在 PostgreSQL 执行 |
| BG-20 数据库备份 | `environment_blocked` | `environment_blocked` | 未创建 PostgreSQL 临时备份，未取得备份哈希和耗时 |
| BG-21 空数据库恢复 | `environment_blocked` | `environment_blocked` | 未执行删除、重建空库和恢复 |
| BG-22 恢复后共享合同 | `environment_blocked` | `environment_blocked` | 恢复后关系、主图、来源状态和成人设置一致性未知；这是硬门禁族 |
| BG-23 S3 原图上传 | `environment_blocked` | `environment_blocked` | 无 MinIO/loopback S3 或可用 Docker daemon；未执行真实对象写入 |
| BG-24 S3 原图读取 | `environment_blocked` | `environment_blocked` | 未从对象存储读取并核对字节哈希 |
| BG-25 S3 派生图生成与读取 | `environment_blocked` | `environment_blocked` | 两端本地缩略图/预览图通过，但不能替代 S3 派生图闭环 |
| BG-26 来源删除不丢正式主图 | `environment_blocked` | `environment_blocked` | 本地保留信号通过，真实对象生命周期未验证；这是硬门禁族 |
| BG-27 对象存储中断失败可控 | `environment_blocked` | `environment_blocked` | 未执行服务中断、无半成品及恢复后重试 |
| BG-28 storage key 不依赖公开 URL | `environment_blocked` | `environment_blocked` | 本地 content-addressed key 只作补充信号，未验证 S3 URL/prefix 变化和对象迁移 |
| BG-29 干净环境非生产部署 | `environment_blocked` | `environment_blocked` | 两端均缺 PostgreSQL/S3 完整生产形态；这是硬门禁族 |
| BG-30 最小正式管理入口 | `pass`：只读通用 Admin + audited domain operations | `pass`：候选审核与 domain command UI，generic formal CRUD 关闭 | 均覆盖规定实体与 merge/split/specified undo/settings/hide/restore/main selection，写入必须留 OperationLog |

## 3. 硬门禁比较

| 硬门禁 | Wagtail | Payload CMS + Next.js | 证据结论 |
| --- | --- | --- | --- |
| 候选身份不能修改正式数据 | `pass` | `pass` | BG-11 攻击用例通过 |
| 候选身份不能替换主图 | `pass` | `pass` | BG-12 攻击用例通过 |
| 跨客户端归属隔离 | `pass` | `pass` | BG-09 攻击用例通过 |
| merge/split/undo 不得破坏关系 | `pass` | `pass` | BG-15/BG-16 独立作用域、依赖和指定撤销通过 |
| PostgreSQL 恢复后数据一致 | `environment_blocked` | `environment_blocked` | BG-22 未执行，不能从 0 个 hard fail 推断通过 |
| 来源删除后对象存储保留正式主图 | `environment_blocked` | `environment_blocked` | BG-26 未执行，真实对象生命周期未知 |
| 完整生产形态从干净环境启动 | `environment_blocked` | `environment_blocked` | BG-29 未执行，局部 smoke 不替代完整门禁 |
| 管理入口不得绕过 OperationLog | `pass` | `pass` | BG-30 与正式写入攻击测试通过 |

两端硬门禁失败数均为 **0**，但各有 **3 个硬门禁族处于 `environment_blocked`**。这表示“尚未观察到失败”，不表示生产门禁已经通过。

## 4. 定向能力比较

### 4.1 浏览器审核与图库

两端都由 Playwright 1.61.1 通过 `channel="chrome"` 控制本机 Chrome 150.0.7871.102，使用同一候选记录完成真实登录、候选审核、OperationLog 校验和图库交互。Wagtail 审核为 **5,896 ms / 6 clicks / 8 navigations**；Payload 为 **1,560 ms / 6 clicks / 5 navigations**。Payload 在这一小型合成 fixture 上约快 3.8 倍，但这不是并发、容量或生产性能基准。

图库全流程 Wagtail 为 5,406 ms，Payload 为 4,189 ms；两端都验证了角色搜索、唯一匹配、同名消歧、分页、4/3/2 列、原比例 `contain`、灯箱/缩放/当前页切换、成人设置、无下载按钮和无图片详情。Wagtail 浏览器阶段没有网络失败；Payload 在测试反复切换页面期间记录了 9 次 loopback GET `ERR_ABORTED`，不涉及外部或禁止域；当前证据没有进一步归因，应在下一轮观察是否可通过更稳定的导航策略消除。

### 4.2 候选图片文件导入

两端均通过共享 Python CandidateClient 的真实 loopback HTTP multipart 上传，服务端验证 PNG/JPEG、尺寸、MIME、大小、SHA-256 和 aHash，并证明：

- 同内容换文件名、URL 或幂等键不会重复存储；
- 同 URL/键但内容变化会产生新内容或明确冲突；
- 非图片、超限和声明类型不符不会创建半成品正式记录；
- 重试可成功，候选身份不能设置正式主图；
- 管理员只能在审核工作项内人工选择主图。

Wagtail 使用 Wagtail Images 候选 collection 并在本地生成 rendition；Payload 使用受保护的 Media 记录并生成本地派生图。两端都只证明本地存储闭环，未证明 S3。Payload loopback 摘要还记录首次创建 `[true,true]`、重复创建 `[false,false]`、multipart `[true,false]`、媒体身份稳定且正式/主图攻击为 HTTP 403。两端都没有独立、可比较的文件导入耗时。

### 4.3 客户端身份、工作项与审计隔离

两端均实现每客户端独立凭据、只存哈希、active/disabled、撤销、owner 归属和服务端授权；无 token、错误 token、撤销 token、跨 owner、正式实体、主图和 generic CRUD 攻击均被拒绝。候选协议只暴露候选 upsert 与候选媒体上传，不提供正式数据写方法。

ReviewWorkItem 均保存候选、allowed targets、审核人、状态、乐观版本、起止时间和决定原因。完成后普通入口不能继续改写；reopen 会留审计。两端均拒绝第二位管理员的陈旧提交，且不产生多余 OperationLog。不过这些并发结论来自 SQLite 回归，尚未在 PostgreSQL 事务与锁行为上复核。

### 4.4 merge、split 与指定 undo

两端均使用稳定 operation ID、作用域、版本和依赖，不再提供“全局最新一次”撤销。无关 X/Y merge 与 M/N split 可按各自 ID 独立撤销；同一原型的陈旧提交明确冲突；依赖前置 merge 的后续操作会阻止直接撤销前置操作。Wagtail 使用 Django `transaction.atomic` 领域服务；Payload 使用受控领域 handler/事务边界，并同时检查显式依赖与作用域重叠。真正 PostgreSQL 原子性、行锁和崩溃恢复仍属于未执行门禁。

### 4.5 PostgreSQL、S3、备份恢复与部署

BG-17—BG-29 两端全部 `environment_blocked`：本机 Docker daemon 不可用，也没有 PostgreSQL 或 MinIO/S3 服务。任务禁止安装 Docker、修改系统服务或使用真实云资源，因此没有规避环境门禁。

- Wagtail 的 SQLite migration/seed/导出、本地 rendition、`DEBUG=false`、`collectstatic` 和 WSGI/health smoke 只作补充信号；未验证完整正式 WSGI/ASGI server + PostgreSQL + S3 的干净启动。
- Payload 的 typecheck、ESLint、44/44 测试、production build 和本地 standalone health/root/Admin/static smoke 通过，未出现 NFT tracing 警告，`sharp` 原生文件被 trace；但未带 PostgreSQL/S3 从干净环境启动，仍不能把 BG-29 写成通过。
- 两端都没有 PostgreSQL 备份、空库恢复、恢复后合同重跑、S3 服务中断/恢复、对象迁移或正式主图生命周期证据。

### 4.6 管理入口、代码量与运维信号

| 指标 | Wagtail | Payload CMS + Next.js |
| --- | ---: | ---: |
| 业务实现 LOC | 5,263 | 6,019 |
| 测试 LOC | 2,476 | 2,885 |
| Admin UI LOC | 331 | 641 |
| endpoint/service LOC | 1,280 | 1,439 |
| migration 数量 | 3 | 2 |
| 直接依赖 | 4 | 9 |
| 本轮自动测试 | 70/70 | 44/44 |
| 本地应用进程 | 1 | 1（Next/Payload 合并进程） |

Wagtail 以更少的实现、测试和 Admin UI 代码覆盖同一 BG 集合，管理模型更贴近 Python 采集器和 Django 领域服务；代价是两条 `treebeard.E001` 仍可见，只能通过精确锁定 `django-treebeard==5.3.0`、版本不符 fail closed 和 tree mutation 测试控制升级风险，不能把警告视为无影响。

Payload 的浏览器审核更快，并实际完成 production build 与干净临时目录的 standalone smoke；无 NFT tracing 警告。这是较强的部署补充信号，但完整生产门禁仍缺 PostgreSQL/S3。其实现、Admin 和依赖面更大，必须持续防止 Payload generic CRUD、Admin hooks 或未来升级绕过领域 service 与 OperationLog。

## 5. VAL-02B 九维重新评分

评分只计本轮重新执行的证据；`environment_blocked` 不按通过计分。PostgreSQL、备份恢复、S3 和完整生产启动对应分值被扣留。分数用于比较，不绕过硬门禁。

| 维度 | 权重 | Wagtail | Payload CMS + Next.js | 本轮依据 |
| --- | ---: | ---: | ---: | --- |
| 领域模型适配 | 20 | 17.0 | 16.5 | 两端模型/工作项/审计通过；Wagtail 领域与 Admin 实现更小，PostgreSQL 未证 |
| 候选审核体验 | 20 | 18.0 | 17.5 | 两端 6 clicks；Payload 样本更快，Wagtail Admin 定制面更小且导航无失败 |
| 候选与正式数据隔离 | 15 | 14.5 | 14.5 | 同一身份、owner、撤销、formal/main/generic CRUD 攻击均通过 |
| merge/split/undo 可控性 | 15 | 12.0 | 12.0 | 指定撤销、依赖和冲突通过；PostgreSQL 事务语义未证 |
| 图片与存储能力 | 10 | 5.5 | 5.5 | 本地上传/哈希/去重/派生图/主图通过；S3 六项受阻 |
| 前台实现效率 | 5 | 4.5 | 4.5 | 同一浏览器图库合同通过 |
| 导出与数据迁移性 | 5 | 2.0 | 2.0 | SQLite JSON/CSV 可解析；PostgreSQL 导出及恢复未证 |
| 本地和云端运维复杂度 | 5 | 1.5 | 2.0 | Payload build/standalone 补充证据较强；两端完整部署受阻 |
| 许可证和锁定风险 | 5 | 4.0 | 4.0 | 均为宽松许可证；Wagtail 有 Treebeard 升级门禁，Payload 有框架/Admin/双栈锁定面 |
| **总分** | **100** | **79.0** | **78.5** | Wagtail 仅领先 0.5 分 |

## 6. 比较结论

两端在真实浏览器审核、候选文件导入、客户端隔离、工作项目标约束、并发冲突、指定 undo 和最小审计管理入口上均取得直接证据，且没有已执行硬门禁失败。Wagtail 的代码和 Admin 定制面较小；Payload 的本次审核更快、standalone 补充证据更强。

然而，13/30 门禁（43.3%）集中受阻于 PostgreSQL、备份恢复、S3 和完整生产启动，且覆盖三个硬门禁族。0.5 分差远小于这些未知项可能带来的反转范围。因此本轮比较不能支持最终选择任一技术栈，阶段性 ADR 必须为 **`Undecided`**。

这份比较没有建立正式项目、没有部署、没有开始 VAL-03 或原画图库，也没有访问 Hpoi。
