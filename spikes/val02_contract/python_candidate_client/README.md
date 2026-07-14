# 共享 Python 候选客户端

该客户端是 VAL-02/VAL-02B 的本地、可丢弃集成探针。它只有两个公开写操作：
`candidate_upsert` 和 `candidate_media_upload`，且两者都只能写候选池。代码中没有创建或修改 `Character`、`Manufacturer`、
`FigurePrototype`、`FigureVersion` 或主图的 endpoint/method。

两个 adapter 使用同一 JSON body：

```json
{
  "protocol_version": 1,
  "operation": "candidate_upsert",
  "candidate": {}
}
```

`candidate_upsert` 仍只携带图片描述符，不携带图片字节或 base64。
VAL-02B 的 `candidate_media_upload` 在内存中动态生成小型 PNG，计算
`file_size`、尺寸、`sha256` 和 64 位 aHash，再以 `multipart/form-data` 的
`metadata` 与 `file` 两部分上传。客户端不把 PNG 写入仓库。

| adapter | 默认 endpoint | Token 环境变量 | endpoint 覆盖变量 | Authorization |
| --- | --- | --- | --- | --- |
| Wagtail | `http://127.0.0.1:8000/api/val02/candidates/upsert/` | `VAL02_WAGTAIL_CANDIDATE_TOKEN` | `VAL02_WAGTAIL_CANDIDATE_ENDPOINT` | `Bearer` |
| Payload | `http://127.0.0.1:3000/api/candidate-records/upsert` | `VAL02_PAYLOAD_CANDIDATE_TOKEN` | `VAL02_PAYLOAD_CANDIDATE_ENDPOINT` | `users API-Key` |

| adapter | 默认上传 endpoint | client ID 环境变量 | endpoint 覆盖变量 |
| --- | --- | --- | --- |
| Wagtail | `http://127.0.0.1:8000/api/val02b/candidates/media/upload/` | `VAL02_WAGTAIL_CANDIDATE_CLIENT_ID` | `VAL02_WAGTAIL_CANDIDATE_UPLOAD_ENDPOINT` |
| Payload | `http://127.0.0.1:3000/api/val02b/candidate-media/upload` | `VAL02_PAYLOAD_CANDIDATE_CLIENT_ID` | `VAL02_PAYLOAD_CANDIDATE_UPLOAD_ENDPOINT` |

上传必须同时有对应 adapter 的运行时 Token 和 client ID。client ID、候选 ID、
客户端候选 ID 与幂等键均限制为可安全进入 HTTP header/JSON 的字符。Token
只出现在 `Authorization` header，不进入 metadata、响应错误或机器证据。

endpoint 被硬限制为 loopback，且所有 Hpoi 根域及子域在解析/请求前被拒绝。
标准库传输显式使用空代理映射，避免系统或用户代理把本地候选 Token
转发到 loopback 之外；回归测试会在设置无效环境代理时验证仍能直连本地服务。
Token 只能由运行时环境读取，不存在命令行 Token 参数，也不提交真实 Token。

离线检查请求形状（不读 Token、不发网络请求）：

```powershell
python spikes/val02_contract/python_candidate_client/client.py --adapter wagtail --dry-run
python spikes/val02_contract/python_candidate_client/client.py --adapter payload --dry-run
python spikes/val02_contract/python_candidate_client/client.py --adapter wagtail --candidate-id candidate-main-image-attack --dry-run-upload
python spikes/val02_contract/python_candidate_client/client.py --adapter payload --candidate-id candidate-main-image-attack --dry-run-upload
```

两个 dry-run 模式都不读 Token、不写图片且不开 socket。真实候选 upsert 可在
本地原型运行后去掉 `--dry-run`；真实 multipart 上传由测试或探针导入
`CandidateClient.upload_candidate_image(...)` 调用，并在当前进程环境中临时设置
对应 Token 和 client ID。
