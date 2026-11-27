# BlackPoker Simulator 作業7A：エクストラフレーム全体調査・共通アーキテクチャ設計書

- **作業番号**: 作業7A（調査・分析・設計・実装計画策定のみ／実装非着手）
- **対象リポジトリ / ブランチ**: `BlackPoker/BlackPoker` / `BlackPoker/issue551-core-flow`
- **関連 Issue**: `#551`
- **基準コミット**: `fa2d8ab288554637e90a677348459e541a43aed9`（作業6完了時 HEAD / 作業6最終 CI Run ID: `45896123655`）
- **関連ドキュメント**:
  - 全切札・全アクション棚卸し: [`work7a_extra_frame_inventory.md`](./work7a_extra_frame_inventory.md)
  - 公式ルール仕様確認事項: [`work7a_extra_frame_rule_questions.md`](./work7a_extra_frame_rule_questions.md)
  - 作業7B〜7D 実装ロードマップ: [`work7a_extra_frame_implementation_plan.md`](./work7a_extra_frame_implementation_plan.md)

---

## 1. 調査対象資産と公式正本の確定

### 1.1 公式ルール・公式 YAML 資産の確認結果

リポジトリ内の公式ルールソースおよび YAML 定義を精査した結果、タグ `v9.1.2` から現在 `HEAD`（`fa2d8ab288554637e90a677348459e541a43aed9`）までの間に `tools/actionlist/` 配下の YAML 定義へ変更は一切入っていない（差分 0 件）。`source/` 配下の `v9.1.2..HEAD` 差分は Issue `#642` 関連の v9.2 コアフローフォーカス機構導入（`source/core/core.rst`、`source/revision-history/9.2th.rst`）および `source/appendix/guideline/shortcut.rst` のみである。

| 種別 | 公式正本パス | 位置付け・記載範囲 |
|---|---|---|
| 公式フレーム定義 | `tools/actionlist/original/frame.yaml` | `entry16` / `pack` / `rarePack` / `strategy` / `extra`（L80-104）/ `draft`（L106-135）の構築手順・デッキ要件・継承関係 |
| 公式フレームアクション・切札・特殊兵士・フォグ定義 | `tools/actionlist/original/act-frame.yaml` | v9.1.2 現行正本。パック/レア操作 4・切札操作 4・切札固有アクション 53・特殊兵士 6・フォグ 1・表切札 30・裏切札 1 を定義 |
| 公式基本フォーマット定義 | `tools/actionlist/original/act.yaml` | ライト〜マスターの基本アクション 37・基本コンポーネント 9（うちキャラクター 6・フォグ 3） |
| 公式ルール本文（Sphinx `.rst` / `.csv` / `.puml`） | `source/index.rst`, `source/match-regulations/match-regulations.rst`, `source/common/*.rst`, `source/common/public-level.csv`, `source/common/zone-component.csv`, `source/format/format.rst`, `source/frame/frame.rst`, `source/core/core.rst`, `source/core/coreflow.puml`, `source/appendix/pdf-links.rst`, `source/revision-history/9.0th.rst`〜`9.2th.rst` | 第2章（対戦レギュレーション）、第3章（3.9 ゲーム開始・3.9.1〜3.9.3）、第4章（4.4 切札・4.5 よくある質問）、第5章（共通アクション・解決・誘発）、第6章（6.1 公開レベル・6.1.1 墓地TOP）、第7章（フォーマット）、第8章（8.3.1.5 エクストラ・8.3.2〜8.3.5 リスト）、第9章（コアルール・フォーカス・コアフロー）、第10章（10.2.3 マスター＋エクストラ・10.3 エクストラリスト） |
| JSON Schema | `tools/actionlist/original/act.schema.json`, `tools/actionlist/original/frame.schema.json` | ビルド非統合のため現行 v8/v9 フィールドと不整合あり（詳細は [`work7a_extra_frame_rule_questions.md`](./work7a_extra_frame_rule_questions.md) `Q-014`） |
| **未使用レガシー資産（採用禁止）** | `tools/actionlist/original/extra.yaml` | 第7版 `v7.30.0`（2024/4/8）時点の旧データ。`tools/actionlist/pom.xml` から参照されておらず、現行の公式仕様としては採用しない |

> [!IMPORTANT]
> **`tools/actionlist/original/extra.yaml` を正本にしない根拠**
> `extra.yaml` には旧第7版名称・効果（`♡3 激励`→現行 `誘惑`、`♡J チャリオット`→現行 `破砕士`、旧 `オープン $BBD`→現行 `メインオープン $BBL`＋`クイックオープン $DD`、廃止済みの `♣8 前触れ(8ダメージ)`・`切札リセット`・`♢5 疲弊`・未分割 `切札再生` 等）が残存しており、`pom.xml` の生成パイプライン（`act-frame.yaml` + `frame.yaml` → `framelist.rst` / `frameActionlist.rst`）から完全に除外されている。作業7では必ず **`act-frame.yaml` と `frame.yaml` を正本** とする。

### 1.2 用語の厳密な区別

公式ルール第2章・第4章・第5章・第7章・第8章に基づき、Simulator 設計上も以下を厳密に分離する（**エクストラを独立したフォーマットとして実装しない**）。

| 用語 | 公式上の分類 | Simulator 上の位置付け |
|---|---|---|
| **マスター** (`mast`) | フォーマット | `src/data/regulations/formats/mast.yaml`（基本37アクション・9コンポーネント） |
| **エクストラ** (`extra`) | フレーム（`inherits: ストラテジー`） | 新設予定 `src/data/regulations/frames/extra.yaml`（フレーム固有Setup・フレームアクション・切札/特殊兵士/フォグ群） |
| **マスター＋エクストラ** (`mast-extra`) | 対戦レギュレーション | 新設予定 `src/data/regulations/regulations/mast-extra.yaml`（`formatId: mast` + `frameId: extra`） |
| **切札** | コンポーネント（`type: trump`） | `player.trumps` に配置されるコンポーネント群（`表切札` 30種＋`裏切札` 1種） |
| **アクション** | ルール上実行される行動 | 切札操作 4＋切札固有 53＋既存フレーム共通 4＝フレーム 61アクション（フォーマット 37 と合わせ計 98） |
| **能力** | コンポーネント／キャラクターが持つ常在・起動・誘発記述 | `trumpAbility`（8切札・9条項）および `charAbility`（6特殊兵士）。発動可否・誘発条件の多くは `actList` 側へ正規化済み |
| **ラベル** | コンポーネントやキャラクターが付与される属性 | 切札自体の `trumpLabel` は **0件**。ただし6種の表切札能力が場のユニットへ 6種の属性ラベル（`<革命ドロー>`, `<スラッシュ>`, `<誘惑>`, `<ファントム>`, `<交渉>`, `<スイッチ>`）を動的付与する |

---

## 2. エクストラフレームの公式ゲーム開始（Setup）・公開レベル仕様

### 2.1 デッキ・シナリオ構築と開始手順（全11ステップ）

`frame.yaml:80-104`、`source/common/common.rst:26-66, 209-262`、`source/match-regulations/match-regulations.rst:169-225` により定義される `エクストラ`（および推奨 `マスター＋エクストラ`）のゲーム開始手順は以下のとおりである。

1. **使用デッキ構成**: **40〜54枚**（`40枚以上`、4スート `♠♡♢♣` の各 `A〜K` はスート＋数字の組合せ重複不可、`Joker` は最大2枚まで投入可能）。数字換算は `Joker=0, A=1, 2〜10=額面通り, J=11, Q=12, K=13`。
2. **Step 1 — 切札の事前選択と配置（2枚）**: デッキから物理的に **2枚** を選び、2枚とも自分の切札置き場に **裏向き（`裏切札`）** で配置する（`frame.yaml:87`、`secretTrump` の `trumpKey: 全て(裏向き)`）。
   - **同スート／同数字の制約**: 同一デッキから物理的に2枚を取り出すため同一スート＋数字の重複は不可能（`Joker` 2枚を除く）だが、**同じスート 2枚**（例：`♠A` + `♠2`）や **同じ数字 2枚**（例：`♠J` + `♡J`、`♠K` + `♡K`）の選択に禁止規定はない。
   - **表切札スクリプトの有無**: 全52種＋Joker のうち **30枚に表切札スクリプトが存在** し、残り22種（全スートの `6`・`Q` 等）＋`Joker` には表切札スクリプトが存在しない（非スクリプト札をブラフ等で選出した場合の扱いは [`work7a_extra_frame_rule_questions.md`](./work7a_extra_frame_rule_questions.md) `Q-002`）。
3. **Step 2 — シナリオ手札の選択（3枚）**: 残りのデッキから最初の手札に入れる **3枚** を選ぶ（切札 2枚と物理カード排他）。
4. **Step 3 — レアカードの選択（1枚）**: 残りのデッキから **1枚** を選び、レアカード領域へ裏向きで配置する（ここまで事前計 **6枚** を排他確保）。
5. **Step 4 — パック構築**: 残りのデッキ（34〜48枚）をシャッフルし、上から **14枚** を未開封のパックとして裏向きに配置する。
6. **Step 5 — ライフ構築**: 残りのカード（20〜34枚）を裏向きのままライフとする。
7. **Step 6 — ランダム手札のドロー（4枚）**: ライフの上から **4枚** を引き、シナリオ手札 3枚と合わせて初期手札 **7枚** とする（残りライフ 16〜30枚）。
8. **Step 7 — エクストラ固有プリセット配置**:
   - ライフの一番上のカードを **防壁（裏向き・チャージ状態）** として場に出す（`common.rst:225` は誤って「表向き」と記載しているが、`act.yaml:721` の防壁条件 `全て(裏向き)` および `frame.yaml:93` に従い裏向きが正；`Q-001` 参照）。
   - 次のライフの上のカードを **兵士の場所に「裏向き」で出す**（`common_gamestart_preset` と異なりこの時点ではまだ公開しない）。
