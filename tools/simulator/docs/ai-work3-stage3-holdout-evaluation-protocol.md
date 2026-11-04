# Stage 3 Champion Holdout 独立性能評価プロトコル仕様書

**Work ID:** `BP-SIM-AI-V92-WORK3-STAGE3-HOLDOUT-PREPARATION`  
**Base Commit SHA:** `60d707723eb901e1bf448fcd458dad655878794d`  
**Status:** `PRE-EXECUTION FIXED PROTOCOL`  
**対象レギュレーション:** `standard-pack` (Frame: `pack`, Feature Schema: v6)  

---

## 1. 目的と事前固定の原則

本仕様書は、Stage 3 Full Action Space Retraining R1（合法手空間ストリーミング下での1,920試合学習）において選定された Gen 7 Champion (`gen-000007-offspring-000007`) に対し、**完全未使用の本番 Holdout 240 試合を用いた独立性能評価プロトコルを事前固定**することを目的とする。

### 事前固定（Pre-Registration）の厳格原則
1. **Holdout の完全未使用保護:**
   本仕様書が独立レビューで正式承認されるまで、Holdout 用 Seed（95001〜95030）を用いた対戦は **一切実行しない**。試験的実行、部分実行、結果ののぞき見は厳格に禁止する。
2. **評価条件の固定:**
   Holdout 実行後に結果を見て対戦相手、目標勝率、信頼水準、検定手法、判定基準を変更することを禁止する。
3. **原本保護:**
   旧 Stage 3 原本 (`.artifacts/stage3-evolution/`) および新 Stage 3 原本 (`.artifacts/stage3-full-action-retrain-r1/`) は読み取り専用とし、一切の改変・上書きを禁止する。本番 Holdout の成果物は新規ディレクトリ `.artifacts/stage3-holdout-evaluation/` のみに保存する。

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

---

## 3. Holdout 対戦相手構成（4種）および旧計画からの差分

30 Seeds × 2 座席（先手・後手）× 4 比較相手 ＝ **計 240 試合**（各比較相手あたり 30 ペア ＝ 60 試合）。

### 3.1 比較相手の定義

| 比較相手 ID | 名称 | 役割 (`role`) | 方針・実装 | 参照 DNA Digest / パラメータ |
| :--- | :--- | :--- | :--- | :--- |
| `holdout-first-legal` | FirstLegal | `BASELINE` | 合法手リストの先頭手を選択する決定論的 Policy | `FirstLegalPolicy(preferPass = false)` |
| `holdout-seeded-random` | SeededRandom | `BASELINE` | プレイヤーシードに基づく決定論的擬似乱数 Policy | `RandomPolicy(playerSeeds[seat], "SeededRandom")` |
| `holdout-zero-dna` | ZeroDNA | `BASELINE` | 全重みが 0.0 の未学習モデル Policy (初期モデル基準) | `DecisionDNACodec.createZeroDecisionDNA()` |
| `holdout-stage3-gen5-champion` | Stage3Gen5Champion | `REFERENCE_CHAMPION` | 旧 Stage 3 (500手制限) の最良 Champion | `e8e8ae8f5449077b0f219afc827f6fc13f5e309408bb2d18817c62f87494ae91` |

### 3.2 旧計画との差分および変更理由

当初の設計書（`ai-work3-multigeneration-evolution-plan.md` 等）では、Holdout 相手候補として「Gen 0 ゲノム」が含まれていた。しかし、以下の理由により今回の 4 相手構成へ改訂・確定する。

1. **Gen 0 と ZeroDNA の重複解消:**
   進化アルゴリズムの初期集団（Generation 0）の全個体は、重み初期値 0.0 から変異を適用する前の状態、または ZeroDNA と同一の重み構成を持つ。したがって「Gen 0」と「ZeroDNA」を別々に評価することは実質的な重複検証となり、統計的独立性や多重比較補正の観点から無駄な検定力を消費する。
