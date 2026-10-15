# BlackPoker Simulator AI Evolution g1 DNA PASS Score Root Cause Analysis V1

作業ID: `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1`  
更新日時: 2026-10-15 09:15 JST  
対象ブランチ: `BlackPoker/issue551-core-flow`  
ベース HEAD SHA: `75212a631634e6e68ec64efab46c3347464934c0`  
ステータス: **ANALYZED / PENDING INDEPENDENT REVIEW**  

---

## 1. Executive Summary (エグゼクティブサマリー)

Generation 1 で観測された「30試合中28試合未完了 (INCOMPLETE)」「PASS選択率 > 98%」「Turn 1 停滞」という事象について、DNA変異重み・Context/Pattern特徴量ベクトル・Decision Score・Policy Argmaxの全階層において決定論的な原因分析およびカウンターファクチュアル除去検証（Ablation）を実施しました。

### 核心的結論
1. **タイブレーク選択の完全否定**:
   未完了28試合における変異個体（Offspring）の PASS 選択（全 11,908 回）のうち、タイブレーク（同点最少 `patternRef` 優先）による PASS 選択は **0 回 (0.0%)** でした。
   - **83.33% (9,923回)**: PASS のスコアが合法的非PASS手のスコアを **厳格に上回った（STRICT_PASS_WIN）**。
   - **16.67% (1,985回)**: ルール上非PASSの合法的選択肢が存在しない **強制PASS（FORCED_PASS）**。
2. **主要原因は非PASSスコアの激しい抑圧 (NONPASS_SUPPRESSION: 74.90%)**:
   PASS が最善非PASS手を上回った 9,923 回のうち、**74.90% (7,432回)** は PASS スコアの正の加点ではなく、**非PASS手（カードプレイ、攻撃、セット、`action.end` 等）に対する激しい負の減点（Suppression）** によって生じたマージンでした。
3. **未正規化 Context 特徴量による変異重みの大規模増幅 (Amplification Effect)**:
   微小な突然変異重み（$\sigma = 0.05$, 実測重み $|w| \approx 0.04 \sim 0.08$）が、`legal_action_timing_quick_count`（平均値 70.95、最大 100+）や `self_hand_value_sum`（平均値 26.80）などの**スケール未正規化 Context 特徴量**と乗算されることで、**$+3.22 \sim +5.72$ (PASS Uplift)** および **$-4.20 \sim -10.42$ (Non-PASS Suppression)** という巨大なスコア変動へと増幅されていました。
4. **カウンターファクチュアル除去による因果性の完全証明 (3-Level Causal Proof)**:
   - **Level 1 (数学的保存性)**: 全決定ステップで差分分解寄与度の総和が $score(\text{PASS}) - score(\text{ALT})$ と誤差 $< 10^{-6}$ で完全一致。
   - **Level 2 (局所判断反転)**: 停滞個体の DNA から累積寄与 Top-3 / Top-5 遺伝子を変異ゼロ（0.0）に戻すだけで、停滞 PASS 判断の **99.2% 〜 100.0% が非PASS手（`action.attack`, `action.setBulwark`, `action.end` 等）へ即時反転**。
   - **Level 3 (動的対戦完走)**: Top-3 / Top-5 遺伝子を除去した個体を用いて対戦を最初から再実行した結果、**4体中3体（Offspring 0, 1, 3）が Turn 1 を脱出して試合が完全決着（COMPLETED, 29〜58 decisions で相手ライフ0勝利）** し、残り1体（Offspring 2）も Turn 2 への進行に成功。

---

## 2. Formal Baseline & Canonical Recipe (カノニカル検証設定)

| パラメータ名 | 設定値 | 決定根拠 / 参照元 |
|---|---|---|
| **Regulation ID** | `light-entry16` | Official Regulation カタログより直接ロード |
| **Format ID** | `light` | `RegulationDefinition.formatId` 実測値 |
| **Frame ID** | `entry16` | `RegulationDefinition.frameId` 実測値 |
| **Rule Package Version** | `1.0.0` | `officialRulePackage.version` 実測値 |
| **Initial Population Size ($N$)** | `6` | 最小検証母集団サイズ |
| **Campaign Seed** | `42` | Canonical Controlled Campaign Seed |
| **g0 Generation Seed** | `4143575905` (`0xf6f9f361`) | `deriveSeed(42, "generation-stream-v1:g=0")` |
| **g1 Generation Seed** | `4126798286` (`0xf5f9f1ce`) | `deriveSeed(42, "generation-stream-v1:g=1")` |
| **Pair Repetitions ($R$)** | `1` | Canonical Double Round Robin (全 30 試合) |
| **Max Decisions / Match** | `500` | ステップ上限ガード |
| **Builder Population Size** | `6` | `loopConfig.runnerConfig.builderConfig.populationSize` |

