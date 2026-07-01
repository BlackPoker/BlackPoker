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

**Action/ExtraList update**

https://github.com/BlackPoker/BlackPoker/blob/master/tools/actionlist/original/act.yaml
- [ ] ver 
- [ ] lastupdate

https://github.com/BlackPoker/BlackPoker/blob/master/tools/actionlist/original/extra.yaml
- [ ] v 
- [ ] lastupdate

**Document update**

https://github.com/BlackPoker/BlackPoker/blob/master/source/conf.py
- [ ] version

**Release Note update**
wiki
- [ ] https://github.com/BlackPoker/BlackPoker/wiki/Xth-edition-changes

or

rst
- [ ] https://blackpoker.github.io/BlackPoker/master/revision-history/revision-history.html


**Finish**
- [ ] masterの変更をリリース用ブランチ（Xth）に反映（マージ）する
  * ※具体的な画面操作手順は [github-setting.md (リリース手順)](https://github.com/BlackPoker/BlackPoker/blob/master/dev-notes/github-setting.md#%E3%83%AA%E3%83%AA%E3%83%BC%E3%83%B9%E6%89%8B%E9%A0%86) を参照してください。
  * **PR作成用ショートカット**: [master から Xth への PR を作成する](https://github.com/BlackPoker/BlackPoker/compare/Xth...master?expand=1)
- [ ] Xth build (マージ後の自動ビルド確認)
- [ ] Xth tag (GitHub上でリリースタグを作成する)
  * **リリース作成ページ**: [Releases ページ](https://github.com/BlackPoker/BlackPoker/releases) の「Draft a new release」から、タグ名（例: `v9.1`）を入力し、Targetブランチに `Xth` を指定してリリースを発行します。
- [ ] close milestone
- [ ] archive the project's done
