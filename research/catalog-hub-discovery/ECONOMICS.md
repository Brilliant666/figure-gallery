# Catalog Hub 经济模型

## 说明

所有区间都是容量规划假设，不是生产实测。数据量的真实主导成本很可能是 prototype 归并与人工审核，而不是 HTTP 本身。

## 请求模型

历史按角色查询：

```text
Q_hist = R × Σh(alias count × pages + required details)
```

每日按角色查询随角色数线性增长；global ingestion 只随 feed/pages 与 gap connector 数增长。计算细节和机器区间见 [`results.json`](../evidence/catalog-hub-discovery/results.json)。

## Catalog Hub 模型

假设 3 个 Hub、每角色/源约 2 个 alias、每 alias 1–5 页，API/列表响应足够完成第一轮 identity 候选：

| 场景 | requests | wall-clock | paid credits | manual review |
|---|---:|---:|---:|---:|
| 100 角色 historical | 600–3,000 | 0.5–3 h | 0 | 4–83 h |
| 1,000 角色 historical | 6,000–30,000 | 4–20 h | 0 | 42–833 h |
| global daily incremental | 11–85/day | 5–30 min/day | gap 页 5–25 credits/day | 只审核新/变更候选 |

`paid credits=0` 只适用于获授权的自有 API/RSS/direct channel，不包含开发者计划费、合作费或人工；若 gap 页使用 Firecrawl，则估计 150–750 credits/月。

人工区间按每角色 5–25 个 probable candidates、每候选 0.5–2 分钟估算。必须先机器归并 probable prototype 再审核，否则商家重复会放大成本。

## 当前 Firecrawl 按角色 Web Search 模型

假设每角色 3–10 次 Search（Search 约 2 credits/10 results）和 20–100 次 scrape（约 1 credit/page），则 26–120 credits/角色。[Firecrawl 官方价格](https://www.firecrawl.dev/pricing)在检索日列出 Free 1,000、Hobby 5,000、Standard 100,000、Growth 500,000 credits（价格可能变化，应在采购时复核）。

| 场景 | credits | serial wall-clock planning range |
|---|---:|---:|
| 100 角色 | 2,600–12,000 | 50–150 h |
| 1,000 角色 | 26,000–120,000 | 500–1,500 h |

时间区间以用户已观察到的单角色约 1.5 小时为量级敏感性，不是对未来实现的保证。相比 Catalog Hub，按角色 Web Search 同时放大时间、credit 和去重噪声。

## 每日增量对比

假设 3 hubs × 2 aliases × 1 page，则 character-centric daily 是 `6R`：

| 角色数 | character-centric requests/day | 若都用 Search，估计 credits/day | global requests/day |
|---|---:|---:|---:|
| 100 | 600 | 1,200 | 11–85 |
| 1,000 | 6,000 | 12,000 | 11–85 |

因此 daily incremental 在规模化前就应切换到 global ingestion。

## Hub vs 30 个 Maker connector

工程区间基于：maker 16–48 h initial、8–32 h/year；hub 32–80 h initial、16–48 h/year。它们是设计估算，不是报价。

| Strategy | connector count | initial | yearly maintenance | breakage/year |
|---|---:|---:|---:|---:|
| A：30 makers | 30 | 480–1,440 h | 240–960 h | 15–60 |
| B：3 hubs + 5 gaps | 8 | 176–480 h | 88–304 h | 3–13 |

Strategy B 将连接器数减少约 73%，初始和年度工时中值/区间大约节省 63–68%。代价是 Hub 失败的 blast radius 更大，所以必须保存 source snapshot/digest、可回放导出，并至少有两个不同组织的发现来源。

## 投资判断

用下式排序来源：

```text
MPH = marginal in-scope probable prototypes / connector engineering hour
```

Hub 只有在 `PermissionScore` 通过，且 MPH 至少约为中位 maker connector 的 3 倍时才值得承受集中风险。被 403、凭据或保存条款阻塞的来源，其 MPH 不是 0，而是**当前不可计算**。
