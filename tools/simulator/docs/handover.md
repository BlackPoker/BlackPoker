# BlackPoker Simulator 引き継ぎメモ

## 背景

BlackPoker は「トランプだけでTCGみたいに遊べる」ことを目指したオープンなカードゲームです。

今回、BlackPoker の盤面再現・ルール検証・バランス調整を目的として、Webベースのシミュレーターを作成したいです。

当初は Rust でルールエンジンを作ることも検討しましたが、まずは Web ブラウザ上で簡単に動作するツールとして作成します。

最終的には GitHub Pages などで動作する静的Webアプリにできる可能性がありますが、現段階では GitHub Actions や Pages デプロイは行いません。

## 防衛公開の意図

このツールは内部検証用ですが、BlackPoker はオープンであることを強みとしています。

また、防衛公開の観点から、BlackPoker のシミュレーションツール構想・設計・初期実装を public repository に残したいです。

目的は、他者に類似の仕組みを特許化されるリスクを下げることです。

そのため、まずは以下の public repository にソースと設計文書を配置します。

https://github.com/BlackPoker/BlackPoker

ただし、現時点では GitHub Actions への追加や GitHub Pages への公開は行わないでください。

## 作業場所

以下のパスに作成してください。

```text
tools/simulator/
```

想定ブランチ名は以下です。

```text
feature/blackpoker-simulator
```

## 重要な制約

既存の BlackPoker 公式ルール、Sphinx、PDF/HTMLビルド、GitHub Pages の公開設定を壊さないでください。

特に以下は行わないでください。

* 既存の GitHub Actions を勝手に変更しない
* GitHub Pages の公開設定を変更しない
* 既存の Sphinx ビルド設定を変更しない
* 公式ルール本文にシミュレーターへのリンクを追加しない
* `master` / `main` 相当の公開ページ出力を変更しない

まずは `tools/simulator/` 配下だけで完結する構成にしてください。

## 作成したいもの

まずは「完全なルール自動処理」ではなく、盤面を手動コマンドで操作できる Web アプリを作成します。

目的は、以下です。

1. BlackPoker の現在の場の状態を視覚的に確認できる
2. コマンドで盤面を操作できる
3. 操作ログが残る
4. ステージ、リクエスト、解決の流れを確認できる
5. 将来的にルール検証、裁定確認、バランス調整、シナリオ再生に使える

## 画面構成

VSCode 風の3ペイン構成を想定します。

```text
+--------------------------------------------------+------------------+
|                                                  |                  |
| 現在の場の状態                                  | ログ             |
| - Player A                                      |                  |
| - ステージ                                      |                  |
| - Player B                                      |                  |
|                                                  |                  |
+--------------------------------------------------+------------------+
| コマンド入力コンソール                                             |
+---------------------------------------------------------------------+
```

画面要素は以下です。

* 中央または上部: 盤面表示
* 下部: コマンド入力コンソール
* 右側: ログ
* 盤面内: Player A / Player B / ステージ

## BlackPoker の重要概念

このツールでは、まず以下の概念を扱います。

### プレイヤー

* p1
* p2

### 領域 / ゾーン

BlackPoker には以下の領域があります。

* ライフ
* 手札
* 墓地
* 場
* フォグ
* パック
* レアカード
* 切札

初期実装では、最低限以下を扱えればよいです。

* ライフ
* 手札
* 墓地
* 場
* フォグ
* 切札

### ユニット

場に存在する実体です。

1枚または複数枚のカードで構成されます。

初期実装では、以下を扱えればよいです。

* 兵士
* 防壁

### カード

標準トランプを扱います。

表記例:

```text
S2 = ♠2
H3 = ♡3
D7 = ♢7
C10 = ♣10
SA = ♠A
SJ = ♠J
SQ = ♠Q
SK = ♠K
JOKER = Joker
```

### 状態

場のキャラクターには以下の状態があります。

* charge: チャージ状態
* drive: ドライブ状態

### アクション

プレイヤーが起こす行為です。

将来的には `act.yaml` / `act-frame.yaml` から読み込む予定ですが、初期実装では手動コマンドでよいです。

### リクエスト

アクションを実行するためにステージへ積むものです。

### ステージ

TCG のスタックに近い概念です。

通常アクションはステージに積まれ、解決されます。

初期実装では、効果の自動処理までは不要です。

## 初期実装で対応するコマンド

まずは以下のコマンドを実装してください。

