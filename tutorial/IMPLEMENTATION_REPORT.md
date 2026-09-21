# Tutorial学習体験の改修報告

## 1. 分かりづらさの原因

- 領域や状態の説明が操作より先に続き、最初の体験までが長かった。
- ステップ単位の図に切り替わり、前の操作が盤面に残らなかった。
- シャッフル後の手札から特定の数字カードを要求し、必ずしも手順が成立しなかった。
- 操作する人とターンの人が区別されず、A/Bの位置も継続しなかった。
- 最後の通常対戦で使える、常設のアクション参照がなかった。

## 2. 新しい学習フロー

4章・22操作に整理しました。白黒・zinc、左のロードマップ、モバイルドロワー、折りたたみ「なぜ？」を継続しています。

| 章 | 操作数 | 目的 |
| --- | ---: | --- |
| 準備する | 4 | 固定カードを図の場所へ置く |
| 練習バトル | 9 | 同じ盤面で基本操作を体験する |
| 本当のゲームを準備する | 8 | ランダムなEntry16を正式な順序で準備する |
| 1戦やってみる | 1 | 常設の早見を使って対戦する |

実物を操作 → 具体的な操作名のボタン → 操作後の盤面と短い用語説明 → 次の操作、という流れです。
PCとモバイルは同じ教材・同じプレイヤー位置を使います。

## 3. ディレクトリ配置

アプリはリポジトリ直下の `tutorial/`、テストは `tutorial/tests/` へ移動しました。
Dockerの作業場所・マウント・README・GitHub Pages workflow・gitignoreも移動に対応しました。
PagesのURLは `/BlackPoker/tutorial/` を維持します。

## 4. Simulator依存の除去

`rule-source.mjs` が読むファイルは `act.yaml` と `frame.yaml` の2つだけです。
キャラクターは `act.yaml.charList`、フォグは `fogList` から生成します。
SimulatorのUI、ロジック、official-base.yamlは読み込みません。

## 5. 新しいJSON schema

`schemaVersion: 2`、シナリオIDは `entry16-hands-on-v2` です。

| フィールド | 内容 |
| --- | --- |
| actor | A / B / both / first。firstは保存した先攻に置換 |
| mode | fixedは固定教材、realは実物の配置ガイド |
| board.before / board.after | A・Bの手札／兵士／防壁／ライフ／墓地、ターン |
| card / face / state | カード符号、up/down、charge/drive |
| operations | 操作するplayer、from/to、cards、短いlabel |
| learned | 操作後に伝える用語・気づき |
| chooseFirst | 実物で決めた先攻の入力 |
| checklist | 16枚の確認リスト |
| ruleRefs | action / character / fog / frame / format参照 |

カードを回す例では、beforeのC6がcharge、afterのC6がdriveです。
画面はこの2つの状態を切り替えるだけで、攻撃処理などを計算しません。
検証は必須項目・参照ID・actor・カード形式・重複・領域・操作対象・固定盤面の連続性をチェックします。
旧シナリオIDの保存は引き継がず、操作後の状態と先攻A/Bを再開時に復元します。

## 6. 固定練習の全手順

準備：

1. トランプ2組を用意し、プレイヤーAを手前、Bを向かいにする。
2. A：兵士♣6と防壁♦5を表・縦、手札♠2を置く。
3. B：兵士♥7を表・縦、防壁♦5を表・横に置く。Bの防壁は後でチャージを練習するため使用済みを表す。
4. Entry16の残りをライフへ。両者とも上から♠3・♦8、残りの順は自由。Aは13枚、Bは14枚。シャッフルしない。

練習バトル：

1. A：♣6を横にしてアタック。
2. B：♥7で♣6をブロックと宣言。♥7は縦のまま。
3. A：6と7を比較し、♣6を墓地へ。♥7は場に残る。
4. A：♠2の召喚を宣言し、防壁♦5を横にする。
5. A：ライフ最上段の♠3を表にして墓地へ。
6. A：手札♠2を表・縦で兵士へ。4〜6は1回の兵士召喚を分割した練習。
7. A：エンドを宣言しBへターンを渡す。
8. B：使用済みの防壁♦5を縦へ戻す。♥7は縦のまま。
9. B：ライフから♠3・♦8を手札へ。

すべてEntry16に含まれるカードです。準備後は各プレイヤーの全領域で16枚が保存されます。
同一カードの回転や移動を太枠・点線・移動先プレビュー・矢印付き操作案内で示します。

## 7. 通常Entry16の開始手順

1. 各自の16枚を確認。
2. シャッフル。
3. 全16枚をライフに裏向きで置く。
4. 7枚引いて手札にする。
5. ライフから1枚を表向きの防壁としてプリセット。
6. 次の1枚を表向きの兵士としてプリセット。Entry16ではA・絵札も兵士になる。
7. 両者ライフの一番上を公開し、大きい数字の人が先攻。同数なら次のカードで比較。公開したカードはすべて墓地へ。
8. 先攻だけライフから1枚引いてゲーム開始。

通常準備以降はカードの種類・ライフ枚数を画面で仮定しません。
先攻A/Bだけを記録し、開始時ドローに反映します。通常対戦の進行は実物で管理します。

## 8. アクション早見

ライト対応の19項目を正規YAMLのformatから抽出します。

- 基本：エンド、チャージ、ドロー、アタック、ブロック、ダメージ判定、世代交代。
- 召喚：防壁設置、兵士召喚、英雄召喚、エース召喚、装備。
- 魔法：アップ、ダウン、ツイスト、カウンター、防壁破壊、投擲、サーチ。

