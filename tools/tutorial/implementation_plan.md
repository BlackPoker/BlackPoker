# 最初の1ゲームを始めるHowToへの改善計画

基準: e41b60d9dd924288971b3e99753a3f27b1ae4f00（開始時fetch、local / origin一致、clean）。

1. 既存8ファイル・教材データ・公開範囲を確認し、既存機能、部分対応、未対応、旧導線との矛盾を整理する。
2. book-layoutにfirst-game / learn-more / referenceを定義。Entry16を実物直前へ送り、milestoneを追加。既存操作エンジンは変更しない。
3. 目次・進捗・次への意味をtrackに合わせ、Referenceと体系説明は折りたたみへ。防壁設置はプリセットを根拠に応用へ移す。
4. 旧保存の解放範囲を保持する。hash・旧Lesson/30操作保存・先攻は維持し、順序変更で勝手に解放しない。
5. DockerでTutorial全テスト・schema・build・Simulator回帰、390×844全導線と1440×900の入力・Referenceを実ブラウザ検証する。
6. 初心者自己レビュー・文書更新・差分確認後、日本語コミット、現在ブランチへpush、local/remote一致とcleanを確認する。

検証結果と実装判断はHOWTO_REPORT.mdの最新報告に記載する。

## 前回の計画・実施記録（履歴）

基準: 05577b2b9d7c104e6104aef9f820d158722f4c8b（fetch後local / origin一致、開始時clean）。

1. 既存のscene / micro step / interactionを保持し、PLAYER A向けの独立fixtureを作る。相手処理はデータで自動表示と指定し、Lesson固有のエンジン分岐は加えない。
2. 共通PlayingCardでrankとsuitを1組だけ縦表示。表示文字列の♥♦統一はTutorial内に閉じ、正規YAMLのID・ルールは変えない。
3. INTRO・向き・Lessonを共通HowToSectionへ並べる。到達済み本文は残し、「次へ」は続きの解放とスクロール。目次・hash・reduced motion・保存移行に対応する。
4. 旧Lesson保存と30操作の保存を破壊せず、新しいSection保存へ移行する。実物準備は先攻選択・開始時1ドローを保持する。
5. fixture・カード・スクロール・保存・既存操作の回帰をテスト。DockerでTutorial全テスト、教材検証、build、Simulator全回帰を実行する。
6. 390×844と1440×900で実ブラウザ確認し、ドキュメント更新、差分レビュー、日本語コミット、現在ブランチへpush、HEAD一致とcleanを確認する。

今回は未完成の魔法・複数ブロック等を実装しない。Simulatorソース、Docker運用、Pages workflowは変更しない。

## 実施結果

- 1〜4: 実装済み。本文を保持し、PLAYER A操作・相手automatic・防壁設置の責務分離・共通カード・保存移行に対応。
- 5: DockerでTutorial 128テスト、教材検証、production build、Simulator 113テストが成功。
- 6: IABとDocker Chromiumで390×844 / 1440×900を確認。実ドラッグ・キーボードも成功。報告書・README・学習対応表を更新。コミット/push後のHEAD一致とcleanは最終報告へ記載する。
