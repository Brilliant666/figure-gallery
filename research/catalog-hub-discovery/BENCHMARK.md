# 有限 Live Benchmark

## 边界与方法

- 固定角色：Rem 与 Cheshire；没有第三角色。
- Good Smile 使用已有 41 条冻结数据作 baseline，不重新批量请求。
- 最多选择 3 个新来源：HobbySearch、Rakuten Product Search、MyFigureList。
- robots、条款、凭据门禁先于数据请求；403/credential block 后不重试、不绕过。
- 不访问 Hpoi，不登录，不使用 Cookie、Token、代理轮换或浏览器动作。
- 不保存完整 HTML，不下载新来源图片，不构造内部 API。

## 结果总表

| source | status | requests | elapsed | rawProducts | inScope | manufacturer/JAN/images | overlap / marginal | errors |
|---|---|---:|---:|---:|---:|---|---|---:|
| HobbySearch | permission_blocked | 2 | 未保留精确值 | null | null | 未执行 | null / null | 2×HTTP 403 |
| Rakuten Product API | credential_and_permission_blocked | 0 | 0 | null | null | 未执行 | null / null | 0 |
| MyFigureList | completed, limited | 6 | 23.523 s | 38 rendered records | 25 title-level | 未打开详情，因此 null | Rem 4 / 9 | 0 |

“blocked”不是零覆盖，而是**未测量**。机器结果在 [`results.json`](../evidence/catalog-hub-discovery/results.json)。

## HobbySearch

预检发现 [FAQ](https://www.1999.co.jp/eng/faq/103) 描述关键词、厂商、比例、系列和 product code 搜索，公开索引也能观察到旧售罄商品、JAN 和多图；但[条款](https://www.1999.co.jp/eng/terms)只明确私人使用边界，没有授予自动建库权。本轮对 Rem、Cheshire 各一次低频搜索均返回 HTTP 403，未重试、未换代理、未访问详情。

因此所有 `rawProducts/inScope/JAN/image/marginal` 必须是 null。搜索引擎摘要中的数量只能作为 desk-research signal，不能冒充 live benchmark。

## Rakuten Product Search API

[Product Search v2025-08-01](https://webservice.rakuten.co.jp/documentation/ichiba-product-search) 要求 `applicationId + accessKey`；本轮没有凭据，所以请求为 0。即使技术凭据以后可得，[Web Service Terms](https://webservice.rakuten.co.jp/guide/rule)对复制、改变、保存和使用环境的限制也与 Figure Gallery 的持久私有 catalog 用途存在冲突。状态同时记为 credential 与 permission blocked，而不是等待用户或借用示例 key。

## MyFigureList

robots 预检没有禁止本轮只读页面；[Terms](https://myfigurelist.com/terms-and-conditions)没有提供批量复用许可，因此只做低频、无详情、无图片的研究样本。

实际读取：Re:Zero/Azur Lane 两个 series 页面，Rem/Cheshire 两个 character 页面；为了抽取聚合链接数，各 character 页面各重复一次，共 6 请求、23.523 秒、0 错误。

| role | 页面报告总数 | 首屏唯一 figure links | title-level in | out | ambiguous | probable prototypes |
|---|---:|---:|---:|---:|---:|---:|
| Rem | 490 | 22 | 14 | 7 | 1 | 13 |
| Cheshire | 26 | 16 | 11 | 4 | 1 | 10 |
| 合计 | 516（非枚举） | 38 | 25 | 11 | 2 | 23 |

Rem 页面包含两条 Wedding offering，候选归为一个 prototype；其余不做激进合并。对现有 FG 蕾姆 11 条识别出 4 个 overlap，样本内得到 9 个 marginal candidate，即 `9/6 = 1.5 marginal Rem candidates / total benchmark request`。这个比率混入了 series 预检请求，且只代表可见样本，不能外推全目录。

Cheshire 页面包含 Little Cheshire、Nendoroid、Bust、套装和可能重复 Magic Hat。由于本轮没有完成七条现有 Cheshire 数据的正式 identity crosswalk，不声称 Cheshire marginal 数。

页面不同位置曾显示 Rem 384 与 490，且搜索引擎较旧摘要为其他数值；这可能是更新速度或不同统计口径，不应当作稳定总数。MyFigureList 适合成为合作/API 候选，但当前不是可直接复制的长期 connector。

## Good Smile baseline 的效率参照

已有冻结链路的边际是 19 probable prototypes，但原运行没有保存请求总数、发现边、深度或逐请求 provenance，因此不能计算可信的 `marginal/request`。不允许用 41 条除以猜测的请求数。

## 为什么到此停止

再打开商品详情只能增加小样本字段完整度，不能解决权限与持久化门禁。本轮的决策瓶颈已经从“能不能解析 HTML”转为“是否有可授权、可穷举、可持续的 feed/API”。所以没有继续扩大 benchmark 或写 adapter。
