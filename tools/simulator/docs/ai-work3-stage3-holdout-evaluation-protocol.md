# Stage 3 Champion Holdout 独立性能評価プロトコル仕様書 (R1 改訂版)

**Work ID:** `BP-SIM-AI-V92-WORK3-STAGE3-HOLDOUT-PREEXEC-FIX-R1`  
**Base Commit SHA:** `e515e540974fa8beeb873dcbb5487cf45c97f2d6`  
**Status:** `PRE-EXECUTION FIXED PROTOCOL (R1 REVISED)`  
**対象レギュレーション:** `standard-pack` (Frame: `pack`, Feature Schema: v6)  

---

## 1. 目的と事前固定の原則

本仕様書は、Stage 3 Full Action Space Retraining R1（合法手空間ストリーミング下での1,920試合学習）において選定された Gen 7 Champion (`gen-000007-offspring-000007`) に対し、**完全未使用の本番 Holdout 240 試合を用いた独立性能評価プロトコルを事前固定**することを目的とする。

### 事前固定（Pre-Registration）の厳格原則
1. **Holdout の完全未使用保護:**
   本仕様書が独立レビューで正式承認されるまで、Holdout 用 Seed（95001〜95030）を用いた対戦は **一切実行しない**。試験的実行、部分実行、結果ののぞき見は厳格に禁止する。
2. **評価条件の固定:**
   Holdout 実行後に結果を見て対戦相手、目標勝率、信頼水準、検定手法、判定基準、意思決定上限を変更することを禁止する。
3. **原本保護:**
   旧 Stage 3 原本 (`.artifacts/stage3-evolution/`) および新 Stage 3 原本 (`.artifacts/stage3-full-action-retrain-r1/`) は読み取り専用とし、一切の改変・上書きを禁止する。本番 Holdout の成果物は新規ディレクトリ `.artifacts/stage3-holdout-evaluation/` のみに保存する（診断用 Smoke は `.artifacts/stage3-holdout-smoke/` に分離）。

---

## 2. 評価対象 Champion DNA

本プロトコルにおける評価対象は以下に固定され、変更不可とする。

- **Genome ID:** `gen-000007-offspring-000007`
- **世代:** Generation 7
- **DNA Full Digest (SHA-256):** `04a1e2fa1b25c117558a9fb71fc60a57b10a26750540474d4c858e139e7aa3f4`
- **DNA スキーマ仕様:**
  - `dnaFormatVersion`: 1
  - `featureSchemaVersion`: 6
  - `scoringModel`: `linear-bilinear-v1`
  - `contextDimension`: 165
  - `patternDimension`: 143
  - `patternWeights`: 143 次元（全要素有限実数、NaN / Infinity 排除）
  - `contextPatternWeights`: 23,595 次元（全要素有限実数、NaN / Infinity 排除）
- **取得元:** `tools/simulator/.artifacts/stage3-full-action-retrain-r1/campaign-stage3-evolution-checkpoint.json`
- **原本完全性照合:** Checkpoint 内部 `checksum` の一致を検証した上で DNA を抽出する。

---

## 3. Holdout 対戦相手構成（4種）および旧計画からの差分

30 Seeds × 2 座席（先手・後手）× 4 比較相手 ＝ **計 240 試合**（各比較相手あたり 30 ペア ＝ 60 試合）。

### 3.1 比較相手の定義

| 比較相手 ID | 名称 | 役割 (`role`) | 方針・実装 | 参照 DNA Digest / パラメータ | 目標勝率 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `holdout-first-legal` | FirstLegal | `BASELINE` | 合法手リストの先頭手を選択する決定論的 Policy | `FirstLegalPolicy(preferPass = false)` | **85.0%** |
| `holdout-seeded-random` | SeededRandom | `BASELINE` | プレイヤーシードに基づく決定論的擬似乱数 Policy | `RandomPolicy(playerSeeds[seat], "SeededRandom")` | **75.0%** |
| `holdout-zero-dna` | ZeroDNA | `BASELINE` | 全重みが 0.0 の未学習モデル Policy (初期モデル基準) | `DecisionDNACodec.createZeroDecisionDNA()` | **70.0%** |
| `holdout-stage3-gen5-champion` | Stage3Gen5Champion | `REFERENCE_CHAMPION` | 旧 Stage 3 (500手制限) の最良 Champion | `e8e8ae8f5449077b0f219afc827f6fc13f5e309408bb2d18817c62f87494ae91` | **50.0%** (非劣性/優位性) |

### 3.2 旧計画との差分および変更理由
1. **Gen 0 と ZeroDNA の重複解消:**
   初期集団（Gen 0）は重みが全 0.0 であり ZeroDNA と同一構成であるため、重複を排して「ZeroDNA」に統合。
2. **2大評価軸の明確化:**
   - **Baseline 軸（絶対的能力水準）:** 単純ヒューリスティック（FirstLegal）、無作為行動（SeededRandom）、事前バイアスなし行動（ZeroDNA）に対する優位性を検証。
   - **進化的改善軸（相対的向上度）:** 旧 Stage 3 最良ゲノム（Gen 5 Champion）を `REFERENCE_CHAMPION` として配置し、完全合法手空間ストリーミング再学習による真の進化的改善・非劣性を検証。

---

## 4. 試合設計と環境条件の統一

### 4.1 使用 Seed
- **対象 Seed:** `95001〜95030`（連続 30 個の整数 Seed）
- **Seed 衝突防止 (Fail-Closed):**
  - Training Seeds (1,320試合), Validation Seeds (94001〜94015), Holdout Seeds (95001〜95030) の間の重複衝突ゼロを実行前に厳格検証する。

