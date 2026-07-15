# candidate-client

本目录预留给未来独立的 Python 候选客户端。它只能依赖公开候选协议，并且只允许提供 candidate upsert、候选媒体上传及同步/幂等结果读取；不得提供正式数据、正式主图、审核、设置或领域操作写入能力。

PR-00 不创建可运行 Python 包、依赖、网络客户端或 Source Adapter。未来实现不得导入 `apps/web` 内部模块、`research/` 或 `spikes/`；Hpoi 继续仅作人工参考且禁止自动访问。
