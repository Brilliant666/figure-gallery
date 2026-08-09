# Figure Gallery 产品北极星

## 1. Product North Star

Figure Gallery 是：

> 一个以角色为入口、以独立手办造型为核心实体的二次元拍摄姿势数据库。系统尽可能自动发现某个二次元角色已经存在的正版手办、静态完成品和景品，寻找可验证的正式来源与公开商品图片，并在角色图库中以“一种独立手办造型一张完整参考封面”的形式展示；点击后可浏览该造型全部官方参考角度和细节。

数据库与摄影参考不是两个产品：

```text
完整手办数据库 = 拍摄姿势资料库的底层能力
```

产品成功首先表现为：角色下已经存在的独立造型能被高覆盖发现、证据化、去重并形成可直接拍摄参考的图库，而不是后台 Collection 数量或基础设施复杂度。

## 2. 核心实体方向

```text
Work
  ↓
Character
  ↓
FigurePrototype
  ↓
FigureVersion
  ↓
SourceEvidence
  ↓
Media
```

- `FigurePrototype` 是最终首页卡片核心单位，表示一个独立的三维雕塑/姿势造型。
- 普通版、豪华版、再版、渠道版和重复来源应归入 `FigureVersion` 或 `SourceEvidence`，不应永久各占一个姿势卡片。
- personal gallery 当前使用的 `ProductRecord` 是来源级过渡记录：`ProductRecord != FigurePrototype`。
- `prototypeHint` 只用于提示疑似重复和覆盖统计；在专门的领域任务完成前不得自动 merge。

## 3. Hpoi 的正式角色

### Discovery Index

回答“某角色可能有哪些手办存在”。允许第三方公开搜索索引返回 Hpoi indexed result 的 URL、标题、摘要、查询和排名文本，以自动建立候选。

### Coverage Benchmark

回答“Figure Gallery 相对成熟手办索引还可能漏了哪些造型”。覆盖率只相对于当次搜索索引候选集，不代表 Hpoi 完整数据库的绝对覆盖率。

### 非数据权威

Hpoi 默认不作为正式主图、正式图片资产、最终商品事实唯一权威或 `FigurePrototype` 身份依据。正式事实与图片优先来自受审的厂商官网、官方品牌、官方发行方和明确允许的 distributor/retailer。

## 4. 不可跨越的访问边界

- Hpoi direct automation 当前禁止：GET、HEAD、DNS、scrape、API、图片请求、favicon、浏览器导航和链接预览均为 0。
- 索引发现不得随后打开、解析、预览或跳转 Hpoi URL；页面也不得生成会预取或导航到 Hpoi 的链接。
- 不使用 Hpoi Cookie、账号、登录、验证码处理、代理轮换、增强代理、缓存/镜像绕过、ID 枚举或隐藏接口猜测。
- 只有获得明确书面许可后，才可在独立任务中评估 `DirectHpoiAdapter`；索引发现不能被解释为该许可。

## 5. 当前近期优先级

1. 自动发现覆盖率；
2. 柴郡与蕾姆补收录；
3. candidate → official source 自动解析；
4. `FigurePrototype` 层去重；
5. 图片完整度；
6. 封面质量；
7. 更多角色。

暂缓继续堆正式后台功能、与用户价值无关的基础设施优化、第三个角色和公网部署。正式 Payload PR-02—PR-08 路线保留；将来恢复时应吸收 personal gallery 已验证的 discovery、candidate、source resolution、media、cover 和 prototype 约束，但不得复制工具代码或运行数据。

## 6. 当前交付边界

MVP-05 只在 `tools/personal-gallery-mvp/` 与 `.local/personal-gallery/` 验证自动发现和个人图库，不写正式 Payload、PostgreSQL 或 S3，不实现自动 prototype merge，不部署。每次阶段任务达到停止条件后立即停止。
