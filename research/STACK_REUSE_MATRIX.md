# 技术底座与仓库复用调查（VAL-01）

## 范围与结论边界

本报告比较 Django＋Unfold、Payload CMS＋Next.js、Wagtail、Directus、Strapi、Szurubooru。调查只评估进入下一轮最小原型的价值，**不选择最终技术栈**，也没有 Fork、复制或导入任何候选仓库。

测试日期为 2026-07-12。统一活动证据保存在 [`evidence/stack-repository-metadata.json`](evidence/stack-repository-metadata.json)。GitHub 默认分支最近提交显示 8 个相关仓库均未归档，最近活动位于 2026-05-26 至 2026-07-12；活跃不代表升级兼容性或本项目适配性。

## 统一结论

| 候选 | 当前维护信号 | 许可证与公开只读部署影响 | 预估定制范围 | 复用结论（限定枚举） | 推荐等级 |
| --- | --- | --- | --- | --- | --- |
| Django＋Unfold | Django 2026-07-10、Unfold 2026-07-08 有提交；Django 6.0.7 与 Unfold 0.100.0 均于 2026-07 发布 | Django BSD-3-Clause；Unfold MIT。公开服务无 copyleft 源码披露要求 | 中高：领域模型、工作流、审核台、图片任务和前台 API | **可作为框架使用，但业务模型需要自建** | B：低锁定强备选 |
| Payload CMS＋Next.js | Payload 2026-07-12、Next.js 2026-07-12 有提交；Payload v3.86.0 发布于 2026-07-10 | 两者 MIT；公开服务无 copyleft 源码披露要求 | 中：领域模型、跨记录撤销、候选审核台与 Python 权限边界 | **可作为框架使用，但业务模型需要自建** | **A：进入 VAL-02** |
| Wagtail | 2026-07-08 有提交；7.4.2 发布于 2026-06-15，7.4 为 LTS | BSD-3-Clause；公开服务无 copyleft 源码披露要求 | 中高：非 Page 模型工作流、候选审核台、主图保护和跨记录撤销 | **可作为框架使用，但业务模型需要自建** | **A：进入 VAL-02** |
| Directus | 2026-07-10 有提交；v12.1.1 发布于 2026-07-01 | 当前为 **source-available 的 MSCL-1.0-GPL**，并非当下 OSI 开源许可；禁止竞争性用途并带运行时 entitlement，每个版本四周年后才追加 GPL-3.0。生产前必须法律/额度预检 | 中高：Vue 审核台、API extension、跨记录操作与许可预检 | **可作为框架使用，但业务模型需要自建** | C：许可证预检通过后才考虑 |
| Strapi | 2026-07-10 有提交；v5.50.1 发布于 2026-07-08 | Community Edition MIT；`ee/` 代码另行许可。审核、历史恢复等关键能力有商业版边界 | 高：候选审核、历史/撤销、导入导出、搜索与媒体流程 | **可作为框架使用，但业务模型需要自建** | C：暂不进入 VAL-02 |
| Szurubooru | 2026-05-26 有默认分支提交，但最新正式版 2.5 发布于 2021-06-05 | GPL-3.0。纯网络运行没有 AGPL 式触发，但分发修改客户端/程序时有 GPL 义务 | 很高：需重构核心关系模型和审核流程；不应作为正式改造方向 | **只适合复用部分模块或设计** | D：不进入 VAL-02 |

## 业务能力矩阵

“原生”只表示候选提供底层机制，不表示已经实现本项目的候选池、主图保护或人工确认规则。

