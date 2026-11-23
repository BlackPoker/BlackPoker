---
name: bp-release
description: BlackPoker/BlackPokerのRelease Task Issueを選択・起票し、Codexで世代版と安定版のリリース準備・検証・公開を段階的に進める。通常の開発Issueには使わない。
---

# Release Task Issueから作業する

入力例: `$bp-release Issue #123`、`$bp-release https://github.com/BlackPoker/BlackPoker/issues/123`、`$bp-release 第9.2版をリリースしたい`、`$bp-release`。

1. 現在のworktreeの [AGENTS.md](../../../AGENTS.md)、[共通開発手順](../../../dev-notes/ai-dlc.md)、[リリース用手順](../../../dev-notes/release-ai-dlc.md)を読む。指定されたIssueを確認し、未指定なら `gh` で関連するRelease Task Issueの候補と重複を調べる。対象がなければ、作成時点の[Release Taskテンプレート](../../../.github/ISSUE_TEMPLATE/release-task.md)を使い、対象版・世代ブランチなど必要な情報を整理して日本語のタイトル・本文案を提示する。今回の依頼に起票指示があれば[起票スクリプト](../../../tools/dev/create-issue.ps1)で作成・照合して続行し、指示がなければ起票指示を待つ。Issueが確定するまでworktreeを作らない。
2. リリース用手順に従い、対象版、対象世代ブランチ、採用元SHA、既存/新規ブランチ、リモートの `develop`・`master`・世代ブランチのSHAを調べる。現在の世代を `conf.py` だけから決めない。
3. 作業基点のツリーに `AGENTS.md`、`dev-notes/ai-dlc.md`、開始スクリプトがあることを事前確認する。欠けていれば共通手順の規定どおり停止し、導入コミットの取り込みか基点の変更を確認する。揃っていればIssue専用worktreeを[開始スクリプト](../../../tools/dev/start-issue.ps1)で準備する。既存世代ブランチならそのブランチを `-Base` に指定し、新規世代ブランチなら採用元のリモートブランチを指定する。先に `-PlanOnly` を実行する。既存worktreeのブランチをpull、checkout、resetしない。
4. `.ai-dlc/` に対象SHA、受入条件、各段階の検証結果と承認範囲を記録する。版数・変更履歴・索引・世代側の生成、`master` への昇格、固定タグ、`master` と世代別の両サイト、GitHub Release、マイルストーン終了をリリース用手順の順で扱う。公開前にはタグ、対象SHA、生成物、確認URLを提示する。

Issue作成、push、ブランチ作成、PRマージ、タグ作成、Actions実行、GitHub Release公開、マイルストーン終了は、その時点までの依頼・承認範囲で行う。各段階の承認境界は共通手順とリリース用手順に従う。