```text
help
reset
test
draw p1 1
damage p2 3
summon p1 H7
bulwark p1 C2
drive p1 1
charge p1 1
request p1 アップ
pass
resolve
```

### コマンド仕様

#### help

使用可能なコマンド一覧をログに表示する。

#### reset

ゲーム状態を初期状態に戻す。

#### test

自己テストを実行する。

#### draw p1 1

指定プレイヤーが指定枚数ドローする。

初期実装では、実際のデッキから引く厳密処理でなくてもよいです。
ライフ枚数を減らし、手札に仮カードを追加できればよいです。

#### damage p2 3

指定プレイヤーに指定点数のダメージを与える。

ライフ枚数を減らす。

#### summon p1 H7

指定カードを兵士として場に出す。

#### bulwark p1 C2

指定カードを防壁として場に出す。

#### drive p1 1

指定プレイヤーの場にある1番目のユニットをドライブ状態にする。

#### charge p1 1

指定プレイヤーの場にある1番目のユニットをチャージ状態にする。

#### request p1 アップ

指定プレイヤーがアクションをリクエストする。

リクエストはステージに積む。

#### pass

チャンスを相手に渡す。

#### resolve

ステージ上の最後のリクエストを解決する。

初期実装では、効果の自動反映は不要です。
ログに「解決しました」と出ればよいです。

## 技術構成

まずは以下で作成してください。

```text
Vite + React + TypeScript
```

推奨ライブラリ:

```text
- React
- TypeScript
- Vite
- Vitest
- Tailwind CSS
- yaml
```

ただし、初期実装では外部依存を増やしすぎないでください。

特に、Canvas やサンドボックス環境では外部アイコンライブラリの読み込みに失敗することがあったため、最初は `lucide-react` などのアイコンライブラリに依存しないでください。

アイコンは文字やCSSで代替してください。

## Docker 開発環境

ローカル開発では Docker / Docker Compose を使って Node.js 依存関係を分離したいです。

目的:

* Node.js バージョンを固定する
* npm 依存関係をローカルPCに直接入れない
* Antigravity / VSCode / ターミナルで同じ環境を使う
* 将来別PCでも再現しやすくする

想定構成:

```text
tools/simulator/
  Dockerfile
  compose.yaml
  package.json
  vite.config.ts
  index.html
  src/
  docs/
```

Dockerfile は Node.js 22 系を想定してください。

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /workspace

ENV npm_config_update_notifier=false

EXPOSE 5173

CMD ["bash"]
```

compose.yaml は以下のような方針で作成してください。

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    working_dir: /workspace
    volumes:
      - .:/workspace
      - node_modules:/workspace/node_modules
    ports:
      - "5173:5173"
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"

volumes:
  node_modules:
```

起動方法:

```bash
docker compose up
```

ブラウザで以下を開く。

```text
http://localhost:5173/
```

## GitHub Actions について

現時点では GitHub Actions は追加しないでください。

将来的には以下を行う可能性があります。

* npm ci
* npm test
* npm run build
* GitHub Pages へ deploy

ただし、今は既存の公式ルール公開フローを壊したくないため、Actions への統合は行いません。

## GitHub Pages について

現時点では GitHub Pages へ公開しないでください。

将来的には以下のようなURLを検討します。

```text
https://blackpoker.github.io/BlackPoker/tools/simulator/
```

ただし、既存の公式ルール公開ページと統合する必要があるため、現段階では触らないでください。

## ディレクトリ構成案

以下の構成を推奨します。

```text
tools/simulator/
  README.md
  Dockerfile
  compose.yaml
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  docs/
    concept.md
    architecture.md
    command-spec.md
    defensive-publication.md
    roadmap.md
  src/
    main.tsx
    App.tsx
    domain/
      card.ts
      player.ts
      unit.ts
      game-state.ts
      action.ts
      command.ts
    engine/
      command-parser.ts
      command-runner.ts
      game-reducer.ts
    data/
      sample-state.ts
    ui/
      Board.tsx
      PlayerBoard.tsx
      ZoneSummary.tsx
      Console.tsx
      LogPanel.tsx
      StagePanel.tsx
    tests/
      card.test.ts
      command-runner.test.ts
      game-reducer.test.ts
```

## 設計方針

UI とルール処理を分離してください。

```text
src/ui
  画面表示

src/domain
  カード、ユニット、ゾーン、アクション、ゲーム状態などの型

src/engine
  コマンド解析、コマンド実行、ゲーム状態更新

src/data
  初期状態やサンプルデータ
```

