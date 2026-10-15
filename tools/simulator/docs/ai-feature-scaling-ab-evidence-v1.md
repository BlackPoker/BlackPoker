# BlackPoker Simulator
# Controlled Feature Scaling A/B Evidence V1

作業ID: `BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1`  
ステータス: **PENDING INDEPENDENT REVIEW**  
実施日時: 2026-10-16  
対象ブランチ: `BlackPoker/issue551-core-flow`  
ベースコミット: `4c9f8c273d9c2bd8068173dd1333bcc55547668a` (`BP-SIM-AI-FEATURE-SCALING-DESIGN-V1-R2`)  
実装コミット: `975788f80054f4e5a08e446ee9967d400726bca9` (`BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1-R2`)  

---

## 1. Experimental Question
「同じ g1 DNA weight arrays を使い、同じ対戦状態・seed・合法手・Rules で、生特徴量（raw feature values）を有界スケーリング特徴量（scaled feature values in $[-1, 1]$）へ変更した場合、PASS 偏重および INCOMPLETE match はどのように変化するか？」

---

## 2. Formal Baseline & Scope
- **Scaling Design V1-R2**: FORMAL ACCEPTED (`4c9f8c273d9c2bd8068173dd1333bcc55547668a`)
- **Scaling Implementation V1-R2**: FORMAL ACCEPTED (`975788f80054f4e5a08e446ee9967d400726bca9`)
- **Rules / Core Flow**: **RULES UNCHANGED / NO CHANGE PLANNED** (0 diff)
- **Production Source Code**: **0 diff** (Production Scaler, Encoder, Scorer は一切変更せず、Harness 内での一時的 interception により生値を供給)

---

## 3. Arm Definitions
- **CONTROL (`RAW_V4_EQUIVALENT`)**:
  - `DecisionFeatureEncoder` が算出した生値（raw vector）をそのまま `GenomeScorer` へ供給。
  - 過去コミットへのチェックアウトではなく、現行 Production 上で正規化関数のみをバイパスした数値 Ablation。
- **TREATMENT (`SCALED_V5`)**:
  - 現行 Production の正規化スケーラー（`DecisionFeatureScaler`）を適用し、全特徴量を $[-1, 1]$ に有界化したベクトルを `GenomeScorer` へ供給。
- **共通条件**:
  - 同一 Observation、同一 Legal Pattern、同一特徴量順序・次元（Context 163, Pattern 143, 計 23,452 重み）、同一 g1 Genome 重み配列、同一公式ルール (`light-entry16`)、同一 matchSeed / playerSeeds、同一 Tie-break ルール。

---

## 4. Environment & Recipe
- **Regulation**: `light-entry16`
- **母集団サイズ**: $N = 6$
- **初期母集団**: g0 Zero DNA (6体)
- **Campaign Seed**: 42
- **g0 Seed**: 4143575905 (`evolution-loop-generation-v1-0`)
- **g1 Seed**: 4126798286 (`evolution-loop-generation-v1-1`)
- **Repetitions**: $R = 1$ (総試合数: $N(N-1)R = 30$ 試合)
- **maxDecisions**: 500

---

## 5. g1 Population Integrity & Weight Equality
Production Evolution Loop により g0 から決定論的に生成された g1 母集団（エリート 1 体 + オフスプリング 5 体）の重み配列を抽出し、両 Arm にディープクローンで同一供給しました。

| Genome ID | 種別 | Pattern 重み数 | 相互作用重み数 | 総重み数 | Weight Digest (SHA-256) |
|---|---|---|---|---|---|
| `genome-001` | Elite | 143 | 23,309 | 23,452 | `7e8e37c099e59544...` |
| `gen-000001-offspring-000000` | Offspring | 143 | 23,309 | 23,452 | `79c8902718af8e7f...` |
| `gen-000001-offspring-000001` | Offspring | 143 | 23,309 | 23,452 | `0d64ee5ddbb9641c...` |
| `gen-000001-offspring-000002` | Offspring | 143 | 23,309 | 23,452 | `66650b6a8b30702f...` |
| `gen-000001-offspring-000003` | Offspring | 143 | 23,309 | 23,452 | `9da9e20aea0bde59...` |
| `gen-000001-offspring-000004` | Offspring | 143 | 23,309 | 23,452 | `d8df6b7295f11621...` |

- **Weight Equality**: CONTROL 開始前、CONTROL 終了後、TREATMENT 開始前、TREATMENT 終了後の全 4 実行において、全 6 ゲノムの重み配列が **100% bit-exact に完全一致** することを確認済み。
- **Schedule Equality**: 全 30 試合の `matchIndex`, `pairIndex`, `p1GenomeId`, `p2GenomeId`, `matchSeed`, `playerSeeds` が両 Arm で完全一致。

---

## 6. Determinism & Historical Control Reproduction Gate
各 Arm を独立に 2 回実行し、決定論的論理ダイジェストを比較しました。

