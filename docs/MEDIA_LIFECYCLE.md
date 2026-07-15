# 正式产品媒体生命周期蓝图

## 1. 文档状态与目标

本文规定图片从候选上传到正式主图、清理、迁移、备份和恢复的完整生命周期。它是 [领域模型](DOMAIN_MODEL.md) 中 MediaAsset、MediaObject、CandidateImage、FigureImage 和 FigurePrototype.main_media_asset_id 的配套规范，不是对象存储配置或应用实现。

正式实现必须满足：

- 图片内容身份使用 SHA-256；来源 URL、文件名、公开 URL、ETag 和感知哈希都不能替代；
- 候选媒体与正式媒体使用不同引用和保留边界；
- 采集客户端只能创建自己的 CandidateImage，永远不能提升为正式图片或设置主图；
- 所有 bucket 私有；公开或签名 URL 是运行时投影，不落入业务关系；
- 原图不可变；thumbnail、preview 是可重建的版本化派生图；
- MediaAsset.adultFlag 是成人分级唯一权威真值；CandidateImage.proposedAdult 只是提案，FigurePrototype.adultEntryFlag 只是正式媒体派生/缓存；
- 来源、候选或 URL 消失不能删除正式主图；
- PostgreSQL 与对象存储不是一个 ACID 事务，必须使用 staging、事务性任务、幂等、校验和补偿。

技术选择和已验证边界见 [技术选型 ADR](../research/TECH_STACK_DECISION.md)；生产门禁的历史证据见 [Payload CI 生产门禁](../research/PAYLOAD_CI_PRODUCTION_GATE.md)。

## 2. 内容身份、对象位置与 key

### 2.1 三种不同身份

| 身份 | 权威值 | 用途 |
| --- | --- | --- |
| 内容身份 | MediaAsset.id + sha256 | 精确去重、关系、恢复验证 |
| 业务来源关系 | CandidateImage.id 或 FigureImage.id | owner、来源、审核和正式用途 |
| 物理对象位置 | MediaObject.storage_profile + storage_key | 对象读写、迁移和备份 |

同一内容可以有多个 CandidateImage、FigureImage 和 MediaObject。共享 MediaAsset 不授予跨 CandidateClient 读取权限；授权必须从 CandidateImage owner 关系反向判断。

### 2.2 key 规范

对象 key 使用小写 SHA-256 分片，不能包含原始文件名、来源 URL、用户输入路径或公开域名。

| 阶段 | key 模板 |
| --- | --- |
| 临时隔离 | quarantine/{upload_id}/original |
| 候选原图 | candidate/sha256/{sha256 前两位}/{sha256}/original.{ext} |
| 候选派生图 | candidate/sha256/{前两位}/{sha256}/derived/{recipe_version}/{variant}.{ext} |
| 正式原图 | formal/sha256/{前两位}/{sha256}/original.{ext} |
| 正式派生图 | formal/sha256/{前两位}/{sha256}/derived/{recipe_version}/{variant}.{ext} |

storage_profile 是逻辑配置名，例如 primary-media-v1；它在运行时映射 provider、endpoint、region 和 bucket。数据库不保存 access key、secret、签名 URL 或拼好的公开 URL。迁移 provider 或 prefix 时，MediaAsset.id 和 sha256 不变，只增加、验证并切换 MediaObject。

## 3. Supporting Media 技术生命周期

下图是 supporting Media boundary 的内部技术生命周期，用于对象任务与补偿；它不是 [领域模型](DOMAIN_MODEL.md) 中五个业务状态机之外的第六个业务状态机，也不改变四个业务聚合。

~~~mermaid
stateDiagram-v2
    [*] --> quarantined: upload staged
    quarantined --> candidate_ready: validated and materialized
    quarantined --> error: validation or storage failure
    candidate_ready --> promotion_pending: human promotes
    promotion_pending --> formal_ready: formal objects verified and relation committed
    promotion_pending --> candidate_ready: promotion compensation
    candidate_ready --> delete_pending: no references after grace starts
    formal_ready --> delete_pending: no formal or candidate references
    delete_pending --> candidate_ready: candidate reference returns
    delete_pending --> formal_ready: formal reference returns
    delete_pending --> deleted: grace elapsed and reference check passes
    error --> quarantined: explicit retry
