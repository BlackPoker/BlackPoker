# Interactive HowToBlackPoker 実装・検証報告

基準HEAD: `82ed1bc4735390cff4df588f2257bd7b79b9700e`。開始時にoriginをfetchし、同一HEADであることを確認した。

## 構成と公開範囲

INTRO → ミニ解説 → 自分でカード操作 → Lesson完了、という導線へ移行した。詳細な現行定義は「解説を見る」で開く。既存interaction engine、6scene・30micro step、realモード、ルール早見、8コースのロードマップを保持する。

|分類|今回公開した内容|準備中|
|---|---|---|
|1. まず戦ってみる|最初の戦闘、ブロックなし、任意の盤面復習|なし|
|2. 戦力を増やす|兵士の比較・召喚、防壁設置、ターン交代|英雄召喚、エース召喚、装備|
|3. 魔法を使う|アクションの読み方（ミニ解説のみ）|アップ、ダウン、ツイスト、カウンター、投擲、防壁破壊の操作|
|4. 攻防を深く知る|防壁ブロック|複数アタック、複数ブロック、同数、戦闘中の魔法、対象消失|
|5. リクエストの処理を知る|入口・参照・推奨前提のみ|チャンス、スピードの操作|
|6. 誘発を知る|入口・参照・推奨前提のみ|誘発の復習、世代交代、同時誘発の操作|
|7. Entry16で遊ぶ|実物カード準備から対戦まで9操作|なし|
|別枠：Joker特別Lesson|入口と公式参照|サーチの操作|

公開済みは7操作Lesson＋読み方1Lesson、別に任意の盤面復習。未完成20Lessonは明示的に「準備中」とし、完了記録を付けられない。おすすめ導線は公開済みLessonだけを進む。一覧は準備中も閲覧でき、prerequisitesによる強制ロックはない。

## 最初の戦闘・解説画面

INTRO直後は「まず戦ってみよう」。3段階のflowを見て「やってみる」を押すと、♣6をタップしてアタック、♥7→♣6を指定してブロック、6 < 7を確認して♣6を墓地へ移す。事前の盤面探索は必須にしない。

`LessonExplainer` は共通のタイトル・状態・CTA・詳細・任意動画を提供する。`ConceptSlide` は次の4型を描画する。

- flow：戦闘・ターン交代・防壁設置。PCでは横並び、スマホでは縦と矢印。
- anatomy：アップのタイミング・スピード・コスト・キーカード・対象を生成カタログから表示。効果は短い教材要約、全文は詳細へ。
- compare：一般兵・英雄・エースのキー、サイズ、ラベルをcharList由来のカタログから比較。
- example：Entry16の大きなカード図と式。ブロックなしの「♠2 → 2点」、アップの「6＋4＝10」（操作は準備中）。

動画は任意のYouTube metadata（URL/title/note/edition）。ユーザー操作後だけダイアログに読み込み、autoplayしない。閉じると同じLesson・元のフォーカスへ戻る。旧版は注意書きを必ず表示する。実在の教材URLは提供されていないため、現在のLessonには動画を登録していない。開閉・注記・URL検証はコンポーネントテストで確認した。

## 教材盤面・ルール・将来Lesson

Entry16の16枚は変更していない。旧sceneの開始時beforeを各Lessonの独立fixtureとして再利用する。Lesson間で前の対戦を継続するとは案内せず、盤面を戻す架空のゲーム操作も挿入しない。scene内部のbefore/after・順次操作・整合性検証は維持した。

新しい防壁ブロックfixtureでは、Bの防壁を選択→Aの攻撃側を指定→防壁を表に公開→6が一致したAの♣6を墓地へ→Bの防壁も墓地へ、を4操作として追加した。同じプレイヤー内のカード重複はなく、双方の16枚を保存する。防壁は兵士同士の大小比較ではない。

Liteアクション対応表・キャラクター・基本ルール・必要interactionは [LEARNING_MAP.md](LEARNING_MAP.md) に記載。現行YAMLから機械的に列挙した19アクションすべてに主担当Lessonを1つ割り当て、復習はreviewActionIdsとして区別した。**19/19は割当coverageであり、操作実装coverageではない。操作体験は8アクションが実装済み。**

チャンスは魔法の後、誘発はチャンスと具体的な戦闘・ターン交代の後に配置。将来のSTAGE・パス・逆順解決、誘発の段階化、世代交代、AP/NAP/controllerの教材方針は対応表に記録した。現エンジンに未対応のステージ・フォグ・サイズ修正・条件付き探索を、見た目だけ実装済みにしない。サーチはJoker別教材であり、Entry16へJokerを追加しない。

