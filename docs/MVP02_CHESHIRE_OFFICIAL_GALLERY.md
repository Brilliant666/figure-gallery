# MVP-02 柴郡官方来源私有图库

## 1. 目标和当前状态

MVP-02 的唯一产品目标，是让项目所有者在本机生成第一版可直接辅助拍摄的柴郡私有手办图库。它延续 MVP-01 的本地 JSON manifest、SHA-256 内容寻址对象和 loopback 图库，但把实时发现来源从已阻塞的 Hpoi 切换为受限的公开厂商官方网页。

本文定义实现、真实运行和验收边界。真实官方来源运行、幂等和本地图库结果记录在小型脱敏证据中；合成 fixture 只能证明离线代码路径，不能替代真实运行或真实 Chrome 验收。

基线为 PR #11 merge commit `65231c0187cf49c7a2f4ea1c722bf16dc1d11133`。工作分支为 `feat/mvp-02-cheshire-official-gallery`。MVP-02 仍是可删除的独立个人工具，不是正式 Payload 来源、候选、审核或媒体实现。

## 2. Hpoi 冻结状态

已有三轮 Hpoi 实时尝试均被 captcha 阻塞，基线状态固定为：

```text
hpoiLiveStatus=blocked_by_source
stopReason=captcha
retryAllowed=false
consecutiveBlockedRuns=3
```

`blockedAt` 必须使用历史运行实际时间；不得在文档或证据中推测。MVP-02：

- 不再请求 Hpoi 及其子域名；
- 不访问缓存页、镜像或替代域名；
- 不自动重新尝试，也不等待 captcha 条件变化；
- 不使用 Cookie、账号、代理轮换、增强代理、浏览器动作或反检测；
- 保留 Hpoi parser 与历史离线回归测试，但实时 adapter 保持禁用；
- 只展示历史阻塞摘要，不把 Hpoi 阻塞描述为整个工具失败。

MVP-02 的 Hpoi 请求必须为 0；任何 Hpoi 请求尝试都是门禁失败。

## 3. Official sources 模式

`OfficialWebSearchProvider` 使用 Firecrawl Cloud v2 的 Search 和 `scrape`。它不使用 crawl、Agent、Browser、Actions、enhanced proxy、location spoofing、Cookie 注入、登录或验证码求解。

Search v2 固定使用：

- `sources: ["web"]`；
- `excludeDomains: ["hpoi.net", "www.hpoi.net"]`；
- 每查询最多 10 个结果；
- 中、日、英多语言查询；
- 搜索候选只做发现，必须经过 URL 和页面真实性校验。

柴郡发现查询至少包括：

```text
"Azur Lane" Cheshire figure
"Azur Lane" Cheshire scale figure
アズールレーン チェシャー フィギュア
碧蓝航线 柴郡 手办
碧蓝航线 柴郡 比例手办
```

搜索可自动进入详情验证的厂商 allowlist 仅包含：

- `goodsmile.com`、`www.goodsmile.com`；
- `goodsmilearts.com`、`www.goodsmilearts.com`；
- `alter-web.jp`、`www.alter-web.jp`；
- `apex-toys.com`、`www.apex-toys.com`。

`amiami.jp`、`www.amiami.jp` 是 seed-only 发行方域名：只有任务中已经逐页人工审核的明确商品 URL 可以访问，Search 命中不会自动进入详情访问。搜索命中其他域名时只记为 `unreviewedDomain`，不得访问详情、下载图片或自动扩充 allowlist。厂商或发行方页面返回的图片 host 只有在具体商品页直接列出 URL 后，才可作为该父页面本次图片候选；不得按 URL 规律构造资源。

柴郡默认受审 seed 只包含搜索漏召回的 Good Smile `Summery Date!`、`Cait Sith Crooner`、APEX `Dating Summer！Ver.`，以及两个明确的 AmiAmi×AniGame 商品页。它们不能硬编码成伪搜索结果；使用 seed URL 必须记录 `discoveryMethod=seed_official_url`，Search 发现记录 `firecrawl_search`。任何新增 seed 都需要独立逐页审核，不能从发行方域名自动枚举。

## 4. 官方商品页真实性

页面同时通过下列规则后才能进入商品候选：

