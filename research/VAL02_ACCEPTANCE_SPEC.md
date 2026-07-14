# VAL-02 统一验收规范

## 1. 范围与判断边界

VAL-02 只使用同一份离线合成数据比较 Wagtail 与 Payload CMS＋Next.js 两个
可丢弃原型。它只判断哪个技术底座在当前证据下更适合“角色—手办原型—版本—
来源—候选图片—人工主图—候选审核”流程，不建立正式产品，也不宣布最终技术栈。

本轮硬性禁止向 `hpoi.net`、其 `www`/`rfx` 主机或任何其他子域发起请求。
Hpoi 不是原型的运行时数据源。fixture 名称、关系、URL、图片均为完全合成；图片
只在测试/seed 时动态生成小 PNG，不提交生成媒体。

机器合同位于 [`spikes/val02_contract/`](../spikes/val02_contract/README.md)。

## 2. 统一领域模型

| 实体 | 统一语义与最低字段 | 关键约束 |
| --- | --- | --- |
| `Work` | 稳定 ID、名称、原文名、多个别名 | 可独立存在；角色/原型对作品的关联允许为空 |
| `Character` | 稳定 ID、标准显示名、中/日/英名称、多个别名、可选作品、状态、软删除 | 同名角色以作品消歧；候选同步不能创建正式角色 |
| `Manufacturer` | 稳定 ID、标准名、多个别名、`draft/active/hidden` | 新厂商只能先成为 draft；draft 不进入公开筛选 |
| `FigurePrototype` | 多角色、可选作品、厂商、`scale/prize`、比例、服装、多人/成人标志、发布/软删除状态、人工主图、时间戳 | 代表独立造型而非 SKU；不同厂商相似动作保持独立 |
| `FigureVersion` | 稳定 ID、所属原型、版本种类与名称 | 普通、豪华、再版、特典、异色或渠道版不单独占图库条目 |
| `SourceRecord` | 来源类型、稳定来源 ID、URL、状态、最近同步、失效标志、原始快照 | 类型＋来源 ID 唯一；无 ID 才用规范化 URL；可迁移；失效不自动下架正式条目 |
| `CandidateRecord` | 来源、原始标题/角色/作品/厂商/类别/比例/日期/快照、匹配状态、审核状态和原因 | 只在候选池；状态为 `pending/accepted/deferred/ignored/merged/update_pending`；同步不改正式数据 |
| `CandidateImage`/媒体 | 稳定媒体 ID、归属、原始 URL、storage key、尺寸、宽高、格式、SHA-256、感知哈希、成人/首页/仍存在/主图标志 | storage key/媒体 ID 是身份；URL 只是元数据；SHA-256 精确去重，感知哈希只提示疑似重复 |
| `OperationLog` | 操作者、时间、类型、原因、前后状态、关联记录、撤销标志 | 所有领域操作真实记录；merge/split/undo 跨记录一致 |
| `SystemSetting` | `show_adult_images`、`gallery_page_size`、公开读取开关 | 成人图默认关闭；默认每页 16 |

两个原型可以使用不同的框架字段或关联实现，但导入、验收结果与开放导出必须映射
到上述相同语义。

## 3. 统一 fixture

权威文件为
[`fixtures/domain_fixture.json`](../spikes/val02_contract/fixtures/domain_fixture.json)，
由 `fixture_contract.py` 机器检查。它当前包含：

- 2 个完全虚构作品；
- 4 个角色，其中两个都叫“林”但分别属于不同作品；
- 3 个厂商，其中一个为 draft 且没有被正式原型引用；
- 5 个独立原型，其中两个由不同厂商制作、动作相似但 ID 独立；
- 1 个多人原型；
- 1 个原型下的普通、豪华、再版、纯异色四种版本；
- 1 个来源失效但仍为 published 且本地主图仍在的原型；
- 4 个候选，每个候选有 2 张动态图片描述；
- 至少 1 张成人候选图；成人原型另有一张非成人、人工选择的主图；
- 已有人工主图的原型与一个请求替换该主图、应被拒绝的候选；
- URL fallback 后取得稳定来源 ID 的迁移场景，以及 merge/split/undo 场景。

fixture 不保存 PNG 字节。`generator.width/height/rgba` 是可复现输入，运行时生成器
计算 `file_size`、`sha256` 和 64 位 aHash；所有 `source_url` 均使用保留的
`synthetic.invalid` 域。

## 4. 统一候选 API 与操作语义

### 4.1 Python candidate client

同一客户端只允许以下协议：

