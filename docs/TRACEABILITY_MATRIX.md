# Figure Gallery 需求追踪矩阵

## 1. 使用规则

本矩阵把 [产品需求](PRODUCT_REQUIREMENTS.md) 与 [安全边界](SECURITY_BOUNDARIES.md) 的稳定 ID 映射到领域实体/接口、[PR-00—PR-08](DELIVERY_ROADMAP.md)、计划测试和主要风险。测试 ID 是正式实现必须建立的验收标签，不表示蓝图阶段已经执行。需求、状态机、权限或 PR 顺序改变时，必须在同一设计 PR 更新本矩阵。

第一阶段只有两类人类用户类型：公开访客和 Admin；首版可有多个独立 Admin 账号，但只有一个角色，审核、目录维护、设置及运维是动作上下文，不是首版可配置 RBAC。`CandidateClient` 是非人集成身份。

当前交付状态：PR-00 已合并；PR-01 在 `feat/pr-01-core-catalog` 作为 Draft 候选实现，尚待最终 CI 与人工审查；PR-02—PR-08 未开始。PR-01 的 `CAT-01`—`CAT-21` 状态真值只存在于最终 Head 对应的 `research/evidence/pr01/catalog-results.json`，本矩阵只做需求/测试路由，不预先标记 pass。

## 2. PR 边界

| PR | 精确主题 | 主要需求范围 |
| --- | --- | --- |
| PR-00 | 正式项目初始化 | NFR 基线、Hpoi guard、CI/health/空 migration |
| PR-01 | 核心目录数据模型 | Work、Character/Alias、Manufacturer、Prototype/Character relation/Version、正式写 service、OperationLog 骨架 |
| PR-02 | 来源和候选池 | CAND、CandidateClient、owner/幂等/上传入口 |
| PR-03 | 审核工作流 | REV、ReviewWorkItem、allowed target/并发 |
| PR-04 | 媒体和正式主图 | MED、S3、派生图、提升和主图保护 |
| PR-05 | Merge/Split/Undo | OPS-001—005、依赖和指定撤销 |
| PR-06 | 公开搜索和图库 | PUB、公开过滤和浏览器 UX |
| PR-07 | 导出、备份和恢复 | DATA、联合 snapshot/恢复审计 |
| PR-08 | 部署准备 | standalone、readiness、可观测性和全链门禁 |

## 3. 风险目录

| 风险 | 含义 |
| --- | --- |
| R-01 | 收录/授权/原型与版本身份判断错误 |
| R-02 | 候选越权写正式数据或自动发布 |
| R-03 | 凭据泄露、跨 client owner/IDOR |
| R-04 | 恶意上传、重复对象或失败留下半成品 |
| R-05 | 正式主图被替换、误删或对象关系断裂 |
| R-06 | 审核越界、并发静默覆盖或决定不可追溯 |
| R-07 | merge/split/undo 作用域、依赖或关系损坏 |
| R-08 | 匿名数据泄露、成人过滤/缓存绕过 |
| R-09 | 导出锁定、备份与数据库/对象恢复不一致 |
| R-10 | Hpoi/外站自动访问、SSRF 或许可违规 |
| R-11 | 搜索、响应式、可访问性或性能不达标 |
| R-12 | Admin/REST/GraphQL/Local API 绕过领域服务和审计 |
| R-13 | secret、供应链、运行形态、观测或清理失败 |

## 4. 产品与功能需求映射

