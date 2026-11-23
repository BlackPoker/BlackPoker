---
description: Release Task Issueを選択・起票し、BlackPokerの世代版と安定版のリリースを共通手順で進める
---

# BlackPokerのリリース作業を開始する (/bp-release)

入力例: `/bp-release Issue #123`、`/bp-release https://github.com/BlackPoker/BlackPoker/issues/123`、`/bp-release 第9.2版をリリースしたい`、`/bp-release`。

このworktreeの [AGENTS.md](../../AGENTS.md)、[共通開発手順](../../dev-notes/ai-dlc.md)、[リリース用手順](../../dev-notes/release-ai-dlc.md) を読む。既存Issueの選択または[Release Taskテンプレート](../../.github/ISSUE_TEMPLATE/release-task.md)からの起票、対象版と世代ブランチの確認、承認境界はリリース用手順に従う。

Issueが確定したら、基点の共通手順・開始スクリプトの有無を確認する。揃っていれば [開始スクリプト](../../tools/dev/start-issue.ps1) を `-Agent antigravity` で使用し、先に `-PlanOnly` を実行する。作成したIssue専用worktreeだけを開き、`.ai-dlc/` の記録を引き継ぐ。

その後の世代候補、`master` への昇格、世代ブランチへの反映、タグ、両サイト、GitHub Release、マイルストーンの確認と公開前の提示はリリース用手順に従う。既存worktreeや既存タグを変更・削除しない。