9. **Step 8 — 先攻・後攻の決定（`3.9.2`）**: 互いに手札 7枚・プリセット完了後、両者同時にライフの一番上を表向きでめくり、大きい数字（`K=13 > ... > A=1 > Joker=0`）を先攻とする。同値の場合は決着までめくり続け、めくったカードはすべて各プレイヤーの墓地へ移す（同値により2枚以上墓地へ移った場合、`6.1.1` によりオーナーが墓地の一番上を選ぶ）。
10. **Step 9 — 先攻プレイヤーの初期公開**: 先攻プレイヤーが、裏向きで出しておいたプリセット兵士カードを表向きにし、さらに **切札 2枚のうち 1枚を表向き（`表切札`）** にする（`frame.yaml:95`）。
11. **Step 10 — 後攻プレイヤーの初期公開**: 後攻プレイヤーは、**先攻プレイヤーが表にしたプリセット兵士と表切札（1枚）を確認した上で**、自分の裏向きプリセット兵士を表向きにし、**自分の切札 2枚のうち 1枚を表向き（`表切札`）** にする（`frame.yaml:96`）。
12. **Step 11 — ゲーム開始（`3.9.3`）**: 先攻プレイヤーがライフから 1枚ドロー（初期手札 8枚）し、**ターン・チャンス・フォーカス** を受け取って対戦を開始する（開始時誘発は 0件）。

### 2.2 初期公開時の情報可視性と全状態の公開レベル（`6.1`、`public-level.csv`）

後攻プレイヤーが Step 10 で 1枚目の切札を表にする際に参照できる情報、および対戦中すべての状態における切札・関連カードの公開レベルを以下に整理する。

| 状態・領域 | オーナー本人の可視範囲 | 対戦相手の可視範囲 | 非公開（両者不可） | 公式根拠 |
|---|---|---|---|---|
| **切札：選択中（開始前）** | 自身のデッキ・選択中カード | 閲覧不可（パス＆プレイ切替で遮断） | — | `frame.yaml:87`, `init.rst:142` |
| **切札：裏向き（`裏切札`）** | 枚数・配置位置・**カード内容（スート・数字）** | 枚数・配置位置・付与中の `クローズ` フォグのみ（**中身非公開**） | なし | `public-level.csv:9`（個人公開） |
| **切札：表向き（`表切札`）** | 枚数・カード内容・有効能力 | **完全公開**（カード内容・有効能力） | なし | `public-level.csv:9`（完全公開） |
| **開始時 Step 10（後攻選択時）** | 自分の切札2枚の中身・手札7枚・レア1枚・自分の防壁・自分のプリセット兵士 | **先攻プレイヤーの公開済みプリセット兵士・先攻が表向きにした1枚目の表切札**・先攻決定時にめくられた墓地カード（先攻の手札・レア・防壁・2枚目の裏切札は非公開） | 両者の未開封パック14枚・ライフ順・山札残 | `frame.yaml:94-96`, `public-level.csv` |
| **場：2枚組特殊兵士化** | 構成2枚・サイズ・チャージ/ドライブ | **完全公開**（構成2枚のカード内容・サイズ・状態・付与ラベル） | なし | `act-frame.yaml:1219, 1259`, `public-level.csv:4` |
| **場：防壁へ変換（`リバース`/`幻影`）** | 1枚ずつの構成カード中身・並び順・状態 | 枚数（2体）・並び位置・状態（**中身は非公開**） | なし | `common-component.rst:313-319`, `public-level.csv:4` |
| **墓地へ移動（通常・敗北時）** | 墓地全体（`6.1.1` で 2枚以上同時ならTOP選択） | **墓地の一番上のカードのみ公開**・総枚数 | なし | `common-etc.rst:43-51`, `public-level.csv:3` |
| **手札へ移動（`帰還`/`誘惑`/`スイッチ`）** | 手札内の2枚とも確認可能 | 手札枚数のみ公開（ただし場から戻る瞬間は「何が戻ったか」の事実は場上で観測済み） | なし | `common-component.rst:320-323`, `public-level.csv:5` |
| **ライフへ移動（`死の槍`/`救済`/`ドレイン`）** | ライフ総枚数のみ（10枚未満か以上かに限らずオーナーは枚数把握可） | 10枚未満なら実数、10枚以上は `"10以上"` | **ライフの中身・並び順は両者非公開** | `public-level.csv:2`, `ObservationFactory.ts:47-54` |

### 2.3 既存 Setup 機構との共通化設計

現行 Simulator の Setup 系クラスはストラテジー向けに事前選択機構を備えており、`mast-strategy` を丸ごと複製するのではなく共通機構を拡張して再利用する。

| 既存機構（パス） | 現行機能 | エクストラ対応時の共通拡張方針 |
|---|---|---|
| `RegulationDefinition.ts`（L44-73） | `FrameSetupDefinition` に `initialHandCount`, `scenarioHandCount`, `packCount`, `rareCardCount`, `preset` を定義 | `trumpCount?: number`、`presetSoldierInitialFace?: "up" \| "down"`（既定 `"up"`）、`initialOpenTrumpCount?: number`、および `FrameDefinition.components?: readonly string[]` を追加 |
| `PhysicalCardReservation.ts`（L1-204） | `PlayerPreShuffleSelections` が `scenarioHand` と `rareCards` の2領域を物理カード単位で相互排他検証・デッキから抽出 | `trumps?: readonly CardOccurrenceSpec[]` を追加し、**3領域（`trumps` × `scenarioHand` × `rareCards`）の総当たり相互排他検証** へ拡張（汎用ループ化） |
| `RareCardSelectionService.ts` / `ScenarioHandSelectionService.ts` | カード枚数検証・重複検証・AI用決定論的デフォルト選択を提供 | 共通の `PreShuffleSelectionHelper` を抽出するか、同パターンの `TrumpSelectionService.ts` を配置し、`extractReservations()` は `OfficialRegulationMatchSetup.setupDraftZones()` が一元処理する |
| `OfficialRegulationMatchSetup.ts`（L194-541） | `setupDraftZones()` → `setupMatch()` でプリセット・先攻決定・ゲーム開始を実行、`player.trump: []` 初期化 | ① `p.trumps` 配列に切札2枚を裏向きユニットとして格納、② `presetSoldierInitialFace === "down"` 時は裏向きで場に出す（または初期公開設計と統合）、③ `verifyCardConservation()`（L88-154）へ `trumps` を必ず合算 |
| `OfficialRegulationMatchFactory.ts` / `PlaytestEnvironmentController.ts` | `MatchStartRequest` / `ActiveMatchContext` に `scenarioHandSelections` と `rareCardSelections` を受け渡し | `trumpSelections`（および初期公開を Setup 内で行う場合は `initialOpenTrumpSelections`）を追加 |

#### 先攻→後攻の順次初期公開（Step 9〜10）の設計案比較

公式ルールでは **「先攻決定後、先攻がプリセット兵士と切札1枚を表にしてから、後攻がそれを観測して自分の切札1枚を表にする」** 順序が定められている。かつ本プロジェクトの恒久設計原則として「**ゲーム内フェーズを導入しない**」「**Replay / Undo は初期 Setup＋DecisionTranscript で決定論的再現可能**」が課されている。

| 比較軸 | **案1（推奨）：Core `DecisionRequest` による開始時逐次公開** | **案2：Setup ウィザード段階完了方式** |
|---|---|---|
| 処理イメージ | `setupMatch()` は裏向きプリセット兵士＋裏切札2枚＋先攻決定完了状態で `GameSession` を生成（`turnCount: 0`）。`GameSession.advance()` が `pendingInitialReveals`（`state` 上のキュー：まず `firstPlayer` の開く切札1枚選択、続けて `secondPlayer` の開く切札1枚選択）を `DecisionRequest` として発行し、2名分の選択完了後に `applyGameStart`（先攻1ドロー＋`turnCount=1`＋ターン/チャンス/フォーカス付与）を実行する。 | Setup 画面上でシード確定・先攻決定まで裏実行し、UI上で P1・P2 それぞれに初期公開選択させた後に `GameSession` を開始する。 |
| 長所 | ① AI vs AI / Headless バッチ / Replay / Undo がすべて既存の `DecisionRequest` / `DecisionTranscript` で統一処理され、AI が「相手の表切札を見てから自分の表切札を選ぶ」戦略学習も自然に可能。② 対戦中の「ゲーム内フェーズ」は増えず、プリセット解決前の開始時手順として閉じている。③ `ReplayPlanV1` に初期公開選択を増やさず済む。 | Setup UI とゲーム本編の `GameSession` 構造が完全分離され、`GameSession` 開始直後から `turnCount === 1` となる。 |
| 短所・注意点 | `ObservationFactory` / `DecisionFeatureEncoder` / `GenericTacticalEvaluator` が「ゲーム開始前の切札公開選択（`EFFECT_RESOLUTION` または `OPENING_TRUMP_SELECTION`）」を扱える必要がある。またプリセット兵士引き直し（`Q-001`）と整合させる必要がある。 | Pass & Play や Human vs AI、Headless 実行、Replay、Undo の **6層すべて** に先攻決定の先行実行と公開待機画面の専用状態を新設する必要があり、AI が先攻切札を見てから後攻切札を選ぶ処理が `OfficialRegulationMatchSetup` 側に重複実装となる（恒久原則「共通Core利用」「UI/Setup 側へゲーム選択ロジックを持たせない」に反しやすい）。 |

**推奨**: **案1（`GameSession` 内開始時 `DecisionRequest` 方式）** を推奨する。ただし開始手順 `frame.yaml:95-96` の性質上、ゲーム本編に新たな「開始フェーズ」を設けるのではなく、`CommonSetupProcedures` の未完了ステップ（`pendingSetupReveal` 等）を `GameSession` の開始前処理として消化完了させた上で `turnCount: 1` を開始する位置付けとし、`Q-001` の確定後に `7B-3` で実装する。

---

## 3. 現行 Simulator アーキテクチャのギャップと発見された不具合候補

調査の結果、切札関連の既存フック（`PlayerObservationView.trumps`, `StateHasher`, `AbilityEvaluator`, `examples/{fortress,revolution,giant}.yaml` 等）が存在する一方、作業7B 着手前に必ず解消すべき構造不整合およびプライバシーリスクを特定した。

