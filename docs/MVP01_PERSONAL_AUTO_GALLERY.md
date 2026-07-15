# MVP-01 个人自动手办图库

## 1. 插入 MVP 的目的

PR-01 已建立正式核心目录模型，但来源、候选审核、正式媒体和公共图库仍属于后续 PR-02—PR-08。项目暂时暂停这条长路线，先验证一个更直接的个人使用目标：项目所有者能否在本机输入角色名，以有限、可停止、可重复的方式生成一套用于拍摄参考的私有图片图库。

MVP-01 不是正式产品捷径，也不会把外部数据写入正式 Payload Collection。它验证的是独立采集、内容寻址存储和本地浏览体验；验证完成后仍可整体删除。

## 2. 隔离边界

- 工具位于 `tools/personal-gallery-mvp/`，拥有独立 `package.json` 和 `package-lock.json`。
- 运行数据只写入仓库外运行边界 `.local/personal-gallery/`，该目录由 Git 忽略。
- `apps/web` 不依赖、不导入也不构建本工具；本工具不连接 Payload、PostgreSQL 或 S3。
- 工具不创建或修改正式 Work、Character、Manufacturer、FigurePrototype、FigureVersion、Candidate、Review 或 Media 数据。
- 工具运行时不读取 `research/` 或 `spikes/`。测试 fixture 完全合成，不包含真实 Hpoi 页面或真实手办图片。
- 未来 PR-02 如需接收这些结果，应定义显式、受审查的 manifest 导入器；不得直接依赖本工具源码或运行目录。

## 3. 来源规则和实时门禁

Hpoi 当前只可作为人工参考。其规则对自动程序获取平台服务、内容和数据设有书面许可要求；个人用途不自动构成豁免。`HPOI_LIVE_FETCH_ENABLED=true` 只是技术开关，不代表已经获得授权。

任何真实请求必须同时满足：

1. 项目所有者已经取得并自行确认仍有效的明确书面许可；
2. `HPOI_WRITTEN_PERMISSION_CONFIRMED=true`；
3. `HPOI_LIVE_FETCH_ENABLED=true`；
4. 配置有效的 `FIRECRAWL_API_KEY`；
5. 本次 CLI 或浏览器操作再次进行交互确认。

缺少任一条件时，运行结果必须是 `environment_blocked`，且不得请求 Hpoi 或 Firecrawl。CI 固定关闭实时模式，不读取仓库 Secret，不发起两类请求。

`FIRECRAWL_BASE_URL` 只接受精确的官方 HTTPS Cloud origin `https://api.firecrawl.dev`。HTTP、userinfo、其他 host、额外路径、query 或 fragment 会在 SDK 构造和网络请求前被拒绝，防止 API Key 被错误配置泄露。

即使门禁满足，工具也只允许 Firecrawl v2 的标准 `/scrape`，以及在没有用户提供角色页 URL 时所需的有限 Search。禁止 `/crawl`、Agent、浏览器自动化、Actions、增强代理、位置伪装、Cookie 注入、登录、验证码求解、代理轮换、反检测和全站抓取。

遇到 401、403、429、验证码、登录页、机器人验证、access denied、明确 robots 禁止、来源拒绝、非 allowlist 跳转或连续三个同类访问错误时，当前运行立即停止并保留已成功结果；不得切换代理或尝试规避。

## 4. 安装和配置

需要 Node.js 22.x 与 npm。依赖仅安装在工具目录：

```powershell
cd tools/personal-gallery-mvp
npm ci
Copy-Item .env.example .env
```

`.env` 只保存在本机，不提交。关键配置：

- `FIRECRAWL_API_KEY`：Firecrawl Cloud 密钥；日志不会打印它或 Authorization header。
- `FIRECRAWL_BASE_URL`：默认 `https://api.firecrawl.dev`。
- `PERSONAL_GALLERY_HOST`：只能是 `127.0.0.1`，其他值会拒绝启动。
- HTTP 服务还会拒绝非 `127.0.0.1` Host、跨站 mutation 和非 `application/json` mutation，降低 DNS rebinding 或跨站误触发本地收集的风险。
- `PERSONAL_GALLERY_PORT`：默认 `4317`。
- `PERSONAL_GALLERY_ROOT`：可覆盖运行目录；空值使用仓库 `.local/personal-gallery/`。
- `HPOI_MAX_LIST_PAGES`、`HPOI_MAX_PRODUCTS`、`HPOI_MAX_IMAGES_PER_PRODUCT`：硬上限。
- `HPOI_REQUEST_DELAY_MS`：不得低于 1500 ms。
- `HPOI_REQUEST_CONCURRENCY`：固定为 1。

不要把 `.env`、API Key、Cookie、登录信息或完整页面交给 Git。

## 5. 本地使用

先运行离线测试，再启动只监听 loopback 的服务：

```powershell
npm run test
npm run serve
```

打开 `http://127.0.0.1:4317/`，输入角色名或可选的 Hpoi 角色页 URL。页面会显示来源规则、实时门禁、分页/商品/图片上限、运行进度、停止原因和最近运行。角色名存在多个匹配时必须人工选择，工具不会用 LLM 猜测含糊角色。

