# Hpoi candidate probe

这是 VAL-01 的最小、可丢弃探测代码，不是正式采集器或正式应用。

> **停止提示（VAL-01B，2026-07-14）**：Hpoi 公开用户协议要求自动程序/脚本获取平台服务、内容或数据前取得事先明确书面许可。项目目前没有记录该许可，因此不得运行真实 Hpoi 请求。`transport_probe.py request` 默认拒绝联网；只有项目所有者已经取得并记录书面许可后，才可显式确认继续。

## 边界

- 只生成候选 JSON 快照，不创建正式角色、手办、版本或厂商数据。
- 默认只读取本地小型 HTML 样本，不自动访问或遍历 Hpoi；真实传输 CLI 还要求显式确认已记录站点书面许可。
- 唯一键优先使用 `source_type + source_item_id`；缺少稳定 ID 时才使用规范化 URL。
- 后续发现稳定 ID 时会把同 URL 的 fallback 键迁移到 ID 键，不会把它再次识别为新商品。
- 重复输入会报告 `unchanged`，字段或图片变化会报告字段级差异。
- 图片指纹记录使用 SHA-256 和 64 位 aHash 区分“相同字节”“重编码后感知相同”“同 URL 内容改变”；aHash 只作候选信号，不作版权或绝对身份结论。
- 图片函数只处理调用者明确给出的单个 URL，默认仅允许 `rfx.hpoi.net`，限制为 1 MB/2000 万像素，不发送 Cookie、Token 或登录信息，也不继承系统/环境代理。
- 没有初始化 Django、Payload、Next.js、Directus、Strapi 或其他应用框架。

## 环境与依赖

- Python 3.10+
- 核心候选快照与 HTML 解析仅使用 Python 标准库。
- 图片尺寸、格式和 64 位感知平均哈希（aHash）需要 Pillow；见 `requirements.txt`。
- VAL-01B 的可丢弃真实传输门禁使用 requests；它显式关闭环境代理和自动重试，不读取浏览器状态。

## 运行

以下命令把状态写到系统临时目录，避免把运行态文件误当作正式数据：

```powershell
python spikes/hpoi_probe/probe.py `
  --input spikes/hpoi_probe/samples/representative_item.html `
  --state "$env:TEMP/figure-gallery-val-01-snapshot.json" `
  --source-url "https://www.hpoi.net/hobby/98369" `
  --collected-at "2026-07-12T00:00:00+00:00"
```

再次运行同一命令应报告 `unchanged`。把 `--input` 换成
`samples/representative_item_changed.html` 会报告发售日期、候选图片和原始片段哈希变化。

`representative_item*.html` 是 VAL-01 根据公开页面可见字段手工缩减的代表性夹具。`real_item_*_sanitized.html` 是 VAL-01B 在触发公开规则停止条件前取得的两个真实响应的小型脱敏结构摘录；它们不是完整网页镜像。解析器已验证当前 `.hpoi-infoList-item` 与嵌套 JSON-LD Product 结构，并排除 Hpoi 静态资源路径，但 `/gk/pic/` 仍可能混合官图和用户图，因此不能把发现的每个媒体 URL 自动视为官方候选图。

## VAL-01B 传输门禁脚本

`transport_probe.py` 提供持久请求上限、至少 2 秒间隔、手工重定向、固定 User-Agent、Content-Type/大小限制，以及 direct/显式本地代理隔离。输出与响应体只允许写入系统临时目录。它是可丢弃诊断工具，不是采集器。

没有书面许可时，只能运行离线测试和预算查看；真实请求会在联网前被拒绝。若项目所有者以后取得并记录 Hpoi 的书面许可，新的独立任务可在确认许可范围后使用：

```powershell
python spikes/hpoi_probe/transport_probe.py init-budget `
  --budget-state "$env:TEMP/figure-gallery-hpoi-budget.json"

python spikes/hpoi_probe/transport_probe.py request `
  --written-permission-confirmed `
  --budget-state "$env:TEMP/figure-gallery-hpoi-budget.json" `
  --result "$env:TEMP/figure-gallery-hpoi-result.json" `
  --body-output "$env:TEMP/figure-gallery-hpoi-body.html" `
  --client requests `
  --kind html `
  --url "https://www.hpoi.net/hobby/80002"
```

默认不使用代理；只有许可范围和新任务同时允许时，才可显式增加 `--proxy http://127.0.0.1:7897`。不得传入 Cookie、Token、登录态或其他代理地址。

## 测试

```powershell
python -m unittest discover -s spikes/hpoi_probe/tests -v
```
