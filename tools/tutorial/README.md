# BlackPoker Tutorial

BlackPokerを「見る → 触る → 理解する」で体験的に学ぶ **Interactive HowToBlackPoker** です。Entry16を主な教材カードプールとして使い、最後に実物カードで遊びます。独立した静的Webアプリとして `tools/tutorial/` に配置します。

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

INTROの直後は「まず戦ってみよう」のミニ解説から開始します。盤面全体の説明を先に読ませません。

1. まず戦ってみる：アタック→ブロック→ダメージ判定、ブロックなし。
2. 戦力を増やす：一般兵・英雄・エースの比較、兵士召喚、防壁設置、ターン交代。英雄・エース・装備の操作は準備中。
3. 魔法を使う：アクションの読み方は公開。アップ・ダウン・ツイスト・カウンター・投擲・防壁破壊の操作は準備中。
4. 攻防を深く知る：防壁ブロックを公開。複数攻撃・複数ブロック・同数・魔法を挟む戦闘・対象消失は準備中。
5. リクエストの処理を知る：チャンス・ステージ・パス・スピードの操作教材は準備中。魔法の後に配置。
6. 誘発を知る：体験済みの自動処理→世代交代→同時誘発の順に学ぶ予定。操作教材は準備中。
7. Entry16で遊ぶ：既存realモード9操作を維持。16枚の用意から先攻決定・開始時1枚ドロー・実戦へ。

別枠の「Joker特別Lesson：サーチ」は準備中。Entry16の16枚にJokerを混ぜません。「盤面を確認する」は任意の復習です。
一覧から全Lessonへ直接移動できます。prerequisitesはおすすめであり、ロックではありません。おすすめの「次へ」は公開済みLessonのみを進みます。進捗の分母は公開済み8Lesson（任意の盤面復習を除く）で、準備中の教材は完了できません。

固定練習では実物カードを使いません。カードをタップしてから移動先をタップします。向きの変更はカードのタップだけで行い、PCでは移動をマウス／ペンでドラッグすることもできます。カードと移動先のボタンはEnter／Spaceでも操作できます。スマホではカード上からも縦スクロールできます。
正解の操作後だけ短い結果を表示し、次の課題へ進みます。scene途中に「次へ」はなく、未操作では盤面も進みません。既存6scene・20ゲーム操作は保持し、新しく防壁ブロックの4操作を追加しています。
Lessonは短い解説→カード操作→任意の詳説の3層です。各Lessonは独立したfixtureとして最初の盤面から始めます。Lesson間でカードを不自然に戻す処理はありません。「もう一度やる」はそのsceneだけをリセットします。
旧 `blackpoker-tutorial-progress-v1` の30操作のstepIndex・maxReachedStepIndex・先攻・完了状態は維持します。旧保存からは該当するLessonのscene先頭へ復帰します。新 `blackpoker-howto-lessons-v1` は現在Lessonと完了ID集合を保存し、再読込はミニ解説から再開します。古い最高到達を「実際に完了したLesson」と推測しないため、新Lesson完了数は別集計です。復習で両方の記録を巻き戻しません。「最初からやり直す」では両方をリセットしてINTROへ戻ります。
通常準備以降はランダムなカードを想定せず、カードスロット付きの配置ガイドを表示します。カード・ターン・勝敗は実物で管理します。

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
- `src/data/bulwark-fixture.mjs`：防壁ブロック専用fixture。公開→同じ数字の攻撃側→防壁の墓地移動。
- `src/lib/curriculum-schema.mjs`：Lesson ID、prerequisite、scene、YAMLのLite全ID coverage、主担当重複、解説と動画の検証。
- `src/components/LessonExplainer.tsx`：4種類の共通ミニ解説、現行定義、任意の動画ダイアログ。
- `src/lib/lesson-storage.ts`：Lessonの現在位置と完了集合。既存進捗とは別に保存。
- `src/types.ts`：TypeScript型。
- `src/lib/schema.mjs`：CLIとVitestが共有する実行時検証。
- `src/lib/interaction.mjs`：operationから1枚ごとの正解入力を導出し、タップ・キーボード・dropを共通判定する純粋関数。
- `src/hooks/useSceneInteraction.ts`：選択、成功、結果表示、scene内進行を管理。成功後500ms（reduced motionは300ms）だけ結果を表示します。
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