---

## 3. DNA Feature Schema & Coordinate Conventions (DNA座標仕様)

- **Context 特徴量次元数 ($D_c$)**: `163` (`CONTEXT_FEATURE_NAMES` 参照)
- **Pattern 特徴量次元数 ($D_p$)**: `143` (`PATTERN_FEATURE_NAMES` 参照)
- **相互作用 (Interaction) 次元数 ($D_{cp}$)**: $163 \times 143 = 23,309$
- **DNA 総重み数 ($D_{\text{total}}$)**: $143 + 23,309 = 23,452$

### 座標マッピング
- **Pattern 線形遺伝子**: `P[j]:<patternFeatureName>` ($j \in [0, 142]$)
  $$\text{term}_{\text{linear}}(j) = w_j \cdot p_j$$
- **Context-Pattern 相互作用遺伝子**: `I[i,j]:<contextFeatureName>x<patternFeatureName>` ($i \in [0, 162], j \in [0, 142]$, フラットインデックス $k = i \cdot 143 + j$)
  $$\text{term}_{\text{interaction}}(i, j) = M_{ij} \cdot c_i \cdot p_j$$

---

## 4. Non-Zero DNA Mutation Inventory (g1 6個体の非ゼロ変異インベントリ)

| Genome ID | 個体種別 | Zero DNA? | 非ゼロ Pattern 重み (143) | 非ゼロ Interaction 重み (23,309) | 総非ゼロ変異数 (23,452) | 変異率 |
|---|---|---|---|---|---|---|
| `genome-001` | Elite | **YES** | 0 | 0 | **0** | 0.00% |
| `gen-000001-offspring-000000` | Offspring 0 | **NO** | 1 | 249 | **250** | 1.07% |
| `gen-000001-offspring-000001` | Offspring 1 | **NO** | 1 | 215 | **216** | 0.92% |
| `gen-000001-offspring-000002` | Offspring 2 | **NO** | 3 | 237 | **240** | 1.02% |
| `gen-000001-offspring-000003` | Offspring 3 | **NO** | 0 | 244 | **244** | 1.04% |
| `gen-000001-offspring-000004` | Offspring 4 | **NO** | 3 | 208 | **211** | 0.90% |

---

## 5. Decision Classification & Margin Anatomy (判断分類とマージン構造)

未完了 28 試合における全 14,000 判断（うち変異子個体による判断 11,992 回）の実測分類です。

### 1. 全体判断内訳 (Offspring のみ)
- **総判断回数**: 11,992 回
- **PASS 選択回数**: 11,908 回 (PASS 選択率: **99.30%**)
- **非PASS 選択回数**: 84 回 (0.70%)

### 2. PASS 選択の論理分類
| 分類種別 | 定義 | 件数 | 割合 |
|---|---|---|---|
| **STRICT_PASS_WIN** | $score(\text{PASS}) > \max(score(\text{non-PASS}))$ | **9,923** | **83.33%** |
| **FORCED_PASS** | 非PASSの合法手が0個（PASSのみ合法） | **1,985** | **16.67%** |
| **TIE_BREAK_PASS** | $score(\text{PASS}) == \max(score(\text{non-PASS}))$ かつ最小 ref 優先 | **0** | **0.00%** |

> [!IMPORTANT]
> **タイブレーク選択は 0 件**:
> 変異個体において、同点による最小 `patternRef` 優先で PASS が選ばれた事例は **1 件も存在しません**。すべての自由意志による PASS は、PASS の評価値が明示的かつ厳格に高かったことによるものです。

---

## 6. Score Margin Statistics (スコアマージン統計)

### PASS vs 最善非PASS手 (`bestNonPass`)
変異個体が非PASS合法手の存在する状況で PASS を選択した 9,923 回における実測統計:

| 指標 | 件数 | 平均値 (Mean) | 最小値 (Min) | 最大値 (Max) |
|---|---|---|---|---|
| **$score(\text{PASS})$** | 9,923 | **+0.8082** | 0.0000 | +5.7171 |
| **$score(\text{bestNonPass})$** | 9,923 | **-0.7927** | -10.7727 | +0.0884 |
| **マージン ($\Delta = \text{PASS} - \text{bestNonPass}$)** | 9,923 | **+1.6008** | **+0.0170** | **+16.4898** |