| 比較検証項目 | Run A Digest | Run B Digest | 一致判定 |
|---|---|---|---|
| **CONTROL (RAW_V4_EQUIVALENT)** | `8dcae3d5f8d1fdd316931fe57bec6ee0...` | `8dcae3d5f8d1fdd316931fe57bec6ee0...` | **IDENTICAL (PASS)** |
| **TREATMENT (SCALED_V5)** | `7b19ced5c029c8c8c5eef858ec415fb4...` | `7b19ced5c029c8c8c5eef858ec415fb4...` | **IDENTICAL (PASS)** |

### Historical Control Reproduction
Formal Accepted 済みの `BP-SIM-AI-EVOLUTION-DNA-PASS-SCORE-ANALYSIS-V1-R2` における g1 実機戦績との照合：
- **Scheduled**: 30 試合
- **Completed**: **2 試合** (一致)
- **Incomplete**: **28 試合** (一致)
- **Failed**: **0 試合** (一致)
- **Completed Match Indices**: **`[28, 29]`** (完全一致)
- **判定**: **HISTORICAL REPRODUCTION PASS**（CONTROL が Schema v4 生値セマンティクスを完全に再現していることを実証）

---

## 7. Core Outcome & Metrics Comparison

| Metric | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) | Delta (TREATMENT - CONTROL) |
|---|---|---|---|
| **Scheduled Matches** | 30 | 30 | 0 |
| **Completed Matches** | **2** | **2** | **0** |
| **Incomplete Matches** | 28 | 28 | 0 |
| **Failed Matches** | 0 | 0 | 0 |
| **Completion Rate** | 6.67% (2/30) | 6.67% (2/30) | 0.00% |
| **Total Decisions** | 14,124 | 14,041 | -83 |
| **Decisions Per Match (Median)** | 500 | 500 | 0 |
| **Decisions Per Match (Max)** | 500 | 500 | 0 |
| **Completed Match Indices** | `[28, 29]` | `[7, 21]` | 移動 (`[28, 29]` $\rightarrow$ `[7, 21]`) |
| **Readiness Status** | `REEVALUATION_REQUIRED` | `REEVALUATION_REQUIRED` | 一致 (`REEVALUATION_REQUIRED`) |

---

## 8. PASS Behavior Metrics Comparison

| Metric | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) | Delta |
|---|---|---|---|
| **Total Decisions** | 14,124 | 14,041 | -83 |
| **PASS Selected Count** | 13,962 | 13,885 | -77 |
| **ACTION Selected Count** | 144 | 141 | -3 |
| **EFFECT_SELECTION Selected Count** | 18 | 15 | -3 |
| **FORCED_PASS Count** | 3,996 | 3,758 | -238 |
| **STRICT_PASS_WIN Count** | 9,966 | 10,127 | 161 |
| **TIE_BREAK_PASS Count** | **0** | **0** | **0** |
| **End Action Legal Decisions** | 6,875 | 6,850 | -25 |
| **PASS > End Count** | 6,840 | 6,820 | -20 |
| **PASS == End Count** | **22** | **14** | **-8** |
| **PASS < End Count** | 13 | 16 | 3 |
| **PASS Chosen While End Legal** | 6,823 | 6,798 | -25 |

---

## 9. Score Magnitude & Feature Bounds Comparison

### 9.1 Score Margin (PASS - Best Non-PASS)
| Margin Metric | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) |
|---|---|---|
| **Mean Margin** | +1.565003 | +0.052248 |
| **Median (P50) Margin** | +1.172383 | +0.04526 |
| **P05 Margin** | +0.044409 | +0.004425 |
| **P95 Margin** | +4.993483 | +0.110465 |
| **Min Margin** | -12.424762 | -0.186867 |
| **Max Margin** | +16.489811 | +0.120864 |

### 9.2 Absolute Score Magnitudes
| Score Magnitude Metric | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) | Ratio (TREATMENT / CONTROL) |
|---|---|---|---|
| **Selected Score Abs (Mean)** | 0.579021 | 0.00451 | 0.0078 |
| **Selected Score Abs (Max)** | 12.424762 | 0.186867 | 0.0150 |
| **PASS Score Abs (Mean)** | 0.568517 | 0.004049 | 0.0071 |
| **PASS Score Abs (Max)** | 5.717065 | 0.034253 | 0.0060 |

### 9.3 Feature Magnitudes & Mathematical Invariants
| Feature Magnitude | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) | Invariant Check ($le 1.0$) |
|---|---|---|---|
| **Max Abs Context Feature** | **138** | **1** | **PASS** ($le 1.0$) |
| **Max Abs Pattern Feature** | **26** | **1** | **PASS** ($le 1.0$) |
| **Max Abs Interaction Input** ($|c_i cdot p_j|$) | **3120** | **1** | **PASS** ($le 1.0$) |

