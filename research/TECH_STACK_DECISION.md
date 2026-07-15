# ADR：手办图库技术底座选择

## 状态

`Accepted — Payload CMS + Next.js`

本状态接受 Payload CMS + Next.js 作为项目技术底座，并接受 PostgreSQL、S3 兼容对象存储和 `.next/standalone` 作为当前验证过的正式运行边界。它不表示正式项目已经初始化，也不授权把 spike 复制成正式应用或立即部署。

## 决策日期

2026-07-14（Asia/Shanghai）

## 背景

项目需要表达 Work、Character/alias、Manufacturer、FigurePrototype、FigureVersion、SourceRecord、CandidateRecord、CandidateImage、ReviewWorkItem、OperationLog 与 SystemSetting。外部采集只能写候选池；正式字段、版本归属和主图必须人工确认；所有正式变化需要可审计；merge、split 和指定 undo 需要稳定 operation ID、作用域、依赖和并发冲突控制。

VAL-02 用可丢弃原型比较 Wagtail 与 Payload CMS + Next.js。VAL-02B 验证真实浏览器审核、合成文件导入、per-client 身份和 owner 隔离、ReviewWorkItem、并发、指定 undo、最小正式管理入口及本地生产形态。项目所有者随后明确把 Payload 定为首选方向，但 PR #6 时本机 Docker daemon 不可用，PostgreSQL、S3、联合恢复和完整 standalone 仍是 `environment_blocked`，ADR 因而保持 Proposed。

本轮没有修改本机 Docker，而是在 GitHub-hosted Ubuntu 24.04 runner 建立只读权限、不读取或依赖仓库 Secret、loopback-only 的可重复 CI，补齐 PG-01—PG-14。

## 候选

1. `Payload CMS + Next.js`：本 ADR 选择；
2. `Wagtail`：保留历史研究与备用信息，不继续平行验证，也不作为当前技术底座。

没有新增第三种框架，没有 Fork、复制或导入任何图库仓库。

## 证据

### 历史产品与业务证据

- VAL-02/VAL-02B 已证明两端都能表达核心业务合同；
- 项目所有者的实际后台体验明确偏好 Payload 的信息结构和交互；
- Payload 已通过浏览器审核、候选 multipart、SHA-256/aHash、per-client hash-only 凭据、撤销、owner 隔离、主图保护、ReviewWorkItem、乐观锁、merge/split/指定 undo 和最小领域管理入口；
- Wagtail 的历史原型和风险记录继续保留，但本轮按授权没有重跑或修改 Wagtail。

### Payload 生产门禁

GitHub Actions `Payload production gates` run `29354756205`、attempt 1、source commit `d204767803b9c629ab262bc5ad5ccfc89751162e` 得到：

- PG-01—PG-14 全部 `pass`；
- 14 pass / 0 fail / 0 not_run / 0 environment_blocked；
- 硬失败 0，validation errors 0；
- 清理 pass，Hpoi 请求 0。

核心结果：

- Payload migration engine 从空 PostgreSQL 应用 migration，重复执行幂等；重复 seed 计数与 digest 一致；
- PostgreSQL integration 30/30、并发/回滚 8/8、聚合事务场景 15/15；
- PostgreSQL custom backup 经删库、空库重建与恢复后，业务计数、数据 digest、关系 digest 差异均为 0；
- 恢复后 shared contract 78/78、权限攻击 12/12、联合服务与正式主图/媒体关系通过；
- S3 合成 PNG/JPEG 原图、thumbnail、preview、SHA-256、aHash、去重、故障补偿、生命周期、67 对象 prefix migration 和联合恢复均通过；
- 来源失效/软删与候选软删不会删除已提升的正式主图；
- 同一提交的干净 `git archive` 从空 PostgreSQL/空 bucket 完成 `npm ci`、migration、seed、production build 和 `.next/standalone` clean start；
- Restart 后数据/媒体 digest、30 个对象以及 candidate/source/multipart-media 身份保持；
- 初始、恢复后、standalone clean/restart 四轮共 44 次攻击执行全部拒绝且不破坏正式数据、主图或审计边界；
- Production GraphQL introspection 关闭；直接正式 mutation 被 access control 拒绝；
- NFT warning 未出现，114 个 Sharp runtime 文件随 standalone 实际运行，原图和派生图端点在 clean/restart 均为 200。

解释性证据：