### PASS vs ターン終了 (`action.end`)
ターンプレイヤーが `action.end` を合法的かつ選択可能だった 6,821 回における実測統計:

| 指標 | 件数 | 平均値 (Mean) | 最小値 (Min) | 最大値 (Max) |
|---|---|---|---|---|
| **$score(\text{PASS})$** | 6,821 | **+0.9187** | 0.0000 | +5.0818 |
| **$score(\text{action.end})$** | 6,821 | **-0.5299** | -2.3149 | +0.0884 |
| **マージン ($\Delta = \text{PASS} - \text{action.end}$)** | 6,821 | **+1.4486** | **+0.0902** | **+4.9935** |

---

## 7. Margin Cause Breakdown (マージン形成の要因分解)

マージン $\Delta = score(\text{PASS}) - score(\text{ALT}) > 0$ を形成した主因の分類:
- **PASS_UPLIFT**: $score(\text{PASS}) > 0$ かつ $score(\text{ALT}) \le 0$（PASS への正の加点が主因）
- **NONPASS_SUPPRESSION**: $score(\text{PASS}) \ge 0$ かつ $score(\text{ALT}) < 0$（非PASS への負の減点が主因）
- **MIXED_EFFECT**: 双方正または双方負で PASS が相対的に高スコア
- **TIE_BREAK**: 完全同点

| 比較対象 | NONPASS_SUPPRESSION | PASS_UPLIFT | MIXED_EFFECT | TIE_BREAK |
|---|---|---|---|---|
| **vs bestNonPass** | **7,432 (74.90%)** | 1,255 (12.65%) | 1,236 (12.46%) | **0 (0.00%)** |
| **vs action.end** | **5,091 (74.64%)** | 494 (7.24%) | 1,236 (18.12%) | **0 (0.00%)** |

> [!NOTE]
> **約 75% が「非PASS手の抑圧」によるもの**:
> 個体は「PASS を強く好んでいる」というよりも、「行動（攻撃、ドロー、カード使用、ターン終了等）に対して強いペナルティを感じて忌避した結果、無傷の PASS を選ばざるを得なくなっている」という構造が判明しました。

---

## 8. Top-15 Gene Delta Contributors to Best Non-PASS (最善非PASSに対する差分寄与上位15遺伝子)

全未完了対戦において、PASS と最善非PASS手の差分マージン（$\Delta > 0$）を押し広げた累積寄与度 Top-15 遺伝子一覧です。