| 需求 ID | 实体/合同 | API / Admin / Public 面 | PR | 必须测试 | 风险 |
| --- | --- | --- | --- | --- | --- |
| PRD-001 | Character→FigurePrototype→mainImage 公开投影 | 角色搜索与图库 | PR-01, PR-04, PR-06 | T-CONTRACT-POSITIONING、T-PUB-E2E | R-01, R-11 |
| PRD-002 | FigurePrototype category/authorization/inclusion、FigureVersion gray completeness、Manufacturer evidence、publication state | Admin 收录审核与发布 service | PR-01, PR-03 | CAT-07、CAT-11—14；T-PUBLISH-PRECONDITION | R-01 |
| PRD-003 | FigurePrototype/FigureVersion 唯一与归属 | Admin 版本归入；公开投影去重 | PR-01, PR-03, PR-06 | T-PROTOTYPE-VERSION、T-PUB-NO-VERSION-CARDS | R-01 |
| PRD-004 | Candidate/Formal aggregate、OperationLog、mainImage | candidate API、review/领域 service | PR-01—PR-05 | T-CANDIDATE-ISOLATION、T-MAIN-IMMUTABLE | R-02, R-05, R-12 |
| CAT-001 | Work、soft state（WorkAlias 不在 PR-01） | Admin Work commands | PR-01 | CAT-02—04、CAT-15—19 | R-01, R-12 |
| CAT-002 | Character、CharacterAlias、可选 Work；Prototype↔Character M:N | Admin Character/Prototype commands；future public search | PR-01, PR-06 | CAT-02、CAT-05、CAT-06、CAT-08、CAT-16—19；T-HOMONYM | R-01, R-11, R-12 |
| CAT-003 | Manufacturer、verification/status | Admin Manufacturer commands | PR-01 | CAT-02、CAT-07、CAT-13、CAT-16—19 | R-01, R-12 |
| CAT-004 | FigurePrototype、Character relation、authorization/inclusion/publication placeholder；mainImage 延后 | Admin Prototype commands；future media/public projection | PR-01, PR-04, PR-06 | CAT-08、CAT-09、CAT-12—19；T-PUBLISH-MAIN | R-01, R-05, R-12 |
| CAT-005 | FigureVersion→Prototype | Admin Version commands | PR-01, PR-03 | CAT-10、CAT-11、CAT-13、CAT-16—19；T-VERSION-NO-CARD | R-01, R-12 |
| CAND-001 | Source policy、manual URL/offline import | Admin manual source form；无 fetch | PR-02 | T-SOURCE-MANUAL-ONLY、ATK-13 | R-10 |
| CAND-002 | CandidateClient、credential digest/status | provision/rotate/revoke command | PR-02 | T-CLIENT-LIFECYCLE、ATK-01 | R-03 |
| CAND-003 | SourceRecord 全局 stable key/fallback、首次发现归因；Candidate owner | candidate upsert service；无 Source 直接 client CRUD | PR-02 | T-SOURCE-IDEMPOTENCY、T-FALLBACK-UPGRADE、ATK-02 | R-03 |
| CAND-004 | CandidateRecord、upload receipt/idempotency | candidate upsert、multipart upload | PR-02 | T-CANDIDATE-REPLAY-10X、T-UPLOAD-RETRY | R-03, R-04 |
| CAND-005 | raw fields/snapshot digest/diff/status | Admin candidate view | PR-02, PR-03 | T-RECOLLECT-DIFF、T-NO-FORMAL-MUTATION | R-02, R-06 |
| CAND-006 | CandidateClient scope allowlist | REST/GraphQL/Local/Admin/custom surfaces | PR-02 | ATK-03、ATK-04、ATK-05、ATK-06 | R-02, R-12 |
| REV-001 | ReviewWorkItem、allowedTargets、reviewer、lockVersion | Admin review commands | PR-03 | T-WORKITEM-SCHEMA、ATK-07/08 | R-06 |
| REV-002 | FieldDecision、reason、candidate images | Admin review view | PR-03 | T-REVIEW-ACCEPT-REJECT-E2E | R-06 |
| REV-003 | defer/ignore/complete/reopen state machine | Admin review commands | PR-03 | T-WORKITEM-STATE、T-REOPEN-AUDIT | R-06, R-12 |
| REV-004 | Review transaction + compensations | review/new prototype/version/main commands | PR-03, PR-04 | T-REVIEW-ROLLBACK、T-UPLOAD-COMPENSATE | R-04, R-06 |
| REV-005 | optimistic lock | Admin review submit | PR-03 | ATK-08、T-REVIEW-CONFLICT | R-06 |
| REV-006 | Admin review component | Payload Admin custom view | PR-03 | T-REVIEW-PLAYWRIGHT、T-REVIEW-KEYBOARD | R-06, R-11 |
| MED-001 | UploadReceipt/MediaAsset byte metadata | multipart upload | PR-02, PR-04 | ATK-10、T-IMAGE-DECODE-LIMITS | R-04 |
| MED-002 | content SHA-256、aHash | media ingest/dedupe service | PR-04 | T-SAME-BYTES-DEDUPE、T-SAME-URL-CHANGED | R-04 |
| MED-003 | original/renditions/storageKey | S3 adapter、media read | PR-04 | T-S3-ROUNDTRIP、T-PREFIX-URL-DECOUPLE | R-05, R-09 |
| MED-004 | CandidateImage→MediaAsset/FigureImage promotion、mainImage | Admin promote/select service | PR-04 | T-PROMOTE-MAIN、ATK-03 | R-02, R-05 |
| MED-005 | reference protection/lifecycle state | invalidate/delete/cleanup commands | PR-04 | ATK-12、T-MAIN-REFERENCE-PROTECTION | R-05 |
| MED-006 | compensation/missing/orphan audit | ingest worker、audit command | PR-04 | ATK-11、T-MISSING-ORPHAN-REPORT | R-04, R-05 |
| OPS-001 | DomainCommand、OperationLog、stableId、lockVersion | 所有正式 Admin commands | PR-01—PR-05 | CAT-02、CAT-15—19、ATK-06、T-OPLOG-COVERAGE | R-12 |
| OPS-002 | merge operation/scope/snapshot | Admin Operations view | PR-05 | T-MERGE-ATOMIC | R-07 |
| OPS-003 | split operation/relationship closure | Admin Operations view | PR-05 | T-SPLIT-CLOSURE | R-07 |
| OPS-004 | specified undo/dependencies | Admin Operations view | PR-05 | ATK-09、T-INDEPENDENT-UNDO | R-07 |
| OPS-005 | hidden/restored、Source stale/dead/restore | Admin lifecycle commands | PR-05 | T-HIDE-RESTORE、T-SOURCE-STATE-RESTORE | R-05, R-12 |
| OPS-006 | SystemSetting 五项单例 | PR-02 只读默认、PR-03 Admin audited command、PR-06 public consumption | PR-02, PR-03, PR-06 | T-SETTING-DEFAULTS、T-SETTING-AUDIT、ATK-14 | R-08, R-12 |
| PUB-001 | public home projection | Next.js `/` | PR-06 | T-HOME-FOCUS | R-11 |
| PUB-002 | normalized character search index | public search query | PR-06 | T-SEARCH-EXACT-ALIAS-PARTIAL | R-11 |
| PUB-003 | Work/Character disambiguation DTO | public disambiguation page | PR-06 | T-HOMONYM-E2E | R-01, R-11 |
| PUB-004 | published character gallery projection | public character page | PR-06 | T-PUBLISHED-FILTER、T-MULTI-CHARACTER | R-08, R-11 |
| PUB-005 | stable pagination cursor/page | gallery query | PR-06 | T-PAGINATION-16-PLUS-1 | R-11 |
| PUB-006 | intrinsic media dimensions/layout | GalleryGrid | PR-06 | T-GRID-4-3-2、T-NO-CROP | R-11 |
| PUB-007 | current-page lightbox state | Gallery lightbox | PR-06 | T-LIGHTBOX-KEYBOARD-BOUNDARY | R-11 |
| PUB-008 | showAdultImages/publicRead server filter | public query/cache | PR-06 | ATK-14、T-ADULT-CACHE-ISOLATION | R-08 |
| PUB-009 | public DTO allowlist | page/API response | PR-06 | T-NO-DETAIL-DOWNLOAD-PRIVATE-FIELDS | R-08 |
| DATA-001 | versioned export schema | Admin export command | PR-07 | T-JSON-CSV-PARSE、T-EXPORT-ALLOWLIST | R-09, R-13 |
| DATA-002 | MediaManifest | Admin manifest command | PR-07 | T-MANIFEST-HASH-KEYS | R-05, R-09 |
| DATA-003 | BackupSnapshot identity | backup/restore runbook | PR-07 | T-EMPTY-RESTORE-DIGEST | R-09 |
| DATA-004 | restored system contracts | restore verifier | PR-07, PR-08 | ATK-15、T-RESTORE-FULL-CONTRACT | R-03, R-05, R-09 |

