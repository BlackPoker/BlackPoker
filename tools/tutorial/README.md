# BlackPoker Tutorial

BlackPokerを、縦に読み進めながら途中でカードを操作して学ぶ **Interactive HowTo** です。1 Lessonずつ画面を置き換えず、1冊の本文に導入・説明・操作盤面を残します。Entry16を主な教材カードプールとして使い、最後に実物カードで遊びます。独立した静的Webアプリとして `tools/tutorial/` に配置します。

第1ゴールは「全部覚える」ではなく、**初めて見た2人が、まず最初の1ゲームを始められること**です。正確な定義・完全なルールは公式Referenceへ、HowToは遊ぶために必要になったことを短く体験する役割に分けます。

旧HowTo・旧動画は「1画面1概念」「流れ・比較」「具体例の後で仕組みを説明する」という教育設計の参考です。ルールの正は現行の `act.yaml` / `frame.yaml` と公式ルールソースです。旧ドロー仕様や旧用語・旧ステージ処理を移植しません。

## Dockerで起動

Docker Desktopを起動し、リポジトリ直下から実行します。

```powershell
cd tools/tutorial
docker compose up --build
```

起動ログにViteの準備完了が出たら [ローカルTutorial](http://localhost:5174/) を開きます。
このコマンドのターミナルを閉じるとサーバーが停止します。バックグラウンドで使う場合は次を実行します。

```powershell
docker compose up -d --build
docker compose logs -f app
```

停止は `docker compose down` です。ホスト側のNode.jsは不要です。
WindowsのDocker共有フォルダにも対応するため、Viteのファイル監視にポーリングを使用します。

## 検証

初回は依存関係を用意します。以降のコマンドはすべて `tools/tutorial/` で実行してください。

```powershell
docker compose run --rm app npm ci
docker compose run --rm app npm test
docker compose run --rm app npm run validate:tutorials
docker compose run --rm -e VITE_BASE_PATH=/BlackPoker/tutorial/ app npm run build
```

ローカルのビルド済み画面を確認する場合は、開発サーバーを停止してから実行します。

```powershell
docker compose down
docker compose run --rm app npm run build
docker compose run --rm --service-ports app npm run preview -- --host 0.0.0.0 --port 5173
```

## 戦闘の見せ方

カードの向きの直後に「アタックとは？」の図を置きます。3体のうち2体だけをアタッカーにし、1回のアタックで相手プレイヤーを攻撃する全体像を見てから、♠2だけの実操作へ進みます。Section数・初戦の進捗12項目は増やしていません。

- 盤面は上から相手の防壁・兵士、対戦中央、あなたの兵士・防壁。それぞれ独立した横列です。ライフ・墓地・手札は別の補助領域にまとめます。
- 相手の手札は枚数だけ表示し、自分の手札はカードを表示します。教材で明示的に公開する場合だけstepの `revealOpponentHand: true` を指定できます。
- 単体ブロックは自分のブロッカーを1回タップします。相手のカードを再度選ぶ必要はなく、カードは縦向きのままです。`designate-card` は任意のラベルで1枚を指定する汎用commandで、before / afterを変えないことをschemaで検証します。
- `CombatLink` の方向のないBLOCK接続は戦闘の対応、従来の `BoardOverlay` の矢印はカード移動を表します。兵士・防壁で守った結果と「ライフは減らない」を盤面の下に残します。
- アタックの「もう一度やる」は盤面を戻す練習です。同じターンに複数回攻撃できるという意味ではない旨を表示します。

複数アタッカーの実操作Lessonは今回追加していません。既存の `select-target` は残し、単体指定だけを汎用commandへ切り替えています。正規の指定条件は図のdetailsとルール早見から参照します。

## 学習フロー

表紙 → BlackPokerとは → ゲームの目的 → 盤面 → カードの向き → 攻撃を通す（守られないとライフが減る） → 兵士で守る → 防壁で守る → 兵士を召喚する → ターンを渡す → **ここまで分かれば、まず遊べます** → 16枚の入門ルールを紹介 → 実物Entry16の準備・対戦開始。

目次は3層です。

1. **まず遊ぶ / first-game**：初期展開。上記12 Sectionだけを進捗の分母にします。勝ち方の次は体系説明ではなく盤面です。
2. **もっと覚える / learn-more**：初期折りたたみ。防壁設置と、英雄・エース・装備・応用戦闘・魔法・割込み・誘発・Jokerなどの準備中20項目を保持します。自分で選んだときだけ開き、初戦の進捗に含めません。
3. **調べる / reference**：初期折りたたみ。アクションの読み方、ルール早見、公式ルール、8コースの学習ロードマップ、正規YAML由来のフォーマット差分へアクセスできます。

防壁設置は初戦前の必須練習から外しています。Entry16は共通開始手順で防壁をプリセットするため、追加の設置を先に練習しなくても対戦を開始できます。禁止・省略ルールを作ったわけではなく、`#bulwark` や目次からいつでも練習できます。

Entry16は実物準備の直前で「普通のトランプから1人16枚だけ」と紹介し、正式名称「ライト＋エントリー16」は小さな補足にします。LIGHT → STANDARD → PRO → MASTERはそのSectionの折りたたみに残します。
milestoneでは「実物カードで遊ぶ」を主CTAにし、応用と早見は補助にします。実物9操作の完了後は基本の復習・もっと覚える・魔法（準備中）・割込み（準備中）・早見・公式ルールを選べます。

目次から未到達にも直接移動でき、前提によるロックはありません。「次へ」は同じtrackの次の公開済みSectionだけを追加表示します。準備中は飛ばし、初戦から応用へ自動的に送りません。応用の直接アクセスはそのSectionだけを追加し、他の準備中を大量に開きません。上へスクロールすれば過去の本文を読めます。盤面の全領域タップは不要です。Joker特別Lessonは別教材で、Entry16の16枚にJokerを混ぜません。

- 各Sectionは `HowToSection` のid / data-section-idを持ちます。到達済みのDOM・選択・途中盤面は残り、戻る専用ボタンは不要です。
- `#game-purpose` / `#board` / `#orientation` / `#unblocked-attack` / `#soldier-block` / `#bulwark-block` に直接アクセスできます。再読込はhash、なければ最後に開いたSectionへ戻ります。
- smooth scrollはreduced motionで無効になります。見出しのfocusとscroll-margin-topでsticky headerとの重なりを避けます。
- TutorialではA＝あなた（下）、B＝相手（上）。これは表示上の約束で、ルール上の差ではありません。固定教材でユーザーが動かすカードはAだけです。Bのカードをブロック対象として指定する操作はできます。
- 最初の攻撃は、Aの♠2を横にする → 相手が守らない → 相手のライフが1枚ずつ減る、という因果を表示します。兵士・防壁ブロックはBが攻撃済みの初期盤面から始めます。
- 防壁設置はAのコストLと裏向き・チャージでの設置だけで完了します。エンド → 相手のチャージ → ドローは独立Sectionです。
- 防壁ブロックはdown / chargeから指定し、向きを変えず、公開・一致判定・墓地へ。通常防壁と、表向きの開始時プリセットは区別します。

固定練習では実物カードを使いません。タップ→タップ、Enter／Space、PCのマウス／ペンドラッグに対応します。スマホのカード上でも縦スクロールを妨げません。操作領域は44px以上です。別Sectionの盤面へのdropは拒否します。
ユーザー側は正解入力後だけ進みます。相手側は `automatic: true` の処理だけを1枚ずつ表示し、Bの操作を要求しません。解説は盤面の下で開けます。Section内の継続盤面と汎用interaction engineは維持し、Lesson間の架空のカード移動は挿入しません。「もう一度やる」はその盤面だけをリセットします。

カードは共通の `PlayingCard / CardFace` で、数字とスートを中央に1組だけ表示します。♥♦は赤、♠♣は黒。A/J/Q/K/10を使い、裏面はBPだけ、ドライブはカード全体を回転します。canonical IDと正規YAMLは変更しません。

### 保存と互換

新 `blackpoker-howto-book-v1` は最後に開いたSection、解放済みID、完了IDを保存します。旧 `blackpoker-howto-lessons-v1` は読取り移行し、破壊的に上書きしません。旧 `blackpoker-tutorial-progress-v1` の30操作、maxReachedStepIndex、先攻も維持し、実物準備で引き続き利用します。
SectionのIDと保存形式は互換のため、キーは変更しません。保存読込みでは新しい順序で `unlockThrough()` を再計算せず、保存済みの解放ID・完了ID・現在地を保持します。後方へ移した旧 `entry16` から再開しても、戦闘を勝手に全解放しません。同じ現在地のhashで再読込みした場合も同様です。別のhashへの明示的な移動は、そのtrackの新しい導線で解放します。
旧保存の現在位置は対応するSectionへ移行し、完了IDを引き継ぎます。旧最高到達だけを根拠に操作完了とは見なしません。再読込後は完了済み盤面を最終状態で復元、未完了の操作はそのSectionの先頭から練習できます。ピクセル位置と未完了micro stepの途中入力は保存しません。
「最初からやり直す」を確認した場合だけ、全形式の進捗・先攻をリセットして表紙へ戻します。保存禁止・破損時も閲覧できます。

実物準備の9操作も続きを追加表示します。具体的なランダム手札は仮定せず、スロット付きの配置ガイドを表示します。先攻決定・開始時1ドローを維持し、実物のカード・ターン・勝敗はプレイヤーが管理します。

## ルールとの境界

ビルド・テスト・開発起動時に次の正規ソースから `src/generated/ruleCatalog.ts` を生成します。

- `tools/actionlist/original/act.yaml` の `actList`：効果、コスト、キーカード、使用可能フォーマット。
- 同ファイルの `charList`：一般兵・英雄・エース・防壁などの定義。
- 同ファイルの `fogList`：フォグの定義。
- `tools/actionlist/original/frame.yaml`：フレーム、デッキ、開始手順。

Simulatorへのコード・データ依存はありません。Tutorialにルールエンジンは実装しません。
共通開始手順は `source/common/common.rst` と公開公式ルールを確認して教材の指示へ反映しています。
YAMLの変更で共通手順そのものを自動追従する仕組みではないため、関連ルール改定時には教材をレビューしてください。

## データ構成

- `src/data/tutorials/entry16.json`：schemaVersion 2の教材。操作する人、説明、操作前後の盤面、移動対象と移動先。
- `src/data/learning-path.json`：7分類＋Joker、Lesson metadata、flow / anatomy / compare / example、担当アクションと復習対象。
- `src/data/lessons.ts`：型とscene/fixture参照、旧stepからのLesson対応。
- `src/data/book-layout.json` / `book.ts`：3 trackの順序・初戦の範囲・anchor・同じtrack内の次の公開Section。
- `src/lib/book-schema.mjs`：全Lessonの掲載、未知ID・重複・欠落、初戦への準備中混入、milestoneと実物準備の順序をCLIとテストで検証。
- `src/components/FirstGameChoices.tsx`：初戦前のmilestoneと実物対戦準備後の任意の分岐。
- `src/data/book-fixtures.mjs`：旧教材から独立したA操作fixtureを構築。相手の自動処理と防壁設置の範囲を明示。
- `src/components/HowToSection.tsx` / `LessonPractice.tsx` / `RealPractice.tsx`：本文、固定操作、実物準備。
- `src/lib/book-storage.ts` / `book-scroll.ts`：旧保存の移行、Section進捗、スクロール。
- `src/components/PlayingCard.tsx` / `src/book.css`：共通簡略トランプと縦スクロールレイアウト。
- `src/data/bulwark-fixture.mjs`：防壁ブロック専用fixture。公開→同じ数字の攻撃側→防壁の墓地移動。
- `src/lib/curriculum-schema.mjs`：Lesson ID、prerequisite、scene、YAMLのLite全ID coverage、主担当重複、解説と動画の検証。
- `src/components/LessonExplainer.tsx`：4種類の共通ミニ解説、現行定義、任意の動画ダイアログ。
- `src/components/CardOrientation.tsx`：攻撃前に確認するチャージ／ドライブの比較図。
- `src/lib/lesson-storage.ts`：旧Lesson保存の互換読取り。
- `src/types.ts`：TypeScript型。
- `src/lib/schema.mjs`：CLIとVitestが共有する実行時検証。
- `src/lib/interaction.mjs`：operationから1枚ごとの正解入力を導出し、タップ・キーボード・dropを共通判定する純粋関数。
- `src/hooks/useSceneInteraction.ts`：選択、成功、結果表示、scene内進行を管理。成功後500ms（reduced motionは300ms）結果を表示。相手のautomatic処理は1100msごとに進めます。
- `src/components/TutorialBoard.tsx`：盤面の描画。効果計算は行わない。
- `src/components/ActionHelp.tsx`：現行YAMLのLiteアクションとキャラクターを、初心者向け説明と正規情報に分けて表示。
- `src/lib/storage.ts`：ステップ・操作確認状態・先攻を保存。
- `tests/`：schema、画面操作、保存の検証。

## QuickStart Guideの参照資料

今後の完全照合に使うPDFは `tools/tutorial/reference/QuickStartGuide.pdf` に配置します。
PDFが存在しない状態では内容を推測せず、coverage表も作成しません。

新シナリオでは `board.before` / `board.after` を完全な教材状態として記述します。
固定区間では前の `after` と次の `before` が一致する必要があります。
`operations` を正解操作として使い、完了した1枚分だけを `before` のコピーへ反映します。カードの最終状態は `after` から取得し、効果計算は行いません。教材データ自体は変更しません。
通常の移動・向き変更は自動導出します。`interaction` はブロック相手の `select-target` と、カード操作のない `action` のみ補足します。`scenes` は複数のmicro stepを学習単位へまとめ、`static` は探索、`interactive` は操作練習です。
シナリオIDにバージョンを含め、ステップ順が変わる改修時は古い進捗を適用しないようにしてください。

現行アクション・キャラクター・基本ルールと教材の対応は [LEARNING_MAP.md](LEARNING_MAP.md) を参照してください。これは現行ソースとの対応表であり、未提供PDFとのcoverage照合ではありません。

## 任意の動画

Lessonの `media` は `type: youtube`、HTTPSのYouTube URL、title、note、edition（current / legacy）を指定できます。実在の教材URLが未提供なので、現在のLessonには動画を登録していません。動画なしで全公開Lessonを完了できます。
「動画で見る」を押したときだけダイアログ内に読み込み、autoplayはしません。閉じると同じLessonへ戻ります。legacyは必ず「旧ルールの参考動画」と表示します。URLは検証し、埋め込み先をyoutube-nocookie.comに正規化します。

## GitHub Pages

成果物は `tools/tutorial/dist/` です。workflowは `tools/tutorial/**` と正規YAMLを監視し、Dockerでテスト・ビルドします。
公開先はブランチ別の `https://blackpoker.github.io/BlackPoker/<branch>/tutorial/` です。
gh-pagesの `<branch>/tutorial/` のみを更新します。テストまたはbuildに失敗した場合はgh-pagesを更新しません。

代表的な公開URL：

- 開発ブランチ：[635-kaizen-チュートリアルサイト作成/tutorial](https://blackpoker.github.io/BlackPoker/635-kaizen-%E3%83%81%E3%83%A5%E3%83%BC%E3%83%88%E3%83%AA%E3%82%A2%E3%83%AB%E3%82%B5%E3%82%A4%E3%83%88%E4%BD%9C%E6%88%90/tutorial/)
- master：[master/tutorial](https://blackpoker.github.io/BlackPoker/master/tutorial/)

SimulatorとTutorialは同じGitFlowでブランチ別プレビューを生成します。

- Simulator：`https://blackpoker.github.io/BlackPoker/<branch>/playtest/`
- Tutorial：`https://blackpoker.github.io/BlackPoker/<branch>/tutorial/`

手動で再公開する場合は、GitHub Actionsの `deploy_tutorial_pages` を開き、`Run workflow` を実行します。
Pages用buildでは `VITE_BASE_PATH=/BlackPoker/<branch>/tutorial/` を指定します。forkの場合はリポジトリ名に合わせて変更してください。

設計・全操作・公式ルールの確認結果は [実装報告](IMPLEMENTATION_REPORT.md) を参照してください。

## 任意の実ブラウザ検証（Docker）

開発サーバー起動中に `scripts/verify-browser.cjs` で390×844の冒頭導線、1440×900の目次・実マウスdrag・keyboard・再読込を検証できます。アプリのpackageやworkflowへPlaywright依存は追加していません。一時コンテナでだけ依存を用意します。

```powershell
# tools/tutorial/ から実行。初回は公式ブラウザイメージを取得します。
$tutorialRepo = (Resolve-Path ../..).Path
docker run --rm --ipc=host --mount "type=bind,source=$tutorialRepo,target=/repo" -w /repo/tools/tutorial mcr.microsoft.com/playwright:v1.51.1-noble sh -c "npm install --prefix /tmp/howto-browser --no-package-lock --ignore-scripts playwright@1.51.1 && NODE_PATH=/tmp/howto-browser/node_modules node scripts/verify-browser.cjs"
```

画像は `test-results/browser/`（Git対象外）に保存します。通常のテスト・ビルド・Pages workflowは従来どおりです。