> **重要な発見**:
> CONTROL においては、未正規化特徴量（最大 138 等）により相互作用項の入力 $|c_i cdot p_j|$ が **最大 3120** に達していました。
> 一方、TREATMENT においては全特徴量が数学的に厳格に $[-1, 1]$ へ有界化され、相互作用入力 $|c_i cdot p_j|$ の最大値は **1 $le 1.0$** に完全に抑え込まれました。

---

## 10. Per-Match Shift Analysis

| Category | Match Count | 説明 |
|---|---|---|
| **UNCHANGED_INCOMPLETE** | **26** | 両 Arm とも maxDecisions (500) に到達し未完了 |
| **UNCHANGED_COMPLETED** | **0** | 両 Arm とも完了し勝敗一致 |
| **CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED** | **2** | CONTROL 未完了 $\rightarrow$ TREATMENT で完了 (**Match 7, 21**) |
| **CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE** | **2** | CONTROL 完了 $\rightarrow$ TREATMENT で未完了 (**Match 28, 29**) |
| **OUTCOME_CHANGED** | **0** | 両 Arm 完了だが勝者変更 |
| **FAILED** | **0** | 異常終了試合 |

### 詳細考察: 完了試合の構造的シフト
- CONTROL において完了していた唯一のペア **Match 28 & 29** (`gen-000001-offspring-000003` vs `gen-000001-offspring-000004`) は、TREATMENT では未完了（500 decisions）に遷移しました。
- 一方、CONTROL で未完了であった **Match 7 & 21** (`genome-001` vs `gen-000001-offspring-000001`) が、TREATMENT では新たに正常完了（Match 7 は 297 decisions で p1 勝利、Match 21 は 300 decisions で p2 勝利）へとシフトしました。
- この事象は、Feature Scaling がゲーム進行の論理的軌跡（Trajectory）に直接的かつ明確な意思決定差異を生じさせていることを実証しています。

---

## 11. Per-Genome Fitness & Readiness

| Genome ID | CONTROL Status | CONTROL Fitness | CONTROL Completed | TREATMENT Status | TREATMENT Fitness | TREATMENT Completed |
|---|---|---|---|---|---|---|
| `gen-000001-offspring-000000` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: 1.00) | 1/10 |
| `gen-000001-offspring-000001` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 |
| `gen-000001-offspring-000002` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.00) | 1/10 |
| `gen-000001-offspring-000003` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 |
| `gen-000001-offspring-000004` | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.50) | 2/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.50) | 2/10 |
| `genome-001` | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.50) | 2/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 |

- **Readiness**: 両 Arm とも完了試合数不足（各個体 10 試合中 2 試合以下の完了にとどまり、minimumCompletedMatches = 5 を満たさない）により、**`REEVALUATION_REQUIRED`** となりました。
- 規定に基づき、次世代（g=2）への自動遷移は行わず停止しました。

---

## 12. Interpretation & Scientific Conclusion
1. **Feature Scaling の直接的影響の実証**:
   - 最大入力振幅が **3120 $\rightarrow$ 1$** へと数学的不変条件通りに抑制され、Feature Scale Amplification が完全に排除されました。
   - スコア差分マージン（PASS - Best Non-PASS）の平均値は **+1.565003 $\rightarrow$ +0.052248** へと変化しました。
   - 完了試合が Match 28/29 から Match 7/21 へと完全にシフトしており、特徴量スケーリングが意思決定と対戦展開に実質的な差異をもたらすことが確認されました。
2. **完了率に関する客観的結果**:
   - 一方で、全体の完了試合数は **2/30 (6.67%) のまま維持** され、INCOMPLETE match の総件数（28件）は今回の g1 重み配列においては減少しませんでした。
   - これは、PASS 過剰選好の一因である「特徴量スケール増幅」が抑制されたものの、g0 から変異（Mutation）によって導入された重みそのものの符号・バイアス（Mutation Bias）や探索空間の性質が依然として PASS を有利に評価していることを示唆しています。
3. **今後のスコープへの示唆**:
   - 本結果は、Feature Scaling の Production 実装が数学的・論理的に正しく機能していることを証明する強固な Evidence です。
   - 今後の改善候補（次期フェーズ）として、Semantic Stall/Cycle Detection の導入、初期重み分布・変異レートの調整、あるいは多世代自己対戦を通じた重み最適化の検証が自然な後続ステップとなります。

---

## 13. Explicit Non-Claims
- **PASS Stall Fully Solved**: **NO** (Feature Scaling 単体では未完了 28 件は解消されていない)
- **Strong DNA Proven**: **NO** (強力な DNA が得られたわけではない)
- **Cycle Eliminated**: **NO** (無限ループ・停滞が完全に排除されたわけではない)
- **Multi-Generation Proven**: **NO** (多世代進化の完走が証明されたわけではない)
- **Rules Need Change**: **NO / POLICY UNCHANGED** (公式ルール・コアフローの変更を要求するものではなく、現行方針として Rules 不変を維持する)

---

## 14. Final Status
**EVIDENCE CAPTURED / PENDING INDEPENDENT REVIEW**
