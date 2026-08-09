# MVP-04 多角色图库泛化

## 为什么现在验证第二角色

MVP-03A 已证明柴郡可以按“一款商品一张封面、详情页全部图片”的方式服务拍摄参考，但旧实现仍可能把柴郡名称、路径、搜索词、seed 或偏好当成程序默认。MVP-04 选择名称歧义更高、商品规模更大的蕾姆作为第二角色，用真实数据验证 personal gallery 是可复用工具，而不是复制出来的第二套页面。

本轮只修改隔离目录 `tools/personal-gallery-mvp/` 及其文档、离线 CI 和脱敏证据。没有写入正式 Payload、PostgreSQL 或 S3，也没有开始正式 PR-02。

## 角色配置与匹配

角色配置包含稳定 `characterId`、ASCII `slug`、显示名、alias、作品名、产品词、冲突 alias、确定性搜索词和逐页审核 seed。柴郡与蕾姆使用同一 schema；柴郡原有五条中/日/英搜索词被保留为配置数据，不再是通用程序入口。

蕾姆配置覆盖 `蕾姆`、`雷姆`、`Rem`、`レム`，以及 Re:Zero 的中、日、英作品名。搜索矩阵先保证每个 alias、作品名和产品词至少出现一次，再按固定顺序组合，硬上限为 30。英文匹配使用词边界；页面必须同时存在蕾姆角色证据、Re:Zero 作品证据、实体手办证据和受信来源信息。`Ram`、`ラム`、`拉姆` 是显式冲突项；软件中的普通 `rem`、周边、服装、抱枕、卡牌、黏土人、可动、盲盒、Q 版和 GK 不会进入拍摄参考主视图。

## 来源发现与边界

Firecrawl 仍只使用 Search v2 `web` 和 v2 `scrape`；Search 明确排除 Hpoi。详情页只允许既有官方 allowlist，未审核搜索域只记录脱敏数量，不访问、不下载。角色 seed 必须记录 `characterId`、URL、来源类型、审核理由和审核日期，并且不能跨角色生效。

首次较宽搜索尝试在第 11 次物理 Search 请求遇到 HTTP 429 后立即停止：未重试、未切换代理、未执行 Scrape，也没有产生商品。随后逐页人工确认了 11 个属于蕾姆、Re:Zero 且位于既有 Good Smile/ALTER 官方域的商品页，作为蕾姆专属厂商 seed；没有加入 retailer seed，也没有新增官方域名。最终稳定运行每轮只使用 1 次有限 Search 和 11 次 Scrape，请求并发为 1，页面请求间隔 7000 ms，图片请求间隔 1000 ms。Hpoi 请求始终为 0。

## 存储、身份与偏好

角色索引与偏好位于：

```text
.local/personal-gallery/
├── characters/
│   ├── cheshire/
│   │   ├── config.json
│   │   ├── index.json
│   │   └── preferences.json
│   └── rem/
│       ├── config.json
│       ├── index.json
│       └── preferences.json
├── products/
├── objects/sha256/
├── runs/
└── coverage/
```

商品 key 包含角色上下文、来源域和来源稳定 ID；没有稳定 ID 时才使用规范化 URL。两个角色可以安全共享同一个 SHA-256 内容对象，但商品关系不会合并。排除商品、排除图片、人工封面和备注都按角色隔离。旧柴郡根级偏好只会迁移到匹配的遗留角色；迁移可重复执行且不改变 7 款、65 图或封面结果。

## 路由和界面

首页列出已有角色，也允许确认名称、alias 和作品后建立本地角色配置。所有角色复用以下路由和同一 renderer：

```text
/gallery/characters/<character-slug>
/gallery/characters/<character-slug>/products/<product-id>
```

角色首页每个商品只渲染一张封面，详情页才展示全部图片。筛选项从实际数据生成，当前蕾姆图库显示“比例手办”和“静态完成品”，不显示不存在的 `unknown`。封面选择、排除和备注刷新后保持，并且不会影响另一个角色。

## 蕾姆真实结果

最终本地图库包含 11 个符合首期拍摄参考范围的真实商品、89 张本地图、7 个厂商，超过本轮 8 商品、30 图片、4 厂商目标。分类为 10 个 `likely_scale`、1 个 `likely_static`、0 个 `likely_prize`、0 个 `unknown`、0 个 `other`。每个商品都有封面；系统 Chrome 验收后为 10 个自动封面、1 个人工封面。

初次导入新增 11 个商品和 89 个 SHA-256 对象。分类与比例 parser 稳定后，最终相同配置复跑新增商品 0、新增对象 0、`unchanged=11`、`changed=0`，89 次图片获取全部命中既有内容对象；运行历史与人工封面均保留。

这不是蕾姆完整商品目录。较宽的纯 Search 发现受到 HTTP 429 限制，未审核的第三方结果没有被访问；当前覆盖仅代表安全边界内逐页确认的官方样本。聚合缺口保存在未跟踪的 `coverage/rem.json`，Git 证据不包含 URL 清单。

## 柴郡回归

柴郡仍为 7 个商品、65 张图片、7 张封面，分类仍为 7 个比例手办。5 个人工封面和 2 个自动封面保持，详情页与偏好正常。两个角色合计 154 个 SHA-256 对象；当前跨角色字节完全相同对象为 0，但共享对象存储及隔离关系已由合成测试覆盖。

## 验收

离线测试包含两个完全合成角色：Character A 为 7 商品/56 图，Character B 为 10 商品/40 图，并覆盖同标题不同角色、共享 SHA 对象、路由、存储、偏好、筛选和网络隔离。

系统 Google Chrome Stable 使用临时干净 profile 验证真实柴郡与蕾姆图库：主页双角色、不同路由、4/3/2 响应式列、蕾姆一款一封面、详情、灯箱、缩放、筛选、人工封面刷新保持，以及返回柴郡后封面不变。浏览阶段外网请求为 0；没有保存截图、视频或 trace。权威脱敏摘要见 [`research/evidence/mvp04/multi-character-results.json`](../research/evidence/mvp04/multi-character-results.json)。

## 尚未完成

MVP-04 没有做 pHash、dHash 或 JPEG/WebP 视觉合并；字节不同但视觉相似的图片仍可同时保留。它没有把任一角色导入正式 Payload，没有实现 Candidate/Review/正式 Media，没有部署，也没有开始第三角色或正式 PR-02。
