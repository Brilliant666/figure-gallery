# 2026-07 正式 Web 依赖安全升级

## 触发与范围

- 触发日期：2026-07-23
- 触发运行：Formal web CI `29924060312`
- 触发步骤：`Audit production dependencies without mutation`
- 基线提交：`65231c0187cf49c7a2f4ea1c722bf16dc1d11133`
- 基线审计：critical 0、high 3、moderate 6
- 范围：仅正式 `apps/web` 依赖、锁文件、依赖安全回归和 Formal CI 早期失败清理。

本次没有运行 `npm audit fix` 或 `npm audit fix --force`，也没有接受 npm 建议的旧主版本降级。依赖解析只使用官方 npm registry。

## 漏洞与依赖路径

| Advisory                                                                                                          | 严重度   | 直接/传递 | 基线版本与范围                      | 依赖路径                                 | 处理                               |
| ----------------------------------------------------------------------------------------------------------------- | -------- | --------- | ----------------------------------- | ---------------------------------------- | ---------------------------------- |
| `GHSA-f88m-g3jw-g9cj`                                                                                             | high     | 直接      | `sharp@0.34.5`，`<0.35.0`           | `apps/web -> sharp`                      | 精确升级至 `0.35.3`                |
| `GHSA-v2hh-gcrm-f6hx`                                                                                             | high     | 传递      | `fast-uri@3.1.3`，`>=3.0.0 <=3.1.3` | `apps/web -> payload -> ajv -> fast-uri` | override 精确锁定 `3.1.4`          |
| `GHSA-qx2v-qp2m-jg93`                                                                                             | moderate | 传递      | 根节点 `postcss@8.4.31`，`<8.5.10`  | `apps/web -> next -> postcss`            | override 精确锁定并去重至 `8.5.10` |
| `GHSA-6gpp-xcg3-4w24`                                                                                             | high     | 直接      | `next@16.2.10`，`>=16.0.0 <16.2.11` | `apps/web -> next`                       | 精确升级至 `16.2.11`               |
| `GHSA-m99w-x7hq-7vfj`                                                                                             | high     | 直接      | `next@16.2.10`，`>=16.0.0 <16.2.11` | `apps/web -> next`                       | 精确升级至 `16.2.11`               |
| `GHSA-89xv-2m56-2m9x`                                                                                             | high     | 直接      | `next@16.2.10`，`>=16.0.0 <16.2.11` | `apps/web -> next`                       | 精确升级至 `16.2.11`               |
| `GHSA-p9j2-gv94-2wf4`                                                                                             | high     | 直接      | `next@16.2.10`，`>=16.0.0 <16.2.11` | `apps/web -> next`                       | 精确升级至 `16.2.11`               |
| `GHSA-68g3-v927-f742`、`GHSA-4633-3j49-mh5q`、`GHSA-4c39-4ccg-62r3`、`GHSA-q8wf-6r8g-63ch`、`GHSA-955p-x3mx-jcvp` | moderate | 直接      | `next@16.2.10`，`>=16.0.0 <16.2.11` | `apps/web -> next`                       | 同一稳定补丁 `16.2.11`             |

最初按任务门禁保持 Next.js `16.2.10`。修复 Sharp、fast-uri 和 PostCSS 后，当前 npm advisory 数据显示 Next.js 仍有独立 high；项目所有者随后明确授权使用当前 `16.2.x` 的最小稳定补丁 `16.2.11`。`@payloadcms/next@3.86.0` 的 peer 范围允许该版本。Payload 和全部 `@payloadcms/*` 仍精确保持 `3.86.0`，因为本次没有需要升级 Payload 的独立 advisory，也没有授权扩大兼容线。

## 版本与锁文件

| 包                          | 修复前                         | 修复后               |
| --------------------------- | ------------------------------ | -------------------- |
| `sharp`                     | `0.34.5`                       | `0.35.3`             |
| `fast-uri`                  | `3.1.3`                        | `3.1.4`              |
| `postcss`                   | `8.4.31`（另有 Vite 嵌套节点） | `8.5.10`（单一节点） |
| `next`                      | `16.2.10`                      | `16.2.11`            |
| `payload` / `@payloadcms/*` | `3.86.0`                       | `3.86.0`             |

