# BlackPoker Simulator - Decision Feature Scaling 設計仕様書 V1-R2

**作業ID**: `BP-SIM-AI-FEATURE-SCALING-DESIGN-V1-R2`  
**設計ステータス**: DESIGNED / PENDING INDEPENDENT REVIEW  
**先行作業**: `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R2` (FORMAL ACCEPTED)  
**対象ブランチ**: `BlackPoker/issue551-core-flow`  
**Canonical Registry**: `docs/ai-feature-scaling-registry-v1-r2.json`  
**更新日時**: 2026-10-15 15:55 JST  

---

## 1. Document Identity

本仕様書は、BlackPoker Simulator の AI 意思決定モデル（Decision Feature Schema）における特徴量スケーリング・正規化（Feature Scaling / Normalization）のアーキテクチャ設計および全306特徴量（Context 163 + Pattern 143）に対するスケーリング定義を策定する Canonical Design Evidence である。

本設計は **DESIGN ARTIFACT CORRECTION ONLY** であり、本番コードの修正、スケーリング実装、ゲームプレイ実行、進化ループ実行、ルール変更は一切行わない。

---

## 2. Historical Status & Review Corrections

### 2.1 履歴ステータス (Historical Status)

- **Feature Scaling Design V1**: **NOT ACCEPTED** (Commit: `2f93d3e3b76378a49cdc2655d62da88aa3cd6f70`)
- **Feature Scaling Design V1-R1**: **NOT ACCEPTED / SUPERSEDED BY R2** (Commit: `526cec14209deb30750f5bb634aa136e17acac81`)
- **Feature Scaling Design V1-R2**: **DESIGNED / PENDING INDEPENDENT REVIEW**

### 2.2 R1 却下理由と R2 での厳格修正 (R1 Reasons for NOT ACCEPTED & R2 Corrections)

1. **Registry と Markdown 間での Scale Parameter 不一致の解消**:
   - R1 では Markdown の例示表において、Registry の設定値と異なる scale 値（`legal_non_pass_pattern_count` $s=10$ vs Registry $s=50$, `turn_count` $s=20$ vs Registry $s=10$, `self_hand_value_sum` $s=20$ vs Registry $s=30$ 等）が手作業転記により混入していた。
   - R2 では、306 特徴量の機械可読契約である **Canonical Registry (`docs/ai-feature-scaling-registry-v1-r2.json`) を唯一の正**とし、Markdown の全パラメータおよびスケール後計算値を Registry と完全一致（Mismatch: 0）させた。
2. **Context 全体の Output Domain 表現の修正**:
   - R1 では Context ベクトル全体を $[0, 1]^{163}$ と表記していた箇所があったが、Context には 9 本の `SIGNED_DELTA`（相対差分特徴量）が含まれており、負値 $(-1, 0)$ を取り得る。
   - R2 では、Context ベクトルの包括値域を **$c \in [-1, 1]^{163}$**、Pattern ベクトルの包括値域を **$p \in [-1, 1]^{143}$** と正しく定式化した。
3. **誤った固定寄与上限（$\le 0.05$）の撤廃と不変条件の厳密化**:
   - R1 では将来の検証基準として「最大特徴量寄与 $\le 0.05$」という記述があったが、突然変異パラメータ $\sigma = 0.05$ は正規分布摂動の標準偏差（Perturbation Scale）であり、重みの絶対上限ではない。実際の R2 DNA においても $|weight| > 0.05$ の重みが存在する。
   - R2 では固定数値による上限主張を排し、スケーリングによる**相互作用増幅率 $|c_i \cdot p_j| \le 1.0$**、および単一項の不変条件 **$|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$**、Pattern 線形項 **$|w_j \cdot p_j| \le |w_j|$** を真の検証契約として定式化した。
4. **未採用分類 `PROGRESSING_LONG_MATCH` の完全排除**:
   - R1 において、独立レビューで採用されていない `INCOMPLETE: PROGRESSING_LONG_MATCH` という分類名が再登場していた。
   - R2 ではこの分類を完全に排除し、Formal Accepted された事実に基づき **「28試合が maxDecisions=500 到達により未完了（INCOMPLETE）。観測された挙動には過剰な PASS 選択および Turn 1 での停滞サンプルが含まれる」** という客観的事実のみを記載する。

---

## 3. Scope & Scope Boundaries