### 4.2 座席反転ペア対戦 (Seat-Swapped Pairs)
同一 Seed における先手・後手バイアスを排除するため、すべての試合を 2 試合 1 組の「座席反転ペア」として実施する。
- **Leg 0:** Candidate Champion = `p1`, Opponent = `p2`
- **Leg 1:** Opponent = `p1`, Candidate Champion = `p2`

### 4.3 意思決定数上限の統一 (500回)
再学習 Stage 3 環境における上限値（`DEFAULT_MAX_DECISIONS_PER_MATCH = 500`）との比較整合性を担保するため、**Holdout 評価における意思決定数上限を 500 回に統一・固定**する（千日手・過剰 PASS による強制終了ストールを防止し、学習時と同一の決着基準を維持する）。

---

## 5. 統計的評価計算法と多重比較補正

### 5.1 ペアスコア算出 ($X_i$)
各 Leg の結果に基づき、Candidate Champion の獲得スコアを算出する：
- 勝利: $1.0$ 点、引き分け: $0.5$ 点、敗北: $0.0$ 点
$$X_i = \frac{\text{Score}_{\text{Leg0}} + \text{Score}_{\text{Leg1}}}{2} \in \{0.0, 0.25, 0.5, 0.75, 1.0\}$$

### 5.2 記述統計量と 95% 信頼区間
- **標本平均:** $\bar{X} = \frac{1}{N} \sum_{i=1}^{N} X_i \quad (N = 30)$
- **不偏標本分散:** $s^2 = \frac{1}{N - 1} \sum_{i=1}^{N} (X_i - \bar{X})^2$
- **標準誤差:** $SE = \sqrt{\frac{s^2}{N}}$
- **両側 95% 信頼区間 ($CI_{95}$):**
  $$CI_{95} = [\max(0.0, \bar{X} - t_{0.025, 29} \cdot SE), \ \min(1.0, \bar{X} + t_{0.025, 29} \cdot SE)] \quad (t_{0.025, 29} \approx 2.04523)$$

### 5.3 多重比較補正 (Bonferroni)
4 種類の対戦相手に対する同時検定を行うため、**Bonferroni 補正**を適用して第一種の過誤（Type I Error）を厳格に制御する。
- 全体有意水準: $\alpha = 0.05$ (片側)
- 補正後片側有意水準: $\alpha_{\text{Bonf}} = \frac{0.05}{4} = 0.0125$ ($t_{0.0125, 29} \approx 2.3638$)
- **片側信頼下限 ($L_{\text{Bonf}}$):**
  $$L_{\text{Bonf}} = \bar{X} - t_{0.0125, 29} \cdot SE$$

---

## 6. 正式性能認定基準 (Holdout Certification Criteria)

最終的な Champion 性能認定を受けるためには、以下の **基準 A, B, C のすべてを同時に満たす** ことが必要である。

### 基準 A: Baseline 絶対的能力水準認定 (3種すべて合格)
1. **vs `FirstLegal`:** $\bar{X} \ge 0.85$ かつ 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)
2. **vs `SeededRandom`:** $\bar{X} \ge 0.75$ かつ 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)
3. **vs `ZeroDNA`:** $\bar{X} \ge 0.70$ かつ 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)

### 基準 B: Reference Champion 進化的改善・非劣性認定
1. **Superiority (優位性/改善認定):**
   - $\bar{X} > 0.50$ かつ 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)
   - この場合、`certificationStatus = "SUPERIORITY_VERIFIED"`, `improvementStatus = "IMPROVEMENT_VERIFIED"` と認定する。
2. **Non-Inferiority (非劣性認定):**
   - $\bar{X} \ge 0.50$ かつ 許容マージン $\Delta = 0.05$ に対する片側非劣性検定（$L_{\text{Bonf}} > 0.45$）を棄却。
   - この場合、`certificationStatus = "NON_INFERIORITY_VERIFIED"` と認定する。
   - **重要契約:** 非劣性のみ達成の場合は優位性（改善）は未証明であるため、`improvementStatus` は `"IMPROVEMENT_UNVERIFIED"` とする（`IMPROVEMENT_VERIFIED` にしてはならない）。

### 基準 C: Fail-Closed 実行完全性保証
1. 240 試合すべて COMPLETED（`failed === 0`, `incomplete === 0`, 例外終了 0）。
2. ストリーミング合法手実体化失敗が **0 件**（実際に計測・記録されること）。
3. 意思決定上限（500回）到達による強制終了が **0 件**。

---

## 7. 認定ステータス定義 (`certificationStatus`)

| ステータス | 定義・条件 |
| :--- | :--- |
| `SUPERIORITY_VERIFIED` | 実行完全性 OK ＋ Baseline 3種合格 ＋ Reference 優位性合格 ($\bar{X} > 0.50 \land L_{\text{Bonf}} > 0.50$) |
| `NON_INFERIORITY_VERIFIED` | 実行完全性 OK ＋ Baseline 3種合格 ＋ Reference 非劣性合格 ($\bar{X} \ge 0.50 \land L_{\text{Bonf}} > 0.45$) |
| `PERFORMANCE_UNVERIFIED` | 実行完全性 OK だが、Baseline 未達 または Reference 劣性 ($L_{\text{Bonf}} \le 0.45$) |
| `INVALID_EVIDENCE` | 試合の失敗・未完・実体化失敗・上限到達など、実行完全性に違反がある場合 |

---

## 8. 本仕様書の確定とレビュー待機

本仕様書は、Work 3-6 R1 における Holdout 実行前独立レビュー用として確定された。

**本番 Holdout（240試合）は、独立レビュー承認が下りるまで実行しない。**
