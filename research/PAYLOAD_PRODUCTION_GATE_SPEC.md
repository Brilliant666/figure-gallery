# Payload 生产门禁规范

## 1. 状态与范围

- 规范版本：`payload-production-gate-v1`
- 验证日期：2026-07-14
- 目标：只验证 Payload CMS + Next.js 可丢弃原型在 PostgreSQL、S3 兼容对象存储、备份恢复和 standalone 生产形态下是否满足正式项目初始化前的硬门禁。
- 本轮不增加业务功能，不继续比较 Wagtail，不建立正式项目，不部署云资源。
- SQLite、本地文件存储和既有本地 standalone 结果只能作为回归背景，不能替代本规范要求的 PostgreSQL + S3 真实执行证据。

## 2. 环境前提

生产门禁只有在以下条件同时成立时才可执行：

1. Docker daemon 和 Docker Compose 可稳定响应，不只是短暂返回版本信息；
2. 可使用固定版本的官方 PostgreSQL 与 MinIO/MinIO Client 镜像；
3. PostgreSQL、MinIO API 和 MinIO Console 只绑定 loopback；
4. 所有数据库、bucket、prefix、管理员和候选客户端凭据均在运行时随机生成；
5. Payload 使用 Node.js `22.23.1`、npm `10.9.8`、Payload/Next adapter `3.86.0`、Next.js `16.2.10` 和 React `19.2.7`；
6. PostgreSQL 采用官方 `@payloadcms/db-postgres` `3.86.0`，S3 采用官方 `@payloadcms/storage-s3` `3.86.0`；
7. 只使用运行时生成的小型合成 PNG/JPEG，禁止真实手办图片和外部数据源访问；
8. 临时数据库、备份、对象、构建目录、`.env` 和秘密不得提交；测试结束后必须清理容器、网络、volume、进程和临时文件。

计划使用的固定镜像为：

| 用途 | 固定镜像 | 本轮允许的证据含义 |
| --- | --- | --- |
| PostgreSQL | `postgres:16.9-bookworm` | 只有成功启动并通过健康检查后才能写为已运行 |
| MinIO | `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` | 只有成功启动并完成读写后才能写为已运行 |
| MinIO Client | `quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z` | 只有初始化命令真实成功后才能写为已运行 |

镜像配置存在不代表镜像已拉取、容器已创建或服务已验证。

## 3. PG-01—PG-14

| ID | 通过条件 | 必需的真实证据 | 硬失败项 |
| --- | --- | --- | --- |
| PG-01 | 空 PostgreSQL 数据库完成全部 migration，重复 migration 幂等 | migration 状态、重复执行结果、表/迁移计数 | 否 |
| PG-02 | 合成 seed 首次与重复执行均成功且不产生重复实体 | 两次 seed 计数差异和稳定 ID 对照 | 否 |
| PG-03 | PostgreSQL 下并发、事务回滚、merge/split/指定 undo 不破坏关系 | 两管理员冲突、异常回滚、作用域与依赖测试摘要 | 是 |
| PG-04 | 数据库备份可恢复到空库且业务数据一致 | 备份哈希/大小、恢复前后记录与关系差异 | 是 |
| PG-05 | 恢复后候选权限、主图保护和审计边界仍成立 | 恢复后的共享合同与攻击回归 | 是 |
| PG-06 | S3 原图上传、按 storage key 读取且哈希一致 | 对象清单、尺寸/格式/SHA-256/aHash 对照 | 否 |
| PG-07 | thumbnail/preview 生成并可从对象存储读取 | 派生图 storage key、尺寸与读取结果 | 否 |
| PG-08 | 删除来源或候选不会删除已提升为正式主图的对象 | 删除前后媒体关系和对象存在性 | 是 |
| PG-09 | MinIO 中断时明确失败、不假成功、不留残缺正式记录，恢复后可重试 | 故障/恢复请求和数据库/对象差异摘要 | 否 |
| PG-10 | storage key 与公开 URL 解耦，endpoint/prefix 迁移后引用仍有效 | 迁移映射、哈希和旧 URL 无依赖检查 | 否 |
| PG-11 | PostgreSQL 与对象存储联合恢复后关系、媒体和权限一致 | 联合快照标识、恢复后合同、孤儿/缺失审计 | 是 |
| PG-12 | 从干净临时环境完成安装、migration、seed、build 和 standalone 启动 | clean-start 命令摘要与 health/root/Admin/static/media smoke | 是 |
| PG-13 | standalone 停止、重启后数据与媒体仍有效 | restart smoke 与重启前后稳定 ID/storage key 对照 | 否 |
| PG-14 | PostgreSQL + S3 下候选身份、generic CRUD、Admin/Local API 均不能绕过领域 service | 全部攻击用例的拒绝状态和 OperationLog/数据不变断言 | 是 |

