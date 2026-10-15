# BlackPoker Simulator - Decision DNA PASS Score Root Cause Analysis V1-R2

## 1. Document Identity & Status

- **Work ID**: `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R2`
- **Previous Work ID**: `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R1` (NOT ACCEPTED / SUPERSEDED BY R2)
- **Status**: **ANALYZED / PENDING INDEPENDENT REVIEW**
- **Formal Status**: Antigravity declares **NO FORMAL ACCEPTED** (Independent Review Gate only).
- **Target Branch**: `BlackPoker/issue551-core-flow`
- **Canonical Start HEAD**: `c345b66185f4521b1a4715225ebef10567fa34cf`
- **Evaluation Regulation**: Official `light-entry16`
- **Evaluation Environment**: Docker container `bp-simulator` (Node v20.20.2, Alpine Linux)
- **Canonical JSON Artifact**: `tools/simulator/docs/ai-evolution-dna-pass-score-analysis-v1-r2.json`

---

## 2. Executive Summary & R1 Defect Resolution

BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R1 において、数学的保存則・連続質量分析・二重再構築・反実仮想アブレーション等の主要な科学的検証が成功していたものの、カノニカル JSON アーティファクト `ai-evolution-dna-pass-score-analysis-v1-r1.json` の出力時シリアライゼーションにおいて、`perGenomeContributors` のキーが g1 オフスプリング（`gen-000001-offspring-000000` 〜 `000004`）ではなく g0 の `INITIAL_GENOME_IDS`（`genome-000`, `genome-002` 〜 `005`）で走査されていたため、空配列 `[]` として出力されるアーティファクト欠陥が存在しました。

本 **V1-R2** では、このシリアライゼーション欠陥を根本修正し、かつ事前検証ロジック（In-Harness Pre-Write Validation）を組み込んだ上で、**厳格な Single Attempt（単一実行）規約** に基づき全分析を再実行・再確認しました。

### V1-R2 における主要な確認結果

1. **カノニカル JSON アーティファクトの完全修復**:
   - `ai-evolution-dna-pass-score-analysis-v1-r2.json` 内の `perGenomeContributors` に、全 5 体の g1 オフスプリングの Authoritative Top-10 寄与遺伝子リストが完全に記録されました（空配列 0 件、不正キー 0 件、全重み照合完全一致）。
2. **二重再構築（Double Reconstruction）の決定論的一致**:
   - キャンペーンシード 42 からの独立した 2 回の再構築（Reconstruction A および B）において、得られた g1 母集団 6 体の Genome ID、全重み配列、Behavioral DNA Digest（SHA-256）、および論理実行結果が完全に一致（Deep Equal）しました。
3. **同点タイブレーク説の完全否定（再確認）**:
   - オフスプリングの全 PASS 決定 11,908 回中、同点タイブレークによる PASS は **0 件（0.00%）**。
   - **83.33%（9,923 件）は PASS が厳密に単独最高スコア（`STRICT_PASS_WIN`）**。
   - **16.67%（1,985 件）は非 PASS 合法手が存在しない強制 PASS（`FORCED_PASS`）**。
4. **`action.end` と PASS のスコア格差**:
   - `action.end` が合法な 6,846 局面中、6,839 局面（99.90%）で PASS が End を上回っており、PASS が選ばれた 6,821 決定における平均マージンは $+1.4486$（PASS 平均 $+0.9187$, End 平均 $-0.5299$）。
5. **全差分分解（Full Decomposition）と数学的保存則**:
   - 全決定・全遺伝子差分寄与度を完全集約。全決定局面における保存則誤差は最大 $5.33 \times 10^{-15} \ll 10^{-6}$ で成立。
   - 数学的等式 $\Delta = \text{Uplift} + \text{Suppression} - \text{Penalty} - \text{AltUplift}$ が全決定で完全に成立（誤差 $< 10^{-12}$）。
6. **連続質量（Magnitude Mass）による定量的分解**:
   - 正の累積マージン質量（分母: $22,512.47$）中：
     - **Non-PASS Suppression 質量（他手減点）: $14,492.97$（64.38%）**
     - **PASS Uplift 質量（PASS加点）: $8,019.50$（35.62%）**
   - 他アクションへの減点ペナルティが主因、PASS 加点が従因であることが決定論的に再実証されました。