将来的に `src/engine` だけ Rust / WebAssembly に置き換えられるように、UI と密結合しない設計にしてください。

## 段階的なロードマップ

### Phase 1: 盤面エディタ

目的:
手動コマンドで盤面を再現できるようにする。

実装対象:

* 盤面表示
* コマンド入力
* ログ表示
* ステージ表示
* 初期状態リセット
* 最低限のテスト

### Phase 2: アクション辞書

目的:
`act.yaml` / `act-frame.yaml` を読み込み、アクション一覧を表示する。

実装対象:

* YAML 読み込み
* アクション一覧表示
* actId / actName / actTrigger / actSpeed / actTime / actCost / actEffect の表示
* コマンド補完

### Phase 3: 半自動ルール処理

目的:
コスト支払い、対象指定、ステージ追加、解決の一部を自動化する。

実装対象:

* コストチェック
* キーカード指定
* 対象指定
* 通常アクションはステージへ
* 即時アクションは即解決
* 解決ログ

### Phase 4: シナリオ再生

目的:
同じ初期状態から何度も検証できるようにする。

実装対象:

* scenario.json
* command log replay
* 勝敗ログ
* ターン数集計
* アクション使用回数集計

### Phase 5: バランス調整支援

目的:
BlackPoker のルール調整・戦略検証に使えるようにする。

実装対象:

* アクション使用率
* 勝敗パターン
* 特定カード・切札・ストラテジーの使用状況
* テストシナリオの一括実行

## 初期完成条件

v0.1 の完成条件は以下です。

* `tools/simulator/` 配下で独立している
* `docker compose up` で起動できる
* ブラウザで画面が表示される
* コマンド入力で盤面が変化する
* ログが残る
* ステージにリクエストを積める
* `test` コマンドまたは Vitest で最低限のテストが実行できる
* README に起動方法が書かれている
* GitHub Actions / GitHub Pages にはまだ影響しない

## defensive-publication.md に書く内容

防衛公開の目的で、以下のような文書を作成してください。

```md
# BlackPoker Simulator Defensive Publication

## 公開目的

この文書は、BlackPoker のルール検証・盤面再現・バランス調整を行うための
シミュレーションツール構想を公開するものです。

## 公開するアイデア

- BlackPoker の盤面を Web 上に再現する
- 領域、ユニット、アクション、リクエスト、ステージをデータ構造として扱う
- コマンド入力により盤面を操作する
- 操作ログを残し、対戦状況を再現可能にする
- act.yaml / act-frame.yaml などのルール定義を読み込み、アクション辞書として利用する
- 将来的にコマンドログを再生し、ルール検証やバランス調整に利用する
- 将来的にルールエンジンを TypeScript から Rust / WebAssembly に分離可能にする

## 想定構成

- UI: React + TypeScript
- ルールモデル: TypeScript domain model
- コマンド処理: command parser / command runner
- データ: BlackPoker 公式ルール定義 YAML
- 将来的な拡張: Rust / WebAssembly によるルールエンジン分離

## 非目的

現時点では以下を目的としない。

- オンライン対戦
- AI対戦
- 完全自動裁定
- ユーザー認証
- データベース連携
```

## README に書く注意書き

README には以下を明記してください。

```md
# BlackPoker Simulator

Experimental / Prototype

このツールは BlackPoker の開発中の検証用ツールです。

現時点では公式の対戦ツールではありません。
ルール処理は完全ではありません。
表示、コマンド仕様、データ構造は予告なく変更される可能性があります。

## Development

```bash
docker compose up
```

Open:

```text
http://localhost:5173/
```
```

## 非目標

初期段階では以下はやらないでください。

- オンライン対戦
- AI対戦
- 完全な自動裁定
- ユーザー認証
- DB保存
- GitHub Pages公開
- 既存公式ルールサイトへのリンク追加
- 既存Actionsの変更

## 最終的な方向性

最終的には、BlackPoker の公式ルール・アクション定義 YAML と連携し、以下ができるツールに育てたいです。

- 盤面再現
- コマンドログ保存
- コマンドログ再生
- 裁定確認
- ルール検証
- バランス調整
- シナリオテスト
- 将来的な GitHub Pages 公開

ただし、今はまず `tools/simulator/` 配下で、壊れにくい最小構成のプロトタイプを作ってください。
