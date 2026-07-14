[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$gateDirectory = Split-Path -Parent $PSScriptRoot
$runtimeEnvPath = Join-Path $gateDirectory '.env'

if (Test-Path -LiteralPath $runtimeEnvPath) {
    throw "Runtime environment already exists at $runtimeEnvPath. Remove it explicitly before generating replacement credentials."
}

function New-HexSecret {
    param([ValidateRange(16, 128)][int]$ByteCount = 32)

    $bytes = [byte[]]::new($ByteCount)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

$runId = (New-HexSecret -ByteCount 6)
$postgresPassword = New-HexSecret
$minioPassword = New-HexSecret

$content = @"
COMPOSE_PROJECT_NAME=figure-gallery-payload-prod-gate-$runId

POSTGRES_PORT=55432
POSTGRES_DB=figure_gallery_payload_gate
POSTGRES_USER=payload_gate
POSTGRES_PASSWORD=$postgresPassword

MINIO_API_PORT=59000
MINIO_CONSOLE_PORT=59001
MINIO_ROOT_USER=payload_gate_$runId
MINIO_ROOT_PASSWORD=$minioPassword
MINIO_BUCKET=payload-prod-gate
"@

[IO.File]::WriteAllText(
    $runtimeEnvPath,
    $content,
    [Text.UTF8Encoding]::new($false)
)

Write-Host "Created an ignored runtime environment at $runtimeEnvPath"
Write-Host 'Secrets were written only to that file and were not printed.'
