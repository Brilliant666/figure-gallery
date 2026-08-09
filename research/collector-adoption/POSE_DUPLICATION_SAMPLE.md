# 姿势价值与版本重复视觉抽样

## 方法与边界

审查日期：2026-08-10（Asia/Shanghai）

使用系统 Google Chrome Profile 5 只读打开本地
`http://127.0.0.1:8765/gallery.html`。没有访问 Hpoi，没有修改 Collector、
`figures.json` 或 `gallery.html`，也没有提交截图、视频或远端图片。

固定样本共 129 张卡：

- 前段：索引 0–41，共 42 张；
- 中段：把每 6 卡视为一行，用固定随机种子 `20260810` 从行 14–30
  抽 7 行，得到行 14、15、19、21、23、24、27，即索引 84–95、
  114–119、126–131、138–149、162–167，共 42 张；
- 后段：沿用同一 RNG 状态从行 34–47 抽 8 行，得到行 34、35、40、
  41、43、45、46、47，即索引 204–215、240–251、258–263、270–284，
  共 45 张（末行仅 3 卡）。

此外，用标题预筛 30 组高概率重复/变体并定向视觉复核。该 30 组是
**富集样本**，用于验证版本关系形态，不是全库随机样本，不能把其重复率
直接外推到 285 条。

## 129 卡姿势价值观察

按“主图是否清楚呈现可用于拍摄参考的人物身体姿势”保守判断：

| 结果 | 卡片数 | 说明 |
| --- | ---: | --- |
| 明确有姿势参考价值 | 128 | 只说明卡片主图足以观察身体姿态，不代表全部候选图都可用 |
| 无法判断 | 0 | 固定样本中没有因断图而无法判断的卡 |
| 明显低价值 | 1 | 索引 84，`solaris:7415437426731` ArtScale 半身胸像，缺完整肢体 |
| 明显非手办漏网 | 0 | 未见毛绒、文件夹、doll、action、Q/SD 等 |

固定 129 卡完成滚动加载后 DOM 断图为 0。定向复核另发现索引 99
`solaris:7710919884843` Nekomimi Maid Renewal 显示 `No Image` 占位，
所以本次完整视觉审查共看到 1 个图片可用性问题；它不在固定 129 卡中。
这也说明 `image_urls` 非空不等于图片在图库里实际可见。

姿势形态以直立和重心转移为主，行走/单腿动态其次；坐、跪、卧姿是明显
少数；双人套装和带场景道具的构图存在但不多；半身像罕见。这个分布支持
Prize 作为姿势库主体，也支持保留类型、厂商和年代筛选，而不是只保留比例
手办。

## A–F 判定

- **A**：同一 sculpt，仅再版（A-reissue）或重复来源/商品页（A-listing）；两者在 Prototype 层都折叠，但只有 A-listing 会减少 commercial-version 计数；
- **B**：同一 sculpt，颜色或渠道配色不同；
- **C**：同一主体 sculpt，小配件、同伴、表情或套装状态不同；
- **D**：标题/系列相似，但身体姿势或 sculpt 明显不同；
- **E**：完全不同 prototype；
- **F**：当前图片不足，无法判断。

判定是研究级人工分组证据，不执行 merge，也不创建正式 Prototype。

## 30 组定向视觉结果

