# Rem Prototype 最终审计决策

审计日期：2026-08-10
基线：PR #21 head `4bd43506733830f8fe388fc60f16b9ca155242e2`

## 产品结论

当前 Rem Prototype Gallery 的 231 张卡中仍有 7 个确认的 false-split 归并组，涉及 17 张卡。它们由 2 组纯异色、1 组再版、1 组渠道版本、2 组重复 listing 和 1 组小配件差异构成。若全部接受，当前 231 张卡应减少 10 张，Rem v1 独立摄影姿势基线为 **221**。

35 个自动候选 pair 已全部人工看图：11 条关系支持同姿势、24 条确认不同、0 条不确定。231/231 张卡也已完整快速浏览；整页扫描额外发现的唯一自动漏候选是 BiCute Bunnies base，它已纳入 Blue / White Pearl 的同雕异色组。

本轮只输出 proposal，当前 Projection 和 Gallery 仍保持 231 张卡。下一步唯一建议是：**由项目所有者审阅 7 个 proposal 后，在独立产品任务中一次性应用，并同时迁移 prototypeId 关联的排除、备注和人工封面偏好。**

## 排序结论

- 当前实际排序是 `prototypeId ASC`，没有 secondary key；它只是成员 hash 的确定性顺序，没有用户可理解的产品语义。
- 当前真实 popularity 信号为 0，任何现有顺序都不能称为“热门”。
- 第一版默认建议使用“推荐（参考资料完整度）”，只依据封面、图片覆盖、来源置信/多样性和未来人工 featured；不得冒充热门。
- 当前 `release` 稀疏、`published_at` 来源语义不统一、`first_seen` 是一次性回填，尚不足以可靠提供 Latest。
- 上线后形成真实热门至少需要去重持久化的 `detail_open` 和 `favorite`；`lightbox_open` 可作次级信号，单独 impression 不足以排序。

## 决策边界

本审计未应用任何 merge，未重新生成 Prototype Projection，未改变 personal gallery，也未实现推荐、热门或最新排序。所有审计产物均可删除；现有 231 Prototype 结果可独立运行。
