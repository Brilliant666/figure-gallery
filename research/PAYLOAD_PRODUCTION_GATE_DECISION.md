# Payload 生产门禁判定

## 判定

**通过。允许把技术 ADR 更新为 `Accepted — Payload CMS + Next.js`。**

2026-07-14 的 GitHub Actions run `29354756205`（attempt 1，提交 `d204767803b9c629ab262bc5ad5ccfc89751162e`）在 GitHub-hosted Ubuntu 24.04 runner 上完成 PG-01—PG-14：

- 14 pass；
- 0 fail；
- 0 not_run；
- 0 environment_blocked；
- 0 hard failure；
- validation errors 为空；
- cleanup pass；
- Hpoi 请求 0。

本判定解除 PR #6 中“本机 Docker daemon 不可用，0 pass / 14 environment_blocked”的环境证据缺口。它接受的是技术底座与已经验证的生产边界，不授权初始化正式项目、复制 spike、使用云资源或部署。

## 判定依据

| 条件 | 结果 | 证据摘要 |
| --- | --- | --- |
| PostgreSQL fresh/repeat migration | 满足 | Payload migration engine；空库应用 1 个 migration，重复新增 0；恢复后 schema 一致 |
| 重复 seed 幂等 | 满足 | 两轮计数、数据 digest、settings digest 一致，既有主图保持 |
| PostgreSQL 并发和事务 | 满足 | 30/30 integration、8/8 concurrency、15/15 聚合事务场景 |
| 备份恢复一致 | 满足 | custom dump→删库→空库恢复；数据/关系 digest 与计数差异 0 |
| 恢复后权限边界 | 满足 | shared contract 78/78、攻击 12/12、联合服务和媒体关系通过 |
| S3 原图和派生图 | 满足 | 合成 PNG/JPEG、SHA-256/aHash、thumbnail/preview、重复读取和审计闭合 |
| 正式主图生命周期 | 满足 | 来源失效/软删和候选软删后，正式主图及对象保持 |
| 对象存储故障可控 | 满足 | 503/稳定错误码、无残留；恢复重试和提交前补偿通过 |
| Storage key/URL 解耦 | 满足 | 67 对象 prefix 迁移、未使用 public URL、storage-key 读取通过 |
| 数据库与对象联合恢复 | 满足 | 同一 snapshot 下 67 对象清空/恢复、哈希和 DB 关系一致 |
| Standalone clean start | 满足 | 干净 git archive、空库/空 bucket、npm ci、migration、seed、build、启动和攻击 |
| Standalone restart | 满足 | 数据/媒体 digest、30 个对象和 candidate/source/media 身份保持 |
| 领域 service 不可绕过 | 满足 | 四轮共 44 次攻击执行全部拒绝，正式数据/主图/审计不变量成立 |

逐项状态见 [`production-gates.json`](evidence/payload-prod-gate-ci/production-gates.json)，解释性总报告见 [PAYLOAD_CI_PRODUCTION_GATE.md](PAYLOAD_CI_PRODUCTION_GATE.md)。

## 制品可信度

工作流 Artifact `payload-prod-gate-d204767803b9c629ab262bc5ad5ccfc89751162e`（ID `8319799533`）由固定 SHA 的官方 `actions/upload-artifact` 上传，保留 5 天。GitHub API 与独立下载的 ZIP SHA-256 均为：

`70247930088ffd27cd4bdf970e4e4507caf35c6bd0d4137d86d6bb94e3684512`

独立校验确认 ZIP 大小、路径安全、文件集合、逐文件大小/SHA-256、source commit、run/attempt、PG 状态、Hpoi 计数和清理状态；无 `failure-summary.json`，无数据库备份、图片对象或运行时秘密。见 [`artifact-provenance.json`](evidence/payload-prod-gate-ci/artifact-provenance.json)。

## 接受后的技术边界

1. Payload CMS + Next.js 正式成为项目的技术底座；
2. PostgreSQL 是目标正式数据库；
3. S3 兼容对象存储是正式图片存储边界；业务关系使用稳定 storage key，不使用公开 URL 作为主键；
4. Next.js/Payload `.next/standalone` 是当前被实际验证过的部署形态；
5. 候选写入与正式数据继续保持独立权限边界；采集客户端不能修改正式数据或主图；
6. 正式维护必须通过领域 service、数据库事务、乐观锁和 OperationLog；generic CRUD/Admin/Local API 不得旁路；
7. 正式主图只能人工选择，来源或候选删除不能级联删除正式主图对象；
8. 数据库备份与对象 manifest 必须共享 snapshot identity，并在恢复后重跑权限和关系合同；
9. 正式项目必须由后续独立授权任务从官方脚手架干净初始化，禁止直接复制或移动 `spikes/val02_payload/`。

## 尚未解决但不阻止接受的风险

- 证据基于单次 GitHub-hosted Ubuntu 24.04 运行、固定依赖和小型合成数据；没有生产规模、峰值并发或长期稳定性数据；
- MinIO 验证不等于 AWS S3 或真实云 provider；同服务独立 prefix 的对象备份不等于异地/跨区灾备；
- Prefix migration 没有实际切换 provider、endpoint、bucket、区域或凭据；
- aHash 在三个合成样本中均为 `ffffffffffffffff`，只证明计算链路，真实图片的感知区分能力仍需后续专门验证；
- Clean tree 来自同提交 `git archive` 而不是网络 clone；没有单独 cold-start、热响应或负载指标；
- GraphQL、Payload hooks、generic Collections/Admin 和 adapter 升级可能重新打开旁路；依赖或 schema 变化必须重跑完整门禁；
- 没有验证公开域名、TLS、CDN、可观测性、生产 secret 管理、跨区恢复、真实云账单和运维流程；
- 本地 Windows Docker 仍未修复，本次完全没有继续重试或修改本机 Docker。

## 重新评估触发条件

出现以下任一情况，必须重新运行 PG-01—PG-14，必要时把 ADR 降回 `Proposed` 或 `Undecided`：

- Payload、Next.js、PostgreSQL adapter、S3 plugin、Sharp、PostgreSQL major/minor、MinIO 或 runner 镜像升级；
- Migration、正式领域模型、权限 hook、candidate endpoint、ReviewWorkItem、merge/split/undo、主图或 storage-key 语义变化；
- 正式部署不再使用 `.next/standalone`，或对象存储 provider/endpoint/bucket 策略变化；
- 备份恢复、正式主图生命周期、owner 隔离、事务原子性或 generic CRUD/Admin 绕过出现回归；
- 准备使用真实云资源或开始正式项目初始化前，需要补充该环境自己的部署、secret、TLS、监控和灾备验证。

## 停止条件

生产门禁已达到“14 项全部通过”的停止条件。本任务到此只形成研究、CI 和 ADR 证据：未建立正式项目，未部署云服务器，未访问 Hpoi，未使用真实手办图片，未继续 Wagtail，也未开始原画图库或 VAL-03。
