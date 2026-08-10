# Cheshire coverage recovery result

## 决策

`Case C — No Safe Recovery`。不新增第四 Connector：ALTER 的自动访问边界仍是 `UNCLEAR`，只保留为 `RESEARCH_ONLY`；AmiAmi 与 HobbySearch 的必需规则入口返回 403 或无法形成可执行许可，均 `REJECT`。许可门禁失败后没有继续访问候选商品目录或商品页，也没有用旧 baseline 作运行时 fallback。

## 十个问题

1. **ALTER 是否找回：否。** 历史记录是 `チェシャー｜ALTER`，ALTER，1/7、约 260 mm、2025-07，来源 `https://alter-web.jp/products/560`，有 6 个历史官方 ImageRef。
2. **Fancy Night 是否找回：否。** 历史记录是 AmiAmi `FIGURE-181336`，`あみあみ×AniGame`，1/6、约 300 mm，有 10 个历史商品 ImageRef。
3. **为什么之前漏：** Solaris 当前 Azur Lane collection 的 408 条 raw product 中没有两条目标；Good Smile 的厂商目录不覆盖 ALTER 或 AmiAmi×AniGame；Japan Figure 有 cursor 完整性风险，但三页各 250 条和两条定向查询仍未命中。Fancy Night 的历史接入还明确依赖人工 seed URL。现有证据支持“当前三源覆盖/历史留存缺口”，而不是 alias、标题、分类或姿势过滤失败。
4. **是否是现有 Connector bug：未确认。** Japan Figure 当前只消费首个 250 条响应是通用完整性风险，但有界翻页没有恢复两个 known gap，因此本轮不修改 Connector。
5. **测试了哪些补充源：** 研究 ALTER official、AmiAmi、HobbySearch 三个候选的 robots / Terms / policy / feed；没有候选通过许可门禁，所以 product live-tested sources 为 0。现有三源的窄诊断请求为 Solaris 3、Good Smile 0、Japan Figure 11；来源定位 Search 为 6 条 query。
6. **哪个值得采用：没有。** ALTER 仅适合继续人工澄清许可；AmiAmi 与 HobbySearch 当前拒绝接入。三类收益（Discovery marginal、Identity enrichment、Media enrichment）均因未做合法 product benchmark 而是“未测量”，不能写成 0 或正收益。
7. **新增 Catalog Item：0。** wide Catalog 保持 13，pose eligible / projection eligible 均保持 6。
8. **新增真正 Prototype：0。** 柴郡仍为 6 个 singleton FigurePrototype，grouping conflict 0。
9. **柴郡最终多少姿势：6。** 6 张卡、6 张封面、69 个 ImageRef；现有 ID、cover、group 与推荐顺序没有因本轮变化。
10. **还剩什么 coverage gap：** ALTER 与 Fancy Night 两条 old-only 都仍缺失；旧 7 条覆盖保持 5/7，`SOURCE_COVERAGE_GAP=YES`。

冻结 Rem 回归仍为 221 Prototype / 221 cards / 0 ID drift / 0 top-50 recommendation drift / 0 grouping conflict。本轮 Hpoi 请求为 0；没有修改外部 Rem Collector、Rem 数据、Personal Gallery、Payload、PostgreSQL 或 S3，没有新增第三角色、热门、Latest 或部署。

唯一一次最终 live refresh 保持 13 wide / 6 pose eligible、`new=0`，但报告 13 条 changed，故“零虚假变化”门禁未通过。写回后的无网络重放为 0 changed / 13 unchanged / digest drift 0；没有在授权外重复 live refresh。系统 Chrome 已完整浏览 6 张卡，并通过搜索、Manufacturer/Type 筛选、Detail、灯箱、缩放、键盘切换与封面保持验收；离线测试为 Collector 25/25、Personal Gallery 197/197、Playwright 2/2，正式 registry 的 npm audit high/critical 均为 0。

下一步唯一建议：保持当前 6 姿势基线，并另开一个独立的通用数据完整性任务，同时验证 Japan Figure cursor 分页和 digest 基线迁移；ALTER 只有在获得低频自动目录访问的明确书面许可或官方 API/feed 指引后才重新评估，且不得把 Japan Figure 风险误写成已证明能恢复这两个缺口。