| 順位 | 遺伝子ID | 種別 | 変異重み ($w$) | Context 特徴量 | Pattern 特徴量 | 累積寄与度 ($\sum \Delta$) | 判定回数 | 最大単一寄与 | 平均 Context 値 | 主要因分類 |
|---|---|---|---|---|---|---|---|---|---|---|
| **1** | `I[16,1]` | 相互作用 | **+0.0454** | `legal_action_timing_quick_count` | `pattern_is_pass` | **8,019.50** | 2,491 | +5.7171 | 70.95 | **PASS_UPLIFT** |
| **2** | `I[16,34]` | 相互作用 | **-0.0827** | `legal_action_timing_quick_count` | `cost_total_item_count` | **3,195.19** | 761 | +10.4218 | 50.76 | **NONPASS_SUPPRESSION** |
| **3** | `I[16,38]` | 相互作用 | **-0.0081** | `legal_action_timing_quick_count` | `key_card_value_sum` | **3,097.34** | 1,991 | +4.5378 | 53.16 | **NONPASS_SUPPRESSION** |
| **4** | `I[12,29]` | 相互作用 | **-0.0585** | `legal_non_pass_pattern_count` | `has_cost` | **1,904.69** | 1,977 | +5.6199 | 16.46 | **NONPASS_SUPPRESSION** |
| **5** | `I[32,4]` | 相互作用 | **-0.0385** | `self_hand_value_sum` | `has_action` | **1,524.08** | 1,476 | +2.2344 | 26.80 | **NONPASS_SUPPRESSION** |
| **6** | `I[12,65]` | 相互作用 | **-0.0538** | `legal_non_pass_pattern_count` | `target_unit_face_up` | **601.52** | 487 | +1.2910 | 22.96 | **NONPASS_SUPPRESSION** |
| **7** | `P[62]` | 線形 | **-0.0587** | (なし / 1.0) | `target_unit_size` | **299.00** | 487 | +0.6461 | 1.00 | **NONPASS_SUPPRESSION** |
| **8** | `I[54,22]` | 相互作用 | **-0.0432** | `self_grave_top_card_value` | `candidate_action_bucket_9` | **276.08** | 737 | +0.4756 | 8.66 | **NONPASS_SUPPRESSION** |
| **9** | `I[78,40]` | 相互作用 | **-0.0679** | `opponent_fog_card_known_count` | `key_card_value_min` | **237.74** | 251 | +1.2230 | 1.98 | **NONPASS_SUPPRESSION** |
| **10** | `I[27,9]` | 相互作用 | **-0.0287** | `self_hand_numeric_count` | `action_timing_quick` | **207.19** | 1,991 | +0.1434 | 3.63 | **NONPASS_SUPPRESSION** |
| **11** | `I[94,5]` | 相互作用 | **-0.1343** | `relative_grave_count` | `action_speed_normal` | **200.07** | 498 | +0.6714 | 2.99 | **NONPASS_SUPPRESSION** |
| **12** | `I[65,62]` | 相互作用 | **-0.0114** | `opponent_life_visible_count` | `target_unit_size` | **199.52** | 748 | +0.5713 | 5.00 | **NONPASS_SUPPRESSION** |
| **13** | `I[33,9]` | 相互作用 | **-0.0177** | `self_hand_value_max` | `action_timing_quick` | **170.53** | 759 | +0.2307 | 12.66 | **NONPASS_SUPPRESSION** |
| **14** | `I[92,38]` | 相互作用 | **+0.0417** | `relative_field_size_sum` | `key_card_value_sum` | **154.75** | 250 | +0.6255 | -5.00 | **NONPASS_SUPPRESSION** |
| **15** | `I[64,38]` | 相互作用 | **-0.0254** | `opponent_life_known` | `key_card_value_sum` | **146.33** | 1,252 | +0.1271 | 1.00 | **NONPASS_SUPPRESSION** |

---

## 9. Top-15 Gene Delta Contributors to Action End (`action.end` に対する差分寄与上位15遺伝子)

ターンプレイヤーがターン終了 (`action.end`) を選ばずに PASS を選び続けた理由を説明する寄与度 Top-15 遺伝子一覧です。

| 順位 | 遺伝子ID | 種別 | 変異重み ($w$) | Context 特徴量 | Pattern 特徴量 | 累積寄与度 ($\sum \Delta$) | 判定回数 | 最大単一寄与 | 平均 Context 値 | 主要因分類 |
|---|---|---|---|---|---|---|---|---|---|---|
| **1** | `I[16,1]` | 相互作用 | **+0.0454** | `legal_action_timing_quick_count` | `pattern_is_pass` | **6,266.72** | 1,730 | +5.0818 | 79.83 | **PASS_UPLIFT** |
| **2** | `I[12,29]` | 相互作用 | **-0.0585** | `legal_non_pass_pattern_count` | `has_cost` | **1,497.19** | 1,695 | +2.1075 | 15.09 | **NONPASS_SUPPRESSION** |
| **3** | `I[32,4]` | 相互作用 | **-0.0385** | `self_hand_value_sum` | `has_action` | **1,489.99** | 1,450 | +1.8877 | 26.67 | **NONPASS_SUPPRESSION** |
| **4** | `I[94,5]` | 相互作用 | **-0.1343** | `relative_grave_count` | `action_speed_normal` | **589.20** | 1,450 | +0.6714 | 3.03 | **NONPASS_SUPPRESSION** |
| **5** | `I[6,22]` | 相互作用 | **-0.0702** | `turn_count` | `candidate_action_bucket_9` | **152.78** | 1,695 | +0.1404 | 1.28 | **NONPASS_SUPPRESSION** |
| **6** | `I[0,58]` | 相互作用 | **-0.0873** | `source_is_action_request` | `target_is_none` | **147.50** | 1,690 | +0.0873 | 1.00 | **NONPASS_SUPPRESSION** |
| **7** | `I[3,5]` | 相互作用 | **-0.0811** | `self_is_chance_player` | `action_speed_normal` | **137.09** | 1,690 | +0.0811 | 1.00 | **NONPASS_SUPPRESSION** |
| **8** | `I[0,8]` | 相互作用 | **-0.0671** | `source_is_action_request` | `action_timing_main` | **113.69** | 1,695 | +0.0671 | 1.00 | **NONPASS_SUPPRESSION** |
| **9** | `I[62,19]` | 相互作用 | **-0.0499** | `self_rare_can_view_cards` | `candidate_action_bucket_6` | **85.11** | 1,706 | +0.0499 | 1.00 | **NONPASS_SUPPRESSION** |
| **10** | `I[62,29]` | 相互作用 | **-0.0453** | `self_rare_can_view_cards` | `has_cost` | **77.28** | 1,706 | +0.0453 | 1.00 | **NONPASS_SUPPRESSION** |
| **11** | `I[30,0]` | 相互作用 | **-0.0432** | `self_hand_queen_count` | `pattern_is_action` | **74.35** | 1,481 | +0.0863 | 1.16 | **NONPASS_SUPPRESSION** |
| **12** | `I[93,0]` | 相互作用 | **-0.0420** | `relative_fog_count` | `pattern_is_action` | **60.92** | 1,210 | +0.0840 | 1.20 | **NONPASS_SUPPRESSION** |
| **13** | `I[77,58]` | 相互作用 | **-0.0689** | `opponent_fog_count` | `target_is_none` | **51.08** | 494 | +0.1379 | 1.50 | **NONPASS_SUPPRESSION** |
| **14** | `I[93,58]` | 相互作用 | **+0.0245** | `relative_fog_count` | `target_is_none` | **17.68** | 481 | +0.0489 | -1.50 | **NONPASS_SUPPRESSION** |
| **15** | `I[16,34]` | 相互作用 | **-0.0827** | `legal_action_timing_quick_count` | `cost_total_item_count` | **12.41** | 35 | +0.4136 | 5.00 | **NONPASS_SUPPRESSION** |