### 3.1 本設計の対象 (In Scope)

1. Context 163特徴量および Pattern 143特徴量（計306特徴量）のスケーリングクラス分類と変換関数の確定。
2. 全特徴量に対するパラメータ（scale $s$, bound $B$）の Canonical Registry 定義。
3. DecisionFeatureSchema（v5）におけるレジストリ所有関係と責任分離の設計。
4. 包括ベクトル値域 $c \in [-1, 1]^{163}$ および $p \in [-1, 1]^{143}$ の定式化。
5. 相互作用項および線形項における数学的不変条件の定式化。
6. 将来の実装（`BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1`）および A/B 検証プロトコルの策定。

### 3.2 明示的なスコープ外 (Out of Scope / Scope Boundaries)

1. **本番実装・テストの禁止**: `src/engine/**`, `src/domain/**` のソースコードおよびテストコードの修正ゼロ（diff 0）。
2. **ルールおよびコアフロー変更との完全分離**: 別途検討されているルール側の空ステージ PASS 議論とは完全に切り離す。
3. **探索ハイパーパラメータの変更禁止**: $p_m = 0.01, \sigma = 0.05, N = 6, R = 1$ は不変。
4. **適応度関数の変更禁止**: 多目的適応度（MPA Fitness）の計算式やペナルティ項は不変。
5. **Ad-hoc な PASS 救済策の禁止**: PASS 専用の固定ボーナス／ペナルティ定数は一切導入しない。
6. **ゲームプレイ・進化ループ実行の禁止**: 新たな対戦実行やシミュレーションは行わない。

---

## 4. Accepted DNA R2 Input (実証済み観測事実)

Formal Accepted された `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R2` の確定事実を設計インプットとする：

1. **g1 30試合中 2試合完了 (COMPLETED), 28試合未完了 (INCOMPLETE)**:
   - 28試合は maxDecisions=500 到達による未完了。
   - オフスプリングの総 PASS 回数は 11,908 回。
   - `STRICT_PASS_WIN`（PASS が最高スコアで単独勝利）: 9,923 回（83.33%）。
   - `FORCED_PASS`（合法手が PASS のみ）: 1,985 回（16.67%）。
   - `TIE_BREAK_PASS`（タイブレークによる PASS 選択）: 0 回（0.00%）。
2. **PASS と action.end の直接対決**:
   - 両者が合法手として同時に存在した 6,846 決定機会中、PASS > end が 6,839 回（99.90%）。
3. **未正規化特徴量による突然変異重みの増幅実証**:
   - `legal_non_pass_pattern_count`: 最大値 137
   - `legal_action_timing_quick_count`: 最大値 126
   - `self_hand_value_sum`: 最大値 82
   - 小さな突然変異重みが、生値 137 との積により $+6.85$ という極めて巨大なスコア寄与を生み出し、非 PASS 手を過剰に抑制していた。

---

## 5. Current Feature Schema (Schema v4 現状)

- **現行スキーマバージョン**: `FEATURE_SCHEMA_VERSION = 4` (`DecisionFeatureTypes.ts`)
- **Context 特徴量**: 163 次元 (`CONTEXT_FEATURE_NAMES`)
- **Pattern 特徴量**: 143 次元 (`PATTERN_FEATURE_NAMES`)
- **相互作用重み数**: $163 \times 143 = 23,309$
- **Pattern 線形重み数**: 143
- **総重みパラメータ数**: $23,309 + 143 = 23,452$
- **現状のエンコード仕様**: `DecisionFeatureEncoder.ts` は数値を**生の整数値または浮動小数点数**としてそのまま出力しており、スケーリングや有界化は適用されていない。

---

## 6. Problem Definition (課題の明確化)

未正規化の生値特徴量を線形・双線形モデルに直接入力することにより、以下の問題が発生している：

1. **不均一な有効学習率（Effective Mutation Scale Mismatch）**:
   - フラグ特徴量（$\{0, 1\}$）に対する重み変化 $\Delta M \cdot 1$ に対し、合法手数特徴量（$\{0, \dots, 137\}$）に対する重み変化は $\Delta M \cdot 137$ に達し、100倍以上の影響度乖離が発生。
