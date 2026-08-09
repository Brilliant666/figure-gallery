# MVP-05：Hpoi 搜索索引发现与覆盖验证

## 1. 结论

MVP-05 建立了自动、有限、可重复的第三方 Hpoi 搜索索引发现链路，并保持 Hpoi direct transport 为 0。柴郡与蕾姆的真实候选均被自动分类、去重、匹配和尝试解析；系统不会要求项目所有者逐条筛选，也不会为了覆盖数字伪造商品。

真实结果同时揭示了当前瓶颈：第三方搜索索引对 Hpoi 的召回和摘要质量不足。柴郡只得到 3 个歧义候选；蕾姆得到 35 个候选，其中 14 个在首期范围，12 个具有可区分造型线索但仍未找到受审官方来源。本轮没有真实候选成功解析为新商品，因此图库仍为柴郡 7 款/65 图、蕾姆 11 款/89 图。

因此，Hpoi 搜索索引目前适合作为自动化的**补充 coverage 信号**，尚不能单独替代 broad official search，也不能证明接近 Hpoi 完整数据库覆盖。只有未来获得 Hpoi 明确书面许可，才可另行评估 Direct Adapter。

机器真值见 [`hpoi-index-discovery-results.json`](../research/evidence/mvp05/hpoi-index-discovery-results.json)。

## 2. 新北极星与当前瓶颈

产品最高层方向见 [`PROJECT_NORTH_STAR.md`](PROJECT_NORTH_STAR.md)：Figure Gallery 是以角色为入口、以独立 `FigurePrototype` 为核心实体的二次元拍摄姿势数据库。完整手办数据库是拍摄参考图库的底层能力，不是另一个产品。

MVP-04 的 broad web search 能建立图库，但它不知道角色究竟有哪些既有手办，只能在整个互联网中猜测查询。MVP-05 因此先建立候选清单，再只对新的高置信目标反查官方来源：

```text
Character
  → bounded Firecrawl Search v2 queries scoped to site:hpoi.net
  → inert Hpoi indexed result text
  → DiscoveryCandidate
  → character/work/scope classification
  → existing gallery match
  → reviewed non-Hpoi official resolution
  → local ProductRecord and SHA-256 media
```

该结构正确地把“可能存在哪些手办”和“商品事实/图片是什么”分开；真实运行证明的下一瓶颈是搜索索引召回与官方解析命中率，而不是候选存储或浏览器图库。

## 3. Hpoi 的角色与 direct 边界

Hpoi 只承担两种非权威信号：

- Discovery Index：提示某角色可能有哪些手办存在；
- Coverage Benchmark：提示 Figure Gallery 相对当前索引候选集可能遗漏哪些造型。

Hpoi 不提供正式主图、正式图片资产、唯一商品事实或 `FigurePrototype` 身份。正式事实和图片仍只取自受审的厂商、官方品牌、官方发行方或明确允许的 distributor/retailer。

MVP-05 只让 Firecrawl Search v2 返回 Hpoi URL、标题、摘要、查询和排名文本。工具不会对这些 URL 发起 GET、HEAD、DNS、scrape、API、图片、favicon 或浏览器请求，也不会生成可点击的 Hpoi 链接。真实运行四项断言均为 0：

```text
hpoiDirectHttpRequests = 0
hpoiDirectBrowserNavigations = 0
hpoiScrapeRequests = 0
hpoiApiRequests = 0
```

未使用 Cookie、登录、验证码处理、增强代理、代理轮换、缓存/镜像或 ID 枚举。

## 4. 自动发现实现

`HpoiIndexDiscoveryProvider` 只调用 Firecrawl Search v2 的 web source，并强制 `site:hpoi.net` 查询和 Hpoi domain filter。每个角色的 deterministic query matrix 最多 30 条，每条最多 10 个结果，原始结果最多 200，单并发且按 7 秒间隔运行。401、403、429、captcha、robots 或 access denied 会立即停止当前阶段并保留已成功候选。

`DiscoveryCandidate` 只保存在 `.local/personal-gallery/discovery/<character>/`，关键字段包括候选 ID、角色、索引 URL 文本、标题/摘要 hint、查询、排名、厂商/分类/比例 hint、状态、已有商品匹配、解析证据和 `prototypeHint`。Git 只保存合成 fixture 与聚合证据。

自动分类会：

- 同时验证角色和作品，防止小柴郡、Ram 或其他同名角色误命中；
- 收录比例、静态完成品和景品信号；
- 排除明确的 Nendoroid、可动、盲盒、GK 和非实体周边；
- 不确定时保留为 `ambiguous`，不误删；
- 用官方 URL、官方商品 ID、规范标题、厂商、比例和变体词匹配已有商品；
- 对没有独立造型线索的通用角色标题保持 `ambiguous`，不强行归为新商品。

## 5. Official resolver

只有 `new_target` 会生成最多 3 条定向 official query。优先使用已知厂商域，然后是标题、厂商、角色和作品组合。Search 明确排除 Hpoi；结果还必须通过现有非 Hpoi allowlist、角色/作品证据和评分门禁，才可进入官方页面采集器。