~~~

未列出的状态迁移禁止。MediaWorker 只能执行已持久化任务；不能自行将 candidate_ready 改为 formal_ready。promotion_pending 需要人工提升命令产生，formal_ready 需要对象校验和数据库正式引用同时成功。

## 4. 十四阶段处理合同

### 1. 请求准入与幂等

1. CandidateClient 通过专用 multipart 端点提交 client_candidate_id、client_image_id、upload_idempotency_key 和声明元数据。
2. 服务端验证 client active、scope、CandidateRecord owner 和请求大小；不接受客户端提交 candidate_owner、MediaAsset.id、storage_key、formal 状态或 main image。
3. owner_client_id + upload_idempotency_key 唯一。相同请求重放返回原结果；同键不同摘要返回 409 idempotency_conflict。
4. 无 Token、错误/撤销 Token、跨 owner 和 generic CRUD 请求在读取文件体前拒绝。

失败结果：不创建候选、媒体或对象；仅记录最小安全审计，不记录凭据或请求头。

### 2. 流式接收至隔离区

1. 文件以有界流写入 quarantine/{upload_id}/original；不先读入无上限内存。
2. 同时累计字节数和 SHA-256；超过上限立即中止并删除临时对象。
3. upload_id 由服务端生成，不能用文件名拼路径；隔离对象私有且不可由前台读取。
4. 此阶段不得创建 FigureImage、正式引用或 main image。

失败补偿：上传中断、超时或客户端断开时标记任务 failed，幂等删除隔离对象；数据库若只有 upload attempt 行，保持非正式且可安全重试。

### 3. 字节与图片校验

必须按实际字节而非声明 Content-Type 验证：

- 文件签名、允许格式、完整解码和尾随异常；
- MIME 声明与实际格式一致；
- byte_size、pixel_width、pixel_height、总像素和宽高比限制；
- 解压炸弹、损坏文件、多帧/动画策略、颜色空间和方向元数据；
- 文件名控制字符和路径分隔符；
- 生产安全策略要求的恶意内容扫描或隔离解码。

原始字节保持不可变；EXIF 等元数据不在公开派生图中传播。校验失败的对象不能进入 candidate prefix，并在短保留窗口后清除。

### 4. 计算权威元数据

服务端从隔离对象计算并保存：

- SHA-256、byte_size、实际 MIME/format；
- 解码后的 width、height 和约分 aspect ratio；
- 版本化感知哈希及 algorithm；
- validation_version 和 verified_at。

客户端提供的 SHA、尺寸、格式和感知哈希只能用于提前拒绝不一致请求，不能覆盖服务端结果。SHA-256 是精确身份；感知哈希只生成相似候选提示。

### 5. 内容寻址与精确去重

1. 以 sha256 锁定或插入 MediaAsset；PostgreSQL UNIQUE (sha256) 处理并发。
2. 已存在相同 SHA 时复用 MediaAsset，仍创建独立 CandidateImage 以保存 owner、来源 URL 和审核来历。
3. 如果同 URL 或 client_image_id 的内容 SHA 改变，创建/复用新的 MediaAsset，并把新 CandidateImage.supersedes_id 指向旧关系。
4. 文件名或 URL 改变但 SHA 相同不复制内容；不同 SHA 即使感知哈希相同也不得自动合并。

数据库插入冲突必须重新读取胜出记录并核对全部元数据，不能把唯一冲突当作成功而跳过验证。

### 6. 写入 candidate prefix

1. 从 quarantine 复制到确定性的 candidate key；存在同 key 时先 HEAD/GET 校验大小和 SHA。
2. 对象完整校验后，事务内创建或更新 MediaObject(state=available, namespace=candidate) 和 MediaAsset(candidate_ready)。
3. 只有数据库提交成功后才删除 quarantine 对象。
4. 对象成功而数据库事务失败时，将 candidate key 放入 orphan cleanup 队列；审计任务也必须能发现它。

不能把外部 source_url 当作 candidate 对象。正式服务需要持久保存的媒体必须先复制到受控对象存储。

### 7. 生成版本化派生图

至少生成：

- thumbnail：后台列表和快速预览；
- preview：审核灯箱和前台常规大图；
- original：保持上传字节，私有保存。