2. **非対称な選択圧**:
   - PASS パターンは多くのコストや対象選択特徴量が 0 であるため、非 PASS 手に対する重み変化の影響を受けにくい。一方、手札枚数や合法手数が大きい局面では、非 PASS 手に掛かる重みが爆発的に増幅され、結果として非 PASS 手が極端に抑制される。

---

## 7. Mathematical Risk (数理的リスク)

生値特徴量の相互作用項 $M_{ij} \cdot c_i \cdot p_j$ において、$c_i$ および $p_j$ が非有界である場合：
$$\sup |c_i \cdot p_j| = \infty$$
となり、重み行列 $M$ の摂動スケール（$\sigma = 0.05$）にかかわらず、局所的なスコア寄与が任意に大きくなり得る。
これを是正するためには、すべての特徴量に対して一様な有界性境界を導入することが不可欠である。

---

## 8. Design Goals (設計目標)

1. **有界性の厳格な保証**:
   - Context ベクトル全体を $c \in [-1, 1]^{163}$ に拘束。
   - Pattern ベクトル全体を $p \in [-1, 1]^{143}$ に拘束。
   - これにより、単一相互作用項の寄与上限を $|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$ に拘束する。
2. **決定論性と純粋関数性の維持**:
   - バッチ統計量や世代分布に依存せず、同一の `DecisionRequest` から常に同一のベクトルを算出する。
3. **初等有理式による実装**:
   - プラットフォーム依存の浮動小数点ライブラリ差異を避けるため、超越関数を排し、初等四則演算と除算のみで構成する。
4. **原点保存性（Zero-Preservation）**:
   - 生値が 0 の特徴量は、スケール後も必ず 0 となる。
5. **厳格な単調性（Strict Monotonicity）**:
   - 連続定義域内の任意の点において、生値の大小関係がスケール後も完全に保存される。

---

## 9. Non-Goals (設計の非目標)

1. データセット依存の正規化（バッチ正規化、Z-score正規化、移動平均など）の導入。
2. PASS 特有または特定アクション特有のハードコードされた補正。
3. Core Flow やルール側の PASS 挙動の改変。
4. 突然変異パラメータ（$p_m, \sigma$）や適応度関数（MPA Fitness）の最適化。
5. 本設計フェーズにおける本番コードの修正。

---

## 10. Candidate Functions (スケーリング関数の比較検討)

| 方式 | 定義式 | 有界性 | 単調性 | 原点保存 | プラットフォーム決定論性 | 評価・採否 |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Identity** | $f(x) = x$ | 既に有界なら○ | ○ | ○ | 完全（ビット一致） | **採用**（$[0, 1]$ 有界特徴量用） |
| **Linear Bound Division** | $f(x) = x / B$ | $[0, 1]$ | ○ | ○ | 完全 | **採用**（トランプランク用, $B=13$） |
| **Hard Clamp** | $\min(\max(x, 0), B) / B$ | $[0, 1]$ | 弱単調 | ○ | 完全 | **却下**（上限超過で感度消失） |
| **Saturating Rational** | $f(x) = \frac{x}{x + s}$ | $[0, 1)$ | 厳格単調 | ○ | 四則演算のみで高再現性 | **採用**（非負カウント・合計値用） |
| **Signed Saturating Rational** | $f(x) = \frac{x}{\|x\| + s}$ | $(-1, 1)$ | 厳格単調 | ○ | 四則演算のみで高再現性 | **採用**（正負デルタ値用） |
| **Hyperbolic Tangent** | $f(x) = \tanh(x / s)$ | $(-1, 1)$ | 厳格単調 | ○ | `Math.tanh` の libm 実装差リスク | **却下**（クロスプラットフォーム再現性懸念） |
| **Log Transform** | $f(x) = \frac{\log(1 + x)}{\log(1 + B)}$ | $[0, 1]$ | 厳格単調 | ○ | 超越関数依存・上限設定必要 | **却下** |
| **Dataset Z-score** | $(x - \mu) / \sigma$ | 非有界 | ○ | $\times$ | 世代・環境依存でリプレイ不可 | **厳格却下**（決定論的契約を破壊） |

---

## 11. Canonical Function Family (採用する変換関数族)

本設計では、以下の 4 種類の純粋関数のみを正規採用する：

### 11.1 Identity (`identity`)
$$f(x) = x$$
- **適用対象**: `BOOLEAN`, `ONE_HOT`, `HASH_BUCKET`, `RATIO_0_1`（計139本）
- **出力値域**: $[0, 1]$

