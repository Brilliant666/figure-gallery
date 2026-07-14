# Payload standalone 生产门禁结果

## 1. 结论

完整 standalone 门禁要求从干净临时环境，以 PostgreSQL + MinIO/S3、`NODE_ENV=production` 和运行时秘密完成 install、migration、seed、build、启动、攻击回归、停止与重启。2026-07-14 本机 Docker daemon 无法在禁止修改系统配置的前提下稳定恢复，因此该完整路径没有启动。

PG-12、PG-13、PG-14 均为 `environment_blocked`，硬失败数为 0。既有 SQLite + 本地媒体 standalone 历史证据不替代本轮生产 adapter 门禁。

机器摘要：[`standalone-results.json`](evidence/payload-prod-gate/standalone-results.json)。

## 2. 固定运行版本

| 组件 | 版本/约束 | 本轮状态 |
| --- | --- | --- |
| Node.js | `22.23.1` | 目标版本；未执行完整 clean install |
| npm | `10.9.8` | 目标版本；未执行完整 clean install |
| Payload CMS / Next adapter | `3.86.0` | 已锁定；未在目标基础设施启动 |
| Next.js | `16.2.10` | 已锁定；未执行本轮完整 build/start |
| React | `19.2.7` | 已锁定 |
| PostgreSQL adapter | `@payloadcms/db-postgres` `3.86.0` | 未运行 |
| S3 plugin | `@payloadcms/storage-s3` `3.86.0` | 未运行 |

## 3. 干净环境步骤

| 步骤 | 状态 | 说明 |
| --- | --- | --- |
| 创建干净临时 checkout/目录 | `environment_blocked` | 未开始完整部署流程 |
| `npm ci --no-audit --no-fund` | `environment_blocked` | 本轮 clean-start 未执行 |
| 空 PostgreSQL migration | `environment_blocked` | PostgreSQL 不可用 |
| 合成 seed | `environment_blocked` | PostgreSQL 不可用 |
| production build | `environment_blocked` | 不以脱离目标基础设施的 build 代替完整门禁 |
| standalone 必需文件装配 | `environment_blocked` | 未执行 |
| `.next/standalone/server.js` 启动 | `environment_blocked` | 未执行 |
| 只监听 loopback | `environment_blocked` | 无本轮服务进程可检查 |

没有创建临时管理员、候选客户端 Token 或 `.env`；也没有把凭据写入仓库。

## 4. HTTP、静态资源与媒体 smoke

以下 smoke 均未运行：

- health HTTP 200；
- 首页 HTTP 200；
- Payload Admin HTTP 200；
- `_next/static` 读取；
- 原图、thumbnail、preview 读取；
- 候选 upsert 与 multipart 上传；
- 未授权请求拒绝；
- 正式数据写攻击拒绝；
- generic CRUD 绕过拒绝；
- 正式主图攻击拒绝；
- 网络 guard 回归。

由于目标服务未启动，没有 HTTP 状态码、响应时间、控制台错误或网络失败数据可报告。

## 5. Restart 与数据保持

下列步骤未运行：停止 standalone、重新启动、重新执行 smoke、比较稳定 ID、数据库关系、正式主图、storage key、原图和派生图。PG-13 为 `environment_blocked`，无法判断 PostgreSQL + S3 下的重启持久性。

## 6. NFT/Sharp trace

没有在干净临时目录生成本轮 production build，因此没有新的 NFT tracing 结果，也没有验证 standalone 包是否包含 Sharp 原生运行文件、Next 静态资源和 Payload Admin 所需文件。

- `nft_warning`：`null`（未运行）
- Sharp runtime completeness：`environment_blocked`
- 干净目录启动：`environment_blocked`

历史本地 standalone 成功只证明先前 SQLite/本地媒体路径；它不证明目标 PostgreSQL + S3 包装完整，也不能把本轮 PG-12 写为通过。

## 7. 权限攻击回归

以下用例必须在 PostgreSQL + S3 的真实 standalone 进程执行，本轮全部未运行：

- 无 Token、错误 Token、已撤销 Token；
- 客户端 A 修改客户端 B；
- 候选身份写 FigurePrototype/FigureVersion；
- 候选身份修改正式主图；
- 绕过专用 endpoint 使用 generic REST/GraphQL CRUD；
- Admin 或 Local API 绕过领域 service 与 OperationLog；
- ReviewWorkItem 越界目标、乐观锁冲突和 specified undo 依赖攻击。

PG-14 是硬门禁，目前为 `environment_blocked`。没有观察到绕过成功，但也没有生产适配器下的拒绝证据。

## 8. 运行与维护复杂度

本轮没有完整运行，因此以下测量值均为 `null`：

- clean `npm ci`、migration、seed、build 耗时；
- standalone 冷启动、重启耗时；
- health、首页、Admin 热响应；
- 图片上传、首次 thumbnail、缓存 thumbnail 耗时；
- 备份与恢复耗时；
- 最小启动命令数、生产进程数和故障恢复步骤实测值。

可以确认的计划拓扑是 Payload standalone + PostgreSQL + MinIO（及一次性初始化容器），但由于没有运行，不能把计划进程数或步骤数描述为实测运维复杂度。

## 9. PG 状态与环境清理

| ID | 状态 | 说明 |
| --- | --- | --- |
| PG-12 | `environment_blocked` | 干净环境 PostgreSQL + S3 standalone 未启动 |
| PG-13 | `environment_blocked` | 未执行停止/重启和持久性 smoke |
| PG-14 | `environment_blocked` | 未在生产 adapters 下执行权限攻击回归 |

本轮没有启动 Payload、PostgreSQL、MinIO 或一次性初始化容器；没有容器、网络、volume、数据库、对象、备份、构建产物、临时 `.env` 或运行时秘密需要保留。Docker Desktop 已停止，配置默认端口 `55432`、`59000`、`59001` 均无监听。
