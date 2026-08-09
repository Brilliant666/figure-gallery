# MVP-03A 柴郡拍摄参考索引

## 目标

旧角色页把每个商品的所有图片纵向展开，多个商品和图片混在同一页面中。它适合检查采集结果，却不适合快速比较不同手办的动作、轮廓和服装。MVP-03A 将界面拆成两层：角色首页一商品一封面；商品详情页保留该商品全部本地图。当前修复后基线为 7 个商品、65 张图片。

本轮只修改 `tools/personal-gallery-mvp/` 的本地只读展示、偏好和确定性官方页解析。它没有增加物理商品，也没有写入正式 Payload 应用；图片修复只针对 ALTER 和 APEX 对应的两个既有条目。

## 一商品一封面

角色路径保持为 `/gallery/characters/cheshire`。每个现有 product record 最多产生一张封面卡片，点击卡片进入 `/gallery/characters/cheshire/products/<product-id>`。索引不创建 65 张详情图片的 DOM，也不预加载它们。

合格封面应尽量完整呈现该手办的整体姿势、服装和构图，优先正面或接近正面的 3/4 视角，避免背面、局部特写和严重裁切。坐姿、躺姿或特殊底座按“完整呈现整体造型”判断，不强制站姿。

封面选择顺序固定为：

1. 用户保存的 `preferredCoverImageId`；
2. 官方主页图或 parser primary image；
3. 根据尺寸、面积、宽高比和顺序计算的确定性推荐；
4. 第一张未排除的有效图片。

该规则不声称能够识别人像朝向。项目所有者可在商品详情中使用“设为封面”覆盖自动结果；偏好原子写入 Git 忽略的 `preferences.json`，刷新和服务重启后保持。旧 `preferredCoverImage` 映射会被兼容读取并规范化为按商品保存的 `preferredCoverImageId`。如果人工封面后来被排除，选择仍保留，但当前显示临时回退到下一张有效图片。

7 个有图商品均已完成视觉复核：2 张保留自动选择，5 张使用人工覆盖。ALTER 当前 6 张官方候选均可本地读取，人工封面选用正面全身图；APEX 保留原有 1 张适合作封面的发行方合成图，并在详情中增加 3 张官方纵向商品长图。Git 只记录计数和门禁结果，不提交封面图片、SHA 或真实运行 manifest。

## 商品详情图库

详情页显示商品标题、厂商、比例、分类、来源类型、当前封面、图片和失败数量、备注及全部本地图片。每张图可以打开商品范围内的灯箱、设为封面、排除或恢复。灯箱支持 Esc、前后切换、Fit、Actual size 和缩放；导航不会跨到另一个商品。

角色页筛选以商品为单位。类型选项由当前数据动态生成并使用中文标签；当前 7 款均已确定为比例手办，因此只出现“比例手办”，不再提供或显示 `unknown` 选项。内部 parser 仍保留不确定值以避免把未知来源事实猜成已确认类型。无论筛选结果包含多少商品，每个命中的商品仍只显示一张封面。管理与收集状态移动到默认折叠区域，首页第一屏优先展示拍摄参考卡片。

## APEX 与 ALTER 图片修复

APEX 厂商页 `productinfo/3727461.html` 返回一个小型客户端脚本壳，产品正文实际列出 3 张 `fullScreen` 纵向长图。未来实时解析会同时请求 Firecrawl 标准渲染 `html` 与源 `rawHtml`：前者供确定性 DOM parser 读取脚本插入的商品正文，后者保留 canonical、metadata 和源页面证据；parser 不执行或信任第三方脚本来推断稳定字段。

这 3 个官方图片 URL 在普通直接 HTTP 请求中仍返回 404，但系统 Chrome 正常打开官方商品页时 3 个资源均完整加载，尺寸分别为 1000×5680、1000×1970 和 1000×7660。本次只从该正常页面会话已经加载的精确资源导入文件，并继续执行 magic bytes、MIME、大小、尺寸和 SHA-256 校验；没有伪造 Referer/User-Agent、改写 URL、切换代理或绕过 404。当前 APEX 条目因此包含 1 张保留的发行方合成封面和 3 张官方长图。干净运行时若 CDN 仍拒绝普通下载，自动采集会如实记录失败，不能把本次受控浏览器导入宣称为完全无人值守闭环。

ALTER 继续使用 `alter-web.jp/products/560`。当前官方页的产品图库使用 `.bxslider`；parser 补上该结构后由 1 张合成主图扩展为 6 张本地候选。所有图片均经过 HTTPS、允许 host、公网 DNS、magic bytes、MIME、大小、尺寸与 SHA-256 校验。

## 数据与性能边界

- 现有 7 个物理商品、65 个本地对象、历史运行、排除偏好和备注均保留；历史 APEX 404 仍留在旧 run 中；
- 当前首页只请求 7 张实际封面，没有无图占位；
- 详情页才请求当前商品的图片，图片继续使用原生 lazy loading；
- 图片不转 base64，不进入 Git，不因排除或换封面而删除；
- `.local/personal-gallery/` 继续由 Git 忽略。

## 尚未完成

MVP-03A 没有做 FigurePrototype/SKU/版本合并，也没有实现 pHash、dHash 或其他感知去重。字节不同但视觉相似的图片可以同时保留在详情中。本轮没有增加来源 allowlist、没有访问 Hpoi 或 Firecrawl，也没有开始第二角色、MVP-03B 或正式 PR-02。

## 验收

离线单元与 Playwright 使用合成 fixture；系统 Google Chrome Stable 使用当前本机真实 7 商品/65 图片 runtime，并通过严格 loopback 网络守卫。权威脱敏摘要见 [`research/evidence/mvp03a/reference-index-results.json`](../research/evidence/mvp03a/reference-index-results.json)。
