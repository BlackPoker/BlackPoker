#requires -Version 7.0
<#
.SYNOPSIS
テンプレートから準備した本文でIssueを起票し、マイルストーンを確認する。
.EXAMPLE
pwsh -File tools/dev/create-issue.ps1 -Title '[KAIZEN] 改善案' -BodyFile issue-body.md -Label enhancement -Assignee BlackPoker
.EXAMPLE
pwsh -File tools/dev/create-issue.ps1 -Title '[KAIZEN] 改善案' -BodyFile issue-body.md -Milestone '10.0'
#>
[CmdletBinding()]
param(
    [ValidateSet('BlackPoker/BlackPoker')][string]$Repo = 'BlackPoker/BlackPoker',
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Title,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$BodyFile,
    [string[]]$Label = @(),
    [string[]]$Assignee = @(),
    [string]$Milestone,
    [switch]$NoMilestone
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($NoMilestone -and $PSBoundParameters.ContainsKey('Milestone')) {
    throw '-Milestone と -NoMilestone は同時に指定できません。'
}
if ($PSBoundParameters.ContainsKey('Milestone') -and [string]::IsNullOrWhiteSpace($Milestone)) {
    throw '-Milestone に空の名前は指定できません。'
}
Get-Command gh -ErrorAction Stop | Out-Null
$bodyPath = (Resolve-Path -LiteralPath $BodyFile -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $bodyPath -PathType Leaf)) { throw '本文はファイルを指定してください。' }

function Invoke-Gh {
    param([string[]]$Arguments)
    $output = & gh @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($Arguments[0]) $($Arguments[1]) が失敗しました (exit=$LASTEXITCODE)。Issueの作成を再試行する前にGitHub上の結果を確認してください。"
    }
    return ($output -join "`n")
}

# ページ境界の候補も比較するため、取得結果をまとめてから選択する。
$json = Invoke-Gh -Arguments @('api', '--paginate', '--slurp', "repos/$Repo/milestones?state=open&per_page=100")
try { $pages = ConvertFrom-Json -InputObject $json -NoEnumerate -ErrorAction Stop }
catch { throw "マイルストーン一覧のJSONを解析できません: $_" }
if ($null -eq $pages) { throw 'マイルストーン一覧が空の応答です。' }
$openMilestones = @(
    foreach ($page in $pages) {
        if ($null -eq $page) { throw 'マイルストーン一覧に不正なページがあります。' }
        foreach ($item in $page) {
            if ($item.state -ne 'open' -or [string]::IsNullOrWhiteSpace($item.title) -or $item.number -notmatch '^[1-9][0-9]*$') {
                throw 'マイルストーン一覧に不正な候補があります。'
            }
            $item
        }
    }
)

$chosen = $null
if ($NoMilestone) {
    Write-Host '明示指定によりマイルストーンなしで起票します。'
} elseif ($PSBoundParameters.ContainsKey('Milestone')) {
    $matches = @($openMilestones | Where-Object { $_.title -eq $Milestone })
    if ($matches.Count -ne 1) { throw "開放中のマイルストーン '$Milestone' を一意に特定できません。Issueは作成していません。" }
    $chosen = $matches[0]
} else {
    $dated = @(
        foreach ($item in $openMilestones) {
            if ($null -eq $item.due_on -or $item.due_on -eq '') { continue }
            $due = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse([string]$item.due_on, [ref]$due)) {
                throw "マイルストーン '$($item.title)' の期限を解析できません。Issueは作成していません。"
            }
            [pscustomobject]@{ Item = $item; Due = $due; Number = [int]$item.number }
        }
    )
    if ($dated.Count -eq 0) {
        throw '期限付きの開放中マイルストーンがありません。-Milestone で指定するか、確認後に -NoMilestone を指定してください。Issueは作成していません。'
    }
    $chosen = ($dated | Sort-Object Due, Number | Select-Object -First 1).Item
}

$argsForCreate = @('issue', 'create', '--repo', $Repo, '--title', $Title, '--body-file', $bodyPath)
foreach ($labelName in $Label) { $argsForCreate += @('--label', $labelName) }
foreach ($login in $Assignee) { $argsForCreate += @('--assignee', $login) }
if ($null -ne $chosen) { $argsForCreate += @('--milestone', [string]$chosen.title) }
$result = Invoke-Gh $argsForCreate
$match = [regex]::Match($result.Trim(), '^https://github\.com/BlackPoker/BlackPoker/issues/([1-9][0-9]*)$')
if (-not $match.Success) {
    throw "起票結果のURLを確認できません。GitHub上で重複を確認してから対応してください。応答: $result"
}
$issueNumber = $match.Groups[1].Value
$issueUrl = $match.Value

try {
    $created = Invoke-Gh -Arguments @('issue', 'view', $issueNumber, '--repo', $Repo, '--json', 'number,url,milestone') | ConvertFrom-Json -ErrorAction Stop
} catch {
    throw "Issueは作成されましたが、設定結果を取得できません: $issueUrl。再起票しないでください。詳細: $_"
}
if ([string]$created.number -ne $issueNumber -or $created.url -ne $issueUrl) {
    throw "Issueは作成されましたが、照合結果が一致しません: $issueUrl。再起票しないでください。"
}
if ($null -ne $chosen) {
    if ($null -eq $created.milestone -or [string]$created.milestone.number -ne [string]$chosen.number -or $created.milestone.title -ne $chosen.title) {
        throw "Issueは作成されましたが、マイルストーンが '$($chosen.title)' と一致しません: $issueUrl。再起票しないでください。"
    }
} elseif ($null -ne $created.milestone) {
    throw "Issueは作成されましたが、マイルストーンなしの指定と一致しません: $issueUrl。再起票しないでください。"
}
Write-Host "起票とマイルストーン確認が完了しました: $issueUrl"
$issueUrl
