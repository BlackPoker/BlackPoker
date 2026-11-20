#requires -Version 7.0
# 実際のGitHubには接続しない。ghを置き換えて起票前後の動作を確認する。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:CreateIssueScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../create-issue.ps1'))
$global:CreateIssueTemp = Join-Path ([IO.Path]::GetTempPath()) ('blackpoker-create-issue-tests-' + [guid]::NewGuid().ToString('N'))
$global:CreateIssueBody = Join-Path $global:CreateIssueTemp '本文.md'
$global:ApiJson = '[[{"number":16,"title":"10.0","state":"open","due_on":"2027-03-31T00:00:00Z"},{"number":14,"title":"9.2","state":"open","due_on":"2026-11-30T00:00:00Z"}]]'
$global:GhFailure = ''
$global:ViewMilestoneOverride = ''
$global:GhCalls = [Collections.Generic.List[string]]::new()
$global:CreateArguments = @()
$global:Checks = 0

function gh {
    $arguments = @($args)
    $global:GhCalls.Add($arguments -join ' ')
    $global:LASTEXITCODE = 0
    if ($arguments[0] -eq 'api') {
        if ($global:GhFailure -eq 'api') { $global:LASTEXITCODE = 1; return }
        return $global:ApiJson
    }
    if ($arguments[0] -eq 'issue' -and $arguments[1] -eq 'create') {
        $global:CreateArguments = $arguments
        if ($global:GhFailure -eq 'create') { $global:LASTEXITCODE = 1; return }
        return 'https://github.com/BlackPoker/BlackPoker/issues/800'
    }
    if ($arguments[0] -eq 'issue' -and $arguments[1] -eq 'view') {
        if ($global:GhFailure -eq 'view') { $global:LASTEXITCODE = 1; return }
        $idx = [array]::IndexOf($global:CreateArguments, '--milestone')
        $milestone = $null
        if ($idx -ge 0) {
            $title = [string]$global:CreateArguments[$idx + 1]
            $number = if ($title -eq '9.2') { 14 } elseif ($title -eq '10.0') { 16 } else { 17 }
            $milestone = @{ number = $number; title = $title }
        }
        if ($global:ViewMilestoneOverride -eq 'none') { $milestone = $null }
        if ($global:ViewMilestoneOverride -eq 'wrong') { $milestone = @{ number = 99; title = '別のマイルストーン' } }
        return (@{ number = 800; url = 'https://github.com/BlackPoker/BlackPoker/issues/800'; milestone = $milestone } | ConvertTo-Json -Compress)
    }
    throw "想定外のgh操作: $arguments"
}
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $global:Checks++
    Write-Host "PASS: $Message"
}
function Expect-Failure([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-True $failed $Message
}
function Reset-Case {
    $global:GhCalls.Clear()
    $global:CreateArguments = @()
    $global:GhFailure = ''
    $global:ViewMilestoneOverride = ''
}
function New-TestIssue {
    & $global:CreateIssueScript -Title '[KAIZEN] テスト' -BodyFile $global:CreateIssueBody -Label enhancement -Assignee BlackPoker @args | Out-Null
}

New-Item -ItemType Directory -Path $global:CreateIssueTemp | Out-Null
try {
    '本文' | Set-Content -LiteralPath $global:CreateIssueBody -Encoding utf8

    Reset-Case
    New-TestIssue
    $idx = [array]::IndexOf($global:CreateArguments, '--milestone')
    Assert-True ($idx -ge 0 -and $global:CreateArguments[$idx + 1] -eq '9.2') '最短期限9.2を選ぶ'
    Assert-True ($global:GhCalls[0] -match '--paginate --slurp') '開放中候補を全ページ取得する'
    Assert-True ('--label' -in $global:CreateArguments -and '--assignee' -in $global:CreateArguments) 'テンプレートのラベルと担当者を渡す'
    Assert-True ($global:GhCalls.Count -eq 3) '起票後にIssueを確認する'

    Reset-Case
    $global:ApiJson = '[[{"number":20,"title":"20","state":"open","due_on":"2026-11-30T00:00:00Z"}],[{"number":14,"title":"9.2","state":"open","due_on":"2026-11-30T00:00:00Z"}]]'
    New-TestIssue
    $idx = [array]::IndexOf($global:CreateArguments, '--milestone')
    Assert-True ($global:CreateArguments[$idx + 1] -eq '9.2') '別ページの同期限候補は番号の小さい方を選ぶ'

    Reset-Case
    $global:ApiJson = '[[{"number":17,"title":"無期限","state":"open","due_on":null},{"number":14,"title":"9.2","state":"open","due_on":"2026-11-30T00:00:00Z"}]]'
    New-TestIssue
    $idx = [array]::IndexOf($global:CreateArguments, '--milestone')
    Assert-True ($global:CreateArguments[$idx + 1] -eq '9.2') '無期限候補を自動選択しない'
    Reset-Case
    New-TestIssue -Milestone '無期限'
    $idx = [array]::IndexOf($global:CreateArguments, '--milestone')
    Assert-True ($global:CreateArguments[$idx + 1] -eq '無期限') '明示指定を最短期限より優先する'

    Reset-Case
    $global:ApiJson = '[[{"number":17,"title":"無期限","state":"open","due_on":null}]]'
    Expect-Failure { New-TestIssue } '期限付き候補がなければ起票を停止する'
    Assert-True ($global:GhCalls.Count -eq 1) '候補なしでIssueを作成しない'
    Reset-Case
    New-TestIssue -NoMilestone
    Assert-True ('--milestone' -notin $global:CreateArguments) '明示されたマイルストーンなしを尊重する'
    Reset-Case
    $global:ViewMilestoneOverride = 'wrong'
    Expect-Failure { New-TestIssue -NoMilestone } 'マイルストーンなしの照合不一致を報告する'
    Assert-True ($global:GhCalls.Count -eq 3) 'マイルストーンなしの照合不一致でも再起票しない'
    Reset-Case
    Expect-Failure { New-TestIssue -Milestone '存在しない' } '存在しない明示指定を拒否する'
    Assert-True ($global:GhCalls.Count -eq 1) '明示指定の不一致でIssueを作成しない'
    Reset-Case
    Expect-Failure { New-TestIssue -Milestone '無期限' -NoMilestone } '矛盾する指定を拒否する'
    Assert-True ($global:GhCalls.Count -eq 0) '矛盾する指定ではAPIを呼ばない'

    Reset-Case
    $global:ApiJson = '[[{"number":14,"title":"9.2","state":"open","due_on":"不正な期限"}]]'
    Expect-Failure { New-TestIssue } '不正な期限では起票を停止する'
    Assert-True ($global:GhCalls.Count -eq 1) '不正な期限でIssueを作成しない'
    Reset-Case
    $global:ApiJson = '[[{"number":14,"title":"9.2","state":"open","due_on":"2026-11-30T00:00:00Z"}]]'
    $global:GhFailure = 'api'
    Expect-Failure { New-TestIssue } 'API失敗時は起票を停止する'
    Assert-True ($global:GhCalls.Count -eq 1) 'API失敗後にIssueを作成しない'
    Reset-Case
    $global:GhFailure = 'create'
    Expect-Failure { New-TestIssue } '起票失敗を成功扱いしない'
    Assert-True ($global:GhCalls.Count -eq 2) '起票失敗後に再起票しない'
    Reset-Case
    $global:GhFailure = 'view'
    Expect-Failure { New-TestIssue } '起票後の取得失敗を報告する'
    Assert-True ($global:GhCalls.Count -eq 3) '確認失敗後に再起票しない'
    Reset-Case
    $global:ViewMilestoneOverride = 'wrong'
    Expect-Failure { New-TestIssue } '起票後のマイルストーン不一致を報告する'
    Assert-True ($global:GhCalls.Count -eq 3) '不一致時にも再起票しない'
    Write-Host "検証完了: $global:Checks checks passed"
} finally {
    $resolved = [IO.Path]::GetFullPath($global:CreateIssueTemp)
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^blackpoker-create-issue-tests-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    } else { throw '一時ディレクトリの削除対象が想定外です' }
}
