# 縦スクロールHowToへの変更計画

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