### 11.2 Linear Bound Division (`linear_bound_division`)
$$f(x) = \frac{x}{B} \quad (B = 13)$$
- **適用対象**: `BOUNDED_CARD_VALUE`（計10本、A=1/13 $\approx 0.0769$, K=13/13 = 1.0）
- **出力値域**: $[0, 1]$
- **採否理由**: カードのランク差は完全に均等なドメイン知識であり、非線形圧縮を行わずに線形射影するのが最も自然であるため。

### 11.3 Saturating Rational (`saturating_rational`)
$$f(x) = \frac{x}{x + s} \quad (x \ge 0, \; s > 0)$$
- **適用対象**: `NONNEGATIVE_COUNT`, `AGGREGATE_SUM`, `SIZE`（計147本）
- **出力値域**: $[0, 1)$
- **半飽和特性**: $f(s) = 0.50$
- **数理特性**:
  - 1階微分: $f'(x) = \frac{s}{(x + s)^2} > 0$（厳格な単調増加）
  - 2階微分: $f''(x) = -\frac{2s}{(x + s)^3} < 0$（**凹関数 / concave**）
  - 原点保存: $f(0) = 0$
  - 極限: $\lim_{x \to \infty} f(x) = 1.0$

### 11.4 Signed Saturating Rational (`signed_saturating_rational`)
$$f(x) = \frac{x}{|x| + s} \quad (x \in \mathbb{R}, \; s > 0)$$
- **適用対象**: `SIGNED_DELTA`（計10本、ライフ差、手札枚数差などの相対特徴量）
- **出力値域**: $(-1, 1)$
- **数理特性**:
  - 原点保存: $f(0) = 0$
  - 符号保存: $\text{sgn}(f(x)) = \text{sgn}(x)$
  - 奇対称性: $f(-x) = -f(x)$
  - 厳格な単調増加: $\forall x_1 < x_2 \implies f(x_1) < f(x_2)$
  - 原点での微分係数: $\lim_{x \to 0^+} f'(x) = \lim_{x \to 0^-} f'(x) = \frac{1}{s}$

---

## 12. Feature Classification (全306特徴量の正確な分類)

Canonical Registry（`docs/ai-feature-scaling-registry-v1-r2.json`）に基づく全特徴量の分類内訳：

| スケーリングクラス | 変換関数 | Context本数 | Pattern本数 | 合計本数 | 個別出力値域 |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `BOOLEAN` | `identity` | 29 | 22 | 51 | $[0, 1]$ |
| `NONNEGATIVE_COUNT` | `saturating_rational` | 69 | 54 | 123 | $[0, 1)$ |
| `AGGREGATE_SUM` | `saturating_rational` | 7 | 6 | 13 | $[0, 1)$ |
| `BOUNDED_CARD_VALUE` | `linear_bound_division` | 6 | 4 | 10 | $[0, 1]$ |
| `SIZE` | `saturating_rational` | 3 | 8 | 11 | $[0, 1)$ |
| `SIGNED_DELTA` | `signed_saturating_rational` | 9 | 1 | 10 | $(-1, 1)$ |
| `HASH_BUCKET` | `identity` | 32 | 32 | 64 | $[0, 1]$ |
| `ONE_HOT` | `identity` | 8 | 15 | 23 | $[0, 1]$ |
| `RATIO_0_1` | `identity` | 0 | 1 | 1 | $[0, 1]$ |
| **合計 (Total)** | - | **163** | **143** | **306** | - |

- **ベクトル全体の包括値域 (Aggregate Vector Domains)**:
  - Context ベクトル: **$c \in [-1, 1]^{163}$**（非負154本は $[0, 1]$ または $[0, 1)$、`SIGNED_DELTA` 9本は $(-1, 1)$）
  - Pattern ベクトル: **$p \in [-1, 1]^{143}$**（非負142本は $[0, 1]$ または $[0, 1)$、`SIGNED_DELTA` 1本は $(-1, 1)$）

---

## 13. Context Registry Summary (Context 163特徴量集計)

- **関数別内訳**:
  - `identity`: 69本 (42.33%)
  - `saturating_rational`: 79本 (48.47%)
  - `linear_bound_division`: 6本 (3.68%)
  - `signed_saturating_rational`: 9本 (5.52%)