| ID | 対象ファイル・行番号 | 発見された問題・ギャップ | 影響度 | 修正・対応方針（作業7B以降） |
|---|---|---|---|---|
| **G-01** | `OfficialRegulationMatchSetup.ts:370,381`, `ScenarioCompiler.ts:661`, `createCoreBattlePlaytest.ts:70,118`, `cardUtils.ts:261`, `commandHandlers.ts:970` | **`player.trump`（単数）と `player.trumps`（複数）の分裂**。Setup/Scenario は `trump: []` で初期化する一方、`cardUtils.isCardInGameZones()` は `player.trumps` のみ参照する。 | **重大** | 内部状態を **`player.trumps`（複数）に統一**（読取ユーティリティは旧スナップショット互換のためフォールバック維持しつつ、書き込み・初期化はすべて `trumps` へ移行）。 |
| **G-02** | `OfficialRegulationMatchSetup.ts:88-154` | **`verifyCardConservation` に切札領域の集計が完全に欠落**。切札 2枚を `trumps` へ配ると即座に `Card conservation violated` で失敗する。 | **重大** | `verifyCardConservation`（および `OfficialSetupAuditor.ts`）に `player.trumps`（および `unit.cards`）の物理カード走査を追加。 |
| **G-03** | `ObservationFactory.ts:334-342` | **【情報漏洩リスク】相手裏向きユニットのメタデータ露出**。`mapUnit()` が `!isViewerOwner && unit.face === "down"` 時にも `unit.kind`, `unit.componentId`, `unit.labels` を無条件コピーしている。防壁は全て `character.bulwark` だったため顕在化していなかったが、裏切札が個別 `componentId`（例 `trump.fortress`）を保持した瞬間に相手へ切札正体が漏洩する。 | **重大（機密保護違反）** | ① 裏切札状態では実体 `componentId` を `"trump.secretTrump"` / `kind: "裏切札"` として評価するか、② `ObservationFactory.mapUnit()` で `!isViewerOwner && isFaceDown && zone === "trump"`（または汎用 `!isViewerOwner && isFaceDown` の非防壁）時に `componentId: "trump.secretTrump"`, `kind: "裏切札"`, `labels: []` へ強制マスクする（**両方併用で多層防御**）。 |
| **G-04** | `SemanticFingerprintCalculator.ts:743-751` | **【情報漏洩リスク】`registerObservationIds` Pass 1 で `p.trumps` の `opaqueCardId` 正規化漏れ**。`p.field` には `else if (c.opaqueCardId)` があるが `p.trumps` に欠落しており、未正規化の `"hidden-p2-c-..."` が `pof2` / `drsf2` へ残る。 | **重大** | `SemanticFingerprintCalculator.ts:747-749` に `else if (c.opaqueCardId) { registerId(c.opaqueCardId, "card"); }` を追加。 |
| **G-05** | `CoreBattlePlaytest.tsx:2395`, `StagePanel.tsx:102-104` | **【情報漏洩リスク】`StagePanel` が生 `gameState.stage.requests` を直接描画**。`visibilityOnRequest: "hidden"` のリクエストで相手手札やレアカード等のキーカードがそのまま UI に表示される恐れがある。 | **重大** | `StagePanel` の入力を `uiBoardObservation.stageRequests` へ統一し、非オーナーには `RequestView.keyCards` のマスク済み情報のみ表示。 |
| **G-06** | `ViewerAwareGameEventFormatter.ts:560,590-614`, `CanonicalMatchLog.ts:37`, `MatchLogRecorder.ts:53-68` | ① `CardZoneName` と `normalizeCardLocation()` に `"trump"` が存在せず `{ kind: "unknown" }` 落ちする。② `formatCanonicalEvents` で `_viewerPlayerId` 未使用かつ `"trump"`/`"rare"` の日本語ラベル欠落・非公開公開先フィルタなし。 | **高** | `CardZoneName` に `"trump"` を追加し、`formatCanonicalEvents` を `viewerPlayerId` 依存にして私的閲覧イベントを保護。 |
| **G-07** | `LegalPatternGenerator.ts` 各所, `CoreBattlePlaytest.tsx:1849`, `ReplayViewerModal.tsx:512` | `ObservationFactory.createObservation()` 呼び出し全箇所で `{ components: rulePackage.components }` が省略されており、`characterUtils.isSoldierType` がレガシー配列（一般兵/英雄/エース/魔術士/装備兵）へフォールバックする。新兵士6種のサイズ計算が影響を受ける。 | **高** | すべての `ObservationFactory.createObservation` 呼び出しに `{ components }` を渡す（`characterUtils` 側の兵士判定もコンポーネント定義ベースへ統一）。 |
| **G-08** | `StateHasher.ts:119-176,379-388` | `StateHasher` V2 が `p.trumps`（`face`, `cards`, `componentId`）をハッシュする一方、`p.pack` と `p.rareCards` をハッシュしていない。`魔王召喚`/`巨人召喚` 等でパックやレア領域を探索・シャッフルする処理の決定性検証で盲点になる。 | **高** | Snapshot 互換方針を定めた上で（V2拡張またはハッシュ対象見直し）、`pack` / `rareCards` / `trumps` 完全ハッシュを整備。 |
| **G-09** | `ActionTargetService.ts`, `LegalPatternGenerator.ts`, `ActionRequestValidator.ts`, `ResolutionTargetValidator.ts`, `PatternExecutor.ts` | ユニット対象列挙・解決検証がすべて `player.field` のみを走査しており、`player.trumps`（`表切札`/`裏切札` 対象指定：`クローズ`, `切札破壊`）や `召喚不可/対象不可` 属性（`魔王`, `巨人`）に未対応。 | **必須基盤** | 後述 `M1` / `M4` にて `zone: "trump"` 走査と `untargetable` 除外を Core 共通フィルタへ追加。 |
| **G-10** | `DecisionPanel.tsx:60-94,386-408` | ① `formatCostPaymentDisplay` が `sacrificedUnitIds`（`$S` コスト）の表記を省略している（`魔王召喚`/`巨人召喚` は `$SS` コスト）。② 2枚組キー選択時の `getCardInfo` が `handCards` のみ参照。 | **中** | `$S` コスト表示の追加、および対象ソース領域（`rareCards` 等）参照対応。 |
| **G-11** | `commandHandlers.ts:798-874` (`discardCardsHandler`), `929-1005` (`takeUntilLegacyCardHandler`), `2578-2670` (`moveMatchingUnitsToGraveyardHandler`) | ① `discardCardsHandler` が複数枚破棄時に1枚ずつ `addCardToGrave` を呼んでいるため、2枚破棄（`内乱`/`リセット`）時に墓地TOP選択が発生しない恐れがある。② `takeUntilLegacyCardHandler` は非該当カードを1枚ずつ送っており `cardMoved` イベントも欠落（`魔王の囁き` で再利用時要注意）。 | **高** | 複数枚破棄・複数枚ライフ→墓地移動を `addCardsBatchToGrave` / `GraveTopCoordinator` 経由へ統一し、`6.1.1` 準拠の墓地TOP選択を自動発火させる。 |

---

## 4. 共通アーキテクチャ設計（必要となる8つの共通機構 `M1`〜`M8`）

切札固有ロジックを Core Flow や CommandRegistry へハードコードせず、すべての切札・アクションを **8個の共通機構（`M1`〜`M8`）** へ集約する。

| 機構ID | 名称 | 責務と構成要素 | 解放される主な対象（概要） |
|---|---|---|---|
| **M1** | **切札領域・コンポーネントライフサイクル基盤** | ① 内部状態 `player.trumps` 統一、② `unitCondition` 評価（`face === "down"` なら `trump.secretTrump`、`face === "up"` かつ一致する表切札スクリプトがあれば `trump.<id>` へ動的解決）、③ `ActionActivationConditionEvaluator.activeComponent`（自表切札条件の汎用判定）、④ `ActionTargetService` 等の `zone: "trump"` 対象列挙（`表切札1枚` / `裏切札1枚`）＋ `closeFog`（`openLock`）によるオープン禁止チェック、⑤ 基本切札 Handler（`setTrumpFace`, `moveTrumpToGrave`, `moveCardToTrump`）。 | 全31切札・全57エクストラアクションの前提基盤（特に `切札操作` 4種・`○○再生` 4種・直結型12種） |
| **M2** | **エクストラ Setup・順次初期公開基盤** | ① `FrameDefinition.components` ＋ `FrameSetupDefinition` 拡張、② 3領域排他 `PhysicalCardReservation`（切札2・シナリオ手札3・レア1）、③ `verifyCardConservation` 切札対応、④ 裏向きプリセット兵士配置（`presetSoldierInitialFace: "down"`）、⑤ 先攻→後攻の順次初期公開機構（`Q-001` 確定後）。 | `mast-extra` レギュレーション公式成立・対戦開始手順一式 |
| **M3** | **キーユニット（`actUnit`）・コスト `C`・動的ラベル付与機構** | ① `ComponentAbility.grantLabel`（`自分の場にいる<suit>の兵士／防壁は <label> を持つ`、多スート兵士対応）、② `ActionDefinition.keyUnit`（ユニット条件・複数候補列挙・`ActionRequestValidator` 検証）、③ `CostParser` への `C`（キーユニットを `charge` → `drive` 状態にするコスト）追加、④ 効果内 `keyUnit` コンテキスト参照（`keyUnit.size`、手札戻し・防壁→兵士変換）。 | `兵士起因` 全8アクション＋`ファントムリバース` ＝ 計9アクション（`♠2, ♡3, ♡7, ♢3, ♣4, ♠J, ♡J, ♢J, ♣J`） |
| **M4** | **2枚組特殊兵士・特殊キャラクター能力基盤** | ① 2枚合体ユニット生成・分割ルール（切札＋手札キーカード合体 `summonMultiCardTrumpUnit`、全領域探索合体 `searchAndSummonTrumpUnit`、2枚組→防壁化時 2体分裂／墓地・手札・ライフ移動時 2枚同時移動）、② 多スート判定（`suits: ["spade", "heart"]` 等）・固定サイズ・`装備不可（unmountable）`・`対象不可（untargetable）`（`魔王`, `巨人`）、③ `巨人` 強制アタック制約（`mandatoryAttack`）および既実装 `damageJudgeUtils` 防壁破壊耐性統合。 | 特殊兵士6体（`リアニメーター`, `魔王`, `破砕士`, `巨人`, `策士`, `騎士`）および全関連アクション20件 |
| **M5** | **誘発エンジン拡張（`TriggerResolver` / `TriggerProcessingCoordinator`）** | ① 新規トリガーイベント：`requestCreated`（`エンド` リクエスト契機 → `魔王の囁き`, `幻影`, `充足`, `手札補充`）、`cardsDiscarded`（対戦相手手札破棄契機 → `暴動`、破棄枚数バインド）、② ユニット墓地移動時の特定 `componentId` 単位トリガー（`reanimatorRevive`, `wallBreakerRevive`, `strategistRevive`, `knightRevive`）、③ `Q-003` に基づく通常速度エンド誘発の Stage 積載順序保証、④ `TriggerProcessingCoordinator` の同時誘発順序（`9.4.1` 即時先・ターンプレイヤー順）。 | 全11誘発アクション（うち未実装 9件：`darkWhisper`, `illusion`, `satisfaction`, `handRefill`, `riot`, `reanimatorRevive`, `wallBreakerRevive`, `strategistRevive`, `knightRevive`＋既テスト2件正規統合） |
| **M6** | **効果内プレイヤー別選択・サブリクエスト・柔軟効果操作基盤** | ① 選択コマンドの `chooser: "opponent" \| "targetPlayer" \| "unitOwner"` 拡張（`内乱`, `騎士召喚`, `薙払`, `リセット` の相手選択、`救済` の両オーナー各順選択）、② 任意個／最小個数付きユニット選択（`instantKill` `1..N`, `illusion` `0..N`）＋選択合計サイズ算出＋盤面防壁並替（`reorderFieldUnits`）、③ 効果内カード先頭/末尾移動・公開配分（`ドレイン`, `援軍`, `先読み`, `救済`）、④ 効果内ステージリクエスト選択・無効化（`カウンター策士召喚`）、⑤ **効果内サブリクエスト発行機構（`requestSubAction`：`追撃` による `アタック`、`修繕` によるコスト免除 `装備`）**。 | 複雑効果 15切札・約25アクション（作業6の `EffectContinuation` / `GraveTopCoordinator` を全面再利用） |
| **M7** | **プライバシー境界・Observation・UI・Log・Replay 整合基盤** | ① `G-03`〜`G-08` 解消、② `CardZoneName` `"trump"` 追加、③ Playtest UI 切札選択・初期公開・盤面 `trumps` 領域表示（Desktop / Tablet / Smartphone）、④ `ReplayPlanV1` 拡張とカード保存則 E2E 検証。 | 公式 `mast-extra` 公開・UI/AI/Log/Replay 全層統合 |
| **M8** | **継続能力（常在効果）拡張基盤** | ① `AbilityEvaluator.shouldPreventStateChange`（`♢5 喪失`：`チャージ` アクション効果によるチャージ化禁止）、② 既実装 `damageJudgeModifier`（`♠A 革命`）・`shouldPreventDamage`（`♣9 要塞`）の正規 `unitCondition` 接続、③ `GenericTacticalEvaluator` の常在効果（`革命`, `要塞`）評価反映。 | `♠A 革命`, `♢5 喪失`, `♣9 要塞` 等の常在能力群 |

