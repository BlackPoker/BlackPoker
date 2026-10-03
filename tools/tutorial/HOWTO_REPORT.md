# 縦スクロールInteractive HowTo 実装報告

基準HEAD: `05577b2b9d7c104e6104aef9f820d158722f4c8b`。作業開始時にfetchし、local / origin一致、git status cleanを確認。
対象は `tools/tutorial/` のみ。Simulatorソース、正規YAML、Docker構成、Pages workflowとブランチ別公開方式は変更していない。

## 1〜7. 1冊の教材として読む

1. Appは単一Lessonを置換せず、解放済みのHowToSectionを順番に描画する。表紙はBlackPoker / Interactive HowTo、短い説明、はじめるだけ。
2. 次へは次の公開Sectionを解放し、DOM追加後にscrollIntoViewする。準備中は自動導線では飛ばす。
3. 到達済みSectionはkeyを固定してマウントを保持する。説明・選択・盤面が残り、通常の上スクロールで読み返せる。専用の戻るは不要。
4. 左メニューは目次。導入を含む全項目に直接ジャンプでき、未到達も開ける。モバイルはdrawerを閉じて移動。前提は案内でありロックしない。
5. INTRO3画面をabout / game-purpose / entry16の通常本文へ統合。独立INTROや二重表示はなく、続いて盤面・独立した向きSectionを読む。
6. #game-purpose / #board / #orientation / #unblocked-attack / #soldier-block / #bulwark-blockなどのanchorに対応。旧Lesson IDのhashも別名として受け付ける。routerは追加していない。
7. 再読込は有効なhashを優先し、なければ最後に開いたSectionへ復帰。完了盤面は最終状態、未完了の操作はSection先頭から復習する。pixel位置と途中のmicro入力は保存対象外。scrollspyは追加せず、目次・次へ・本文へのフォーカス/入力で現在地を更新する。

## 8〜13. あなた側と教材の責務

8. book fixtureにuserPlayer: Aを明示。手動stepのactor・操作元playerがAであることをCLI検証とテストで保証する。大きな「操作する人」帯は廃止し、「あなたの」「相手の」と案内する。
9. 全盤面の描画順はB→A。B＝相手を上、A＝あなたを下に固定。盤面Sectionで、Tutorialの説明上の約束であることを一度説明する。
10. 守らない攻撃、兵士ブロック、防壁ブロック、防壁設置、ターン終了からBの入力要求を除いた。兵士召喚もA。例外はBのカードをブロック対象として選ぶ入力で、Bを操作するものではない。実物準備の先攻は実際の対戦結果によりA/Bどちらも選べる。
11. Bのアタックは初期盤面で完了済みにする。相手のブロックなし・ダメージ・墓地移動・チャージ・ドローはautomaticで短く順次表示。1枚ごとの変化を見せ、任意のユーザー操作を時間だけで進めない。場面の流れにチェックと矢印を残し「攻撃が通った→だからライフが減る」を示す。
12. 防壁設置fixtureは旧player-b-turnのうちL支払いと設置だけを独立して複製し、A側へ変換。手札→down / chargeの防壁で完了。end / charge / drawは含まない。
13. ターン終了SectionはAがエンド、相手ターンへ、Bがチャージ、ライフから順に2枚ドロー。今回の教材条件で2枚を表示し、現行ルールの「ライフ2枚以下なら1枚」は詳説で維持。

## 14〜20. 簡略トランプ

14. PlayingCard / CardFaceを共通化し、TutorialBoard・INTRO・向き図・比較例・実物デッキ例に使用。判定engineとは分離。
15. ♥ / ♦は赤（#b91c1c）。
16. ♠ / ♣は黒（#18181b）。スート記号自体も必ず表示し、色だけに依存しない。
17. 中央にrank、その下にsuitを1組だけ。角の重複数字、逆さ数字、巨大な中央スートは追加しない。
18. A / J / Q / K / 10を半角で表示。H7・D8・S2・C6を含む共通部品テストで確認。
19. chargeは縦、driveはカード全体を90度回転。数字とスートを再配置せず、認識できる大きさを保持。
20. 裏面ではrank / suitをDOMに出さずBPだけを表示。BoardCard.faceをそのまま描画する。防壁のdown→up、ブロック時にdriveにならないことも回帰検証。
表示用カタログのみ旧白抜き記号を♥♦へ正規化し、生成カタログ・正規YAMLとcanonical card IDは変えていない。

## 21. 保存と互換

新キー `blackpoker-howto-book-v1` にlastSectionId / unlockedIds / completedIdsを保存する。
旧 `blackpoker-howto-lessons-v1` は読取り移行して内容を保持。旧30操作キーはstepIndex・maxReachedStepIndex・firstPlayerを維持し、実物準備で継続利用。
旧完了IDを引き継ぎ、最高到達だけから完了は推測しない。準備中・未知ID・重複は除外する。bookキー破損時も旧Lessonから復元可能。明示的なやり直し確認時だけ全進捗と先攻をリセットする。

