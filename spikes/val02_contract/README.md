# VAL-02 共享验收合同

本目录是 Wagtail 与 Payload CMS＋Next.js 两个可丢弃原型共用的、框架无关
合同。它不是正式应用，不包含真实手办数据或图片，也不会访问 Hpoi。

## 目录

- `fixtures/domain_fixture.json`：完全虚构、关系明确的统一数据集；图片只有生成参数。
- `schemas/`：fixture、candidate upsert 与原型验收结果的 JSON Schema。
- `acceptance_contract.json`：AC-01—AC-30 的机器可读目录和评分映射。
- `fixture_contract.py`：fixture 关系、场景、合成性与无二进制完整性检查。
- `synthetic_media.py`：只在运行时生成小 PNG，并计算尺寸、SHA-256 与 64 位 aHash。
- `reference_contract.py`：候选来源键、幂等 upsert、URL fallback 迁移和正式数据隔离的纯 Python 参考。
- `acceptance_result.py`：两个原型测试运行器用于生成同结构结果的 recorder。
- `validate_results.py`：读取两个原型实际结果，校验结构并重算通过/失败/未运行数。
- `network_guard.py`：在 DNS 或 HTTP 发生前拒绝 Hpoi 根域及任意子域。
- `python_candidate_client/`：同一候选 upsert 客户端的 Wagtail/Payload adapter。
- `tests/`：全部离线的合同、客户端、网络禁令与防伪结果测试。

## 统一 fixture

fixture 固定包含：2 个虚构作品、4 个角色（两个同名但作品不同）、3 个厂商
（一个 draft）、5 个独立原型、8 个版本、5 个来源、4 个候选，以及 11 个
图片描述。每个候选有两张图片描述；其中包含成人图片、已人工选择的正式主图、
来源失效但仍发布的正式原型、相似动作但不同厂商的两个独立原型、多人原型、
四种版本归属同一原型和候选试图修改已有主图的场景。

`source_url` 均使用保留的 `.invalid` 域名。任何 PNG 都由
`synthetic_media.py` 在测试或 seed 的临时目录中生成，不提交二进制。

## 运行共享离线检查

```powershell
python spikes/val02_contract/fixture_contract.py
python -m unittest discover -s spikes/val02_contract/tests -v
python -m compileall -q spikes/val02_contract
python spikes/val02_contract/python_candidate_client/client.py --adapter wagtail --dry-run
python spikes/val02_contract/python_candidate_client/client.py --adapter payload --dry-run
```

`--dry-run` 不读取 Token、不开 socket，只检查统一请求形状和媒体元数据。

如需目视检查动态 PNG，只能写入仓库之外的临时目录：

```powershell
python spikes/val02_contract/synthetic_media.py `
  --output-dir "$env:TEMP/figure-gallery-val02-synthetic-media"
```

脚本会拒绝把生成媒体写入仓库。

## 原型生成验收结果

两个原型必须在各自测试/验收 runner 中调用 `AcceptanceRecorder`，不能手写一份
全部通过的 JSON：

```python
from spikes.val02_contract.acceptance_result import AcceptanceRecorder

recorder = AcceptanceRecorder.from_source_files(
    prototype="wagtail",  # Payload 使用 "payload"
    runner="django-test-runner",
    command="python manage.py test --emit-acceptance",
    source_files=["path/to/real/test.py", "path/to/service.py"],
    runtime={"python": "..."},
)
recorder.record(
    "AC-01",
    "pass",
    kind="automated_test",
    reference="test_source_upsert_is_idempotent",
    observed="second upsert kept one source and returned unchanged",
)
# AC-02—AC-30 由对应真实测试继续记录。
recorder.write("spikes/val02_wagtail/acceptance-results.json")
```

每个结果必须含当前 fixture 的 SHA-256、生成 runner/命令、仓库相对的真实
`source_files` 与由这些文件计算的源码摘要，以及
30 项具体 evidence。输入结果禁止包含 `overall` 或 `pass_count`；这些值由共享
validator 重算。`not_run` 必须引用明确的 `blocker`，不能伪装成通过。

两个原型结果都生成后运行：

```powershell
python spikes/val02_contract/validate_results.py `
  --wagtail spikes/val02_wagtail/acceptance-results.json `
  --payload spikes/val02_payload/acceptance-results.json
```

只有确实要求两边 30/30 时才增加 `--require-all-pass`。环境阻塞应如实保留
`not_run`，不能为了通过 validator 手工改状态。

## 候选客户端边界

两个 adapter 发送完全相同的 body：

```json
{
  "protocol_version": 1,
  "operation": "candidate_upsert",
  "candidate": {}
}
```

客户端仅允许 loopback endpoint，只公开 `upsert_candidate(s)`，没有正式实体或
主图写方法。Wagtail 使用运行时 `VAL02_WAGTAIL_CANDIDATE_TOKEN`；Payload 使用
运行时 `VAL02_PAYLOAD_CANDIDATE_TOKEN`，Authorization 为 Payload 3 的
`users API-Key <token>`。客户端会发送图片的生成描述、storage key、尺寸与哈希，
但不发送图片二进制/base64。

对正式原型或主图的恶意写入必须由各原型自己的 endpoint/access/hook 测试发起
并证明被拒绝；共享客户端本身不提供这种能力。

## 网络硬禁令

共享 fixture、reference、seed 和候选协议都不需要外部网络。测试用字符串只用于
证明 Hpoi 根域及任意子域在解析前会被拒绝，不会产生真实 DNS 或 HTTP 请求。
原型测试也必须安装等价网络 guard，并为 AC-30 输出真实测试证据。