## 4. 状态与判定规则

每个 PG 状态只能是：

- `pass`：该项要求已在本轮目标适配器和真实临时基础设施上完整执行，证据可复核；
- `fail`：已执行且违反通过条件；
- `environment_blocked`：前置基础设施不可用，未执行；必须写明 blocker，不能折算为通过或失败。

以下规则 fail closed：

1. PG-03、PG-04、PG-05、PG-08、PG-11、PG-12 或 PG-14 任一 `fail`，Payload 不得被正式接受；
2. 任一门禁未真实执行，不得引用 SQLite、本地媒体、静态代码检查或历史 standalone 结果补写 `pass`；
3. Docker CLI/Compose 可用不等于 daemon 可用，镜像配置存在不等于镜像已拉取或运行；
4. 环境阻塞不计作硬失败，但仍阻止 ADR 进入 `Accepted`。

## 5. 证据格式

机器证据保存在 `research/evidence/payload-prod-gate/`，只保存小型、脱敏 JSON。至少包含：

```json
{
  "schema_version": 1,
  "test_date": "2026-07-14",
  "environment": {},
  "commands": [],
  "gates": [
    {
      "id": "PG-01",
      "status": "environment_blocked",
      "blocker": "...",
      "evidence": []
    }
  ],
  "summary": {
    "pass": 0,
    "fail": 0,
    "environment_blocked": 14,
    "hard_failures": 0
  }
}
```

约束：

- 不保存明文 Token、密码、access key、secret、`.env`、完整日志或请求头；
- 不保存数据库、备份、对象或合成图片；
- 命令只记录退出/超时状态和必要的短错误分类，不保存完整 daemon 日志；
- 未执行指标使用 `null`，不得伪造耗时、记录数、哈希或成功结果；
- 每个结果报告必须链接到对应机器摘要，且 Markdown 与 JSON 状态一致。

## 6. ADR 更新规则

- 只有 PG-01—PG-14 全部 `pass`、无关键环境阻塞、无硬失败，且 PostgreSQL 恢复、正式主图生命周期、standalone 重启以及权限/审计边界均有真实证据时，ADR 才能更新为 `Accepted — Payload CMS + Next.js`。
- 没有硬失败但仍有基础设施 `environment_blocked` 时，ADR 只能是 `Proposed — Payload CMS + Next.js`；这表示当前首选方向，不表示已通过生产门禁。
- 发生硬失败时，ADR 必须保持或回到 `Undecided`，并在独立任务中修复或重新评估；本轮不得重新开发 Wagtail。
- 无论 ADR 状态如何，本轮都不授权直接初始化正式项目或把 spike 迁移为正式代码。

## 7. 本次执行判定

本机 Docker daemon 在镜像操作前后失去稳定响应，且在不修改 Docker/WSL/Hyper-V/系统设置的约束内无法恢复。依据本规范的停止条件，PG-01—PG-14 全部记为 `environment_blocked`；硬失败数为 0。具体环境与分项证据见：

- [`environment-summary.json`](evidence/payload-prod-gate/environment-summary.json)
- [`production-gates.json`](evidence/payload-prod-gate/production-gates.json)