```json
{
  "protocol_version": 1,
  "operation": "candidate_upsert",
  "candidate": "<domain_fixture.candidate_records 的一个对象>"
}
```

| 原型 | 默认 endpoint | 运行时 Token | Authorization |
| --- | --- | --- | --- |
| Wagtail | `POST http://127.0.0.1:8000/api/val02/candidates/upsert/` | `VAL02_WAGTAIL_CANDIDATE_TOKEN` | `Bearer <token>` |
| Payload | `POST http://127.0.0.1:3000/api/candidate-records/upsert` | `VAL02_PAYLOAD_CANDIDATE_TOKEN` | `users API-Key <token>` |

endpoint 只允许 loopback；Token 没有 CLI 参数或默认值，只能来自当前进程环境。
请求携带来源、候选和候选图片元数据，不含图片二进制/base64。客户端公开接口仅有
候选 upsert；没有正式 Character、Manufacturer、FigurePrototype、FigureVersion
或主图的写方法。

### 4.2 领域操作

- `candidate_upsert`：稳定 ID 优先；无 ID 使用规范化 URL；重复输入不新增，后续
  取得稳定 ID 时迁移旧键。只改变 Source/Candidate/候选媒体。
- `candidate_accept_new_prototype`：仅管理员调用，从候选显式创建正式原型并审计。
- `candidate_attach_version`：仅管理员调用，把候选归入已有版本，不新增图库条目。
- `candidate_review_field`：逐字段接受或拒绝，记录决定、原因和前后值。
- `candidate_defer/ignore`：保存非空原因，保留原始候选与图片。
- `select_main_image`：仅人工审核动作可执行；候选同步、候选身份和普通字段更新均
  不能替换已有主图。
- `merge/split/undo`：以一个事务/等价原子边界移动所有相关来源、版本、候选和媒体，
  不物理删除被合并对象，生成 OperationLog；undo 恢复整个关系快照。
- `export`：JSON 与 CSV/多表 CSV 使用稳定 ID 和关系 ID，不嵌入媒体字节，不依赖
  框架私有备份格式。

## 5. 三十项验收条件

| ID | 条件 | 必须由原型输出的证据 |
| --- | --- | --- |
| AC-01 | 相同来源重复 upsert 不产生重复来源或候选 | 首次/二次调用及记录数断言 |
| AC-02 | 来源 ID 优先；URL fallback 可迁移且不重复 | URL 键到 ID 键迁移测试 |
| AC-03 | 候选同步不能创建正式角色 | 正式角色集合前后比较＋权限测试 |
| AC-04 | 候选同步不能创建正式厂商 | 正式厂商集合前后比较＋权限测试 |
| AC-05 | 新角色只进入候选待匹配状态 | 未知角色 fixture 的状态断言 |
| AC-06 | 新厂商只能创建为 draft，且不进公开筛选 | 管理操作和公开查询断言 |
| AC-07 | 候选 API 无权修改 FigurePrototype | 候选身份请求被拒绝且数据不变 |
| AC-08 | 候选 API 无权替换已有主图 | access/hook 双边界与主图不变断言 |
| AC-09 | 管理员可从候选创建正式原型 | 管理审核动作、实体和 OperationLog |
| AC-10 | 管理员可把候选归入已有版本 | 版本关系与图库条目数断言 |
| AC-11 | 管理员可逐字段采纳或拒绝变化 | 至少一项接受、一项拒绝及审计理由 |
| AC-12 | deferred/ignored 保存原因 | 状态约束和读取回原原因 |
| AC-13 | merge → split → undo 保持跨记录关系一致 | 完整自动事务/集成测试 |
| AC-14 | 所有领域写操作产生 OperationLog | 字段完整性与操作覆盖断言 |
| AC-15 | 多人原型可从任一关联角色搜索到 | 两个角色分别查询同一原型 |
| AC-16 | 相似动作、不同厂商仍为两个正式原型 | fixture 两 ID 与查询结果数断言 |
| AC-17 | 普通/豪华/再版/异色只占一个图库条目 | 四版本关系与单一原型展示断言 |
| AC-18 | 成人图片默认不在前台显示 | 默认设置下查询/DOM 断言 |
| AC-19 | 开启全局设置后成人图片可显示 | 设置切换后的同查询断言 |
| AC-20 | 来源失效不自动下架正式条目或删本地主图 | stale 来源、published 原型和 storage key 断言 |
| AC-21 | 主图使用稳定媒体 ID/storage key，URL 不是主键 | 模型约束和 URL 变化测试 |
| AC-22 | JSON/CSV 导出含核心关系与媒体元数据 | 两种导出解析及必需字段断言 |
| AC-23 | 导出不含图片二进制 | base64/data URL/二进制扫描 |
| AC-24 | 角色别名命中搜索 | fixture 别名查询测试 |
| AC-25 | 唯一角色匹配直接得到图库目标 | 唯一结果路由/响应测试 |
| AC-26 | 多个同名角色返回作品消歧列表 | “林”返回两角色及各自作品 |
| AC-27 | 图库默认每页 16 | 默认设置与分页边界测试 |
| AC-28 | 图库图片保持原始比例、不裁切 | 媒体宽高与 CSS/组件/DOM 测试 |
| AC-29 | 灯箱仅在当前分页内前后切换 | 首尾边界和当前页 ID 集合测试 |
| AC-30 | 无任何 Hpoi 实时请求 | DNS/transport guard 测试＋静态网络目标检查 |

