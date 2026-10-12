# 盤面レイアウトとアタック／ブロック 実装報告

基準HEAD: `150beb8e66de5d2d65babe3e5b84ab993294eaff`。開始時にfetch・status・local / origin HEADを確認し、一致・cleanだった。対象は `tools/tutorial/` のみ。正規ルール、Simulator、Docker、Pages workflow・公開方式、基礎30操作JSONは変更しない。

## 1〜5. 問題整理とアタック図

従来は「♠2でアタック」の個別操作が先行し、1体ずつ別の攻撃を起こす印象があった。兵士ブロックも♥7→相手♣6の2段階指定のため、自分の兵士が相手兵士を攻撃しているように読めた。盤面では兵士と防壁の独立行が弱く、相手手札の表面が見えていた。

`AttackConceptDiagram` をカードの向きの直後、実操作の直前に追加。3体のうち♠2・♣6だけにチェックと横向き表示を付け、♥7は縦向きで「今回は選ばない」。選んだ2体だけの線を1回のアタックへまとめ、終点を「相手プレイヤー」にする。相手の兵士・防壁を攻撃対象として並べない。「アタックは1ターンに1回」を黒いラベル、「そのアタックに参加する兵士をまとめて選ぶ」を短文で表示する。

詳細は既存のActionDefinitionから正規attackを参照。`<攻撃>`・複数指定可・ドライブ不可・出たターン原則不可と `<速攻>` の例外を閉じたdetails内で読める。正規act.yamlのattack / block / damageJudgeを確認しており、教材都合のルール変更はない。新しいSectionや複数アタックLessonは追加せず、次は既存の♠2だけの操作。

## 6〜11. 単体指定と戦闘接続

- 変更前：あなたの♥7→相手の♣6を選ぶ。変更後：あなたの♥7を1回タップするだけ。今回は相手アタッカーが1体なので対応が自動で決まる旨を短く表示。防壁の単体指定も同じ方式。
- 汎用 `designate-card` を追加。任意のlabelとsourceを持ち、Lesson IDで分岐しない。既存のselect-targetは残す。schemaは1枚指定、同じzone、before / after完全一致を検証し、blockではchargeであることも確認する。
- ♥7はchargeのまま。盤面のカード状態を変えず、教材側の指定完了状態から「ブロッカー」を表示。相手♣6には最初から「アタック中」。replayでは指定・結果を解除する。
- `CombatLink` は方向のない線＋BLOCK＋双方の役割を表示する専用component。裏向き防壁は公開前にカード名を出さない。結果後もその戦闘の対応として残す。
- `BoardOverlay` 自体は変更しない。移動矢印と戦闘接続を分離。相手の非公開手札からの移動は既存のzone起点フォールバックを使う。

## 12〜16. 盤面と手札

上から「相手の補助領域／相手の防壁／相手の兵士／対戦中央／あなたの兵士／あなたの防壁／あなたの補助領域」。B上・A下を維持し、説明はあなた／相手を優先する。兵士と防壁は390pxでもそれぞれ独立した横1行。正式ルールにない前列・後列等の名称は追加しない。

ライフ・墓地・手札は `support-zones` として灰色のまとまりに分離し、兵士／防壁の `battlefield` と区別。カード幅30px以上、操作領域44px以上を確認した。相手の手札は「相手の手札・N枚」のみで、カード表面もカード名のaria属性も出さない。ドロー結果の読み上げも枚数表示。自分の手札は従来どおり。将来必要な公開だけstepの `revealOpponentHand: true` で明示する。

## 17〜20. 結果・replay・accessibility

- 兵士：6 < 7 → 相手♣6が墓地 → あなた♥7は場に残る → あなたのライフはそのまま（減らない）。
- 防壁：公開して6 = 6 → 相手♣6が墓地 → 防壁も墓地 → あなたのライフはそのまま（減らない）。兵士の大小比較と、防壁の一致等の違いを短く補足。
- 守られない例：攻撃が通る → 相手ライフ2枚減少。3つの結果を同じresult領域で比較できる。
- 攻撃replayの横に、盤面を戻す練習であり実戦は1ターン1回という注意を表示。召喚したターンの攻撃不可は維持。
- 図はfigureのaria-labelと短文、BLOCKはgroupの対応説明と役割テキスト、結果は名前付きリスト。線だけに意味を依存しない。タップ・Enter / Space等の既存操作を維持。

## 21〜26. 検証