### 4.1 切札コンポーネントの状態管理と領域移動（9.1・9.2 対応）

1. **物理カード構造と `trumpId` / `componentId` の関係**:
   - 切札ゾーン（`player.trumps`）内の各要素は、既存 `Unit` 構造（`unitId`, `kind`, `componentId`, `face: "up" | "down"`, `state: "charge"`, `cards: [InGameCard]`, `labels: []`）を再利用する。
   - **重要ルール（公式 4.1.3 `common-component.rst:72-79`）**: 同じ物理カードでも **`face: "down"` の間はスクリプト上 `裏切札`（`trump.secretTrump`）であり、`face: "up"` のときにのみ該当カードのスクリプト（`trump.sA` 〜 `trump.cJ` のいずれか、非スクリプト札なら該当なし）として扱う**。これにより、相手視点や能力評価で「裏切札なのに裏で `trump.fortress` のメタデータを持ってしまう」設計ミスを構造的に防止できる（解決時の動的コンポーネント照合、または表裏反転時に `resolveComponentForUnit()` を再実行して更新する）。
2. **公式ルールに実在する切札の領域・状態移動の全パターン**:

| 移動／状態変化種別 | 公式ルール上の実在有無と具体例 | 実装・カード保存則上の扱い |
|---|---|---|
| **裏切札 → 表切札（表向き化）** | **あり**：開始時 Step 9〜10（各1枚）、`クイックオープン`、 `メインオープン` | `closeFog` によるオープン禁止対象でないことを検証後、`face: "up"` へ変更＋対応 `表切札` コンポーネント再解決。`unit.transformed` / `card.revealed` を記録。 |
| **表切札 → 裏切札（裏向き化）** | **あり**：`クローズ`（対象1枚＋フォグ配置）、`休戦`（自分の `♡4`）、`追撃`（自分の `♡5`）、`リセット`（両者の全切札） | `face: "down"` へ変更＋`componentId: "trump.secretTrump"` / `kind: "裏切札"` へ戻す。カード枚数不変。 |
| **切札 → 墓地** | **あり**：`切札破壊`（一致時対象切札を墓地）、`悪あがき`（手札0時 `♣10` を墓地）、`リセット` Step 3（相手2枚破棄で `♣8` を墓地）、`魔王召喚`/`巨人召喚` 失敗時（`♠K`/`♡K` を墓地） | `player.trumps` から除去し `GraveTopCoordinator.addUnitToGrave` / `addCardToGrave` 経由で `player.grave` へ移動（物理カードID維持）。 |
| **墓地 → 表切札** | **あり**：`リアニメーター再生`（`♠J`）、`破砕士再生`（`♡J`）、`策士再生`（`♢J`）、`騎士再生`（`♣J`） | 自分の墓地から該当カードを選択し `GraveTopCoordinator.removeCardFromGrave` で除去（残2枚以上・TOP消失時はTOP選択発火）後、`face: "up"` の表切札として `player.trumps` へ生成。 |
| **表切札 ＋ 相方カード → 場（2枚組特殊兵士）** | **あり**：Jack 召喚9アクション（切札＋手札キーカード）、`魔王召喚`/`巨人召喚`（切札＋全領域探索の `♣K`/`♢K`） | 元の切札エントリと相方カードの双方を元領域から除去し、**単一ユニット（`unit.cards.length === 2`）** として `player.field` へ配置。物理カード 2枚は `unit.cards` 内に完全保存される。 |
| **全領域探索による2枚目切札の召喚利用** | **あり**：`魔王召喚`／`巨人召喚` で、もう1枚の自分の切札（裏／表を問わず `♣K`/`♢K`）を相方として場へ合体可能 | `player.trumps` 内の別切札スロットからも抽出可能とし、元スロットを削除する。 |
| **2枚組兵士 → 防壁（分裂）／手札／墓地／ライフ** | **あり**：`リバース`・`幻影`（**2体の別個の裏向き防壁に分裂**）、`帰還`・`誘惑`・`スイッチ`（2枚ともオーナー手札へ）、戦闘/除去（2枚とも墓地→`世代交代` 2回誘発対象＋墓地TOP選択対象）、`死の槍`・`救済`・`ドレイン`（2枚ともライフへ） | 既存 `CharacterTransformService`（既に `cards.length > 1` を 1枚ずつ防壁へ分割実装済み）および `GraveTopCoordinator.addUnitToGrave`（2枚分で即座にTOP選択発火）をそのまま活用可能。 |
| **切札を直接アクションのキーカード・コストにする操作** | **現行 v9.1 公式ルールに存在しない** | 実装不要（`魔王召喚` のように切札カード自体が効果によって消費・合体する仕様のみ存在）。 |
| **切札の表裏変更そのものを契機とする誘発** | **現行 v9.1 公式ルールに存在しない**（旧 `v7.30.0` `♣8 前触れ` は `act-frame.yaml` で廃止済み） | 実装不要（将来拡張の余地として `unit.transformed` イベントのみ整備）。 |

### 4.2 能力・ラベルおよび誘発処理の共通化設計（9.3・9.4 対応）

#### 動的ラベル付与と常在能力
- **`grantLabel`**: `♠2 スラッシュ`（自分の場の♠兵士→`<スラッシュ>`）、`♡3 誘惑`（♡兵士→`<誘惑>`）、`♡7 ファントム`（自分の場の防壁→`<ファントム>`）、`♢3 交渉`（♢兵士→`<交渉>`）、`♣4 スイッチ`（♣兵士→`<スイッチ>`）、`♠A 革命`（自分の兵士→`<革命ドロー>`）。
  - 特殊兵士6体は 2スートを持つ（例：`リアニメーター` は `♠` かつ `♡` 兵士）ため、`unit.cards` 構成カード群またはコンポーネント属性の配列でスート判定を行い、`♠2` と `♡3` の両方が表であれば双方のラベルが付与される必要がある。
  - **設計上の重要ポイント**: 静的 `unit.labels` 配列へ破壊的追記する方式では、切札が `クローズ` や合体召喚で表切札でなくなった瞬間に剥がし忘れバグが起きる。よって **`AbilityEvaluator.getEffectiveLabels(unit, state, components)` を算出SSOTとし、静的ラベル（`unit.labels`）＋有効な表切札/フォグからの動的付与ラベルを都度合成する**（`ObservationFactory` と `LegalPatternGenerator` もこれを使用）。
- **既存能力機構の統合**:
  - `AbilityEvaluator.shouldPreventDamage`（`♣9 要塞`：`examples/fortress.yaml` で対応済みだが `unitCondition` 欠如＋`GenericTacticalEvaluator` 未考慮）。
  - `damageJudgeUtils`（`♠A 革命` の兵士対兵士逆転、`♡K 巨人` の対防壁不破壊）。
  - 新設 `AbilityEvaluator.isStateChangePrevented`（`♢5 喪失`：`action.charge` 効果の `state: "charge"` 変更を抑止）、`isUntargetable`（`魔王`/`巨人`）、`isUnmountable`（Jack 兵士4種）、`isOpenLocked`（`closeFog`）、`hasMandatoryAttackConstraint`（`巨人`）。

#### 全11種（既実装2＋未実装9）の誘発アクション一覧

`TriggerProcessingCoordinator` の既存優先則（`9.4.1`: 即時優先 → ターンプレイヤー順 → メイン/ブロック/ダメージ判定優先 → FIFO）をそのまま再利用し、以下の全11件を統一処理する。