采用 override 是为了在不升级 Payload、不更换框架兼容线的前提下，将两个传递依赖的所有消费方统一到最小安全版本：

```json
{
  "overrides": {
    "fast-uri": "3.1.4",
    "postcss": "8.5.10",
    "sharp": "$sharp"
  }
}
```

锁文件仍为 npm package-lock v3，由 npm 10.9.8 生成并通过全新 `npm ci`。SHA-256 从 `b329978feb6258497c6f9295b60d7f4e3b3c1dc7576c4834c4c87a5a8617773e` 变为 `1ec6ba3b428956e65c1af665bbce171f3c7191326cb35c80245bcb1671a1e45e`。相对基线新增两个 Sharp 平台可选包、移除一个已去重的 Vite/PostCSS 节点；其余版本变化只涉及 Sharp/libvips 平台包、Next/SWC 平台包和上述安全目标。未引入 Git URL、file dependency 或非官方 registry。

## 回归与 CI

本地回归覆盖：

- 精确 direct pin、override 和所有锁节点；
- `npm ls --depth=0` 及 Sharp/fast-uri/PostCSS/Next 依赖树；
- production audit 的 critical/high 门禁；
- fast-uri literal backslash 与 WHATWG 最终 host 一致性；
- URL 的反斜杠、percent-encoded delimiter、dot segment、loopback、IPv4/IPv6、metadata 和来源域混淆；
- Sharp 内存 PNG/JPEG/WebP、metadata、resize 和运行时 libvips；
- PostCSS `</style>` 转义回归、前台 CSS 和 Admin CSS 解析；
- TypeScript、ESLint、Vitest、仓库安全和正式边界；
- audit 早期失败时未启动 Compose 的 cleanup smoke，以及真实残留资源的失败检测。

GitHub Actions 首轮已完整验证 PostgreSQL migration/cycle、Catalog 合同、MinIO/S3、production build、Playwright、clean standalone、restart、Sharp standalone runtime、artifact safety 和最终 cleanup：

- Formal web CI run `30000981818`：success，INIT 12/12、CAT 21/21；
- Personal Gallery MVP offline CI run `30000981907`：success，Hpoi/Firecrawl 请求均为 0。

对应机器摘要已写入 `research/evidence/security-2026-07/formal-dependency-results.json`。证据回填提交仍须再次运行两套 CI，最终只接受当前 Head 的成功结论。

## 剩余 moderate

production audit 保留 5 个聚合 moderate，根因是 `GHSA-67mh-4wv8-2f99`：

```text
@payloadcms/db-postgres
  -> drizzle-kit
  -> @esbuild-kit/esm-loader
  -> @esbuild-kit/core-utils
  -> esbuild <=0.24.2
```

当前 `fixAvailable=false`。该链用于 migration/开发工具，不在公开运行时启动 esbuild 开发服务器，也不处理不可信开发输入；因此本轮记录并保留，不擅自升级 Payload 或替换数据库适配器。后续 Payload 依赖升级必须重新审计。开发依赖的独立 advisory 不属于本次 production 合并门禁，也不得借此扩大到未授权的工具链升级。

补充透明记录：包含 devDependencies 的全量 audit 在 2026-07-23 还报告 `vitest@4.0.18` 的独立 critical，修复目标为 `4.1.10`；正式 CI 只使用无 UI 的 `vitest run`。该项不在本次仅限 production 依赖的授权范围，未隐藏在 production 摘要中，也未擅自升级，须由独立任务评估。本文和合并门禁中的 critical/high 均特指 `npm audit --omit=dev`；高危阈值命令退出 0，而不带阈值的 production audit 因上述 5 个 moderate 退出 1。

## 回滚

首选回滚单位是完整撤销本安全 PR 的 squash merge，并立即恢复到已隔离、不开公网流量的状态；不应只回退单个 lock 节点，也不应在仍暴露生产流量时恢复已知受影响版本。回滚后应重新运行全套 Formal web CI，并在重新上线前采用兼容的安全补丁。
