# Payload S3 兼容对象存储生产门禁结果

## 结论

在 GitHub-hosted `ubuntu-24.04` runner 的临时、loopback-only MinIO 环境中，PG-06—PG-11 全部 `pass`。验证使用 Payload `3.86.0` 与 `@payloadcms/storage-s3` `3.86.0`，只动态生成合成 PNG/JPEG；没有真实手办图片、生产 bucket 或云凭据。

## 环境

- MinIO：`minio/minio:RELEASE.2025-04-22T22-12-26Z`；digest `minio/minio@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e`；
- MinIO Client：`minio/mc:RELEASE.2025-04-16T18-13-26Z`；digest `minio/mc@sha256:aead63c77f9db9107f1696fb08ecb0faeda23729cde94b0f663edf4fe09728e3`；
- API/console 仅绑定 `127.0.0.1:59000/59001`；health 为 healthy；非 loopback 探测被拒绝；
- 所有对象、临时 prefix、凭据和合成文件在工作流结束时删除。

## PG-06：原图上传、读取与内容身份

状态：`pass`。

- 创建 3 个候选和一个独立 client identity；
- 合成 PNG/JPEG 通过 multipart 上传，自动记录尺寸、格式、SHA-256、aHash 和稳定 storage key；
- 审计三个媒体样本：PNG 1600×900 / 30,294 bytes，JPEG 1440×960 / 8,369 bytes，PNG 1366×768 / 23,193 bytes；
- 同内容换来源/文件名可去重；同 URL 内容变化保持为不同内容记录；
- original、preview、thumbnail 均可重复读取且哈希稳定；
- 对象审计 67 expected / 67 actual，missing 与 orphaned 均为空。

证据：[`media-setup.json`](evidence/payload-prod-gate-ci/media-setup.json)、[`media-audit.json`](evidence/payload-prod-gate-ci/media-audit.json)。

## PG-07：派生图、读取与重建

状态：`pass`。

- Preview 与 thumbnail 实际生成到 S3 并按 storage key 读取；
- 每项机器证据包含 key、尺寸、格式、byte size 和 SHA-256；
- 派生图删除后能从仍存在的原图重建，并恢复同一 SHA-256；
- 示例 thumbnail 为 1,551 bytes，SHA-256 `32780472c61beb4548ff967c5ab3e693186adac4371b3005703d2b18beec7bac`；
- 原图缺失时明确拒绝伪造派生图成功。

证据：[`media-audit.json`](evidence/payload-prod-gate-ci/media-audit.json)、[`media-lifecycle.json`](evidence/payload-prod-gate-ci/media-lifecycle.json)。

## PG-08：来源/候选删除后的正式主图

状态：`pass`（硬门禁）。

- SourceRecord 被标记失效并软删除；
- CandidateRecord 被软删除；
- 已人工提升的正式主图仍指向 media ID 33；
- 原图和派生对象保持存在，最终审计仍为 67/67；
- 孤儿探针能发现异常，原图缺失时不假成功。

证据：[`media-lifecycle.json`](evidence/payload-prod-gate-ci/media-lifecycle.json)。

## PG-09：MinIO 中断、补偿与恢复

状态：`pass`。

中断时：

- 上传返回 HTTP 503 和稳定错误码 `candidate_media_storage_unavailable`；
- 正式媒体读取明确得到 `connection_refused`，没有假成功；
- `database_media_delta=0`、`operation_log_delta=0`，正式主图不变；
- 错误被标记为可重试。

恢复后：

- 服务与正式读取恢复，重试成功且保持幂等；
- 恢复媒体 ID 37 只有原图和两个派生对象，共 3 个对象；
- 最终对象审计仍为 67/67；
- 另在“对象上传后、事务提交前”注入故障：返回 503 / `candidate_media_commit_failed`，补偿删除已上传对象，业务 prefix key 集合前后摘要一致，Media/FigurePrototype/FigureVersion/OperationLog 增量均为 0，主图和候选关系不变。

证据：[`media-outage.json`](evidence/payload-prod-gate-ci/media-outage.json)、[`media-recover.json`](evidence/payload-prod-gate-ci/media-recover.json)。

## PG-10：storage key 与公开 URL 解耦

状态：`pass`。

- 业务 `storage_key` 不包含 endpoint 或 public URL；
- 为 67 个对象建立一一对应的 prefix 迁移映射，mapping SHA-256 为 `e57a749dc239e133bdbb6a239dd3a1d785af372ac228d7bad76d2834bb49c6aa`；
- 总对象字节数 120,712；source/migrated key 均唯一，ETag 与逐项 SHA-256 相符；
- 迁移过程没有使用 public URL，迁移后按 storage key 读取通过；
- 源对象保持不变，临时迁移 prefix 随后清空。

证据：[`media-audit.json`](evidence/payload-prod-gate-ci/media-audit.json)、[`media-migrate-prefix.json`](evidence/payload-prod-gate-ci/media-migrate-prefix.json)。

## PG-11：数据库与对象联合恢复

状态：`pass`（硬门禁）。

同一 snapshot ID `29354756205-1-d204767803b9c629ab262bc5ad5ccfc89751162e` 贯穿数据库、对象清单、恢复后合同和联合服务：

- 对象 manifest 67 项（64 PNG、3 JPEG），总大小 120,712 bytes，manifest SHA-256 `f881a935c2daa2c7139073e227787cd1b87eb0c3d4393dd3a50d59ec330de813`；
- Source key 和 backup key 各 67 个且唯一，每项有 SHA-256，source/backup ETag 全部一致；
- 业务 prefix 实际删除 67 个对象并确认为空；
- 恢复 67 个对象且逐项 SHA-256 通过，DB↔对象审计无 missing/orphaned；
- 临时 backup prefix 的 67 个对象随后删除并确认为空；
- 恢复后 shared contract 78/78、权限攻击 12/12、联合服务 smoke 及正式主图/来源/设置关系均通过。

证据：[`media-backup-manifest.json`](evidence/payload-prod-gate-ci/media-backup-manifest.json)、[`media-purge.json`](evidence/payload-prod-gate-ci/media-purge.json)、[`media-restore.json`](evidence/payload-prod-gate-ci/media-restore.json)、[`backup-restore.json`](evidence/payload-prod-gate-ci/backup-restore.json)、[`restore-regressions.json`](evidence/payload-prod-gate-ci/restore-regressions.json)、[`restored-joint-smoke.json`](evidence/payload-prod-gate-ci/restored-joint-smoke.json)。

## 准确性边界

- 这是 MinIO 的 S3 兼容接口验证，不是 AWS S3、真实云 bucket、跨 region 或跨 account 测试；
- 对象“备份”使用同一临时 MinIO 的独立 prefix，证明联合快照与恢复协议，不等于异地灾备或整个 MinIO 磁盘丢失恢复；
- Prefix migration 证明 storage-key 语义不依赖 public URL，并完成同一服务内的复制；没有实际切换 provider、endpoint、bucket、区域或凭据；
- 故障模型覆盖连接拒绝和一个提交前注入点，不代表网络延迟、分区、数据损坏或集群级故障全覆盖；
- 三个合成样本的 aHash 均为 `ffffffffffffffff`：可证明字段被计算和保存，不能证明其对真实图片具有足够区分力；内容幂等主要由 SHA-256 与业务键证明；
- 生命周期测试覆盖软删除和引用保持，不是长期垃圾回收、保留期限或大规模清理策略验证；
- 制品不含对象本体，不能从提交后的 JSON 重新执行对象二进制恢复；原始临时对象已按要求清除。
