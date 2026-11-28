#requires -Version 7.0
<#
.SYNOPSIS
複数のBlackPoker Issueに対し、個別のworktreeを準備する。
.EXAMPLE
./tools/dev/start-issues.ps1 -Issue 123,124 -Agent codex -PlanOnly
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][ValidateRange(1, [int]::MaxValue)][int[]]$Issue,
    [string]$RepoPath,
    [string]$Base,
    [ValidateSet('codex', 'antigravity')][string]$Agent,
    [string]$Remote,
    [string]$WorktreeRoot,
    [switch]$PlanOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (@($Issue | Sort-Object -Unique).Count -ne $Issue.Count) {
    throw '同じIssue番号が複数指定されています。'
}

$startIssue = Join-Path $PSScriptRoot 'start-issue.ps1'
$options = @{} + $PSBoundParameters
$options.Remove('Issue')
$options.Remove('PlanOnly')

# すべてのIssueを読み取り確認してから、作成に進む。
$failed = @(
    foreach ($number in $Issue) {
        try {
            & $startIssue @options -Issue $number -PlanOnly
        } catch {
            Write-Warning "BlackPoker/BlackPoker#${number} の事前確認に失敗しました。$_"
            $number
        }
    }
)
if ($failed.Count -gt 0) {
    throw "事前確認に失敗したIssue: $($failed -join ', ')。worktreeは作成していません。"
}
if ($PlanOnly) { return }

# 事前確認後の障害は個別に報告する。作成済みworktreeは開始スクリプトの方針どおり保持する。
$failed = @(
    foreach ($number in $Issue) {
        try {
            & $startIssue @options -Issue $number
        } catch {
            Write-Warning "BlackPoker/BlackPoker#${number} の準備に失敗しました。$_"
            $number
        }
    }
)
if ($failed.Count -gt 0) {
    throw "準備に失敗したIssue: $($failed -join ', ')。再実行前に対象のworktreeと作業記録を確認してください。"
}