すべてDocker内で実行。Tutorial **155 tests / 12 files成功**、教材・schema・連続盤面・ルール参照・book構造の検証成功、`VITE_BASE_PATH=/BlackPoker/tutorial/` production build成功。Simulator **113 tests / 19 files成功**（ソース変更なし）。

追加のcombatテストは11件。図の2/3指定・相手プレイヤー終点・Section数維持・1回指定・誤入力・charge維持・汎用ラベル・盤面変更拒否・BLOCK・replay・3種の結果・行順・手札の公開例外・不正metadataを検証。既存テストの手札／ブロック期待値も更新。

- **390×844実ブラウザ**：表紙→向き→図→攻撃→兵士ブロック→防壁ブロック→召喚→ターン交代→実物9操作・対戦開始まで成功。進捗12/12、不要な応用追加なし。図は横overflow・文字重なりなし。自分のカードだけでブロック指定、BLOCKは非方向の線。手札非公開・44px操作領域を確認。兵士／防壁各行の幅328px。
- **1440×900実ブラウザ**：図の最大幅を抑え間延びを防ぐ。B防壁→B兵士→A兵士→A防壁の上下関係と独立行（幅748px）、ライフから墓地への実マウスdrag、キーボード指定、hash移動、reload、ルール早見を確認。横overflowなし。
- Docker Chromium / Playwrightで実入力を検証し、スクリーンショットを目視確認。画像は `test-results/browser/`（git対象外）。ユーザーテストではなく開発者による確認であり、Pagesデプロイ完了の確認とは別。

## 27. 追加・変更ファイル（すべてtools/tutorial/配下）

- 追加：`src/components/AttackConceptDiagram.tsx`、`src/components/CombatLink.tsx`、`tests/combat.test.tsx`
- UI：`src/App.tsx`、`src/book.css`、`src/components/LessonPractice.tsx`、`src/components/TutorialBoard.tsx`
- データ・操作：`src/types.ts`、`src/data/book-fixtures.mjs`、`src/data/learning-path.json`、`src/hooks/useSceneInteraction.ts`、`src/lib/interaction.mjs`、`src/lib/interaction.d.mts`、`src/lib/schema.mjs`
- 回帰：`tests/App.test.tsx`、`tests/TutorialBoard.test.tsx`、`tests/book.test.ts`、`tests/curriculum.test.ts`、`scripts/verify-browser.cjs`
- 説明：`README.md`、`LEARNING_MAP.md`、`HOWTO_REPORT.md`

## 28〜34. Git引き渡し

現在の `635-kaizen-チュートリアルサイト作成` をoriginへpushし、実際のremote HEADとlocal HEADの完全一致および最終status cleanを確認する。コミット自身のSHAを埋め込む循環を避け、SHA・push結果・local / remote HEAD・statusの確定値は完了メッセージで報告する。

---

# 前回：最初の1ゲームを始めるInteractive HowTo 実装報告

基準HEAD: `e41b60d9dd924288971b3e99753a3f27b1ae4f00`。作業開始時に `git fetch` / status / local HEAD / origin HEADを確認し、一致・cleanだった。
対象は `tools/tutorial/` のみ。正規ルール、Simulator、Docker構成、GitHub Pages workflow・ブランチ別公開方式は変更しない。

## 1〜3. 実装前差分と今回の範囲

指定の `book.ts` / `learning-path.json` / `TutorialIntro` / `App` / `CurriculumPanel` / `LessonPractice` / `HowToSection` / `book-storage` を確認した。

|判定|実装前の状態|今回の対応|
|---|---|---|
|すでに満たしている|縦スクロール・過去DOM保持・hash・目次直行・A手前固定・tap/drag/keyboard・カード表示・保存・スマホ|既存実装を利用。interaction engineは変更しない|
|一部満たしている|操作の詳細はdetails内、Referenceは常時アクセス可能|召喚前の「リクエスト」を短い操作説明へ。早見を白いsecondaryボタンに|
|未対応|初戦専用track・分母・milestone・対戦開始後の分岐|データ・共通分岐UI・テストを追加|
|現状と矛盾|勝ち方の次にEntry16体系図。全公開Sectionを順に学ぶ導線。目次は多数の分類と常時ロードマップ|盤面を先にし、体系を実物直前のdetailsへ。目次3層・track内の次へに変更|

これはルールの簡略化ではなく情報の提示順の変更。魔法等の新しい操作教材を作ったわけではない。

## 4〜7. 初心者main routeとEntry16

最終順序：

`about → game-purpose → board-overview → orientation → unblocked-attack → first-battle → bulwark-block → soldier → pass-turn → first-game-ready → entry16 → real-game`

