# BlackPoker Simulator
# Controlled Feature Scaling A/B Evidence V1-R1

作業ID: `BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1`<br />
ステータス: **PENDING INDEPENDENT REVIEW**<br />
実施日時: 2026-10-16<br />
対象ブランチ: `BlackPoker/issue551-core-flow`<br />
ベースコミット (Design V1-R2): `4c9f8c273d9c2bd8068173dd1333bcc55547668a`<br />
実装コミット (Implementation V1-R2): `975788f80054f4e5a08e446ee9967d400726bca9`

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
- **Regulation**: `light-entry16` (`entry16`, version `1.0.0`)
- **母集団サイズ**: $N = 6$
- **初期母集団**: g0 Zero DNA (6体)
- **Campaign Seed**: 42
- **g0 Seed**: 4143575905 (`evolution-loop-generation-v1-0`)
- **g1 Seed**: 4126798286 (`evolution-loop-generation-v1-1`)
- **Repetitions**: $R = 1$ (総試合数: 30 試合)
- **maxDecisions**: 500

---

## 5. Weight Integrity Gate
Production Evolution Loop により g0 から決定論的に生成された g1 母集団（エリート 1 体 + オフスプリング 5 体）の重み配列を抽出し、Baseline Weight Snapshot を作成しました。
全 9 つのチェックポイント（BASELINE, CONTROL-A PRE/POST, CONTROL-B PRE/POST, TREATMENT-A PRE/POST, TREATMENT-B PRE/POST）において、Baseline Snapshot との全要素厳密一致（`===` 判定）および Weight Digest 再計算による一致を検証しました。

| Genome ID | 種別 | Pattern 重み数 | 相互作用重み数 | 総重み数 | Baseline Weight Digest (SHA-256) |
|---|---|---|---|---|---|
| `genome-001` | Elite | 143 | 23,309 | 23,452 | `7e8e37c099e59544...` |
| `gen-000001-offspring-000000` | Offspring | 143 | 23,309 | 23,452 | `79c8902718af8e7f...` |
| `gen-000001-offspring-000001` | Offspring | 143 | 23,309 | 23,452 | `0d64ee5ddbb9641c...` |
| `gen-000001-offspring-000002` | Offspring | 143 | 23,309 | 23,452 | `66650b6a8b30702f...` |
| `gen-000001-offspring-000003` | Offspring | 143 | 23,309 | 23,452 | `9da9e20aea0bde59...` |
| `gen-000001-offspring-000004` | Offspring | 143 | 23,309 | 23,452 | `d8df6b7295f11621...` |

- **Array Exact Equality (`===`)**: **PASSED** (全ゲノム・全要素で厳密一致)
- **Digest Equality**: **PASSED** (全 9 チェックポイントで同一)
- **Schedule Equality**: **PASSED** (全 30 試合の matchSeed / playerSeeds 完全一致)

---

## 6. Scaler Restore Gate & Determinism Check

### 6.1 Scaler Restore Gate
Harness 開始時に取得した Canonical Original Reference との参照一致（`===`）を各 Arm 実行前後に検証しました。

| Checkpoint | scaleContext Reference 一致 | scalePattern Reference 一致 | 判定 |
|---|---|---|---|
| **CONTROL-A Post** | 一致 | 一致 | **PASS** |
| **CONTROL-B Post** | 一致 | 一致 | **PASS** |
| **TREATMENT-A Post** | 一致 | 一致 | **PASS** |
| **TREATMENT-B Post** | 一致 | 一致 | **PASS** |

- **Scaler Exact Reference Gate**: **PASSED**

### 6.2 Determinism Check
| 実験群 | Run A Digest | Run B Digest | 一致判定 |
|---|---|---|---|
| **CONTROL (`RAW_V4_EQUIVALENT`)** | `a0bf2814a43f98d6dc0ddce99050a4a7...` | `a0bf2814a43f98d6dc0ddce99050a4a7...` | **IDENTICAL (PASS)** |
| **TREATMENT (`SCALED_V5`)** | `b4147023275e63e6742761a2bb92660c...` | `b4147023275e63e6742761a2bb92660c...` | **IDENTICAL (PASS)** |

---

## 7. Historical Outcome Signature Reproduction
Formal Accepted 済みの `BP-SIM-AI-EVOLUTION-DNA-PASS-SCORE-ANALYSIS-V1-R2` における g1 実機戦績との照合：