真实蕾姆首轮为 14 个初始新目标执行了 28 次 official resolution Search，结果均未得到足以进入受审来源 allowlist 的页面，所以保持 `needs_resolution` 和 `no_reviewed_official_result`。随后的规范化修正把 2 个缺少独立造型线索的结果降为 `ambiguous`，最终剩余 12 个新目标。没有成功解析就不会 scrape、下载图片或创建商品。

离线合成端到端合同覆盖“索引候选 → 官方解析 → 商品与图片收录”，证明命中有效受审来源时会自动入库；真实运行的 0 新增是来源质量结果，不是伪造成失败或人为补数。

## 6. 真实角色结果

### 柴郡

| 指标 | 结果 |
| --- | ---: |
| Before | 7 商品 / 65 图片 |
| Hpoi-index candidates | 3 |
| In scope | 0 |
| Already collected | 0 |
| New target | 0 |
| Official resolved / Collected | 0 / 0 |
| Unresolved | 0 |
| Out of scope / Ambiguous | 0 / 3 |
| After | 7 商品 / 65 图片 |

搜索结果包含作品证据不足、角色仅出现在摘要或其他角色商品页等情况。系统全部保留为歧义项，没有误收。

### 蕾姆

| 指标 | 结果 |
| --- | ---: |
| Before | 11 商品 / 89 图片 |
| Hpoi-index candidates | 35 |
| In scope | 14 |
| Already collected | 0 |
| New target | 12 |
| Official resolved / Collected | 0 / 0 |
| Unresolved | 12 |
| Out of scope | 9 |
| Ambiguous | 14 |
| After | 11 商品 / 89 图片 |

`Ambiguous` 包含 12 个范围层歧义和 2 个在范围但缺少独立造型身份的匹配层歧义；它与 `In scope` 不是互斥总计。`Already collected = 0` 是真实比对结果：当前索引候选主要是基线 11 款之外的景品/变体，或没有足够证据安全匹配。离线 fixture 仍验证了已有商品精确/可能匹配路径。

## 7. Coverage 与观察界面

首页管理区显示每个角色的已收录数、索引候选数、非范围数和待解析数。`/discovery/<character-slug>` 显示标题、推断厂商/分类/比例、状态、本地匹配、官方解析摘要和失败原因，但不显示可点击 Hpoi 链接。

这些指标只相对于本轮第三方搜索索引候选集，不代表 Hpoi 完整数据库绝对覆盖率。候选观察页用于纠错和诊断，不是正常收录必须逐条人工审核的 inbox。

## 8. 幂等与浏览器验证

相同配置的第二轮结果：

- 新候选 0；
- 新商品 0；
- 新 SHA-256 对象 0；
- 柴郡与蕾姆商品/图片数量不变；
- preferred cover、exclusion 和 note 均保持；
- 已有解析尝试不会在每次运行重复消耗 official resolution Search。

系统 Google Chrome 150.0.7871.187 使用临时干净 profile 完成双角色真实 runtime 验收：7/65 与 11/89、每款一张封面、详情、灯箱、缩放、4/3/2 响应式、coverage 页面和偏好保持均通过。浏览阶段外网请求、Hpoi 请求、Firecrawl 请求均为 0；没有截图、视频或 trace 进入 Git。

## 9. 自动化效率对比

| 阶段 | Search | Scrape | Credits | 解析新目标 | Requests / resolved target | Credits / resolved target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MVP-04 task totals | 15 | 33 | 108 | 11 | 4.36 | 9.82 |
| MVP-05 首轮双角色 | 83 | 0 | 166（估算上界） | 0 | 不可计算 | 不可计算 |

MVP-05 首轮包括 55 次 Hpoi-index Search 和 28 次定向 official-resolution Search。Firecrawl SDK 本轮未返回 `creditsUsed`，因此依据 [Firecrawl Search 官方计费说明](https://docs.firecrawl.dev/features/search) 对每次最多 10 个结果的 Search 按 2 credits 记录估算上界，不能把它描述为账单实扣。

MVP-05 消除了无效 scrape，也安全地产生了真实 coverage 候选，但没有把候选解析成新商品，当前请求/credit 效率明显不优于 MVP-04。结论不是扩大 query 数或降低来源门禁，而是：

1. 保留 Hpoi-index 为低频、补充型 coverage 信号；
2. broad official search 仍是当前能产出商品的主要自动路径；
3. 优先改善确定性别名/厂商映射和 official resolution，而不是盲目增加 Search；
4. 若未来获得 Hpoi 书面许可，另建任务比较 Direct Adapter 的召回、成本和合规性；
5. 在此之前不能声称已接近 Hpoi 的完整覆盖。

## 10. 边界与后续

本轮没有实现第三个角色、Hpoi Direct Adapter、Hpoi 浏览器自动化、pHash、自动 `FigurePrototype` merge、正式 Payload 写入、正式 PR-02 或部署。

`ProductRecord` 仍是个人图库的来源级过渡记录，不等于最终 `FigurePrototype`。后续原型去重必须在独立任务中基于厂商、规范标题、比例、造型/服装词、版本与多来源证据建模；`prototypeHint` 只能提示，不能自动合并。