攻撃と「守られないとライフが減る」は既存の1 Section内で、説明→Aの攻撃操作→相手が守らない→1枚ずつライフが減る、と見せる。新しい次へ操作は追加しない。
Entry16のID / hashは維持して位置だけ後方へ送った。「普通のトランプから1人16枚だけ」を主文とし、「正式にはライト＋エントリー16」をsmallの補足へ。LIGHT / STANDARD / PRO / MASTERは実物直前の `entry16` のdetails内に残し、序盤には表示しない。
冒頭は既存の盤面イメージと「トランプだけで、TCGみたいに対戦」、2人用・1人1セット・専用カード不要を維持し、実物不要の案内をここへ移した。

## 8〜16. 3層・進捗・分岐

- **first-game / まず遊ぶ**：上記12 Section。初回展開。公開済みだけで構成し、この12項目だけを進捗の分母・分子に使う。
- **learn-more / もっと覚える**：防壁設置と準備中20項目。初回折りたたみ。戦力・応用戦闘・魔法・割込み・誘発・Jokerを削除せず保持する。
- **reference / 調べる**：アクションの読み方、ルール早見、公式リンク、学習ロードマップ、フォーマット差分。初回折りたたみ。
- **first-game-ready**：「ここまで分かれば、まず遊べます」＋短文。主CTAは「実物カードで遊ぶ」。補助は「もう少しルールを覚える」「ルール早見を見る」。完全習得とは表示しない。
- **対戦開始後**：基本を再確認・もっと覚える・魔法（準備中）・割込み（準備中）・早見・公式ルールを選べる。自動で早見を開く処理も外した。
- **nextSection**：同じtrack内だけを進み、pending / optionalを飛ばす。初戦の終端では応用へ進まない。現在のlearn-more公開済み操作は防壁設置のみなので、その後に不要な「次へ」を出さない。
- **直接移動**：前提はロックにしない。初戦はそこまでの基本本文を追加し、応用・Referenceは指定Sectionのみ追加。以前開いた本文は閉じない。

順序は `book-layout.json` に集約し、AppにLesson ID別の順序判定を増やしていない。内部の旧8カテゴリとアクション担当表は変更しない。

## 17〜20. 情報量と防壁設置の判断

操作前の主文は短く、ActionDefinition（コスト・キーカード・タイミング・スピード・対象・誘発など）は既存のdetails内を維持。新しい体系説明は初戦本文に追加しない。正式なリクエスト・ステージ・チャンス・誘発は、実際に戦闘や自動処理を体験した後、もっと覚える／調べるで参照する。未実装の体験を実装済みとは表示しない。
召喚前の主文に残っていた「同じ召喚リクエストのコスト」を除き、兵士を増やす目的と「まず防壁を横にする」操作へ変更。操作・cause・actionId・before/afterは変更していない。
topbarのルール早見は白背景・控えめな枠と文字色にし、黒い操作CTAを主役にした。位置とアクセス方法は維持。

**防壁設置はmain routeから外した。** `tools/actionlist/original/frame.yaml` のEntry16開始手順と `source/common/common.rst` の共通プリセットを確認すると、ゲーム開始時に表向きの防壁と兵士を配置する。追加設置を先に練習しなくても初戦を始められるため。通常防壁設置を禁止するルール変更ではなく、`#bulwark` でL支払い→手札を裏・チャージで置く既存操作を利用できる。

## 21〜23. 保存・hash・schema

保存キー `blackpoker-howto-book-v1` とIDは維持。保存読込みでは新しい並びの `unlockThrough(last)` を使わず、保存済みunlockedIds / completedIds / lastSectionIdを尊重する。不正ID・重複・pendingの完了は従来どおり除外し、現在地と完了項目だけ不足を補う。
旧Entry16の保存でhashなし／同じ `#entry16` の再読込みとも、3導入だけの解放範囲を保つ。明示的な別hashへの移動では現在のtrackで解放する。旧Lesson/30操作からの移行、maxReachedStepIndex、先攻、明示リセットも維持。
旧hash `#about` / `#game-purpose` / `#entry16` / `#board` / `#orientation` / `#unblocked-attack` / `#soldier-block` とLesson IDの別名を維持。
`book-layout.json` schemaVersion 1を追加。CLIとVitestで3 track、全Section掲載、未知ID・重複・欠落、初戦へのpending混入、導入／milestoneの所属、勝ち方→盤面と実物への順序を検証。既存のLesson・scenario schemaと正規YAMLは変更しない。

## 24. 追加・変更ファイル（tools/tutorial/配下）