1. URL 使用 HTTPS，host 在 allowlist，且不是登录、购物车、搜索、新闻聚合、社区或用户内容路径；
2. 标题或商品正文明确出现 Cheshire、チェシャー或柴郡；
3. 作品明确是 Azur Lane、アズールレーン或碧蓝航线；
4. 厂商、规格、官方商品描述三类证据中至少存在两类；
5. 柴郡不是只出现在“相关产品”区域；
6. 最终跳转仍处于允许的官方商品域名。

不能确认的字段保存为 `null`、`unknown` 或 review warning，不得猜测。页面拒绝、captcha、登录、robots 禁止、401、403、429 或非 allowlist 跳转必须停止对应访问；不得换代理或规避。

## 5. 商品记录和身份

MVP-02 商品记录至少包含：

- `sourceKind`：`official_manufacturer` 或 `official_distributor`；
- `sourceDomain`、`sourceUrl`；
- `discoveryQuery`、`discoveryMethod`；
- `officialProductId`；
- `title`、`character`、`series`；
- `manufacturer`、`distributor`；
- `scale`、`height`、`releaseDate`、`price`；
- `sculptor`、`paintwork`、`description`；
- `imageUrls`；
- `parserVersion`、`lastSeenAt`、`fieldDigest`。

商品身份依次使用：

1. 官方页面明确产品 ID，并以来源域名命名空间隔离；
2. 官方 canonical URL；
3. 规范化官方 URL 的 SHA-256。

Hpoi-specific ID 不再是官方来源商品的身份要求。发现查询、发现方式和观察时间属于溯源信息；它们不能让业务字段不变的商品误报为 `changed`。

## 6. 类型过滤

默认拍摄参考视图保留比例手办、静态完成品、景品和 `unknown`。只有页面证据明确时，Nendoroid、黏土人、可动人偶、盲盒、抱枕、周边和非实体商品才归为 `other` 并默认折叠。无法确定时保留为 `unknown`，避免错误漏掉可用造型。

发现 Nendoroid Cheshire 可以保留审计记录，但不能默认出现在拍摄参考主视图。

## 7. 官方图片边界

每个商品最多处理 10 张详情页直接公开展示的官方样品图：

- 优先商品轮播或明确 product gallery；
- 排除 logo、favicon、头像、支付图标、广告、推荐商品和用户实拍；
- 不用页面截图代替商品图片；
- 不修改参数猜测隐藏大图；
- 每次请求与跳转均验证父商品页关联、允许 host 和公网地址；
- 验证 HTTP、magic bytes、MIME、大小和尺寸；
- 计算 SHA-256 后原子写入内容寻址目录；
- 相同内容跨 URL 或商品只保存一个对象，同时保留多对多引用；
- 单张图片失败不得抹去已成功商品或图片。

图库浏览器只读取 `/media/<sha256>` 的本地对象，不热链官方站点。

## 8. 本地数据、历史和幂等

运行数据仍只写入 `.local/personal-gallery/`。每轮使用独立 run ID，保存运行、页面/请求、商品快照、失败和 warning；旧 run 不被后续商品全局记录漂移覆盖。

使用完全相同的五组查询、allowlist 和限额执行第二轮：

- 重复商品新增 0；
- 相同图片对象新增 0；
- 未变商品为 `unchanged`；
- 真实变化为 `changed` 并保留字段差异；
- 第一轮 run manifest 不覆盖；
- 排除、备注与首选封面保持。

首轮或第二轮的真实 manifest、页面、图片和完整日志不得提交 Git。

## 9. 限额和执行方式

默认限制：

- 五组多语言查询，每查询最多 10 个 Search 结果；
- 合并后最多 20 个候选 URL；
- 最多解析 20 个真实商品；
- 详情与图片顺序处理，并发 1；
- 官方请求间隔至少 1000 ms；
- 每商品最多 10 张图片；
- 单请求最多重试 2 次，拒绝类错误不重试。

安装和离线检查：

```powershell
cd tools/personal-gallery-mvp
npm ci
Copy-Item .env.example .env
npm run check
npm run test
npm run test:e2e
```

本机 `.env` 中必须提供有效 `FIRECRAWL_API_KEY`，并由项目所有者主动设置 `OFFICIAL_SOURCE_LIVE_FETCH_ENABLED=true`。启动服务：

```powershell
npm run serve
```

