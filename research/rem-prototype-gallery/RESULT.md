# FG-REM-PROTOTYPE-GALLERY-01 结果

- 冻结输入为 285 条 Catalog Items；Projection 排除 1 条已确认的 ArtScale 半身胸像漏网后，保留 284 条有效商品。
- 最终生成 231 个 FigurePrototype：189 个 singleton、42 个 multi-item group，最大 group size 为 4；共折叠 53 张重复姿势卡。
- ArtScale leak 已仅在 Projection 层标记并排除，没有修改 Collector 或 `figures.json`。
- Relax Time 的 `review-12` 与 `review-28` 经最小 ImageRef provenance 复核后仍为 `IMAGE_INCONCLUSIVE`，均保持 separate，没有为追求固定数量而合并。
- Gallery 已第一次达到“一张卡 = 一个独立姿势”：231 张 Prototype cards，230 张有封面；1,257 个 ImageRef 保留到原 Catalog Item 和来源家族的最小溯源。
- AUTO_MERGE 的 38 条边产生 29 次 component reduction；27 条冻结的 `IMAGE_SUPPORTS_SAME` 产生 24 次 reduction。6 条 `IMAGE_SUPPORTS_DIFFERENT` 与 2 条 inconclusive 均未被传递归组吞掉，grouping conflict 为 0。
- 系统 Google Chrome 已抽查 50 张卡和 15 个 multi-item Prototype；搜索、Manufacturer/Type 筛选、详情、多图灯箱、缩放、键盘、4/3/2 响应式与人工封面持久化均通过。同一冻结输入下 Prototype ID 重跑 drift 为 0。

已确认的一姿势一卡案例包括 Ice Season、Room Wear Renewal、China Maid Renewal、Outing Coordination channel version、Winter Maid Online Crane、Crystal Dress、Neon City、Shiromuku、Yukata 和 Graceful Beauty。Bunny/Bunny 2nd、Glitter & Glamours/Another Colour、Phantom Night Wizard 单人/双人保持独立；ArtScale Bust 不进入图库。

当前最大的三个产品问题：

1. 仍有 1 个 Prototype 缺少可用封面。
2. Relax Time 的一条 Catalog Item 混合 Solaris 与 Japan Figure 图片，最小 provenance 只能隔离风险，尚不能修复源记录身份。
3. 42 个原始 manufacturer 名称仍存在别名和公司后缀碎片，筛选可用但尚未形成正式厂商规范化。

下一步唯一建议：先修复缺图条目与 Relax Time 的逐来源 Catalog Item provenance，再考虑将这份可删除、可重建的 Projection 导入未来正式候选池；本轮不要继续扩展新角色或新归组算法。
