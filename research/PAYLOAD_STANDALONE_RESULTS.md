# Payload standalone 生产门禁结果

## 结论

PG-12—PG-14 在 GitHub-hosted `ubuntu-24.04` runner 上全部 `pass`。固定依赖的 Payload CMS + Next.js standalone 从同一提交的干净临时树、空 PostgreSQL 数据库和空 MinIO bucket 完成安装、migration、seed、production build、启动、攻击回归、停止和重启；数据、对象及候选协议身份保持一致。

## 固定版本和 Linux 环境

- Payload `3.86.0`、`@payloadcms/db-postgres` `3.86.0`、`@payloadcms/storage-s3` `3.86.0`；
- Next.js `16.2.10`、Sharp `0.34.5`、`pg` `8.20.0`；
- Node `22.23.1`、npm `10.9.8`；
- Hosted image `ubuntu24/20260705.232.1`，Ubuntu 24.04；
- 文件系统大小写敏感、POSIX `/` 路径、LF 行尾、shell 脚本可执行，临时目录 `/home/runner/work/_temp`、时区 UTC；
- 所有服务仅绑定 loopback；没有使用 `next dev`。

## PG-12：clean start

状态：`pass`（硬门禁）。

- 使用 `git archive` 从提交 `d204767803b9c629ab262bc5ad5ccfc89751162e` 建立干净临时树；
- 初始 public table 0、bucket 对象 0；
- `npm ci` 按 lockfile 完成；migration、seed、production build 均 pass；
- `.next/standalone` 组装成功并以正式 server 启动；
- Build 用时 24,770 ms；
- health、root、Admin、static、original、thumbnail、preview 均 HTTP 200；
- PostgreSQL 与 S3 均为真实启用状态，服务仅 loopback；
- Clean-start 10/10 standalone 攻击全部被拒绝，正式状态、主图和攻击前后的 OperationLog 不变；
- Production GraphQL introspection 关闭；直接 `deleteFigureVersion` 请求虽为 HTTP 200，但业务结果为 access denied。

## 候选 live protocol

Clean start：

- Candidate IDs 9、10；SourceRecord IDs 14、15；multipart media ID 16；
- 候选 upsert 和 multipart upload 均 pass；
- `expected_existing=false`，对象数由 28 增至 30；
- replay mode 为 `initial_write`。

Restart：

- Candidate、SourceRecord 和 multipart media ID 与 clean start 完全相同；
- `expected_existing=true`，upsert/upload 均 pass，对象数保持 30→30；
- replay mode 为 `idempotent_identity_replay`；
- 正式主图、关系、SystemSetting 和 users 均不变；
- 合法的两个候选两次 upsert 共增加 4 条 `candidate_upsert` 审计；媒体重复上传不产生重复对象。

因此，“攻击导致的 OperationLog 不变”与“合法候选 replay 产生预期 4 条审计”是两个不同断言，不能把整个 restart 描述为没有审计变化。

## PG-13：停止与重启

状态：`pass`。

- 停止后使用同一 clean standalone 重新启动；
- health、root、Admin、static、original、thumbnail、preview 再次全部 200；
- 数据库 digest 前后均为 `eb9ee47796266c024a9c958696df44b29ed4fc9474438e8a7720ac5628ae9e11`；
- 媒体 digest 前后均为 `934e0fcc391a836402b079122608c8b833732e9588dba2feeb1102124c3e3f1a`；
- 对象数 30→30，`restart_difference_count=0`；
- `data_persisted=true`、`media_persisted=true`；
- Restart 10/10 standalone 攻击仍全部拒绝。

## NFT / Sharp trace

- `standalone_assembled=true`；
- `nft_warning=false`；
- Standalone 输出中发现 114 个 Sharp runtime 文件；
- 原图、thumbnail、preview 在 clean start 和 restart 均真实返回 200；
- 未依赖 `next dev`。

这证明固定依赖与本次 runner 的 standalone trace 足以实际启动和处理图片，不代表未来 Next.js/Sharp 或 runner 升级无需重跑。

## PG-14：不可绕过领域服务

状态：`pass`（硬门禁）。

机器证据记录四轮攻击执行：

- 初始 PostgreSQL/S3 矩阵 12/12；
- 数据库与对象恢复后矩阵 12/12；
- Standalone clean start 10/10；
- Standalone restart 10/10。

合计 44 次执行全部通过；这是执行次数，不是 44 种互不重复的攻击。覆盖：

- 无 Token、错误 Token、已撤销 Token；
- Client A 修改 Client B；
- Candidate 写 FigurePrototype/FigureVersion 或替换正式主图；
- Generic REST CRUD、Local API、Admin generic save；
- 越界 ReviewWorkItem target、修改已完成工作项；
- Standalone REST、GraphQL、未认证 Admin 创建和 custom domain endpoint。

每项均要求拒绝，并证明正式状态、正式主图和 OperationLog 没有因失败尝试产生错误变化。GraphQL HTTP 200 只表示 GraphQL 传输成功；实际 mutation 被 access control 拒绝。

证据：[`security-initial.json`](evidence/payload-prod-gate-ci/security-initial.json)、[`restore-regressions.json`](evidence/payload-prod-gate-ci/restore-regressions.json)、[`standalone-attacks-clean-start.json`](evidence/payload-prod-gate-ci/standalone-attacks-clean-start.json)、[`standalone-attacks-restart.json`](evidence/payload-prod-gate-ci/standalone-attacks-restart.json)。

## Hpoi guard 与回归

- Hpoi 请求总数 0；Python transport calls 0；TypeScript transport calls 0；
- 共享合同初始与恢复后均为 78/78，underlying transport calls 0；
- SQLite 回归 45 pass / 8 PostgreSQL-only skipped；PostgreSQL integration 30/30；concurrency/rollback 8/8；
- `regressions.json` 中两个 PostgreSQL suite 的 `hpoi_transport_guard_passed=false` 表示 suite 本身没有内嵌 guard，不能写成那两个 suite 自带 guard；Hpoi=0 的依据是独立 network guard、共享合同和工作流总计。

## 清理

状态：`pass`。

- 剩余容器 0、volume 0、监听端口 0；
- Runtime `.env`、数据库备份、临时对象、工作目录和恢复用 Next 临时树均删除；
- Checkout 中没有残留 media；
- Artifact 只含 JSON，数据库备份、图片对象和 runtime secrets 均为 0。

证据：[`standalone.json`](evidence/payload-prod-gate-ci/standalone.json)、[`cleanup.json`](evidence/payload-prod-gate-ci/cleanup.json)、[`manifest.json`](evidence/payload-prod-gate-ci/manifest.json)。

## 准确性边界

- `git archive` 证明同一提交的干净临时树，不等于重新从网络 clone；
- `build_ms=24770` 是 production build 时间，不是 cold-start；没有单独记录 cold-start 或热响应基准；
- HTTP 200 smoke 证明指定端点可用，不是生产负载、长时间稳定性、公开域名、TLS 或 CDN 测试；
- 验证的是 GitHub runner 上的 loopback PostgreSQL + MinIO，不是云部署；
- 没有部署服务器、没有真实生产凭据、没有正式应用目录，也没有将 spike 迁移成正式项目。
