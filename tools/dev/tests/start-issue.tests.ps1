#requires -Version 7.0
# 外部テストライブラリ不要。ネットワーク操作は一時ローカルremoteに置換する。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:AiDlcRealGit = (Get-Command git -CommandType Application | Select-Object -First 1).Source
$global:AiDlcStartScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../start-issue.ps1'))
$global:AiDlcTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('blackpoker-ai-dlc-tests-' + [guid]::NewGuid().ToString('N'))
$global:AiDlcSeed = Join-Path $global:AiDlcTestRoot 'seed repo 日本語'
$global:AiDlcLocalRemote = Join-Path $global:AiDlcTestRoot 'remote.git'
$global:AiDlcOutputRoot = Join-Path $global:AiDlcTestRoot 'worktrees 日本語'
$global:AiDlcIssueState = 'OPEN'
$global:AiDlcFailGh = $false
$global:AiDlcFailFetch = $false
$global:AiDlcCalls = [Collections.Generic.List[string]]::new()
$global:AiDlcPassed = 0

function NativeGit {
    $result = & $global:AiDlcRealGit @args
    if ($LASTEXITCODE -ne 0) { throw "fixture git failed: $args" }
    $result -join "`n"
}
function git {
    $arguments = @($args)
    $global:AiDlcCalls.Add('git ' + ($arguments -join ' '))
    if ('push' -in $arguments) { throw '開始スクリプトからpushしてはいけません' }
    if ('fetch' -in $arguments -or 'ls-remote' -in $arguments) {
        if ($global:AiDlcFailFetch -and 'fetch' -in $arguments) { $global:LASTEXITCODE = 1; return }
        for ($i = 0; $i -lt $arguments.Count; $i++) {
            if ($arguments[$i] -in @('upstream', 'second')) { $arguments[$i] = $global:AiDlcLocalRemote }
        }
    }
    & $global:AiDlcRealGit @arguments
    $global:LASTEXITCODE = $LASTEXITCODE
}
function gh {
    $global:AiDlcCalls.Add('gh ' + ($args -join ' '))
    $global:LASTEXITCODE = 0
    if ($global:AiDlcFailGh) { $global:LASTEXITCODE = 1; return }
    if ($args[0] -eq 'repo' -and $args[1] -eq 'view') {
        return '{"nameWithOwner":"BlackPoker/BlackPoker","defaultBranchRef":{"name":"trunk-test"}}'
    }
    if ($args[0] -eq 'issue' -and $args[1] -eq 'view' -and '--repo' -in $args) {
        return (@{number=[int]$args[2]; url="https://github.com/BlackPoker/BlackPoker/issues/$($args[2])"; title='短い要望'; body='ルールを読みやすくする'; state=$global:AiDlcIssueState; labels=@()} | ConvertTo-Json)
    }
    throw "想定外のgh操作: $args"
}
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $global:AiDlcPassed++
    Write-Host "PASS: $Message"
}
function Expect-Failure([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    Assert-True $failed $Message
}
function Start-TestIssue {
    & $global:AiDlcStartScript -RepoPath $global:AiDlcSeed -WorktreeRoot $global:AiDlcOutputRoot @args
}

New-Item -ItemType Directory -Path $global:AiDlcSeed -Force | Out-Null
try {
    NativeGit init -b trunk-test $global:AiDlcSeed | Out-Null
    NativeGit -C $global:AiDlcSeed config user.name 'AI-DLC Test' | Out-Null
    NativeGit -C $global:AiDlcSeed config user.email 'test@example.invalid' | Out-Null
    NativeGit -C $global:AiDlcSeed config core.autocrlf false | Out-Null
    '/.ai-dlc/' | Set-Content (Join-Path $global:AiDlcSeed '.gitignore')
    'original' | Set-Content (Join-Path $global:AiDlcSeed 'tracked.txt')
    NativeGit -C $global:AiDlcSeed add . | Out-Null
    NativeGit -C $global:AiDlcSeed commit -m initial | Out-Null
    $defaultSha = NativeGit -C $global:AiDlcSeed rev-parse HEAD
    NativeGit -C $global:AiDlcSeed checkout -b release-test | Out-Null
    'release' | Set-Content (Join-Path $global:AiDlcSeed 'release.txt')
    NativeGit -C $global:AiDlcSeed add . | Out-Null
    NativeGit -C $global:AiDlcSeed commit -m release | Out-Null
    $releaseSha = NativeGit -C $global:AiDlcSeed rev-parse HEAD
    NativeGit init --bare $global:AiDlcLocalRemote | Out-Null
    NativeGit -C $global:AiDlcSeed push $global:AiDlcLocalRemote trunk-test release-test | Out-Null
    NativeGit -C $global:AiDlcSeed push $global:AiDlcLocalRemote HEAD:refs/heads/remote-only | Out-Null
    NativeGit -C $global:AiDlcSeed remote add upstream https://github.com/BlackPoker/BlackPoker.git | Out-Null
    'staged' | Set-Content (Join-Path $global:AiDlcSeed 'tracked.txt')
    NativeGit -C $global:AiDlcSeed add tracked.txt | Out-Null
    'unstaged' | Add-Content (Join-Path $global:AiDlcSeed 'tracked.txt')
    'untracked' | Set-Content (Join-Path $global:AiDlcSeed 'user.txt')
    $beforeStatus = NativeGit -C $global:AiDlcSeed status --porcelain=v1
    $beforeIndex = NativeGit -C $global:AiDlcSeed diff --cached
    $beforeDiff = NativeGit -C $global:AiDlcSeed diff

    Start-TestIssue -Issue 41 -PlanOnly
    Assert-True (-not (Test-Path $global:AiDlcOutputRoot)) 'PlanOnlyはファイルもworktreeも作らない'
    Assert-True (-not ($global:AiDlcCalls | Where-Object { $_ -match '\bfetch\b' })) 'PlanOnlyはfetchしない'
    Start-TestIssue -Issue 41
    $first = Join-Path $global:AiDlcOutputRoot 'BlackPoker-issue-41'
    $context = Get-Content (Join-Path $first '.ai-dlc/context.json') -Raw | ConvertFrom-Json
    Assert-True ($context.repo -eq 'BlackPoker/BlackPoker' -and $context.issue -eq 41) 'repoとIssueの組を記録'
    Assert-True ($context.base -eq 'trunk-test' -and $context.baseCommit -eq $defaultSha) '現在のHEADではなく取得したデフォルト基点から作成'
    Assert-True ((NativeGit -C $first rev-parse HEAD) -eq $defaultSha) '実際のworktreeのHEADが記録した基点と一致'
    Assert-True ((NativeGit -C $first status --porcelain=v1) -eq '') '作業記録はGit対象外'
    Assert-True ((NativeGit -C $first for-each-ref '--format=%(upstream)' refs/heads/issue-41) -eq '') '基点ブランチをpush追跡先に設定しない'
    Assert-True (-not (Test-Path (Join-Path $global:AiDlcSeed '.git/FETCH_HEAD'))) '他作業のFETCH_HEADを変更しない'
    & $global:AiDlcStartScript -Issue 44 -RepoPath $first
    Assert-True (Test-Path (Join-Path $global:AiDlcTestRoot 'BlackPoker-worktrees/BlackPoker-issue-44/.ai-dlc/context.json')) '別worktreeから開始しても保存先を入れ子にしない'
    Expect-Failure { Start-TestIssue -Issue 41 } '既存ブランチを再利用しない'
    Expect-Failure { Start-TestIssue -Issue 41 -Branch other-41 } '既存保存先を上書きしない'

    Start-TestIssue -Issue https://github.com/BlackPoker/BlackPoker/issues/42 -Base release-test -Branch custom-42 -Agent antigravity
    $second = Join-Path $global:AiDlcOutputRoot 'BlackPoker-issue-42'
    $secondContext = Get-Content (Join-Path $second '.ai-dlc/context.json') -Raw | ConvertFrom-Json
    Assert-True ($secondContext.baseCommit -eq $releaseSha -and $secondContext.agent -eq 'antigravity' -and $secondContext.branch -eq 'custom-42') '明示基点・独自ブランチ・Antigravity選択を反映'
    Expect-Failure { Start-TestIssue -Issue https://github.com/Other/Other/issues/43 } '異なるリポジトリのURLを拒否'
    Expect-Failure { Start-TestIssue -Issue '../43' } '不正なIssue入力を拒否'
    Expect-Failure { Start-TestIssue -Issue 43 -Branch '@{-1}' } 'ブランチ展開構文を拒否'
    Expect-Failure { Start-TestIssue -Issue 43 -Base nonexistent } '存在しない基点でworktreeを作らない'
    Expect-Failure { Start-TestIssue -Issue 43 -Base nonexistent -PlanOnly } 'PlanOnlyでも基点の存在を確認'
    Expect-Failure { Start-TestIssue -Issue 43 -Branch remote-only } '既存リモートブランチを拒否'
    NativeGit -C $global:AiDlcSeed remote add second git@github.com:BlackPoker/BlackPoker.git | Out-Null
    Expect-Failure { Start-TestIssue -Issue 43 } 'remoteが曖昧なら停止'
    Start-TestIssue -Issue 43 -Remote second -PlanOnly
    NativeGit -C $global:AiDlcSeed remote remove second | Out-Null
    NativeGit -C $global:AiDlcSeed remote set-url --push upstream https://github.com/Other/Other.git | Out-Null
    Expect-Failure { Start-TestIssue -Issue 43 } '異なるpush先を拒否'
    NativeGit -C $global:AiDlcSeed config --unset remote.upstream.pushurl | Out-Null
    $global:AiDlcIssueState = 'CLOSED'
    Expect-Failure { Start-TestIssue -Issue 43 } '閉じたIssueは停止'
    $global:AiDlcIssueState = 'OPEN'
    $global:AiDlcFailGh = $true
    Expect-Failure { Start-TestIssue -Issue 43 } 'ghエラーを無視しない'
    $global:AiDlcFailGh = $false
    $global:AiDlcFailFetch = $true
    Expect-Failure { Start-TestIssue -Issue 43 } 'fetchエラーで停止'
    $global:AiDlcFailFetch = $false
    Expect-Failure { & $global:AiDlcStartScript -Issue 43 -RepoPath $global:AiDlcSeed -WorktreeRoot (Join-Path $first 'nested') } '他の既存worktree内への作成を拒否'
    Assert-True (-not (Test-Path (Join-Path $global:AiDlcOutputRoot 'BlackPoker-issue-43'))) '失敗ケースは新規worktreeを残さない'
    Assert-True ((NativeGit -C $global:AiDlcSeed symbolic-ref --short HEAD) -eq 'release-test') '元のブランチを維持'
    Assert-True ((NativeGit -C $global:AiDlcSeed status --porcelain=v1) -eq $beforeStatus) '未追跡・stage済み・未stageの状態を維持'
    Assert-True ((NativeGit -C $global:AiDlcSeed diff --cached) -eq $beforeIndex -and (NativeGit -C $global:AiDlcSeed diff) -eq $beforeDiff) '元のindexと作業差分の内容を維持'
    Assert-True (-not ($global:AiDlcCalls | Where-Object { $_ -match '^gh (issue create|pr |workflow )|^git .*\s(push|reset|stash)(?:\s|$)' })) '公開・reset・stash操作を実行しない'
    Write-Host "検証完了: $global:AiDlcPassed checks passed"
} finally {
    # このテストが作成したランダム名の一時ディレクトリのみ削除する。
    $resolved = [IO.Path]::GetFullPath($global:AiDlcTestRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -match '^blackpoker-ai-dlc-tests-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    } else { throw '一時ディレクトリの削除対象が想定外です' }
}
