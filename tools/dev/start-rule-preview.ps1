#requires -Version 7.0
<#
.SYNOPSIS
このworktreeの公式ルールをDockerでローカル表示する。
.EXAMPLE
./tools/dev/start-rule-preview.ps1
#>
[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()][string]$Image = 'blackpoker-doc:latest'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$worktree = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$pathBytes = [Text.Encoding]::UTF8.GetBytes($worktree)
$pathStream = [IO.MemoryStream]::new($pathBytes)
try {
    $pathHash = (Get-FileHash -InputStream $pathStream).Hash.ToLowerInvariant().Substring(0, 24)
} finally {
    $pathStream.Dispose()
}
$containerName = "bp-rule-preview-$pathHash"

# Dockerに空きポートの確保を任せる。ホスト側はループバックだけで待ち受ける。
$runArguments = @(
    'run', '--rm', '-d', '--name', $containerName, '--publish', '127.0.0.1::8000',
    '--user', 'root', '--volume', "$($worktree):/work", '--workdir', '/work',
    '--pull', 'never', '--', $Image,
    'sphinx-autobuild', '--host', '0.0.0.0', '--port', '8000', './source', './build/rule-preview/html'
)
$containerId = docker @runArguments
if ($LASTEXITCODE -ne 0) {
    throw "プレビューを起動できませんでした。Dockerの出力とコンテナ名 $containerName を確認してください。"
}

$endpoint = docker port $containerId '8000/tcp'
if ($LASTEXITCODE -ne 0 -or $endpoint -notmatch '^127\.0\.0\.1:[1-9][0-9]*$') {
    throw "プレビューのURLを取得できませんでした。コンテナ $containerId の状態を確認してください。"
}

Write-Host "公式ルール: http://$endpoint/"
Write-Host "コアルール: http://$endpoint/core/core.html"
Write-Host "ログ: docker logs -f $containerId"
Write-Host "停止: docker stop $containerId"
