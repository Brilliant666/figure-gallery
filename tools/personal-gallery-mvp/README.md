# Personal Gallery MVP

一个可删除、仅本机使用的角色手办图片收集与浏览工具。它与 `apps/web`、Payload、PostgreSQL、S3 及正式领域模型完全隔离；运行结果只进入 `.local/personal-gallery/`。

完整产品与来源边界见 [`docs/MVP01_PERSONAL_AUTO_GALLERY.md`](../../docs/MVP01_PERSONAL_AUTO_GALLERY.md)。

## 安全边界

- 服务只接受 `127.0.0.1`，非 loopback host 会拒绝启动。
- HTTP Host 必须是 `127.0.0.1`；跨站或非 JSON 的状态变更请求会被拒绝。
- 实时访问默认关闭；打开开关不等于取得来源授权。
- 真实请求要求书面许可确认、实时开关、Firecrawl API Key 和每次交互确认同时成立。
- Firecrawl Cloud 地址严格固定为 `https://api.firecrawl.dev`；HTTP、凭据、额外路径、查询参数或其他 host 会在 SDK 构造前被拒绝。
- Firecrawl 只使用 v2 `scrape`，以及角色页发现所需的有限 Search；不使用 crawl、Agent、浏览器动作、代理、Cookie 或登录。
- 401、403、429、captcha、登录/机器人验证、robots 拒绝、非 allowlist 跳转会停止当前运行。
- CI 和测试只使用完全合成 fixture，Hpoi 与 Firecrawl 请求数固定为 0。

## 开始

```powershell
cd tools/personal-gallery-mvp
npm ci
Copy-Item .env.example .env
npm run test
npm run serve
```

浏览器打开 `http://127.0.0.1:4317/`。

确认已经取得并仍持有明确书面许可后，设置 `.env` 的四项运行门禁，再执行：

```powershell
npm run collect -- -- --query "柴郡" --confirm-source-permission
```

缺少门禁时命令返回 `environment_blocked`，不会访问网络。

同一个运行目录具有跨进程独占采集锁：浏览器服务与 CLI、或两个 CLI 不能同时创建 Firecrawl Provider。正常结束会释放锁；若进程异常退出并遗留 `.personal-gallery-collector.lock.json`，系统会安全地保持拒绝状态。只有在人工确认所有 `serve`/`collect` 进程均已停止后，才可删除这一个明确的锁文件；工具不会自动猜测或回收它。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run test` | 带外网 guard 的离线 Node 测试 |
| `npm run test:e2e` | loopback-only Playwright 图库测试 |
| `npm run check` | 依赖、隔离、fixture 与仓库安全检查 |
| `npm run serve` | 启动本机首页与私有图库 |
| `npm run collect -- -- --query "柴郡" --confirm-source-permission` | 通过全部门禁后执行一次有限收集；第二个 `--` 用于 PowerShell/npm 参数透传 |
| `npm run status` | 查看本地运行摘要 |
| `npm run clean:runtime` | 显示目标绑定确认短语；仅在 marker 与绝对路径一致并再次确认后删除个人运行目录 |

## 目录

```text
src/
├── server/       # loopback HTTP 与本地 API
├── collectors/   # 顺序发现、详情与图片编排
├── providers/    # 受限 Firecrawl v2 provider
├── parsers/      # 确定性 Hpoi HTML parser
├── storage/      # 原子 JSON 与 SHA-256 对象存储
├── gallery/      # 本地图册数据投影
└── cli/          # collect/serve/status/clean-runtime
static/           # 无外部依赖的浏览器 UI
tests/            # 合成 fixtures 与离线测试
```

工具不得导入 `research/`、`spikes/` 或 `apps/web`。正式应用也不得导入本工具。

## 数据和隐私

运行目录不会保存 API Key、Authorization header、Cookie、登录数据或完整浏览器 profile。默认不长期保存 raw HTML。图片以 SHA-256 内容寻址，写入使用临时文件加原子替换；偏好只影响展示，不删除原始对象。

不要把 `.env`、`.local/`、真实页面、图片、截图、视频或运行日志提交到 Git。
