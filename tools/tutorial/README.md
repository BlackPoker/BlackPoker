# BlackPoker Tutorial

BlackPokerを、縦に読み進めながら途中でカードを操作して学ぶ **Interactive HowTo** です。1 Lessonずつ画面を置き換えず、1冊の本文に導入・説明・操作盤面を残します。Entry16を主な教材カードプールとして使い、最後に実物カードで遊びます。独立した静的Webアプリとして `tools/tutorial/` に配置します。

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

## 学習フロー

表紙の「はじめる」から、BlackPokerとは → ゲームの目的 → Entry16について → 盤面 → カードの向き → 攻撃へ進みます。導入も目次に載る通常のSectionで、上スクロールだけで読み返せます。盤面の探索は任意で、全領域のタップを要求しません。

1. まず戦ってみる：盤面と向き → 守らない攻撃（ライフが減る） → 兵士で守る（6 < 7） → 防壁で守る（数字一致）。
2. 攻防を深く知る：複数攻撃・複数ブロック・同数・魔法を挟む戦闘・対象消失は準備中。
3. 戦力を増やす：一般兵・英雄・エースの比較、兵士召喚、防壁設置、ターン交代。英雄・エース・装備の操作は準備中。
4. 魔法を使う：アクションの読み方は公開。アップ・ダウン・ツイスト・カウンター・投擲・防壁破壊の操作は準備中。
5. リクエストの処理を知る：チャンス・ステージ・パス・スピードの操作教材は準備中。魔法の後に配置。
6. 誘発を知る：体験済みの自動処理→世代交代→同時誘発の順に学ぶ予定。操作教材は準備中。
7. Entry16で遊ぶ：既存realモード9操作を維持。16枚の用意から先攻決定・開始時1枚ドロー・実戦へ。

別枠の「Joker特別Lesson：サーチ」は準備中。Entry16の16枚にJokerを混ぜません。盤面確認は初回のおすすめ導線に含めます。
目次はSectionへのスクロール移動です。未到達も直接開け、前提Lessonによるロックはありません。「次へ」は次の公開済みSectionを追加表示してスクロールします。準備中20項目は目次に残し、直接開いた項目だけ短い本文を表示します。進捗は導入3項目・向き・公開済み9Lessonの合計13Sectionで数えます。

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
- `src/data/book.ts`：本文の順序・anchor・次の公開Section。
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