| # | アクション名 (`actId`) | 契機イベント | 評価条件 | 誘発元 | コントローラ | 速度・タイミング | 任意/強制 | 状態変更/領域移動時の挙動 |
|---|---|---|---|---|---|---|---|---|
| 1 | 革命ドロー (`revolutionDraw`) | `actionResolved` (`damageJudge`) | 自表切札に `革命` かつ未ブロック攻撃兵士（1体につき1回） | 表 `♠A` | 自兵士オーナー | 即時・クイック | 強制 | `damageJudge` 開始〜解決中に `♠A` が表なら誘発；バッファ投入後は切札が消えても解決（コアフロー `5-D`） |
| 2 | 反撃 (`counterattack`) | `cardMoved` (`field→grave`) | 自表切札に `要塞` かつ `damageJudge` 中に防壁がブロッカーで墓地へ | 表 `♣9` | 防壁オーナー | 即時・クイック | 強制 | 複数防壁同着時の誘発回数は `Q-011` 参照（現行実装は防壁 1体毎＝各2点） |
| 3 | リアニメーター再生 (`reanimatorRevive`) | `unitMoved` (`field→grave`) | 自分の `character.reanimator` が場から墓地へ | `♠J` 召喚済み兵士 | 兵士オーナー | 即時・クイック | 強制 | 手札戻し・ライフ送り・防壁化では不発（`Q-014`）。墓地 `♠J` を取り出して表切札化 |
| 4 | 破砕士再生 (`wallBreakerRevive`) | `unitMoved` (`field→grave`) | 自分の `character.wallBreaker` が場から墓地へ | `♡J` 召喚済み兵士 | 兵士オーナー | 即時・クイック | 強制 | 同上（墓地 `♡J` を表切札化） |
| 5 | 策士再生 (`strategistRevive`) | `unitMoved` (`field→grave`) | 自分の `character.strategist` が場から墓地へ | `♢J` 召喚済み兵士 | 兵士オーナー | 即時・クイック | 強制 | 同上（墓地 `♢J` を表切札化） |
| 6 | 騎士再生 (`knightRevive`) | `unitMoved` (`field→grave`) | 自分の `character.knight` が場から墓地へ | `♣J` 召喚済み兵士 | 兵士オーナー | 即時・クイック | 強制 | 同上（墓地 `♣J` を表切札化） |
| 7 | 暴動 (`riot`) | `cardsDiscarded` (`hand→grave`) | 自表切札に `内乱` かつ対戦相手が手札を捨てた | 表 `♣5` | `♣5` オーナー | 即時・クイック | 強制 | コスト `$D` 時も誘発（`リセット` 時 Step 3 では `♣5` が既に裏のため不発）。破棄枚数×2点（`Q-010`） |
| 8 | 魔王の囁き (`darkWhisper`) | `requestCreated` (`action.end`) | 自場に `character.darklord` かつ自分が `エンド` をリクエスト | 場の `魔王` | ターンプレイヤー | 即時・クイック | 強制 | `即時` のため `エンド` より先に即解決。既存 `takeUntilLegacyCard` 再利用可 |
| 9 | 幻影 (`illusion`) | `requestCreated` (`action.end`) | 自表切札に `ファントム` かつ自分が `エンド` をリクエスト | 表 `♡7` | ターンプレイヤー | **通常**・クイック | 強制（効果0選択可） | ⚠️ **`Q-003` 要確認**：Stage LIFO 上 `エンド` より後（上）に積まれ、`エンド` より先に解決すべき |
| 10 | 充足 (`satisfaction`) | `requestCreated` (`action.end`) | 自表切札に `充足` かつ自分が `エンド` をリクエスト | 表 `♢9` | ターンプレイヤー | **通常**・クイック | 強制 | ⚠️ **`Q-003` 要確認**：同上 |
| 11 | 手札補充 (`handRefill`) | `requestCreated` (`action.end`) | 自表切札に `手札補充` かつ自分が `エンド` をリクエスト | 表 `♣7` | ターンプレイヤー | **通常**・クイック | 強制 | ⚠️ **`Q-003` 要確認**：同上（解決後に `エンド` の手札7枚制限チェックが働く必要あり） |

### 4.3 合法手生成・複雑効果・中断再開（9.5・9.6 対応）

1. **合法手生成（`LegalPatternGenerator`）への反映**:
   - **UI/AI 側で個別切札の合法性を判定することは禁止** し、`LegalPatternGenerator.generateActionRequestDecision` を唯一の SSOT とする。
   - **拡張ポイント**:
     1. `ActionActivationConditionEvaluator` に `activeComponent`（例：`self.trumps` に `trump.slash` が `face: "up"` で存在）を追加し、`ActionRequestValidator` からも同一評価器を呼ぶ。
     2. `action.keyUnit` 定義があるアクション（9件）では `player.field` から条件合致ユニット（例：`label: "スラッシュ"`, `characterType: "soldier"`）を列挙し、`cost: "C"` を支払う候補ユニットと紐付けて `DecisionCatalog` / `LegalPattern` を構築する。
     3. `ActionTargetService.enumerateTargets` を `unit.zone: "trump"`（`face: "up"` 等）および `untargetable` 能力除外（`魔王`/`巨人`）へ対応させる。
     4. `巨人` 在場時の強制アタック制約（`Q-013` 確定後）：合法パターンから違反候補（`action.end` や `巨人` を含まない `attacker` 選択）を `LegalPatternGenerator` 上でフィルタ／制約する。
2. **中断・再開（`EffectContinuation` / `GraveTopCoordinator` 再利用）**:
   - 作業6で構築済みの `EffectContinuation`（`EffectPathCodec` による分岐経路再現）および `GraveTopCoordinator`（効果内・キーカード最終墓地移動時の双方での `ZONE_TOP_SELECTION` 中断と解決完了境界保留）を **そのまま再利用** し、切札専用の中断機構は新設しない。
   - 新たに `selectUnits` / `selectCards` へ `chooser`（相手プレイヤーや各カードオーナーに決定リクエスト `DecisionRequest.playerId` を割り振る機能）を追加する場合も、既存の `EffectInterpreter.executeEffects()` が持つ `WAITING_FOR_DECISION` 返却と `GameSession.submitDecision()` 再開ループの中で自然に実現できる（各選択ステップ毎に `continuation` へ現在ステップまでを保持するため、P1発動 → P2選択 → P1続き、あるいは 2名それぞれ順番に `救済` ライフ上順序選択を行う多段階・多プレイヤー中断再開が既存機構だけで完結する）。
   - **重要制約の確認（`TriggerProcessingCoordinator`）**: 現行の即時誘発処理（`processPendingTriggers`）は「即時誘発の効果途中の選択ポーズ」を `NonInterruptibleEffectExecutionError` で拒否し、効果完了後の墓地TOP選択（`interruptedImmediateResolution`）のみを許可している。エクストラの全9個の即時誘発は **いずれも効果途中でインタラクティブな選択を伴わない**（`○○再生` 4種は特定カード `♠J/♡J/♢J/♣J` 1枚のみで自動選択可能、ただしもし墓地に同名 1枚想定外で 2枚存在しない仕様のため決定不要；`暴動`・`魔王の囁き`・`反撃`・`革命ドロー` は自動解決＋完了後墓地TOP選択のみ）。したがって既存設計と完全に両立する。

### 4.4 Command Handler の分類と新規汎用 Handler 候補（9.7 対応）

全57エクストラ専用アクションに必要な実行コマンドを 5区分（1. 既存そのまま / 2. 既存パラメータ追加 / 3. 既存組合せ / 4. 新規汎用 Handler / 5. DSL実行機構拡張）で分類した上で、新規・拡張候補を以下に定義する。特定の切札名を Handler 名にすることは避け、複数アクションで再利用できる操作単位に抽象化する。

