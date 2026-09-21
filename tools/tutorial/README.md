# BlackPoker Tutorial

実物のトランプを動かしながら、BlackPokerを初めて遊ぶ2人が「ライト＋エントリー16」の基本操作を学ぶ静的Webアプリケーションです。Simulatorとは独立してビルド・配信します。

## 開発

```bash
cd tools/tutorial
docker compose up --build
```

ブラウザで `http://localhost:5174/` を開きます。サーバ、DB、ログインは不要です。Node.jsのインストールやNodeコマンドのホスト実行は不要です。

```bash
docker compose run --rm app npm test
docker compose run --rm app npm run validate:tutorials
docker compose run --rm app npm run build
docker compose run --rm --service-ports app npm run preview -- --host 0.0.0.0 --port 5173
```

## アーキテクチャ

- `src/data/tutorials/*.json`: 何を体験させ、どう説明するかを保持するTutorialシナリオ
- `src/types.ts`: シナリオschemaのTypeScript型
- `src/lib/schema.ts`: ブラウザとテストで使うschema・ルール参照検証
- `src/lib/storage.ts`: `localStorage`を任意依存にした進捗保存
- `scripts/rule-source.mjs`: 正規YAMLを読むビルド時アダプター
- `scripts/generate-rule-catalog.mjs`: UI表示用の名前・公式リンク索引を生成
- `scripts/validate-tutorials.mjs`: Tutorialの参照IDと順序を正規YAMLに対して検査

TutorialはSimulatorのUIやアプリケーションコードをimportしません。ルールの効果も実装しません。正規ソースとして次をビルド時に読みます。

- action / format: `tools/actionlist/original/act.yaml`
- frame: `tools/actionlist/original/frame.yaml`
- component: `tools/simulator/src/data/rules-vnext/official-base.yaml`

`npm run build`と`npm test`の前に `src/generated/ruleCatalog.ts` が再生成されます。これらのコマンドはDocker経由で実行してください。シナリオが存在しないIDを参照すると、`Tutorial references unknown rule: action.xxx` の形式で失敗します。

## シナリオの追加

1. `src/data/tutorials/` に既存schemaと同じJSONを追加する
2. `regulation`、`learn`、各stepの`ruleRefs`には正規YAMLに存在するIDだけを書く
3. Docker経由で`npm run validate:tutorials`と`npm test`を実行する
4. `src/data/curriculum.ts`の該当コースを有効化し、アプリのシナリオ選択導線を追加する

説明量は `difficulty` で区別できるため、将来は同じルール参照のまま`intermediate`や`advanced`の問題形式を追加できます。

## GitHub Pages

プロジェクトサイト配下で公開するときはbase pathを指定します。

```bash
docker compose run --rm -e VITE_BASE_PATH=/BlackPoker/tutorial/ app npm run build
```

成果物は `tools/tutorial/dist/` に生成されます。`.github/workflows/deploy-tutorial-pages.yml` はこの成果物を既存`gh-pages`ブランチの`tutorial/`へ配置し、既存の公式ルールドキュメントを残します。

リポジトリ名が異なるforkでは、workflowの`VITE_BASE_PATH`を `/<repository-name>/tutorial/` に変更してください。

## 現在の範囲

ライト＋エントリー16の導入、カード準備、領域、兵士召喚、アタック、ブロック、ダメージ判定、エンド、チャージ、ドロー、固定シナリオ練習を収録しています。ランダム対戦、ルールエンジン、別端末同期、PWAはMVP対象外です。
