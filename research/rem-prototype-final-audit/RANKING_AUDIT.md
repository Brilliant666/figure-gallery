# Rem Prototype Gallery 排序与热度审计

审计日期：2026-08-10
审计基线：PR #21 head `4bd43506733830f8fe388fc60f16b9ca155242e2`
性质：只读代码、运行时 Projection 与冻结 Collector 字段审计；本报告不实现或改变任何排序。

## 1. 证据范围

本轮核对了：

- `tools/personal-gallery-mvp/src/projection/prototype-projection.js`；
- `tools/personal-gallery-mvp/src/gallery/read-model.js`；
- `tools/personal-gallery-mvp/static/gallery.js`；
- PR #21 运行时 `.local/personal-gallery/characters/rem/prototype-projection.json`；
- 冻结 Collector 的 `figures.json`（SHA-256 `e4d15b4f6e1c7e67f9f593c4d256cbd23d69bac7aae7bccc7daf3fbb48e54267`）；
- 冻结 grouping 与 image-evidence 文件及两份 benchmark 报告。

运行时实际为 231 个 Prototype、231 个唯一 `prototypeId`，数组顺序与 `prototypeId` 升序逐项完全一致。

## 2. 当前页面的真实排序

结论：**当前唯一排序键是 `prototypeId ASC`；没有 secondary sort key。**

证据链如下：

1. `stablePrototypeId()` 先按 Catalog Item ID 排序，再对该数组的 JSON 表示计算 SHA-256，截取前 16 个十六进制字符，形成 `rem-proto-<short-sha256>`（`prototype-projection.js:108-113`）。
2. Projection builder 在生成所有 Prototype 后明确执行 `left.prototypeId.localeCompare(right.prototypeId)`（`prototype-projection.js:432-434`）。
3. Read model 对 `projection.prototypes` 只做 `map(...).filter(Boolean)`，没有重排（`read-model.js:586-589`）。
4. 浏览器端 `referenceProducts()` 与 `currentProducts()` 只过滤、搜索，不排序；`renderIndex()` 按返回数组顺序直接 `map(createProductCard)`（`gallery.js:161-189`、`gallery.js:465-470`）。筛选和搜索只会保留原相对顺序。

因此当前顺序不是：

- 标题顺序；
- 厂商顺序；
- Catalog Item 输入顺序；
- 发售或发现时间顺序；
- 推荐顺序；
- 热门顺序。

它本质上是由分组成员身份派生的**确定性哈希顺序**。同一组 Catalog Item ID 完全不变时，重跑顺序稳定；一旦 Prototype 增删成员，其 ID 会变化，该卡及相邻页面位置可能大幅漂移。它适合可重复构建，不具有用户可理解的产品语义，也不是跨增量数据稳定的排序键。

## 3. 当前字段能支持什么

### 3.1 Projection 运行时字段

当前 Prototype 直接拥有：标题、厂商、分类、Catalog Item 列表、图片列表、封面、来源 URL 与 `sourceFamily`。实际覆盖为：

| 信号 | 覆盖/分布 | 可用于什么 | 不足 |
|---|---:|---|---|
| 封面 | 230/231 | 判断卡片是否可直接浏览 | 几乎全覆盖，区分力很低 |
| 图片引用数 | 1,257；每 Prototype 0–34，中位数 3 | 资料丰富度；建议封顶后使用 | 图片多不等于角度多，也不等于姿势更好 |
| Good Smile 图片 | 31/231 Prototype | 官方来源置信度 | 覆盖不均，不能惩罚没有 Good Smile 页面但同样优质的姿势 |
| 多图片来源 family | 45/231 Prototype | 来源交叉覆盖 | 来源数量可能来自重复 listing，不是人气 |
| 多 source URL | 80/231 Prototype | 资料可核验度 | 同样不能代表摄影价值或热度 |
| 分类 | prize 146、static 47、scale 38 | 用户筛选、稳定 tie-break | 不是质量或热度信号 |

当前没有可靠字段直接表达：

- 是否为完整人体；
- 是否真的包含多个拍摄角度；
- 姿势辨识度或摄影参考价值；
- 人工精选/featured；
- 用户偏好或群体参与度。

已排除一个已知 ArtScale 胸像，只证明该已知漏网未进入 Projection，不能把其余记录自动视为“完整人体”。同理，`images.length` 只能称为图片覆盖度，不能冒充多角度证明。

### 3.2 时间字段

当前 **不能可靠提供产品语义上的 Latest 排序**：