| 分類 | 対象 Handler | 責務・入力・出力・事前事後条件・意思決定・イベント・中断再開・再利用切札 |
|---|---|---|
| **新規汎用 Handler 1** | **`setTrumpFace`** | ・**責務**: 指定された切札ユニット（または条件一致する全切札）の表裏を変更する。<br>・**入力**: `target`（`"selected"` \| `"selfAll"` \| `"allPlayers"` \| `{ componentId, player }`）, `face: "up" \| "down"`<br>・**事前/事後条件**: `face === "up"` 時、`closeFog`（`openLock`）による禁止対象を除外／拒否し、実カードの表切札コンポーネントを再解決。`unit.state` は不変。<br>・**意思決定**: 単体自切札選択時は `selectTrump` / `selectUnit`（`zone: "trump"`）を使用。<br>・**イベント**: `unit.transformed` / `card.revealed`。<br>・**中断**: なし（選択は先行 `select*` ステップで完結）。<br>・**対象切札**: `クイックオープン`, `メインオープン`, `クローズ`（併用 `createFog`）, `休戦`, `追撃`, `リセット`（計6アクション）。 |
| **新規汎用 Handler 2** | **`moveTrumpToGrave`**（または `moveToGraveyard` への `zone: "trump"` 拡張） | ・**責務**: `player.trumps` 内の指定切札（`target` または `{ player, cardCode / componentId }`）を `GraveTopCoordinator` 経由でオーナー墓地へ移す。<br>・**事前/事後条件**: 物理カードIDを保持したまま `trumps` → `grave` へ移動。複数枚墓地化時は墓地TOP選択を発火。<br>・**イベント**: `card.moved` (`fromZone: "trump", toZone: "grave"`)。<br>・**対象切札**: `切札破壊`（条件一致時）、`悪あがき`（手札0時）、`リセット`（相手2枚破棄時）、`魔王召喚`/`巨人召喚`（相方不在時）（計5アクション）。 |
| **新規汎用 Handler 3** | **`moveCardToTrump`** | ・**責務**: 墓地（`fromZone: "grave"`）等の指定カードを選択・抽出し、`player.trumps` へ表／裏切札として配置する。<br>・**入力**: `fromZone`, `player`, `filter: { suit, rank }`, `face: "up" \| "down"`<br>・**事前/事後条件**: `GraveTopCoordinator.removeCardFromGrave` で抽出（元TOP消失・残2枚以上時は墓地TOP選択発火）し、該当 `表切札` コンポーネントを付与して `trumps` へ追加。<br>・**イベント**: `card.moved` (`toZone: "trump"`)、必要に応じ `ZONE_TOP_SELECTION`。<br>・**対象切札**: `リアニメーター再生`, `破砕士再生`, `策士再生`, `騎士再生`（計4アクション共通）。 |
| **新規汎用 Handler 4** | **`summonMultiCardTrumpUnit`** | ・**責務**: 自分の表切札（`trumpComponentId`）とリクエストの `keyCards`（相方カード）が共に有効存在することを検証し、双方を元位置から取り除いて 2枚構成の指定特殊兵士（`character.reanimator` / `wallBreaker` / `strategist` / `knight`）を `player.field` に `charge` 状態で生成する。<br>・**事前/事後条件**: 表切札でなくなっていれば解決時不発。キーカードは場ユニット内へ入るため `finalizeRequestKeyCards` での墓地重複移動は自動回避される（`isCardInGameZones` が `field` を検知）。<br>・**イベント**: `card.moved`（`trump→field`, `request→field`）。<br>・**対象切札**: Jack 召喚系 9アクション（`召喚` 4 ＋ `クイック召喚` 4 ＋ `カウンター策士召喚` 1）。 |
| **新規汎用 Handler 5** | **`searchAndSummonTrumpUnit`** | ・**責務**: ① `trumpComponentId` が `face: "up"` か確認、② 自分の全領域（`hand`, `grave`, `life`, `field` ユニット/装備, `fog`, `pack`, `rareCards`, 他 `trumps` ※`Q-008` 確定範囲）から指定パートナーカード（`♣K` または `♢K`）を検索、③ **非公開領域（`life` / `pack` 等）を見た場合（または探索仕様に応じ）対象領域をシード決定論的にシャッフル**、④ 見つかれば切札＋パートナーカードで 2枚組ユニット（`darklord` / `giant`）を召喚し、見つからなければ切札を墓地へ移す。<br>・**イベント**: `card.moved`, `zone.shuffled`（`runtimeShuffleCount` 連番で決定論的）。<br>・**対象切札**: `魔王召喚`, `巨人召喚`（計2アクション）。 |
| **新規汎用 Handler 6** | **`moveSelectedUnitsToGraveyard`** | ・**責務**: 直前の `selectUnits` で選択された 1〜複数体（`minCount`〜`maxCount`）の場のユニットを `GraveTopCoordinator.addUnitsBatchToGrave` で一括墓地送りし、選択ユニットのサイズ合計を `context.results[totalSizeResultId]` へ格納する。<br>・**事前/事後条件**: All-or-Nothing 検証＋一括墓地移動により 2体以上／2枚組送りで 1回の墓地TOP選択を正しく発火。<br>・**対象切札**: `瞬殺`（1体以上任意＋合計サイズ判定）、`破砕士召喚`（任意/選択1防壁破壊：`Q-007`）、`騎士召喚`・`薙払`（相手が選択した兵士/キャラ1体破壊）。 |
| **新規汎用 Handler 7** | **`transformSelectedUnits` ＋ `reorderFieldUnits`** | ・**責務**: ① `transformSelectedUnits`: 選択された 0〜N 体の兵士をそれぞれ `CharacterTransformService` 経由で `charge` 状態の防壁へ変換（2枚組なら2防壁へ分裂、付与された効果・動的状態リセット）、② `reorderFieldUnits`: 自分の場にある防壁配列をプレイヤー指定順序（`selectUnitOrder`）に並び替える。<br>・**対象切札**: `幻影`（並び替えは今後の類似効果にも再利用可能）。 |
| **新規汎用 Handler 8** | **`revealAndSplitTopLifeCards`** | ・**責務**: ライフの上から N枚（2枚）をめくってオーナー（または公開ルール `Q-012` 準拠）へ提示し、インタラクティブ選択（`cardIds` 1枚）により選ばれた 1枚を `charge` 状態の一般兵として場に出し、残りをライフ一番下へ送る（残り1枚時は自動または即解決）。<br>・**中断**: `EffectInterpreter` 上で既存 `selectCard` パターンまたは専用中断で実現可能。<br>・**対象切札**: `援軍`（将来のライフ捲り系アクション全般で再利用可能）。 |
| **新規汎用 Handler 9** | **`moveAllMatchingUnitsToOwnerLifeTop`** | ・**責務**: 条件（サイズ >= `key.rankValue` 等の兵士）に合致するすべての場の兵士を抽出し、**各ユニットのオーナー別** に「自分のライフ一番上へ戻す順番」を決定させ（2枚以上のカードがある場合のみ `DecisionRequest(playerId = owner)` を順次中断発行、1枚のみなら自動決定）、ライフ先頭（index 0）へ積む。<br>・**中断**: `EffectContinuation` を利用し P1 → P2 の順に最大 2回の順序選択を安全に中断再開。<br>・**対象切札**: `救済`。 |
| **新規汎用 Handler 10** | **`requestSubAction`** | ・**責務**: 現在解決中の効果ステップから、別アクション（例：`action.attack`、`action.mountSoldier`）のリクエストを生成する（`skipCost: true`、指定 `keyCards` / `targetComponent` バインド、1ターン回数制限のバイパス要否オプション `ignoreUsageLimit`）。生成先が通常アクションなら Stage へ積まれ、効果完了後の `[5]` / 解決サイクルで処理される。<br>・**対象切札**: `追撃`（`action.attack` 生成）、`修繕`（コスト無し `action.mountSoldier` 生成）。（※`Q-004`, `Q-006` 確定後に仕様固定） |
| **既存 Handler パラメータ拡張** | `discardCards` / `moveCard` / `moveUnitCardsToZoneTop` / `shuffleZone` / `summonUnit` / `selectUnits` 等 | ① `discardCards`: 複数枚破棄を `addCardsBatchToGrave` 一括処理へ変更＋`cardsDiscarded` イベント発行（`暴動` トリガー・墓地TOP整合）。<br>② `moveCard`: `position: "top" \| "bottom"` と `zone: "trump" \| "life"` 等拡張、`to: "grave"` も `GraveTopCoordinator` 経由へ統一。<br>③ `moveUnitCardsToZoneTop` → `position: "top" \| "bottom"` 追加（`ドレイン` で `自分のキャラをライフ一番下`＋`keyUnit` 受け入れ）。<br>④ `shuffleZone`: `"life"` 以外の非公開領域 `"pack"` に対応（`魔王召喚`/`巨人召喚`）。<br>⑤ `deploySelectedCardsAsUnits`: `fromZone: "hand"` 対応（`スイッチ` 用）および既存 `summonUnit` の `selection` 連携。<br>⑥ `moveToGraveyard` / `moveUnitToHand` / `transformCharacter`: 対象として `context.keyUnit`（例：`スイッチ`, `ファントムリバース`）を解決可能にする。 |

---

## 5. YAML DSL 拡張候補と最小限の設計原則（第10節対応）

DSL を汎用プログラミング言語化せず、BlackPoker 公式定義の記述構造（対象・条件・能力・効果手順・トリガー）に 1対1 で対応する最小限の宣言的拡張のみを導入する。

### 5.1 新規・拡張 DSL 要素一覧と各機構への影響

| # | DSL 拡張領域 | 現状の不足仕様 | 新規要素の責務 | 型/Schema・Loader・Core・AI・Snapshot への影響 |
|---|---|---|---|---|
| **D1** | **`ComponentDefinition.unitCondition`（表裏＋スート・数字照合）** | `fortress.yaml` / `revolution.yaml` が `card: { suit, rank }` の独自形式で、`secretTrump`（全て裏向き）と表切札 30種の自動切替を表現できない。 | ゾーン・表裏・カード条件によるユニットのコンポーネント動的判定。 | `RulePackage.ts` 型拡張（既存 `character.*` 用 `unitCondition` を一般化）、`resolveComponentForUnit` で `zone: "trump"` を照合、`ObservationFactory` で `secretTrump` 自動隔離。既存 `official-base.yaml` と完全後方互換。 |
| **D2** | **`ActionActivationCondition.activeComponent` ＋ `usageLimit` 再利用** | 「自分の表切札に『○○』がある」をアクション起動条件で表現できない（現在は `triggerCondition` 内にしかない）。また一部アクションに 1ターン制限がある。 | 場・切札ゾーン等の有効コンポーネント存在判定をアクション起動可否 SSOT へ統合。 | `ActionActivationConditionEvaluator.ts` に `TriggerResolver.evaluateActiveComponent` 相当の共通判定関数を追加（Trigger と Activation で評価ロジック共通化）。AI・Replay 影響なし。 |
| **D3** | **`ActionDefinition.keyUnit` ＋ コスト `"C"`** | `actUnit`（`<スラッシュ>を持つ兵士1体`、`「策士」1体`、`<ファントム>を持つ防壁1体`）とコスト `C`（キーユニットをドライブにする）が存在しない。 | キーユニット条件の宣言、候補列挙、支払コスト `"C"` による状態遷移、効果式への `keyUnit` バインド。 | `RulePackage.ts`, `CostParser.ts`（`C` トークン＝キーユニットのドライブコスト）, `ActionRequestValidator.ts`, `LegalPatternGenerator.ts`, `PatternExecutor.ts`（`CommandContext.keyUnitId` 保持）, `EffectInterpreter.ts`。Snapshot の `resolvingContext` / `StageRequest` に `keyUnitId` 保持が必要。 |
| **D4** | **`ComponentAbility` 拡張（`grantLabel` / `preventStateChange` / `openLock` / キャラ能力フラグ）** | `スラッシュ` 等 5種の動的ラベル付与、`♢5 喪失` のチャージ無効、`closeFog` のオープン禁止、`魔王`/`巨人` の `untargetable`・`mandatoryAttack`、`unmountable`・`multiSuit` を表せない。 | 切札・フォグ・特殊兵士が持つ常在能力／耐性／行動制約の宣言的表現。 | `AbilityEvaluator.ts` が一括評価し、`ActionTargetService`・`commandHandlers`（`mountUnit`, `setUnitState`, `setTrumpFace`）・`LegalPatternGenerator`（`巨人` 制約）・`ObservationFactory`（動的ラベル描画）が参照する。`GenericTacticalEvaluator` は未知能力でも破綻せず順次拡張可能。 |
| **D5** | **`TriggerCondition` 新イベントとパラメータ化** | `actionResolved` / `cardMoved` のみで、`エンド` リクエスト契機（`requestCreated`）・手札破棄契機（`cardsDiscarded`）・2枚組ユニット特定墓地移動契機が不足。 | リクエスト生成時・手札破棄時・ユニット単位墓地移動時の宣言的トリガー発火。 | `CommandRegistry.ts`（`createRequest` の `requestCreated` 発火、`discardCardsHandler` の `cardsDiscarded` 発火）、`TriggerResolver.ts`（イベント種別と `forEach` / バインド値 `discardedCount` の評価）を拡張。 |
| **D6** | **効果内選択の `chooser`・柔軟個数（`minCount`/`maxCount`）・領域上下引数** | 相手プレイヤーが選ぶ効果（`内乱`, `騎士召喚`, `薙払`, `リセット`）、任意個（`瞬殺`, `幻影`）、対象ユニットをライフ下へ送る等。 | 効果内の意思決定主体指定、可変個数ユニット選択、ゾーン上下配置指示。 | `EffectInterpreter.ts` と `LegalPatternGenerator.ts` を拡張し、`DecisionRequest.playerId` を `chooser` に応じて決定。中断中の `EffectContinuation` に `chooser` や中間 `results`（既に作業6で保持対象）が保存され、Snapshot・Replay と完全互換。 |

