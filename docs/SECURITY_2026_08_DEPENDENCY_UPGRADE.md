# SECURITY-02：2026-08 依赖安全升级

## 触发原因与范围

2026-08-09，PR #14 的两条 CI 暴露了两个彼此独立的问题：Formal web 的生产依赖审计出现 high advisory；Personal Gallery 的 `npm ls --depth=0` 把 Sharp 为其他平台声明的 optional WASM 依赖报告为顶层 `extraneous`，在 Ubuntu runner 上提前终止。SECURITY-02 使用独立分支和独立 PR 修复两项问题，不改变领域模型、migration 语义、柴郡收录、来源策略或图库功能。

本轮没有运行 `npm audit fix`，没有使用浮动 `latest`、预发布版本、major override 或 force push。所有 npm 元数据和 tarball 均来自官方 registry。

## 实际依赖路径与 advisory

升级前使用 `npm ls`、`npm explain` 和 `npm audit --omit=dev --json` 取得真实路径：

| 包 | 升级前路径 | 受影响版本 | 处理 |
| --- | --- | --- | --- |
| `undici`（Formal） | `apps/web → payload@3.86.0 → undici` | `7.28.0` | Payload 3.87.1 自然解析为 `7.29.0` |
| `image-size` | `apps/web → payload@3.86.0 → image-size` | `2.0.2` | Payload 3.87.1 移除该路径，改用 `image-dimensions@2.5.1` |
| `fast-uri` | `apps/web → payload → ajv → fast-uri` | `3.1.4` | exact override `3.1.5` |
| `postcss` | `apps/web → next → postcss` | `8.5.10` | exact override `8.5.23` |
| `js-yaml` | `apps/web → payload → json-schema-to-typescript → js-yaml` | `4.3.0` | 上游允许范围内锁定 `4.3.1` |
| `nanoid` | `apps/web → postcss → nanoid` | `3.3.16` | exact override `3.3.17` |
| `undici`（Gallery） | `personal-gallery-mvp → cheerio@1.2.0 → undici` | `7.28.0` | 在 `^7.19.0` 范围内更新 lock 至 `7.29.0`，不使用 override |

对应 high advisories 包括 `GHSA-7p8r-x3mc-p8w7`、`GHSA-w3rx-r6r6-pgpr`、`GHSA-5p2g-fcmc-qvqq`、`GHSA-5p4m-2wfm-xmqj`、`GHSA-2v37-7h3g-55p8`、`GHSA-6g55-p6wh-862q`、`GHSA-r28c-9q8g-f849`、`GHSA-fxqj-rqcc-2cmp`，以及 undici 的 `GHSA-8xcm-r25x-g524`、`GHSA-4cwx-7wf7-3272`、`GHSA-m8rv-5g2x-5cg5`、`GHSA-jr45-8vmc-qm54` 和 `GHSA-v3r7-h72x-cjcm`。

## 版本结果

| 依赖 | 升级前 | 升级后 |
| --- | --- | --- |
| `payload` 与全部直接 `@payloadcms/*` | `3.86.0` | `3.87.1` |
| `next` | 实际 `main` 已为 `16.2.11` | `16.2.11`（保持 exact pin） |
| `react` / `react-dom` | `19.2.7` | `19.2.7` |
| `sharp` | `0.35.3` | `0.35.3` |
| Formal `undici` | `7.28.0` | `7.29.0` |
| Gallery `undici` | `7.28.0` | `7.29.0` |
| `image-size` | `2.0.2` | runtime 路径不存在 |
| `image-dimensions` | 不存在 | `2.5.1` |

任务授权描述沿用 Next 16.2.10→16.2.11，但 SECURITY-02 的真实起点 `main` 已在前一安全修复中固定为 16.2.11；本轮没有伪造一次不存在的 Next 文件变更。

## Sharp CI 误报

Sharp 0.35.3 的 lockfile 包含多个平台的 optional 包。在当前平台不安装其父平台包时，npm 10.9.8 可能把 `@img/sharp-wasm32`、`@emnapi/runtime` 和 `tslib` 显示为顶层 `extraneous`；这不是缺少当前平台原生运行时，也不是 invalid/peer 冲突。

