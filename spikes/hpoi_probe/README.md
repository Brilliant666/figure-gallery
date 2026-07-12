# Hpoi candidate probe

这是 VAL-01 的最小、可丢弃探测代码，不是正式采集器或正式应用。

## 边界

- 只生成候选 JSON 快照，不创建正式角色、手办、版本或厂商数据。
- 默认只读取本地小型 HTML 样本，不自动访问或遍历 Hpoi。
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

这些样本是根据公开页面上可见字段手工缩减的代表性夹具，不是完整网页镜像，也不证明 Hpoi 当前使用相同 HTML 结构。解析器目前只按保守的 Hpoi 媒体域规则过滤图片，尚未用真实 DOM 验证“官图”容器选择器，因此不能把完整页面中发现的每个 `<img>` 自动视为官方候选图。

## 测试

```powershell
python -m unittest discover -s spikes/hpoi_probe/tests -v
```