7. **未正規化特徴量の巨大増幅効果**:
   - 生整数特徴量（`legal_action_timing_quick_count` が最大 126、`legal_non_pass_pattern_count` が最大 137、`self_hand_value_sum` が最大 82）が変異重み（$|w| \le 0.1870$）を最大 137 倍に増幅。
8. **反実仮想アブレーションによる因果実証**:
   - 局所判断反転において、offspring-000000（99.20%）、offspring-000002（100%）、offspring-000003（99.19%）が PASS から脱出。
   - 動的軌道リプレイにおいて、offspring-000000（45 decisions, Turn 3）、offspring-000002（72 decisions, Turn 6）、offspring-000003（29 decisions, Turn 1）が対戦を完走。

---

## 3. Process Compliance & Single Attempt Verification

### 3.1 技術スタック規約の厳格遵守
- **Python 完全排除**: `*.py`, `python`, `python3`, `pip`, `venv`, `pytest` 等は一切作成・導入・実行していません。
- **Host Node / npm / npx 完全排除**: すべてのスクリプト実行、ビルド、テストは Docker コンテナ `bp-simulator` 内で実行。
- **PowerShell 書き込み完全排除**: PowerShell からのファイル書き込み（`Set-Content`, `Out-File`, `>` リダイレクト等）は一切行わず、エージェント標準のファイル操作ツールのみを使用。
- **禁止パス非接触**: `.gemini/**`, `antigravity/brain/**`, `transcript*.jsonl` 等へのアクセスなし。
- **Production コード無変更**: `EvolutionLoop.ts`, `GenerationRunner.ts`, `GenomePolicy.ts`, `GenomeScorer.ts`, `DecisionFeatureEncoder.ts`, `GameSession.ts` 等の Production コード差分は厳格に **0 行**。

### 3.2 Single Attempt 規約の遵守
- **Harness 実行回数**: **正確に 1 回（Single Attempt Strict Compliance）**
- **PRE_RUN_HARNESS_BLOB**: `0fb48605e7c3197ffede0d1c952cbb5d0b6a891b`
- **POST_RUN_HARNESS_BLOB**: `0fb48605e7c3197ffede0d1c952cbb5d0b6a891b`
- **PRE == POST**: **YES**（実行後の Harness 編集・追加実行ゼロ）

---

## 4. Canonical Recipe & Seed Schedules

公式 Production Contract に完全一致するシードスケジュールおよびレシピを使用：

| 項目 | 設定値 | 備考 |
|---|---|---|
| Regulation | `light-entry16` | 公式レギュレーション |
| Initial Population N | 6 | `genome-000` 〜 `genome-005` (All Zero DNA) |
| Campaign Seed | 42 | ループ基準シード |
| Generation Count | 1 | g0 $\to$ g1 再構築用 |
| Pair Repetitions | 1 | 1 ペアあたり正逆 2 レグ（計 30 試合） |
| Max Decisions per Match | 500 | 500 到達で INCOMPLETE 判定 |
| Builder Population Size | 6 | 次世代母集団サイズ |
| **g0 Stream Key** | `evolution-loop-generation-v1-0` | `canonicalGenerationStreamKey(0)` |
| **g0 Generation Seed** | `4143575905` | `deriveSeed(42, streamKey)` |
| **g1 Stream Key** | `evolution-loop-generation-v1-1` | `canonicalGenerationStreamKey(1)` |
| **g1 Generation Seed** | `4126798286` | `deriveSeed(42, streamKey)` |

---

## 5. Historical Source Audit & Codebase Immutability

ベースラインコミット `c345b66185f4521b1a4715225ebef10567fa34cf` における差分監査：