| 照合項目 | Expected (Historical Signature) | Actual (CONTROL Run) | 一致判定 |
|---|---|---|---|
| **Scheduled Matches** | 30 | 30 | 一致 |
| **Completed Matches** | **2** | **2** | **一致** |
| **Incomplete Matches** | 28 | 28 | 一致 |
| **Failed Matches** | 0 | 0 | 一致 |
| **Completed Match Indices** | **[28, 29]** | **[28, 29]** | **完全一致** |

- **Historical Outcome Signature Reproduction**: **PASS**
- **注記**: 本検証が証明するのは上記の対戦結果シグネチャの一致であり、historical runtime 全体の bit-perfect なリプレイを意味・主張するものではありません（`RAW_V4_EQUIVALENT` は現行 Production 上での生値数値アブレーションです）。

---

## 8. Core Outcome & Metrics Comparison

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
| **Completed Match Indices** | **[28, 29]** | **[7, 21]** | **移動 ([28, 29] $\rightarrow$ [7, 21])** |
| **Readiness Status** | `REEVALUATION_REQUIRED` | `REEVALUATION_REQUIRED` | 一致 (`REEVALUATION_REQUIRED`) |

---

## 9. PASS 行動メトリクス比較

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

## 10. スコア振幅 & 特徴量数学的不変条件検証

### 10.1 スコア差分マージン (PASS - Best Non-PASS)
| Margin Metric | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) |
|---|---|---|
| **Mean Margin** | +1.565003 | +0.052248 |
| **Median (P50) Margin** | +1.172383 | +0.04526 |
| **P05 Margin** | +0.044409 | +0.004425 |
| **P95 Margin** | +4.993483 | +0.110465 |
| **Min Margin** | -12.424762 | -0.186867 |
| **Max Margin** | +16.489811 | +0.120864 |

### 10.2 絶対スコア振幅
| Score Magnitude Metric | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) | Ratio (TREATMENT / CONTROL) |
|---|---|---|---|
| **Selected Score Abs (Mean)** | 0.579021 | 0.00451 | 0.0078 |
| **Selected Score Abs (Max)** | 12.424762 | 0.186867 | 0.0150 |
| **PASS Score Abs (Mean)** | 0.568517 | 0.004049 | 0.0071 |
| **PASS Score Abs (Max)** | 5.717065 | 0.034253 | 0.0060 |

### 10.3 特徴量振幅 & 数学的不変条件
| Feature Magnitude | CONTROL (`RAW_V4_EQUIVALENT`) | TREATMENT (`SCALED_V5`) | Invariant Check ($\le 1.0$) |
|---|---|---|---|
| **Max Abs Context Feature** | **138** | **1** | **PASS** ($\le 1.0$) |
| **Max Abs Pattern Feature** | **26** | **1** | **PASS** ($\le 1.0$) |
| **Max Abs Interaction Input** ($|c_i \cdot p_j|$) | **3120** | **1** | **PASS** ($\le 1.0$) |

---

## 11. 試合別シフト分析 (Per-Match Shift)

| Category | Match Count | 説明 |
|---|---|---|
| **UNCHANGED_INCOMPLETE** | **26** | 両 Arm とも maxDecisions (500) に到達し未完了 |
| **UNCHANGED_COMPLETED** | **0** | 両 Arm とも完了し勝敗一致 |
| **CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED** | **2** | CONTROL 未完了 $\rightarrow$ TREATMENT で完了 |
| **CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE** | **2** | CONTROL 完了 $\rightarrow$ TREATMENT で未完了 |
| **OUTCOME_CHANGED** | **0** | 両 Arm 完了だが勝者変更 |
| **FAILED** | **0** | 異常終了試合 |

### 完了試合の構造的シフト詳細 (動的生成)
#### 1. CONTROL 完了 $\rightarrow$ TREATMENT 未完了へのシフト:
- **Match 28** (`gen-000001-offspring-000004` vs `genome-001`): CONTROL では 62 decisions (勝者: `p2`, turnCount: 7) で完了していましたが、TREATMENT では未完了 (500 decisions) に遷移しました。
- **Match 29** (`genome-001` vs `gen-000001-offspring-000004`): CONTROL では 62 decisions (勝者: `p2`, turnCount: 7) で完了していましたが、TREATMENT では未完了 (500 decisions) に遷移しました。

