# VAL-02 阶段性推荐

## 推荐结论

**Wagtail 暂时领先。**

这是三种允许结论中的“Wagtail 暂时领先”，不是最终技术栈选择，也不是启动正式
项目的授权。固定九维评分结果为：

| 候选 | 分数 | 统一验收 | 结论 |
| --- | ---: | --- | --- |
| Wagtail | **83.0 / 100** | 29 pass、0 fail、1 not_run（AC-29） | **暂时领先** |
| Payload CMS＋Next.js | **79.6 / 100** | 29 pass、0 fail、1 not_run（AC-29） | 保留为有效对照候选 |

详细逐项证据与计分见
[`VAL02_COMPARISON.md`](VAL02_COMPARISON.md)。3.4 分差不大，且两边唯一未运行项都是
真实 Chrome 灯箱交互，因此本结论的置信度只适合指导下一次定向验证，不足以定栈。

## 为什么 Wagtail 当前领先

1. **同一合同下实现面更小。** Wagtail 自定义实现 2,904 行、测试 1,499 行、后台
   定制 220 行、2 个 migration artifacts、3 个直接依赖；Payload 为 4,289 行实现、
   2,122 行测试、413 行 Admin 组件（计入 review endpoint 为 984 行）、1 组逻辑
   migration/2 artifacts、9 个 runtime＋8 个 dev 依赖。Payload runner 的 6,212 行
   包含测试，未被拿来与 Wagtail 纯实现行数比较。
2. **运行边界更简单。** Wagtail 在一个 Python/Django 进程中完成 Admin、领域服务、
   前台和候选 endpoint；Payload 本地常驻虽也是一个 Node/Payload/Next 进程，但共享
   候选 client 另用 Python，形成双运行时边界。两者当前都使用 SQLite。
3. **图片与内容工作流基础更成熟。** Wagtail Images/rendition、Django Storage 和非
   Page revision/draft/workflow 已实际调用；rendition 可删除后重建。本轮 Payload
   也实际生成 thumbnail/preview，但在当前业务模型上需要更多自建 glue。
4. **本地证据更完整。** Wagtail 保存了 migrate、两次 seed、测试、collectstatic、
   新进程到 HTTP 200 和五次首页热响应小样本。Payload 保存了 Vitest 6.43 秒、build
   三阶段 5.3/3.6/1.026 秒及 server readiness 195 ms 单样本，但没有保留最终页面
   响应样本；这些数字测试路径不同，没有被当成直接性能对决。
5. **退出路径略清楚。** Wagtail/Django 使用普通 SQL 关系、开放 JSON/CSV 和 BSD
   系许可证；Payload/Next.js 同为 MIT 且也有开放导出，但 collection schema、hooks/
   access、React Admin 与 Next build 形成更大的框架专用面。

## 为什么 Payload 仍应保留

Payload 不是失败方案。它与 Wagtail 同样完成 29 项验收，且有几项真实优势：

- candidate-client 的 owner/归属检查可做 per-client 隔离，优于 Wagtail 单共享 Token；
- collection access、source/media hooks、append-only OperationLog 和 formal generic CRUD
  关闭形成更强的纵深写保护；
- `publicReadEnabled=false` 已实测匿名读取 Works、Characters、Manufacturers、
  FigurePrototypes 与 Media 全部被拒绝；受控 settings/public read 路径清楚；
- Payload Upload/Sharp、Admin React 扩展和官方 S3 plugin 对未来一体化 TypeScript/
  Next 前台仍有吸引力。

如果后续定向验证证明正式数据维护 UI、candidate handler 自身远端门禁、文件导入与
standalone/生产部署可用且维护成本可接受，Payload 完全可能追平或反超当前 3.4 分差。

## 当前不能忽略的共同缺口

以下项目在两边都没有完成，不能因为 29/0/1 就视为已解决：

1. **真实浏览器审核与灯箱。** AC-29 因 Chrome 控制扩展/native host 不可用而
   `not_run`；当前只有静态 DOM/组件/JavaScript 替代检查。尚未测高频候选审核效率、
   键盘/焦点、灯箱首尾、当前分页切换和响应式设备体验。