2. **2大評価軸の明確化:**
   - **Baseline 軸（絶対的能力水準）:** 単純行動遂行（FirstLegal）、無作為行動（SeededRandom）、学習バイアスなし行動（ZeroDNA）の 3 基準に対する優位性を検証する。
   - **進化的改善軸（相対的向上度）:** 旧 Stage 3 において 500 件制限下で獲得された最良 DNA（Gen 5 Champion）を `REFERENCE_CHAMPION` として配置し、完全合法手空間ストリーミング再学習によって獲得された新 Champion が過去の成果に対して非劣性および優位性を持つかを客観的に検証する。

---

## 4. 試合設計と Seed 配分

### 4.1 使用 Seed
- **対象 Seed:** `95001〜95030`（連続 30 個の整数 Seed）
- **Seed 衝突防止 (Fail-Closed):**
  - Training Seeds (1,320試合)
  - Validation Seeds (`94001〜94015`, 15 seeds × 40 matches = 600試合)
  - Holdout Seeds (`95001〜95030`, 30 seeds × 8 matches = 240試合)
  - 各カテゴリ間の集合積（Intersection）が空集合 ($\emptyset$) であることを実行前にプログラムで検証する。

### 4.2 座席反転ペア対戦 (Seat-Swapped Pairs)
同一 Seed における先手・後手バイアスを排除するため、すべての試合を 2 試合 1 組の「座席反転ペア」として実施する。

- **Leg 0:** Candidate Champion = `p1`, Opponent = `p2`
  - Match Seed: $S \in \{95001, \dots, 95030\}$
  - $p1\text{Seed} = \text{deriveSeed}(S, \text{"p1"})$
  - $p2\text{Seed} = \text{deriveSeed}(S, \text{"p2"})$
- **Leg 1:** Opponent = `p1`, Candidate Champion = `p2`
  - Match Seed: $S \in \{95001, \dots, 95030\}$
  - $p1\text{Seed} = \text{deriveSeed}(S, \text{"p1"})$
  - $p2\text{Seed} = \text{deriveSeed}(S, \text{"p2"})$

---

## 5. 統計的評価計算法と検定契約

同一 Seed の Leg 0 と Leg 1 は完全に独立ではないため、**ペア単位のスコア $X_i$ を標本単位（$N = 30$）として集計**し、統計的独立性の過大評価を防止する。

### 5.1 ペアスコア算出 ($X_i$)
各 Leg の結果に基づき、Candidate Champion の獲得スコアを算出する：
- 勝利: $1.0$ 点
- 引き分け (Draw): $0.5$ 点
- 敗北: $0.0$ 点

$$X_i = \frac{\text{Score}_{\text{Leg0}} + \text{Score}_{\text{Leg1}}}{2} \in \{0.0, 0.25, 0.5, 0.75, 1.0\}$$

※ いずれかの Leg が例外（FAILED）または未完了（INCOMPLETE）の場合はペア全体が無効となり、$X_i = \text{null}$ とする。

### 5.2 記述統計量と 95% 信頼区間
- **標本平均:** $\bar{X} = \frac{1}{N} \sum_{i=1}^{N} X_i \quad (N = 30)$
- **不偏標本分散:** $s^2 = \frac{1}{N - 1} \sum_{i=1}^{N} (X_i - \bar{X})^2$
- **標準誤差:** $SE = \sqrt{\frac{s^2}{N}}$
- **両側 95% 信頼区間 ($CI_{95}$):**
  - 自由度 $df = N - 1 = 29$
  - Student-t 臨界値 $t_{0.025, 29} \approx 2.04523$
  $$CI_{95} = [\max(0.0, \bar{X} - t_{0.025, 29} \cdot SE), \ \min(1.0, \bar{X} + t_{0.025, 29} \cdot SE)]$$
  - ※ 標本分散が 0 の場合（全勝または全敗）は、厳密二項検定（Exact Binomial）または Hoeffding 信頼限界を適用する。

### 5.3 多重比較補正 (Family-Wise Error Rate)
4 種類の対戦相手に対する同時検定を行うため、**Bonferroni 補正**を適用して第一種の過誤（Type I Error）を制御する。

