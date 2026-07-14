# Payload PostgreSQL 生产门禁结果

## 1. 结论

2026-07-14 的 Windows 本机验证因 Docker daemon 不稳定而在基础设施门禁处停止。PostgreSQL 容器未创建、镜像未被证明已拉取、数据库未启动，因此 migration、seed、事务/并发、导出、备份、空库恢复和恢复后合同均未执行。

PG-01—PG-05 均为 `environment_blocked`，不是 `fail`，也不是 `pass`。硬失败数为 0。既有 SQLite 结果不能替代 PostgreSQL 证据。

机器摘要：[`postgres-results.json`](evidence/payload-prod-gate/postgres-results.json)。

## 2. 版本与目标配置

| 项目 | 固定值 | 实际状态 |
| --- | --- | --- |
| 测试环境 | Windows，2026-07-14 | 已记录 |
| PostgreSQL 镜像 | `postgres:16.9-bookworm` | 仅计划配置；未证明拉取或运行 |
| Payload 数据库 adapter | `@payloadcms/db-postgres` `3.86.0` | 官方依赖已锁定；未连接真实 PostgreSQL |
| Payload | `3.86.0` | 版本锁定；本轮未在 PostgreSQL 下启动 |
| 数据库 URI | 仅允许运行时环境变量 | 未生成或保存真实凭据 |
| 端口 | 只允许 loopback | 配置默认端口 `55432` 无监听；未启动服务 |

Docker CLI 存在，Compose 为 `v2.20.2-desktop.1`。daemon 曾短暂返回 Docker Engine `24.0.5`，但在后续镜像操作阶段出现 `rpcbind terminated unexpectedly` 类故障。两次不修改设置的有限重启后，`docker info` 与 daemon ping 仍超时。任务禁止升级 Docker、修改 WSL/Hyper-V 或系统设置，因此按停止条件结束。

## 3. Migration 与 seed

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 创建空数据库 | `environment_blocked` | PostgreSQL 未启动 |
| fresh migration | `environment_blocked` | 未执行 |
| migration status | `environment_blocked` | 未执行 |
| migration repeat | `environment_blocked` | 未执行，无法判断幂等 |
| 首次合成 seed | `environment_blocked` | 未执行 |
| seed repeat | `environment_blocked` | 未执行，无法比较实体计数 |
| 现有 Payload 测试在 PostgreSQL 下运行 | `environment_blocked` | 未执行 |
| VAL-02/VAL-02B 合同在 PostgreSQL 下运行 | `environment_blocked` | 未执行 |

因此没有可报告的 PostgreSQL 表数、migration 数、seed 记录数、稳定 ID 差异或耗时。任何 SQLite migration/seed 历史结果都没有被写成 PostgreSQL 通过。

## 4. 幂等、事务与并发

以下 PostgreSQL 专属验证全部未运行：

- 稳定来源 ID 重复 upsert；
- URL fallback 迁移至稳定 ID；
- 多客户端相同 URL 与唯一约束冲突；
- 重复 multipart 上传；
- 两管理员对同一 ReviewWorkItem 的乐观锁冲突；
- merge、split、按 operation ID 指定 undo；
- 无关作用域分别撤销；
- 有依赖时拒绝撤销前置操作；
- 事务中故意抛出异常并验证完整回滚；
- OperationLog 与最终关系的一致性。

这些项目不是静态代码检查可以替代的。PG-03 作为硬门禁保持 `environment_blocked`；没有观察到硬失败，但也没有取得生产适配器保证。

## 5. 导出、备份与恢复

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| JSON 导出 | `environment_blocked` | 未从 PostgreSQL 生成 |
| 关系 CSV 导出 | `environment_blocked` | 未从 PostgreSQL 生成 |
| 官方工具数据库备份 | `environment_blocked` | 未生成备份文件 |
| 备份 SHA-256/大小/表数 | `environment_blocked` | 无文件，因此值均不存在 |
| 删除测试库并新建空库 | `environment_blocked` | 未执行 |
| 恢复 | `environment_blocked` | 未执行 |
| 恢复后启动 Payload | `environment_blocked` | 未执行 |
| 恢复后共享合同 | `environment_blocked` | 未执行 |
| 恢复前后关系差异 | `environment_blocked` | 无可比较数据 |

没有数据库、备份或导出产物写入仓库或留在临时目录。PG-04 和 PG-05 均保持 `environment_blocked`。

## 6. 恢复后权限与攻击回归

恢复后必须重新验证 candidate owner、token active/revoked、正式主图、ReviewWorkItem、optimistic version、OperationLog、merge/split/undo 依赖、SystemSetting、来源失效状态和 storage key。由于备份恢复未发生，下列攻击也未在 PostgreSQL 恢复环境执行：

- 候选客户端写 FigurePrototype/FigureVersion；
- 修改正式主图；
- 客户端 A 修改客户端 B；
- 撤销凭据继续调用；
- generic CRUD、Admin 或 Local API 绕过领域 service/OperationLog。

历史 SQLite 攻击回归只说明已有 POC 的本地边界，不证明 PostgreSQL + S3 恢复后的 PG-05/PG-14。

## 7. PG 状态

| ID | 状态 | 说明 |
| --- | --- | --- |
| PG-01 | `environment_blocked` | 无可用 PostgreSQL runtime，fresh migration 未执行 |
| PG-02 | `environment_blocked` | seed 与重复 seed 未执行 |
| PG-03 | `environment_blocked` | PostgreSQL 事务、并发和指定 undo 未执行 |
| PG-04 | `environment_blocked` | backup/空库 restore 未执行 |
| PG-05 | `environment_blocked` | 恢复后合同和权限边界未执行 |

本报告没有把任何未执行项目写成通过。尚未解决的核心风险是：PostgreSQL adapter 下的 schema/migration 可用性、唯一约束语义、事务原子性、并发冲突和恢复一致性仍未知。