## 5. 非功能需求映射

| 需求 ID | 实现/接口 | PR | 必须测试或度量 | 风险 |
| --- | --- | --- | --- | --- |
| NFR-001 | 默认拒绝 access/hook/domain policy | PR-00—PR-08 | ATK-01—15 全绿，hard fail=0 | R-02, R-03, R-12 |
| NFR-002 | PostgreSQL transaction/constraints/OperationLog | PR-01—PR-07 | CAT-02、CAT-06—19；T-RELATION-INVARIANTS、T-OPLOG-100 | R-06, R-07, R-12 |
| NFR-003 | idempotency receipt/compensation | PR-02, PR-04 | T-REPLAY-10X、T-INTERRUPT-RETRY | R-04 |
| NFR-004 | search/gallery indexes and query budget | PR-06, PR-08 | T-PERF-READ-P95（记录数据规模/环境） | R-11 |
| NFR-005 | semantic UI、keyboard/focus | PR-03, PR-06 | Playwright + WCAG 2.2 AA 自动检查 | R-11 |
| NFR-006 | readiness/publicRead fail closed | PR-00, PR-06, PR-08 | T-READINESS-CLOSED、ATK-14 | R-08, R-13 |
| NFR-007 | target-environment recovery measurement | PR-07, PR-08 | T-RPO-RTO-MEASURE；由部署阶段批准目标 | R-09, R-13 |
| NFR-008 | structured audit/trace/metrics | PR-03—PR-08 | T-TRACE-COVERAGE、T-LOG-SECRET-SCAN | R-12, R-13 |
| NFR-009 | open export/storage identity | PR-04, PR-07 | T-PORTABLE-EXPORT-RESTORE | R-09 |
| NFR-010 | required CI/release gates | PR-00—PR-08 | 每 PR roadmap 门禁 + full clean standalone | R-13 |