#### 2. CONTROL 未完了 $\rightarrow$ TREATMENT 完了へのシフト:
- **Match 7** (`gen-000001-offspring-000004` vs `gen-000001-offspring-000000`): CONTROL では未完了 (500 decisions) でしたが、TREATMENT では 37 decisions (勝者: `p2`, turnCount: 3) で正常完了へとシフトしました。
- **Match 21** (`gen-000001-offspring-000004` vs `gen-000001-offspring-000002`): CONTROL では未完了 (500 decisions) でしたが、TREATMENT では 4 decisions (勝者: `p1`, turnCount: 1) で正常完了へとシフトしました。

---

## 12. 個体別適応度 & Readiness 評価

| Genome ID | CONTROL Status | CONTROL Fitness | CONTROL Completed | TREATMENT Status | TREATMENT Fitness | TREATMENT Completed |
|---|---|---|---|---|---|---|
| `gen-000001-offspring-000000` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: 1.00) | 1/10 |
| `gen-000001-offspring-000001` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 |
| `gen-000001-offspring-000002` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.00) | 1/10 |
| `gen-000001-offspring-000003` | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 |
| `gen-000001-offspring-000004` | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.50) | 2/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.50) | 2/10 |
| `genome-001` | `INSUFFICIENT_EVIDENCE` | undefined (prov: 0.50) | 2/10 | `INSUFFICIENT_EVIDENCE` | undefined (prov: N/A) | 0/10 |

- **Readiness**: 両 Arm とも各個体の完了試合数が `minimumCompletedMatches = 5` を下回るため、規定通り **`REEVALUATION_REQUIRED`** となり、次世代（g=2）への自動遷移は行わず停止しました。

---

## 13. 科学的結論 & 考察 (Scientific Conclusion)
1. **Feature Scaling の直接的影響の実証**:
   - Feature Scaling は各特徴量および相互作用項の入力を Schema v5 契約に従って有界化しました ($|c_i| \le 1.0, |p_j| \le 1.0, |c_i \cdot p_j| \le 1.0$)。未正規化による Feature Scale Amplification (最大 3120) は完全に排除されました。
   - スコア差分マージン（PASS - Best Non-PASS）の平均値は **+1.565003 $\rightarrow$ +0.052248** へと大幅に圧縮されました。
   - 本統制実験において、特徴量スケーリングは意思決定の軌跡（decision trajectories）を変化させ、完了試合の組み合わせをシフトさせました。
2. **完了率に関する客観的結果**:
   - 一方で、本 N=6 g1 統制実験において、特徴量スケーリングは対戦完了率を向上させませんでした (CONTROL: 2/30, TREATMENT: 2/30)。
   - 特徴量スケール増幅が有界化された後も、残存する PASS 選好および 28 件の INCOMPLETE match が依然として存在します。したがって、特徴量スケールの大きさ単体では残存する対戦挙動を説明しきれません。
3. **残存原因の未分離性**:
   - 残存する PASS 選好や未完了試合の原因（変異重み分布、ポリシーのタイブレーク／Argmax挙動、意味論的循環・停滞状態、特徴量表現の粗さ、適応度疎性など）は、本 A/B 実験のスコープ内では**未分離 (NOT ISOLATED)** であり、現時点でいずれか一つを原因と確定することはできません。今後の独立調査課題となります。

---

## 14. 明示的非主張 (Explicit Non-Claims)
- **PASS Stall Fully Solved**: **NO** (Feature Scaling 単体では未完了 28 件は解消されていない)
- **Mutation Bias Proven Cause**: **NO** (変異バイアスが主原因と証明されたわけではない)
- **Policy Proven Cause**: **NO** (ポリシー実装が原因と証明されたわけではない)
- **Cycle Proven**: **NO** (状態循環が原因と証明されたわけではない)
- **Strong DNA Proven**: **NO** (強力な DNA が得られたわけではない)
- **Multi-Generation Proven**: **NO** (多世代進化の完走が証明されたわけではない)
- **Rules Need Change**: **NO / POLICY UNCHANGED** (公式ルール・コアフローの変更を要求するものではなく、現行方針として Rules 不変を維持する)

---

## 15. 最終ステータス
**EVIDENCE CAPTURED / PENDING INDEPENDENT REVIEW**
