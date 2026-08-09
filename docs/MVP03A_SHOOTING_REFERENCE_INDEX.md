# MVP-03A 柴郡拍摄参考索引

## 目标

旧角色页把每个商品的所有图片纵向展开，多个商品和图片混在同一页面中。它适合检查采集结果，却不适合快速比较不同手办的动作、轮廓和服装。MVP-03A 将界面拆成两层：角色首页一商品一封面；商品详情页保留该商品全部本地图。当前修复后基线为 7 个商品、62 张图片。

本轮只修改 `tools/personal-gallery-mvp/` 的本地只读展示、偏好和确定性官方页解析。它没有增加物理商品，也没有写入正式 Payload 应用；图片修复只针对 ALTER 和 APEX 对应的两个既有条目。

## 一商品一封面

角色路径保持为 `/gallery/characters/cheshire`。每个现有 product record 最多产生一张封面卡片，点击卡片进入 `/gallery/characters/cheshire/products/<product-id>`。索引不创建 62 张详情图片的 DOM，也不预加载它们。

合格封面应尽量完整呈现该手办的整体姿势、服装和构图，优先正面或接近正面的 3/4 视角，避免背面、局部特写和严重裁切。坐姿、躺姿或特殊底座按“完整呈现整体造型”判断，不强制站姿。

封面选择顺序固定为：

1. 用户保存的 `preferredCoverImageId`；
2. 官方主页图或 parser primary image；
3. 根据尺寸、面积、宽高比和顺序计算的确定性推荐；
4. 第一张未排除的有效图片。

该规则不声称能够识别人像朝向。项目所有者可在商品详情中使用“设为封面”覆盖自动结果；偏好原子写入 Git 忽略的 `preferences.json`，刷新和服务重启后保持。旧 `preferredCoverImage` 映射会被兼容读取并规范化为按商品保存的 `preferredCoverImageId`。如果人工封面后来被排除，选择仍保留，但当前显示临时回退到下一张有效图片。

7 个有图商品均已完成视觉复核：3 张保留自动选择，4 张使用人工覆盖。ALTER 当前 6 张官方候选均可本地读取，人工封面选用正面全身图；APEX 当前只有一张可用的发行方公开合成主图。Git 只记录计数和门禁结果，不提交封面图片、SHA 或真实运行 manifest。

## 商品详情图库

详情页显示商品标题、厂商、比例、分类、来源类型、当前封面、图片和失败数量、备注及全部本地图片。每张图可以打开商品范围内的灯箱、设为封面、排除或恢复。灯箱支持 Esc、前后切换、Fit、Actual size 和缩放；导航不会跨到另一个商品。

角色页筛选以商品为单位。类型选项由当前数据动态生成并使用中文标签；当前 7 款均已确定为比例手办，因此只出现“比例手办”，不再提供或显示 `unknown` 选项。内部 parser 仍保留不确定值以避免把未知来源事实猜成已确认类型。无论筛选结果包含多少商品，每个命中的商品仍只显示一张封面。管理与收集状态移动到默认折叠区域，首页第一屏优先展示拍摄参考卡片。

## APEX 与 ALTER 图片修复

APEX 厂商页当前是客户端脚本壳，历史 3 个图片 URL 返回 HTTP 404。修复没有猜测地址、执行脚本或规避访问限制，而是将该既有物理商品的活动来源替换为已逐页核验的 AmiAmi `FIGURE-188750` 同商品页，并保存其页面直接公开的 1 张主图。AmiAmi review 子页直接访问返回 HTTP 403 后已立即停止，没有重试或绕过。

ALTER 继续使用 `alter-web.jp/products/560`。当前官方页的产品图库使用 `.bxslider`；parser 补上该结构后由 1 张合成主图扩展为 6 张本地候选。所有图片均经过 HTTPS、允许 host、公网 DNS、magic bytes、MIME、大小、尺寸与 SHA-256 校验。

## 数据与性能边界

- 现有 7 个物理商品、62 个本地对象、历史运行、排除偏好和备注均保留；历史 APEX 404 仍留在旧 run 中；
- 当前首页只请求 7 张实际封面，没有无图占位；
- 详情页才请求当前商品的图片，图片继续使用原生 lazy loading；
- 图片不转 base64，不进入 Git，不因排除或换封面而删除；
- `.local/personal-gallery/` 继续由 Git 忽略。

## 尚未完成

MVP-03A 没有做 FigurePrototype/SKU/版本合并，也没有实现 pHash、dHash 或其他感知去重。字节不同但视觉相似的图片可以同时保留在详情中。本轮没有增加来源 allowlist、没有访问 Hpoi 或 Firecrawl，也没有开始第二角色、MVP-03B 或正式 PR-02。

## 验收

离线单元与 Playwright 使用合成 fixture；系统 Google Chrome Stable 使用当前本机真实 7 商品/62 图片 runtime，并通过严格 loopback 网络守卫。权威脱敏摘要见 [`research/evidence/mvp03a/reference-index-results.json`](../research/evidence/mvp03a/reference-index-results.json)。