## 6. 安全需求与攻击回归映射

| 安全 ID | 主要控制/实体 | Surface | PR | 回归 | 风险 |
| --- | --- | --- | --- | --- | --- |
| SEC-001、SEC-002、SEC-003、SEC-004、SEC-005 | access policy、Admin session、DomainCommand/OperationLog | REST/GraphQL/Local API/Admin/custom | PR-00, PR-01, PR-02, PR-08 | ATK-01、ATK-03、ATK-04、ATK-05、ATK-06 | R-02, R-12, R-13 |
| SEC-006、SEC-007、SEC-008、SEC-009、SEC-010 | CandidateClient credential digest/status/scope/owner | provision/rotate/revoke、candidate API | PR-02 | ATK-01、ATK-02、T-CLIENT-LIFECYCLE | R-03 |
| SEC-011、SEC-012、SEC-013、SEC-014 | Candidate/Formal、ReviewWorkItem、mainImage、lock/transaction | review/formal commands | PR-03—PR-05 | ATK-03、ATK-06、ATK-07、ATK-08、ATK-09 | R-02, R-05, R-06, R-07 |
| SEC-015、SEC-016、SEC-017、SEC-018 | UploadReceipt、MediaAsset、storageKey/compensation | multipart/S3/media read | PR-02, PR-04 | ATK-10、ATK-11、ATK-12 | R-04, R-05 |
| SEC-019、SEC-020 | manual-only policy、network guard | URL input、HTTP/DNS/redirect transport | PR-00 起持续 | ATK-13，Hpoi requests=0 | R-10 |
| ATK-01、ATK-02 | auth/owner attacks | candidate API | PR-02 | 同 ID 自动化，恢复后 ATK-15 | R-03 |
| ATK-03、ATK-04、ATK-05、ATK-06 | 正式写和通用 surface bypass | 全写入 surface | PR-01—PR-05, PR-08 | 正式 digest/主图/成功日志三不变量 | R-02, R-12 |
| ATK-07、ATK-08、ATK-09 | target、并发、dependency undo | Admin domain commands | PR-03, PR-05 | PostgreSQL 双连接/事务测试 | R-06, R-07 |
| ATK-10、ATK-11、ATK-12 | 上传、S3 故障、主图生命周期 | media ingress/lifecycle | PR-02, PR-04 | 字节/对象/DB 联合断言 | R-04, R-05 |
| ATK-13 | Hpoi URL/DNS/重定向绕过 | network guard | PR-00—PR-08 | transport call=0、request=0 | R-10 |
| ATK-14 | public/adult/cache 绕过 | public query/cache | PR-06 | 匿名浏览器/API 攻击 | R-08 |
| ATK-15 | 恢复后完整攻击重放 | restored standalone | PR-07, PR-08 | 恢复前后相同拒绝与 digest | R-03, R-05, R-09, R-12 |

