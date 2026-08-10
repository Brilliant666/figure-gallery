# Cheshire pipeline generalization result

## 结论

`PASS`。同一条 profile 驱动的本地链路完成了柴郡的三源发现、共享姿势过滤、Catalog Item 归一、text-first grouping、稳定 Prototype 身份、推荐排序和现有 Personal Gallery 展示；没有新增 Cheshire 专用 builder、Gallery 页面或运行时分支。冻结的 Rem v1 仍为 221 个 Prototype，ID、前 50 推荐顺序和冲突数均零漂移。

## 结果

- 柴郡宽目录：13 条；姿势合格及 Projection eligible：6 条；排除 7 条，其中 Deformed/Q 5 条、Nendoroid 2 条。
- 最终独立姿势：6 个；6 个 singleton，0 个 multi-item，最大组 1，未折叠 Catalog Item，冲突 0。
- Gallery：6 张卡、6 张封面、69 个 ImageRef。来源为 Good Smile 28、Solaris 40、Japan Figure 1、unknown 0。
- 旧基线：7 条；exact overlap 3、probable overlap 2，总交集 5；相对旧基线新增覆盖 1 条 Collector-only，同时有 2 条 old-only，所以不是净扩容。
- 两条 old-only 分别是 ALTER 造型与 Fancy Night/AmiAmi 造型，均因当前三源未发现而归为 `source_gap`；旧数据没有被静默丢弃。因此 `SOURCE_COVERAGE_GAP=YES`，但没有为了补数字增加第四来源。

## 来源贡献

Solaris 是主 discovery source，覆盖全部 13 条宽目录和全部 6 条合格 Catalog Item。Good Smile 覆盖其中 5/3 条，贡献官方字段与 28 张图片；Japan Figure 覆盖 3/1 条，贡献补充目录证据与 1 张图片。后两者没有在 Solaris 基线之外增加新 Catalog Item，但提升了来源与图片证据。

## Grouping 与人工成本

共享 text-first 引擎产生 0 个 AUTO_MERGE、0 个 REVIEW、2 个明确 KEEP_SEPARATE，后者都是不同 scale 的造型保护。Grouping 人工 Review 成本为 0 分钟；另用约 6 分钟在系统 Chrome 中浏览全部 6 张合格姿势卡。没有运行新的 pHash 阈值研究、CLIP、embedding 或 LLM 视觉归组。

## 泛化成本

- Character profile：43 行非空变更（Collector profile 42 行，既有 Gallery 安全别名 1 行），其中 Cheshire Collector profile 19 行。
- Shared pipeline：约 1,564 行非空变更（1,492 add / 72 delete），包含从冻结经验抽出的本地 Collector、通用 Projection/identity 与偏好迁移。
- 三个既有来源 connector：225 行非空代码；第四 connector：0 行。
- Character-specific branch：0 行；Cheshire-specific branch：0 行。
- 三个 Rem 写死接缝被参数化：identity namespace、Projection core、CLI/profile entry；Rem 的冻结 policy wrapper 保留不变。

## 回归与产品验收

Rem 回归为 221 Prototype / 221 cards / 0 ID drift / 0 top-50 drift / 0 grouping conflict。柴郡两次 Projection rebuild 为 0 ID drift、0 推荐顺序 drift；`cheshire-proto-*` 与 `rem-proto-*` 隔离。

同一 `/gallery/characters/:slug` 页面通过 Search、Manufacturer、Type、Detail、Lightbox、缩放、键盘和封面持久化验收。系统 Chrome 完成 Rem 快速回归和全部 6 张柴郡卡浏览；4/3/2 responsive 由无外网 Playwright 验证。默认排序仍是“推荐（参考资料完整度）”，没有伪造“热门”或“最新”。

## 当前最大缺口

1. 当前三源没有覆盖旧基线中的 ALTER 与 Fancy Night 两条，覆盖率仍有明确缺口。
2. 柴郡本轮没有 multi-item Prototype，因此第二角色尚未产生真实的跨版本折叠样本；只能确认同一 grouping/identity contract 可运行。
3. 一次 live refresh 暴露 Solaris `updated_at` 导致 13 条假变化；业务 digest 已修复并由离线回归覆盖，但为避免继续来源访问，本轮没有再做修复后的 live refresh。

## 下一步唯一建议

冻结这条双角色公共链路；下一轮只针对两条 old-only `source_gap` 做一个许可边界清楚、可证明有边际收益的窄补源验证，不扩大为新一轮来源研究。

本轮未修改外部 Rem Collector、`figures.json`、Payload、PostgreSQL 或 S3；未访问 Hpoi，未增加第三角色，未部署，也未修改 PR #18/#19/#20/#22。