- **個別出力値域別内訳**:
  - $[0, 1]$: 75本 (46.01%)
  - $[0, 1)$: 79本 (48.47%)
  - $(-1, 1)$: 9本 (5.52%)
- **代表的特徴量のスケーリング例 (Registry 厳密一致)**:

| 特徴量名 (公式名) | クラス | 関数 | パラメータ | 生値 0 | 生値 5 | 生値 10 | 基準生値 | スケール後値 |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `legal_non_pass_pattern_count` | `NONNEGATIVE_COUNT` | `saturating_rational` | $s = 50$ | 0.000 | 0.091 | 0.167 | 137 (R2最大) | **0.733** |
| `legal_action_timing_quick_count` | `NONNEGATIVE_COUNT` | `saturating_rational` | $s = 50$ | 0.000 | 0.091 | 0.167 | 126 (R2最大) | **0.716** |
| `self_hand_value_sum` | `AGGREGATE_SUM` | `saturating_rational` | $s = 30$ | 0.000 | 0.143 | 0.250 | 82 (R2最大) | **0.732** |
| `turn_count` | `NONNEGATIVE_COUNT` | `saturating_rational` | $s = 10$ | 0.000 | 0.333 | 0.500 | 100 (典型大) | **0.909** |
| `self_hand_value_max` | `BOUNDED_CARD_VALUE` | `linear_bound_division` | $B = 13$ | 0.000 | 0.385 | 0.769 | 13 (K) | **1.000** |
| `relative_hand_count` | `SIGNED_DELTA` | `signed_saturating_rational` | $s = 10$ | 0.000 | +0.333 | +0.500 | -10 (大差劣勢) | **-0.500** |
| `source_is_action_request` | `BOOLEAN` | `identity` | - | 0.000 | - | - | 1 | **1.000** |

---

## 14. Pattern Registry Summary (Pattern 143特徴量集計)

- **関数別内訳**:
  - `identity`: 70本 (48.95%)
  - `saturating_rational`: 68本 (47.55%)
  - `linear_bound_division`: 4本 (2.80%)
  - `signed_saturating_rational`: 1本 (0.70%)
- **個別出力値域別内訳**:
  - $[0, 1]$: 74本 (51.75%)
  - $[0, 1)$: 68本 (47.55%)
  - $(-1, 1)$: 1本 (0.70%)
- **代表的特徴量のスケーリング例 (Registry 厳密一致)**:

| 特徴量名 (公式名) | クラス | 関数 | パラメータ | 生値 0 | 生値 2/4 | 生値 10 | 典型大生値 | スケール後値 |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `cost_total_item_count` | `NONNEGATIVE_COUNT` | `saturating_rational` | $s = 5$ | 0.000 | 0.286 (2) | 0.667 | 5 (半飽和) | **0.500** |
| `key_card_value_sum` | `AGGREGATE_SUM` | `saturating_rational` | $s = 20$ | 0.000 | 0.167 (4) | 0.333 | 50 | **0.714** |
| `key_card_value_max` | `BOUNDED_CARD_VALUE` | `linear_bound_division` | $B = 13$ | 0.000 | 0.308 (4) | 0.769 | 13 (K) | **1.000** |
| `selected_unit_size_sum` | `AGGREGATE_SUM` | `saturating_rational` | $s = 20$ | 0.000 | 0.167 (4) | 0.333 | 30 | **0.600** |
| `effect_assignment_size_delta_sum` | `SIGNED_DELTA` | `signed_saturating_rational` | $s = 20$ | 0.000 | - | +0.333 | +20 | **+0.500** |
| `pattern_is_pass` | `ONE_HOT` | `identity` | - | 0.000 | - | - | 1 | **1.000** |
| `pattern_is_action` | `ONE_HOT` | `identity` | - | 0.000 | - | - | 1 | **1.000** |

---

## 15. Parameter Policy & Distribution by Class

Registry におけるパラメータ分布の実測集計：

```json
{
  "BOOLEAN": { "{}": 51 },
  "NONNEGATIVE_COUNT": {
    "{\"scale\":4}": 57,
    "{\"scale\":5}": 37,
    "{\"scale\":10}": 21,
    "{\"scale\":50}": 8
  },
  "AGGREGATE_SUM": {
    "{\"scale\":20}": 6,
    "{\"scale\":30}": 7
  },
  "BOUNDED_CARD_VALUE": { "{\"bound\":13}": 10 },
  "SIZE": { "{\"scale\":10}": 11 },
  "SIGNED_DELTA": {
    "{\"scale\":10}": 8,
    "{\"scale\":20}": 1,
    "{\"scale\":30}": 1
  },
  "HASH_BUCKET": { "{}": 64 },
  "ONE_HOT": { "{}": 23 },
  "RATIO_0_1": { "{}": 1 }
}
```