| コンポーネント | 差分行数 | 状態 |
|---|---|---|
| `EvolutionLoop.ts` / `EvolutionLoopTypes.ts` | 0 diff | 完全一致 |
| `GenerationRunner.ts` / `GenerationRunnerTypes.ts` | 0 diff | 完全一致 |
| `GenerationBuilder.ts` / `GenerationBuilderTypes.ts` | 0 diff | 完全一致 |
| `GeneticMutation.ts` / `GeneticCrossover.ts` | 0 diff | 完全一致 |
| `DecisionDNACodec.ts` / `DecisionDNATypes.ts` | 0 diff | 完全一致 |
| `GenomePolicy.ts` / `GenomeScorer.ts` | 0 diff | 完全一致 |
| `DecisionFeatureEncoder.ts` | 0 diff | 完全一致 |
| `GameSession.ts` | 0 diff | 完全一致 |

Production コードおよびルール・特徴量ロジックに差分は一切なく、DNA 生成および評価アルゴリズムは不変です。

---

## 6. Double Reconstruction & Behavioral DNA Digests

### 6.1 二重再構築結果
- Reconstruction A: `COMPLETED`, transitions: 1, entries: 6
- Reconstruction B: `COMPLETED`, transitions: 1, entries: 6
- ID Sets Equal: **YES**
- Exact Weights Equal: **YES** (`patternWeights`, `contextPatternWeights` 全 23,452 要素完全一致)
- Logical Result Deep Equal: **YES** (`JSON.stringify(A.logicalResult) === JSON.stringify(B.logicalResult)`)

### 6.2 Canonical Behavioral DNA Digest 表

Digest 対象: `{ dnaFormatVersion, featureSchemaVersion, scoringModel, contextDimension, patternDimension, patternWeights, contextPatternWeights }`（`metadata` 除外、SHA-256）：

| Genome ID | Behavioral DNA Digest (SHA-256) | Non-Zero Total | P / I | 観測重み範囲 [Min, Max] | 平均絶対重み |
|---|---|---|---|---|---|
| `genome-001` (Elite) | `5451a0e0fae1fd3ec443a05eb37e850e93df5339586219c28a39f2beedaee70b` | 0 | 0 / 0 | [0.0000, 0.0000] | 0.0000 |
| `gen-000001-offspring-000000` | `e910fb0179250515c90320a591a99efa79867c3c85144225e70a34317b2cdf0f` | 250 | 1 / 249 | [-0.1542, +0.1475] | 0.0425 |
| `gen-000001-offspring-000001` | `a0810ed39b3bbf9de7b9efb0a5eea030661f9098b970c6d874c483793e026c7b` | 216 | 1 / 215 | [-0.1870, +0.1214] | 0.0380 |
| `gen-000001-offspring-000002` | `c9fc8719869a8062dfba5366e3386bebf09015b23394f47fdf4dd412aba75526` | 240 | 3 / 237 | [-0.1343, +0.1199] | 0.0409 |
| `gen-000001-offspring-000003` | `6de8e5f46c2aa8103c9c8d618a26c89983fe06d00e90c8ac86729fd891393b71` | 244 | 0 / 244 | [-0.1283, +0.1462] | 0.0412 |
| `gen-000001-offspring-000004` | `62ced23c80f14d2e74a2376374871fd6e0147cac55bd7385025404147bb21cb4` | 211 | 3 / 208 | [-0.1142, +0.1405] | 0.0377 |

---

## 7. Historical DNA Count Discrepancy Analysis

| Genome ID | 過去 Incomplete Analysis Doc | V1 JSON Artifact | R1 Canonical Reconstruction | R2 Canonical Reconstruction |
|---|---|---|---|---|
| `gen-000001-offspring-000000` | 238 | **250** | **250** | **250** |
| `gen-000001-offspring-000001` | 241 | **216** | **216** | **216** |
| `gen-000001-offspring-000002` | 236 | **240** | **240** | **240** |
| `gen-000001-offspring-000003` | 241 | **244** | **244** | **244** |
| `gen-000001-offspring-000004` | 234 | **211** | **211** | **211** |

- **比較結果**: V1 JSON, R1, R2 は全個体で **完全一致**。
- **過去 Doc との不一致原因**: **UNRESOLVED**
  - Production コードの Git 差分が 0 であるため、過去 Doc の数値は現在の決定論的再構築と一致しない。過去の生 DNA アーティファクトが存在しないため、転記ミスか別シードによるものかを断定せず、未解決（UNRESOLVED）として記録。
  - 今後は本 R1/R2 の Behavioral DNA Digest を唯一の Canonical Identity として運用する。