### 5.2 新規・拡張 DSL 要素の YAML 設計例（`D1`〜`D6`）

※以下は設計案であり、作業7A では既存ルールファイルを変更しない。

```yaml
# D1: ComponentDefinition.unitCondition（表裏＋カード条件）
- id: trump.s2
  name: スラッシュ
  type: trump
  zone: trump
  unitCondition:
    face: up
    card: { suit: spade, rank: "2" }

# D2: ActionActivationCondition.activeComponent
activationCondition:
  activeComponent:
    relation: self
    zone: trump
    component: trump.s2
    face: up

# D3: ActionDefinition.keyUnit ＋ コスト "C"
keyUnit:
  zone: field
  relation: self
  componentType: soldier
  requiredLabel: スラッシュ
  requiredState: charge
cost: C

# D4: ComponentAbility 拡張（ラベル付与・喪失）
abilities:
  - grantLabel:
      target: { relation: self, zone: field, characterType: soldier, suits: [spade] }
      label: スラッシュ
  - preventStateChange:
      byActionId: action.charge
      targetState: charge
      player: all

# D5: TriggerCondition 新イベント（暴動 / エンド時誘発）
triggerCondition:
  event: cardsDiscarded
  condition:
    discardedBy: opponent
    fromZone: hand
    activeComponent: { relation: self, zone: trump, component: trump.c5, face: up }
# ---
triggerCondition:
  event: requestCreated
  condition:
    actionId: action.end
    requestController: self

# D6: 効果内可変選択とchooser拡張（瞬殺）
- selectUnits:
    id: sacrificedSoldiers
    chooser: self
    relation: self
    componentType: soldier
    minCount: 1
- moveSelectedUnitsToGraveyard:
    selection: sacrificedSoldiers
    totalSizeResultId: sacrificedSize
```

---

## 6. RulePackage と公式レギュレーション構成（第11節対応）

### 6.1 識別子と定義構成

現行の `src/data/regulations/` には `extra` フレームおよび `mast-extra` レギュレーションがまだ存在しない。既存の命名規則（`formats`: `light`, `standard`, `pro`, `mast` ／ `frames`: `entry16`, `pack`, `rarePack`, `strategy` ／ `regulations`: `<format>-<frame>`）に従い、以下を正式候補とする。

- **エクストラフレーム ID（候補）**: `extra`（ファイル案：`src/data/regulations/frames/extra.yaml`、`name: エクストラ`、`inherits: strategy`、`recommendedFormatIds: [mast]`）
- **マスター＋エクストラ レギュレーション ID（候補）**: `mast-extra`（ファイル案：`src/data/regulations/regulations/mast-extra.yaml`、`formatId: mast`、`frameId: extra`）

> [!CAUTION]
> **`mast-strategy` の単純複製を禁止する理由**
> `RegulationRulePackageSelector.ts`（L43-60）は現行 `format.actions ∪ frame.actions` のみを結合し、`frame.components` を一切読み込んでいない（`components` は `format.components` のみ参照）。エクストラは切札 31・特殊兵士 6・フォグ 1 の計 **38コンポーネントをフレーム側で追加する** ため、`FrameDefinition.components` 配列の導入および `RegulationRulePackageSelector.selectRulePackage()` による `format.components ∪ frame.components` 結合が必須となる。

### 6.2 `mast-extra` RulePackage 確定総数（公式正本基準）

| 区分 | 内訳 | 件数 | 現行実装済み | 部分実装 | 未実装（新規） |
|---|---|---|---|---|---|
| **基本アクション（`mast` フォーマット）** | `act.yaml` 定義（基本・召喚・基礎魔法・中級魔法・上級魔法） | **37** | **37** | 0 | 0 |
| **共有フレームアクション（継承）** | `packOpen`, `rareDraw`, `rareSummon`, `trapCounter` | **4** | **4** | 0 | 0 |
| **エクストラ専用：汎用切札操作** | `quickOpen`, `open`, `close`, `trumpDestroy` | **4** | 0 | 0 | **4** |
| **エクストラ専用：切札固有アクション** | 30 表切札に紐づく固有アクション群（直接 42＋誘発 11） | **53** | 0 | **2** (`revolutionDraw`, `counterattack`) | **51** |
| **アクション総計（`mast-extra`）** | `37 + 4 + 4 + 53` | **98** | **41** | **2** | **55** |
| **基本コンポーネント（`mast` フォーマット）** | キャラ 6（一般兵/英雄/エース/魔術士/装備兵/防壁）＋ フォグ 3 | **9** | **9** | 0 | 0 |
| **エクストラ：切札コンポーネント** | 表切札 30 ＋ 裏切札 1（`secretTrump`） | **31** | 0 | **2** (`trump.revolution`, `trump.fortress`) | **29** |
| **エクストラ：特殊兵士・フォグ** | 特殊兵士 6（`reanimator`, `darklord`, `wallBreaker`, `giant`, `strategist`, `knight`）＋ フォグ 1（`closeFog`） | **7** | 0 | **1** (`character.giant` ※防壁耐性のみ) | **6** |
| **コンポーネント総計（`mast-extra`）** | `9 + 31 + 7` | **47** | **9** | **3** | **35** |

※表切札側の常在能力数（`trumpAbility` ≠ `なし`）：**8切札 / 計9条項**。動的付与ラベル種別：**6種**。全切札・全アクションの個別棚卸しは [`work7a_extra_frame_inventory.md`](./work7a_extra_frame_inventory.md) を参照。

---

## 7. Playtest UI・公開情報・AI・ログ・Snapshot・Replay・Undo への影響調査

### 7.1 Playtest UI 設計要件（Desktop / Tablet / Smartphone・白黒基調維持）

現行のモノトーン基調（`bg-[#f7f7f8]`, `bg-white`, `border-zinc-200`, `bg-zinc-950`, ハート/ダイヤのみ `.bp-card-suit-red` `#a22041`）・レスポンシブ構造（`lg: >= 1024px` 2ペイン vs `< 1024px` `MobileDecisionDock` ＋ `MobileBottomSheet`）を維持しつつ、以下の画面要素を追加・拡張する（本作業では要件整理のみ行い実装しない）。

| 画面・コンポーネント | Desktop (`>= 1024px`) / Tablet (`768-1023px`) / Smartphone (`< 768px`) 要件 |
|---|---|
| **シナリオ構築画面 (`MatchSetupScreen.tsx` ＋新設 `TrumpSetupPanel.tsx`)** | ・**選択順序と排他ロック**: 切札 2枚 → シナリオ手札 3枚 → レアカード 1枚（公式手順 `frame.yaml:87-89` 準拠）。既に選択済みの物理カード（Occurrence）は後続パネルで自動除外（既存 `excludedSelections` 仕組みを 3段階チェーン化）。<br>・**Human vs Human Pass & Play**: 既存 `p1_selecting → handoff → p2_selecting` 状態機械を適用し、切替画面で P1 の切札選択 DOM を完全破棄。<br>・**表切札プレビュー**: カードグリッド上で 30種の表切札を持つカードには切札名バッジ／ツールチップを表示し、非スクリプト札 22種＋Joker を選ぶ場合は「効果なし（ブラフ可：`Q-002` 準拠）」と明示（**表切札なしカード選択可否の最終判断は `Q-002` 次第**）。 |
| **先攻→後攻 初期公開操作** | ・先攻決定（めくり結果・同値時墓地TOP選択）後、先攻が「表にする切札 1枚」を選択（`DecisionPanel` / `MobileDecisionDock` にカード 2択を表示）。先攻公開完了後、盤面相手の切札スロットへ表切札が描画された状態で後攻側へ「表にする切札 1枚」選択を提示。 |
| **対戦盤面の切札表示 (`PlayerBoard.tsx` / `PlayerZoneStrip.tsx`)** | ・既存コメント（`PlayerBoard.tsx:71`）の設計思想に沿い、対戦相手側・自分側の各ボードに **切札領域（TRUMP 最大2枠＋再生/増減対応のリスト）** を追加。<br>・**表切札**: スート・数字・切札名称（例：`♠A 革命`）・能力バッジを表示、タップ/クリックで `UnitDetailModal` 相当の全文表示。<br>・**裏切札（自分）**: 半透明またはモノクロ破線枠で「伏せ状態バッジ＋カード番号」を表示（オーナー本人確認可）。<br>・**裏切札（相手）**: 完全に裏面アイコン（`[裏切札]`）＋付与中の `closeFog` バッジのみ表示（**スート/数字/切札名/`componentId` は一切 DOM に出力しない**）。<br>・**Smartphone / Tablet 配慮**: `lg:` 未満では横幅圧迫を避けるため、`PlayerZoneStrip` 内のコンパクトバッジ＋横並び 2スロット（タップで詳細モーダル展開）として既存防壁列・兵士列との 3段過密を回避する。 |
| **`DecisionPanel.tsx` の合法アクション・対象・効果選択** | ・`ACTION_REQUEST`: キーカードに加えて **キーユニット選択ステップ**（場ユニットハイライト・盤面タップ連動）を追加。コスト表示 `formatCostPaymentDisplay` に `$S`（生贄兵士数）と `$C`（キーユニットドライブ）を必ず表示。<br>・**対象選択**: 盤面の自分/相手切札スロット（`zone: "trump"`）および `StagePanel` のリクエストカードをホバー/クリックで選択可能にする（`PlaytestTargetPresenter.ts` 拡張）。<br>・**効果解決中の意思決定**: 相手プレイヤー選択時（`内乱`, `騎士召喚`, `リセット` 等）に `PassAndPlayOverlay` が正しく相手シートへ操作権を渡すことを保証。`MobileBottomSheet` は効果解決時自動半開（`half` `55vh`）の既存挙動を維持。 |
| **ログ表示 (`GameLog`)** | ・`ViewerAwareGameEventFormatter` により「誰の切札が表向きになったか」「裏向きのまま破棄／破壊されたか」「自分が選んだ切札」の公開境界を厳守したログ文言を出力する。 |

