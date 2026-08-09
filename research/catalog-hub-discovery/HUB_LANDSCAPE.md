# Catalog Hub 候选地图

## 口径

检索日期统一为 2026-08-09。除 Good Smile 既有数据外，本轮调查 12 个外部候选，共 13 个来源。评分为 0–5 的 desk-research 优先级，不是覆盖率 benchmark；`PermissionScore` 是硬门禁，不能由其他分数抵消。

- 5：有明确、适配本项目用途的官方机器通道和许可；
- 3：有正式合作/API 路径，但当前账号或用途仍需确认；
- 1：技术上公开可见，但没有批量/持久化授权；
- 0：已明确阻止、条款冲突或当前访问被拒绝。

本轮没有候选达到“正式持久私有 catalog + 图片生命周期”完整 PermissionScore 5。

## 统一字段矩阵

缩写：`D/I/M/H/Inc/A/P` = Discovery / Identity / Media / History / Incremental / Automation / Permission。

| source | sourceType | historicalDepth / multiManufacturer | character/work/category | JAN / maker / scale / date / ID | images / soldOut | pagination / incremental / API | permission / request cost / maintenance | D/I/M/H/Inc/A/P |
|---|---|---|---|---|---|---|---|---|
| Good Smile ecosystem | manufacturer catalog | 深；单生态多品牌 | legacy text 强，current 弱；作品/分类较好 | JAN弱；maker/scale/date/ID强，但新旧ID迁移 | 多图；legacy retained | legacy分页；current推荐图；无API/feed | 不清；中请求；中高维护 | 4/4/4/5/2/2/1 |
| [HobbySearch / 1999](https://www.1999.co.jp/eng/figure) | specialist retailer | 深；多厂商；旧品至少到 2009 | 关键词、作品、厂商、比例、类别 | JAN/maker/scale/date/数字ID强 | 多图；Sold Out retained | 分页/新品/再版；无公开API | [条款](https://www.1999.co.jp/eng/terms)仅私人使用；本轮搜索403；高请求/高维护 | 5/5/4/5/3/0/0 |
| [AmiAmi](https://www.amiami.com/eng/search/list/) | specialist retailer | 中深；新品+二手；多厂商 | Series/Character/Brand/Product Line | JAN、maker、日期、Shop Code强；比例多在规格 | 多图；Order Closed retained | 分页；无公开feed/API | 无机器复用授权；动态HTML；中高维护 | 4/4/4/4/3/1/1 |
| [Surugaya](https://www.suruga-ya.com/en/products?category=50103) | general used/new retailer | 深；多厂商；旧年筛选 | 系列/分类/厂商强，角色多靠词 | 国际页JAN弱；maker/date/数字ID强；比例文本 | 图；out-of-stock retained | 24/页；无feed/API | [条款](https://www.suruga-ya.com/en/conditions-use)无复用许可；高噪声/高请求 | 3/3/2/5/2/1/1 |
| [CDJapan](https://www.cdjapan.co.jp/guide/help/ordering/search_tips) | general retailer/feed partner | 深；多厂商；停售保留 | 日文关键词/JAN/系列；角色规范中 | JAN、Catalog No、Label、规格、日期强 | 图；Sold Out retained | newest/oldest；官方 [RSS/XML 与 bulk sync 申请](https://www.cdjapan.co.jp/aff/FAQ_affiliate_2.html) | 合作前置；RSS低请求，bulk最低维护 | 4/5/3/4/5/4/2 |
| [HLJ](https://www.hlj.com/search/) | specialist retailer | 深；多厂商；discontinued | maker/series/category/item type强 | JAN/maker/scale/date/code强 | 多图；discontinued retained | New Additions 24h/7d/30d；无API | [条款](https://support.hlj.com/hc/en-us/articles/115001722094-Terms-Conditions-of-Use)未授权目录bot；中高维护 | 4/5/4/5/4/1/1 |
| [Solaris Japan](https://solarisjapan.com/) | specialist retailer | 中深；多厂商 | franchise/brand/type强 | JAN未证实；scale/date/slug中 | 多图；Sold Out retained | 分页/新品；无API | [条款](https://solarisjapan.com/pages/terms-of-service)明确禁止 spider/crawl/scrape，除非书面许可 | 3/3/4/4/3/0/0 |
| [Tokyo Otaku Mode](https://otakumode.com/shop/figures-dolls) | curated retailer | 中；多厂商 | series/product line/manufacturer强 | JAN弱；scale/spec/date/ID强 | 多图；售罄页 | 分页/New Items；无API | [条款](https://otakumode.com/tos)禁止未经许可 scraper/robot | 3/3/4/3/4/0/0 |
| [Rakuten Product Search API](https://webservice.rakuten.co.jp/documentation/ichiba-product-search) | official marketplace API | 当前为主；多商家 | keyword/genre，角色作品文本化 | productId/JAN/brand/maker强；scale/date较弱 | 1张64/128图；历史保留弱 | 30/页、100页；Item API可 `-updateTimestamp` | key必需、1 rps；[规则](https://webservice.rakuten.co.jp/guide/rule)与私人持久库用途冲突待书面确认 | 4/4/1/2/4/5/0 |
| [Yahoo! Shopping API v3](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html) | official marketplace API | 当前为主；多商家 | q/JAN/genre/brand/store | seller code、JAN、brand、date强；跨店ID弱 | 单图≤600；历史弱 | 50/页，最多1000；无通用updated-since | Client ID；其链接的[API约款](https://developer.yahoo.co.jp/webapi/shopping/api_contract.html)限制保存；低请求 | 4/3/2/1/3/5/0 |
| [MyFigureCollection](https://myfigurecollection.net/item/browse/search/) | specialist community DB | 很深；多厂商 | 原生 origin/character/company/classification | barcode/catalog/maker/scale/release/item ID强 | 官方/社区图混合；长期条目 | 搜索分页；无公开API/feed | 本轮 agent access 403；无批量授权；社区图片权利复杂 | 5/5/3/5/3/0/0 |
| [MyFigureList](https://myfigurelist.com/) | specialist DB/price aggregator | 中深；多厂商 | series/character/brand/scale/material | figure ID/JAN/brand/scale/date强 | 多图/价格；记录保留 | 页面列表/新品/calendar；无公开API | [条款](https://myfigurelist.com/terms-and-conditions)无批量授权；合作前置 | 5/5/3/4/4/2/1 |
| Hpoi（仅仓库既有证据） | specialist figure DB | 深；多厂商 | 角色/作品/厂商/类别强 | 稳定ID、比例、日期、媒体入口 | 多图但传输风险 | 无已确认公开API | 自动访问需书面许可；本轮请求0 | 5/5/3/5/3/0/0 |

`✓` 或高分只表示页面/文档中存在字段，不代表批量覆盖率、准确率或使用权。

## Top 4 取舍

### 1. HobbySearch / 1999

历史、停售保留、JAN、厂商、比例和数字 ID 最接近 Figure Gallery 的 Historical/Identity hub。它是第一许可谈判对象，不是当前可爬来源。本轮 Rem/Cheshire 两个低频搜索请求都返回 403，立即停止。

### 2. CDJapan authorized RSS/bulk

最重要优势不是 HTML，而是官方说明的 RSS/XML 与 bulk database sync 申请路径。它可能用很低的增量请求量提供合法机器入口；Figure 分类和角色规范性弱于专业库，需要离线归一和 maker gaps。

### 3. Rakuten Product Search API

版本化 API、JAN、productId 与 maker 适合身份交叉验证；图片和历史不够。现有条款对复制、持久化和特定人员环境存在冲突，因此只有书面确认本项目用途后才值得小样本验证。官方[限流说明](https://webservice.faq.rakuten.net/hc/en-us/articles/900001974383-What-is-the-request-limit-for-each-API)为每 Application ID 1 request/sec。

### 4. MyFigureList partnership/feed

有限页面样本直接显示 Rem 490、Cheshire 26，并有稳定 figure ID 与角色/作品层次，领域价值高。页面不同位置的 Rem 数曾出现 384/490 差异，说明计数和更新语义需澄清；没有公开 API 或批量许可，所以推荐谈合作/feed，不推荐直接实现 scraper。

## 未入 Top 4 的原因

- MyFigureCollection：专业语义可能最强，但当前 403 且无公开 API，行动性低于 MyFigureList；仍是高价值许可合作对象。
- Yahoo：API 行动性高，但跨店重复、1000 结果上限、历史弱且保存条款冲突。
- AmiAmi/HLJ/Surugaya：目录有价值，但 HTML 请求成本和许可不确定性较高。
- Solaris/Tokyo Otaku Mode：条款明确阻止未经许可的自动抓取。
- Hpoi：继续只作人工覆盖率参考，本轮请求严格为 0。

## 许可门禁

每个候选必须分别回答四个问题：机器读取、元数据复制、长期私有持久化、图片保存/展示。任一项不清楚即不进入正式连接器。robots 允许、页面 200、官方 API 存在或个人用途都不能自动回答后三项。