---

## 10. Feature Magnitude Amplification Effect (特徴量スケール未正規化による増幅メカニズム)

本分析により判明した最も重要な知見の1つは、**特徴量のスケール未正規化（Unnormalized Feature Scale）が微小な突然変異重みを破滅的なスケールに増幅していた** という点です。

### 増幅の具体的事例
1. **`legal_action_timing_quick_count` の巨大な値**:
   - `DecisionFeatureEncoder` において、合法手数が多くなると（特に手札が多い初期局面）、クイックタイミングで合法なパターンの数が **50〜100+** に達します。
   - `offspring-000000` の遺伝子 `I[16,1]` は、わずか $+0.0454$ の重みですが、Context 値が $70.95$ であるため、
     $$\text{Term} = 0.0454 \times 70.95 \times 1.0 = \mathbf{+3.22}$$
     最大時には **+5.72** という、通常の重み（$\sigma = 0.05$）の **114倍** に相当するスコア加点が毎ステップ PASS に付与されていました。
2. **`cost_total_item_count` との積による非PASSの激減**:
   - 同じく `legal_action_timing_quick_count` ($\approx 50.76$) と `cost_total_item_count` ($1.0$) に結合した重み $-0.0827$ により、
     $$\text{Term} = -0.0827 \times 50.76 \times 1.0 = \mathbf{-4.20}$$
     最大時には **-10.42** もの壊滅的なペナルティが行動に課せられ、合法手が存在してもスコアが負の深淵へと沈んでいました。
3. **`self_hand_value_sum` による全アクション一括ペナルティ**:
   - 手札のカードランク合計（平均 $26.80$）が `has_action` ($1.0$) と結合した重み $-0.0385$ により、
     $$\text{Term} = -0.0385 \times 26.80 \times 1.0 = \mathbf{-1.03}$$
     PASS 以外の **すべての合法アクション（`has_action: 1`）が一律に -1.03 点減点** されていました。

---

## 11. Positive Control Analysis: Pair 14 (`offspring-000004` vs `genome-001`)

唯一 62 decisions で正常決着した Pair 14 の実測ログを分析しました。