派生规则必须包含 recipe_version、目标边界、编码格式、质量、方向处理和 without_enlargement。所有变换保持原始宽高比，不裁切；派生图不带不必要元数据。每个 MediaObject 保存自己的 SHA-256、尺寸和 byte_size。

派生失败时保留已验证原图，但 MediaAsset 不进入可审核的 candidate_ready，任务可幂等重试。不得生成一半派生图后宣称上传成功。

### 8. 绑定 CandidateImage

在一个 PostgreSQL 事务中：

1. 锁定 CandidateRecord 和 MediaAsset；
2. 再次校验 CandidateClient owner、候选状态和 idempotency_key；
3. 创建 CandidateImage，保存来源关系、排序、分级提案和 supersedes；
4. 更新候选图片集合与 lock_version；
5. 写 candidate_media_uploaded OperationLog。

CandidateImage 只引用 MediaAsset，不拥有对象。删除 CandidateImage 只能减少候选引用；不能直接 DELETE 对象。

### 9. 人工审核与预览

Admin（审核职责）通过 ReviewWorkItem 读取 thumbnail/preview，比较全部 CandidateImage，并逐字段接受、拒绝或延期。预览 URL 为短期签名 URL 或受鉴权代理，不能持久化。

审核前：

- MediaAsset 必须 candidate_ready；
- 所选 CandidateImage 必须属于当前 CandidateRecord；
- CandidateRecord 必须是当前工作项，目标必须在 allowed targets；
- Admin 必须明确确认 MediaAsset.adultFlag；CandidateImage.proposedAdult 不能直接成为公开真值。

打开、缩放、左右切换或预览不会产生正式关系；采集器的 sourceHomepage 仅是提示，不自动选主图。

### 10. 人工提升到 formal prefix

提升由 Admin 的明确命令触发，包含 ReviewWorkItem、CandidateImage、目标 FigurePrototype、expected versions 和 reason。

采用以下可补偿协议：

1. 锁定 MediaAsset，状态 candidate_ready → promotion_pending，并持久化 promotion job；
2. MediaWorker 将 original、thumbnail、preview 复制到 formal key，逐对象读回校验 SHA、尺寸和 recipe_version；
3. 数据库事务锁定 Review、Candidate、Figure、Media；复核 allowed target 和版本；
4. 确认 MediaAsset.adultFlag，创建 formal MediaObject、FigureImage，更新 MediaAsset 为 formal_ready，并重算 FigurePrototype.adultEntryFlag，写 OperationLog；
5. 事务失败时不创建 FigureImage，已复制 formal 对象进入 orphan cleanup；对象复制失败时保持 CandidateImage 和旧 candidate 对象，状态补偿回 candidate_ready；
6. candidate 对象只在正式对象验证、引用提交和保留窗口结束后才可清理。

提升可复用已存在的相同 formal 内容，但必须为目标原型建立独立 FigureImage。提升不是主图选择；两者可以在同一领域编排中执行，但必须保留两个明确子操作和审计载荷。

### 11. 人工主图选择与保护

设置 FigurePrototype.main_media_asset_id 必须同时满足：

- actor 是 Admin，且命令来自工作项或正式管理入口；
- FigureImage 属于目标原型、active 且 is_eligible_for_main；
- MediaAsset=formal_ready，formal original 和必需派生图均 available；
- expected_version 与 FigurePrototype 当前 lock_version 一致；
- 选择理由、旧主图、新主图和相关 FigureImage 写入同事务 OperationLog。

CandidateClient、source refresh、CandidateRecord upsert、generic CRUD、Payload hook、批处理和媒体清理任务都不能替换主图。原主图不会因发现“更清晰图片”自动变化；只能由新的人工 select_main_image 命令改变。

### 12. 来源/候选失效与延迟清理

SourceRecord 转为 stale/dead 或 accessBlocked=true、CandidateRecord 设置 soft_deleted_at（不新增主状态）、CandidateImage superseded/soft-deleted，都只改变来源或候选关系。若相同 MediaAsset 有 FigureImage 或被 main_media_asset_id 引用：

