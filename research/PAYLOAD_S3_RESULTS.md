# Payload S3 生产门禁结果

## 1. 结论

2026-07-14 的 MinIO/S3 验证因 Docker daemon 不稳定而未进入服务启动阶段。没有 MinIO 容器、bucket、prefix、对象、合成图片、access key 或 secret 被创建。PG-06—PG-11 均为 `environment_blocked`；硬失败数为 0。

机器摘要：[`s3-results.json`](evidence/payload-prod-gate/s3-results.json)。

## 2. 版本与计划配置

| 项目 | 固定值 | 实际状态 |
| --- | --- | --- |
| MinIO server | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | 仅计划；未证明拉取或运行 |
| MinIO client | `minio/mc:RELEASE.2025-04-16T18-13-26Z` | 仅计划；初始化未运行 |
| Payload S3 plugin | `@payloadcms/storage-s3` `3.86.0` | 官方依赖已锁定；未连接对象存储 |
| endpoint | 运行时环境变量，loopback，MinIO 显式 `forcePathStyle=true` | 未生成运行时配置 |
| bucket/prefix | 每次测试独立、运行时生成 | 未创建 |
| 身份 | `storageKey`，公开 URL 仅为可变呈现 | 设计约束；未做真实迁移验证 |
| 端口 | 只允许 loopback | 配置默认端口 `59000`/`59001` 无监听 |

配置文件中的固定镜像与 loopback 约束只是计划证据，不代表镜像成功拉取或服务运行。Docker daemon 故障与停止原因见 [`environment-summary.json`](evidence/payload-prod-gate/environment-summary.json)。

## 3. 上传、读取与派生图

以下真实对象存储闭环均未运行：

1. 候选客户端 multipart 上传运行时合成 PNG/JPEG；
2. 原图进入候选媒体 prefix；
3. 按 storage key 读取原始字节；
4. 校验尺寸、格式、SHA-256 与 aHash；
5. 生成并读取 thumbnail/preview；
6. 管理员将候选图提升为正式主图；
7. 相同内容不同文件名去重；
8. 相同 URL 不同内容产生新版本/差异；
9. 非图片、超限和 MIME 欺骗拒绝；
10. 重试不产生重复对象或残缺正式记录。

因此 PG-06 和 PG-07 均为 `environment_blocked`。本地文件媒体的历史结果不能证明 S3 plugin、MinIO path-style、派生图写回或读取路径。

## 4. 正式主图生命周期

下列高风险删除场景未在 S3 上执行：

- 标记或删除 SourceRecord 后正式主图仍存在；
- 删除 CandidateRecord 后已提升对象仍存在；
- 未使用候选对象按显式规则清理且不误删；
- 候选同步不能替换正式主图；
- public URL 或 endpoint 改变后仍能由 storage key 定位对象。

PG-08 是硬门禁，目前为 `environment_blocked`，不是通过。正式主图对象的保留、引用计数/生命周期策略与删除保护仍是未解决风险。

## 5. MinIO 故障与恢复

没有 MinIO 服务可暂停或恢复，所以下列项目未执行：

- 正常上传/读取基线；
- 服务中断期间上传和读取明确失败；
- 不产生假成功或残缺正式记录；
- 正式主图和 OperationLog 不变化；
- 服务恢复后相同幂等键重试成功且不重复。

PG-09 为 `environment_blocked`。未生成故障注入日志，也没有以本地文件失败模拟替代真实 S3 故障。

## 6. Prefix 迁移与 manifest

以下验证未运行：

- 将原图、thumbnail、preview 复制到新 prefix/bucket；
- 切换 endpoint/public URL 后由 storage key 重建访问；
- 迁移前后 SHA-256 一致；
- 检测“数据库有引用但对象缺失”“对象存在但数据库无引用”“哈希不一致”；
- 只审计可疑孤儿而不自动删除；
- 输出不含二进制和凭据的媒体 manifest。

PG-10 为 `environment_blocked`。当前只有身份设计约束，没有真实对象迁移证据。

## 7. PostgreSQL 与对象存储联合恢复

数据库备份、对象 manifest、共同快照标识、空库恢复、Payload 重启、页面/审核/媒体验证和派生图重建均未执行。PG-11 是硬门禁，目前为 `environment_blocked`。

无法验证的关键问题包括：

- 数据库与对象存储一致性窗口；
- 原图不可再生、派生图可再生的恢复顺序；
- 恢复后正式主图、成人设置、来源失效和候选权限是否保持；
- 缺失/孤儿对象检测是否准确。

## 8. PG 状态与清理

| ID | 状态 | 说明 |
| --- | --- | --- |
| PG-06 | `environment_blocked` | S3 原图上传/读取未执行 |
| PG-07 | `environment_blocked` | thumbnail/preview 未执行 |
| PG-08 | `environment_blocked` | 来源/候选删除保护未执行 |
| PG-09 | `environment_blocked` | MinIO 故障恢复未执行 |
| PG-10 | `environment_blocked` | storage key/URL 解耦迁移未执行 |
| PG-11 | `environment_blocked` | 数据库与对象联合恢复未执行 |

没有启动容器、网络或 volume；没有创建 bucket、对象、合成图片、`.env` 或凭据。Docker Desktop 已停止，预检端口无残留监听。
