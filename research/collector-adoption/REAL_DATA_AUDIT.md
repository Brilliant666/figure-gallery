# 真实 Collector 数据审计

审计日期：2026-08-10（Asia/Shanghai）

数据快照生成时间：2026-08-09T12:03:45Z
对象：`rem-figure-collector` 的 `figures.json`、`README.md`、`REM-COLLECTOR-02-REPORT.md` 与当前 Collector 合并逻辑。

## 证据口径

本文把结论分成三类，避免把运行报告、当前快照和推断混为一谈：

- **快照可核验**：可从当前 `figures.json` 重新计算；聚合结果见 `research/evidence/collector-adoption/results.json`。
- **Collector 报告声明**：来自本地 `README.md` 或 `REM-COLLECTOR-02-REPORT.md`，但中间记录没有保留在 `figures.json`，本轮不能从最终快照独立重算。
- **当前不可重建**：Collector 合并时已丢失来源级粒度，不能从扁平结果倒推出准确数值。

本轮没有访问 Hpoi，也没有重新运行任何外部采集。

## Collector 为什么能快速形成宽目录

成功来自三条不同职责的路径，而不是一个通用角色搜索器：

1. **Solaris 广目录基线**：读取全局 `products.json`，再按 Rem、作品与静态手办规则过滤。这是 280/285 最终成员和 Prize 主体能够快速出现的主要原因。
2. **Good Smile 富化**：current 侧从 4 个固定 seed、首页与 recommendation 链做有限遍历；legacy 侧使用 `Rem Re:ZERO` 文本搜索和分页商品页。它在数量上只为 Solaris 集合增加 3 条，但官方页多图更丰富。current 路径仍依赖 seed/recommendation，可达性不能泛化为“输入任意角色名即可完整发现”。
3. **Japan Figure UCP 补缺**：查询得到 raw 26，经 figure-like、姿势资格和同站去重后保留 19，其中 17 已被 Solaris 覆盖、2 条为真实边际新增。

Collector 的关键优势是允许各来源使用最短、最适合自己的发现和解析方式，再用宽松规则生成目录候选；它没有先等待统一数据库、后台或正式领域命令。代价是最终 `merge_records` 扁平化了跨源 provenance，且 excluded ledger 未持久化。

## 已排除类型与视觉漏网口径

Collector 报告把 45 条排除拆为 Nendoroid 7、action/figma 6、doll 6、plastic model 2、deformed/Q 20、bust 4；其中 Figuarts mini 计入 action 桶，所以核心 Q/SD/deformed 口径为 20 + 7 + 1 = 28。这些逐条排除记录未进入最终快照，因此本轮只能复核桶合计，不能重新审判每条排除。

系统 Chrome 的固定 129 卡样本用于检查 retained 集合的漏网，而不是替代全量资格审计。其结果和示例记录在 [`POSE_DUPLICATION_SAMPLE.md`](POSE_DUPLICATION_SAMPLE.md)：没有看到毛绒、文件夹、doll、action 或 Q/SD 条目；至少一张 ArtScale 半身像明显低于完整真人姿势参考价值，证明“285 retained”不能等同“285 全部高价值”。

## 330 → 285 → 45 漏斗

| 指标 | 数量 | 证据状态 | 说明 |
| --- | ---: | --- | --- |
| 宽目录 | 330 | Collector 报告声明 | 最终快照不含被排除记录，无法只用 `figures.json` 重算 330。 |
| Collector 规则保留/标为姿势参考可用 | 285 | 数量可由快照核验，资格继承 Collector 规则与报告 | `count=285`、实际数组 285、唯一记录 ID 285，三者一致；没有逐条人工复核全部资格。 |
| 排除 | 45 | Collector 报告声明 | 330 − 285 = 45，算术一致；被排除记录和逐条理由未随最终快照保存。 |
| Q / SD / deformed 核心排除 | 28 | Collector 报告声明 | 报告进一步拆为命名 Q/变形系列 20、Nendoroid 7、Figuarts mini 1。 |
| 有主图 | 284 / 285 | 快照可核验 | 1 条没有 `image_url`，同时也没有候选图片 URL。 |

因此，“当前有 285 条可供后续审查的姿势条目”是强事实；“本轮从 330 条中按规则排除 45 条”是有本地报告支持、但无法由保留集独立复算的运行声明。285 也仍是 **CatalogItem 级条目数**，不是独立姿势或 `FigurePrototype` 数量。

## 产品类型

为避免重复计数，审计先以 Prize 优先，再检查比例证据与 POP UP PARADE；`limited/exclusive` 作为发行或渠道修饰符单独计数。

| 类型/标志 | 数量 | 口径 |
| --- | ---: | --- |
| Prize | 186 | 互斥主桶；与 Collector 报告的“正常头身 Prize 186”一致。 |
| Scale 主桶 | 81 | 结构化 `scale`、标题中的 `1/n` 或明确比例类别提供证据；这是研究启发式，不是正式类型真值。 |
| POP UP PARADE | 3 | 互斥主桶。 |
| 其余 Collector 保留、未充分分类 | 14 | 类别为 `General` 13 条、`Limited Editions` 1 条；当前字段不足以严格区分 static non-scale 与其他静态成品。 |
| 明确 `Non-Scale Figure` 类别 | 1 | 单独的互斥 static non-scale 主桶。 |
| Limited / exclusive | 48 | 重叠修饰标志，不与上方类型相加。 |

