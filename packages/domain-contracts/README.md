# domain-contracts

本目录预留给框架无关的领域协议，例如稳定 ID、状态枚举、命令/结果 DTO、领域错误和审计事件契约。

PR-00 只建立边界说明：这里没有 package manifest、运行时代码或业务实现。未来内容不得依赖 Payload Collection 的具体类型，也不得读取 `research/` 或 `spikes/`。`apps/web` 只有在对应交付 PR 获得授权后才能依赖这里发布的显式公共契约。
