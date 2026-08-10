# Cheshire coverage recovery matrix

## 结论

本轮是 `Case C — No Safe Recovery`。当前三源没有自动找回 ALTER 与 Fancy Night；三个补源候选均未通过“许可清晰才做商品 live benchmark”的前置门禁，因此没有新增 Connector，也没有把旧记录硬塞回 Catalog。柴郡保持 13 条 wide Catalog、6 条 pose-eligible Catalog Item、6 个 FigurePrototype、69 个 ImageRef；旧 7 条覆盖仍为 5/7。

## 两条 old-only 身份

### ALTER Cheshire

- old baseline id：`azur-lane_cheshire_official_alter-web.jp-url-afd4dd5082f6244b1f23c4a2e067a524aa64655fc3f9d0fddd8ed976ba1eb129`
- title：`チェシャー｜ALTER`
- normalized title：`チェシャー|alter`
- manufacturer：`ALTER`
- scale / size / release：`1/7`；约 260 mm；`2025-07`
- known source URL：`https://alter-web.jp/products/560`
- known image references：6 个历史官方 ImageRef
- historical source：`official_manufacturer`，当时由 `firecrawl_search` 定位
- pose eligibility：`likely_scale`；完整比例人物造型，不是 Q/SD、胸像或周边，具有明确姿势参考价值

### Fancy Night / AmiAmi Cheshire

- old baseline id：`azur-lane_cheshire_official_amiami.jp-id-FIGURE-181336`
- title：`【特典】アズールレーン チェシャー ファンシー・ナイトドリームVer. 1/6 完成品フィギュア[あみあみ×AniGame]`
- normalized title：`【特典】アズールレーン チェシャー ファンシー・ナイトドリームver. 1/6 完成品フィギュア[あみあみ×anigame]`
- manufacturer：`あみあみ×AniGame`
- scale / size：`1/6`；商品描述写明约 300 mm（历史结构化 `height` 字段的 `0mm` 是旧 parser 产物，不作为尺寸真值）
- known source URL：`https://www.amiami.jp/top/detail/detail?gcode=FIGURE-181336`
- known image references：10 个历史商品 ImageRef
- historical source：`official_distributor`，只通过人工审核过的 `seed_official_url` 接入，不具备自动发现证明
- pose eligibility：`likely_scale`；完整比例人物造型，不是 Q/SD、胸像或周边，具有明确姿势参考价值

以上均来自 Git 忽略的历史 runtime。仓库中的 synthetic fixture 只用于离线 parser 回归，不是本轮 live source evidence。

## 现有三源诊断

| Source | 有界诊断 | ALTER | Fancy Night | 结论 |
| --- | --- | ---: | ---: | --- |
| Solaris | robots + Azur Lane collection 两页，共 3 个 HTTP 请求、408 条 raw product | 未命中 | 未命中 | 当前 collection 输出中不存在两条目标；不是 alias、category 或 pose filter 丢失 |
| Good Smile | 本轮额外请求 0；审查既有 Connector 的官方厂商边界 | 不覆盖 ALTER 厂商 | 不覆盖 AmiAmi×AniGame | 不是发现逻辑 bug，不能要求 Good Smile 目录覆盖其他厂商 |
| Japan Figure | 共 11 个 HTTP 请求；含 broad、metadata、定向查询和 cursor 有界检查 | 未命中 | 未命中 | 存在通用 pagination 完整性风险，但本轮检查的前三页各 250 条及两条定向查询均未找回目标 |

Japan Figure 的公开 UCP 入口是 `https://japan-figure.com/api/ucp/mcp`，调用 `tools/call` / `search_catalog`，查询 `Cheshire Azur Lane figure`、`filters.available=false`，分页为 `limit=250` 加 cursor。响应仍给出 `has_next_page=true`，而当前 Connector 只消费首个 250 条响应；这是一个真实的通用完整性风险。不过本轮额外检查前三页（每页 250 条）仍为目标命中 0，两条定向查询的首 50 条也为 0，故不能把该风险写成 ALTER / Fancy Night 的已确认漏收原因，也不满足“修复即可恢复 old-only”的门槛。本轮未修改 Connector。

两个旧记录都能由现有角色与作品字段组合正确识别，并且会通过冻结的比例手办过滤：Fancy Night 标题明确含 `チェシャー` 与 `アズールレーン`；ALTER 标题含 `チェシャー`，历史记录的作品字段提供 Azur Lane 约束。没有证据指向 CharacterProfile alias、作品判别、category 或 pose eligibility bug。当前最窄、证据支持的归因是：三源实际覆盖/历史留存缺口。Fancy Night 还存在明确的历史 seed dependency。