| 原始字段 | 覆盖 | 实际情况 | 当前 Projection 是否保留 |
|---|---:|---|---|
| `release` | 32/285 Catalog Items；覆盖 31/231 Prototype | 原始字符串有 `YYYY/MM`、`Shipping YYYY/MM`、含原发售与再版的英文句子等多种格式；Solaris 251 条均无该字段 | 是，仅在嵌套 Catalog Item 中保留，未规范化 |
| `published_at` | 280/285 | 来源商品页的发布时间，2017–2026；跨 Good Smile、Solaris 的语义不是经验证一致的正式发售日 | 否 |
| `first_seen` | 285/285 | 本轮冻结数据几乎是一次性回填：251 条完全同一时间，全部记录仅横跨约 153 秒 | 否 |
| `last_seen` | 285/285 | 绝大多数也是同一次回填时间 | 否 |
| `source_updated_at` | 280/285 | 仅出现两个相邻秒值，不能区分商品新旧 | 否 |
| Projection `generatedAt` | 全局 1 个值 | 只表示整份 Projection 的生成时间，所有卡相同 | 是，但不是逐 Prototype 时间 |

`published_at` 可以描述“某来源页面何时发布”，但当前未进入 Projection，而且不能未经来源语义校准就称为手办发售时间。`first_seen` 将来可以支持“最近收录”，但这份历史一次性回填无法形成有意义的先后顺序。

要提供可信 Latest，至少需要在未来任务中明确二选一并保留规范化时间：

1. **最新发售**：建立带 provenance 的 `releaseAt`，定义原版/再版取值规则，并处理缺失值；或
2. **最近收录**：把真实增量发现时间保留到 Prototype，并明确标签是“最近收录”而不是“最新发售”。

在这些条件满足前，不建议在第一版展示可点击的“最新”排序。

## 4. 当前是否存在真实热度

结论：**`Current real popularity signals = none`。**

冻结 `figures.json`、Prototype Projection、Gallery read model 和偏好文件均没有 `views`、`clicks`、`detail_open`、`favorite`、`likes`、外部 popularity、Hpoi heat 或 sales rank。浏览器虽然会发生详情打开和灯箱打开，但当前代码不把这些事件持久化或聚合。

现有个人偏好只有排除商品、排除图片、人工封面和备注。它们是单一项目所有者的本地编辑状态，不是群体热度数据；人工封面也表示“选哪张图做封面”，不是“喜欢哪个 Prototype”。

所以：

> 当前任何现有顺序都不能命名为“热门排序”，也不得构造虚假的 `popularityScore`。

## 5. 推荐、热门与最新的产品语义

| 名称 | 第一版语义 | 当前可用性 |
|---|---|---|
| 推荐 | 按“拍摄参考资料是否便于使用”的轻量、可解释数据质量顺序 | **可用，但必须明确不是热门** |
| 热门 | 按真实用户行为聚合出的群体关注度 | **不可用；应隐藏而非伪造** |
| 最新 | 按规范化发售时间，或明确标注的真实增量收录时间 | **当前不可靠** |

### 第一版 Recommended 的最小方案

推荐默认排序为：**推荐（参考资料完整度）**。若后续实现，当前字段足以组成一个很轻的顺序：

1. 有可用封面优先；
2. 唯一图片引用数优先，但在 8 张封顶，避免图片堆量支配排序；
3. 来源置信度/多样性优先：有 Good Smile official，或有多个已知 `sourceFamily`；
4. `prototypeId ASC` 仅作确定性 tie-break。

前三项是现有客观字段，第四项不计为质量分。它们只能说明资料完整度，不能说明姿势审美、人气或销售表现。若未来增加一个显式人工 `featured` 标记，可把它置于最前，但当前不能假定该字段已经存在。

不建议把“图片数量”“多来源”拆成复杂加权总分；使用有序 tuple 即可，且应在界面或文档中把“推荐”解释为资料可用性。

## 6. 未来形成真实 Popular 的最小事件

真正的热门至少需要持久化并去重以下两个事件：

1. `detail_open`：按 Prototype、匿名会话/用户和时间窗去重，表示主动查看；
2. `favorite`：记录 add/remove 并按稳定主体去重，表示明确偏好，是比浏览更强的信号。

`lightbox_open` 可以作为可选的拍摄参考深度信号；`source_click` 更接近来源查询或购买兴趣，不应直接主导姿势热门。纯 `impression` 受默认排序位置、滚动深度和 lazy loading 强烈影响，单独价值过低；如果未来用于校正曝光偏差，必须定义“可见曝光”并只做分母，不能直接当热门加分。

若第一版尚不实现 favorite，则 `detail_open + lightbox_open` 最多支持“近期浏览趋势”，不宜宣称已经具备稳定的群体热门。

## 7. 产品决定

- 当前实际排序：`prototypeId ASC`，secondary sort：无；冻结成员不变时稳定。
- 当前真实 popularity：无；“热门”不可用、不可命名。
- 第一版默认：**推荐（参考资料完整度）**。
- Latest：当前数据不足以可靠实现；应等待规范化 `releaseAt`，或在真实增量积累后明确提供“最近收录”。
- Popular：待上线后至少积累去重的 `detail_open` 与 `favorite`；在此之前保持隐藏。