失败必须标记 `fail`；因环境无法执行必须标记 `not_run` 并提供 `blocker`。不得将
未执行检查描述为通过。

## 6. 机器验收结果

两个原型测试 runner 必须通过 `AcceptanceRecorder` 生成相同结构 JSON：

- `schema_version=1`、`contract_id=val02-acceptance-v1`；
- `prototype` 分别为 `wagtail` / `payload`；
- 带时区的 `generated_at`；
- `generated_by.runner/command/source_files/source_digest`；`source_files` 是排序去重的
  仓库相对路径，并至少引用对应原型目录中的真实实现/测试；validator 重新读取文件
  计算摘要，证明结果与当前 runner/源码一致；
- 当前共享 fixture 的 SHA-256；
- 按 AC-01—AC-30 顺序的 30 个 assertion；
- 每项状态为 `pass/fail/not_run`，并含具体 `kind/reference/observed` evidence；
- 可选 `runtime/metrics/exports/security` 原始事实。

原型结果禁止自行写 `overall`、`pass_count` 或“全部通过”泛化 evidence。共享
`validate_results.py` 同时读取两个实际结果，核对 fixture 摘要、30 项唯一覆盖和
evidence，再独立重算统计。validator 的绿色结果只证明结果结构和所引用的测试输出
一致，不能替代对各原型测试覆盖面的审计。

## 7. 评分方法

总分 100，权重固定：

| 维度 | 权重 | 主要证据 |
| --- | ---: | --- |
| 领域模型适配 | 20 | AC-01/02/05/06/15/16/17/20/21，模型与迁移 |
| 候选审核体验 | 20 | AC-09—12，实际 Admin 流程/浏览器或等价 DOM 测试 |
| 候选与正式数据隔离 | 15 | AC-03/04/07/08，真实 API 权限与主图保护 |
| merge/split/undo 可控性 | 15 | AC-13/14，事务与 OperationLog |
| 图片与存储能力 | 10 | AC-18/19/21/28，rendition/thumbnail 与存储边界 |
| 前台实现效率 | 5 | AC-24—29，最小前台测试和自定义代码量 |
| 导出与数据可迁移性 | 5 | AC-22/23，JSON/CSV 解析与恢复关系能力 |
| 本地及云端运维复杂度 | 5 | 实际命令、进程/数据库拓扑、启动/响应小样本 |
| 许可证和锁定风险 | 5 | 已核验许可证、框架私有面与迁移边界 |

每个维度按以下规则评分，不允许只凭印象：

1. 先列该维度的具体子条件、测试/代码位置和实际结果；
2. `pass` 子条件可取得对应比例分，`fail/not_run` 不得按通过计分；
3. 相同 AC 被多个维度引用时只作为证据，不在总分中重复增加权重；
4. Admin 操作体验、运维和许可证等不能由 30 项数量直接推导，必须引用实际操作、
   版本/许可证或命令证据；
5. 每个维度分数不超过其权重，保留一位小数，总分是九个维度之和；
6. 代码量、耗时、依赖和进程数只能报告实际测量值；无法测量时注明原因并降低证据
   置信度，不能伪造；
7. 暂时领先结论必须同时给出分数、关键失败/未运行项和对业务影响，不能把分数写成
   最终技术选型。

## 8. 共用安全与卫生检查

两原型结果汇总前至少执行：fixture 完整性、共享 unit tests、各原型测试、共享
validator、JSON/CSV 解析、Hpoi 网络禁令、凭据扫描、大文件/二进制扫描和
`git diff --check`。生成媒体、数据库、虚拟环境、`node_modules`、`.env` 和真实
凭据均不得提交。任何 Hpoi 网络请求都不属于可接受测试；发现需要该请求才能继续时
必须停止并记录阻塞。
