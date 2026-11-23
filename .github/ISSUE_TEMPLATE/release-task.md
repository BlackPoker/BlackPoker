---
name: Release Task (リリース作業) ※内容は日本語でもOK
about: Release Task　(リリース作業)
title: "[ReleaseTask] "
labels: task
assignees: BlackPoker

---
**対象の確認**

- [ ] リリース対象版、対象世代ブランチ (第9版なら `9th`)、採用元と基点SHAを記録する。`tools/actionlist/original/version.json` の `target_ver` と対象世代ブランチを照合する。

**索引確認**

- [ ] PDFに索引が出ている。索引の生成エラーがあれば `source/_mysetting/mydict.dic` を確認する。

**バージョン情報の更新 (version.json)**

- [ ] `tools/actionlist/original/version.json` の `ver` と `lastupdate` を対象世代の候補で更新する。

**変更履歴の確認**

- [ ] `source/revision-history/` に変更履歴を追加し、`revision-history.rst` の一覧に登録する。
- [ ] 世代別の確認サイトでHTML/PDF、変更履歴、アクションリストを確認し、生成元SHAとActionsのURLを記録する。

**最終作業 (マージとリリースタグ作成)**

- [ ] 検証済みの世代の内容を `master` 向けの昇格PRにまとめ、レビューと必須チェック後にマージする。
- [ ] マージ後の `master` と対象世代ブランチを照合し、リリース対象の差分があれば世代ブランチ向けPRで反映する。差分がなければ両SHAと照合結果を記録する。
- [ ] マージ後の `master` のSHAに新しい正式リリースタグ `vX.Y.Z` を作成する。
- [ ] 正式タグを指定して `master` の `refresh_docs` を手動実行し、[安定版HTML](https://blackpoker.github.io/BlackPoker/master/) と [安定版PDF](https://blackpoker.github.io/BlackPoker/master/blackpoker.pdf) の表示を確認する。公開元SHAとActionsのURLを記録する。
- [ ] 対象世代ブランチでも `refresh_docs` を手動実行し、その世代のHTML/PDF、変更履歴、アクションリストを確認する。世代側の公開元SHAとActionsのURLを記録する。
- [ ] GitHub Releaseを発行し、対象のマイルストーンとプロジェクトを整理する。

詳細は [リリース手順](https://github.com/BlackPoker/BlackPoker/blob/develop/dev-notes/github-setting.md#リリース手順) と [Codex用の段階別手順](https://github.com/BlackPoker/BlackPoker/blob/develop/dev-notes/release-ai-dlc.md) を参照。
