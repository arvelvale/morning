param(
  [ValidateSet('debug', 'release')]
  [string]$BuildMode = 'release'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'cloud-debug.local.json'
$hvigor = 'D:\DevEco Studio\tools\hvigor\bin\hvigorw.bat'

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "缺少 $configPath；复制 cloud-debug.example.json 后填写低权限测试账号。"
}
if (-not (Test-Path -LiteralPath $hvigor)) {
  throw "找不到 Hvigor：$hvigor"
}

$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$username = [string]$config.username
$password = [string]$config.password
if ($username.Length -lt 3 -or $password.Length -lt 12) {
  throw '云调试测试账号配置不合法：用户名至少 3 位，密码至少 12 位。'
}

$env:DEVECO_SDK_HOME = 'D:\DevEco Studio\sdk'
$env:NODE_HOME = 'D:\DevEco Studio\tools\node'
$outputDirectory = Join-Path $projectRoot 'build\outputs\cloudDebug'
$unsignedArtifact = Join-Path $outputDirectory 'harmony-cloudDebug-unsigned.app'
$artifact = Join-Path $outputDirectory 'harmony-cloudDebug-signed.app'

# BundleTool 不覆盖同名 APP。只清理本 product 的明确生成物，避免误伤其他构建。
foreach ($oldArtifact in @($unsignedArtifact, $artifact)) {
  if (Test-Path -LiteralPath $oldArtifact) {
    Remove-Item -LiteralPath $oldArtifact -Force
  }
}

Push-Location $projectRoot
try {
  & $hvigor --mode project `
    -p product=cloudDebug `
    -p buildMode=$BuildMode `
    -p cloudDebugUsername=$username `
    -p cloudDebugPassword=$password `
    assembleApp --no-daemon --stacktrace
  if ($LASTEXITCODE -ne 0) {
    throw "cloudDebug 构建失败，Hvigor exit code: $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $artifact)) {
  throw "Hvigor 已结束，但没有找到签名产物：$artifact"
}

$item = Get-Item -LiteralPath $artifact
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifact
[pscustomobject]@{
  Path = $item.FullName
  Length = $item.Length
  LastWriteTime = $item.LastWriteTime
  SHA256 = $hash.Hash
} | Format-List
