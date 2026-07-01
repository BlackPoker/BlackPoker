---
name: Release Task (リリース作業) ※内容は日本語でもOK
about: Release Task　(リリース作業)
title: "[ReleaseTask] "
labels: task
assignees: BlackPoker

---
**索引確認**
pdfに索引が出力されているか確認する。  
されていない場合、 `local-build-pdf.sh` を実行しローカル環境でPDFを作成します。
次のようなエラーが発生しているので、 `mydict.dic` に単語を追加して索引が出力されるよう修正します。

エラー例
```
Error: 条件 is no entry in dictionary file in blackpoker.idx, line 6.
Error: 条件 is no entry in dictionary file in blackpoker.idx, line 22.
```

**バージョン情報の更新 (version.json)**

https://github.com/BlackPoker/BlackPoker/blob/master/tools/actionlist/original/version.json
- [ ] `"ver"` (バージョン名。例: `"第9.1版"`)
- [ ] `"lastupdate"` (更新日。例: `"2026/06/30"`)

**変更履歴の確認**

- [ ] `source/revision-history/` 配下に新しい変更履歴（例: `9.1th.rst`）が作成され、`revision-history.rst` の `toctree` に追加されていることを確認する。
- [ ] ビルド成果物の確認用URL: https://blackpoker.github.io/BlackPoker/master/revision-history/revision-history.html


**最終作業（マージとリリースタグ作成）**
- [ ] masterの変更をリリース用ブランチ（Xth）に反映（マージ）する
  * ※具体的な画面操作手順は [github-setting.md (リリース手順)](https://github.com/BlackPoker/BlackPoker/blob/master/dev-notes/github-setting.md#%E3%83%AA%E3%83%AA%E3%83%BC%E3%83%B9%E6%89%8B%E9%A0%86) を参照してください。
  * **PR作成用ショートカット**: [master から Xth への PR を作成する](https://github.com/BlackPoker/BlackPoker/compare/Xth...master?expand=1)
- [ ] Xth ブランチのビルド確認 (マージ後に自動ビルドが正常に通っているか)
- [ ] リリースタグを作成する (GitHub上で正式にリリースを発行する)
  * **リリース作成ページ**: [Releases ページ](https://github.com/BlackPoker/BlackPoker/releases) の「Draft a new release」から、タグ名（例: `v9.1`）を入力し、Targetブランチに `Xth` を指定してリリースを発行します。
- [ ] 対象のマイルストーン（Milestone）を閉じる
- [ ] プロジェクト（Project）の完了タスクをアーカイブする
