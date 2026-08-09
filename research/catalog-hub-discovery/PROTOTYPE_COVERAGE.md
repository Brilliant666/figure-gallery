# Prototype 覆盖率与归并口径

## 为什么不能按 `products` 计进度

一个零售/厂商记录可能代表再版、套装、异色或渠道版本；同一原型也可能在 legacy/current 使用不同 ID。Figure Gallery 的覆盖单位必须分层：

```text
sourceRecords → catalog offerings / versions → release events
              → probable FigurePrototype candidates → reviewed FigurePrototype
```

本轮只生成研究级 candidate grouping，不写入正式 Payload 数据。

## Good Smile 归并结果

| 口径 | 数量 | 置信度/说明 |
|---|---:|---|
| source records | 41 | 冻结 JSON identity 唯一 |
| probable versions / catalog offerings | 41 | 证据不足以安全合并 version record，故逐条保留 |
| explicit release events | ≥46 | 5 条明确列出 original+rerelease |
| probable prototypes（全部） | 35 | 6 个高置信两条合一组 |
| in-scope records | 33 | 逐条重新分类 |
| probable in-scope prototypes | 27 | 研究归并后 |
| out-of-scope | 7 | articulated/doll/model kit 等 |
| ambiguous | 1 | PUP 品类与规格冲突 |

## 与现有 FG 的集合

```text
Existing FG = 11
Good Smile in-scope = 27
Intersection = 8
Union = 11 + 27 - 8 = 30
Marginal Good Smile = 27 - 8 = 19
```

| 对照类型 | 数量 | 例子 |
|---|---:|---|
| exact source-ID overlap | 5 prototypes | Breather、Combat Outfit、Bare Leg Bunny 2nd、Yukata、Graceful 2024 |
| probable legacy/current same product | 3 prototypes | Another World、Wedding、GSC Rem |
| extra Good Smile offerings inside covered prototype | 2 records | Bunny 2nd 普通/裸腿、Graceful 原版/2024 |
| FG-only | 3 prototypes | PUP L Size、Phantom Night Wizard、ALTER Nekomimi |

这解释了为什么 Good Smile 的“10 条 record overlap”只对应 8 个 prototype intersection。

19 是**边际 prototype candidates**，不是 19 个已经逐款验证过姿势质量的成品。媒体抽样只覆盖三个商品，其中两个属于既有交集、一个仍为 ambiguous；它只能证明 Good Smile 媒体候选密度和部分角度质量，不能替 19 个边际原型背书。

## 归并使用的信号

优先级是：JAN（本样本没有）→同厂商/同规格/同原型师→明确套装或版本语义→release 关系→人工复核。规范化标题只作候选，不作真值。

必须保留的反合并规则：

- 不同厂商或不同原型，即使姿势相似，仍是不同 FigurePrototype。
- `regular/deluxe/reissue/bonus/recolor/channel-exclusive` 可以成为 FigureVersion，但只有证据足够才归并。
- Set 与 single 需要确认同一个物理原型，不按共享角色名自动合并。
- Legacy/current 裸数字 ID 不跨命名空间比较。
- 高度、比例、maker 缺失或解析冲突时保持 `identity uncertain`。

## MyFigureList 有限样本

角色页渲染样本为 Rem 22 条、Cheshire 16 条。仅依据标题保守分类得到 25 条 in-scope record、约 23 个 probable prototype candidate；没有打开详情页，因此 manufacturer/JAN/media 均保持 `not measured`。

Rem 22 条中有 14 条 title-level in-scope、7 条明确 out、1 条 ambiguous；两个 Wedding 记录按候选合成一个，约 13 个 prototype。与 FG 蕾姆 11 条可识别 4 个交集，产生 9 个**样本内**边际候选。Cheshire 的本地七条正式对照需要完整 identity crosswalk，本轮不声称其 marginal 数。

## 未来覆盖率公式

逐条审计证据见 [`goodsmile-audit.json`](../evidence/catalog-hub-discovery/goodsmile-audit.json)。对每个获许可来源保存：

```text
sourceRecords
inScopeRecords
probableVersions
probableUniquePrototypes
reviewedUniquePrototypes
marginalReviewedPrototypes
```

来源价值用 `marginal reviewed prototypes / engineering hour` 与 `marginal reviewed prototypes / request` 评估。未经授权且不可穷举的目录不能用于宣称市场覆盖百分比。
