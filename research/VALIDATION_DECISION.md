# VAL-01 阶段性决策

本文件只决定下一轮需要验证的假设，**不决定最终技术栈**。

## 1. Hpoi 是否值得继续作为主要发现索引

**有条件值得继续。**

Hpoi 的公开搜索、角色页和商品页能提供稳定数字条目 ID、名称、角色、作品、制作、类型、比例、发售时间线和多图入口。柴郡、蕾姆、初音未来三个关键词复核时分别呈现 2、16、43 页的规模差异，足以证明其发现价值。

但 Hpoi **当前不适合作为稳定主数据源或事实唯一来源**：普通 HTTP 在本环境超时，图片字节访问失败（超时、403 或重定向循环），浏览器自动化不可用，角色全集总数与分页完整性未验证，高清图片存在登录/App 提示，授权状态也不能只靠 Hpoi 标签判断。后续只能把 Hpoi 数据写入候选池，并用会员购、厂商官网及人工确认补充。

继续条件：先确认服务条款/robots/低频边界、普通 HTTP 可用性、角色关系分页、图片公开访问和字段变化策略；任一条件要求登录、Cookie、验证码规避或未公开接口时停止。

## 2. 值得进入 VAL-02 的两个候选

1. **Wagtail**
2. **Payload CMS＋Next.js**

这是阶段性原型名单，不是最终选型。

## 3. 为什么选择这两个

### Wagtail

- 保留 Python/Django 与采集器同栈优势；
- Wagtail Images 原生提供原图、rendition、焦点和存储抽象；
- RevisionMixin、DraftStateMixin、WorkflowMixin、LockableMixin 可用于非 Page snippets/models；
- BSD 许可证和普通 SQL/Django 模型降低法律与数据锁定；
- 最大未知点非常明确：非 Page 关系模型上的工作流和定制候选审核台是否真的比裸 Django＋Unfold 省工。

### Payload CMS＋Next.js

- Collections/relationships/upload 可表达关系密集模型；
- versions/drafts/trash、Admin custom components、hooks/access 与多存储适配器原生度高；
- Next.js 前台与管理端同属 TypeScript/React 生态，可快速验证极简搜索和图库读取面；
- MIT 许可证、多个 DB/对象存储适配器降低基础设施锁定；
- 最大未知点是 Python 采集器的最小权限 API、跨记录原子操作和 Node/Python 双运行时运维成本。

两者形成“Python/Django 内容工作流”与“TypeScript/Next code-first CMS”的有效对照。Django＋Unfold保留为低锁定备选，不在本轮占用第三个原型名额。

## 4. 尚未验证的关键假设

### 数据源

- Hpoi 是否允许并稳定承受公开、低频、无登录的 HTML 请求；
- 角色关系页是否存在可遍历且不漏项的分页，总数如何取得；
- 页面 HTML/结构化数据和数字 ID 的长期稳定性；
- `rfx.hpoi.net` 缩略图/原图映射、防盗链、删除和 URL 变更行为；
- Hpoi 标签能否稳定区分比例、景品、Q 版、可动、GK 和取消状态；
- 厂商授权、同原型版本归并和主图选择需要多少人工成本。

### Wagtail

- snippets/custom models 使用 revision、draft、workflow 后的真实开发量与编辑体验；
- 一次人工操作跨原型、版本、来源和图片关系的事务与撤销方式；
- 候选图批量对比、设主图和“主图不可自动替换”的 UI/权限实现；
- rendition、原图和对象存储切换的迁移成本。

### Payload＋Next.js

- Python 通过 REST/GraphQL 只能写候选 collection 的权限边界；
- Admin custom view/action 是否足以实现高效候选对比；
- 跨文档 merge/split/undo 的原子性、审计和失败恢复；
- 大量关系与媒体下的导入导出、分页和升级稳定性；
- Next server、DB、任务与对象存储的最小部署形态。

## 5. VAL-02 必须证明什么

两个原型都只使用小型合成数据和本轮脱敏样本，并使用同一验收脚本证明：

1. 能表达 Character、Work、Manufacturer、FigurePrototype、Version、Source、CandidateImage 及必要多对多关系；
2. Python 探测器只能创建/更新候选记录，不能直接修改正式记录；
3. 人工可以审阅字段差异、采纳/拒绝候选，并留下操作者、时间和理由；
4. 已存在的主图不会被采集器或普通候选更新自动替换；
5. 普通版/豪华版/再版等可以人工归并到原型，且 merge/split/undo 跨关系一致、可审计；
6. 多图、本地主图选择、缩略图/预览和原始比例读取路径成立；
7. 本地存储与一个对象存储适配器之间的边界清楚，URL 不成为业务主键；
8. JSON/CSV 或等价开放格式能导出关键关系与媒体元数据；
9. 角色名＋作品消歧搜索、分页和只读 4/3/2 图片网格能用最小代码验证；
10. 给出本地启动、测试、迁移和最小生产拓扑的实际复杂度数据。

## 6. VAL-02 明确不应开发什么

- 不开发正式 Hpoi 采集器，不扩大访问频率；
- 不导入完整角色或商品数据集；
- 不开发正式前台视觉、完整灯箱、账号系统或下载能力；
- 不开发正式后台品牌样式或通用运营功能；
- 不接入真实生产凭据、Cookie、支付、会员购账号或厂商后台；
- 不完成全量授权判定、版本归并词典或生产级搜索；
- 不部署到云端，不做生产迁移；
- 不选择最终技术栈；
- 不开始原画图库或 VAL-03。

VAL-02 达到上述最小证明点后应立即停止并比较证据，不把任一 spike 演变为正式项目。
