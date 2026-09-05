# BlackPoker Simulator AI Self-Play Phase 3.3 公式ベースライン測定レポート

作業ID: `BP-SIM-AI-3.3-20260906-0041`  
測定日時: 2026-09-06 JST  
対象リポジトリ: `BlackPoker/BlackPoker`  
対象ブランチ: `BlackPoker/issue551-core-flow`  
基準HEAD: `9c24f5eb4e2e73ebd8244086e34477ab65680d32`  
保存アーティファクト: `tools/simulator/reports/ai/official-light-entry16-baseline-v1.json`  
Logical Digest: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`  

---

## 1. 目的

Official Regulation Phase 1.0 / 1.0.1 により、「ライト + エントリー16」の公式対戦環境が E2E 完走可能な状態で確立されました。
本フェーズ（AI Self-Play Phase 3.3）の目的は、「強いAIを作ること」や「Fitness関数を設計すること」ではなく、**現在の Feature Schema v1（Context 25 / Pattern 57）や DNA・GenomePolicy・標準ベースラインポリシーが、公式対戦環境において何が測れているのかを定量化すること**です。

---

## 2. Official Environment (公式対戦環境)

- **Regulation**: `light-entry16`
- **Format**: `light` (19 Actions, Light Components)
- **Frame**: `entry16` (固定16枚デッキ: 各スート A〜4, 初期手札7, プリセット防壁1・兵士1)
- **Rules Version**: `rules-vnext-9.1.2` (公式ルール第9.1.2版ベース)
- **排除対象**: `CORE-BATTLE-001`（Core 検証用固定盤面）はベースライン測定に一切使用していません。

---

## 3. Measurement Configuration (測定設定)

- **Base Seed**: `20260906`
- **Setup Audit Count**: 100 unique seeds (`matchIndex: 0..99`)
- **Matches Per Seat**: 50 matches (Leg 1: 50, Leg 2: 50 の Seat Swap 方式、1 Matchup あたり 100 試合)
- **Matchups**: 4 Participant の全 6 Pair（計 600 試合）
- **Max Decisions Per Match**: 500 (Primary 設定)
- **Baseline Participants**:
  1. `FirstLegal` (`baseline-first-legal-v1`): PASS 以外の最初の合法手を優先、なければ PASS
  2. `SeededRandom` (`baseline-seeded-random-v1`): シード付き PRNG (Mulberry32) によるランダム選択
  3. `ZeroGenome` (`baseline-zero-genome-v1`): 全重み 0 の Decision DNA v1 (最小 patternRef タイブレーク)
  4. `ManualGenericGenome` (`baseline-manual-generic-v1`): pattern_is_action (+5), pattern_is_pass (-3), pattern_is_effect_selection (+5)

---

## 4. Setup Viability Audit (100 Seeds 監査結果)

`BatchSimulationRunner.planMatch(20260906, matchIndex)` により導出した 100シードについて、公式セットアップ（シャッフル $\rightarrow$ Life化 $\rightarrow$ 初期手札7 $\rightarrow$ プリセット防壁 $\rightarrow$ プリセット兵士探索 $\rightarrow$ 3.9.2 先攻決定 $\rightarrow$ 3.9.3 先攻ドロー）の成立状況を監査しました。

| 項目 | 測定値 | 割合 | 備考 |
| :--- | :---: | :---: | :--- |
| **Planned Setups** | 100 | 100.0% | `baseSeed: 20260906`, index 0〜99 |
| **READY Setups** | 100 | 100.0% | 全シードで正常にゲーム開始可能 |
| **TERMINAL Setups** | 0 | 0.0% | 3.9.1 プリセット探索中の Life 枯渇なし |
| **RULE_UNSPECIFIED Setups** | 0 | 0.0% | 3.9.2/3.9.3 での Life 枯渇なし |

100シードの全数において公式セットアップが READY として成立し、当該シード範囲ではルール未定義状態（RULE_UNSPECIFIED）や敗北（TERMINAL）による中断は観測されませんでした。

---

## 5. 6 Policy Matchup Results (全6対戦カード結果)

各 Matchup は同一のシードコホート（index 0〜49）を用い、先攻・後攻を完全に対称化した 100 試合（Leg 1: 50, Leg 2: 50）で実施されました。

| Matchup (A vs B) | Scheduled | Completed | Incomplete | Setup Gap | Tech Fail | A Wins | B Wins | Draws | A Win Rate (on Completed) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **FirstLegal vs SeededRandom** | 100 | 87 | 13 | 0 | 0 | 57 | 30 | 0 | **65.5%** |
| **FirstLegal vs ZeroGenome** | 100 | 76 | 24 | 0 | 0 | 38 | 38 | 0 | **50.0%** |
| **FirstLegal vs ManualGeneric** | 100 | 76 | 24 | 0 | 0 | 38 | 38 | 0 | **50.0%** |
| **SeededRandom vs ZeroGenome** | 100 | 87 | 13 | 0 | 0 | 30 | 57 | 0 | **34.5%** (Zero 65.5%) |
| **SeededRandom vs ManualGeneric**| 100 | 87 | 13 | 0 | 0 | 30 | 57 | 0 | **34.5%** (Manual 65.5%)|
| **ZeroGenome vs ManualGeneric** | 100 | 76 | 24 | 0 | 0 | 38 | 38 | 0 | **50.0%** |

---

## 6. Seat Split (先攻・後攻の観測結果)

| Matchup | P1 (先攻) Wins | P2 (後攻) Wins | P1 Win Rate | P2 Win Rate | 観測される特徴 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **vs SeededRandom (3カード)** | 各 53勝 | 各 34勝 | **60.9%** | 39.1% | SeededRandom 相手では先攻が約6割の勝率を記録 |
| **Deterministic 同士 (3カード)** | 各 38勝 | 各 38勝 | **50.0%** | **50.0%** | Seat Swap により先攻・後攻で完全同数の勝ち数を記録 |

※ 本結果は現在の Participant 群および当該コホートでの観測値であり、ゲーム自体の先攻有利を断定するものではありません。

---

## 7. Generic Behavior (汎用意思決定行動)

特定アクション名に依存しない、Pattern Kind（ACTION, PASS, EFFECT_SELECTION）および Decision Source（ACTION_REQUEST, EFFECT_RESOLUTION）の選択傾向です。

| Participant | Total Decisions | Action 選択率 | Pass 選択率 | Effect 選択率 | 行動傾向の特徴 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **FirstLegal** | 23,683 | 10.9% (2,570) | 87.1% (20,630) | 2.0% (483) | PASS以外の先頭手を選択するが、盤面の大半はPASS |
| **ZeroGenome** | 23,683 | 10.9% (2,570) | 87.1% (20,630) | 2.0% (483) | 全重み0のため最小patternRefタイブレークとなりFirstLegalと完全一致 |
| **ManualGeneric** | 23,683 | 10.9% (2,570) | 87.1% (20,630) | 2.0% (483) | action/pass/effectの粗い重み付けではFirstLegalから分化せず |
| **SeededRandom** | 16,839 | 12.5% (2,103) | 86.0% (14,475) | 1.5% (261) | ランダム選択により試合展開が早まり総意思決定数が減少 |

---

## 8. Feature Collision (特徴量の衝突)

同一の `DecisionRequest` 内において、異なる `logicalPatternKey` を持つ2つ以上の合法手が、57次元の特徴量ベクトル上で完全に同一の値へと縮退（Collision）した頻度です。

| Participant | 意思決定総数 | 衝突発生決定数 | 衝突発生率 | 衝突した合法手総数 | 最大グループサイズ |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **FirstLegal** | 23,683 | 1,716 | **7.2%** | 49,244 | 24 |
| **ZeroGenome** | 23,683 | 1,716 | **7.2%** | 49,244 | 24 |
| **ManualGeneric** | 23,683 | 1,716 | **7.2%** | 49,244 | 24 |
| **SeededRandom** | 16,839 | 2,166 | **12.9%** | 39,999 | 24 |

- **観測事実**: 意思決定の 7.2% 〜 12.9% において、最大 24 個の異なる合法手が全く同一の 57次元ベクトルに潰れています。
- **原因**: コスト支払いや対象ユニット・対象カードが複数存在しても、現行の Feature Schema v1 では「ユニットサイズ」「チャージ状態」などの集約値しか持たず、個別のカードランクやスート、配置スロットの違いを表現できないため。
- **方針**: 本フェーズでは Feature Schema v1 を一切変更せず、この限界を客観的エビデンスとして記録します。

---

## 9. Feature Activation Coverage (特徴量活性化率)

公式「ライト + エントリー16」の 600 試合を通じて、実際に使用（`value !== 0`）された特徴量の割合です。

- **Context Features**: **22 / 25 (88.0%)**
  - **一度も活性化しなかった特徴量 (3件)**:
    - `self_trump_count`: トランプ兵は Master/Pro レギュレーション専用のため Light では 0
    - `opponent_trump_count`: 同上
    - `opponent_life_is_10plus`: Entry16 では初期ライフ9（手札7枚引き後）のため、一度も10枚以上にならない
- **Pattern Features**: **40 / 57 (70.2%)**
  - **一度も活性化しなかった特徴量 (17件)**:
    - `pattern_is_other`, `action_speed_other`, `action_timing_other`
    - `action_timing_block`, `action_timing_damage_judge`: ブロック・判定タイミングのアクション定義が存在しない
    - `cost_sacrificed_unit_count`: 生贄コストを要求するアクションが Light に存在しない
    - `has_key_unit`, `key_unit_count`, `selected_unit_size_*`, `selected_unit_charge_*` 等 (8件): ユニットを合体・選択する高レベルアクションが Light に存在しない
    - `target_is_other`: 汎用ターゲット種別
    - `has_order_selection`, `ordered_item_count`: 順序選択アクションが Light に存在しない

---

## 10. Genome Argmax Ties (最善手の同点発生率)

`GenomeScorer.score()` を計算した際、最高スコア（maxScore）が 2件以上の合法手で完全一致した頻度です。

| Participant | 評価決定総数 | タイ発生決定数 | タイ発生率 | 最大同点合法手数 |
| :--- | :---: | :---: | :---: | :---: |
| **ZeroGenome** | 23,683 | 3,053 | **12.9%** | 153 |
| **ManualGeneric** | 23,683 | 2,992 | **12.6%** | 152 |

- **観測事実**: ZeroGenome だけでなく、重みを設定した ManualGenericGenome においても、意思決定の約 12.6% で最善手が同点（最大 152 パターン）となっています。
- これは、合法アクションが複数ある局面で、いずれも `pattern_is_action = 1` しか重みが乗らないため、すべて同点 5.0 となり、最小 `patternRef` タイブレークに依存していることを示しています。

---

## 11. Counterfactual Agreement (反実仮想選択一致率)

同一の `DecisionRequest` に対し、既存の参照ポリシー（FirstLegal, ZeroGenome）と全く同一の手を選択した割合です。

| Participant | 参照比較決定数 | same-as-FirstLegal 率 | same-as-ZeroGenome 率 |
| :--- | :---: | :---: | :---: |
| **FirstLegal** | 23,683 | **100.0%** | **100.0%** |
| **ZeroGenome** | 23,683 | **100.0%** | **100.0%** |
| **ManualGeneric**| 23,683 | **100.0%** | **100.0%** |
| **SeededRandom** | 16,839 | **86.7%** | **86.7%** |

- **重要な発見**: `FirstLegal`, `ZeroGenome`, `ManualGenericGenome` の3者は、公式対戦環境において**完全に同一の手（100.0% 一致）**を選択しています。
- 単に「action に +5, pass に -3」という粗いパターン種別の重み付けをしただけでは、FirstLegal の挙動（PASS 以外の先頭優先）から 1bit も分化しないことが定量的に証明されました。

---

## 12. Deterministic Repeatability (決定論的再現性)

本ベースライン測定は、同一設定（`baseSeed: 20260906`, 600 games）で Run A と Run B の 2回連続実行を行いました。

- **Run A Logical Digest**: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`
- **Run B Logical Digest**: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`
- **Digest 一致**: **true (100% 一致)**
- **Exact Logical Equality**: **true**
- **Diagnostic Error Count**: **0**

Gate 0 での D コスト決定論化により、600 試合に及ぶ長時間のバッチ対戦においても、乱数漏れ・未定義状態・非決定 ID の混入が完全に 0 であることが実証されました。

---

## 13. Observed Limitations (観測された課題)

1. **未決着試合 (INCOMPLETE) の存在**:
   - 決定論的ポリシー同士（FirstLegal vs Zero / Manual）において、100試合中 24試合（24%）が 500 decisions に達して未決着となりました。
   - これは、互いに攻撃を行わず防壁配置やチャージ・エンドを繰り返す「防衛膠着ループ」が発生していることを示唆しています。
2. **特徴量表現力の不足 (Feature Collision)**:
   - 意思決定の約 7.2% で、最大 24 パターンの異なる合法手が同じ特徴量に潰れています。
   - これにより、異なる対象や異なるコストの組み合わせを AI が評価・差別化できないボトルネックが存在します。
3. **ポリシーの無差別性 (No Differentiation)**:
   - パターン種別レベルの重み付け（ManualGeneric）では、タイブレークルールに支配され FirstLegal と全く同じ行動をとってしまいます。

---

## 14. Fitness設計へ進むために分かったこと (Fitness Readiness)

- **客観的事実**:
  - セットアップ成立性: 100% READY であり、セットアップ起因のルールギャップは本シード範囲で発生しない。
  - テクニカル障害: 0件（クラッシュや例外なし）。
  - 決定論性: 100% 再現可能。
- **次フェーズへの提言**:
  - 現在の Feature Schema v1 のまま Fitness 関数を設計して遺伝的アルゴリズム（Evolution）を回しても、合法手の大半が同点・衝突し、実質的に FirstLegal またはランダムなタイブレークを学習することになるリスクが高い。
  - したがって、Fitness 関数の設計と同時に、あるいはそれに先行して、**「ターゲットやコストの識別を可能にする Feature Schema v2」**（例: 攻撃対象のHP、キーカードのランク/スート、コスト支払いカードのランク等を表現する特徴量）の拡充を検討することが強く推奨される。