## 22〜23. 実ブラウザ確認

IABとDocker内のChromiumで確認。再現可能な任意検証は `scripts/verify-browser.cjs`。
Playwright依存は一時Docker内だけにインストールし、アプリpackage / workflowには追加していない。

|項目|390×844|1440×900|
|---|---|---|
|本文|表紙→導入3項目→盤面→向き→攻撃→守らない→ライフ減少→兵士ブロック→防壁ブロックまで通過|目次から移動し、本文と過去盤面が残る|
|スクロール|次へで下へ移動、上スクロールで過去を閲覧、drawerからINTROへ戻る|Section jump、再読込で現在地へ復帰|
|見出し/盤面|見出し約60px、攻撃盤面上端約202px（以前251pxより上）|見出し約20px、本文最大幅820px|
|操作|タップ、ブロック対象指定、公開、墓地移動。Bの入力要求なし|実マウスdragでAのライフ→墓地、Enter/Spaceで手札→兵士。防壁設置だけで完了|
|表示|Aが下・Bが上、横overflowなし、カード操作幅44px以上|Aが下・Bが上、横overflowなし、赤黒/数字/スートを確認|
|状態保持|過去8Sectionが消えない|完了済み盤面を再読込後も保持|

IABでの攻撃盤面は約218px（スクロールバー・Windowsフォントあり）、Docker Chromiumでは約202px。いずれも同じ390×844で既存251pxから悪化していない。
reduced motionはscrollIntoViewをautoにし、CSSの回転transition等も無効化することをテストで確認。
画像は `test-results/browser/mobile-390x844.png`、`desktop-1440x900.png`、`desktop-drag-1440x900.png` に保存（生成物としてGit対象外）。

## 24〜27. 検証結果

- Tutorial: 10ファイル、128テスト成功。カード1組/赤黒、A操作、壁の責務、append、目次、hash、reload、保存互換、reduced motion、誤操作、keyboard、drag、touchを検証。
- 教材検証: 成功。旧30操作と生成fixture、before/after連続性、現行ルール参照、Lite担当coverageを検証。
- production build: 成功。`VITE_BASE_PATH=/BlackPoker/tutorial/` を指定してassetsのbase pathも確認。ブランチ用base pathを設定する既存workflowは変更なし。
- Simulator: 19ファイル、113テスト成功。ソース変更なし。
- Docker Chromium: 実ブラウザ検証スクリプトPASS。pageerrorなし。黒rgb(24,24,27)、赤rgb(185,28,28)を実測。

複数盤面が同時に存在するため、SVG marker IDをuseIdで一意化し、別Sectionへのdropを拒否した。既存カードを移動先としてタップできる動作も維持。

## 28. 変更ファイル

すべて `tools/tutorial/` 内。

- 文書・生成物設定: `.gitignore`, `README.md`, `HOWTO_REPORT.md`, `LEARNING_MAP.md`, `implementation_plan.md`
- 検証: `scripts/validate-tutorials.mjs`, `scripts/verify-browser.cjs`
- 本文: `src/App.tsx`, `src/main.tsx`, `src/book.css`, `src/styles.css`
- UI: `src/components/HowToSection.tsx`, `LessonPractice.tsx`, `RealPractice.tsx`, `PlayingCard.tsx`, `TutorialIntro.tsx`, `TutorialBoard.tsx`, `BoardOverlay.tsx`, `CardOrientation.tsx`, `CurriculumPanel.tsx`, `LessonExplainer.tsx`, `ActionHelp.tsx`
- 教材: `src/data/book.ts`, `book-fixtures.mjs`, `book-fixtures.d.mts`, `lessons.ts`, `learning-path.json`, `tutorials/entry16.json`（最後のJSONは表示記号のみ）
- 状態・検証・表示: `src/hooks/useSceneInteraction.ts`, `src/types.ts`, `src/lib/book-storage.ts`, `book-scroll.ts`, `rule-display.ts`, `cards.ts`, `schema.mjs`
- テスト: `tests/App.test.tsx`, `Lessons.test.tsx`, `TutorialBoard.test.tsx`, `curriculum.test.ts`, `setup.ts`, `PlayingCard.test.tsx`, `book.test.ts`, `book-helpers.ts`

## 29〜35. コミットと公開ブランチ

現在の作業ブランチ `635-kaizen-チュートリアルサイト作成` へ日本語コミットを作成してoriginへpushする。
コミット自身のSHAを本文へ埋め込むことはできないため、コミットSHA・push結果・local HEAD・remote HEAD・一致・最終cleanの実測結果は作業完了メッセージに記載する。
pushはブランチ更新であり、GitHub Actionsのデプロイ完了確認とは区別する。
