# Agent 工作约定

每次任务开始前，必须先完整阅读：

1. `CODEX_MASTER_INSTRUCTION.md`
2. `README.md`
3. 当前任务明确指定的研究文件、设计文件或其他上下文文件

完成上述阅读并确认当前任务的范围、停止条件和限制后，方可开始工作。

所有工作必须遵守 `CODEX_MASTER_INSTRUCTION.md`。如果当前任务与仓库治理规则存在冲突，应停止并报告冲突，不得自行扩大任务范围或进入下一阶段。

## 当前正式基线

- 技术栈已经确定为 Payload CMS + Next.js；PostgreSQL 16 和 S3 兼容对象存储是正式数据与媒体边界。
- 正式应用必须在获授权的 PR-00 中使用官方脚手架干净创建，禁止复制或迁移 `spikes/` 代码。
- Hpoi 只作人工参考，禁止自动访问；未取得明确书面许可前不得编写正式 Hpoi adapter。
- 每项正式变化必须使用任务独立分支和独立 PR；未经明确授权不得合并或部署。
- 后续阶段按 `docs/DELIVERY_ROADMAP.md` 的 PR-00—PR-08 推进，不得越级开始下一项。

涉及正式产品、数据或运行边界的任务，还必须阅读与任务相关的 `docs/` 权威文档和 `research/TECH_STACK_DECISION.md`。