---

## 8. g1 Match Reproduction & Decision Categorization

### 8.1 対戦結果の再現
- 全 30 試合実行結果: **2 COMPLETED / 28 INCOMPLETE**（完全再現）
  - 完走試合: Match #28, #29（Pair 14: `gen-000001-offspring-000004` vs `genome-001`）
  - 滞留試合: Match #0 〜 #27（500 decisions 到達）
- 意思決定の一貫性（Selection Consistency）:
  全 14,000 決定において `GenomePolicy.choose` の結果が `GenomeScorer.score` の Argmax（最小 patternRef タイブレーク含む）と **100.00% 一致**。

### 8.2 PASS 選択の内訳（オフスプリング 11,908 決定）

```
オフスプリング PASS 選択総数: 11,908 decisions (99.30%)
├── STRICT_PASS_WIN: 9,923 (83.33%) [score(PASS) > max(score(non-PASS))]
├── FORCED_PASS:     1,985 (16.67%) [non-PASS の合法手が存在しない局面]
└── TIE_BREAK_PASS:      0  (0.00%) [同点タイブレークによる PASS はゼロ]
```

---

## 9. PASS vs Best Non-PASS Score Statistics & Quadrants

### 9.1 スコア統計（9,923 decisions）
- $\text{score}(\text{PASS})$: 平均 $+0.8082$（最小 $0.0000$, 最大 $+5.7171$）
- $\text{score}(\text{bestNonPass})$: 平均 $-0.7927$（最小 $-10.7727$, 最大 $+0.0884$）
- $\Delta(\text{PASS} - \text{bestNonPass})$: 平均 $+1.6008$（最小 $+0.0170$, 最大 $+16.4898$）

### 9.2 スコア符号象限（Score-Sign Quadrants）
- `PASS_POS_ALT_NONPOS` ($\text{PASS} > 0, \text{ALT} \le 0$): 1,255 決定 (12.65%)
- `PASS_NONPOS_ALT_NEG` ($\text{PASS} \le 0, \text{ALT} < 0$): 7,432 決定 (74.90%)
- `BOTH_POS` ($\text{PASS} > 0, \text{ALT} > 0$): 1,236 決定 (12.46%)
- `BOTH_NEG` / `OTHER`: 0 決定 (0.00%)

---

## 10. PASS vs Action End Score Statistics & Quadrants

### 10.1 `action.end` 合法局面でのスコア統計
- `action.end` 合法決定数: 6,846
  - $\text{PASS} > \text{End}$: 6,839 (99.90%)
  - $\text{PASS} == \text{End}$: 0 (0.00%)
  - $\text{PASS} < \text{End}$: 7 (0.10%, オフスプリングが PASS 以外を選択した局面)
- PASS 選択時（6,821 decisions）:
  - $\text{score}(\text{PASS})$: 平均 $+0.9187$（最小 $0.0000$, 最大 $+5.0818$）
  - $\text{score}(\text{action.end})$: 平均 $-0.5299$（最小 $-2.3149$, 最大 $+0.0884$）
  - $\Delta(\text{PASS} - \text{End})$: 平均 $+1.4486$（最小 $+0.0902$, 最大 $+4.9935$）

### 10.2 スコア符号象限
- `PASS_POS_ALT_NONPOS`: 494 (7.24%)
- `PASS_NONPOS_ALT_NEG`: 5,091 (74.64%)
- `BOTH_POS`: 1,236 (18.12%)
- `BOTH_NEG` / `OTHER`: 0 (0.00%)

---

## 11. Mathematical Mechanism Decomposition & Conservation Laws

### 11.1 数学的等式と保存則の検証
各決定局面において、全遺伝子寄与度 $\Delta(g) = \text{term}_{\text{PASS}} - \text{term}_{\text{ALT}}$ に対し：
$$\Delta(g) \equiv \max(\text{term}_{\text{PASS}}, 0) + \max(-\text{term}_{\text{ALT}}, 0) - \max(-\text{term}_{\text{PASS}}, 0) - \max(\text{term}_{\text{ALT}}, 0)$$
$$\sum_g \Delta(g) \equiv \text{score}(\text{PASS}) - \text{score}(\text{ALT})$$
- 全 9,923 決定で等式誤差 $< 10^{-12}$ を確認。
- 保存則最大誤差: $5.329 \times 10^{-15} \ll 10^{-6}$。
- 全決定・全遺伝子差分寄与度を完全集約（Top-K 切り捨て集約なし）。

