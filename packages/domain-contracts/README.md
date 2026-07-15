# domain-contracts

本目录保存框架无关的领域协议：稳定 ID、状态枚举、命令/结果 DTO、领域错误、规范化和纯资格规则。

PR-01 建立 `CATALOG_NORMALIZATION_VERSION=1`。这里不得依赖 Payload、Next.js、数据库或 `apps/web`，也不得读取 `research/` 或 `spikes/`。