- **Family 内パラメータの多様性**:
  - `NONNEGATIVE_COUNT` は均一な単一 $s$ ではなく、$s \in \{4, 5, 10, 50\}$ の 4 水準を持つ。スーツ枚数など小カウントは $s=4$、合法手数など大カウントは $s=50$。
  - `AGGREGATE_SUM` は $s \in \{20, 30\}$ の 2 水準を持つ。
  - `SIGNED_DELTA` は $s \in \{10, 20, 30\}$ の 3 水準を持つ。
- **設計原則**:
  - $f(s) = 0.50$（半飽和点）が各特徴量の通常対戦局面における頻出範囲中央に一致するよう設定。

---

## 16. Mathematical Invariants (数理的不変条件の保証)

### 16.1 特徴量ベクトルの有界性
$$\forall i \in [0, 162], \quad c_i \in [-1, 1] \implies c \in [-1, 1]^{163}$$
$$\forall j \in [0, 142], \quad p_j \in [-1, 1] \implies p \in [-1, 1]^{143}$$

### 16.2 相互作用増幅率の有界性 (Interaction Amplification Invariant)
$$\forall i, j, \quad |c_i \cdot p_j| \le 1.0$$

### 16.3 単一相互作用項の寄与上限 (Interaction Term Bound)
$$\forall i, j, \quad |M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$$
- **重要注記**: 未正規化特徴量によって重みが百倍以上に増幅される現象は完全に排除される。

### 16.4 Pattern 線形項の寄与上限 (Linear Pattern Term Bound)
$$\forall j, \quad |w_j \cdot p_j| \le |w_j|$$

### 16.5 スコア全体の包括有界性
$$|S(p)| \le \sum_{j=0}^{142} |w_j| + \sum_{i=0}^{162} \sum_{j=0}^{142} |M_{ij}|$$
DNA の全重みの $L_1$ ノルムによってスコアの絶対上限が拘束される。

---

## 17. Concavity / Saturation Tradeoff (凹性と飽和のトレードオフ)

### 17.1 凹関数（Concave）による表現特性
$f(x) = \frac{x}{x+s}$ は $x \ge 0$ において**凹関数（concave）**である：
$$f''(x) = -\frac{2s}{(x+s)^3} < 0$$
- **意味**: 生値が小さい領域での出力変化（限界感度）は、生値が大きい領域での変化よりも大きくなる。
- **カードゲームにおける妥当性**: 「手札が 0枚か 1枚か」は致命的な違いであるが、「10枚か 11枚か」は戦術的に同等の意味しか持たないことが多く、ゲーム理論的に合理的である。

### 17.2 トレードオフ・リスク
- 生値が極端に大きい領域（$x \gg s$）では $f(x)$ が 1.0 に漸近するため、生値が 100 と 130 の間の微細な差はスコア上で圧縮される（感度飽和）。

---

## 18. Architecture Ownership (アーキテクチャと責務分離)

```
+--------------------------------------------------------------+
|                    DecisionFeatureSchema                     |
|  - schemaVersion: 5                                          |
|  - contextDim: 163, patternDim: 143                          |
|  - scalingRegistry: FeatureScalingRegistry                   |
+--------------------------------------------------------------+
                               | owns
                               v
+--------------------------------------------------------------+
|                    DecisionFeatureEncoder                    |
|  - extracts raw features from DecisionRequest                |
|  - applies pure scaling functions per registry               |
|  - returns scaled EncodedDecisionFeatures:                   |
|      Context: c in [-1, 1]^163                               |
|      Pattern: p in [-1, 1]^143                               |
+--------------------------------------------------------------+
                               | feeds normalized vectors
                               v
+--------------------------------------------------------------+
|                         GenomeScorer                         |
|  - evaluates: S(p) = Σ w_j * p_j + Σ M_ij * c_i * p_j        |
|  - completely generic: no feature names or scaling parameters|
+--------------------------------------------------------------+
```
- **DecisionFeatureSchema**: レジストリ定義およびバージョン統括の単一責任。
- **DecisionFeatureEncoder**: 生値抽出とレジストリに基づく正規化適用の単一責任。出力は包括有界域 $c \in [-1, 1]^{163}, p \in [-1, 1]^{143}$。
- **GenomeScorer**: 正規化された純粋な数値ベクトルに対する内積計算に専念。特徴量名やスケーリングパラメータは一切知らず、ジェネリック性を完全に維持する。