- [PAYLOAD_CI_PRODUCTION_GATE.md](PAYLOAD_CI_PRODUCTION_GATE.md)
- [PAYLOAD_POSTGRES_RESULTS.md](PAYLOAD_POSTGRES_RESULTS.md)
- [PAYLOAD_S3_RESULTS.md](PAYLOAD_S3_RESULTS.md)
- [PAYLOAD_STANDALONE_RESULTS.md](PAYLOAD_STANDALONE_RESULTS.md)
- [PAYLOAD_PRODUCTION_GATE_DECISION.md](PAYLOAD_PRODUCTION_GATE_DECISION.md)
- [机器门禁汇总](evidence/payload-prod-gate-ci/production-gates.json)
- [Artifact 独立校验](evidence/payload-prod-gate-ci/artifact-provenance.json)

## 决策

**选择 Payload CMS + Next.js。**

- Payload CMS + Next.js 成为项目技术底座；
- PostgreSQL 是目标正式数据库；
- S3 兼容对象存储是正式图片存储边界；
- Next.js/Payload `.next/standalone` 是当前被验证过的部署形态；
- 正式初始化必须等待后续独立授权任务，并从官方脚手架干净创建；
- `spikes/val02_payload/` 与 `spikes/payload_prod_gate/` 继续是可丢弃验证代码，禁止直接迁移为正式项目。

## 选择理由

1. **业务模型和审核边界已被真实实现验证。** Payload 能表达候选、正式记录、媒体、工作项和操作日志；专用 endpoint、owner、领域 service、事务与乐观锁已经证明可建立不可绕过边界。
2. **项目所有者对实际管理体验的偏好明确。** Payload 的 Admin 和 Next.js 组合更符合图库审核与管理预期；该偏好现在由生产门禁证据支撑，而不再只是产品观感。
3. **此前的关键生产未知项已关闭。** PostgreSQL migration/seed/并发/恢复、S3 生命周期/故障/联合恢复、standalone clean/restart 和安全回归都已实际执行，没有 hard fail 或 environment block。
4. **数据与媒体迁移边界清晰。** PostgreSQL 可用标准 dump/restore；媒体以稳定 storage key、内容哈希和独立 manifest 表达，公开 URL 不进入业务主键。
5. **可重复部署形态已经实际启动。** 锁文件安装、production build、standalone trace、Sharp runtime、静态/Admin/媒体/health 和重启均在 Linux clean tree 通过。

## 被拒绝方案

### Wagtail

Wagtail 不作为当前技术底座。它并非因本轮出现新失败而被淘汰；本轮按授权没有继续验证它。历史证据仍可用于 Payload 未来发生硬门禁失败时的重新评估，但恢复 Wagtail 路线必须是新的明确授权任务，并重新处理 PostgreSQL/S3 生产证据与 Treebeard 版本/manager 风险。

### 直接把 spike 当正式项目

明确拒绝。Spike 包含验证便利、合成 fixture 和门禁专用结构，不具有正式项目的初始化、配置、运维和长期升级承诺。技术接受不改变其“可丢弃验证代码”属性。

## 风险

- 单次 GitHub-hosted runner、小型合成数据不足以证明生产规模吞吐、长期稳定性或运维容量；
- MinIO 的 S3 兼容验证不等于 AWS S3 或其他真实 provider；同一临时服务的 backup prefix 不等于异地/跨区灾备；
- Prefix migration 没有实际更换 provider、endpoint、bucket、区域或凭据；
- 三个合成样本的 aHash 均为 `ffffffffffffffff`，真实图片的感知相似度区分能力仍未验证；
- Clean tree 来自同提交 `git archive`；没有网络 clone、公开域名、TLS、CDN、真实 secret manager、生产观测和云部署证据；
- Payload hooks、generic Collections/Admin/Local API、GraphQL、adapter 和 migration 升级都可能重新打开领域旁路；
- Next.js NFT、Sharp 原生依赖与 hosted runner 镜像升级可能改变 standalone 完整性；
- 当前 Windows 本机 Docker daemon 仍不可用，本轮没有修复；这不影响 GitHub runner 证据，但会影响未来本机基础设施开发体验；
- Hpoi 数据源风险与本 ADR 无关，本轮 Hpoi 请求为 0。

## 缓解措施

