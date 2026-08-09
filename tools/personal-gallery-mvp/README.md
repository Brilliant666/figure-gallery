# Personal Gallery MVP

这是一个可删除、仅在项目所有者本机运行的角色手办图片收集与浏览工具。它与 `apps/web`、Payload、PostgreSQL、S3 以及正式领域模型完全隔离；运行结果只进入 `.local/personal-gallery/`。

当前产品方向见 [`docs/PROJECT_NORTH_STAR.md`](../../docs/PROJECT_NORTH_STAR.md)，MVP-05 设计与结果见 [`docs/MVP05_HPOI_INDEX_DISCOVERY.md`](../../docs/MVP05_HPOI_INDEX_DISCOVERY.md)。MVP-04 多角色说明和更早来源边界继续作为历史记录保留。

## 当前来源策略

- Hpoi direct 实时访问保持冻结。历史 Hpoi parser 只用于合成 fixture；运行时不得对 Hpoi 发起 GET、HEAD、DNS、scrape、API、图片、favicon 或浏览器导航。
- 默认 MVP-05 pipeline 先通过 Firecrawl Search v2 的 `web` source 执行有界 `site:hpoi.net` 查询，只接收公开搜索索引返回的 Hpoi URL/标题/摘要文本。它不会随后访问 Hpoi；候选、查询和覆盖清单只保存在 `.local`。
- 新目标再通过现有 official resolver 搜索受审的非 Hpoi 来源，并仅对 allowlist 商品页使用 v2 `scrape`。不使用 crawl、Agent、浏览器动作、增强代理、位置伪装、Cookie、登录或验证码处理。
- 搜索可自动进入详情验证的厂商 allowlist 为 `goodsmile.com`、`www.goodsmile.com`、`goodsmilearts.com`、`www.goodsmilearts.com`、`alter-web.jp`、`www.alter-web.jp`、`apex-toys.com`、`www.apex-toys.com`。
- `amiami.jp`、`www.amiami.jp` 只允许作为已经逐页人工确认的发行方 seed；Search 命中不会自动进入详情访问，不能借此扩展到任意 AmiAmi 商品。
- Seed 绑定 `characterId`，不能跨角色生效。柴郡保留既有受审 seed；蕾姆使用独立、逐页审核的官方厂商 seed，未加入 retailer seed。其他域名只进入脱敏覆盖缺口统计，不会自动访问。
- 401、403、429、captcha、登录/机器人验证、robots 拒绝或非 allowlist 跳转会停止当前运行；不会更换代理、伪装身份或绕过访问控制。

打开实时开关不等于获得来源授权。每次真实运行必须分别确认“第三方索引发现”与“受审官方来源访问”；两项确认都不能解除 Hpoi direct 门禁。

## 安装与离线验证

```powershell
cd tools/personal-gallery-mvp
npm ci
Copy-Item .env.example .env
npm run check
npm run test
npm run serve
```

浏览器打开 `http://127.0.0.1:4317/`。服务只绑定 `127.0.0.1`，非 loopback host 会被拒绝。

CI 和普通测试只使用完全合成的官方风格 HTML 与 PNG fixture。Hpoi、Firecrawl 和其他外网请求必须全部为 0；离线测试通过不代表真实柴郡收集已通过。

## 真实运行门禁

在本机 `.env` 中设置（不要提交）：

```dotenv
FIRECRAWL_API_KEY=<runtime-only>
OFFICIAL_SOURCE_LIVE_FETCH_ENABLED=true
HPOI_LIVE_FETCH_ENABLED=false
```

默认索引发现命令为：

```powershell
npm run collect -- --query "柴郡" --confirm-hpoi-index-discovery --confirm-official-source-access
npm run collect -- --query "蕾姆" --confirm-hpoi-index-discovery --confirm-official-source-access
```

索引 Search 默认每 7 秒最多一次，与官方页面/图片请求使用独立节流；遇到 429 立即终止当前运行并保留已有候选，不自动等待后继续、不切换代理。

也可以从本机首页勾选两项确认后启动。缺少 API Key、官方实时开关或任一交互确认时，命令返回 `environment_blocked`，不会请求外网。`--official-only` 保留 MVP-04 broad search 回归路径；它不是默认发现层。可使用 `--seed-official-url <allowlisted-product-url>` 补充已人工确认的 allowlist 商品页，seed 不会扩大域名边界。