- formal MediaObject 必须保留；
- CandidateImage 可软删除，但 promoted_from_candidate_image_id 的来历标识保留；
- OperationLog 和备份 manifest 继续可核验；
- 不因 source_url 返回 404 删除任何受控对象。

最后一个候选引用消失时，只将无正式引用的 candidate 对象标为 delete_pending，并设置 delete_after。保留窗口属于部署阶段批准的运维保留策略，不是首版五项 SystemSetting 之一；窗口内新引用可取消清理。

### 13. 引用检查与安全删除

MediaWorker 到期清理前必须在事务中锁 MediaAsset，并重新查询真实引用，而非信任缓存计数：

- FigurePrototype.main_media_asset_id；
- active FigureImage；
- active CandidateImage；
- open/in_review/reopened ReviewWorkItem 的选择；
- promotion、migration、backup 或 restore 中的未完成任务；
- OperationLog 保留策略要求的对象证据。

任一引用存在即取消删除并恢复 candidate_ready 或 formal_ready。无引用时：

1. 写 cleanup intent 和 OperationLog；
2. 先删除可重建派生图，再删除原图；
3. 每次对象删除幂等，NotFound 视为已删除但记录审计；
4. 全部对象确认不存在后，数据库事务把 MediaObject 和 MediaAsset 标为 deleted；
5. 不物理删除审计、manifest 或关系 tombstone。

删除中断保持 delete_pending 并重试。不得先硬删数据库行再失去对象清单。

### 14. 联合备份、迁移、恢复与孤儿审计

每个联合快照使用 snapshot_id，把 PostgreSQL 备份与对象 manifest 绑定。manifest 至少包含：

- schema_version、snapshot_id、数据库 migration head、生成时间；
- MediaAsset.id、SHA-256、格式、尺寸、状态；
- 每个 MediaObject 的 storage_profile、storage_key、namespace、variant、recipe_version、SHA-256 和 byte_size；
- CandidateImage、FigureImage 和 main_media_asset_id 的关系 ID，以及 MediaAsset.adultFlag；
- 对象总数/总大小和 manifest 自身 SHA-256；
- 不含图片二进制、公开 URL、Token、数据库密码或对象存储凭据。

恢复到空环境后必须校验数据库记录/关系、全部对象哈希、主图、来源状态、成人设置、OperationLog、缺失/孤儿对象和权限攻击。只有联合校验通过才可切换服务流量。

迁移 provider、bucket 或 prefix 采用“清单 → 复制 → 逐项哈希 → 双读验证 → 数据库切换 storage_profile/key → 观察窗口 → 延迟清理旧对象”。MediaAsset.id、SHA-256、CandidateImage、FigureImage 和主图引用不变。任何部分失败回滚读指针或继续旧位置，不能产生混合真值。

## 5. 原图与派生图规则

| 项目 | 原图 original | 派生图 thumbnail / preview |
| --- | --- | --- |
| 字节 | 上传后不可变 | 可按 recipe_version 重建 |
| 内容身份 | MediaAsset.sha256 | 独立 object_sha256，不创建新的业务 MediaAsset |
| 保存 | candidate/formal 保留策略决定 | 与相应 namespace 同步保存 |
| 公开读取 | 默认不直接公开；必要时鉴权/签名 | 前台和后台优先读取 |
| 变换 | 不改写、不覆盖 | 只缩小、不放大、不裁切，保持比例 |
| 删除 | 最后删除，必须无引用 | 可先删并按需重建 |
| 备份 | 必须列入 manifest | 必须列出；也可声明可重建但恢复门禁仍需验证 |

修正方向或去除元数据时，生成 sanitized display 派生图，不覆盖 original。改变编码规则时使用新 recipe_version 和新 key；确认全部引用读取新版本后再延迟清理旧派生图。

## 6. 去重、相似提示与引用

- 精确去重只按服务端 SHA-256。同 SHA 只创建一个 MediaAsset，但可有多个 candidate/formal MediaObject 副本和多个业务关系。
- 感知哈希、尺寸、文件名、来源 URL 和 ETag 只能形成 duplicate_suggestion；必须由人工决定是否保留业务关系。
- CandidateClient A 与 B 上传相同内容时可在物理层去重，但 A 不能读取或修改 B 的 CandidateImage、来源元数据或候选。
- FigurePrototype 之间可引用同一 MediaAsset，但每个 FigureImage 只决定各自状态、排序与主图资格；成人分级只读自 MediaAsset.adultFlag，不建立关系级第二真值。
- 引用计数仅用于筛选清理候选；删除前必须执行事务内真实引用查询。

