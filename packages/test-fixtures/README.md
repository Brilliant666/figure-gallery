# test-fixtures

本目录只保存完全合成、离线且可重复的测试 fixture，不包含真实作品、角色、厂商、手办、图片、外部页面、凭据或数据库备份。

PR-01 的 `src/catalog.ts` 提供框架无关 Catalog command plan 和 `seedCatalog(execute)`。播种器不能直接访问 Payload、PostgreSQL 或文件系统；调用方必须注入正式 Catalog domain executor。每一步使用固定 `operationId`，依赖关系只读取前序命令返回的稳定业务 ID，因此相同执行器上的重复播种会走领域服务幂等重放。

该包只服务测试，不能成为生产运行依赖，也不能发起网络请求或生成媒体文件。