1. 固定 Payload、Next.js、PostgreSQL adapter、S3 plugin、Sharp、PostgreSQL 和对象存储版本；依赖升级前重跑完整 PG-01—PG-14；
2. 正式云环境建立后，使用非生产账号补做实际 provider、bucket policy、签名 URL、TLS、CDN、故障与跨区恢复演练；
3. 将数据库 dump 与对象 manifest 写入独立备份介质，并验证共同 snapshot、恢复顺序和恢复后合同；
4. 用经过授权的小型真实风格但不受版权限制的图像集单独评估 pHash/aHash，内容主身份继续使用 SHA-256；
5. 把攻击矩阵、Hpoi network guard、schema 签名、storage-key 审计和 clean standalone 保持为必过 CI；
6. 正式项目初始化时重新建立环境变量、secret manager、health/readiness、日志、监控、告警、备份保留和回滚流程；
7. 不为本任务修改 Windows Docker；若本地开发需要容器，另行授权修复或使用可用的远程/CI 非生产环境。

## 正式项目必须遵守的架构约束

1. 正式项目由后续独立任务从官方脚手架干净初始化，不复制、移动或重命名任何 `spikes/` 原型。
2. 候选区与正式区保持独立写边界。采集客户端只能 candidate upsert 和候选媒体上传，不能写 Work、Character、Manufacturer、FigurePrototype、FigureVersion、SystemSetting 或正式主图。
3. 每个采集客户端使用独立、可撤销、可归因凭据；服务端只存凭据哈希并强制 active 状态和 owner；不得以 loopback、UI 隐藏或客户端约定代替授权。
4. 所有正式变化必须经过领域 service、数据库原子事务、乐观锁和 OperationLog；generic Admin/REST/GraphQL/Local API 只能只读或调用同一受控 service。
5. 审核必须绑定 ReviewWorkItem、allowed targets、审核人和 lock version；完成、reopen、冲突和越界新建都必须审计。
6. Merge、split、undo 使用稳定 operation ID、作用域、版本和依赖；只允许指定撤销安全操作，不允许“全局最近一次”或静默覆盖。
7. 正式主图只能人工选择，采集器永不自动替换；来源失效、候选删除或重新采集不得删除或改写既有正式主图。
8. 媒体内容身份使用 SHA-256，感知哈希只作相似性辅助；业务关系使用稳定 storage key，公开 URL、endpoint 和签名 URL 不得成为主键。
9. PostgreSQL 为正式数据层；S3 兼容对象存储为正式媒体层。迁移 provider 时保持关系 ID 和 storage-key 语义，并执行对象清单、逐项哈希和孤儿/缺失审计。
10. 数据导出至少覆盖 JSON、关系化 CSV 和图片 manifest，包括 ReviewWorkItem、OperationLog、SystemSetting、关系 ID、storage key、SHA-256 和 aHash；排除图片二进制与凭据。
11. 备份必须联合数据库 snapshot 和对象 manifest；恢复到空环境后重跑 schema、关系、权限、主图、来源状态、成人设置、对象缺失/孤儿和 standalone 合同。
12. 生产形态使用锁文件、migration、正式 server、health/readiness、静态/Admin/媒体 smoke、可重复重启和无硬编码 secret；初次环境验证仅绑定 loopback，公开部署另行授权。
13. Hpoi 或其他外部数据源继续遵守公开、有限、低频、只读、不使用 Cookie/私人 Token、不绕过访问控制；来源数据只能进入候选池。

## 重新评估触发条件

- Payload、Next.js、`@payloadcms/db-postgres`、`@payloadcms/storage-s3`、Sharp、PostgreSQL、MinIO/S3 provider 或 runner 镜像升级；
- 正式 schema、migration、候选 endpoint、认证、owner、领域 service、ReviewWorkItem、merge/split/undo、主图或 storage-key 语义变化；
- `.next/standalone` 不再是目标部署形态，或需要 serverless/edge/其他 runtime；
- 任何 hard gate 回归：候选可写正式数据/主图、跨 owner 失败、关系断裂、恢复不一致、来源删除丢主图、clean start 失败或 Admin/CRUD 绕过审计；
- 真实云 S3、云 PostgreSQL、公开域名或跨区灾备准备启用；
- 项目规模、审核吞吐或维护成本证明当前技术底座不可接受；
- 项目所有者明确要求重新比较 Wagtail 或其他候选。

本 ADR 到此只完成技术决策。未初始化正式项目，未部署云服务器，未访问 Hpoi，未使用真实手办图片，未开始原画图库或 VAL-03。