## 7. 错误与补偿矩阵

| 故障点 | 对外结果 | 必须保持 | 补偿/重试 |
| --- | --- | --- | --- |
| Token/owner/大小校验失败 | 401/403/413/422 | 无对象、无业务行 | 无需重试或用合法请求重试 |
| 上传中断 | 明确失败 | 无 CandidateImage、无正式记录 | 删除 quarantine；同幂等键可安全重试 |
| 解码/类型/哈希不符 | 422 | 隔离，不进入 candidate_ready | 延迟删 quarantine；修正文件用新请求 |
| candidate PUT 失败 | 503 | 数据库不宣称 available | 删除部分对象；指数退避重试 |
| 对象成功、DB 失败 | 500/409 | 无 CandidateImage/正式关系 | orphan queue + 审计清理 |
| 派生图失败 | 503 或 processing | 原图可保留但不可审核完成 | 删除不完整派生并按 recipe 重试 |
| promotion copy 失败 | 503 | 主图和 FigureImage 不变 | 删除不完整 formal 对象，回 candidate_ready |
| promotion DB 冲突 | 409 | copied 对象不成为正式真值 | formal orphan 延迟清理；刷新版本后重试 |
| 主图版本冲突 | 409 | 旧主图不变，第二管理员不覆盖 | 重新加载并人工决定 |
| 对象存储中断 | 503，不假成功 | 不产生残缺正式记录 | 服务恢复后按 operation_id 重试 |
| cleanup 删除部分失败 | 后台 retry | delete_pending 与清单保留 | 幂等继续，原图最后删除 |
| 迁移部分失败 | 旧位置继续读 | 业务 ID/引用不变 | 从 manifest 续传或回滚读指针 |
| 恢复缺对象/哈希错 | 恢复门禁失败 | 不开放公共服务 | 从备份补齐；重新全量审计 |

所有重试使用同 operation_id/idempotency_key；不能为一次失败创建多个正式关系。补偿动作必须记录 task/operation、对象 key 和结果，但日志不得包含凭据或签名 URL。

## 8. 对象迁移协议

1. 冻结 migration_plan，记录源/目标 storage_profile、prefix、预计对象集合和 manifest digest。
2. 复制 available 对象；目标 key 可改变，但内容 SHA 和 variant/recipe 不变。
3. 对每个目标对象执行读回 SHA-256、大小和图片尺寸校验；ETag 不能替代。
4. 审计目标缺失、多余和哈希不符；差异非零不得切换。
5. PostgreSQL 事务新增目标 MediaObject 并切换权威位置；不改 MediaAsset、CandidateImage、FigureImage 或主图 ID。
6. 在 loopback/非生产先运行 original、thumbnail、preview、Admin、前台和签名读取 smoke。
7. 观察窗口内可回退到旧 MediaObject；窗口结束且备份完成后才把旧对象设为 delete_pending。

跨 provider 迁移若不支持服务端 copy，必须流式 GET/PUT 并在受控临时空间校验；不得把公开 URL 下载当作迁移。

## 9. 媒体在规范恢复八步中的职责