互斥合计为 186 + 81 + 3 + 1 + 14 = 285。现有扁平字段不支持把最后 14 条继续可靠细分。后续模型应把“产品类型”和“限量/渠道/版本”分开，并保留原始类别证据，避免用字符串包含关系决定正式类型。

## 厂商分布

原始厂商字符串有 42 种；只做大小写与少量已知别名合并后有 35 种。Top 结果如下：

| 规范化厂商 | 条目数 | 占 285 |
| --- | ---: | ---: |
| Taito | 70 | 24.6% |
| FuRyu | 61 | 21.4% |
| Bandai Spirits / Banpresto | 44 | 15.4% |
| SEGA | 38 | 13.3% |
| KADOKAWA | 21 | 7.4% |
| Good Smile family | 5 | 1.8% |
| FREEing | 5 | 1.8% |
| elCOCO | 4 | 1.4% |
| Phat! | 3 | 1.1% |
| eStream | 3 | 1.1% |

前五个规范化厂商合计 234 条（82.1%）。这证明单角色图库也会迅速遇到厂商别名问题，但目前使用轻量规范化映射即可；35 个规范化名称不构成立刻建立完整 Manufacturer 管理系统的充分理由。

## 来源贡献、重叠与边际新增

### 最终 285 条集合中的来源成员关系

来源成员数会重叠，不能相加：

| 来源 | 最终集合成员 | 仅该来源 | 与其他来源重叠 | 相对 Solaris 集合的边际条目 |
| --- | ---: | ---: | ---: | ---: |
| Solaris Japan | 280 | 235 | 45 | 基线 |
| Good Smile current + legacy | 32 | 3 | 29 | 3 |
| Japan Figure | 19 | 2 | 17 | 2 |

集合关系可完全解释 285 条：Solaris 成员 280，加上不在 Solaris 中的 Good Smile 3 条和 Japan Figure 2 条。45 条记录拥有两个或三个来源，240 条只有一个来源。

来源组合：

| 来源组合 | 条目数 |
| --- | ---: |
| Solaris only | 235 |
| Good Smile legacy + Solaris | 25 |
| Japan Figure + Solaris | 16 |
| Good Smile current + Solaris | 3 |
| Good Smile legacy only | 2 |
| Japan Figure only | 2 |
| Good Smile current + Japan Figure + Solaris | 1 |
| Good Smile current only | 1 |

### 原始记录与边际报告

- **Solaris**：本地报告称其为宽目录基线；当前最终集合有 280 条 Solaris 成员。由于宽目录和排除记录未保留为来源级 ledger，无法严格证明“330 全部等于 Solaris raw records”，也无法复算其 raw → eligible 漏斗。
- **Good Smile current / legacy**：当前最终集合可核验为 32 条、其中 3 条不在 Solaris 集合。当前 `figures.json` 不保存 Good Smile 抓取的全部 raw records 与淘汰记录，因此 raw 数不能从最终快照重建。
- **Japan Figure UCP**：Collector 报告声明 raw 26、figure-like 25、姿势可用 20，站内同款合并后覆盖 19；其中 17 与既有基线重叠，2 条真实新增。最终快照的 19 个成员、17 个重叠、2 个仅 Japan Figure 与报告一致。
- **HLJ**：报告声明 raw 12、人工候选 6、姿势可用 6，6/6 均被 Solaris 覆盖，因此没有接入；最终快照确实没有 HLJ 来源成员。它是被评估但未采用的来源，不应计入当前三来源供应链。

边际库存结论很清楚：Solaris 提供几乎全部广度；Good Smile 的主要价值更可能是官方元数据与图片增强，而不是条目数量；Japan Figure 在本轮只增加 2 条，但为这 2 条提供了可核验的真实边际覆盖。由于来源字段已扁平，后两者的“增强了多少字段/图片”不能准确量化。

## 图片覆盖

| 阈值 | 条目数 | 占 285 |
| --- | ---: | ---: |
| 有主图 | 284 | 99.6% |
| 至少 1 个候选图片 URL | 284 | 99.6% |
| 至少 2 个 | 171 | 60.0% |
| 至少 4 个 | 111 | 38.9% |
| 至少 8 个 | 69 | 24.2% |

共 1,258 个图片 URL 引用，字符串层面 1,258 个唯一值。Host 分布为：

- `cdn.shopify.com`：1,001（79.6%）；
- `images.goodsmile.info`：206（16.4%）；
- `www.goodsmile.com`：51（4.1%）。

这些是 URL 去重，不是内容哈希去重；相同图片的不同 URL 仍可能重复。当前快照也只引用远端 URL，不证明长期可保存性、展示授权或源站失效后的可用性。