---

## 12. Continuous Magnitude Masses (Suppression vs Uplift)

| メカニズム要素 | 定義 | 累積質量 | 構成比 |
|---|---|---|---|
| **Positive Non-PASS Suppression Mass** | $\sum \max(-\text{term}_{\text{ALT}}, 0)$ | **$14,492.97$** | **$64.38\%$** |
| **Positive PASS Uplift Mass** | $\sum \max(\text{term}_{\text{PASS}}, 0)$ | **$8,019.50$** | **$35.62\%$** |
| **Total Positive Margin Mass (分母)** | $\text{SuppressionMass} + \text{UpliftMass}$ | **$22,512.47$** | **$100.00\%$** |
| Counteracting Alternative Uplift Mass | $\sum \max(\text{term}_{\text{ALT}}, 0)$ | $6,727.55$ | (相殺項) |
| Counteracting PASS Penalty Mass | $\sum \max(-\text{term}_{\text{PASS}}, 0)$ | $0.00$ | (相殺項) |

> [!IMPORTANT]
> スコアマージンの約 3 分の 2（64.38%）は「他手への減点ペナルティ（Suppression）」によって生じており、残り 3 分の 1（35.62%）が「PASS への加点（Uplift）」によるものです。AI は PASS を好んだのではなく、他アクションに課された巨大な負ペナルティを回避した結果 PASS に滞留しました。

---

## 13. Per-Genome Contributor Rankings (Authoritative Top-10)

R2 において完全修復されたカノニカル JSON アーティファクトに基づく各個体の Authoritative Top-3 遺伝子：

### `gen-000001-offspring-000000`
1. `I[16,1]` (`legal_action_timing_quick_count` $\times$ `pattern_is_pass`): 重み $+0.0454$, 累積 $\Delta = +8,019.50$, 最大 $\Delta = +5.72$, 決定数 2,491
2. `I[16,34]` (`legal_action_timing_quick_count` $\times$ `cost_total_item_count`): 重み $-0.0827$, 累積 $\Delta = +3,195.19$, 最大 $\Delta = +10.42$, 決定数 761
3. `I[33,9]` (`self_hand_value_max` $\times$ `action_timing_quick`): 重み $-0.0177$, 累積 $\Delta = +170.99$, 最大 $\Delta = +0.23$, 決定数 761

### `gen-000001-offspring-000001`
1. `I[12,29]` (`legal_non_pass_pattern_count` $\times$ `has_cost`): 重み $-0.0585$, 累積 $\Delta = +1,989.23$, 最大 $\Delta = +8.02$, 決定数 2,002
2. `I[12,65]` (`legal_non_pass_pattern_count` $\times$ `target_unit_face_up`): 重み $-0.0538$, 累積 $\Delta = +601.52$, 最大 $\Delta = +1.29$, 決定数 487
3. `P[62]` (`target_unit_size`): 重み $-0.0587$, 累積 $\Delta = +299.00$, 最大 $\Delta = +0.65$, 決定数 487

### `gen-000001-offspring-000002`
1. `I[32,4]` (`self_hand_value_sum` $\times$ `has_action`): 重み $-0.0385$, 累積 $\Delta = +1,571.77$, 最大 $\Delta = +2.58$, 決定数 1,506
2. `I[94,5]` (`relative_grave_count` $\times$ `action_speed_normal`): 重み $-0.1343$, 累積 $\Delta = +188.02$, 最大 $\Delta = +0.13$, 決定数 1,400
3. `I[0,58]` (`source_is_action_request` $\times$ `target_is_none`): 重み $-0.0873$, 累積 $\Delta = +122.19$, 最大 $\Delta = +0.09$, 決定数 1,400