取得书面许可并主动打开全部实时门禁后，CLI 运行方式为：

```powershell
npm run collect -- -- --query "柴郡" --confirm-source-permission
```

Windows PowerShell 下第二个 `--` 确保 npm 把后续选项原样交给 CLI；也可以在浏览器勾选本次确认。未满足门禁时，这条命令只报告 `environment_blocked`，不会触网。可以用以下命令查看已有 manifest：

```powershell
npm run status
```

## 6. 本地数据和幂等语义

默认布局：

```text
.local/personal-gallery/
├── .personal-gallery-runtime.json
├── .personal-gallery-collector.lock.json  # 仅收集进行中存在
├── index.json
├── runs/<run-id>/
│   ├── run.json
│   ├── pages.json
│   ├── products.json
│   ├── failures.json
│   ├── parser-warnings.json
│   └── requests.json
├── products/<hpoi-id-or-url-hash>.json
├── objects/sha256/<prefix>/<sha256>.<ext>
├── image-index.json
└── preferences.json
```

商品优先以明确 Hpoi product ID 识别，取不到 ID 时才使用规范化 canonical URL 的 SHA-256。第二次运行更新 `lastSeenAt`；字段摘要相同记为 `unchanged`，变化时记录前后摘要和字段差异，不覆盖历史运行摘要。

图片只接受商品页直接出现且通过 allowlist 的公开 URL。下载后验证 HTTP、magic bytes、MIME、大小和尺寸，再以内容 SHA-256 原子写入。不同 URL 或文件名的同一内容只保存一个对象；商品与图片引用保持多对多。工具不会猜测隐藏原图、改写尺寸参数或绕过防盗链。

同一商品的一批成功图片会合并成一次 `image-index.json`、商品记录和运行快照更新，避免每张图片分别重写这些清单；运行页面仍可在每个商品完成后渐进看到新图片。小型 page/request/failure/warning 数组为保证崩溃后可审计，当前仍按事件做原子整文件替换，这是本地约 100 商品规模下保留的写放大限制。

## 7. 私有图库

图库从运行 manifest 恢复，提供：

- 商品、图片、失败计数和最近采集时间；
- 比例、景品、unknown、other 与厂商过滤；
- 桌面/平板/手机 4/3/2 列，原始宽高比和原生懒加载；
- 灯箱、Esc、当前结果左右切换、首尾边界、滚轮/按钮缩放和 fit/actual size；
- 商品与单图排除/恢复、显示已排除、首选封面和手工备注；
- 来源页面按钮与失败项目列表。

图库没有公共账号、分享、下载按钮、交易或正式发布能力。排除只写 `preferences.json`，不会删除对象；重新收集也不会恢复用户已排除内容。

## 8. 清理

运行数据可能是个人积累，清理命令不会默认删除：

```powershell
npm run clean:runtime
```

必须按命令提示提供由绝对目标路径计算的确认短语。清理还会校验该目录内的目标绑定 marker；marker 缺失、被复制到另一目录或路径不一致时一律拒绝。清理不得递归删除仓库、仓库父目录或仓库内非 `.local/personal-gallery/` 的目录。

## 9. 已知限制

- 未取得书面许可或缺少 Firecrawl 环境时，真实柴郡运行保持 `environment_blocked`；合成 fixture 不能冒充真实图库。
- Hpoi DOM 可能变化；确定性 parser 会保留 `null`、`unknown` 和 `needsReview`，不会猜测缺失字段。
- `unknown` 默认保留以减少漏掉有用动作素材；`other` 默认折叠。
- 第一版只按 SHA-256 做完全相同内容去重，不计算感知哈希。
- Firecrawl 官方 SDK 当前不暴露底层请求的 `AbortSignal`。停止操作会阻止后续请求并保持单任务锁，直到当时唯一一个在途请求结束；该请求仍可能消耗 credit。
- 运行目录使用原子跨进程采集锁，因此服务和 CLI 也不能重叠发起请求。异常退出遗留的锁默认 fail-closed，不做存在竞态的自动回收；项目所有者确认所有收集进程停止后，才能人工清除该明确锁文件。
- 图片请求会在每次请求和跳转前确认 HTTPS、页面发现的 host 以及 DNS 解析结果全部为公网地址，但 DNS 校验与实际 fetch 仍是两个步骤；DNS rebinding 的时序风险留待正式来源适配器用可绑定解析结果的传输消除。
- JSON manifest 面向约 100 个商品的个人规模，不提供数据库事务、多人并发或分布式任务。
- 运行数据没有自动云备份；项目所有者需自行保护 `.local/personal-gallery/`。

## 10. 未来迁移到正式 PR-02

正式路线仍保留 PR-02—PR-08，但当前暂停。恢复 PR-02 时应把本工具视为不可信的外部生产者：先冻结一个版本化、可验证、无二进制内嵌的导入 manifest；再通过正式 CandidateClient/SourceRecord/CandidateRecord/CandidateImage 边界导入候选池。所有字段和图片仍须人工审核，不能直接写正式目录实体、正式媒体或主图。

不得复制本工具的存储、权限或采集实现到 `apps/web`，也不得把 `.local/` 作为正式应用运行时输入。
