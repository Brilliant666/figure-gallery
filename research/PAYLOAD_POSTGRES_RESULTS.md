# Payload PostgreSQL 生产门禁结果

## 结论

在 GitHub-hosted `ubuntu-24.04` runner 的临时、loopback-only PostgreSQL 16.9 环境中，PG-01—PG-05 全部 `pass`。验证使用 Payload `3.86.0` 与 `@payloadcms/db-postgres` `3.86.0`，运行与制品绑定提交 `d204767803b9c629ab262bc5ad5ccfc89751162e`、run `29354756205`、attempt 1。

## 环境

- PostgreSQL：`postgres:16.9-bookworm`；
- Digest：`postgres@sha256:253815cf7579ffa05e1673d92e78d37273e61be0e4414e9a1449337d7925be94`；
- Image ID：`sha256:00d06ace1e0b51d5ef8170bbc38557092c83253c9f21ad68a85a49d46c825ce0`；
- Docker client/server `28.0.4`，Compose `2.38.2`；
- PostgreSQL 仅绑定 `127.0.0.1:55432`，health 为 healthy，非 loopback 探测被拒绝；
- 数据均为合成 fixture，无生产数据库或真实用户数据。

## PG-01：fresh 与 repeat migration

状态：`pass`。

- Migration engine 为 `payload.db.migrate`；
- 空库起点没有 migration 表；首次运行创建 batch 1 并应用唯一 migration `20260714_120916_payload_prod_gate_initial_schema`；
- 重复运行前后 migration 记录一致，新增 migration 为 0；
- 首次、重复和恢复后的 schema 签名一致：38 张表、9 项必需表、13 项必需列、5 项外键、3 项唯一索引、6 项 enum；
- 显式检查 owner、正式主图、prototype/version、source/prototype、软删除/状态、ReviewWorkItem lock version 和 OperationLog operation ID 等关键结构。

证据：[`migration-fresh.json`](evidence/payload-prod-gate-ci/migration-fresh.json)、[`migration-repeat.json`](evidence/payload-prod-gate-ci/migration-repeat.json)、[`schema-first.json`](evidence/payload-prod-gate-ci/schema-first.json)、[`schema-repeat.json`](evidence/payload-prod-gate-ci/schema-repeat.json)、[`schema-restored.json`](evidence/payload-prod-gate-ci/schema-restored.json)。

## PG-02：重复 seed 幂等

状态：`pass`。

- 两轮 seed 的十个业务 collection 计数完全一致，`difference_count=0`；
- 两轮数据 digest 均为 `2f958df3414c9dbf88a1c3cb43891ff56c985204e40f0fec8a627b1558ccbe7e`；
- SystemSetting 两轮均为 1 且 digest 一致；
- 既有正式主图保持不变；
- Seed 基线：Work 2、Character 4、Manufacturer 3、FigurePrototype 5、FigureVersion 8、SourceRecord 9、CandidateRecord 4、Media 11、ReviewWorkItem 0、OperationLog 1。

证据：[`migration-seed.json`](evidence/payload-prod-gate-ci/migration-seed.json)。

## PG-03：真实 PostgreSQL 并发与事务

状态：`pass`。

- PostgreSQL integration 30/30；
- PostgreSQL concurrency/rollback suite 8/8；
- 聚合事务门禁 15/15，失败 0；
- 覆盖稳定来源幂等、URL fallback 升级、跨客户端隔离、SQLSTATE 23505 全回滚、媒体去重、ReviewWorkItem 双管理员冲突、merge、split、指定 operation ID undo、独立作用域 undo、依赖阻止前置 undo、undo 后锁版本单调、重叠正式维护阻止 undo、正式原型乐观锁冲突和注入失败全回滚；
- `no_partial_commit`、`no_broken_relationships`、`no_duplicate_sources`、`no_orphaned_media`、`operation_log_consistent` 等九项不变量全部为 true。

证据：[`regressions.json`](evidence/payload-prod-gate-ci/regressions.json)、[`transaction-concurrency.json`](evidence/payload-prod-gate-ci/transaction-concurrency.json)。

## PG-04：备份、空库恢复与一致性

状态：`pass`。

- `pg_dump` 与 `pg_restore` 均 pass，格式为 PostgreSQL custom；
- 临时备份大小 259,525 bytes，SHA-256 为 `7e55b7b5227887ab19b645bd0ebc1fc94a9bde4aa1198c3946dde0d68e51ed96`；
- 原数据库实际删除，并创建空数据库后恢复；
- 恢复前后十个业务 collection 计数一致，业务记录合计 262，`difference_count=0`；
- 数据 digest 前后均为 `ce2152776ff43c1bd64181fc889413b61bac3ea29279c6ef901391c00c5f598f`；
- 关系 digest 前后均为 `942faae254971e2d9ace32e90d135b896a52993d53bdfdbc1a5ca7b085f7ac23`；
- 67 个对象的数据库关系审计无 missing/orphaned；
- 联合流程耗时 5,160 ms；备份随后删除。

恢复后 collection 计数为：CandidateRecord 18、Character 6、FigurePrototype 52、FigureVersion 9、Manufacturer 5、Media 34、OperationLog 99、ReviewWorkItem 12、SourceRecord 23、Work 4。

证据：[`backup-restore.json`](evidence/payload-prod-gate-ci/backup-restore.json)、[`restored-joint-smoke.json`](evidence/payload-prod-gate-ci/restored-joint-smoke.json)。

## PG-05：恢复后的权限和审计边界

状态：`pass`。

- 恢复后 shared contract 78/78；
- 恢复后 12/12 攻击执行均被拒绝，且正式状态、正式主图和 OperationLog 保持不变；
- 覆盖无/错/撤销 Token、跨 client owner、写 FigurePrototype/FigureVersion、替换主图、generic REST CRUD、Local API、Admin generic save、越界 ReviewWorkItem target 和完成后工作项修改；
- 恢复后 loopback 联合服务的 health、首页、Admin、候选审核、唯一搜索、同名消歧、成人图、原图、thumbnail、preview 十个入口均为 200；
- 审核锁版本推进并生成一条预期审计；来源失效状态、成人设置和正式主图关系保持；
- 派生图缺失可重建，原图缺失拒绝虚假重建，对象最终审计 67/67。

证据：[`restore-regressions.json`](evidence/payload-prod-gate-ci/restore-regressions.json)、[`restored-joint-smoke.json`](evidence/payload-prod-gate-ci/restored-joint-smoke.json)。

## 准确性边界

- `backup_restore_ms=5160` 包含 dump、对象清理、数据库 drop/create 和恢复整体，不是纯 `pg_restore` 时间；
- `record_count=262` 是上述十个业务 collection 的合计，不是 38 张物理表的全部行数；
- 恢复后明确执行 78 项共享合同、12 项权限攻击和联合 smoke；恢复前的 30 项 mutation-heavy PostgreSQL integration 没有在恢复后整套重跑；
- 数据规模是小型合成样本，不能外推生产容量、吞吐、长事务或高并发性能；
- 验证的是固定 PostgreSQL/Payload adapter 版本和单个 GitHub-hosted runner；依赖、migration 或 runner 镜像变化后必须重跑；
- 没有使用生产数据库、云数据库、真实凭据或外网数据库。