2. **候选文件导入闭环。** 共享 Python client 只传媒体元数据，不传文件。两边都只
   用 seed 动态生成的合成媒体证明本地预览与选主图，没有证明受控文件导入、重试、
   去重、失败隔离和从 client 到本地主图的完整路径。
3. **并发与可控撤销。** 两边的 merge/split/undo 只撤销全局最新未撤销操作；没有
   reviewer/work-item scope、指定操作撤销、并发冲突或复杂关系图压力测试，Admin
   也都没有这些控件。
4. **真实对象存储。** 两边只验证本地存储与 S3 配置/抽象边界；没有真实 bucket I/O、
   既有媒体迁移、签名 URL、故障恢复、缓存或凭据轮换。
5. **生产数据与部署。** 两边都没有验证生产数据库、备份/恢复、多实例一致性、任务
   队列、大数据量或云端部署；Payload 的 standalone 正式资产装配也未验证。
6. **目标授权。** 两边都允许受信 staff/admin 显式选择正式 target，但没有强绑定候选
   当前审核工作项；正式权限模型必须阻止跨候选/跨目标误写。
7. **后台功能缺口。** 两边都没有 merge/split/undo、settings 和完整生命周期控件。
   Payload 还缺 Work、Character、FigureVersion 的正式维护 service/UI，Manufacturer
   UI 也不完整；Wagtail 的 manufacturer/settings 有 service 但同样没有 UI。

## 方案特有的进入正式设计前门禁

### Wagtail

- 把单共享 candidate Token 改为可归因、可撤销、最小权限的 per-client 身份，并验证
  owner 隔离；
- 处理或明确锁定 `treebeard.E001` 所示的未来 Treebeard 6 manager 兼容路径；
- 用真实浏览器验证非 Page 审核页、revision/workflow 和批量候选处理效率；
- 证明完整多人审批与正式角色权限，而非仅最小 revision round-trip。

### Payload CMS＋Next.js

- 为 candidate handler 增加或验证不可绕过的服务端远端门禁，不能只依赖 client 与
  `dev/start` 绑定 loopback；
- 补齐 Work、Character、FigureVersion 和 Manufacturer 的受审计正式维护 service/UI，
  同时继续关闭可绕过 OperationLog 的通用 CRUD；
- 验证 `.next/standalone/server.js` 的生产启动、静态资产装配与可重复部署；
- 在真实浏览器中验证 React Admin 的审核效率，确认当前更高定制量能换来业务收益。

## 正式设计前必须追加的最小验证

在宣布最终技术栈或建立正式项目之前，至少应对暂时领先的 Wagtail 和仍有竞争力的
Payload 采用同一小型、脱敏数据再次证明：

1. 真实 Chrome 中完成一组候选的预览、字段接受/拒绝、目标选择、主图选择和灯箱
   首尾操作，并记录完成时间、点击数、错误恢复和可访问性问题；
2. 从共享 client 受控上传一个合成文件，完成哈希/感知哈希、归属、缩略图、预览、
   主图选择与重复/失败重试，不能引入真实图片；
3. 两个管理员并发执行不同 merge/split/undo，证明工作项作用域、冲突检测、指定撤销
   和 OperationLog 一致性；
4. 对真实的测试对象存储执行上传、读取、派生图、迁移、删除保护和故障恢复，并确认
   storage key 不依赖公开 URL；
5. 在拟采用的生产数据库上执行 migration、seed、开放导出、恢复与最小数据量测试，
   再验证可重复的非生产部署拓扑；
6. 收紧 staff/admin target 选择权限，补齐实际需要的正式数据维护和 merge/split/undo
   Admin 控件，再重新统计代码量与审核效率。

这些是正式设计前的验证门禁，不是本报告授权开始下一阶段、部署或技术选型。

## 停止声明

本结论只完成 VAL-02 比较：**未选择最终技术栈，未建立正式项目，未部署，未使用真实
手办图片，未向 Hpoi 发起请求，也未开始 VAL-03 或原画图库。**