浏览器打开 `http://127.0.0.1:4317/`，确认 Official sources 提示后主动启动。CLI 使用独立确认选项：

```powershell
node src/cli/collect.js --query "柴郡" --confirm-official-source-access
```

缺少实时开关、Key 或本次确认时只能返回阻塞状态，不得触网。API Key、Authorization header 和 Firecrawl 内部请求头不得打印或写入 manifest。

最初的真实结果由五组中、日、英查询自动发现 Good Smile 与 ALTER 各一个商品。覆盖补齐后，同样的五组查询与 5 个受审 seed 共同形成 7 个第一阶段静态/比例手办条目：Good Smile 3 个、ALTER 1 个、APEX 1 个、AmiAmi×AniGame 2 个。最终同配置两轮均解析 7 个商品；第二轮新增商品 0、对象 0，7 个商品全部为 `unchanged`。

最终安全加固继续使用经过公网 DNS 校验并绑定解析地址的 HTTPS 图片传输。本地图库保留 56 个字节不同的 SHA-256 图片对象，6 个商品具有本地图。APEX 商品页明确列出的 3 个商品图 URL 实际均返回 HTTP 404，因此商品卡片保留、失败可见，但不猜测替代地址、不修改参数也不绕过；最终幂等轮稳定复现这 3 个失败且不产生半成品对象。历史 Good Smile JPEG/WebP 字节表示仍按 SHA-256 分别保留；跨格式感知去重不属于 MVP-02。请求计数、credits、run ID 与浏览器门禁状态以脱敏证据 JSON 为准；真实页面、图片、manifest 和完整日志只保留在 Git 忽略的 `.local/` 中。

## 10. 私有图库验收

稳定路径：

`http://127.0.0.1:4317/gallery/characters/cheshire`

页面展示柴郡、`Official sources`、`Blocked by captcha` 历史状态、官方商品/图片计数，并提供厂商、造型和比例筛选。商品卡片显示标题、厂商、比例、发售时间、来源域名与“官方商品页”标记；只有项目所有者主动点击时才打开来源链接。

图库继续支持 4/3/2 响应式列、原始比例、懒加载、灯箱、fit/actual、缩放、Esc、当前结果左右切换、排除/恢复、首选封面和备注。浏览器会话只能请求 loopback，图片必须来自本地对象。

覆盖补齐的当前验收标准为：同一真实运行清单包含 7 个受审第一阶段商品、至少 6 个有本地图的商品、所有已保存对象通过 SHA-256 和本地读取校验，并完成真实 Chrome loopback-only 验收。来源图片缺失或失效必须按真实结果报告，不能用合成图补数。

MVP02-11 的权威定义是：**系统安装的 Google Chrome Stable 使用临时、独立、干净的 profile 加载真实本地柴郡图库；真实商品、真实本地对象、交互、偏好持久性、响应式布局和 loopback-only 网络全部通过。** 本机验收器位于 `scripts/validate-real-system-chrome.mjs`，从两个标准 Windows 安装路径定位 Google Chrome，并拒绝 bundled Chromium、Edge 和用户 profile。它不安装或加载扩展，不读取 Cookie、历史记录、密码或登录状态；结束时必须按原始字节恢复 `preferences.json` 并删除临时 profile。

ChatGPT Chrome Extension、Chrome Profile 8、Chrome Profile 5、任何用户日常 profile 和 Codex 扩展控制通道都不是此门禁的要求。合成 Playwright fixture 只能作为离线回归，不能代替真实 `.local/personal-gallery/` 数据或系统 Chrome。真实验收只允许访问 `127.0.0.1:4317`；context 观察到任何外网 HTTP/HTTPS/WebSocket 请求、热链图片、损坏对象或偏好未恢复时，MVP02-11 必须失败。

2026-07-23 的本机验收使用系统 Google Chrome `150.0.7871.129` headed 模式和一次性空白 profile：7 个商品卡片、56 个本地对象均成功显示，56/56 媒体路由返回 HTTP 200，外网请求为 0；4/3/2、灯箱、fit/actual、缩放、左右及跨商品切换、首尾边界、Esc、图片排除/恢复、封面和备注持久化全部通过。验收后原偏好字节一致，扩展、截图、视频和 trace 均为 0，临时 profile 已删除。

## 11. 离线 CI

