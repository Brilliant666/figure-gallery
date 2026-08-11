# Formal Gallery Shadow Read 结果

结论：`FORMAL_GALLERY_SHADOW_READ = PASS`。Fresh PostgreSQL 上经现有 bridge 导入后，Formal Reader 通过 Payload Local API 读取正式持久化数据；227 张 Prototype 卡与当前 Local Gallery 完整比较为 0 mismatch。默认用户可见 Gallery 仍使用 Local Reader，本轮未执行 cutover。

1. **Local Reader 当前职责**：只负责把本机 Prototype Projection 与角色偏好适配为 canonical Gallery read model；现有路由、详情、灯箱与筛选仍消费该输出。
2. **Formal Reader 如何读取**：只经 Payload Local API 从 PostgreSQL 读取 Character、FigurePrototype、CatalogItem 与 SourceRecord，再适配到同一个 canonical read model；不读取 formal export JSON 冒充数据库结果。
3. **是否共享同一 Gallery business logic**：是。搜索、Manufacturer/Type 筛选、来源标签、推荐排序语义、偏好 overlay 与 parity comparator 位于共享 `@figure-gallery/gallery-read-model`；下游没有 `if formal` 分支。
4. **Rem parity**：284 个有效 Catalog Items、221 个 Prototype、221 张卡；完整 ID 与推荐顺序均零漂移。
5. **Cheshire parity**：6 个有效 Catalog Items、6 个 Prototype、6 张卡；完整 ID 与推荐顺序均零漂移。
6. **Cover parity**：Local/Formal 均为 226 张有封面、1 张 `NO IMAGE`，cover mismatch 为 0。
7. **Image/source parity**：Local/Formal 均为 1326 个 ImageRefs；图片来源、348 个 SourceRecord 对应的来源标签与 URL 均一致。
8. **Search/filter parity**：13 个代表性搜索、全部 45 个角色内 Manufacturer 选项及 4 个角色内 Type 选项均一致。
9. **Preference parity**：人工封面、Prototype 排除、ImageRef 排除和备注 overlay 均为 0 drift，键继续使用稳定 Prototype ID。
10. **Schema gap**：无。本轮 schema、migration、Collection 与 bridge contract 变化均为 0。
11. **是否可以进入正式数据源 cutover**：可以进入独立的 `GALLERY-FORMAL-CUTOVER-01` 审核任务，但本 Draft PR 不切换默认数据源、不删除 Local Reader、也不部署。

实现成本审计：Formal Reader 165 nonblank LOC；Local Reader 发生 22 行增加与 416 行删除（438 changed LOC，主要为抽取）；共享 canonical contract/comparator 1068 nonblank LOC；可见 Gallery 行为变化 0；Formal-specific Gallery branch LOC 0。该变化是 read-model extraction 与 adapter 接线，不是 Gallery 产品逻辑重写。

系统 Chrome 使用仅回环、远程图片请求禁用的验收代理：Rem 检查 221 卡、前五卡、详情和灯箱；Cheshire 6/6 卡及六个详情全部浏览，搜索 `Apex` 返回 1 卡、Manufacturer `AniGame` 返回 2 卡。外部商品来源请求为 0。
