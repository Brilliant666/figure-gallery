# Payload GitHub Actions 生产门禁

## 结论

2026-07-14，GitHub-hosted `ubuntu-24.04` runner 对 Payload CMS + Next.js spike 完成了一次完整、可重复的 PostgreSQL、S3、备份恢复、standalone 与安全门禁运行。运行 `29354756205`（attempt 1，提交 `d204767803b9c629ab262bc5ad5ccfc89751162e`）的 PG-01—PG-14 全部为 `pass`：**14 pass / 0 fail / 0 not_run / 0 environment_blocked，硬失败 0**。

这次通过足以解除此前仅由本机 Docker 不可用造成的证据缺口，并允许 ADR 更新为 `Accepted — Payload CMS + Next.js`。它仍不是生产部署、云资源验证或正式项目初始化。

## 可复现入口

- Workflow：`.github/workflows/payload-production-gates.yml`，名称 `Payload production gates`；
- Run：[29354756205](https://github.com/Brilliant666/figure-gallery/actions/runs/29354756205)，attempt 1，job `87159491089`，用时 5 分 54 秒；
- Runner：`ubuntu-24.04`，hosted image `ubuntu24/20260705.232.1`；
- Node `22.23.1`、npm `10.9.8`、Python `3.10.20`；
- Docker client/server `28.0.4`、Compose `2.38.2`；
- 锁文件版本：Payload `3.86.0`、`@payloadcms/db-postgres` `3.86.0`、`@payloadcms/storage-s3` `3.86.0`、Next.js `16.2.10`、Sharp `0.34.5`、`pg` `8.20.0`；
- 工作流未读取或依赖仓库 Secret；权限仅 `contents: read`；所有服务仅绑定 loopback。

## 基础设施

| 组件 | 固定引用 | 本次不可变 digest |
| --- | --- | --- |
| PostgreSQL | `postgres:16.9-bookworm` | `postgres@sha256:253815cf7579ffa05e1673d92e78d37273e61be0e4414e9a1449337d7925be94` |
| MinIO | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | `minio/minio@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e` |
| MinIO Client | `minio/mc:RELEASE.2025-04-16T18-13-26Z` | `minio/mc@sha256:aead63c77f9db9107f1696fb08ecb0faeda23729cde94b0f663edf4fe09728e3` |

PostgreSQL 与 MinIO health 均为 healthy；允许的监听为 `127.0.0.1:55432`、`127.0.0.1:59000`、`127.0.0.1:59001`，非 loopback 探测被拒绝。

## PG-01—PG-14

| 门禁 | 状态 | 关键机器证据 |
| --- | --- | --- |
| PG-01 fresh/repeat migration | `pass` | Payload migration engine；空库应用 1 个 migration，重复执行新增 0；schema 签名一致 |
| PG-02 seed 幂等 | `pass` | 两次 collection counts、数据 digest、settings digest 完全一致；差异 0 |
| PG-03 PostgreSQL 并发与事务 | `pass` | 30/30 PostgreSQL integration、8/8 concurrency suite、15/15 事务场景 |
| PG-04 备份/空库恢复 | `pass` | custom dump 259,525 bytes；38 表；恢复前后数据与关系 digest 一致，差异 0 |
| PG-05 恢复后边界 | `pass` | shared contract 78/78；恢复后攻击 12/12；联合服务 10 个端点全部 200 |
| PG-06 S3 原图 | `pass` | 合成 PNG/JPEG；SHA-256、aHash、格式、尺寸与重复读取核对 |
| PG-07 派生图 | `pass` | thumbnail/preview 对象、尺寸、格式、SHA-256 与读取均通过 |
| PG-08 正式主图生命周期 | `pass` | 来源失效并软删除、候选软删除后正式主图对象仍保留 |
| PG-09 MinIO 故障恢复 | `pass` | 中断时 503/稳定错误码、无数据库或审计残留；恢复后幂等重试成功 |
| PG-10 storage key/URL 解耦 | `pass` | 67 对象复制到新 prefix；未使用 public URL；storage-key 读取通过；源对象不变 |
| PG-11 联合恢复 | `pass` | 同一 snapshot 下 67 对象清单、清空、恢复、哈希、关系与权限全部闭合 |
| PG-12 standalone clean start | `pass` | 同一提交的干净 `git archive`、空库/空 bucket、`npm ci`、migration、seed、build、standalone 与攻击回归 |
| PG-13 standalone restart | `pass` | 数据/媒体 digest 与 30 个对象保持不变；候选身份及 multipart media ID 稳定 |
| PG-14 领域边界不可绕过 | `pass` | 初始 12/12、恢复后 12/12、clean 10/10、restart 10/10 攻击执行全部拒绝且状态不变 |

逐项状态和证据文件映射见 [`production-gates.json`](evidence/payload-prod-gate-ci/production-gates.json)。

## Artifact 验证

Artifact `payload-prod-gate-d204767803b9c629ab262bc5ad5ccfc89751162e`（ID `8319799533`）保留 5 天。GitHub API digest 与独立下载 ZIP 的实际 digest 均为：

`sha256:70247930088ffd27cd4bdf970e4e4507caf35c6bd0d4137d86d6bb94e3684512`

独立校验确认：ZIP 26,412 bytes；30 个根目录 JSON；无重复、越界路径、加密、符号链接或 `failure-summary.json`；manifest 精确覆盖其余 29 个文件并逐项匹配大小和 SHA-256；源提交、run ID、attempt、14 个门禁和清理状态均匹配。Artifact 内数据库备份、图片对象、运行时秘密均为 0。完整下载校验记录见 [`artifact-provenance.json`](evidence/payload-prod-gate-ci/artifact-provenance.json)。

## 实际测试与安全边界

- Payload Vitest：SQLite 45 pass / 8 PostgreSQL-only skipped；PostgreSQL integration 30/30；PostgreSQL concurrency/rollback 8/8；
- 共享 Python 合同：初始和恢复后均 78/78；
- TypeScript typecheck、ESLint、production build、workflow/YAML、Bash、Python 脚本和仓库文件校验通过；
- Hpoi network guard 通过，Python/TypeScript transport call 与 Hpoi 请求总数均为 0；
- 攻击覆盖无/错/撤销凭据、跨 client owner、正式 prototype/version/主图写入、REST/GraphQL/generic CRUD/Local API/Admin/domain endpoint、越界审核目标和已完成工作项；
- GraphQL 攻击的 HTTP 200 是传输成功，业务结果为 access denied；production introspection 已关闭；
- 清理后剩余容器 0、volume 0、监听端口 0，运行时 `.env`、备份、对象和临时工作树均已删除。

## 证据边界

- 数据和图片全部为测试时动态生成的合成 fixture；没有真实手办图片；
- PostgreSQL/S3 是 GitHub-hosted runner 上的临时 loopback PostgreSQL + MinIO，不是 AWS、生产云或跨区域灾备；
- 对象“备份”位于同一临时 MinIO 的独立 prefix，证明联合恢复协议，不等于异地灾备；
- `backup_restore_ms=5160` 覆盖 dump、对象清空、删库建库和恢复整体，不是纯 `pg_restore` 耗时；
- `record_count=262` 是十个业务 collection 的合计，不是全部物理表行数；
- clean checkout 使用同一提交的 `git archive`，不是重新从网络 clone；`build_ms=24770` 是构建耗时，不是 cold-start；
- `nft_warning=false` 和 114 个 Sharp runtime 文件只证明本次固定依赖和 runner；升级依赖或 runner 镜像后必须重跑；
- 本轮未做负载、长期稳定性、真实云凭据、公开域名、TLS、CDN、跨区恢复或生产部署测试。

## 最终提交门禁

仓库内证据来自第一次完整绿色提交。报告与证据提交推送后，必须由同一 workflow 对新的最终提交再完整运行，并重新校验其 Artifact；最终 run 元数据记录在 Draft PR 和任务交付中。将 run ID 再写回仓库会生成新的提交 SHA，因而不会以“追加一次只改 run ID 的提交”制造无限自引用。