## 补源许可与收益

| Candidate | 当前许可证据 | Permission | Product live benchmark | Discovery marginal | Identity enrichment | Media enrichment | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ALTER official | [robots.txt](https://alter-web.jp/robots.txt) 返回 404；[Policy](https://alter-web.jp/policy/) 没有提供自动目录访问许可或公开 API/feed 指引 | `UNCLEAR` | 未运行；product requests = 0 | 未测量 | 未测量 | 未测量 | `RESEARCH_ONLY` |
| AmiAmi | [robots.txt](https://www.amiami.jp/robots.txt) 为 404-style 响应；[Terms](https://www.amiami.jp/top/page/t/terms.html) 与公开声明的 [pre-order RSS](https://www.amiami.jp/top/rss/pre-order.xml) 均返回 403 | `BLOCKED` | 未运行；product requests = 0 | 未测量 | 未测量 | 未测量 | `REJECT` |
| HobbySearch | [robots.txt](https://www.1999.co.jp/robots.txt) 被 Cloudflare 以 403 阻断；[Terms](https://www.1999.co.jp/eng/terms/107) 没有形成可执行的自动发现许可 | `BLOCKED` | 未运行；product requests = 0 | 未测量 | 未测量 | 未测量 | `REJECT` |

`未测量` 不是 0 收益：因为许可门禁先失败，本轮没有向候选商品目录或商品页发起请求，也就没有合法的 live benchmark 数据。三个候选的 `oldOnlyRecovered`、`rawRelevant`、`poseEligibleRelevant`、`existingOverlap`、`newMarginal`、`images` 和 elapsed 均为 `null`。公开 Search 只用于定位来源规则，共 6 条定向 query；它没有成为数据供给链。

## 旧 7 条与 collector-only 覆盖

| Item | Old baseline | Solaris | Good Smile | Japan Figure | Candidate 4th source | Final |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| The Cat in the Magic Hat 1/7（Good Smile Arts Shanghai） | ✓ | ✓ | ✓ | × | 不需要 | covered |
| Summery Date! 1/7（Good Smile Arts Shanghai） | ✓ | ✓ | ✓ | × | 不需要 | covered |
| Cait Sith Crooner 1/7（Good Smile Arts Shanghai） | ✓ | ✓ | ✓ | × | 不需要 | covered |
| LIMEPIE / Dating Summer 1/8（APEX） | ✓ | ✓ | × | ✓ | 不需要 | covered（probable overlap） |
| Dakimakura Cover Illust 1/6（AniGame） | ✓ | ✓ | × | × | 不需要 | covered（probable overlap） |
| ALTER Cheshire 1/7 | ✓ | × | × | × | ALTER official：`UNCLEAR`、未 benchmark | missing |
| Fancy Night Dream 1/6 | ✓ | × | × | × | AmiAmi：`BLOCKED`、未 benchmark | missing |
| The Cat in the Magic Hat 1/6（AniGame） | × | ✓ | × | × | 不需要 | covered（collector-only） |

## 请求与边界

- 现有三源诊断：Solaris 3、Good Smile 0、Japan Figure 11，共 14 个 HTTP 请求。
- 最终一次 live refresh：12 个 HTTP 请求；结果保持 13 wide / 6 pose eligible，但报告 `new=0`、`changed=13`、`unchanged=0`。
- 候选许可文档：ALTER 2、AmiAmi 3、HobbySearch 1，共 6 个 HTTP 请求。
- 来源定位 Search：6 条 query。
- 候选 product live benchmark：0 个来源、0 个商品请求。
- Hpoi HTTP / browser / scrape / API：全部 0。

最终 source decision 为：ALTER `RESEARCH_ONLY`；AmiAmi 与 HobbySearch `REJECT`；第四来源 `DO NOT ADOPT / NONE SAFE`。源覆盖缺口仍为 `YES`。

最终 live refresh 的“零虚假变化”门禁没有通过。写回后用同一批当前记录做无网络重放得到 `new=0`、`changed=0`、`unchanged=13`、digest drift 0，说明这 13 条 live change 最符合“采用目录仍携带修复前 digest，首次修复后 refresh 统一规范化”的解释；但这只是离线重放证据。本任务只授权一次最终 live refresh，因此没有擅自再跑第二次，也不把该门禁写成通过。