Personal Gallery CI 不再用裸 `npm ls` 的平台无关假设作为唯一判断，而是运行 `check-installed-dependencies.mjs`：

- 确认 npm 没有禁用 optional dependencies；
- 拒绝 missing、invalid 或任何未知 extraneous；
- 只接受 package-lock 中明确标记 `optional=true` 的三项已知 Sharp orphan；
- 校验所有直接依赖实际版本；
- 实际加载 `sharp@0.35.3` 与 libvips；
- 动态生成 PNG、JPEG、WebP，读取 metadata，并执行 resize。

因此没有通过删除 Sharp、禁用 optional 包或弱化图片运行时检查来获得绿色 CI。

## package-lock 变化

Formal lock 从 815 个 package 节点变为 814 个：Payload 生态同步升级；`image-size` 被删除、`image-dimensions` 新增；安全补丁更新；npm 将重复 `csstype@3.2.3` 去重到根节点。Gallery lock 仍为 93 个节点，唯一包版本变化是 `undici@7.28.0 → 7.29.0`。

升级前 SHA-256：

- Formal：`1ec6ba3b428956e65c1af665bbce171f3c7191326cb35c80245bcb1671a1e45e`
- Gallery：`3abf293e60a68a9d1d0cf4c561433c354c215e2b07911f92106824ab3a019d5f`

升级后 SHA-256：

- Formal：`3f420aca499eb4c29ef08a2a3b97949fadd32118c5e396105da66219d0bb0abf`
- Gallery：`c4ec3780b4713f33ae6e48aa8ca55b0090d053b98415b60aba17eb7a78bb8629`

## 审计结果

| 项目 | critical | high | moderate | total |
| --- | ---: | ---: | ---: | ---: |
| Formal before | 0 | 8 | 6 | 14 |
| Formal after | 0 | 0 | 5 | 5 |
| Gallery before | 0 | 1 | 0 | 1 |
| Gallery after | 0 | 0 | 0 | 0 |

Formal 剩余 5 项 moderate 全部属于 `@payloadcms/db-postgres → drizzle-kit → @esbuild-kit → esbuild` 的开发服务器链：`@payloadcms/db-postgres`、`drizzle-kit`、`@esbuild-kit/esm-loader`、`@esbuild-kit/core-utils` 与 `esbuild`。npm 对每项均报告 `fixAvailable=false`；它们没有被过滤或隐藏，也没有通过未经授权的 Payload 版本变化处理。

## 已执行验证

本机 Node 22.13.1 下已经通过：

- 两端干净 `npm ci`（lock 由 npm 10.9.8 生成）；
- Formal `npm ls --depth=0`，无 missing/invalid；Gallery 平台感知依赖检查；
- dependency pin/security、repository safety、formal/catalog boundaries；
- Payload type generation 与 Admin import map generation，生成内容无差异；
- Formal typecheck、ESLint、Vitest 51/51、production build；
- Gallery source/network guard、离线单元测试 150/150、Playwright 1/1；
- 两端 Sharp PNG/JPEG/WebP/metadata/resize；
- 两端 production audit critical/high 为 0；
- `git diff --check`、敏感信息、二进制、大文件和运行时数据检查在提交前执行。

本机 Docker daemon 不可用，因此 PostgreSQL、MinIO/S3、migration cycle、attack matrix、Admin login 和 clean standalone 的完整组合由独立安全 PR 的现有 Formal web CI 在 GitHub-hosted Ubuntu runner 上执行；Personal Gallery offline CI 同时验证 Linux Sharp runtime。本文件不把本机未执行的 Docker 门禁写成通过。

## 回滚

如 Payload 3.87.1 出现生产回归，应在新的独立安全 PR 中定位并修复；不得直接回退到包含已知 high advisory 的 3.86.0/undici 7.28.0/image-size 2.0.2 组合。紧急缓解应优先暂停受影响入口并保留数据库、对象存储和 migration，不得使用 `npm audit fix --force` 或重写历史。

本轮 Hpoi 请求为 0；未重新采集柴郡，未改变 7 个商品、56 个本地对象或 APEX 404 行为，未部署，也未合并 PR #14。
