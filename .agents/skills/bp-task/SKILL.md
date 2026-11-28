---
name: bp-task
description: BlackPoker/BlackPokerで、既存IssueからIssue専用worktreeでの調査・実装・検証とDraft PR準備を進める。Issue発行前の相談には使わない。
---

# BlackPokerの作業を開始する

入力例: `$bp-task Issue #123`、`$bp-task https://github.com/BlackPoker/BlackPoker/issues/123`。

1. 現在のリポジトリルートを確認し、その [AGENTS.md](../../../AGENTS.md) と [共通開発手順](../../../dev-notes/ai-dlc.md) を読む。
2. Issue番号またはURLがない場合は対象を確認する。発行前の相談には `$bp-task-plan` を使う。共通開発手順の「短い依頼の扱い」に従って入力と今回の指示範囲を整理し、「Issueの入口」から順に進める。
3. 通常の作業基点は `develop` とし、明示された別の基点がなければ [開始スクリプト](../../../tools/dev/start-issue.ps1) に `-Base develop -Agent codex` を渡す。先に `-PlanOnly` で対象Issue、remote、基点、衝突を確認してから通常実行する。開始スクリプトはリモートの最新基点を専用refへfetchしてworktreeを作る。既存worktreeで `git pull` して作業中のブランチを動かさない。
4. 作成したworktreeへ作業ディレクトリを移し、`.ai-dlc/context.json` の `baseCommit` が `git ls-remote --heads <remote> refs/heads/<base>` のSHAと一致することを確認する。一致しなければ調査・編集を始めず、基点が進んだことを報告する。そのworktreeの規約と `.ai-dlc/` の資料を読み、以後の調査・計画・実装・検証・公開前の確認・Draft PRは共通開発手順に従う。

[複数Issueの一括準備](../../../dev-notes/ai-dlc.md#複数の公式ルール修正を並行して進める)などで既に作成したworktreeを使う場合は、そのworktreeを開いて `$bp-task Issue #123 を再開` と依頼する。共通手順の再開時の照合を行い、手順3と4の新規作成に関する操作は省いて、記録を引き継ぐ。

パスはこのスキルを含むworktreeを基準に解決する。既存worktreeの衝突と再開の判断も共通手順に従い、別作業を自動的に引き継がない。
スキル呼び出しを公開操作の包括的な許可と解釈しない。承認範囲と作業結果は共通手順の作業記録に残す。
