# BlackPoker Tutorial

画面だけの固定練習を終えてから実物カードへ進む「ライト＋エントリー16」の独立した静的Webアプリです。

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

1. 準備する（1scene）：完成済みの盤面を探索。置き場をタップして説明を確認できます。
2. 練習バトル（5scene）：画面のカードを操作し、攻撃、ブロック、召喚、防壁設置、ダメージ、ターン交代を体験します。
3. 本当のゲームを準備する（8操作）：16枚確認から先攻決定・最初の1枚ドローまで。
4. 1戦やってみる（1操作）：アクション／キャラクターを切り替えられるルール早見を開いて対戦へ。

固定練習では実物カードを使いません。カードをタップしてから移動先をタップします。向きの変更はカードのタップだけで行い、PCでは移動をマウス／ペンでドラッグすることもできます。カードと移動先のボタンはEnter／Spaceでも操作できます。スマホではカード上からも縦スクロールできます。
正解の操作後だけ短い結果を表示し、次の課題へ進みます。scene途中に「次へ」はなく、未操作では盤面も進みません。6scene全体で「次へ」は6回、ゲーム操作は20回（カード操作17回、エンドなどのボタン操作3回）です。選択と移動先指定は合わせて1つのカード操作として数えています。
「もう一度やる」はそのsceneのみを初期盤面に戻し、保存済み最高進捗は維持します。保存形式は既存のstepIndexのままで、再読み込み時は対応するsceneの先頭へ復帰します。
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
- `src/types.ts`：TypeScript型。
- `src/lib/schema.mjs`：CLIとVitestが共有する実行時検証。
- `src/lib/interaction.mjs`：operationから1枚ごとの正解入力を導出し、タップ・キーボード・dropを共通判定する純粋関数。
- `src/hooks/useSceneInteraction.ts`：選択、成功、結果表示、scene内進行を管理。成功後500ms（reduced motionは300ms）だけ結果を表示します。
- `src/components/TutorialBoard.tsx`：盤面の描画。効果計算は行わない。
- `src/components/ActionHelp.tsx`：ライトの19アクションとキャラクターを、初心者向け説明と正規情報に分けて表示。
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