### 7.2 公開レベル境界と診断データの分離（12.2 対応）

| 情報経路 | 対戦相手に露出させてはならない情報（エクストラ追加分） | 対策設計 |
|---|---|---|
| `PlayerObservation` / `UnitView` | 相手 `trumps` のうち `face === "down"` の実カード ID・スート・数字・実 `componentId`（例 `trump.fortress`）・`kind`・`labels`・`currentSize`、相手 `grave` 非TOP、相手 `hand`、相手 `rareCards`、両者未開封 `pack`・`life` | `G-03` 修正（裏切札状態では `componentId = "trump.secretTrump"`・カード `HIDDEN` 化）を `ObservationFactory` 一本で強制。 |
| `StagePanel` / `RequestView` | 非公開リクエスト（`visibilityOnRequest: "hidden"`）の相手キーカード（`ｸｲｯｸ兵士召喚`, `相殺`, `虚脱`, `救済`, `内乱` 等）、`ｶｳﾝﾀｰ策士召喚` 等 | `G-05` 修正（`observation.stageRequests` のみ参照）。 |
| `LegalPattern` / `DecisionRequest` / エラー | 非オーナーへ他プレイヤー用 `DecisionRequest` を渡さない。`PatternInstantiationError` 等に裏切札中身やデッキ順を含めない。 | 既存 `CoreBattlePlaytest` の `request.playerId === humanSeat` 制約維持。相手効果選択（`リセット` で相手の手札2枚破棄確認等）も相手専用 `DecisionRequest` のみへ提示。 |
| `SemanticFingerprintCalculator` | `p.trumps` 内の `opaqueCardId` 生 ID | `G-04` 修正。 |
| 通常ログ vs 開発者診断データ (`PlaytestDiagnosticBundleV1`) | 通常 `GameLog` には `viewerPlayerId` 以外の裏切札中身や `pack` / `life` の中身を出力しない。一方、診断JSON（`containsHiddenInformation: true`）のみ完全再現用情報を含む（現行 UI 表記「非公開情報を含む」を維持）。 | `G-06` 修正（`formatCanonicalEvents` で `viewerPlayerId` と `revealedTo` チェックを必須化）。 |

### 7.3 AI 層への影響調査（5段階評価契約整理）

今回 AI の強化・学習は行わないが、将来の AI 対応を見据えた 5段階の現状と必要対応を整理する。

| AI 対応段階 | 現行機構での可否 | 具体的な技術状況と今後の課題 |
|---|---|---|
| **1. 合法手生成** | **条件付き可（`M1`〜`M6` 完了後自動対応）** | `LegalPatternGenerator` + `ObservationFactory` のみで完結するため、Core に新機構が入れば UI/AI 共通で合法手を生成可能。 |
| **2. 合法手の選択・実行** | **可能（汎用ポリシー）** | `playtestConservative`（手札・生贄・ライフ負担スコア）、`firstLegal`、`seededRandom`、`manualGenericGenome`/`zeroGenome` はハードコードされたアクション ID を持たないため実行可能。ただし現在 `PlaytestPolicyFactory` により公式 `gen8` / `gen9-*` は `supportedRegulationIds: ["standard-pack"]` に厳格ロックされており、**現行 Gen 9 AI をそのまま `mast-extra` 対応済みとしては扱わない**。 |
| **3. 効果や結果の評価 (`GenericTacticalEvaluator`)** | **部分対応（安全フォールバック `UNKNOWN`）** | ・**既に動作する点**: `RulePackage` を動的読込するため、`dealDamage`, `moveToGraveyard`, `cancelRequest`, `guardCondition`, `if` を含む新アクション（例：`相殺`, `虚脱`, `反撃`, `休戦` の無効化部分 等）は自動評価可能。<br>・**ギャップ**: 新設コマンド（`summonMultiCardTrumpUnit`, `searchAndSummonTrumpUnit`, `setTrumpFace` 等）や未対応 DSL 式（`keyUnit.size` 等）は `certainty: "UNKNOWN"` となる（誤評価は避けるが expected delta = `0` 扱い）。また **`AbilityEvaluator.shouldPreventDamage`（`要塞`）や `革命`（サイズ逆転）の常在効果が `GenericTacticalEvaluator` / `Gen9LearnableTacticalPolicy`（`L850-890, 1276-1294` で「大きい方勝ち」をハードコード）に未反映** であるため、戦術評価へ取り込むには契約拡張が要る。 |
| **4. 戦術的に適切な選択** | **未対応（設計対象外／将来課題）** | 切札2枚の初期公開選択（第2手プレイヤーが先攻切札を見て選ぶ等）や `$C` コスト評価・`革命` 下での大型殺し価値反転は、特化ルールを大量ハードコードせず、汎用 `ComponentAbility` / `EffectResult` 評価契約（`CERTAIN` / `ESTIMATED` / `UNKNOWN`）拡張で扱う設計とする。 |
| **5. 学習・特徴量 (`DecisionFeatureEncoder`)** | **将来拡張対象（現 Schema v6 は枠保持）** | `DecisionFeatureEncoder.ts`（`Schema v6`, 306次元）は既に `self_trump_count`, `self_trump_charge_count`, `self_trump_drive_count`, `self_trump_size_sum`, `opponent_trump_*`, `relative_trump_count` の9特徴量および `StableIdentityEncoder` 16バケットハッシュを保持。ただし **`face_up` / `face_down` 枚数特徴量** や **`trumps` の `sourceTargetSelection` 参照** は未実装のため、学習フェーズ（作業7D以降の将来AI工程）では Schema v7 化等が必要になる。事前カード選択（切札2・シナリオ3・レア1）は初期設定ポリシー側で扱う。 |

### 7.4 Canonical Match Log・Snapshot・Replay・Undo（第14節対応）

- **原則遵守**: 既存 24種のイベント体系を再利用し、切札固有の専用ログイベントを乱立させない。既存の正式 Holdout・学習済み DNA・歴史的 Evidence JSON は一切変更・上書きしない。
- **必要な最小拡張**:
  1. **Canonical Match Log (`CanonicalMatchLog.ts`, `MatchLogRecorder.ts`)**: `CardZoneName`（L37）および `normalizeCardLocation()`（L54）に **`"trump"`** を追加。切札の表裏切替（`クイックオープン`/`クローズ`/`リセット` 等）は既存 **`unit.transformed`**（拡張メタ：`fromFace`/`toFace`, `componentId`）＋ 公開時は **`card.revealed`** を併記して表現する。
  2. **事前選択の保存・Replay・Undo 6層伝播**:
     - Setup 時（`GameSession` 生成前）の切札事前選択 `trumpSelections` は、既存 `rareCardSelections` / `scenarioHandSelections` と同一パイプライン（`OfficialRegulationSetupOptions` → `MatchStartRequest` / `ActiveMatchContext` → `PlaytestDiagnosticBundleV1` → `DiagnosticReplayAdapter` → `ReplayPlanV1` → `ReconstructMatchParams` → `buildUndoReconstructParams` / `buildReplayViewerReconstructParams`）および `PlaytestShareUrl` へ並列搭載する。
     - 先攻→後攻の順次初期公開（`案1`採用時）は `GameSession` 内の `DecisionRequest` として実行されるため、自動的に **`DecisionTranscript`（`ReplayDecisionEntryV1[]`）** へ記録され、Replay / Undo 分岐時に完全に決定論的復元される。
  3. **Snapshot V2 (`GameSessionSnapshotCodec.ts`) & `StateHasher` (`StateHasher.ts`)**:
     - `player.trumps`（`face`, `componentId`, `cards`）は既に `JSON.parse(JSON.stringify(state))` および `StateHasher`（`L166-175, 386`）の対象に含まれている。
     - 追加対応事項：`keyUnitId` を `resolvingContext` / `StageRequest` に持つ場合のシリアライズ確認、非公開領域シャッフル（`魔王召喚`/`巨人召喚` の `pack` シャッフル）における `state.runtimeShuffleCount` 連番決定論維持、`G-08`（`pack` / `rareCards` のハッシュ化）、`GameSession.rehydratePendingDecisionStream()` の一貫性確認。

---

## 8. 恒久的な設計原則（第18節）との適合性自己検証

本設計は指示書 第18節の 17項目の設計原則をすべて満たしている（原則自体に変更を要する欠陥は検出されなかった）。

| 設計原則 | 本設計における遵守状況 |
|---|---|
| ゲーム内フェーズを導入しない | 対戦中は `CoreFlow`（チャンス＋フォーカス＋LIFOステージ）のみ。開始時順次公開も未了 Setup キューの消化に限定。 |
| Stage を Zone として扱わない／LIFO維持 | `trumps` は Player 領域、`Stage` はリクエスト LIFO スタックのまま不変。`Q-003`（通常エンド誘発順序）も LIFO の中で整合させる方針を提起。 |
| チャンスとフォーカスを区別する／即時非積載 | `即時` 切札アクションは Stage 非積載のまま解決。通常切札アクションは現行通り Stage 積載＋フォーカス遷移。 |
| キーカードとキーユニットを区別する | `M3` で `ActionDefinition.keyCard` とは独立した `ActionDefinition.keyUnit` ＋コスト `$C` を新設し厳格分離。 |
| 物理カードIDに基づくカード保存則を維持する | 合体2枚組・防壁分裂・墓地→表切札復帰・全領域探索すべて同一 `InGameCard.id` を移動し複製・消失させない。`verifyCardConservation` へ `trumps` を追加。 |
| 効果墓地移動と共通キーカード墓地移動の分離＋墓地TOP選択・`EffectContinuation` 再利用 | `GraveTopCoordinator`・作業6の `finalizeRequestKeyCards()`・`EffectContinuation` をそのまま全面再利用し、独自中断機構を禁止。 |
| 人間・AI・ヘッドレス共通Core＋UI/AI独自ルール禁止 | `LegalPatternGenerator`・`ActionRequestValidator`・`AbilityEvaluator` に全ロジックを集約。 |
| 非公開情報保護・Log/Replay整合・特定切札のCore依存回避 | `G-03`〜`G-06` を先行修正。Core は `unitCondition`, `activeComponent`, `grantLabel` 等のデータ駆動のみ実行し特定切札 ID を分岐記述しない。 |
| 公式ルールの不明点を推測で確定しない | `Q-001`〜`Q-014` として分離・記録し、判断後に該当グループを実装する順序を設定。 |