| 能力 | Django＋Unfold | Payload＋Next.js | Wagtail | Directus | Strapi | Szurubooru |
| --- | --- | --- | --- | --- | --- | --- |
| 角色/原型/版本/来源表达 | Django ORM 可完全自建 | Collections＋relationship 可完全自建 | Django models/snippets 可自建，但 CMS 偏页面 | SQL collections/relations 可自建 | Content types/components/relations 可自建 | 固定为 post/tag/pool 等图站概念，错配明显 |
| 多对多 | ORM 原生 | relationship `hasMany`/join | Django ORM 原生 | 标准 M2M | 多种 relation 原生 | tags/pools 有关系，但不是任意业务模型 |
| 多图＋人工主图 | related model＋单值主图字段；UI 自建 | upload collection＋多值候选＋单值主图；hooks/access 自建 | Image/rendition＋orderable/关系；选择动作自建 | files＋M2M＋单文件字段；审核动作自建 | multiple media＋single media；审核动作自建 | 单 post 以单媒体为中心，不符合“一原型多候选图” |
| 草稿/审核/发布/隐藏 | 状态机、权限、审计全部自建 | drafts/versions/trash 原生；多阶段审核与 hide 自建 | revisions/draft/workflow mixins 较强；非 Page 模型仍需配置 | versions/revisions/archive 可用；Flow/permissions 与 v12 许可边界需验证 | Draft & Publish 免费；Review Workflows、Content History/restore 为商业能力 | 有站点级 moderation/权限，但没有候选→正式流程 |
| 软删除 | 自建 manager/字段 | Trash 原生 | 自建字段/manager | archive 字段原生；永久删除不可撤销 | 自建状态/lifecycle | 删除语义围绕 post，不是正式业务软删 |
| 合并/拆分/整组撤销 | 自建事务、operation log；可控但工作量中 | 跨文档 merge/split 与关系重写自建；versions 只帮助单文档 | revisions 可辅助单记录恢复；跨记录仍自建 | revisions 可回滚单记录；跨记录需 endpoint/extension | CE 下需自建 operation log；无领域原语 | 必须重做核心模型，风险最高 |
| 自定义候选审核台 | Unfold admin actions/views/components；成本中 | React Admin view/action/widget；成本中 | ViewSet/generic views/snippets；成本中 | Vue module/layout＋API extension；成本中高 | React Admin plugin＋server service；成本高 | 改造现有客户端/服务端；成本很高 |
| JSON/CSV | serializers/management command；CSV 自建 | 官方 import/export 插件支持 JSON/CSV；媒体关系需实测 | Django 导出能力；编辑级 CSV 自建 | UI/API 原生 CSV/JSON/XML/YAML；媒体二进制另行处理 | 官方 Data Management 偏整实例 CLI；编辑级 CSV/JSON 需自建/插件 | API/脚本可导入，非业务友好迁移格式 |
| 本地/对象存储切换 | Django Storage API；对象存储通常加适配器 | 官方 local/S3/R2/Azure/GCS 等适配器 | 继承 Django Storage API | 多 storage driver：local/S3/GCS/Azure/Cloudinary/Supabase | local/S3/Cloudinary provider | 官方部署以本地 volume 为主；对象存储切换需改造 |
| 缩略图/预览 | Pillow/第三方库或自建任务 | Sharp、`imageSizes`、缩略图原生 | image renditions 原生且成熟 | `/assets` 按需变换与缓存 | Media Library/Sharp responsive sizes | 图站缩略图原生，但绑定其 post 模型 |
| 搜索/分页 | QuerySet、Paginator；全文/别名索引自建 | API pagination＋search plugin；业务消歧索引自建 | Search backend/API＋分页；业务消歧自建 | REST/GraphQL filter/search/pagination | REST filter/pagination；全文/别名需插件/自建 | 标签搜索和图库分页强，但语义模型不合适 |
| 纯图片瀑布流 | 前端自建，难度中 | Next.js 自建，难度低至中 | 模板/前端自建，难度中 | 必须另写前台，难度中 | 必须另写前台，难度中 | 现成图库 UI 可参考，但交互/模型与目标不同 |
| Python 采集器 | 同语言，可通过受限 service/management command 写候选池 | 经最小权限 REST/GraphQL；跨 Node/Python 边界 | 同语言，可直接写候选 service | 经 REST/GraphQL service account | 经 REST/GraphQL/API token | 服务端为 Python 但模型错配；直接复用带 GPL 与耦合风险 |
| 本地复杂度 | 中：Python＋DB＋媒体 | 中：Node/Next＋DB，单仓库但构建面较大 | 中：Django/Wagtail＋DB | 低至中：官方容器可快启；自定义 extension 增加 Node 构建 | 中：Node CMS＋DB＋admin build | 中：client＋server＋DB/容器 |
| 云部署复杂度 | 中：应用、DB、对象存储、任务 | 中：Next server、DB、对象存储、迁移；serverless 上传需处理 | 中：同 Django，另含图像处理/缓存 | 中：容器、SQL、uploads/object storage；entitlement 是额外运维风险 | 中高：无官方生产镜像，需维护 Dockerfile/admin build | 中：官方容器可跑，但大改后维护成本高 |
| 锁定风险 | 低：普通 Python/SQL 模型 | 低至中：MIT、多 DB/存储；schema/admin/hooks 绑定 Payload | 低至中：Django 基础开放，revision/image 模型绑定 Wagtail | **中高**：MSCL、entitlement、系统表与 Vue extension | 中：CE MIT，但 Document Service/admin plugin 与商业功能边界 | 高：固定图站模型＋GPL 改造面 |

## 候选逐项核验

### Django＋Unfold

