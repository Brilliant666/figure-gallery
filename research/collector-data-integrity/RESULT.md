# Collector data integrity result

## 结论

`PASS`。业务摘要、Japan Figure cursor 分页、单次 live refresh、两次离线 replay、Rem/Cheshire 回归与本地产品验收全部通过。PR #23 的本地合并门禁已满足，仍须以本提交对应的最终 PR CI、mergeable 状态与 review thread 复核作为实际合并前最后门禁。

## 1. 13/13 false changed 的根因

早期运行把来源观察时间等 volatile metadata 带入旧摘要基线；随后摘要算法变化又没有版本和兼容迁移语义。即使 Catalog Item 的业务内容不变，候选摘要仍可能与已保存的旧 digest 不同。数组顺序噪声也是同类风险：相同图片或来源集合若返回顺序变化，不应被视为商品变化。

## 2. 最终修复

新增明确的 `businessDigestVersion = 2`。摘要使用业务字段白名单；排除来源更新时间、抓取/请求时间、runtime 路径、生成时间、first/last seen 以及 pose/grouping 派生字段。tags、ImageRefs、sourceRefs 先去重并稳定排序。比较旧记录时不信任已保存的旧 digest，而是以旧记录现有业务字段重算 v2 摘要；内容一致即记为 `unchanged`，同时静默写回 v2 基线。

旧隐式 v1 → v2 的迁移产生 `0` 个 false change。标题、厂商、比例或有意义的图片集合变化仍会被正确判为真实 `changed`。

## 3. Post-fix refresh 与 replay

唯一一次 post-fix Cheshire live refresh 共 15 个已接受来源请求，结果为：`realNew=0`、`realChanged=0`、`falseChanged=0`、`unchanged=13`。未执行第二次 live refresh。

同一批已捕获响应在隔离 runtime 中离线 replay 两次；两次都是 `new=0 / changed=0 / unchanged=13`，business/result digest 均与 live 结果一致，digest drift 与 result drift 均为 `0`。完整响应仅保存在 Git 忽略的本机临时证据目录，不进入提交。

## 4. Japan Figure 分页

原 Connector 只请求一个 `limit=250` 窗口，确有静默截断风险，也确实会漏掉后续窗口。本轮按真实 UCP 响应字段实现严格 cursor 遍历：读取 `structuredContent.pagination.has_next_page` 和 `cursor`，将 cursor 传入下一请求；只有来源明确返回 `has_next_page=false` 才算完成。

独立 live probe 在第 4 页自然结束：918 raw / 918 unique；相对旧首窗 250 条，观察到额外 668 条。单次完整 refresh 同样第 4 页自然结束：925 raw / 923 unique / 2 个跨页重复。两次都由来源显式结束，未达到 20 页安全上限。same cursor、A→B→A 循环、缺 cursor/schema 会 `ERROR`；到达 safety cap 会 `INCOMPLETE` 并硬失败，不能降级为 warning 或 PASS。

分页补全后仍只有 3 条记录匹配 Cheshire，未新增宽目录、合格姿势或 Prototype。现有 13 wide / 6 eligible / 6 Prototype 不变。

## 5. 双角色回归

- Rem：221 Prototype / 221 cards / 0 ID drift / 0 top-50 drift / 0 membership drift / 0 grouping conflict。
- Cheshire：6 Prototype / 6 cards / 6 covers / 69 ImageRefs / 0 ID、顺序或 fingerprint drift / 0 grouping conflict。
- 系统 Chrome：Rem 快速回归通过；Cheshire 6/6 卡片与封面加载，详情、来源、灯箱、左右键和 Esc 通过，控制台 0 error。

## 6. 验证与合并判断

Node 22.23.1 下 Collector 34/34、Personal Gallery 197/197、Playwright 2/2；source safety 通过；两套生产依赖 high/critical 均为 0；`git diff --check` 通过。Personal Gallery CI 已增加共享 Collector 的离线安装与测试步骤，CI 不会访问来源。

结论：Collector integrity、Japan Figure pagination 与 dual-character pipeline 均为 `PASS`。在最终 PR CI 成功、Head 未变化、PR 可合并且 unresolved review thread 为 0 时，PR #23 可以转 Ready 并 squash merge。

下一步唯一建议：合并后冻结双角色本地流水线基线；ALTER / Fancy Night 继续明确标记为许可与来源覆盖缺口，不再用更多来源请求扩大本任务。
