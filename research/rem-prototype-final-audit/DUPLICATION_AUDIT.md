# Rem Prototype 最终 false-split 审计

审计日期：2026-08-10
审计基线：PR #21 head `4bd43506733830f8fe388fc60f16b9ca155242e2`
性质：只读审计；下述归并均为 proposal，未应用到当前 Projection 或 Gallery。

## 1. 冻结基线

实际文件、运行时 API 和浏览器页面三者一致：

| 指标 | 实际值 |
|---|---:|
| Collector Catalog Items | 285 |
| Projection eligible items | 284 |
| 当前 FigurePrototypes / cards | 231 / 231 |
| Singleton prototypes | 189 |
| Multi-item prototypes | 42 |
| Catalog items collapsed | 53 |
| Grouping conflicts | 0 |

当前 231 个 Prototype 没有在本轮被修改、重建或重新排序。Collector 的 `figures.json`、grouping 结果、image-evidence 与 personal gallery 产品代码均保持原样。

## 2. 审计方法和覆盖

一次性脚本以当前 231 个 Prototype 为输入，用标题、厂商族、系列词、版本词和构图提示生成高召回候选；它只负责找候选，不产生归并真值。脚本产生：

- 35 个 candidate pair；
- 23 个相连 candidate group；
- 涉及 53 个当前 Prototype。

静态审计板为 `prototype-final-audit-board.html`，每组同时展示 Prototype、Catalog Items、版本信号和每侧最多 6 张现有图片。全部 35 个 pair 均通过系统 Chrome 逐组看图；同时在当前 Rem Gallery 中完整浏览了 231/231 张卡，并对 BiCute Bunnies、Relax Time、Coreful、Precious Figure、Glitter & Glamours、Bunny 等高风险系列做了定向复核。

本轮没有运行 pHash、CLIP、embedding、LLM 视觉判断或新的 grouping 算法。图片仅作为人工只读审计材料。

## 3. 人工结果

35 个候选 pair 的人工关系结论为：

| 关系结论 | Pair relations |
|---|---:|
| `CONFIRMED_SAME_POSE` | 11 |
| `CONFIRMED_DIFFERENT_POSE` | 24 |
| `UNCERTAIN` | 0 |

11 条 SAME 关系具有传递重叠，不能按 11 组直接扣减。合并成不相交 proposal 后得到 7 个修正组，影响 17 张现有 Prototype 卡，若全部接受会减少 10 张卡。

### 3.1 建议归并的 7 组

| Proposal | 当前卡数 | 原因类型 | 人工结论 |
|---|---:|---|---|
| BiCute Bunnies base / Blue / White Pearl | 3 | `PURE_COLOR_VARIANT` | 相同身体雕塑、肢体位置和轮廓，仅涂装不同；base 是整页人工扫描发现的算法漏候选 |
| Birthday Lingerie original / Purple / Blue | 3 | `PURE_COLOR_VARIANT` | 相同坐姿雕塑，仅颜色和底座处理不同 |
| Oni Tenshi LPM / SPM / generic | 3 | `DUPLICATE_LISTING` | 图中是同一白色服装雕塑；产品线标签属于目录别名 |
| Original Winter / Winter Bunny | 2 | `MINOR_EXPRESSION_ACCESSORY` | 身体、肢体、服装和整体 silhouette 相同；主要差异是圣诞帽与兔耳小配件 |
| Kunoichi SPM / generic | 2 | `DUPLICATE_LISTING` | 同一雕塑与姿势的重复命名记录 |
| Yukata repaint / Renewal Package | 2 | `RERELEASE_RENEWAL` | 同一和服雕塑与姿势；重涂、包装和再版不形成新摄影姿势 |
| Cheerleader Renewal Online Crane / Original Smiling | 2 | `CHANNEL_VARIANT` | 身体雕塑和姿势相同；渠道色与小表情变化不形成新摄影姿势 |

完整 Prototype ID、35 个 pair 的逐项决定和理由位于 `prototype-final-audit-proposals.json`。该文件是可删除的审计建议，不是 Projection 输入。

### 3.2 按 false-split 原因统计

| 原因 | Groups | 当前卡片受影响 | 修正后减少 |
|---|---:|---:|---:|
| `PURE_COLOR_VARIANT` | 2 | 6 | 4 |
| `RERELEASE_RENEWAL` | 1 | 2 | 1 |
| `CHANNEL_VARIANT` | 1 | 2 | 1 |
| `DUPLICATE_LISTING` | 2 | 5 | 3 |
| `MINOR_EXPRESSION_ACCESSORY` | 1 | 2 | 1 |
| `OTHER_SAME_SCULPT` | 0 | 0 | 0 |
| **总计** | **7** | **17** | **10** |

这里的“卡片受影响”按不相交 proposal 去重；不能把各候选 pair 的端点重复累加。

## 4. 人工扫描新增发现

完整 231 卡扫描找到 1 个自动候选之外的 false-split 组：BiCute Bunnies base 与候选中的 Blue / White Pearl 是同雕异色。它已经作为同一个 3-card proposal 计入上表，因此不是额外再扣一次。

除这一组外，整页快速扫描没有再发现人眼明显、但候选脚本完全漏掉的重复姿势。这个结论是针对当前冻结 231 卡的一轮人工审计，不代表未来增量条目自动免审。

## 5. 重点危险负例

以下名称相近的卡在人工看图后保持不同：

- Bunny 与 Bunny 2nd：原版跪姿，2nd 为站姿；
- Bare Leg Bunny 与 Bare Leg Bunny 2nd：跪姿与站姿不同；
- Glitter & Glamours 与 Another Colour：手臂、裙装几何和 silhouette 不同，不是纯异色；
- Phantom Night Wizard 单人与双人：摄影构图不同；
- Madorami 与 Omezame：手臂、头部和躯干姿态变化；
- Serenus Couture base / Vol. 2 / Vol. 3：是三个不同雕塑；
- BiCute Bicolor 与 Blue / White Pearl：手脚姿态不同。

Relax Time 的两侧记录包含扁平化跨来源图片污染。人工判断时只使用可归属到各来源条目的视图：候选 pair 001 的两张卡分别表现坐姿与后仰/躺姿，因此确认为不同；没有把混入的 Japan Figure 图片当作合并依据。

## 6. 修正后的 Rem v1 基线

按不相交 proposal 计算：

```text
231 current prototypes
- 10 residual false-split cards
= 221 corrected prototypes
```

本轮没有 `UNCERTAIN`，所以：

```text
low / expected / high = 221 / 221 / 221
```

这是“若项目所有者接受全部 7 个 proposal”的产品基线，不是已经生效的 Gallery 数字。当前页面仍然是 231 张卡。

## 7. 尚未解决的产品问题

1. 扁平 `image_urls` 仍会混合 Solaris、Good Smile 与 Japan Figure 的来源归属；Relax Time 已暴露人工判断被错误图片误导的风险。
2. 当前 `prototypeId` 来自完整成员集合 hash；正式应用 proposal 时，merge 会更换 ID，必须迁移排除、备注和人工封面偏好。
3. 当前审计覆盖冻结的 231 张卡；未来新增 Catalog Item 仍需先进入高召回 residual audit，而不能假设本轮 proposal 对增量数据永久完备。
