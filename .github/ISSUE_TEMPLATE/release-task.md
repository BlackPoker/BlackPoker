---
name: Release Task (リリース作業) ※内容は日本語でもOK
about: Release Task　(リリース作業)
title: "[ReleaseTask] "
labels: task
assignees: BlackPoker

---
**索引確認**
pdfに索引が出力されているか確認する。  
されていない場合、ローカル環境でPDFを作成し、おそらくエラーが発生しているので、
mydict.dicに単語を追加して索引が出力されるよう修正する。

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
- [ ] merge(master->Xth)
- [ ] Xth build
- [ ] Xth tag
- [ ] close milestone
- [ ] archive the project's done