唯一权威恢复顺序是 [运维与恢复](OPERATIONS_AND_RECOVERY.md#8-八步恢复流程) 的八步；媒体流程按同一顺序参与，不另定义第二套恢复算法：

1. 建立空 PostgreSQL；媒体服务不预先生成业务对象或运行会改变快照的 migration。
2. 恢复数据库；核对 migration head、MediaAsset/MediaObject/FigureImage 关系、OperationLog 和主图 ID。
3. 恢复或只读挂载 snapshot 对象到隔离的空 bucket/prefix，逻辑 storageKey 保持不变。
4. 执行 manifest 检查，逐项校验 original/thumbnail/preview 的 SHA-256、大小、关系，并报告 missing/orphan/hash/prefix 差异。
5. 仅绑定 loopback 启动匹配 release 的应用，验证受控媒体读取，仍不开放公开读取。
6. 只在原图哈希正确时重建可再生 thumbnail/preview；原图不重建、不伪造、不自动换主图。
7. 运行共享合同，核对 MediaAsset.adultFlag、FigurePrototype.adultEntryFlag、五项 SystemSetting、来源 active/stale/dead、CandidateImage/FigureImage 来历和 standalone 重启。
8. 运行候选 owner、主图、generic CRUD、Review target、merge/split/undo 与媒体攻击回归；全部通过并人工批准后才开放公开读取。

恢复验证摘要可以生成新的 manifest，但不能改变被验证 snapshot 的 manifest 或用新摘要掩盖差异。

数据库恢复成功但对象缺失，或对象完整但数据库关系失败，都属于联合恢复失败。

## 10. 孤儿与完整性审计

定期审计至少输出以下分类和数量：

| 分类 | 判定 | 默认处置 |
| --- | --- | --- |
| missing_object | MediaObject=available，但 key 不存在 | 高优先级告警；从备份恢复，正式主图受影响时阻断发布 |
| hash_mismatch | 对象读回 SHA 与记录不符 | 立即隔离；不覆盖记录，尝试从可信备份恢复 |
| orphan_object | 对象存在但无 MediaObject | 保留宽限期；匹配失败后按审计批准删除 |
| orphan_asset | MediaAsset 无 CandidateImage、FigureImage、任务或保留依据 | 进入 delete_pending，不立即硬删 |
| stale_derivative | recipe_version 过期或派生缺失 | 幂等重建；原图不变 |
| wrong_namespace | 正式引用只有 candidate 对象 | 阻断主图/发布，重新执行 promotion |
| duplicate_content | 多个 MediaAsset 具有相同 SHA | 数据完整性错误；人工修复关系，不删除对象 |
| expired_delete_pending | 过宽限期但未完成 | 重试并告警；再次引用检查 |
| dangling_main | 主图无 active FigureImage/formal original | 硬门禁失败；事务性修复，不自动选替代图 |

审计为只读发现阶段；修复必须通过专用领域命令或媒体任务，并写 OperationLog。不得让审计脚本直接批量删除未知对象。

## 11. 运行与安全要求

- 对象存储只用 TLS 或 loopback 测试连接，bucket 默认私有；按 prefix 和动作使用最小权限。
- 上传、派生、复制和清理 worker 使用不同或最小化 service identity；CandidateClient 不获得对象存储凭据。
- 签名 URL 生命周期短，不进数据库、日志、OperationLog、导出或备份 manifest。
- 日志只记录 operation_id、MediaAsset.id、脱敏 storage_key、状态、耗时和错误分类；不记录文件字节、凭据或请求头。
- 指标至少包括上传/校验/派生/提升耗时、去重复用数、失败与重试、delete_pending、missing/orphan、恢复差异和主图读取失败。
- 媒体 API 必须有内容长度、像素、并发和速率限制；响应失败不可泄露 bucket、内部 endpoint 或签名参数。

## 12. 正式初始化验收

正式媒体实现至少证明：

1. PNG/JPEG 的 multipart 上传、服务端 SHA-256/感知哈希、尺寸和类型校验；
2. 同内容换 URL/文件名精确去重，同 URL 内容变化产生新内容身份；
3. 非图片、超限、类型不符、上传中断和对象存储中断均不留下正式半成品；
4. CandidateClient owner 隔离、凭据撤销、generic CRUD 和主图攻击全部被拒；
5. thumbnail/preview 保持比例并可重建；
6. 人工提升、FigureImage 和人工主图选择均有同事务审计；
7. 来源失效、候选删除、延迟清理和真实引用检查保护正式主图；
8. prefix/provider 迁移后业务 ID、storage-key 语义和哈希保持；
9. PostgreSQL + 对象 manifest 联合备份恢复后，缺失/孤儿差异为 0；
10. 清理任务、临时对象、运行时秘密和测试媒体在测试后全部移除。

任何新的对象存储 provider、图片处理库、派生 recipe、主图关系或清理策略都必须触发迁移/恢复演练，并重新运行 [Payload 生产门禁规范](../research/PAYLOAD_PRODUCTION_GATE_SPEC.md) 中 PG-06—PG-11、PG-13 和 PG-14。