按“记录拥有某来源成员关系”统计的图片覆盖如下。它反映该组 **合并后记录的图片丰富度**，不等于该来源自身贡献：

| 来源成员组 | 条目 | 主图 | URL 引用 | ≥2 图 | ≥4 图 | ≥8 图 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Solaris | 280 | 279 | 1,223 | 168 | 108 | 66 |
| Good Smile current/legacy | 32 | 32 | 453 | 32 | 32 | 31 |
| Japan Figure | 19 | 19 | 70 | 17 | 4 | 3 |

三行严重重叠，绝不能相加。按当前已知 host/Shopify store prefix 可以聚合识别 Good Smile 257 个 URL（32 条记录）、Solaris 981 个 URL（279 条记录）和 Japan Figure 20 个 URL（19 条记录），三者恰好覆盖 1,258 个 URL 引用。但合并结果没有保存逐图 `sourceRecordId`；store-prefix 推断不能替代一条正式来源关系，也不能恢复字段 provenance。

## 元数据完整度

| 字段 | 有值 | 完整率 | 解释 |
| --- | ---: | ---: | --- |
| `title` | 285 | 100% | 可作为展示与匹配输入，不应单独作为稳定身份。 |
| `manufacturer` | 285 | 100% | 仍有 42 个原始字符串、35 个轻量规范名。 |
| `category` | 284 | 99.6% | 来源类别混杂，不能直接当正式类型枚举。 |
| `source_product_id` | 282 | 98.9% | 当前为扁平通用字段，来源命名空间不总是清晰。 |
| `published_at` | 280 | 98.2% | 主要随 Solaris 数据出现，不等同于统一发售日期。 |
| `source_price` | 163 | 57.2% | 来源价格字符串，不适合作为首版核心字段。 |
| `scale` | 41 | 14.4% | 结构化比例很稀疏；标题能补充部分证据，但不是无损结构化值。 |
| `height_mm` | 32 | 11.2% | 稀疏。 |
| `release` | 32 | 11.2% | 稀疏且来源语义需统一。 |
| `price_jpy` | 32 | 11.2% | 稀疏。 |
| `sculptor` | 28 | 9.8% | 稀疏。 |
| `source_sku` | 19 | 6.7% | 基本对应 Japan Figure 成员，不是全局商品身份。 |

当前数据已经足够支持角色、商品卡、厂商筛选、粗类型筛选和图片浏览，但不足以让比例、版本、发售、价格、原型师成为强制正式字段。稀疏字段应保持 nullable，来源原值必须与规范值并存。

## 扁平 provenance 风险

当前合并结果把多个来源写入同一条 catalog-like 记录：`sources` 和 `source_urls` 保留来源列表，但若干标量字段和所有图片 URL 被扁平合并。可核验的风险信号包括：

- 最终 `source` 标签以 Good Smile 开头的 32 条中，29 条同时带有通常来自 Solaris 的 `source_price`、`published_at` 或 `source_updated_at`；
- 同一组 32 条中，1 条带 Japan Figure 风格的 `source_sku`；
- 其中 29 条带通用 `source_product_id`，但字段本身不能稳定表达“ID 属于哪个来源”；
- `image_urls` 合并后只剩 URL，不能逐图追溯到具体来源记录；
- 已知 Shopify store prefix 可做本次聚合归属，但记录没有保存正式的逐图来源关系；URL 规则不能替代 provenance。

这不会否定 Collector 的发现价值，却意味着 `figures.json` 不能直接充当正式、可审计的来源事实库。最早需要补上的抽象不是更多正式后台流程，而是保留一对多来源证据的 `SourceRecord`：来源命名空间、来源 ID、来源 URL、原始字段/摘要、首次与最后观察时间、图片引用及其来源关系。其上再生成可重算的 `CatalogItem`，才不会继续丢失来源信息。

## 审计结论

1. 285 条、285 个唯一 ID、284 条有图是当前快照可重算的强事实。
2. 330 宽目录、45 排除、28 个核心 Q/SD/deformed 排除有本地运行报告支持，但最终保留集无法独立复算这些漏斗步骤。
3. Solaris 是覆盖主干：280/285；Good Smile 和 Japan Figure 合计只带来 5 条不在 Solaris 的条目，但对元数据、官方图片和交叉核验仍有价值。
4. Japan Figure 的 19 命中、17 重叠、2 边际新增在报告与最终集合中相互印证；HLJ 的 0 边际价值只有报告证据，最终数据仅能证明其未接入。
5. 图片覆盖足够做第一版图库，但多图覆盖不均，且远端 URL、内容重复、授权与持久性问题均未解决。
6. 类型、比例、版本、发售与价格仍有明显语义或完整度缺口；不要为了导入而把 nullable 事实猜成确定值。
7. 最大的近期数据架构风险是多来源扁平合并造成的 provenance 丢失。下一步应先固化 `SourceRecord → CatalogItem` 可追溯边界，再进行 `CatalogItem → FigurePrototype` 分组，不应直接把 285 条写入正式 Payload Collection。
