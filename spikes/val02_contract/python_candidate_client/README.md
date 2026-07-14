# 共享 Python 候选客户端

该客户端是 VAL-02 的本地、可丢弃集成探针。它只有一个公开写操作：
`candidate_upsert`。代码中没有创建或修改 `Character`、`Manufacturer`、
`FigurePrototype`、`FigureVersion` 或主图的 endpoint/method。

两个 adapter 使用同一 JSON body：

```json
{
  "protocol_version": 1,
  "operation": "candidate_upsert",
  "candidate": {}
}
```

图片在客户端内动态生成用于计算 `file_size`、`sha256` 和
`perceptual_hash`，但请求不携带图片字节或 base64。各原型的 seed 单独在
运行时动态生成图片文件。

| adapter | 默认 endpoint | Token 环境变量 | endpoint 覆盖变量 | Authorization |
| --- | --- | --- | --- | --- |
| Wagtail | `http://127.0.0.1:8000/api/val02/candidates/upsert/` | `VAL02_WAGTAIL_CANDIDATE_TOKEN` | `VAL02_WAGTAIL_CANDIDATE_ENDPOINT` | `Bearer` |
| Payload | `http://127.0.0.1:3000/api/candidate-records/upsert` | `VAL02_PAYLOAD_CANDIDATE_TOKEN` | `VAL02_PAYLOAD_CANDIDATE_ENDPOINT` | `users API-Key` |

endpoint 被硬限制为 loopback，且所有 Hpoi 根域及子域在解析/请求前被拒绝。
标准库传输显式使用空代理映射，避免系统或用户代理把本地候选 Token
转发到 loopback 之外；回归测试会在设置无效环境代理时验证仍能直连本地服务。
Token 只能由运行时环境读取，不存在命令行 Token 参数，也不提交真实 Token。

离线检查请求形状（不读 Token、不发网络请求）：

```powershell
python spikes/val02_contract/python_candidate_client/client.py --adapter wagtail --dry-run
python spikes/val02_contract/python_candidate_client/client.py --adapter payload --dry-run
```

本地原型运行后才可去掉 `--dry-run`，并在当前进程环境中临时设置对应 Token。