- 全体有意水準 (Family-wise Significance Level): $\alpha = 0.05$ (片側)
- 補正後片側有意水準: $\alpha_{\text{Bonf}} = \frac{\alpha}{K} = \frac{0.05}{4} = 0.0125$
- 自由度 $df = 29$ における Bonferroni 片側臨界値: $t_{0.0125, 29} \approx 2.3638$
- **片側信頼下限 ($L_{\text{Bonf}}$):**
  $$L_{\text{Bonf}} = \bar{X} - t_{0.0125, 29} \cdot SE$$
  改善検定（$H_0: \mu \le 0.50$ vs $H_1: \mu > 0.50$）において、$L_{\text{Bonf}} > 0.50 \iff p < \alpha_{\text{Bonf}}$ が厳密に成立する。

---

## 6. 性能認定基準 (Performance Certification Criteria)

最終的な Champion 性能認定を受けるためには、以下の **基準 A, B, C のすべてを同時に満たす** ことが必要である。

### 基準 A: Baseline 絶対的能力水準認定
3 種の Baseline 対戦相手すべてに対して、目標平均勝率を達成し、かつ統計的有意差（偶然の偏りでないこと）を証明すること。

1. **vs `FirstLegal`:**
   - 平均ペア勝率: $\bar{X} \ge 0.85$
   - 統計的有意差: 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)
2. **vs `SeededRandom`:**
   - 平均ペア勝率: $\bar{X} \ge 0.75$
   - 統計的有意差: 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)
3. **vs `ZeroDNA`:**
   - 平均ペア勝率: $\bar{X} \ge 0.70$
   - 統計的有意差: 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)

### 基準 B: Reference Champion 進化的改善・非劣性認定
旧 Stage 3 Gen 5 Champion に対し、以下のいずれかを達成すること。

1. **非劣性認定 (Non-Inferiority):**
   - 平均ペア勝率: $\bar{X} \ge 0.50$（互角以上）
   - 許容マージン $\Delta = 0.05$ に対する片側非劣性検定（$H_0: \mu \le 0.45$）を棄却すること。
2. **優位性認定 (Superiority):**
   - 平均ペア勝率: $\bar{X} > 0.50$ かつ 片側 $p < 0.0125$ ($L_{\text{Bonf}} > 0.50$)。

### 基準 C: Fail-Closed 実行完全性保証
1. **試合完走性:** 240 試合すべてが正常に決着（勝利・敗北・引き分け）し、未完走（`incomplete`）および例外終了（`failed`）が **0 件** であること。
2. **Core 解決完全性:** ストリーミング合法手の Core 実体化失敗が **0 件** であること。
3. **意思決定上限健全性:** 試合ごとの最大意思決定数上限（400回）到達による強制終了（千日手・ストール）が **0 件** であること。

---

## 7. 必須 Evidence アーティファクトと監査要件

Holdout 実行完了時、以下の全成果物が `.artifacts/stage3-holdout-evaluation/` に生成され、改ざん防止ハッシュが検証されなければならない。

1. `preflight-manifest.json`: 実行前 Git SHA、環境情報、Seed 一覧、DNA Digest 一覧
2. `holdout-evaluation-protocol.json`: 事前固定プロトコルの機械可読データ
3. `holdout-evaluation-result.json`: 240 試合すべての個別 Outcome（Seed, Leg, 座席, 勝敗, 決着理由, 総意思決定数, ターン数, FinalStateHash）、ペア結果、統計サマリー
4. `holdout-evaluation-evidence.json`: 最終ステータス判定（`VALID` / `IMPROVEMENT_VERIFIED`）
5. `HOLDOUT_AUDIT_REPORT.md` / `AUDIT_HOLDOUT_EVIDENCE.md`: 人間が読める形式の監査・検証レポート
6. `MANIFEST_SHA256.json`: 全ファイルの SHA-256 チェックサム
7. `stage3-holdout-evaluation.zip`: 原本 ZIP アーカイブ

---

## 8. 本仕様書の確定とレビュー待機

本仕様書は、Work 3-6 における Holdout 実行前独立レビュー用として確定された。

**本番 Holdout（240試合）は、独立レビュー承認が下りるまで実行しない。**
