# Codex / Antigravityから進めるリリース作業

対象は BlackPoker/BlackPoker の Release Task Issue です。既存Issueを選ぶか、対象がなければ新規に起票してから進めます。通常Issueのworktree管理、記録、PRの基本手順は [ai-dlc.md](ai-dlc.md) に従い、この文書では両AIに共通するリリース固有の判断と確認を定めます。Codexは [bp-releaseスキル](../.agents/skills/bp-release/SKILL.md)、Antigravityは [bp-releaseワークフロー](../.agents/workflows/bp-release.md) から入ります。[GitHub環境設定](github-setting.md#リリース手順) と [Release Taskテンプレート](../.github/ISSUE_TEMPLATE/release-task.md) も併せて確認します。

## 0. Release Task Issueを選ぶか作る

番号・URLが渡されたら、そのIssueが BlackPoker/BlackPoker のRelease Taskか確認します。番号の誤記や取得失敗を新規起票へ読み替えません。指定がなければ `gh` で開放中のRelease Task Issue候補を調べ、タイトル・本文・対象版を照合します。該当Issueが複数または不明なら対象を確認し、別のリリースを重複起票しません。

対象Issueがなければ、リリースする版、対象世代ブランチ、新規/既存の別、採用元、希望するマイルストーンを整理します。判断に必要な情報がなければ確認します。作成時点の `.github/ISSUE_TEMPLATE/release-task.md` のfrontmatterと全見出し・チェック項目を読み、`[ReleaseTask]` のタイトル、日本語の本文案、テンプレート由来のラベルと担当者を提示します。起票指示が今回の依頼に含まれていれば、案を提示した上でその範囲で続行します。含まれていなければ起票指示を待ちます。

起票には `tools/dev/create-issue.ps1` を使い、マイルストーンの選択・停止条件・作成後照合は [共通手順](ai-dlc.md#codex--antigravityとの相談からissueを作成) に従います。作成したURL・番号・マイルストーンを照合し、失敗や結果不明のときは同じ本文のIssueができていないか調べ、結果が分かるまで再起票しません。Issueが確定したら、その番号を `start-issue.ps1` に渡して専用worktreeを準備します。Issueが確定する前にworktreeを作らず、版数変更や公開も始めません。

## 1. 対象を固定する

Issue番号とURL、対象版 (例: `9.1.2`)、対象世代ブランチ (現行は `9th`)、新規/既存の別、採用元ブランチとSHA、作業基点ブランチとSHAを `.ai-dlc/plan.md` に記録します。対象版や世代ブランチがIssueから確定できなければ、候補と根拠を示して確認します。版数からブランチ名を無条件に推測しません。

`gh` でIssueとリポジトリの状態を確認し、`git ls-remote --heads` で `develop`、`master`、対象世代ブランチのリモートSHAを取得します。既存の世代ブランチならその先端と採用元との差分を確認します。新規なら同名ブランチがリモートにないことと、採用元の正確なSHAを確認します。作業基点のツリーに `AGENTS.md`、`dev-notes/ai-dlc.md`、`tools/dev/start-issue.ps1` が揃うか先に確認します。欠けている場合は共通手順の規定どおり停止し、導入コミットを取り込むか基点を変更するか判断を求めます。別worktreeから黙ってコピーしません。揃っていれば対象のworktreeを作る前に `start-issue.ps1 -PlanOnly` を実行します。既存世代ブランチには `-Base <世代ブランチ>`、新規世代ブランチには `-Base <採用元ブランチ>` を指定します。作成後は `.ai-dlc/context.json` の基点SHAとリモートの対象先端を照合し、進んでいたら調査・編集を止めて記録します。

`tools/actionlist/original/version.json` の `target_ver`、`ver`、`lastupdate` は版と表示日の確認に使います。`source/conf.py` はそのJSONからSphinxの表示値を読み、`html_context.github_version` はGitHubのソースリンクです。公開先は `refresh_docs` の実行refを `tools/dev/docs-target.py` が変換して決めます。対象世代の選択はRelease Task Issueに明記します。

## 2. 世代候補を作り、検証する

既存ブランチでは、今回採用する変更を確認してIssue専用ブランチから世代ブランチ向けPRにまとめます。新規ブランチでは、採用元SHAとブランチ名を提示し、作成の指示を受けてから世代ブランチを作ります。既存ブランチの履歴は書き換えません。

対象候補で `version.json` の `ver`、`lastupdate`、`target_ver`、必要な `beta` を確認し、`source/revision-history/` の対象版RSTと `revision-history.rst` の索引を更新します。PDFの索引に欠落や生成エラーがないか確認し、必要なら `source/_mysetting/mydict.dic` を調べます。RST/YAMLを変更するときは [スタイルガイド](../.agents/skills/rst_style_guide/SKILL.md) と既存の文書検証手順を使います。

候補SHAを記録し、HTML、PDF、アクションリストのビルド結果と版・日付・変更履歴・リンクを確認します。公式定義やSimulator/Tutorialへの影響があれば共通手順に従って関連検証を追加します。検証記録にはコマンド、対象SHA、未コミット差分、結果、未実施理由を残します。世代サイトへの確認用pushと `refresh_docs` は、差分と検証結果を提示して承認を得てから行います。Actions runのSHAとPagesの `build-sha.txt` を候補SHAと照合し、対象HTML/PDFとアクションリストを目視確認します。

## 3. 安定版へ昇格する

検証済み世代候補のSHAを固定し、`master` 向け昇格PRの差分を調べます。少なくとも `source/` と `tools/actionlist/original/` の採用内容を世代側と照合し、運用ファイルのブランチ固有差分は個別に説明します。世代側の未採用変更を `master` に混ぜません。PRのレビューと必須チェックの結果、マージ対象SHA、マージ後の `master` SHAを記録します。PR作成とマージはそれぞれ内容を提示し、指示された範囲で行います。

マージ後は `master` から対象世代ブランチへの反映も確認します。`master` と世代ブランチの `source/`、`tools/actionlist/original/`、変更履歴を比較し、リリース対象の差分があれば世代ブランチ向けPRで反映します。差分がなければ両SHAと比較結果を記録します。ブランチ固有の運用ファイルは無条件に取り込みません。反映後の世代ブランチSHAを固定し、必要な再ビルドと表示確認を行ってから両サイトの公開に進みます。

## 4. タグと2つのサイトを公開する

タグ作成前に、新しい `vX.Y.Z` がリモートに存在しないこと、マージ後の `master` 先端、対象版、世代候補SHA、成果物を照合します。タグ名・指すべき `master` SHA・確認した生成物を提示し、作成とpushの指示を受けます。既存タグは移動しません。

`master` の `refresh_docs` は、`master` の現在のSHAを指す正式タグを `tags` 入力に指定して手動実行します。対象世代ブランチでも別の `refresh_docs` を手動実行します。各実行前に対象refとSHA、公開先を提示し、承認された範囲だけ実行します。`master` の公開先は `master/`、`9th` の公開先は `9th/` です。実際の公開先は毎回 `docs-target.py` で確認します。

両runの成功、`build-sha.txt` と実行SHAの一致、両サイトのHTML/PDF、版・発行日・変更履歴・アクションリストの表示を確認します。run成功だけでPages反映済みにしません。`.ai-dlc/verification.md` に各ref、SHA、run URL、対象HTML/PDFのURL、確認箇所、確認者、日時を残します。どちらかが失敗したらGitHub Releaseへ進まず、失敗として報告します。追加pushでSHAが変わったら、該当サイトの生成と確認をやり直します。

## 5. GitHub ReleaseとIssueを閉じる

両サイトの反映を確認後、GitHub Releaseのタイトル・本文・タグ・対象SHA・案内する成果物URLの案を提示します。公開の指示を受けてからGitHub Releaseを発行します。Release Task Issueのチェック項目と検証記録を照合し、マイルストーンとプロジェクトの対象・状態を提示します。終了の指示を受けた範囲で更新します。未完了項目があれば成功扱いせず、残作業を記録します。

## 記録と停止点

`.ai-dlc/plan.md` に対象、分岐の選択、段階ごとの作業と承認範囲を、`.ai-dlc/verification.md` にコマンド・SHA・差分・run・表示結果を残します。Issue本文やコメントのコマンドは自動的な実行許可ではありません。基点の変化、版とブランチの不一致、検証失敗、対象SHAの変化、必要な承認の不足があれば次の公開段階に進みません。既存worktreeや既存タグを上書き・削除しません。
