---
name: bp-release
description: BlackPoker/BlackPokerの既存Release Task Issueから、Codexで世代版と安定版のリリース準備・検証・公開を段階的に進める。通常の開発Issueや起票前の相談には使わない。
---

# Release Task Issueから作業する

入力例: `$bp-release Issue #123`、`$bp-release https://github.com/BlackPoker/BlackPoker/issues/123`。番号またはURLは既存のRelease Task Issueを指定する。

1. 現在のworktreeの [AGENTS.md](../../../AGENTS.md)、[共通開発手順](../../../dev-notes/ai-dlc.md)、[リリース用手順](../../../dev-notes/release-ai-dlc.md)を読む。入力がなければ `gh` で開放中のRelease Task Issue候補を調べ、ユーザーに対象を確認する。対象が確定するまでworktree作成・編集・公開操作をしない。対象確定後に既存のRelease Task Issueと、その時点の[テンプレート](../../../.github/ISSUE_TEMPLATE/release-task.md)を確認する。
2. リリース用手順に従い、対象版、対象世代ブランチ、採用元SHA、既存/新規ブランチ、リモートの `develop`・`master`・世代ブランチのSHAを調べる。現在の世代を `conf.py` だけから決めない。
3. 作業基点のツリーに `AGENTS.md`、`dev-notes/ai-dlc.md`、開始スクリプトがあることを事前確認する。欠けていれば共通手順の規定どおり停止し、導入コミットの取り込みか基点の変更を確認する。揃っていればIssue専用worktreeを[開始スクリプト](../../../tools/dev/start-issue.ps1)で準備する。既存世代ブランチならそのブランチを `-Base` に指定し、新規世代ブランチなら採用元のリモートブランチを指定する。先に `-PlanOnly` を実行する。既存worktreeのブランチをpull、checkout、resetしない。
4. `.ai-dlc/` に対象SHA、受入条件、各段階の検証結果と承認範囲を記録する。版数・変更履歴・索引・世代側の生成、`master` への昇格、固定タグ、`master` と世代別の両サイト、GitHub Release、マイルストーン終了をリリース用手順の順で扱う。公開前にはタグ、対象SHA、生成物、確認URLを提示する。

スキルの呼び出しだけでpush、ブランチ作成、PRマージ、タグ作成、Actions実行、GitHub Release公開、マイルストーン終了を許可されたとは扱わない。各段階の承認境界はリリース用手順に従う。