---

## 19. Schema Versioning (スキーマバージョニング)

- **現行（未正規化・生値）**: `FEATURE_SCHEMA_VERSION = 4`
- **新仕様（有界スケーリング）**: `FEATURE_SCHEMA_VERSION = 5`
- **理由**: 次元数・インデックス順序は同一であるが、出力数値の意味（セマンティクス）が非可逆的に変化するため。同一バージョン番号での黙示的な動作変更を厳格に禁止する。

---

## 20. DNA Compatibility (DNA 互換性ゲート)

- **Fail-Closed 契約**:
  - `GenomeScorer.score()` は `dna.featureSchemaVersion !== features.featureSchemaVersion` を検知した際、直ちに例外 `DecisionDNAExecutionError` をスローする。
  - Schema v4 の DNA を Schema v5 の環境で評価することはできない。

---

## 21. Migration Policy (移行方針)

- **サイレント移行の厳格禁止**:
  - Schema v4 DNA の `featureSchemaVersion` を機械的に `5` に書き換える移行は禁止する。
- **フレッシュ進化（Fresh Evolution）の原則**:
  - Schema v5 の検証は、初期親個体（g0: 全重み 0）からの新規進化探索によって実施する。

---

## 22. Determinism (決定論性の保証)

- **超越関数の排除**:
  - `Math.tanh`, `Math.exp`, `Math.log` などの超越関数ライブラリ依存を排し、初等有理式と除算のみを用いることで、C ランタイム（libm）依存による微小な丸め誤差リスクを低減する。
- **過剰主張の排除**:
  - IEEE-754 浮動小数点演算そのものの一般的制約を超えて「全プラットフォーム差が数学的に不可能」といった過剰主張は行わない。

---

## 23. Numeric Safety (数値安全性)

将来の実装において以下のフェイルクローズド設計を適用する：
1. **非有限数の拒絶**: 入力生値が `NaN`, `Infinity`, `-Infinity` の場合は直ちに例外をスロー。
2. **不正パラメータの拒絶**: スケールパラメータ $s \le 0$ または上限値 $B \le 0$ の場合は初期化時に例外をスロー。
3. **ゼロ除算保護**: $x \ge 0$ かつ $s > 0$ であるため、分母 $x + s \ge s > 0$ となり、ゼロ除算は原理的に発生しない。

---

## 24. Future Test Plan (実装フェーズにおけるテスト計画)

`BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1` において実装すべき検証テスト群：

1. **Registry Coverage & Integrity**: 306 特徴量すべてが登録され、インデックス・名称が `DecisionFeatureTypes.ts` とビット完全一致すること。
2. **Pure Scaling Functions Invariants**:
   - `identity`: 0 および 1 がそのまま出力されること。
   - `linear_bound_division`: 0..13 が $[0, 1]$ 内に正しく等間隔射影されること。
   - `saturating_rational`: 任意の非負入力 $x \ge 0$ に対し $f(x) \in [0, 1)$、単調増加性、凹性、原点保存性を検証。
   - `signed_saturating_rational`: 任意の $x \in \mathbb{R}$ に対し $f(x) \in (-1, 1)$、奇対称性、原点保存性を検証。
3. **Encoder Integration Invariants**:
   - 実際の `DecisionRequest` をエンコードした結果、全 163 Context 特徴量が $[-1, 1]$、全 143 Pattern 特徴量が $[-1, 1]$ に収まっていること。
4. **Schema v5 Compatibility Fail-Closed**: Schema v4 DNA を渡した際に `DecisionDNAExecutionError` が正しくスローされること。
5. **Zero DNA Behavioral Preservation**: 親個体（全重み 0）において、Schema v4 と Schema v5 で合法手のスコア（全手 0）およびタイブレーク挙動が完全一致すること。

---

## 25. Future A/B Evidence Protocol (将来の A/B 実機検証プロトコル)