## 7. PR-01 机器验收追踪

完整实现说明见 [PR-01 核心目录实现](PR01_CORE_CATALOG_IMPLEMENTATION.md)。下表不记录运行结果，只规定每个机器 gate 必须证明的需求与主要风险。

| Gate | 需求/安全映射 | 主要风险 |
| --- | --- | --- |
| CAT-01 | CAT-001—005、OPS-001；只允许八个 PR-01 business Collections | R-01、R-12 |
| CAT-02 | OPS-001、NFR-002；不可变唯一 UUID stableId/operationId | R-07、R-09、R-12 |
| CAT-03 | CAT-001—005；versioned deterministic normalization/search document | R-01、R-11 |
| CAT-04 | CAT-001；Work state、soft delete、CAS | R-01、R-12 |
| CAT-05 | CAT-002；Character optional Work、homonym、matching_pending | R-01、R-11 |
| CAT-06 | CAT-002；Alias unique/preferred 与 searchDocument 同事务重建 | R-01、R-12 |
| CAT-07 | CAT-003、PRD-002；Manufacturer state 与 active gate | R-01、R-12 |
| CAT-08 | CAT-002、CAT-004；Prototype character/primary/group 聚合 | R-01、R-07 |
| CAT-09 | PRD-003、CAT-004；跨 Manufacturer 不自动合并 | R-01 |
| CAT-10 | PRD-003、CAT-005；Version 归属、kind 与 composite uniqueness | R-01 |
| CAT-11 | PRD-002、CAT-005；gray release/completeness 双层门禁 | R-01、R-12 |
| CAT-12 | PRD-002、CAT-004；official/third-party/rejected | R-01 |
| CAT-13 | PRD-002、CAT-003—005；eligible/excluded 前置与持续保护 | R-01、R-12 |
| CAT-14 | CAT-004、MED-004、SEC-013；published/merged placeholder、技术 Media 不得充当主图 | R-05、R-07、R-12 |
| CAT-15 | PRD-004、OPS-001、SEC-004/005；domain-only write + OperationLog | R-02、R-12 |
| CAT-16 | OPS-001、NFR-002、SEC-014；expectedVersion 与事务回滚 | R-06、R-12 |
| CAT-17 | SEC-001—005、ATK-03—06；REST/GraphQL/Local/Admin/overrideAccess 旁路 | R-02、R-12 |
| CAT-18 | CAT-001—005、NFR-005；真实 Admin Catalog Operations 与只读详情 | R-11、R-12 |
| CAT-19 | NFR-002、NFR-010；PG fresh/repeat/down/up/drift/signature | R-09、R-13 |
| CAT-20 | CAT-001—005、SEC-019/020；合成 seed 幂等、无真实数据/图片/网络 | R-10、R-13 |
| CAT-21 | SEC-019/020、ATK-13；Hpoi requests=0 且 PR-02—PR-06 未启动 | R-10、R-13 |

## 8. 跨 PR 放行规则

1. 每个 PR 必须在描述中列出本矩阵覆盖的需求/测试 ID、migration、回滚、风险和停止条件；
2. 任一硬安全不变量失败、测试未执行却写成通过、相对链接失效、提交秘密/数据库/图片/构建产物，均不得放行；
3. 历史 `research/` 与 `spikes/` 只能作为设计证据，不作为正式测试结果或运行时输入；
4. PR-08 只完成非生产部署准备，不授权生产/云部署；完成后不得自动开始下一阶段。