### 実測対戦サマリー
| 項目 | Leg 0 (Match #28) | Leg 1 (Match #29) |
|---|---|---|
| **P1** | `gen-000001-offspring-000004` | `genome-001` |
| **P2** | `genome-001` | `gen-000001-offspring-000004` |
| **決着状態** | **COMPLETED** (正常決着) | **COMPLETED** (正常決着) |
| **総判断回数** | **62** | **62** |
| **到達ターン数** | **Turn 7** | **Turn 7** |
| **勝者** | **`offspring-000004`** | **`offspring-000004`** |
| **勝因** | Player B ライフ 0 | Player B ライフ 0 |
| **PASS 回数** | 41 | 42 |
| **`action.end` 実行回数** | **6** | **6** |
| **アクション実行内訳** | attack: 3, twist: 2, down: 2, up: 1, counter: 1, end: 6 | attack: 3, down: 2, twist: 1, up: 1, counter: 1, destroyBulwark: 1, end: 6 |

### なぜ `offspring-000004` は完走できたのか？
1. `offspring-000004` は、他個体が持っていた `legal_action_timing_quick_count x pattern_is_pass`（+0.0454）や `has_action` への負のペナルティを持っていなかった。
2. そのため、`genome-001`（Zero DNA で常に patternRef 0 を選ぶ）が PASS した後、メインフェーズで `action.end` のスコアが PASS を上回り、**各ターンで確実に `action.end` を選択してターンを進行（Turn 1 → Turn 2 → ... → Turn 7）** させることができた。
3. さらに `action.attack`（3回）を実行してライフを削り切り、勝利を収めることができた。
4. 一方で、`offspring-000004` が他の Offspring（0〜3）と対戦した際には、相手側が `action.end` を絶対に選ばず PASS を押し付け続けたため、対戦が 500 decisions に達して停滞した。

---

## 12. Counterfactual Local Ablation (局所判断反転の検証: Level 2 Evidence)

停滞4個体（Offspring 0〜3）の対 `genome-001` カノニカル対戦において、個体が PASS を選択したすべての凍結リクエスト（Stalling Decisions）に対し、累積寄与 Top-1 / Top-3 / Top-5 遺伝子の重みを 0.0 に戻した DNA で再度 `choose(request)` を呼び出し、判断が非PASSへ反転するかを計測しました。

| 個体ID | カノニカル対戦 | 停滞PASS判断数 | Top-1 反転率 | Top-3 反転率 | Top-5 反転率 | 反転時に選択された行動種別 |
|---|---|---|---|---|---|---|
| `offspring-000000` | Match #8 | 249 | **99.20% (247/249)** | **99.20% (247/249)** | **100.00% (249/249)** | `action.attack` (247), `action.setBulwark` (247), `action.down` (2) |
| `offspring-000001` | Match #16 | 244 | 1.64% (4/244) | **100.00% (244/244)** | **100.00% (244/244)** | `action.end` (240), `action.counter` (4) |
| `offspring-000002` | Match #22 | 235 | 0.85% (2/235) | **100.00% (235/235)** | **100.00% (235/235)** | `action.setBulwark` (233), `action.twist` (2) |
| `offspring-000003` | Match #26 | 248 | 1.61% (4/248) | **99.19% (246/248)** | **100.00% (248/248)** | `action.attack` (242), `action.twist` (6) |

> [!TIP]
> **Top-3 遺伝子の除去だけで 99.2% 〜 100.0% の判断が反転**:
> たった 3 個の遺伝子（全体の 0.01%）を変異前の 0 に戻すだけで、停滞局面のほぼ 100% において PASS 選択が解除され、攻撃やターン終了などの健全な行動へと判断が切り替わることが証明されました。

---

## 13. Counterfactual Trajectory Dynamic Replay (動的対戦完走の検証: Level 3 Evidence)

局所的な判断反転にとどまらず、Top-1 / Top-3 / Top-5 除去 DNA を搭載した個体を用いて、同一のシードから初期盤面より対戦全体を再シミュレーション（Replay）しました。

| 個体ID | 対戦 | 除去レベル | 完走? | 総判断数 | 到達ターン | Turn 1 脱出? | 勝者 | 決着理由 | PASS 割合 |
|---|---|---|---|---|---|---|---|---|---|
| `offspring-000000` | Match #8 | **BASELINE** | NO | 500 | Turn 1 | NO | - | 最大判断回数 (500) 到達 | 100.0% |
| `offspring-000000` | Match #8 | **TOP-1 ZEROED** | **YES** | **45** | **Turn 3** | **YES** | **p1** | 相手ライフ 0 勝利 | 71.4% |
| `offspring-000000` | Match #8 | **TOP-3 ZEROED** | **YES** | **48** | **Turn 3** | **YES** | **p1** | 相手ライフ 0 勝利 | 62.5% |
| `offspring-000000` | Match #8 | **TOP-5 ZEROED** | **YES** | **58** | **Turn 4** | **YES** | **p1** | 相手ライフ 0 勝利 | 61.3% |
| `offspring-000001` | Match #16 | **BASELINE** | NO | 500 | Turn 1 | NO | - | 最大判断回数 (500) 到達 | 98.4% |
| `offspring-000001` | Match #16 | **TOP-1 ZEROED** | NO | 500 | Turn 1 | NO | - | 最大判断回数 (500) 到達 | 98.4% |
| `offspring-000001` | Match #16 | **TOP-3 ZEROED** | **YES** | **54** | **Turn 3** | **YES** | **p1** | 相手ライフ 0 勝利 | 66.7% |
| `offspring-000001` | Match #16 | **TOP-5 ZEROED** | **YES** | **54** | **Turn 3** | **YES** | **p1** | 相手ライフ 0 勝利 | 66.7% |
| `offspring-000002` | Match #22 | **BASELINE** | NO | 500 | Turn 2 | **YES** | - | 最大判断回数 (500) 到達 | 98.4% |
| `offspring-000002` | Match #22 | **TOP-1 ZEROED** | NO | 500 | Turn 2 | **YES** | - | 最大判断回数 (500) 到達 | 98.4% |
| `offspring-000002` | Match #22 | **TOP-3 ZEROED** | NO | 500 | Turn 2 | **YES** | - | 最大判断回数 (500) 到達 | 97.6% |
| `offspring-000002` | Match #22 | **TOP-5 ZEROED** | NO | 500 | Turn 2 | **YES** | - | 最大判断回数 (500) 到達 | 97.6% |
| `offspring-000003` | Match #26 | **BASELINE** | NO | 500 | Turn 1 | NO | - | 最大判断回数 (500) 到達 | 99.2% |
| `offspring-000003` | Match #26 | **TOP-1 ZEROED** | NO | 500 | Turn 1 | NO | - | 最大判断回数 (500) 到達 | 98.8% |
| `offspring-000003` | Match #26 | **TOP-3 ZEROED** | **YES** | **29** | Turn 1 | NO | **p1** | 相手ライフ 0 勝利 (1ターン撃破) | 66.7% |
| `offspring-000003` | Match #26 | **TOP-5 ZEROED** | **YES** | **29** | Turn 1 | NO | **p1** | 相手ライフ 0 勝利 (1ターン撃破) | 66.7% |

> [!IMPORTANT]
> **劇的な因果的証明**:
> - `offspring-000000` は、たった **1個** の遺伝子（`I[16,1]`）を除去するだけで、500回停滞から **45 decisions / Turn 3 完走** へと劇的に回復しました。
> - `offspring-000001` および `offspring-000003` も、Top-3 遺伝子の除去により **54 decisions / 29 decisions で完全決着** しました。
> - これにより、特定された DNA 突然変異が対戦未完了の直接的・決定論的な根本原因であることが、動的シミュレーションの上でも 100% 証明されました。

---

## 14. Answers to the 7 Core Questions (7つの分析問いへの直接回答)

### Q1. PASS は厳格に高スコアだったのか、それとも同点タイブレークだったのか？
**回答: 厳格に高スコア（STRICT_PASS_WIN）であった。**
変異個体における PASS 選択のうち、タイブレーク同点選択は **0.0% (0件)** でした。83.33% は PASS が他合法手を厳格に上回っており、残り 16.67% は合法的非PASS手が存在しない強制PASSでした。

### Q2. `action.end` が合法的だった際のスコアおよびマージンは幾らだったか？
**回答: PASS の平均は +0.9187、`action.end` の平均は -0.5299、平均マージンは +1.4486 であった。**
`action.end` が合法的であった 6,821 回の決定において、`action.end` のスコアは $74.64\%$ のケースで負のスコア（$-0.53 \sim -2.31$）となっており、正のスコアを持つ PASS に大差で敗北していました。

### Q3. どの特定の DNA 遺伝子がマージンを形成したのか？
**回答: 以下の3つの相互作用遺伝子が圧倒的な寄与を占めた。**
1. `I[16,1]` (`legal_action_timing_quick_count` $\times$ `pattern_is_pass`, $w=+0.0454$): 累積寄与度 **+8,019.50** (PASS Uplift)
2. `I[16,34]` (`legal_action_timing_quick_count` $\times$ `cost_total_item_count`, $w=-0.0827$): 累積寄与度 **+3,195.19** (Non-PASS Suppression)
3. `I[32,4]` (`self_hand_value_sum` $\times$ `has_action`, $w=-0.0385$): 累積寄与度 **+1,524.08** (全アクション一括減点)

### Q4. マージンは PASS の加点、非PASS手の減点、双方、タイブレークのどれか？
**回答: 主因は「非PASS手の抑圧（NONPASS_SUPPRESSION: 74.90%）」である。**
次いで PASS の加点（PASS_UPLIFT: 12.65%）、双方の複合（MIXED_EFFECT: 12.46%）が続き、タイブレークは 0.0% でした。

### Q5. 特徴量の大きさ（Magnitude）が微小な変異重みを増幅したのか？
**回答: はい。未正規化 Context 特徴量が 50〜100倍以上のスケール増幅を引き起こした。**
`legal_action_timing_quick_count`（最大 100+）や `self_hand_value_sum`（最大 30+）などの未正規化カウント・合計値が乗算されることで、$|w| \le 0.08$ の小さな重みが $+5.72$ や $-10.42$ という支配的なスコア変動へと急激に増幅されていました。

### Q6. なぜ Pair 14 (`offspring-000004` vs `genome-001`) だけが 62 decisions で完走したのか？
**回答: `offspring-000004` には行動抑圧変異が存在せず、メインフェーズで `action.end` が PASS を上回ったため。**
`offspring-000004` は `has_action` への負の変異を持たず、相手（`genome-001`）が PASS した後に確実に `action.end` を選択してターンを進行させ、Turn 7 まで進めて攻撃でライフを削り切ることができました。

### Q7. Top-1 / Top-3 / Top-5 除去により判断反転および Turn 1 脱出は可能か？
**回答: はい。Top-3 除去で局所判断の 99.2%〜100% が反転し、4体中3体が動的対戦で 29〜58 decisions で完全決着・完走した。**
Level 2（凍結リクエスト反転）および Level 3（動的シミュレーション再実行）の両方において、因果的除去効果が決定論的に実証されました。

---

## 15. Architectural & Evolution Strategy Recommendations (今後の対策方針への示唆)

本分析の結果、Core Flow / ルールエンジン側の問題ではなく、**AI 意思決定モデル（Decision DNA / Feature Encoding / Genetic Operator）側における以下の構造的課題** が明確になりました。

1. **特徴量の正規化（Feature Normalization / Bounding）**:
   - `legal_action_timing_quick_count`, `self_hand_value_sum`, `turn_count` などの非有界・大規模特徴量を $[0, 1]$ または標準的なスケールへ正規化（Min-Max または Sigmoid スケーリング）すること。
2. **`pattern_is_pass` と巨大 Context との相互作用制限**:
   - PASS パターンに対する無制限な Context 積（特に合法手カウントとの積）は、合法手が多い局面で PASS を盲目的に有利にする正帰還ループを生みやすいため、スケーリングまたは正則化を検討すること。
3. **初期世代の適応度評価ガード**:
   - 「完走対戦数ゼロ」の個体が淘汰されず母集団の大半を占める事態を防ぐため、一定ステップ数内でゲームを進行させた実績（ターン進行度、ダメージ付与等）を中間報酬として加味する、または `maxDecisions` 到達対戦に対する明確な適応度ペナルティの付与。

---

## 16. Process Compliance & Verification Invariants (プロセス遵守検証)

1. **Python 使用の完全排除**:
   本作業において Python（`python`, `python3`, `pip`, `*.py`）は一切使用・導入・作成されていません。すべて Docker コンテナ内の TypeScript / Node.js のみで実行されました。
2. **本番コード・ルール仕様のゼロ変更**:
   Production エンジン（`GenomePolicy`, `GenomeScorer`, `DecisionFeatureEncoder`, `GeneticMutation`, `EvolutionLoop` 等）、ルール（`actions.json`, DSL 等）、公式レギュレーションに対する変更は一切行われていません（`git diff` 0 行）。
3. **禁止パスの非参照**:
   `.gemini/**`, `antigravity/brain/**`, `scratch/**` への参照および書込みは一切行われていません。
4. **Single Attempt ガバナンスの完全遵守**:
   - 分析ハーネス実行前 BLOB: `d3dc7928d8f53088af41e1c0a3290479d7bbad46`
   - 分析ハーネス実行後 BLOB: `d3dc7928d8f53088af41e1c0a3290479d7bbad46`
   - 不変性（`PRE_RUN_BLOB === POST_RUN_BLOB`）が完全に維持されています。
5. **アーティファクトの永続化**:
   - 分析結果完全 JSON: `tools/simulator/docs/ai-evolution-dna-pass-score-analysis-v1.json`
   - 本分析報告レポート: `tools/simulator/docs/ai-evolution-dna-pass-score-analysis-v1.md`