### `gen-000001-offspring-000003`
1. `I[62,29]` (`self_rare_can_view_cards` $\times$ `has_cost`): 重み $-0.0453$, 累積 $\Delta = +113.25$, 最大 $\Delta = +0.05$, 決定数 2,500
2. `I[54,39]` (`self_grave_top_card_value` $\times$ `key_card_value_max`): 重み $-0.0254$, 累積 $\Delta = +87.33$, 最大 $\Delta = +0.28$, 決定数 313
3. `I[47,23]` (`self_fog_card_known_count` $\times$ `candidate_action_bucket_10`): 重み $-0.0129$, 累積 $\Delta = +64.50$, 最大 $\Delta = +0.03$, 決定数 2,500

### `gen-000001-offspring-000004`
1. `I[16,38]` (`legal_action_timing_quick_count` $\times$ `key_card_value_sum`): 重み $-0.0081$, 累積 $\Delta = +3,136.90$, 最大 $\Delta = +4.54$, 決定数 2,033
2. `I[54,22]` (`self_grave_top_card_value` $\times$ `candidate_action_bucket_9`): 重み $-0.0432$, 累積 $\Delta = +281.79$, 最大 $\Delta = +0.22$, 決定数 1,273
3. `I[94,38]` (`relative_grave_count` $\times$ `key_card_value_sum`): 重み $-0.0898$, 累積 $\Delta = +182.68$, 最大 $\Delta = +0.18$, 決定数 2,033

---

## 14. Cross-Genome Coordinate Aggregates

| 遺伝子座標 | 該当特徴量積 | 保整个体 | 個体別重み | 重み範囲 [Min, Max] | 累積 $\Delta$ | カバレッジ | 最大単一 $\Delta$ |
|---|---|---|---|---|---|---|---|
| `I[16,1]` | `quick_count` $\times$ `pattern_is_pass` | `offspring-000000` | `{ off0: +0.0454 }` | [+0.0454, +0.0454] | $+8,019.50$ | 2,491 | $+5.72$ |
| `I[16,34]` | `quick_count` $\times$ `cost_total_item_count` | `offspring-000000` | `{ off0: -0.0827 }` | [-0.0827, -0.0827] | $+3,195.19$ | 761 | $+10.42$ |
| `I[16,38]` | `quick_count` $\times$ `key_card_value_sum` | `offspring-000004` | `{ off4: -0.0081 }` | [-0.0081, -0.0081] | $+3,136.90$ | 2,033 | $+4.54$ |
| `I[12,29]` | `non_pass_count` $\times$ `has_cost` | `offspring-000001` | `{ off1: -0.0585 }` | [-0.0585, -0.0585] | $+1,989.23$ | 2,002 | $+8.02$ |
| `I[32,4]` | `hand_value_sum` $\times$ `has_action` | `offspring-000002` | `{ off2: -0.0385 }` | [-0.0385, -0.0385] | $+1,571.77$ | 1,506 | $+2.58$ |

---

## 15. Feature Scale Analysis & Amplification Mechanisms

相互作用項 $M_{i,j} \cdot c_i \cdot p_j$ における増幅係数：
- **Context Multiplier**: $|c_i|$
- **Pattern Multiplier**: $|p_j|$
- **Combined Multiplier**: $|c_i \cdot p_j|$

| 特徴量名 (Context Index) | 観測最小値 | 観測平均値 | 観測最大値 | 該当主要重み | Combined Multiplier | 観測単一スコア寄与 |
|---|---|---|---|---|---|---|
| `legal_action_timing_quick_count` (16) | 0 | 24.14 | **126** | $+0.0454$ / $-0.0827$ | **126倍** | **$+5.72$** / **$-10.42$** |
| `legal_non_pass_pattern_count` (12) | 0 | 28.91 | **137** | $-0.0585$ | **137倍** | **$-8.02$** |
| `self_hand_value_sum` (32) | 0 | 33.95 | **82** | $-0.0385$ | **82倍** | **$-2.58$** |
| `turn_count` (6) | 1 | 1.30 | 7 | 各種 | 最大 7倍 | 比較的小 |
| `self_life_count` (19) | 1 | 4.72 | 6 | 各種 | 最大 6倍 | 比較的小 |
| `self_hand_count` (20) | 0 | 4.31 | 9 | 各種 | 最大 9倍 | 比較的小 |
| `stage_depth` (7) | 0 | 0.07 | 6 | 各種 | 最大 6倍 | 比較的小 |