CI 永远设置 Hpoi 和官方来源实时开关为 `false`，不使用 Repository Secrets，也不执行真实 Search、scrape 或图片下载。它只使用明确标注 synthetic 的小型 fixture：Good Smile 风格、ALTER 风格、错误的相关商品、Nendoroid/other 和缺失字段页面，以及运行时动态生成的合成图片。

离线门禁覆盖：

- 五组查询构造；
- Search v2 `sources=["web"]` 和 Hpoi `excludeDomains`；
- 官方域名 allowlist 与 `unreviewedDomain`；
- 官方页面真实性；
- Good Smile 与 ALTER 确定性解析；
- 商品与图片去重、历史 run 快照；
- Hpoi、Firecrawl 与官方外网请求均为 0；
- loopback-only 图库、两张合成商品卡片和六张合成图片；
- 灯箱、跨商品切换、缩放、4/3/2、偏好持久化。

离线 CI 的 `pass` 只代表合成门禁通过；`mvp02OverallStatus` 和真实运行仍应保持 `not_run`，直到真实证据完成。

## 12. MVP02-01—MVP02-12

| 门禁 | 证明内容 |
| --- | --- |
| MVP02-01 | Hpoi 固化为 `blocked_by_source`、captcha、禁止重试；本任务 Hpoi 请求 0 |
| MVP02-02 | Firecrawl Search v2 明确排除 `hpoi.net` 与 `www.hpoi.net`，不使用禁用模式 |
| MVP02-03 | 详情只访问受审厂商 allowlist 和明确 seed-only 发行方页面，其他域名只记 `unreviewedDomain` |
| MVP02-04 | 中、日、英五组查询均执行并可审计 |
| MVP02-05 | 角色、作品、官方证据和页面类型真实性校验通过 |
| MVP02-06 | Good Smile、ALTER、APEX 与 AmiAmi 商品字段确定性解析通过 |
| MVP02-07 | 公开商品图下载、验证与本地读取通过；APEX 的 3 个 HTTP 404 如实保留为失败 |
| MVP02-08 | 商品身份、SHA-256 内容去重和历史 run 隔离通过 |
| MVP02-09 | 同一真实运行清单达到 7 个第一阶段商品、6 个有图商品和 56 个本地对象 |
| MVP02-10 | 相同配置第二轮新增商品/对象为 0，7 个商品均 unchanged，偏好保持 |
| MVP02-11 | 系统 Google Chrome Stable 以临时干净 profile 对 7 个卡片、56 个本地对象完成交互、偏好恢复和 loopback-only 网络验收；不依赖扩展、用户 profile 或 bundled Chromium |
| MVP02-12 | `.local/`、Key、真实页面/图片/manifest 与正式 Payload 完全隔离 |

全部 12 项通过后，MVP-02 才能声明 `pass`。当前状态必须以 [`research/evidence/mvp02/personal-gallery-results.json`](../research/evidence/mvp02/personal-gallery-results.json) 为准；未执行项写 `not_run`，不得用离线 fixture 冒充真实结果。

## 13. 停止和后续边界

MVP-02 柴郡覆盖补齐后继续作为本机个人拍摄工具使用。当前收录 7 个第一阶段静态/比例手办商品卡片和 56 个字节不同的图片对象；Hpoi 的 9+ 结果还包含黏土人、可动、盲盒/Q 版、GK、抱枕及不同角色等非第一阶段条目，不能直接等同于本工具目标数。当前只做 SHA-256 精确去重，没有感知去重；APEX 的 3 个公开图片 URL 仍为 HTTP 404 缺口。Hpoi 继续因 captcha 停用，本轮 Hpoi 请求为 0。

达到真实首轮、第二轮幂等、真实浏览器、PR 合并与干净工作区停止条件后立即停止。不得继续增加 allowlist、搜索 query、第二角色、感知哈希、正式 Candidate/Review/Media、正式 PR-02、Payload 导入、原画图库、公开部署或 Hpoi 绕过。

未来恢复正式 PR-02 时，个人工具 manifest 仍是不可信外部输入；必须通过受限 CandidateClient 和人工审核进入候选池，不能直接写 Work、Character、Manufacturer、FigurePrototype、FigureVersion、正式媒体或主图。不得把本工具源码或 `.local/` 变成正式 Payload 运行时依赖。