| # | 类 | 记录 | 视觉理由 |
| ---: | :---: | --- | --- |
| 1 | D | `goodsmile:1137281` Bare Leg Bunny 2nd ↔ `goodsmile:10783` Bare Leg Bunny | 站姿与跪姿，标题近但不同原型 |
| 2 | D | `solaris:7348122058795` Glitter & Glamours ↔ `solaris:7260065005611` Another Colour | 服装轮廓与姿势不同，不是纯异色 |
| 3 | F | `solaris:7273166241835` Nekomimi Maid ↔ `solaris:7710919884843` Renewal | Renewal 卡显示 No Image |
| 4 | B | `goodsmile:59983` Graceful Beauty 2024 ↔ `goodsmile:13733` Graceful Beauty | 同坐姿主体，装饰/配色变化 |
| 5 | A | `goodsmile:6331` Wedding ↔ `solaris:6985403826219` Wedding 2024 Re-release | A-reissue：同雕再版 |
| 6 | A | `goodsmile:1136861` Yukata Renewal Package ↔ `solaris:2099673071673` Yukata | A-reissue：同雕包装再版 |
| 7 | A | `solaris:4373233827883` / `7263774244907` / `4885454848043` Crystal Dress | A-listing：同雕、重复目录表达 |
| 8 | A | `solaris:8976803976` ↔ `solaris:142325776392` Soine | A-listing：同一商业版本的重复目录表达 |
| 9 | A | `solaris:4253217292331` / `6984204779563` / `902511493177` Shiromuku | A-reissue/mixed：同雕，含 2023 再版和近重复目录 |
| 10 | A | `solaris:6847337857067` Original Winter ↔ `solaris:7046983024683` Renewal | A-reissue：同雕再版 |
| 11 | B | `solaris:6962580357163` Winter Maid ↔ `solaris:6942159503403` Online Crane | 同姿势渠道配色 |
| 12 | B | `solaris:7219786580011` Jumper Bunny ↔ `solaris:7392714719275` Renewal | 同姿势配色变化 |
| 13 | B | `solaris:6847315181611` China Maid ↔ `solaris:6610006769707` Renewal | 同姿势配色变化 |
| 14 | B | `solaris:6606165377067` / `6562229354539` / `7321695191083` Magician | 同姿势三配色 |
| 15 | B | `solaris:6882921185323` / `6606169833515` / `6847346343979` Salopette Mizugi | 同姿势三配色 |
| 16 | B | `solaris:6847337365547` / `7054603026475` / `7054603616299` / `6943218401323` Outing Coordination | 同姿势，主差配色；中置信 |
| 17 | B | `solaris:7209924132907` / `6545198579755` / `6781255385131` / `6943217647659` Pretty Little Devil | 同姿势配色及重复目录表达 |
| 18 | B | `solaris:6545280335915` Room Wear ↔ `solaris:6824854650923` Renewal | 同姿势配色变化 |
| 19 | B | `solaris:6847325929515` Subaru-kun no Jersey ↔ `solaris:7119258648619` Renewal | 同姿势配色变化 |
| 20 | B | `solaris:6847340511275` Winter Coat ↔ `solaris:6762679435307` Renewal | 同姿势配色变化 |
| 21 | B | `solaris:6545216208939` Happy Easter ↔ `solaris:7223177412651` Renewal | 同姿势配色变化 |
| 22 | B | `solaris:6562222473259` Oni Ishou ↔ `solaris:6808963055659` Another Color | 明确异色 |
| 23 | B | `solaris:7046983090219` Twinkle Party ↔ `solaris:7286156689451` Another Color | 明确异色 |
| 24 | B | `solaris:7063929061419` AnimalParade A Prize ↔ `solaris:7063929880619` Last One | 同姿势 Last One 配色 |
| 25 | B | `solaris:6585241174059` in Circus ↔ `solaris:7239339737131` Pearl | 同姿势珠光配色 |
| 26 | B | `solaris:2011235909689` In Wonderland ↔ `solaris:6630677839915` Antique | 同姿势古铜配色 |
| 27 | B | `solaris:6630663684139` Wolf and Seven Little Goats ↔ `solaris:6630668435499` Pastel | 同姿势粉彩配色 |
| 28 | D | `solaris:7284897382443` Phantom Night Wizard 单蕾姆 ↔ `solaris:7284897546283` 蕾姆&拉姆套装 | 增加同伴改变多角色构图；按当前一商品一原型关系保留独立 Prototype |
| 29 | D | `solaris:7200658358315` Yumekawa Maid 单蕾姆 ↔ `solaris:7200655802411` 蕾姆&拉姆套装 | 增加同伴改变多角色构图；按当前一商品一原型关系保留独立 Prototype |
| 30 | C | `solaris:6611542868011` Madorami ↔ `solaris:6611543162923` Omezame | 同卧姿主体，醒/睡表情状态差 |

分类合计：A=6、B=18、C=1、D=4、E=0、F=1。A+B+C 为
25/30 = **83.3%**。这只是高概率候选样本的“命中率”，不是全库重复率。

30 组共有 68 条记录。25 个 A/B/C 组含 58 条，视觉上折叠为 25 个
姿势原型，即 33 条是首条之外的版本/重复；四个 D 组各保留两个原型；F 组
保留一至两个。因此这 68 条对应 **34–35 个**暂定原型，减少 33–34 张
重复卡片。

## 285 条到底代表什么

### 从 CatalogItem 到 probable versions

285 条最接近跨来源初步合并后的 CatalogItem。A-reissue、B、C 仍是商业
版本或套装差异；只有 A-listing 一类的同一 commercial version 重复目录页
应在 version 层进一步折叠。当前样本明确支持 Crystal Dress 与 Soine 至少
3 条 listing-level 压缩，Shiromuku 仍混合再版与近重复；扁平快照无法可靠
区分全库 retailer duplicate。因此下列 probable distinct version records
只是围绕 0–6 条额外 listing 重复的**低置信敏感性区间**，不是由 90% 富集
样本外推：

- low：279；
- expected：282；
- high：285。

这个区间表示“约 279–285 个商业版本/发行条目”，不表示原型数，也不授权
创建 `FigureVersion` 实体。

### 从 probable versions 到 FigurePrototype

以“每个雕型首条之外的追加版本/重复记录”为压缩量：

| 情景 | 追加版本/重复记录 | 占 285 | probable unique prototypes |
| --- | ---: | ---: | ---: |
| 低重复（只计 30 组直接确认） | 33 | 11.6% | 252 |
| 预期 | 50 | 17.5% | 235 |
| 高重复 | 65 | 22.8% | 220 |

因此独立姿势卡片的研究区间为 **220–252**，中心估计 **235**。预期情景在
已确认 33 条之外，还计入 129 卡样本中看到但未纳入 30 组的 Kunoichi、
Ukiyo-e、蓝/紫内衣、生日套装/单品及跨来源近重复等约 15 条；高重复情景
再为未定向审查的 Renewal、Another Color、Last One 与套装家族预留约 15
条。它不是全库图像聚类结果；全量人工 grouping 才能产生正式数值。

## 最大五类重复/变体来源

1. Original / Renewal / Re-release / Renewal Package；
2. Standard / Another Color / Special / Pearl / Pastel / Antique；
3. 标准渠道 / Online Crane / limited-channel 配色；
4. A Prize / Last One 与同一主体的抽奖版本；
5. 小表情/配件状态，以及同一商业版本的重复目录命名；单品与新增同伴的套装保留为不同多角色构图。

## 对架构的含义

- `CatalogItem ≠ FigurePrototype` 已被真实视觉样本直接证明；
- `FigureVersion` 概念真实存在，但现阶段以 CatalogItem 上的 version facts
  表达即可；
- 标题相似会产生 D/F，不能自动 merge；
- grouping 必须是可逆映射，并保留 A–F、置信度和理由；
- 图库应一 Prototype 一卡、人工选封面、详情展示所有有来源的参考图。