未正規化の生整数カウント特徴量（`quick_count`, `non_pass_count`, `hand_value_sum`）が $70 \sim 137$ に達し、$-0.08$ 程度の微小変異を $-10.0$ 超の壊滅的なペナルティに増幅させていました。

---

## 16. Positive Control Analysis: Pair 14 (Offspring 4 vs Elite)

Match #28 & #29（`gen-000001-offspring-000004` vs `genome-001`）の完走要因検証：
- **Leg 0 (#28)**: 62 decisions, Turn 7, PASS 41, END 6, Action 15 (Attack 3, Twist 2, Down 2, Up 1, Counter 1)
- **Leg 1 (#29)**: 62 decisions, Turn 7, PASS 42, END 6, Action 15 (Attack 3, Twist 1, Counter 1, Up 1, DestroyBulwark 1, Down 2, End 6)
- **主要問題遺伝子の実際の保有重み**:
  - `I[16,1]` (`quick_count` $\times$ `pattern_is_pass`): **`0.0000`**
  - `I[16,34]` (`quick_count` $\times$ `cost_total_item_count`): **`0.0000`**
  - `I[32,4]` (`hand_value_sum` $\times$ `has_action`): **`0.0000`**
  - `I[32,3]` (`hand_value_sum` $\times$ `action_category_action`): **`0.0000`**
  - `I[16,3]` (`quick_count` $\times$ `action_category_action`): **`0.0000`**

`gen-000001-offspring-000004` は PASS 加点遺伝子および主要アクション減点遺伝子を持たず重み 0.0000 であったため、Main Phase において `action.end` や `action.attack` のスコアが PASS を上回り、正常にターンが進行して完走しました。

---

## 17. Counterfactual Local Decision Ablation

各個体の滞留局面（PASS を選び非 PASS 合法手が存在した手）において、Top 遺伝子を反実仮想的に 0 化：

| 個体 ID | 滞留決定数 | Top-1 反転数 (率) | Top-3 反転数 (率) | Top-5 反転数 (率) | Top-3 反転先アクション内訳 |
|---|---|---|---|---|---|
| `gen-000001-offspring-000000` | 249 | 247 (99.20%) | 247 (99.20%) | 249 (100.0%) | `action.setBulwark`: 247 |
| `gen-000001-offspring-000001` | 244 | 4 (1.64%) | 4 (1.64%) | 4 (1.64%) | `action.end`: 4 |
| `gen-000001-offspring-000002` | 235 | 2 (0.85%) | 235 (100.0%) | 235 (100.0%) | `action.end`: 233, `action.twist`: 2 |
| `gen-000001-offspring-000003` | 248 | 0 (0.00%) | 246 (99.19%) | 248 (100.0%) | `action.attack`: 242, `action.twist`: 4 |

---

## 18. Dynamic Trajectory Replay Ablation

Top-K 遺伝子を 0 化した DNA でカノニカル対戦（vs `genome-001`, `maxDecisions = 500` 固定）を最初から再実行：

| 個体 ID | ベースライン | Top-1 ゼロ化 | Top-3 ゼロ化 | Top-5 ゼロ化 |
|---|---|---|---|---|
| `gen-000001-offspring-000000` (Match #8) | INCOMPLETE (500d, T1, 100% P) | **COMPLETED** (45d, T3, 勝者p1) | **COMPLETED** (54d, T3, 勝者p1) | **COMPLETED** (46d, T3, 勝者p2) |
| `gen-000001-offspring-000001` (Match #16) | INCOMPLETE (500d, T1, 98.4% P) | INCOMPLETE (500d, T1, 98.4% P) | INCOMPLETE (500d, T1, 98.4% P) | INCOMPLETE (500d, T1, 98.4% P) |
| `gen-000001-offspring-000002` (Match #22) | INCOMPLETE (500d, T2, 98.4% P) | INCOMPLETE (500d, T2, 98.4% P) | **COMPLETED** (72d, T6, 勝者p2) | **COMPLETED** (72d, T6, 勝者p2) |
| `gen-000001-offspring-000003` (Match #26) | INCOMPLETE (500d, T1, 99.2% P) | INCOMPLETE (500d, T1, 99.2% P) | **COMPLETED** (29d, T1, 勝者p1) | INCOMPLETE (500d, T1, 98.0% P) |

### 因果エビデンスの適用範囲（Scoped Language）
- `offspring-000000` は Top-1（`I[16,1]`）ゼロ化のみで 45 decisions で完走。
- `offspring-000002` は Top-3 ゼロ化により Turn 6 まで進み 72 decisions で完走。
- `offspring-000003` は Top-3 ゼロ化により 29 decisions で電撃決着（Player B ライフ 0）。
- `offspring-000001` は Top-5 ゼロ化でも依然として Turn 1 に滞留（別の低順位変異または複合要因による）。
- **スコープ限定**: 本アブレーションは「該当ゲノム・該当シード・該当対戦における特定遺伝子の局所的因果寄与」を証明するものであり、「進化ループ全体の完走が保証された」あるいは「全個体の滞留が完全に解決された」と一般化することはできません。

---

## 19. Root Cause Classification & Explicit Non-Claims

### 19.1 根本原因の分類
- **Primary Root Cause**:
  1. **`FEATURE_SCALE_AMPLIFICATION`**: 未正規化 Context Feature（`legal_action_timing_quick_count` 等）の巨大なスケール（最大 137）が変異重みを極端に増幅したこと。
  2. **`MUTATION_NONPASS_SUPPRESSION`**: コストやアクション属性に対する負の変異重みが蓄積し、非 PASS 合法手全体に $-10.0$ 超のペナルティが課されたこと（全マージン質量の 64.38%）。
- **Secondary Root Cause**:
  - **`MUTATION_PASS_UPLIFT`**: `pattern_is_pass` と quick count の積による正の加点変異（全マージン質量の 35.62%）。
- **Exclusion**:
  - `TIE_BREAK_DRIVEN_PASS`: **完全否定**（タイブレーク PASS は 0 件）。

### 19.2 明示的不主張（Explicit Non-Claims）
1. **Core Flow の正当性証明**: 本分析から「Core Flow は完全であり修正不要である」とは主張しません。Turn Player が空ステージで PASS 可能であるべきかどうかのルール設計は、別ブランチ・別会話での検討事項です。
2. **ルール変更の不要論**: DNA スコア構造に滞留要因が存在することが示されたからといって、ルール側の見直しが不要になったわけではありません。
3. **突然変異率（1%）の欠陥証明**: 突然変異率 1% や $\sigma = 0.05$ の設定自体が根本原因であるとは断定しません。
4. **正規化による完全解決の事前保証**: 特徴量正規化（Normalization）を導入すれば進化ループが必ず収束・完走するとは断定しません。次工程の設計・検証対象です。
5. **Evolution Loop 完走の証明**: 本タスクは要因分析のみであり、Controlled Multi-Generation の再挑戦・完走は証明していません。

---

## 20. Full Simulator Regression Baseline & Verification Conclusion

### 20.1 全面回帰検証実績
- **TypeScript Typecheck**: PASS (`npx tsc --noEmit`, exit code 0)
- **Evolution Loop Canonical Suite**: PASS (`48 tests passed`, 317ms)
- **Architecture Boundary Suite**: PASS (`5 tests passed`, 2,882ms)
- **Playable Check**: SUCCESS (`GameSession` 1 試合完走、エラー 0)
- **Production Vite Build**: SUCCESS (`built in 27.84s`, dist クリーン済み)
- **Full Simulator Test Suite**:
  ```
  Test Files  201 passed (201)
  Tests       2753 passed (2753)
  Duration    204.81s
  ```

### 20.2 結論
本分析作業 `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R2` において、V1-R1 のカノニカル JSON アーティファクト欠陥（`perGenomeContributors` 空配列問題）を完全修復し、全オフスプリングの Authoritative Contributor リストを確立しました。また、数学的保存則、二重再構築、連続質量分析、未正規化特徴量増幅、および反実仮想アブレーションの全エビデンスを決定論的に再実証しました。

**READY FOR INDEPENDENT REVIEW**