- `src/data/book-layout.json`（追加）、`book.ts`、`book-fixtures.mjs`
- `src/components/FirstGameChoices.tsx`（追加）、`CurriculumPanel.tsx`、`TutorialIntro.tsx`、`LessonPractice.tsx`
- `src/App.tsx`、`src/book.css`、`src/lib/book-storage.ts`
- `src/lib/book-schema.mjs`、`src/lib/book-schema.d.mts`（追加）
- `scripts/validate-tutorials.mjs`、`scripts/verify-browser.cjs`
- `tests/first-game.test.tsx`（追加）、`tests/App.test.tsx`
- `README.md`、`LEARNING_MAP.md`、`HOWTO_REPORT.md`、`implementation_plan.md`

## 25〜30. 検証結果

DockerでTutorial **144 tests / 11 files成功**、教材・book track・rule reference・連続盤面・Lite coverage検証成功、`VITE_BASE_PATH=/BlackPoker/tutorial/` のproduction build成功。Simulator **113 tests / 19 files成功**。
既存のtap、tap→tap、mouse/pen drag、keyboard、wrong input、scene complete、Section追加と過去DOM、hash、reload、保存移行・リセットを回帰した。
Docker Chromium（Playwrightの一時コンテナ。アプリの依存には追加しない）で実際のクリック・マウス・キー入力を検証した。

- **390×844**：初回表紙→導入2項目→盤面→向き→攻撃・相手ライフ2枚→兵士ブロック→防壁ブロック→召喚→エンド・相手チャージ/ドロー→milestone→Entry16→実物9操作→対戦開始まで成功。進捗12/12、応用の強制表示なし。上スクロール・drawerの開閉・導入への再移動を確認。
- **1440×900**：3層の左目次、適切な本文幅、兵士召喚の実マウスドラッグ、Enter / Space、再読込みと完了盤面保持、防壁設置、カウンターへの直行hash、公式リンクの折りたたみ、ルール早見を確認。
- 両サイズとも横overflowなし、カードの最小操作幅44px、B上/A下、♥♦赤・♠♣黒を確認。攻撃Sectionの上端はモバイル約60px・PC約20pxで、sticky headerに見出しは隠れない。盤面はSection先頭から約143px / 176px下で、長いルール本文を先に読む必要はない。
- 画面画像は `test-results/browser/`（git対象外）に出力。攻撃盤面2サイズ、PCドラッグ、モバイルmilestone・目次を目視確認した。検証中、墓地中央に既存カードがある箇所はそのカードを宛先としてタップし、smooth scroll / drawer遷移の完了後に画面を確認するようテストを調整した。

## 初心者目線の自己レビュー

これは開発者による自己レビューであり、初見ユーザーを対象とした所要時間の測定ではない。

|問い|確認・判断|
|---|---|
|何のゲームかすぐ分かるか|冒頭の一文＋2人用・普通のトランプ・盤面図で伝える。説明は増やさない|
|勝ち方の次に盤面へ進めるか|game-purposeの次がboard-overview。間に体系説明なし|
|正式名称で止まらないか|Entry16は実物直前、正式名称は小さな補足|
|大量のルールを覚える印象を減らせたか|初戦12項目だけ展開、応用20件は折りたたみ、ロードマップもReference内|
|最初に触るものが分かるか|短い指示と期待カードの枠を維持|
|説明より操作を中心にできたか|長文・定義はdetails。操作待ちの盤面へすぐ到達。時間割合は未測定|
|守らないと減る理由を体験できるか|Aの攻撃→Bの非ブロック→ライフが1枚ずつ減る|
|守る意味が分かるか|兵士／防壁で止める2つの既存体験を維持|
|兵士を増やす理由が分かるか|召喚の主文に「攻撃や守りに使う兵士を増やす」と明記|
|ターン終了まで分かるか|自分のエンド→相手のチャージ／ドローを表示|
|ここまでで遊んでよいと伝わるか|milestoneの見出しと実物カードの主CTAで区切る|
|難しい仕組みは後から学べるか|任意のもっと覚える、未実装は準備中と明示|
|公式定義へ辿れるか|各Sectionのdetails、目次の調べる、常設早見を維持|

## 31〜37. Git引き渡し

現在ブランチ `635-kaizen-チュートリアルサイト作成` をoriginへpushする。コミット自身のSHAをファイルに埋め込む循環を避けるため、commit SHA・push結果・local/remote HEAD一致・最終statusは完了メッセージに記載する。GitHub Pagesのデプロイ完了とは区別する。

---

# 前回の縦スクロール化実装記録（履歴）

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