1. **Gene-Level Isolation (遺伝子レベルの完全単離)**:
   - 同一の PRNG シード（seed = 42）
   - 同一の親個体（g0: 全重み 0）
   - 同一の突然変異設定（$p_m = 0.01, \sigma = 0.05$）
   - 同一の集団サイズ（$N = 6$）およびラウンド数（$R = 1$）
   - これにより、g1 のオフスプリング重み配列（`patternWeights`, `contextPatternWeights`）は Schema v4 と Schema v5 で**ビット完全一致**する。
2. **突然変異スケールと重み境界の整理**:
   - `mutationSigma = 0.05` は正規分布摂動の標準偏差であり、重みの絶対上限ではない。
   - したがって、個別の重み $|M_{ij}|$ や線形重み $|w_j|$ は $0.05$ を超え得る。
3. **検証すべき数理的不変条件**:
   - 相互作用増幅率: $|c_i \cdot p_j| \le 1.0$
   - 各相互作用項: $|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$
   - 各線形項: $|w_j \cdot p_j| \le |w_j|$
4. **主たる行動観測指標**:
   - 完了試合数および未完了試合数（v4 の 2/30 からの改善度合い）
   - 総 PASS 回数（v4 の 11,908回からの変化）
   - `action.end` 合法手時の PASS 勝率（v4 の 99.90% からの低下）
   - 各項の寄与度と重みの比率 $\frac{|M_{ij} \cdot c_i \cdot p_j|}{|M_{ij}|} \le 1.0$（非ゼロ重み時）の検証

---

## 26. Explicit Non-Claims (明示的な非主張)

1. **本スケーリング設計単独で PASS Stall の完全解消を証明したとは主張しない**。
2. **ルール変更（Turn Player 空ステージ時 PASS 禁止等）が不要になったとは主張しない**。
3. **現行の Core Flow が完全に正当であるとは主張しない**。
4. **突然変異率や分散の設定が不適切であったとは主張しない**。
5. **適応度関数（MPA Fitness）の再設計が不要であるとは主張しない**。
6. **複数世代進化（Multi-Generation）の完走が保証されたとは主張しない**。
7. **大規模検証（N=100）の準備が完了したとは主張しない**。

---

## 27. Implementation Scope Proposal (次期実装作業の提案)

独立レビュー承認後、以下の作業単位で実装を進める：
- **作業ID**: `BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1`
- **実装対象**:
  1. `src/engine/ai/FeatureScaling.ts` (純粋関数の実装)
  2. `src/domain/ai/DecisionFeatureTypes.ts` (`FEATURE_SCHEMA_VERSION = 5` へのインクリメント、レジストリ型の定義)
  3. `src/engine/ai/DecisionFeatureEncoder.ts` (レジストリに基づくスケーリング適用の統合)
  4. ユニットテスト群の実装
  5. Controlled One-Generation (N=6, R=1, 30試合) A/B 実機検証の実施

---

## 28. Remaining Scope (残余スコープのステータス)

| 項目 | ステータス | 備考 |
| :--- | :--- | :--- |
| **Evolution Loop Design** | **FORMAL ACCEPTED** | V1-R2 設計完了 |
| **Evolution Loop Production** | **FORMAL ACCEPTED** | 実装・テスト完了 |
| **DNA PASS Analysis V1-R2** | **FORMAL ACCEPTED** | SHA: `36816a1893512c8bf602a9ffc5a10dcf45b92041` |
| **Feature Scaling Design V1** | **NOT ACCEPTED** | プロセス違反および集計不整合により却下 |
| **Feature Scaling Design V1-R1** | **NOT ACCEPTED** | Parameter不一致、Context値域誤記、固定上限誤記により却下 |
| **Feature Scaling Design V1-R2** | **DESIGNED / PENDING INDEPENDENT REVIEW** | 本仕様書および R2 Registry |
| **Feature Scaling Implementation** | **NOT STARTED** | 設計レビュー完了後に着手 |
| **Controlled Multi-Generation** | **BLOCKED / WAITING** | スケーリング実装完了まで保留 |
| **Rule-side PASS / Core Flow** | **SEPARATE DISCUSSION** | 別ブランチ・別スレッドで協議継続 |
| **N=100 Multi-Generation** | **NOT EXECUTED** | 安定化完了後に実施 |
