# Personal Gallery MVP

这是一个可删除、仅在项目所有者本机运行的角色手办图片收集与浏览工具。它与 `apps/web`、Payload、PostgreSQL、S3 以及正式领域模型完全隔离；运行结果只进入 `.local/personal-gallery/`。

MVP-02 的权威说明见 [`docs/MVP02_CHESHIRE_OFFICIAL_GALLERY.md`](../../docs/MVP02_CHESHIRE_OFFICIAL_GALLERY.md)。MVP-01 的历史边界仍保留在 [`docs/MVP01_PERSONAL_AUTO_GALLERY.md`](../../docs/MVP01_PERSONAL_AUTO_GALLERY.md)。

## 当前来源策略

- Hpoi 实时访问已冻结为 `blocked_by_source`。历史 Hpoi parser 只用于合成 fixture 的离线回归，不得触发网络请求，也不得自动重试。
- MVP-02 仅发现公开的官方厂商或官方发行方商品页。Firecrawl 只使用 Search v2 的 `web` source 和 v2 `scrape`；不使用 crawl、Agent、浏览器动作、增强代理、位置伪装、Cookie、登录或验证码处理。
- Search 明确排除 `hpoi.net` 与 `www.hpoi.net`，并使用柴郡的中、日、英五条固定检索词。搜索结果只有落入代码内 allowlist 的官方商品页才会进入下载流程。
- 搜索可自动进入详情验证的厂商 allowlist 为 `goodsmile.com`、`www.goodsmile.com`、`goodsmilearts.com`、`www.goodsmilearts.com`、`alter-web.jp`、`www.alter-web.jp`、`apex-toys.com`、`www.apex-toys.com`。
- `amiami.jp`、`www.amiami.jp` 只允许作为已经逐页人工确认的发行方 seed；Search 命中不会自动进入详情访问，不能借此扩展到任意 AmiAmi 商品。
- 柴郡默认 seed 仅包含两个搜索漏召回的 Good Smile 商品页，以及三个逐页审核的 AmiAmi 商品页；其中 `FIGURE-188750` 是 APEX `Dating Summer！Ver.` 的同商品发行页。其他域名只记入 `unreviewed-domains.json`，不会自动访问。
- 401、403、429、captcha、登录/机器人验证、robots 拒绝或非 allowlist 跳转会停止当前运行；不会更换代理、伪装身份或绕过访问控制。

打开实时开关不等于获得来源授权。启用者必须自行确认对公开官方商品页的访问权限，并在每次真实运行时作主动确认。

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

然后运行：

```powershell
npm run collect -- --query "柴郡" --confirm-official-source-access
```

也可以从本机首页勾选官方来源确认后启动。缺少 API Key、官方实时开关或本轮交互确认时，命令返回 `environment_blocked`，不会请求外网。可使用 `--seed-official-url <allowlisted-product-url>` 补充已人工确认的 allowlist 商品页；seed 不会扩大域名边界。

同一个运行目录具有跨进程独占采集锁。正常结束会释放锁；若进程异常退出并遗留 `.personal-gallery-collector.lock.json`，工具会保持安全拒绝。只有在人工确认所有 `serve`/`collect` 进程均已停止后，才可删除该锁文件。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 检查依赖、隔离、官方来源策略、合成 fixture 与仓库安全 |
| `npm run test` | 运行带外网 guard 的离线 Node 测试 |
| `npm run test:e2e` | 运行 loopback-only Playwright 图库测试 |
| `npm run validate:chrome:real` | 使用系统 Google Chrome、临时干净 profile 和真实 `.local` 柴郡图库执行本机-only 验收 |
| `npm run serve` | 启动本机首页与私有图库 |
| `npm run collect -- --query "柴郡" --confirm-official-source-access` | 通过门禁后执行一次有限官方来源收集 |
| `npm run status` | 查看本地运行摘要 |
| `npm run clean:runtime` | 显示绑定目标的确认短语；再次明确确认后才删除个人运行目录 |

稳定柴郡图库地址为 `http://127.0.0.1:4317/gallery/characters/cheshire`。图库提供厂商、造型、比例筛选，4/3/2 响应式布局，灯箱、缩放、跨商品左右切换，以及商品/图片排除与恢复。它不提供下载按钮、公共账号或公网部署。

当前本机验收基线为 7 个第一阶段比例手办商品卡片和 62 个本地 SHA-256 图片对象。7 个商品均具有本地图；APEX `Dating Summer！Ver.` 使用逐页审核的 AmiAmi 同商品页公开主图，ALTER 官方页解析到 6 张候选。Hpoi 上的黏土人、可动人偶、盲盒/Q 版、GK、抱枕等条目不计入这 7 个第一阶段商品。

`validate:chrome:real` 不属于 CI：运行前必须已有完整真实图库并启动 loopback 服务。它只接受 Windows 标准路径中的系统 Google Chrome Stable，优先 headed、无法显示窗口时才使用同一 Chrome binary 的 headless 模式；它不使用 bundled Chromium、Edge、ChatGPT Chrome Extension 或用户 profile。验收器在 browser context 层阻断所有非 `127.0.0.1:4317` 请求，临时修改偏好以验证持久性，随后按原始字节恢复偏好并删除临时 profile。默认脱敏结果只写入系统临时目录，不提交 Git。

## 目录和隔离

```text
src/
├── server/       # loopback HTTP 与本地 API
├── collectors/   # 官方搜索、详情与图片顺序编排
├── providers/    # 受限 Firecrawl Search v2 + scrape provider
├── parsers/      # 官方商品页确定性 parser；历史 Hpoi parser 仅供离线回归
├── storage/      # 原子 JSON 与 SHA-256 对象存储
├── gallery/      # 本地图册数据投影
└── cli/          # collect/serve/status/clean-runtime
static/           # 无外部运行时依赖的浏览器 UI
tests/            # 合成 fixtures 与离线测试
```

工具不得导入 `research/`、`spikes/` 或 `apps/web`。正式应用也不得导入本工具。MVP manifest 未来只能通过单独、受审计的正式 PR-02 导入候选池；本工具本身不是 Candidate、Review 或正式媒体实现。

## 数据、幂等与隐私

- 运行数据位于 `.local/personal-gallery/`，商品优先按官方稳定 ID、否则按规范化官方 URL 识别。
- 图片以 SHA-256 内容寻址；同内容不同 URL 只保存一次，写入采用临时文件和原子替换。
- 第二次运行更新 `lastSeenAt` 并记录 `unchanged` 或字段变化，不覆盖历史运行摘要。
- 排除、封面与备注偏好只影响展示，不删除原始对象，也不会被重新收集恢复。
- 运行目录不保存 API Key、Authorization header、Cookie、登录数据或完整浏览器 profile；默认不长期保存 raw HTML。

不要把 `.env`、`.local/`、真实页面、真实图片、截图、视频、完整日志或 API 凭据提交到 Git。
