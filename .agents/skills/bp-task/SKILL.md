---
name: bp-task
description: BlackPoker/BlackPokerで、既存IssueからIssue専用worktreeでの調査・実装・検証とDraft PR準備を進める。Issue発行前の相談には使わない。
---

# BlackPokerの作業を開始する

入力例: `$bp-task Issue #123`、`$bp-task https://github.com/BlackPoker/BlackPoker/issues/123`。

1. 現在のリポジトリルートを確認し、その [AGENTS.md](../../../AGENTS.md) と [共通開発手順](../../../dev-notes/ai-dlc.md) を読む。
2. Issue番号またはURLがない場合は対象を確認する。発行前の相談には `$bp-task-plan` を使う。共通開発手順の「短い依頼の扱い」に従って入力と今回の指示範囲を整理し、「Issueの入口」から順に進める。作業領域の準備には [既存の開始スクリプト](../../../tools/dev/start-issue.ps1) を `-Agent codex` で使用する。
3. 作成したworktreeへ作業ディレクトリを移し、その規約と `.ai-dlc/` の資料を読む。以後の調査・計画・実装・検証・公開前の確認・Draft PRは共通開発手順に従う。

パスはこのスキルを含むworktreeを基準に解決する。既存worktreeの衝突と再開の判断も共通手順に従い、別作業を自動的に引き継がない。
スキル呼び出しを公開操作の包括的な許可と解釈しない。承認範囲と作業結果は共通手順の作業記録に残す。
