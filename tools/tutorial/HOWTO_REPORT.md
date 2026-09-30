# Interactive HowToBlackPoker 初心者導線の改善報告

基準HEAD: `3f4ba3e8569f2de19205b0584c2f946cfaac1e7b`。
開始時にoriginをfetchし、localとremoteが同一であることを確認した。

## 1–3. 防壁blockの原因・修正・初期state

`makeBulwarkFixture` は既存blockのbeforeをcloneし、BのD5とC6を交換した後、faceだけをdownにしていた。元盤面の防壁はdriveのため、横向きの防壁をブロッカーに指定する誤った教材になっていた。

修正後は `face: "down", state: "charge"` を明示する。選択→アタッカー指定では状態を変えない。damageJudgeで表向きに公開し、6が一致する攻撃側を墓地へ、その後防壁を墓地へ移す。ライフは減らない。

現行act.yamlのattack / block / damageJudgeとcharList.bulwark、common-component.rstのチャージ／ドライブを確認。ドライブ状態のキャラクターは防壁を含めブロッカーに指定できない。schemaにも、ブロックのselect-targetのsourceがchargeであることの検証を追加した。これは教材整合性検証であり、新しいゲームエンジンではない。

## 4–11. 初心者導線・前提・解説

変更前: INTRO → 兵士同士の戦闘 → ブロックなし → 戦力・魔法 → 防壁。盤面確認は末尾の任意復習。

変更後: INTRO（勝ち方） → **盤面と向き → 守らない攻撃 → 兵士で守る → 防壁で守る** → 応用の攻防 → 戦力・コスト → 魔法 → リクエスト → 誘発 → 実物Entry16。

|ID|タイトル・役割|prerequisites|
|---|---|---|
|board-overview|まずは盤面を見てみよう。5つの領域をタップして説明。全タップ不要|[]|
|unblocked-attack|まずは攻撃してみよう。アタック→ブロックで指定なし→判定→ライフ2枚|board-overview|
|first-battle|兵士で守ってみる。大きな♣6・♥7と「6 < 7」でライフを守る意味を示す|unblocked-attack|
|bulwark-block|防壁で守ってみる。大小比較ではなく数字一致|first-battle|

board-overviewのoptionalを外し、新規・リセット時の入口にする。既存保存のLesson IDと旧30操作のインデックスは変更しない。進捗の分母は盤面確認を含む9Lesson。完了集合は保持する。
盤面確認の完了記録はINTRO終了後に盤面が表示されてから行う。INTRO表示中やリセット直後に先取りで完了扱いしないこともテストした。

INTROの「相手のライフ0枚で勝ち」は既に明瞭なので、重複ページは追加せず、盤面確認の短文へ接続した。向きはCardOrientationの縦・横カード図で攻撃前に説明する。最初のflowでも「チャージ（縦）からドライブ（横）」とつなぐ。厳密な定義へのリンクと使用条件は「解説を見る」で確認できる。

unblocked-attackのcause / actionIdは維持し、ボタンを「ブロッカーを指定しない」とした。ブロック処理が起きないという意味にはしない。戦闘3アクションの主担当をこのLessonへ移し、兵士ブロックはreviewに変更。Lite19の主担当coverageを維持する。

防壁をcombatに移し、兵士ブロックの直後に配置。応用tacticsを戦力の前へ並べた。準備中20Lessonは一覧から自由に参照でき、「次へ」は公開済みのみを進む。prerequisitesはロックではない。flow / compare / anatomy / exampleはすべて維持。

## 12–13. 縦方向の圧縮

- 操作中の「画面で体験」とshortDescription、実物不要の繰り返し通知を外す。説明はミニ解説と詳細に残す。
- 上部に積まれていた完了summaryを盤面後へ移し、操作完了時だけ表示。静的な探索で開始直後の「Lesson完了」は出さない。
- 成功結果は短い結果表示中だけ出し、次の指示と積み重ねない。誤操作時も同じ指示を二重表示しない。aria-liveは維持。
- スマホのtopbarを64pxから48pxへ、カテゴリ・進捗を1行へ。actor・ターンの折返し、カード外の余白を整理。desktopのヘッダーは維持。
- 操作案内のstickyを外し、盤面への重なりを避ける。カード本体は縮小せず、操作領域はスマホ44×48px以上を維持。
- 一覧は現在カテゴリのみ開く既存構造を継続。スマホのカテゴリ名と件数を1行にまとめる。
- 独立Lesson・scene内部の継続盤面・operation / interaction・矢印・選択表示はそのまま再利用。