サーチはライト対応ですが、Entry16にはキーカードのJokerがないため使えない旨を明示します。
名前、用途、必要カード、コストを常時表示し、効果・条件・対象・トリガー・タイミング等は詳細内に置きます。
コストの文字列は正規YAMLを読み、日本語に展開します。詳細の効果文章は正規YAMLそのものです。
検索、遊び方・困ったとき、公式ルールへのリンクを用意しています。

フォーマット差分もYAMLから算出します。スタンダードで基礎魔法が初めて増える、という旧説明は削除しました。

## 9. PC表示確認

1440×900の実ブラウザで全22操作を実行。
準備、アタック、ブロック、墓地移動、召喚、ターン交代、先攻Bと開始ドロー、対戦用早見まで確認しました。
横方向のはみ出しはありません。公式配置図に合わせ、Aのライフ・墓地は右、Bは左に配置しました。

## 10. 390pxモバイル表示確認

390×844で全22操作を実行。
カードと移動先、縦横、墓地への移動、操作後の説明、ドロワー、早見検索と詳細を確認しました。
先攻Aを選んだ状態で再読み込みし、操作する人とターンの復元を確認しました。
横方向のはみ出しはありません。長い準備手順では縦スクロールを使います。
次のステップではページ先頭へ戻すため、新しい操作する人・指示を見落としにくくしました。

## 11. Tutorialテスト

Docker経由でVitest 26件成功（schema 13、UI 7、保存 6）。
schema、参照ID、盤面の連続性、操作カード、16枚の保存、actor A/B、回転と墓地移動、
進捗の保存・再開・リセット、旧進捗の無効化、先攻選択、開始ドロー、早見を検証しました。
GitHub Pages用base pathでschema検証・TypeScript・Viteビルドが成功しています。
Windows Dockerのファイル監視をポーリングに変更し、編集反映も確認しました。

## 12. 既存Simulator

Docker経由で既存19ファイル・113件のテストが成功しました。Simulatorの実装は変更していません。

## 13. 公式ルール・YAMLの確認結果

参照：

- リポジトリの `tools/actionlist/original/act.yaml`、`frame.yaml`
- `source/common/common.rst`、`common-action.rst`、`common-component.rst`
- `source/frame/images/entry.png`
- [公開公式共通ルール](https://blackpoker.github.io/BlackPoker/master/common/common.html)
- [公開公式アクション・キャラクター一覧](https://blackpoker.github.io/BlackPoker/master/auto/actionlist.html)
- [公開公式フレーム](https://blackpoker.github.io/BlackPoker/master/auto/framelist.html)

確認・修正した点：

1. ブロックのYAMLは兵士の指定を要求しますが、ドライブを要求していません。旧Tutorialの横向き指示を除去しました。
2. charListでは一般兵だけでなく、英雄・エースも兵士です。プリセットでA/J/Q/Kを捨てる旧指示を除去しました。
3. 先攻決定と先攻だけの開始時1ドローを、共通開始手順に基づいて追加しました。
4. 基礎魔法、装備、防壁破壊、投擲、サーチはライトにも対応しています。名称や用途の独自推測で除外せず、YAMLから一覧を作ります。
5. 公式リンクを現在の公開master配下へ更新し、アクションページはHTTP 200と召喚などのアンカーIDを確認しました。

表裏に関する不整合・適用範囲の注意：

- charListの防壁は「全て(裏向き)」、通常の防壁設置も「裏向き」。
- 一方、共通プリセット手順は「表向きにして防壁」と明記。
- frame.yamlは共通プリセットを参照し、独自の表裏は定義していません。

正規ソースは書き換えず、Tutorialでは「開始時プリセットは共通手順に従い表向き」「通常の防壁設置はYAMLに従い裏向き」と個別に案内しています。
表向きプリセットとキャラクター定義の一般表記の関係は、公式側で明文化を検討できる点です。

## 14. 変更ファイル

移動対象は旧 `tools/tutorial/` の全追跡ファイルです。主な変更・追加：

- `.gitignore`、`.github/workflows/deploy-tutorial-pages.yml`
- `tutorial/Dockerfile`、`compose.yaml`、`package.json`、`vite.config.ts`、`tsconfig.json`
- `tutorial/README.md`、本報告書
- `tutorial/scripts/rule-source.mjs`、`generate-rule-catalog.mjs`、`validate-tutorials.mjs`
- `tutorial/src/App.tsx`、`types.ts`、`styles.css`
- `tutorial/src/components/TutorialBoard.tsx`（新規）、`ActionHelp.tsx`（新規）、`CurriculumPanel.tsx`、`RuleLinks.tsx`
- `tutorial/src/data/curriculum.ts`、`data/tutorials/entry16.json`
- `tutorial/src/generated/ruleCatalog.ts`
- `tutorial/src/hooks/useTutorialProgress.ts`、`lib/storage.ts`、`lib/schema.ts`、`lib/schema.mjs`、`lib/schema.d.mts`
- `tutorial/tests/App.test.tsx`、`schema.test.ts`、`storage.test.ts`、`setup.ts`

旧CardVisualは継続盤面に置換して削除しました。
`index.html`は配置移動とブラウザのテーマ色修正、`package-lock.json`、`main.tsx`、`vite-env.d.ts`は配置を移動しました。

## 15. コミット

コミットSHAと最後のgit statusの結果は作業完了メッセージに記載します。
