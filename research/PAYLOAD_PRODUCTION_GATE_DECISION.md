# Payload 生产门禁判定

## 判定日期

2026-07-14（Asia/Shanghai）

## 判定范围

本轮只判断 Payload CMS + Next.js 是否已经满足正式项目初始化前的 PostgreSQL、S3、备份恢复与 standalone 生产门禁。项目所有者已将 Payload 定为当前首选方向，Wagtail 保留为备用方案；该方向性偏好不能替代生产门禁证据，也不构成最终正式技术选型。

## 环境结果

- Docker CLI 与 Docker Compose 可调用，但 Docker daemon 不可用；
- 在不安装、升级或永久修改 Docker、WSL、Hyper-V、Windows 功能、注册表或系统服务的限制内，已对现有 Docker Desktop 进行两次有限重启；
- 两次重启后仍出现 `rpcbind` 崩溃及 Docker CLI 超时，daemon 未恢复到可执行容器测试的状态；
- 因此无法启动本地 PostgreSQL 与 MinIO，也无法执行依赖这两项基础设施的迁移、事务、备份恢复、S3 生命周期、联合恢复和完整 standalone 验证；
- 未使用 SQLite、本地文件存储、既有 build 或既有 standalone smoke 冒充生产门禁通过。

机器证据见 [`environment-summary.json`](evidence/payload-prod-gate/environment-summary.json)；14 项统一判定见 [`production-gates.json`](evidence/payload-prod-gate/production-gates.json)。

离线补充回归见 [`regression-results.json`](evidence/payload-prod-gate/regression-results.json)：Payload 两份验收结果已由真实 44/44 runner 刷新，源码摘要均与当前 Payload 文件一致。双端 pair validator 当前没有通过，因为合并后 `main` 中两份历史 Wagtail 结果的源码摘要已经过期；本任务禁止继续验证或修改 Wagtail，因此没有为追求 pair 通过而重跑 Wagtail。该限制不被写成 Payload 生产门禁通过或失败。

## PG-01—PG-14 状态

| 门禁 | 状态 | 判定依据 |
| --- | --- | --- |
| PG-01 PostgreSQL fresh migration | `environment_blocked` | PostgreSQL 未能启动，未执行 |
| PG-02 PostgreSQL 重复 seed 幂等 | `environment_blocked` | PostgreSQL 未能启动，未执行 |
| PG-03 PostgreSQL 并发、事务和指定 undo | `environment_blocked` | PostgreSQL 未能启动，未执行 |
| PG-04 数据库备份和空库恢复一致性 | `environment_blocked` | PostgreSQL 及备份恢复环境不可用，未执行 |
| PG-05 恢复后权限、主图保护和审计边界 | `environment_blocked` | 数据库恢复未执行，无法验证恢复后边界 |
| PG-06 S3 原图上传和读取 | `environment_blocked` | MinIO/S3 未能启动，未执行 |
| PG-07 thumbnail/preview 生成和读取 | `environment_blocked` | MinIO/S3 未能启动，未执行 |
| PG-08 来源或候选删除后保留正式主图 | `environment_blocked` | MinIO/S3 生命周期测试未执行 |
| PG-09 MinIO 故障时失败可控 | `environment_blocked` | MinIO 未能启动，未执行 |
| PG-10 storage key 与公开 URL 解耦 | `environment_blocked` | 真实 S3 适配器与对象迁移测试未执行 |
| PG-11 数据库与对象存储联合恢复 | `environment_blocked` | PostgreSQL 与 MinIO 均不可用，未执行 |
| PG-12 standalone 从干净环境启动 | `environment_blocked` | 无法装配 PostgreSQL + S3 的目标生产形态 |
| PG-13 standalone 重启后数据和媒体有效 | `environment_blocked` | PG-12 未执行，无法验证重启持久性 |
| PG-14 生产适配器下领域 service 不可绕过 | `environment_blocked` | 无法在 PostgreSQL + S3 standalone 中重跑攻击回归 |

汇总：**0 pass / 0 fail / 14 environment_blocked**。硬门禁失败数为 **0**，但这只表示没有执行出失败，不表示任何生产门禁已经通过。

## ADR 判定

当前**不允许**把 ADR 更新为 `Accepted — Payload CMS + Next.js`。

ADR 应记录为 **`Proposed — Payload CMS + Next.js`**：Payload 是项目所有者基于后台体验、业务适配和既有 VAL-02/VAL-02B 证据确定的当前首选方向；由于 PG-01—PG-14 全部受基础设施阻塞，它尚未完成正式接受，也尚未成为最终正式技术栈。

Wagtail 不再获得与 Payload 平行的同等验证投入，但没有因本轮结果被淘汰，继续作为 Payload 出现硬失败时的备用方案。

## 剩余风险

- 现有 SQLite migration 结果不能证明 PostgreSQL fresh migration、约束、事务和回滚行为正确；
- PostgreSQL 下真实并发审核、候选幂等、merge/split/指定 undo 与失败回滚均未执行；
- 数据库备份、空库恢复以及恢复后的关系、主图、权限、ReviewWorkItem、OperationLog 和设置一致性未知；
- 官方 S3 plugin 与 MinIO 下的实际对象键、内容去重、派生图、来源/候选删除保护和故障恢复未知；
- 数据库与对象存储缺少可复现的联合备份、恢复顺序与一致性窗口证据；
- PostgreSQL + S3 的 `.next/standalone` 尚未从干净环境启动、重启和完成权限攻击回归；
- 既有 SQLite、浏览器、文件导入与本地 standalone 证据仍然有效，但不能外推为生产适配器已通过。

## 下一次生产门禁必须完成的事项

1. 在无需安装或永久修改系统的可用 Docker/Compose 环境，或等价的 loopback 本地 PostgreSQL + MinIO 环境中重新开始；
2. 使用 Payload 官方 PostgreSQL adapter 与官方 S3 storage plugin，逐项实际执行 PG-01—PG-14；
3. 为每项生成可复现、脱敏且机器可读的结果，不得把未执行项目写为 `pass`；
4. 完成 PostgreSQL fresh migration、重复 seed、真实并发、事务回滚、备份、空库恢复和恢复后合同；
5. 完成 S3 原图/派生图、对象生命周期、故障恢复、storage key/URL 解耦、manifest 和联合恢复；
6. 在干净目录使用 PostgreSQL + S3 完成 standalone 启动、重启、静态/媒体/Admin、候选 API 与攻击回归；
7. 只有 PG-01—PG-14 全部真实 `pass`、无硬失败且无关键 `environment_blocked`，才允许提议把 ADR 改为 `Accepted — Payload CMS + Next.js`；
8. 若 Payload 出现硬门禁失败，应停止正式接受并重新评估修复、Wagtail 备用方案或其他经授权方向。

## 正式项目初始化前的约束

- 本判定不授权初始化正式项目；
- 不得把 `spikes/val02_payload/` 复制、移动、重命名或直接迁移为正式应用；
- 即使未来生产门禁全部通过，正式项目也必须由后续独立授权任务从官方脚手架干净初始化；
- 正式项目必须继续遵守候选/正式数据隔离、领域 service、原子事务、OperationLog、主图人工选择、稳定 storage key、可恢复备份和无硬编码凭据等 ADR 架构约束；
- 本轮未最终正式选择技术栈，未初始化正式项目，未部署云服务器，也未启动 VAL-03 或原画图库。