## 14. 390×844の実ブラウザ確認

同じローカルURL・viewportで、Lesson操作開始時のページ最上部から.persistent-board上端までをDOM矩形で測定（scrollYを加算、開始時scrollY=0）。小数点以下は丸めた。

|画面|変更前|変更後|改善|
|---|---:|---:|---:|
|盤面と向き|645px|316px|329px上へ|
|守らない攻撃|485px|251px|234px上へ|
|兵士ブロック|485px|251px|234px上へ|
|防壁ブロック|485px|251px|234px上へ|

盤面確認の盤面下端は818pxで、844pxのファーストビュー内に両プレイヤーの全領域が入る。攻撃開始時の下端は753px。盤面の操作領域最小幅44pxを実測。横overflowなし。

INTROの勝ち方 → 盤面・向き → ライフ説明のタップ → 最初のflow → ♠2のアタック → ブロッカー指定なし → ライフ2枚を1枚ずつ墓地へ → 兵士Lesson → アタック・♥7で指定・♣6を墓地へ → 防壁Lesson → 縦向き防壁を指定・公開・攻撃側と防壁を墓地へ、を通し操作した。

選択カード・移動先・矢印、ブロック前後の防壁の縦向き、ライフが守られる結果、完了時だけのまとめを確認。新しいsticky案内が盤面を覆うことはない。メニューは現在combatだけ開き、準備中20Lessonが一度に露出しない。見出し・ボタン・比較図・縦のflowに重なりなし。

## 15. 1440×900の実ブラウザ確認

横並び3段階flowと余白、大きな盤面、サイドバーを確認。誤ったカードでは進まず案内が出る。Enterでアタック・ブロッカー選択、Spaceで対象確定、PCドラッグで♣6を墓地へ移し、完了できた。詳細から公式のブロック定義を参照でき、ルール早見の開閉も正常。DOMでviewport1440×900、横overflowなしを確認。

## 16–19. テスト結果

Node系コマンドはすべて既存Docker compose内で実行。Simulatorソース・Docker・ブランチ別Pages・workflowは変更していない。

|確認|結果|
|---|---|
|Tutorial全テスト|8ファイル、103件成功（従来98件＋5件）|
|tutorial data validation|scenario・curriculum・Lite coverage・参照・fixture整合性が成功|
|production build|TypeScript / Vite成功、VITE_BASE_PATH=/BlackPoker/tutorial/|
|Simulator全回帰|19ファイル、113件成功|

追加・更新した検証: 防壁down/charge、指定でドライブしない、公開後の処理とライフ保護、driveの防壁・兵士fixture拒否、初回4Lessonの順序と前提、INTRO後の探索・向き・攻撃、通し操作と再読込。既存tap / drag / keyboard / 誤操作 / scene完了 / 保存互換 / 先攻 / real / 早見 / pending / 直接移動の回帰は維持。

初心者目線の自己レビューでは、勝ち方→置き場→向き→攻撃の目的→守る意味→守り方の違いが、短い説明と自分の操作でつながることを確認した。全体は3つの戦闘Lessonと短い盤面探索の再利用で、未実装魔法の大量追加やアーキテクチャ変更はない。

## 20. 変更ファイル一覧

すべてtools/tutorial/内。

- README.md
- HOWTO_REPORT.md
- LEARNING_MAP.md
- src/App.tsx
- src/components/CardOrientation.tsx（追加）
- src/data/learning-path.json
- src/data/lessons.ts
- src/data/bulwark-fixture.mjs
- src/data/tutorials/entry16.json
- src/lib/schema.mjs
- src/styles.css
- tests/App.test.tsx
- tests/Lessons.test.tsx
- tests/curriculum.test.ts

## 21–25. コミットとpush

現在の作業ブランチ `635-kaizen-チュートリアルサイト作成` にコミットし、originの同名ブランチへpushする。
コミット自身のSHAはファイルへ自己参照で記録できないため、実行後のSHA・push結果・local/remote HEAD一致・最終git statusを完了メッセージに記載する。
