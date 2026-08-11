# Formal Catalog Bridge result

## Decision

`FORMAL_BRIDGE = PASS`。冻结的 Rem 221 + Cheshire 6 Prototype 已通过确定性导出、Payload Local API 导入、本机 PostgreSQL 真实读回和语义 parity 验证。这个结论只覆盖持久化桥；Personal Gallery 仍读取原本的 local runtime，正式 Gallery read model 没有切换。

## Schema audit

当前正式 schema 最大的差距是缺少 `SourceRecord` 与 `CatalogItem`，同时原 `FigurePrototype` 不能无损承载 local `projectionKey`、membership fingerprint、无 canonical Manufacturer 的记录和 `static` 类型。

本轮复用了现有 `Character` 与 `FigurePrototype`，只新增两个 Collection：

- `source-records`：保存精确来源 URL、来源族、所属角色/商品和业务 digest。
- `catalog-items`：保存商品身份、可靠商品字段、Prototype membership 与嵌入式 remote `ImageRef`。

`figure-prototypes` 只增加四项重要能力：不可变且唯一的 `projectionKey`、`membershipFingerprint`、可选 Manufacturer relation，以及 `static` figure type。ImageRef 保持 embedded value object；没有建立 Media、FigureVersion、Work 或 Manufacturer 治理。旧 schema 确有 mismatch，但变化保持在 2 个新 Collection + 1 个扩展 Collection / 4 项重要扩展内，因此 `SCHEMA_GAP_BLOCKED = false`，也没有恢复旧的复杂 command/Admin 架构。

## Round trip

| Stage                | Characters | SourceRecords | CatalogItems | FigurePrototypes | ImageRefs |
| -------------------- | ---------: | ------------: | -----------: | ---------------: | --------: |
| Local export         |          2 |           348 |          290 |              227 |     1,326 |
| PostgreSQL read-back |          2 |           348 |          290 |              227 |     1,326 |

Local export 的角色分布为 Rem 284 CatalogItems / 221 Prototypes / 1,257 ImageRefs，以及 Cheshire 6 / 6 / 69。348 个 SourceRecords 分为 Good Smile 35、Solaris 292、Japan Figure 21；49 个 CatalogItems 具有跨来源记录。业务 digest 为 `d39ea1d2d74116e27f259d07a7e376d7fe7a06fd53d2769da7dd2384d18d0042`，第二次导出 drift 为 0。

Fresh import 新增 2 Characters、9 CharacterAliases、348 SourceRecords、290 CatalogItems、227 FigurePrototypes、227 Prototype-Character relations，并只写入 1 条 import summary OperationLog；错误与非预期更新均为 0。对同一数据库执行第二次 import 后，新增 0、更新 0、重复 identity 0，全部业务记录均为 unchanged。

真实 PostgreSQL read-back 的 content digest 与 local export 相同。Character、CatalogItem、Prototype `projectionKey`、membership fingerprint、membership relation、ImageRef、来源 URL 和 source-family provenance 全部 parity；duplicate IDs = 0，orphan references = 0。长期 Prototype identity 没有被数据库 UUID 替代或重建。

Image provenance 也原样保留：Good Smile 285、Solaris 1,020、Japan Figure 21、unknown 0。没有为缺少逐图对应证据的 ImageRef 伪造 SourceRecord relation，也没有修正或重新解释既有 Relax Time provenance。

## Validation and next boundary

Fresh migration、repeat migration、migration status、synthetic PostgreSQL integration 和完整 2/290/227/1,326 baseline integration 均通过。两次 integration 都使用 Payload Local API，Hpoi 请求与采集网络请求均为 0。系统 Chrome regression 保持 Rem 221 cards（220 covers）与 Cheshire 6 cards（6 covers），两角色 ID drift 均为 0，Rem recommendation order drift 为 0，控制台错误为 0。

桥接层已经证明可以进入一个**单独授权**的正式 Gallery read-model 阶段；下一步唯一建议是新增只读 parity/shadow-read 验证，再决定是否切换 Gallery 数据源。本轮没有实现或提前切换该 read model。

Formal Persistence 在这里仅负责 persist、query、retain identity、retain provenance；它不负责 discover、filter 或 group。

## Scope retained

- 未修改外部 `rem-figure-collector`，未重新采集 Rem 或 Cheshire。
- 未新增数据源，未访问 Hpoi，未增加第三角色。
- 未修改 pose eligibility、grouping 或推荐排序语义。
- 未实现热门或 Latest，未下载媒体，未使用 S3。
- 未切换正式 Gallery，未部署。
- Draft PR 未自动合并。