現行 `act.yaml` の全Liteアクション、charList、frame.yamlのEntry16、common-action.rst、triggerflow.puml / triggerflow_detail.pumlを確認。特に防壁の数字一致・Joker判定、ドロー2枚（ライフ2以下なら1枚）、召喚コスト、魔法のキー・対象・speed、世代交代・サーチを確認した。

旧資料からは依頼文で示された「1画面1概念」「流れ」「比較」「具体例の後に仕組み」を採用した。旧ドロー選択制、旧「通常効果／即時効果」「速攻魔法」「召喚酔い」や古い誘発処理は移植していない。未提供PDF・動画の全文を読んだ、または完全照合したとは扱わない。

## エンジン・検証・保存

`interaction.mjs` と `TutorialBoard` は変更なし。hookにはface変更時に「表向きに公開」と結果を伝える処理だけを追加。Lessonを選び直した場合は、解説専用Lessonを経由した復習でもscene先頭へ戻る。

新curriculum schemaはID重複、前提の存在・循環、scene参照・重複、real手順の順序、主担当actionIdの欠落・重複、復習参照、説明型、任意動画を検証する。現時点では1Lessonは1sceneまたは既存real手順全体とし、未対応の複数scene指定を黙って無視しない。

旧localStorageのscenarioId、30操作のstepIndex、maxReachedStepIndex、先攻、完了状態を維持。新Lesson保存は別キーで現在ID・完了集合を保持する。旧最高到達から新Lessonの完了を推測しないため、Lesson完了数は新たな指標である。復習・再操作で完了集合と最高到達は減らない。「最初からやり直す」は双方をリセットしてINTROへ戻る。

## 検証結果

すべてのNode実行はDocker内で実施した。

|検証|結果|
|---|---|
|Tutorial全テスト|8ファイル、98件成功|
|データ検証|scenario、curriculum、Lite coverage、参照、fixture連続性すべて成功|
|production build|TypeScript・Vite成功。VITE_BASE_PATH=/BlackPoker/tutorial/|
|Simulator回帰|19ファイル、113件成功|
|既存6scene|全20ゲーム操作の回帰成功|
|realモード|9操作、先攻選択、開始時1ドロー、早見への遷移成功|
|追加検証|動画なし完了、説明→操作→次Lesson、直接移動、準備中、保存互換、防壁公開、復習初期化、動画開閉成功|

390×844ではINTRO、最初の戦闘flow、カードのクリック操作、ブロック対象指定、墓地への移動、Lesson完了、解説、mobile drawer、直接Lesson移動、比較・読み方・example、real入口と配置ガイドを確認。flowの親子クラス名の衝突を修正し、見出しと一覧の重なりを解消。比較文はスマホで全幅にして詰まりを解消した。横方向のoverflowなし（document幅375px、viewport390px）。

1440×900ではINTRO、横並びflow、Enterによるアタック、クリックによるブロック、PCドラッグによる墓地移動、完了、解説、一覧と直接移動、新防壁Lesson全操作、realへの遷移、横並びcompareを確認。viewportは1440×900、横overflowなし。ブラウザのerror/warnログは0件。実際の動画は未登録のため実ブラウザで外部動画を再生していない。

検証用ローカルタブを閉じ、viewport設定は元に戻した。ユーザーが開いている公開サイトのタブは変更していない。

## 変更ファイル

すべて `tools/tutorial/` 内。配置、Docker設定、package files、既存GitHub Pages workflow、Simulatorのソースは変更なし。

- README.md
- LEARNING_MAP.md
- HOWTO_REPORT.md
- scripts/validate-tutorials.mjs
- src/App.tsx
- src/components/CurriculumPanel.tsx
- src/components/TutorialIntro.tsx
- src/components/LessonExplainer.tsx
- src/data/learning-path.json
- src/data/lessons.ts
- src/data/bulwark-fixture.mjs
- src/data/bulwark-fixture.d.mts
- src/data/tutorials/entry16.json（実物準備の見出しのみ）
- src/hooks/useSceneInteraction.ts
- src/lib/curriculum-schema.mjs
- src/lib/curriculum-schema.d.mts
- src/lib/lesson-storage.ts
- src/styles.css
- tests/App.test.tsx
- tests/Lessons.test.tsx
- tests/curriculum.test.ts

コミットSHA、push先・結果、local/remote HEAD一致、最終statusは、コミット・push後の完了メッセージに記載する。