同一个运行目录具有跨进程独占采集锁。正常结束会释放锁；若进程异常退出并遗留 `.personal-gallery-collector.lock.json`，工具会保持安全拒绝。只有在人工确认所有 `serve`/`collect` 进程均已停止后，才可删除该锁文件。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 检查依赖、隔离、官方来源策略、合成 fixture 与仓库安全 |
| `npm run test` | 运行带外网 guard 的离线 Node 测试 |
| `npm run test:e2e` | 运行 loopback-only Playwright 图库测试 |
| `npm run validate:chrome:mvp04` | 使用系统 Google Chrome、临时干净 profile 对真实柴郡和蕾姆图库执行 loopback-only 验收 |
| `npm run validate:chrome:mvp05` | 使用系统 Google Chrome 验证双角色图库、覆盖页、详情/灯箱/缩放、4/3/2 与浏览外网请求 0 |
| `npm run serve` | 启动本机首页与私有图库 |
| `npm run collect -- --query "<角色名>" --confirm-hpoi-index-discovery --confirm-official-source-access` | 通过双确认后执行 Hpoi 搜索索引发现与非 Hpoi 官方解析 |
| `npm run status` | 查看本地运行摘要 |
| `npm run clean:runtime` | 显示绑定目标的确认短语；再次明确确认后才删除个人运行目录 |

角色图库统一使用 `http://127.0.0.1:4317/gallery/characters/<slug>`，覆盖观察页使用 `http://127.0.0.1:4317/discovery/<slug>`；当前稳定 slug 为 `cheshire` 与 `rem`。覆盖指标只相对于本次搜索索引候选集，不代表 Hpoi 完整数据库绝对覆盖率。图库提供厂商/类型筛选、4/3/2、详情、灯箱、缩放和排除/恢复，不提供下载按钮、公共账号或公网部署。

当前本机验收基线为柴郡 7 款/65 图和蕾姆 11 款/89 图。蕾姆当前包括 10 款比例手办与 1 款非比例静态完成品，`unknown` 和 `other` 均为 0；每款有图商品均有一张索引封面。图片对象可按 SHA-256 跨角色安全复用，但商品身份、运行历史、排除、封面和备注均带角色上下文。本轮两角色实际没有字节完全相同的复用对象。

`validate:chrome:mvp04` 不属于 CI：运行前必须已有两套真实图库并启动 loopback 服务。它只接受 Windows 标准路径中的系统 Google Chrome Stable，优先 headed、无法显示窗口时才使用同一 Chrome binary 的 headless 模式；它不使用 bundled Chromium、Edge、ChatGPT Chrome Extension 或用户 profile。验收器在 browser context 层阻断所有非 `127.0.0.1:4317` 请求，验证双角色路由和偏好隔离，并删除临时 profile。默认脱敏结果只写入系统临时目录，不提交 Git。

## 目录和隔离

```text
src/
├── characters/   # 角色配置、alias、作品和角色专属 seed
├── discovery/    # Hpoi 搜索索引候选、匹配与 official resolution 纯逻辑
├── server/       # loopback HTTP 与本地 API
├── collectors/   # 官方搜索、详情与图片顺序编排
├── providers/    # Hpoi-index Search-only provider + 受限 official Search/scrape provider
├── parsers/      # 官方商品页确定性 parser；历史 Hpoi parser 仅供离线回归
├── storage/      # 原子 JSON 与 SHA-256 对象存储
├── gallery/      # 本地图册数据投影
└── cli/          # collect/serve/status/clean-runtime
static/           # 无外部运行时依赖的浏览器 UI
tests/            # 合成 fixtures 与离线测试
```

工具不得导入 `research/`、`spikes/` 或 `apps/web`。正式应用也不得导入本工具。MVP manifest 未来只能通过单独、受审计的正式 PR-02 导入候选池；本工具本身不是 Candidate、Review 或正式媒体实现。

## 数据、幂等与隐私

- 运行数据位于 `.local/personal-gallery/`；角色索引和偏好放在 `characters/<slug>/`，商品身份由角色上下文、来源域和官方稳定 ID（或规范化 URL）共同确定。
- 图片以 SHA-256 内容寻址；同内容不同 URL 只保存一次，写入采用临时文件和原子替换。
- 第二次运行更新 `lastSeenAt` 并记录 `unchanged` 或字段变化，不覆盖历史运行摘要。
- 排除、封面与备注偏好只影响展示，不删除原始对象，也不会被重新收集恢复。
- 运行目录不保存 API Key、Authorization header、Cookie、登录数据或完整浏览器 profile；默认不长期保存 raw HTML。

不要把 `.env`、`.local/`、真实页面、真实图片、截图、视频、完整日志或 API 凭据提交到 Git。