**非 README 证据**：检查了 Django 的 [`django/db/models`](https://github.com/django/django/tree/main/django/db/models)、[`django/contrib/admin`](https://github.com/django/django/tree/main/django/contrib/admin)、[`docs/howto/deployment`](https://github.com/django/django/tree/main/docs/howto/deployment) 与许可证；检查了 Unfold 的 [`src/unfold`](https://github.com/unfoldadmin/django-unfold/tree/main/src/unfold)、contrib 组件、模板和文档目录。

- **适配能力**：ORM、事务、约束、权限和 Python 同栈最适合把“采集候选”和“人工确认正式数据”做成明确服务边界。Unfold 提供的是 Django Admin 主题与扩展表面，不提供手办业务模型。
- **不适配部分**：draft/version/workflow、跨记录 merge/split/undo、图片变体和审核台都需自建；不能把 Admin 的一次 save 当作完整审计流程。
- **预估定制范围**：中高，主要是领域模型、operation log、主图写保护、候选对比 UI、图片任务和前台 API。
- **锁定与许可**：BSD/MIT，锁定最低；未来可保留普通 SQL/对象存储并替换管理 UI。
- **复用结论**：**可作为框架使用，但业务模型需要自建**。

### Payload CMS＋Next.js

**非 README 证据**：检查了 [`packages`](https://github.com/payloadcms/payload/tree/main/packages) 中核心、数据库、搜索、导入导出和多种存储适配器，官方 [`Media.ts`](https://github.com/payloadcms/payload/blob/main/templates/website/src/collections/Media.ts) 与 [`Posts` collection](https://github.com/payloadcms/payload/blob/main/templates/website/src/collections/Posts/index.ts)，以及模板和部署文档。

- **适配能力**：Collections、upload、versions/drafts/trash、hooks/access、Admin custom components 和 Next.js 前台形成一套代码优先底座。单值主图关系可与多值候选图片区分，并用 hook/access 禁止采集器改主图。
- **不适配部分**：项目特有的原型/版本归并、跨记录撤销、授权证据和人工主图流程仍需自建。
- **导入/图片/搜索**：官方 import/export、search、pagination、Sharp image sizes 与多对象存储适配器覆盖较完整。
- **Python 整合**：通过只允许写候选 collection 的 REST/GraphQL 权限；Local API 是 TypeScript，不直接给 Python 使用。
- **预估定制范围**：中；前台与后台同属 React/Next 生态，但 Node/Python 双运行时增加协调成本。
- **复用结论**：**可作为框架使用，但业务模型需要自建**。

### Wagtail

**非 README 证据**：检查了 [`wagtail/models`](https://github.com/wagtail/wagtail/tree/main/wagtail/models)、[`wagtail/images`](https://github.com/wagtail/wagtail/tree/main/wagtail/images)、[`wagtail/admin`](https://github.com/wagtail/wagtail/tree/main/wagtail/admin)、部署配置与 BSD 许可证。

- **适配能力**：Django ORM、图片 renditions、revisions、draft/workflow mixins 和可扩展管理界面是六个候选中“内容审核机制”最完整的开源组合之一。
- **不适配部分**：Wagtail 的核心抽象偏页面树；本项目主要是关系密集的非页面数据。即使用 snippets/viewsets，候选审核、主图保护、merge/split 仍需自建。
- **预估定制范围**：中高；能复用图片和版本机制，但需证明非 Page 模型工作流不会带来额外复杂度。
- **锁定风险**：低至中；底层是 Django，图片/revision/workflow 层绑定 Wagtail。
- **复用结论**：**可作为框架使用，但业务模型需要自建**。

### Directus

**非 README 证据**：检查了 [`api/src`](https://github.com/directus/directus/tree/main/api/src)、[`app`](https://github.com/directus/directus/tree/main/app)、[`packages`](https://github.com/directus/directus/tree/main/packages)、SDK、[`docker-compose.yml`](https://github.com/directus/directus/blob/main/docker-compose.yml) 和当前 [`license`](https://github.com/directus/directus/blob/main/license)。

- **适配能力**：标准 SQL collections、M2M、files、content versions/revisions、archive、REST/GraphQL 和多存储驱动覆盖基础数据后台。
- **不适配部分**：批量候选对比、设主图、merge/split 需要 Vue module/layout＋API extension；跨记录撤销仍自建。
- **许可风险**：v12 当前是 source-available 的 MSCL-1.0-GPL，并非当下 OSI 开源许可；它禁止竞争性用途并执行 entitlement，每个版本四周年后才追加 GPL-3.0。公开手办图库不显然与 Directus 商业产品竞争，但不能据此自行作法律结论；Core/Grant 对细粒度权限与审核台是否足够必须先验证。
- **预估定制范围**：中高；数据层快，关键审核台和许可预检慢。
- **复用结论**：**可作为框架使用，但业务模型需要自建**。

### Strapi

**非 README 证据**：检查了 [`packages/core`](https://github.com/strapi/strapi/tree/develop/packages/core)、[`packages/providers`](https://github.com/strapi/strapi/tree/develop/packages/providers)、示例 [`article schema`](https://github.com/strapi/strapi/blob/develop/examples/getstarted/src/api/article/content-types/article/schema.json)、模板、测试、compose 和根许可证。

- **适配能力**：content types、relations、multiple/single media、Draft & Publish、REST 分页和插件机制能表达基础业务。
- **不适配部分**：Content History/restore、Review Workflows、Releases 存在 Growth/Enterprise 边界；CE 下跨记录撤销和候选工作台成本高。官方 Data Management 偏整实例 CLI，不等于编辑级关系/媒体 CSV 工作流。
- **部署**：官方文档明确不发布官方生产容器镜像，需要维护项目 Dockerfile、admin build、DB 与媒体存储。
- **预估定制范围**：高；关键成本是候选审核台、CE 下历史与撤销、关系/媒体导入导出和搜索消歧。
- **锁定风险**：中；CE 代码 MIT，但数据服务、Admin plugin 与商业功能边界形成产品锁定。
- **复用结论**：**可作为框架使用，但业务模型需要自建**。

### Szurubooru

**非 README 证据**：检查了 [`server/szurubooru/model`](https://github.com/rr-/szurubooru/tree/master/server/szurubooru/model)、[`client`](https://github.com/rr-/szurubooru/tree/master/client)、API/搜索代码、[`docker-compose.yml`](https://github.com/rr-/szurubooru/blob/master/docker-compose.yml) 和 GPL-3.0 许可证。

- **可参考部分**：标签搜索、图库网格、缩略图、媒体哈希/重复检测、Docker 部署和图片站交互。
- **根本错配**：核心是一媒体一 post 的 booru；角色、手办原型、版本、来源、候选图片和人工主图需要大规模重构。其 moderation 也不是“候选不能直接改正式数据”的领域流程。
- **预估定制范围**：很高；若作为底座必须改造核心 schema、API、审核和前端，已超出合理复用边界。
- **许可证与锁定**：GPL-3.0 加固定 schema/UI；作为正式底座会同时引入法律、数据和改造锁定。本任务也明确禁止复制图库仓库作为正式项目底座。
- **复用结论**：**只适合复用部分模块或设计**，主要限于精确/感知哈希、相似图搜索和图库交互思路；复制代码前必须单独评估 GPL 义务。

## 进入 VAL-02 的两个候选

1. **Wagtail**：验证非 Page 业务模型采用 snippets、RevisionMixin、DraftStateMixin、WorkflowMixin 和 Wagtail Images 后，能否用 Python/Django 同栈低成本实现候选审核、主图保护和可撤销操作。
2. **Payload CMS＋Next.js**：验证 code-first CMS、原生版本/草稿/软删、媒体适配器和 Next 前台是否能减少通用后台/图片工作，同时保持 Python 采集器的最小权限隔离。

选择这两个是为了比较“Python/Django 内容工作流”与“TypeScript/Next code-first CMS”两种真正不同的工程路径，而不是提前确定赢家。Django＋Unfold 是低锁定强备选；Directus 必须先通过 MSCL/Core entitlement 预检；Strapi 和 Szurubooru 暂不值得占用本轮两个原型名额。

## 主要来源

- [Django repository](https://github.com/django/django)；[Unfold repository](https://github.com/unfoldadmin/django-unfold)
- [Payload collections](https://payloadcms.com/docs/configuration/collections)、[versions](https://payloadcms.com/docs/versions/overview)、[upload](https://payloadcms.com/docs/upload/overview)、[storage adapters](https://payloadcms.com/docs/upload/storage-adapters)
- [Wagtail repository](https://github.com/wagtail/wagtail)；[Wagtail image documentation](https://docs.wagtail.org/en/stable/topics/images.html)
- [Directus license](https://github.com/directus/directus/blob/main/license)、[licensing overview](https://directus.com/docs/licensing/overview)、[relationships](https://docs.directus.io/app/data-model/relationships)、[extensions](https://docs.directus.io/extensions/introduction)
- [Strapi license](https://github.com/strapi/strapi/blob/develop/LICENSE)、[Content Type Builder](https://docs.strapi.io/cms/features/content-type-builder)、[Draft & Publish](https://docs.strapi.io/cms/features/draft-and-publish)、[Review Workflows](https://docs.strapi.io/cms/features/review-workflows)
- [Szurubooru repository](https://github.com/rr-/szurubooru)
