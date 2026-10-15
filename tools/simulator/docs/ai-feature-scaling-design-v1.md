# BlackPoker Simulator - Decision Feature Scaling Design V1

## 0. Document Identity & Status

- **Work ID**: `BP-SIM-AI-FEATURE-SCALING-DESIGN-V1`
- **Baseline Work ID**: `BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R2` (FORMAL ACCEPTED, SHA: `36816a1893512c8bf602a9ffc5a10dcf45b92041`)
- **Status**: **DESIGNED / PENDING INDEPENDENT REVIEW**
- **Formal Status**: Antigravity declares **NO FORMAL ACCEPTED** (Independent Review Gate only).
- **Target Branch**: `BlackPoker/issue551-core-flow`
- **Evaluation Regulation**: Official `light-entry16`
- **Scope**: **DESIGN ONLY** (No production changes, no test changes, no rules changes, no evolution execution).
- **Canonical Machine-Readable Registry**: [`tools/simulator/docs/ai-feature-scaling-registry-v1.json`](file:///c:/Users/black/git/github/BlackPoker-issue551/tools/simulator/docs/ai-feature-scaling-registry-v1.json)

---

## 1. Scope

本設計書は、BlackPoker Simulator の AI 意思決定特徴量（Decision Features）において観測された未正規化特徴量によるスコア増幅問題（`FEATURE_SCALE_AMPLIFICATION`）を解決するための **特徴量スケーリング・正規化仕様（Feature Scaling Design V1）** を定義するものです。

### スコープ境界の原則
1. **設計専念（DESIGN ONLY）**: Production コード（`DecisionFeatureEncoder.ts`, `GenomeScorer.ts` 等）、テストコード、ルール・Core Flow 実装への変更は一切行いません。
2. **ルール議論との完全分離**: 別ブランチ・別会話で検討されている「Turn Player は Stage が空のとき PASS できない」等のゲームルール変更とは完全に独立して設計します。本スケーリング設計によって「ルール側の修正が不要である」あるいは「Core Flow が正当である」と結論づけることはしません。
3. **全 306 特徴量の網羅**: Context 特徴量（163次元）のみならず、Pattern 特徴量（143次元）を含むすべての特徴量を一貫した数学的体系のもとで設計します。

---

## 2. Accepted R2 Evidence (前提エビデンス)

`BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R2`（コミット `36816a1893512c8bf602a9ffc5a10dcf45b92041`）において確定された主要エビデンス：

1. **Generation 1 の試合結果**:
   - スケジュール: 30 試合
   - 完走: 2 試合（Match #28, #29: `offspring-000004` vs `genome-001`）
   - 未完了: 28 試合（Match #0 〜 #27: 最大判断回数 500 decisions 到達）
2. **オフスプリングの PASS 選択内訳（11,908 decisions）**:
   - `STRICT_PASS_WIN`: **9,923 (83.33%)** [$\text{score}(\text{PASS}) > \max(\text{score}(\text{non-PASS}))$]
   - `FORCED_PASS`: **1,985 (16.67%)** [非 PASS 合法手が存在しない局面]
   - `TIE_BREAK_PASS`: **0 (0.00%)** [タイブレークによる PASS はゼロ]
3. **`action.end` 合法局面での格差（6,846 decisions）**:
   - $\text{PASS} > \text{End}$: 6,839 (99.90%)
   - $\text{PASS} == \text{End}$: 0 (0.00%)
   - $\text{PASS} < \text{End}$: 7 (0.10%)
   - PASS 選択時の平均マージン: $+1.4486$（PASS 平均 $+0.9187$, End 平均 $-0.5299$）
4. **連続質量分析（Magnitude Mass）**:
   - 正の累積マージン質量: $22,512.47$
   - **Positive Non-PASS Suppression Mass (他手減点): $14,492.97$ (64.38%)**
   - **Positive PASS Uplift Mass (PASS加点): $8,019.50$ (35.62%)**
5. **未正規化特徴量の極端な増幅係数**:
   - `legal_action_timing_quick_count` (Context 16): 観測最大値 **126**（平均 24.14）
   - `legal_non_pass_pattern_count` (Context 12): 観測最大値 **137**（平均 28.91）
   - `self_hand_value_sum` (Context 32): 観測最大値 **82**（平均 33.95）

**R2 の核心的結論**:
微小な変異重み（例: $w = -0.0827$）であっても、未正規化の生整数特徴量（$c_i = 126$）との積によって $-10.42$ という壊滅的なペナルティに増幅され、AI の意思決定を極端に歪めていました。

---

## 3. Problem Definition (問題の定式化)

### 3.1 探索におけるスケール不均衡病理
進化計算（Evolutionary Search）において、初期重み $0.0$ から正規分布的摂動（$\sigma = 0.05$）によって発生する変異は、全パラメータ空間において等方的（Isotropic）に探索を行うことが期待されます。
しかし、特徴量のスケールが $[0, 1]$ のフラグから $[0, 137]$ のカウント値まで混在している場合：
- ブール特徴量（$c = 1$）の変異 $w = 0.05$ は、スコアにわずか $+0.05$ の影響しか与えません。
- クイックアクション数（$c = 126$）の変異 $w = 0.05$ は、スコアに $+6.30$ の影響を与えます（**126 倍の感度格差**）。

この結果、AI はゲーム戦略上重要であるかどうかにかかわらず、**「単に数値の単位系が大きい特徴量」にランダム変異が当たった瞬間に、その重み符号によって行動が完全に支配される** という病理的挙動（Pathological Behavior）を示します。

### 3.2 なぜ Context だけの正規化では不十分なのか
R2 分析では Context 特徴量の巨大さが主に観測されましたが、Pattern 特徴量にも以下のような生数値特徴量が存在します：
- `cost_total_item_count`: 支払うコスト総数（0〜16+）
- `key_card_value_sum`: 選択カードの値合計（0〜50+）
- `selected_unit_size_sum`: 選択ユニットのサイズ合計（0〜30+）
- `effect_selected_card_value_sum`: 効果選択カードの値合計（0〜50+）
- `effect_assignment_size_delta_sum`: アサインメントのサイズ差分（$-30 \sim +30$）

もし Context のみを正規化し Pattern を生のまま残した場合、相互作用項 $M_{ij} \cdot c_i \cdot p_j$ において $p_j$ による増幅が依然として発生します。
したがって、**全 163 Context 特徴量および全 143 Pattern 特徴量（合計 306 特徴量）のすべてを対象とした統一スケーリング設計** が不可欠です。

---

## 4. Current Feature Schema

現行の Feature Schema v4 構成：

- **`FEATURE_SCHEMA_VERSION`**: `4`
- **`CONTEXT_FEATURE_DIMENSION`**: `163`
- **`PATTERN_FEATURE_DIMENSION`**: `143`
- **Context-Pattern 相互作用次元数**: $163 \times 143 = 23,309$
- **Total DNA Weights**: $143 + 23,309 = 23,452$

### 構造不変性の原則
本設計では、特徴量の **順序（Ordering）および総次元数（163 / 143）を一切変更しません**。
これにより、Implementation 後の検証において、同一シード・同一 Zero DNA から生成される突然変異のインデックスおよび数値重み配列が、v4（R2）と **ビットレベルで 100% 同一（Isomorphic）** となり、特徴量スケーリングのみの効果を完全に単離した A/B 実証が可能となります。

---

## 5. Mathematical Risk (数学的リスク)

現行の GenomeScorer スコア計算式：
$$\text{score}(p) = \sum_{j=0}^{142} w_j \cdot p_j + \sum_{i=0}^{162} \sum_{j=0}^{142} M_{ij} \cdot c_i \cdot p_j$$

### 増幅の上限不在リスク
未正規化状態では、$c_i \in [0, 137]$、$p_j \in [0, 50]$ となり得るため：
$$|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}| \times 137 \times 50 = 6,850 \times |M_{ij}|$$
微小変異 $|M_{ij}| \approx 0.05$ に対し、単一の相互作用項が最大で $\pm 342.5$ に達する潜在的爆発リスクを孕んでいます。

### 有界スケーリングによる不変条件
もしすべての特徴量が $|c_i| \le 1$ かつ $|p_j| \le 1$ に収まるならば：
$$|c_i \cdot p_j| \le 1$$
$$|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$$
$$\left| \sum_{j} w_j \cdot p_j \right| \le \sum_{j} |w_j|$$
となり、**単一の相互作用項が自身の変異重み $|M_{ij}|$ を超えてスコアを増幅することが数学的に不可能** となります。

---

## 6. Design Goals (設計目標)

1. **増幅係数の完全抑制（Interaction Bound）**:
   すべての特徴量を原則 $[-1, 1]$（非負特徴量は $[0, 1]$ または $[0, 1)$）に収め、$|c_i \cdot p_j| \le 1$ を保証する。
2. **順序保存性（Monotonicity）**:
   値の大小関係を厳格に保持する（$x_1 < x_2 \implies f(x_1) < f(x_2)$）。
3. **ゼロ保存性（Zero-Preserving）**:
   無（不在・ゼロ）の意味論を維持する（$f(0) = 0$）。
4. **符号保存性（Sign-Preserving）**:
   相対差分特徴量の有利・不利の符号を維持する（$\operatorname{sgn}(f(x)) = \operatorname{sgn}(x)$、奇関数対称性 $f(-x) = -f(x)$）。
5. **完全決定論性・環境非依存（Determinism）**:
   データセット統計（平均・分散・最大値）やバッチ実行履歴に一切依存せず、同一の観測入力に対して常に同一の数値を返す。
6. **超越関数排除（Algebraic Purity）**:
   初等超越関数（`Math.tanh`, `Math.log` 等）を排除し、有理演算のみで構成することで、CPU アーキテクチャやランタイム間の浮動小数点 ULP 差異を排除する。
7. **汎用性・ルール非依存（Generic & Rule-Agnostic）**:
   特定のアクション名（`action.pass`, `action.end`, `action.attack` 等）に対する個別係数やハードコードを一切持たない。

---

## 7. Non-Goals (非目標・禁止事項)

1. **PASS 問題の直接的ハードコードパッチ**:
   `pattern_is_pass` だけ重みを下げる、PASS スコア上限を設ける、PASS にペナルティを課す等の個別調整は行いません。
2. **特定アクションへの優遇・冷遇**:
   `action.end` や `action.attack` にボーナスを与える調整は行いません。
3. **データセット依存型スケーリングの導入**:
   バッチ単位 Min-Max、世代単位 Z-Score、Running Normalization、対戦ログ学習スケーラーは、決定論性と Replay 性を破壊するため **厳格に禁止** します。
4. **突然変異・適応度設計の変更**:
   突然変異率 1% や $\sigma = 0.05$、Outcome-First MPA 適応度関数の変更は行いません。
5. **ルール・Core Flow 変更の代用**:
   本設計をもって、Core Flow 側の PASS 合法性議論を代替・不要化することはしません。

---

## 8. Candidate Scaling Functions (候補スケーリング関数)

### 候補 A: Identity (恒等変換)
$$f(x) = x$$
- **特徴**: 無変換。
- **適性**: すでに $[0, 1]$ に収まっている `BOOLEAN`, `ONE_HOT`, `HASH_BUCKET`, `RATIO_0_1` に最適。

### 候補 B: Fixed Bound Division (固定上限除算)
$$f(x) = \frac{x}{B}$$
- **特徴**: 理論的上限 $B$ で線形スケーリング。
- **適性**: トランプのランク（$1 \sim 13$）のように明確な理論上限が存在し、区間の等間隔性を維持したい `BOUNDED_CARD_VALUE`（$B=13$）に最適。

### 候補 C: Clamped Linear Division (クランプ付き除算)
$$f(x) = \operatorname{clamp}\left(\frac{x}{B}, 0, 1\right)$$
- **特徴**: $B$ を超える値を $1.0$ にフラット化。
- **欠点**: $B$ を超えた領域で導関数が $0$ になり、大小順序情報が完全に破壊される。不採用。

### 候補 D: Log1p / Signed-Log1p (対数変換)
$$f(x) = \frac{\log(1 + x)}{\log(1 + B)} \quad (x \ge 0)$$
- **特徴**: 巨大な値を緩やかに圧縮。
- **欠点**: 上限が有界にならず、固定 $B$ で割ると $x > B$ で $1$ を超過するか、クランプが必要。超越関数依存。不採用。

### 候補 E: Saturating Rational (飽和有理関数)
非負特徴量：
$$f(x) = \frac{x}{x + s} \quad (s > 0, x \ge 0)$$
符号付き相対特徴量（Signed Saturating Rational）：
$$f(x) = \frac{x}{|x| + s} \quad (s > 0, x \in \mathbb{R})$$
- **特徴**:
  - 任意の $x \in [0, \infty)$ に対し、出力は厳格に $[0, 1)$ に収まる。
  - 任意の $x \in (-\infty, \infty)$ に対し、出力は厳格に $(-1, 1)$ に収まる。
  - 厳格に狭義単調増加（$f'(x) = \frac{s}{(x+s)^2} > 0$）。
  - $f(0) = 0$。
  - 符号付きにおいて完全な奇関数対称性（$f(-x) = -f(x)$）。
  - **パラメータ $s$ の物理的意味が直感的**: $x = s$ のとき $f(s) = 0.50$（半飽和スケール）。
  - 有理演算のみ（除算・加算・絶対値）で完結し、超越関数によるクロスプラットフォーム差異が原理的に発生しない。
  - $x \ll s$ では線形近似（$f(x) \approx x/s$）として機能し、小値の解像度が高い。

### 候補 F: Hyperbolic Tangent (双曲線正接)
$$f(x) = \tanh\left(\frac{x}{s}\right)$$
- **特徴**: 滑らかな S 字飽和。
- **欠点**: $x \to 0$ 近傍で傾きが急峻になりすぎること、および `Math.tanh` が初等超越関数であり、プラットフォーム差異リスクが残ること。Saturating Rational に劣る。

---

## 9. Comparison Matrix (候補比較評価行列)

| 評価軸 | A. Identity | B. Bound Division | C. Clamp | D. Log1p | E. Saturating Rational (採用) | F. Tanh |
|---|---|---|---|---|---|---|
| **有界性 ($[-1, 1]$)** | 劣 (非有界) | 否 (上限超過時) | 良 ($[0, 1]$) | 否 (上限超過時) | **最優 ($[0, 1)$ / $(-1, 1)$)** | 優 ($(-1, 1)$) |
| **単調性保持** | 最優 (完全) | 最優 (完全) | 劣 ($x>B$ で flat) | 最優 (完全) | **最優 (狭義単調増加)** | 最優 (完全) |
| **ゼロ保存 ($f(0)=0$)** | 最優 | 最優 | 最優 | 最優 | **最優** | 最優 |
| **符号保存 ($f(-x)=-f(x)$)** | 最優 | 最優 | 否 | 良 | **最優 (完全奇関数)** | 最優 |
| **パラメータ解釈性** | なし | 上限値 $B$ | クランプ閾値 | 底・規格化係数 | **最優 ($s$ は半飽和点 0.5)** | 尺度係数 |
| **決定論性・純粋有理演算** | 最優 | 最優 | 最優 | 劣 (超越関数) | **最優 (基本四則演算のみ)** | 劣 (超越関数) |
| **将来フォーマット耐性** | 劣 | 劣 (デッキ増加で破綻) | 劣 | 良 | **最優 (無制限に安全有界)** | 最優 |
| **小値解像度** | 最優 | 良 | 良 | 普 | **優 ($x \ll s$ で線形応答)** | 普 |
| **大値安定性** | 最悪 | 劣 | 普 (情報消失) | 普 | **最優 (滑らかに 1.0 へ漸近)** | 優 |
| **相互作用上限保証** | 否 | 否 | 良 | 否 | **最優 ($|c_i \cdot p_j| \le 1$)** | 最優 |
| **実装複雑度** | 最小 | 最小 | 小 | 中 | **極小 (1行の有理式)** | 小 |

---

## 10. Feature Classification Model (特徴量分類モデル)

全 306 特徴量は、その意味論および生値の定義域に基づき以下の 9 クラスに完全分類されます：

| 分類クラス | 定義・意味論 | 該当特徴量例 | 生値定義域 | 適用スケーリング関数 | 出力定義域 |
|---|---|---|---|---|---|
| **`BOOLEAN`** | 二値フラグ（真偽値） | `self_is_turn_player`, `has_action`, `target_is_unit` | $\{0, 1\}$ | `identity` | $[0, 1]$ |
| **`ONE_HOT`** | 排他的カテゴリ分類 | `pattern_is_action`, `action_speed_normal` | $\{0, 1\}$ | `identity` | $[0, 1]$ |
| **`HASH_BUCKET`** | 多重ハッシュ同一性ビット | `request_action_bucket_0..15`, `effect_option_bucket_0..15` | $\{0, 1\}$ | `identity` | $[0, 1]$ |
| **`RATIO_0_1`** | 既正規化割合・カバレッジ | `effect_selection_coverage_ratio` | $[0, 1]$ | `identity` | $[0, 1]$ |
| **`BOUNDED_CARD_VALUE`** | 単一カードのランク数値 | `self_hand_value_max/min`, `key_card_value_max/min` | $[0, 13]$ | `linear_bound_division` ($B=13$) | $[0, 1]$ |
| **`NONNEGATIVE_COUNT`** | 非負の個数・件数カウント | `turn_count`, `hand_count`, `legal_pattern_count` | $[0, \infty)$ | `saturating_rational` ($s \in \{2, 4, 5, 10, 50\}$) | $[0, 1)$ |
| **`AGGREGATE_SUM`** | カード数値・ユニットサイズの合計 | `self_hand_value_sum`, `key_card_value_sum` | $[0, \infty)$ | `saturating_rational` ($s \in \{20, 30\}$) | $[0, 1)$ |
| **`SIZE`** | ユニット単体のサイズ値 | `self_field_size_max`, `target_unit_size` | $[0, \infty)$ | `saturating_rational` ($s=10$) | $[0, 1)$ |
| **`SIGNED_DELTA`** | 自身と相手の差分・アサインメント差 | `relative_hand_count`, `effect_assignment_size_delta_sum` | $(-\infty, \infty)$ | `signed_saturating_rational` ($s \in \{5, 10, 20, 30\}$) | $(-1, 1)$ |

---

## 11. Context Feature Registry Summary (163 特徴量)

全 163 Context 特徴量のクラス別・カテゴリ別集約：

### 11.1 クラス別内訳
- **`BOOLEAN`**: 51 特徴量（Decision Context 6, Target 11, Zone Flags 18, Request Source 16）
- **`ONE_HOT`**: 8 特徴量（Action Speed 3, Action Timing 5）
- **`HASH_BUCKET`**: 32 特徴量（Action Buckets 16, Effect Step Buckets 16）
- **`BOUNDED_CARD_VALUE`**: 6 特徴量（Hand Max/Min 2, Grave Top 2, Request Key Max/Min 2）
- **`NONNEGATIVE_COUNT`**: 53 特徴量（Turn Count 1, Stage Depth 1, Legal Counts 11, Zone Counts 40）
- **`AGGREGATE_SUM`**: 6 特徴量（Hand Sum 1, Field Size Sum 1, Trump Size Sum 1, Opp Field Size Sum 1, Opp Trump Size Sum 1, Request Key Sum 1）
- **`SIZE`**: 3 特徴量（Self Field Size Max 1, Opp Field Size Max 1, Request Target Unit Size 1）
- **`SIGNED_DELTA`**: 9 特徴量（Relative Hand, Field, Field Size Sum, Fog, Grave, Pack, Rare, Trump, Life）

### 11.2 代表的特徴量のスケーリング例
| Context Index | 特徴量名 | 生値最大 (R2) | スケーリング関数 | パラメータ | スケール後値 (R2 Max) |
|---|---|---|---|---|---|
| 6 | `turn_count` | 7 | `saturating_rational` | $s = 10$ | $7 / (7 + 10) = 0.412$ |
| 7 | `stage_depth` | 6 | `saturating_rational` | $s = 4$ | $6 / (6 + 4) = 0.600$ |
| 12 | `legal_non_pass_pattern_count` | **137** | `saturating_rational` | $s = 50$ | **$137 / (137 + 50) = 0.733$** |
| 16 | `legal_action_timing_quick_count` | **126** | `saturating_rational` | $s = 50$ | **$126 / (126 + 50) = 0.716$** |
| 32 | `self_hand_value_sum` | **82** | `saturating_rational` | $s = 30$ | **$82 / (82 + 30) = 0.732$** |
| 33 | `self_hand_value_max` | 13 | `linear_bound_division` | $B = 13$ | $13 / 13 = 1.000$ |
| 90 | `relative_hand_count` | $+5$ / $-5$ | `signed_saturating_rational` | $s = 10$ | $\pm 5 / (5 + 10) = \pm 0.333$ |
| 92 | `relative_field_size_sum` | $+20$ / $-20$ | `signed_saturating_rational` | $s = 30$ | $\pm 20 / (20 + 30) = \pm 0.400$ |

---

## 12. Pattern Feature Registry Summary (143 特徴量)

全 143 Pattern 特徴量のクラス別・カテゴリ別集約：

### 12.1 クラス別内訳
- **`BOOLEAN`**: 25 特徴量（Has Action 1, Has Cost 1, Has Key 2, Target Flags 12, Effect Flags 9）
- **`ONE_HOT`**: 15 特徴量（Pattern Kind 4, Action Speed 3, Action Timing 5, Effect Type 3）
- **`HASH_BUCKET`**: 32 特徴量（Candidate Action Buckets 16, Effect Option Buckets 16）
- **`RATIO_0_1`**: 1 特徴量（`effect_selection_coverage_ratio`）
- **`BOUNDED_CARD_VALUE`**: 4 特徴量（Key Card Max/Min 2, Effect Selected Card Max/Min 2）
- **`NONNEGATIVE_COUNT`**: 48 特徴量（Cost Items 5, Key Card/Unit Counts 13, Effect Selection Counts 30）
- **`AGGREGATE_SUM`**: 7 特徴量（Key Card Value Sum, Key Unit Size Sum, Effect Card Value Sum, Effect Unit Size Sum, Assign Source/Selected Size Sum）
- **`SIZE`**: 8 特徴量（Target Unit Size 1, Selected Unit Size Max 1, Effect Unit Size Max/Min 2, Assign Source Max/Min 2, Assign Selected Max/Min 2）
- **`SIGNED_DELTA`**: 1 特徴量（`effect_assignment_size_delta_sum`）

### 12.2 代表的特徴量のスケーリング例
| Pattern Index | 特徴量名 | 生値想定範囲 | スケーリング関数 | パラメータ | スケール後値例 |
|---|---|---|---|---|---|
| 0 | `pattern_is_action` | $\{0, 1\}$ | `identity` | なし | $1.000$ |
| 1 | `pattern_is_pass` | $\{0, 1\}$ | `identity` | なし | $1.000$ |
| 34 | `cost_total_item_count` | $0 \sim 8$ | `saturating_rational` | $s = 5$ | コスト2個: $2 / 7 = 0.286$ |
| 38 | `key_card_value_sum` | $0 \sim 30$ | `saturating_rational` | $s = 20$ | 合計15: $15 / 35 = 0.429$ |
| 39 | `key_card_value_max` | $0 \sim 13$ | `linear_bound_division` | $B = 13$ | エース: $1/13 = 0.077$, キング: $1.000$ |
| 62 | `target_unit_size` | $0 \sim 13+$ | `saturating_rational` | $s = 10$ | サイズ8: $8 / 18 = 0.444$ |
| 133 | `effect_assignment_size_delta_sum` | $-20 \sim +20$ | `signed_saturating_rational` | $s = 20$ | 差分+5: $+5 / 25 = +0.200$ |
| 140 | `effect_selection_coverage_ratio` | $[0, 1]$ | `identity` | なし | $0.500$ |

---

## 13. Canonical Scaling Policy (カノニカルスケーリング規約)

### 13.1 スケーリング関数の正式仕様
実装において提供されるスケーリング関数は以下の 4 種に厳格に限定されます：

1. **`identity(x: number): number`**:
   $$f(x) = x$$
2. **`linear_bound_division(x: number, bound: number): number`**:
   $$f(x) = \frac{x}{\text{bound}}$$
3. **`saturating_rational(x: number, scale: number): number`**:
   $$f(x) = \frac{x}{x + \text{scale}}$$
4. **`signed_saturating_rational(x: number, scale: number): number`**:
   $$f(x) = \frac{x}{|x| + \text{scale}}$$

### 13.2 採用理由と数学的優位性
- **ゼロ除算の原理的不可能性**: すべてのスケールパラメータは $s \ge 2 > 0$ であり、$x \ge 0$ に対し分母 $x + s \ge s > 0$、また $|x| + s \ge s > 0$ であるため、浮動小数点のゼロ除算は発生しません。
- **IEEE 754 決定論性**: 加算・乗算・除算・絶対値のみで構成され、超越関数ライブラリ（libm）依存の丸め誤差や環境差異を排除します。
- **物理的直感性**: パラメータ $s$ が「ゲーム上で典型的な中庸値（半飽和点）」を表し、保守・レビューが容易です。

---

## 14. Scaling Parameter Policy (パラメータ設計規約)

306 個の特徴量それぞれに個別の定数を割り当てること（Magic Number の乱立）を厳禁とし、以下の **7 つの共通セマンティックファミリー** にパラメータを統一します：

| パラメータファミリー | 設定値 | 対象特徴量の性質 | 代表例 |
|---|---|---|---|
| **`CARD_RANK_BOUND`** | $B = 13$ | トランプのランク（1〜13） | `self_hand_value_max/min`, `key_card_value_max` |
| **`COUNT_SMALL`** | $s = 4$ | 通常 0〜4 程度で推移する小カウント | `stage_depth`, スート別枚数, 絵札枚数, アタッカー数 |
| **`COUNT_MEDIUM_ZONE`** | $s = 5$ or $10$ | 盤面ゾーンの保有枚数・ユニット数 | $s=5$: `field_count`, `fog_count`<br>$s=10$: `hand_count`, `grave_count`, `life_count` |
| **`COUNT_LARGE_LEGAL`** | $s = 50$ | 組み合わせにより数十〜百超に達する合法手件数 | `legal_pattern_count`, `legal_timing_quick_count` |
| **`UNIT_SIZE`** | $s = 10$ | ユニット単体のサイズ値 | `field_size_max`, `target_unit_size` |
| **`AGGREGATE_SUM`** | $s = 20$ or $30$ | 複数カードやユニットの数値合計値 | $s=20$: パターン選択合計 (`key_card_value_sum`)<br>$s=30$: 全ゾーン合計 (`self_hand_value_sum`) |
| **`SIGNED_DELTA`** | $s = 10$ or $30$ | 自身と相手の差分 | $s=10$: 枚数差 (`relative_hand_count`)<br>$s=30$: サイズ合計差 (`relative_field_size_sum`) |

---

## 15. Mathematical Invariants (数学的不変条件)

実装およびテストにおいて必ず検証される 7 つの Mathematical Invariants：

- **Invariant 1 (Context Range Bound)**:
  すべての Context 特徴量 $c_i$ に対し、$-1.0 \le c_i \le 1.0$。非負特徴量は $0.0 \le c_i < 1.0$ または $0.0 \le c_i \le 1.0$。
- **Invariant 2 (Pattern Range Bound)**:
  すべての Pattern 特徴量 $p_j$ に対し、$-1.0 \le p_j \le 1.0$。非負特徴量は $0.0 \le p_j < 1.0$ または $0.0 \le p_j \le 1.0$。
- **Invariant 3 (Interaction Term Bound)**:
  すべての $i, j$ に対し、$|c_i \cdot p_j| \le 1.0$。したがって相互作用スコア寄与は $|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$。
- **Invariant 4 (Zero Preservation)**:
  $x = 0 \implies f(x) = 0$。生値のゼロ（無・不在）はスケーリング後も厳格に $0.0$ を保つ。
- **Invariant 5 (Sign Preservation & Symmetry)**:
  符号付き特徴量に対し、$\operatorname{sgn}(f(x)) = \operatorname{sgn}(x)$ かつ $f(-x) = -f(x)$。
- **Invariant 6 (Strict Monotonicity)**:
  連続的なカウント・合計特徴量に対し、$x_1 < x_2 \implies f(x_1) < f(x_2)$。
- **Invariant 7 (Finite Contract)**:
  有限入力に対し出力は常に `Number.isFinite(v) === true`。$\text{NaN}, +\infty, -\infty$ を絶対に出力しない。

---

## 16. Architecture Ownership (責務分離とアーキテクチャ境界)

```text
DecisionRequest (合法的AI入力境界)
    ↓
DecisionFeatureEncoder.encode(request)
    │
    ├─ 1. 生特徴量ベクトルの構築 (Raw Feature Vector: Context 163, Pattern 143)
    │
    └─ 2. DecisionFeatureScaler.scale(rawFeatures) (内部委譲・Schema完全保有)
              ↓ (ai-feature-scaling-registry-v1.json 準拠)
EncodedDecisionFeatures (featureSchemaVersion: 5, 全値が [-1, 1] 有界)
    ↓
GenomeScorer.score(encodedFeatures, dna)
    - 式: Σ w_j * p_j + Σ Σ M_ij * c_i * p_j (完全に汎用・不変)
    - スケーリングの知識、特徴量名の知識、アクション個別ロジックは一切持たない
    ↓
GenomePolicy.choose(request)
    - 決定論的 Argmax + 最小 patternRef タイブレーク (不変)
```

### アーキテクチャ境界の原則
1. **呼び出し側に raw/scaled の分岐を作らない**:
   `DecisionFeatureEncoder.encode()` は内部でスケーラーを適用し、常に正規化済みの特徴量を返します。`GenomePolicy` やシミュレータ本体にフラグ分岐を持ち込みません。
2. **GenomeScorer の完全汎用性維持**:
   スコアラーは純粋な線形・双線形代数演算のみを担当し、特定特徴量名やスケーリングパラメータの知識を一切持ちません。
3. **Registry の単一情報源（Single Source of Truth）**:
   スケーリングクラス、パラメータ、関数はすべてレジストリ（`DecisionFeatureScalingRegistry`）によってスキーマ主権で一元管理されます。

---

## 17. Feature Schema Versioning

- **現行バージョン**: `FEATURE_SCHEMA_VERSION = 4`（生値特徴量）
- **新バージョン**: `FEATURE_SCHEMA_VERSION = 5`（有界スケーリング特徴量）

### バージョン昇格の必然性
特徴量の値の定義域および意味論が抜本的に変化するため、同一バージョンを維持することは厳禁です。
`FEATURE_SCHEMA_VERSION = 5` への昇格により、旧バージョンとの混同を防止します。

---

## 18. DNA Compatibility (DNA 互換性)

- **`dnaFormatVersion`**: **`1` を維持**
  重み配列の次元数（Context 163, Pattern 143, Interaction 23,309, Total 23,452）および Row-major レイアウトに変更はないため、DNA フォーマットバージョン自体は 1 を維持可能です。
- **意味論的互換性（Semantics Incompatibility）**:
  重みの次元数が同じであっても、v4 で学習・変異された重みは「未正規化の生値（クイック数126等）」を前提に形成されたものです。これを v5（最大 1.0）に適用すると、重みの実効スケールが $1/100$ に縮退し、意図した行動選択が不可能になります。
- **Fail-Closed 拒絶**:
  `GenomeScorer.score` は `dna.featureSchemaVersion !== features.featureSchemaVersion` を検知した場合、即座に `DecisionDNAExecutionError` をスローして実行を停止します。

---

## 19. Migration Policy (移行方針)

1. **サイレントマイグレーションの完全禁止**:
   v4 DNA の `featureSchemaVersion` フィールドだけを `5` に書き換えて再利用する運用は厳格に禁止します。
2. **自動重み変換の非採用**:
   各特徴量の実戦出現頻度や平均値に依存する線形リスケーリングは、相互作用項の結合によって数学的に正確な等価性を保証できないため採用しません。
3. **Fresh Zero DNA からの再進化**:
   Feature Schema v5 の初稼働は、v4 と全く同様に初期母集団（All Zero DNA, 全重み $0.0$）から決定論的に開始します。

---

## 20. Determinism (決定論性の保証)

- **環境非依存の数学的同一性**:
  使用する演算は IEEE 754 準拠の倍精度浮動小数点数（64-bit float）による四則演算のみであり、異なる Node.js LTS バージョンや OS 間でも bit-exact な一致が保証されます。
- **乱数・統計量完全不使用**:
  スケーリング処理において `Math.random()`、日付、外部状態、バッチ統計量は一切使用されません。同一の `DecisionRequest` からは常に 100% 同一の `EncodedDecisionFeatures` が出力されます。

---

## 21. Numeric Safety (数値安全性)

1. **ゼロ除算防止**:
   すべてのスケーリング関数の分母は $s > 0$ により常に $s$ 以上の正値となり、ゼロ除算（`1/0 = Infinity`）は原理的に発生しません。
2. **非有限値の Fail-Closed 遮断**:
   エンコーダーへの入力に `NaN`、`Infinity`、`-Infinity` が混入した場合、暗黙に $0.0$ に丸めるのではなく、即座に例外をスローしてフェイルクローズします。
3. **有界性保証**:
   出力されるすべての数値は厳格に $[-1.0, 1.0]$ の有限実数であることが保証されます。

---

## 22. Test Design (将来実装時のテスト仕様)

Feature Scaling 実装タスクにおいて必須とされるテスト項目：

### 22.1 レジストリ完全性テスト (`featureScalingRegistry.test.ts`)
- 全 306 特徴量が欠落（Missing: 0）、重複（Duplicate: 0）、余剰（Extra: 0）なく登録されていること。
- インデックスが 0..162（Context）および 0..142（Pattern）と厳格に一致すること。
- すべてのレコードが有効な `scalingClass`, `scalingFunction`, `parameter`, `outputDomain` を持つこと。

### 22.2 数学的不変条件テスト (`featureScalerMathematical.test.ts`)
- **有界性**: 極端な入力値（$x = 0, 1, 10, 100, 1000, 10^6$）に対して、出力が常に $[-1.0, 1.0]$ に収まること。
- **単調性**: $x_1 < x_2 \implies f(x_1) < f(x_2)$ が全単調関数で成立すること。
- **ゼロ保存**: $f(0) === 0$ が全関数で成立すること。
- **奇関数対称性**: 符号付き特徴量に対し $f(-x) === -f(x)$ が完全成立すること。
- **相互作用有界性**: 任意の Context $\times$ Pattern の積 $|c_i \cdot p_j| \le 1.0$ であること。

### 22.3 アーキテクチャ境界テスト (`architectureBoundary.test.ts` 拡張)
- `GenomeScorer` のソースコードが特徴量名やスケーリングパラメータ名を含まないこと。
- `GenomePolicy` がスケーリングの有無に関する条件分岐を持たないこと。
- ルールパッケージ・DSL 実装が AI 特徴量スケーラーに依存しないこと。

### 22.4 決定論性と互換性テスト (`featureScalingCompatibility.test.ts`)
- 同一 Request に対する連続エンコード結果が `values` の全要素で完全一致すること。
- `featureSchemaVersion = 4` の旧 DNA を渡した際、`GenomeScorer` が即座に `DecisionDNAExecutionError` をスローすること。
- Zero DNA（全重み 0）において、v4 と v5 の行動選択（Argmax + 最小 patternRef）が 100% 同一であること。

---

## 23. Future Controlled A/B Evidence (将来の比較検証実験設計)

Feature Scaling 実装タスクにおいて実行すべきカノニカル検証実験：

| 項目 | Control (対照群: Accepted R2) | Treatment (実験群: Scaling V1) |
|---|---|---|
| **Feature Schema Version** | **`4` (Raw Features)** | **`5` (Scaled Features)** |
| **レギュレーション** | `light-entry16` (公式) | `light-entry16` (公式, 同一) |
| **初期母集団 N** | 6 (All Zero DNA) | 6 (All Zero DNA, 同一) |
| **キャンペーンシード** | 42 | 42 (同一) |
| **Generation 実行数** | 1 (g0 $\to$ g1 再構築) | 1 (g0 $\to$ g1 再構築, 同一) |
| **ペア対戦回数 R** | 1 (正逆2レグ, 計30試合) | 1 (正逆2レグ, 計30試合, 同一) |
| **Max Decisions** | 500 decisions | 500 decisions (同一) |
| **突然変異設定** | $p_m = 0.01, \sigma = 0.05$ | $p_m = 0.01, \sigma = 0.05$ (完全同一) |
| **適応度関数** | Outcome-First MPA | Outcome-First MPA (完全同一) |
| **ゲームルール** | Official 9.1.2 | Official 9.1.2 (完全同一) |

### 重要単離表明（Gene-Level Isolation Assertion）
特徴量の順序および次元数が同一であるため、PRNG 消費規約に基づき：
$$\text{Control g1 オフスプリング重み} \equiv \text{Treatment g1 オフスプリング重み}$$
変異が発生する遺伝子座標および生成される変異重み数値（$w_j, M_{ij}$）が **ビットレベルで 100% 完全一致** することを必須の検証条件とします。これにより、「重みが変わったから結果が変わった」という交絡を完全に排除し、「特徴量スケーリングのみによる効果」を数学的に単離します。

---

## 24. Risks / Tradeoffs (リスクとトレードオフ)

1. **大値領域における解像度の圧縮（Saturation Tradeoff）**:
   Saturating Rational $x / (x + s)$ において、$x \gg s$ では導関数が減少するため、例えばクイックアクション数が 80 個の盤面と 120 個の盤面のスコア差が小さくなります。
   - **評価**: これはバグではなく **意図された設計トレードオフ** です。ゲーム戦略上、「クイックが 0 個か 3 個か」の質的差は極めて重要ですが、「80 個か 120 個か」の差によって変異重みが 100 倍に爆発することは探索を破壊するため、飽和による圧縮が正当化されます。
2. **小値領域の感度設定**:
   パラメータ $s$ を過大に設定すると小値の差が埋もれ、$s$ を過小に設定すると早熟に飽和します。本設計ではセマンティックファミリーごとに $s \in \{4, 5, 10, 20, 30, 50\}$ を設定し、典型的なゲーム進行における弁別性を担保しています。

---

## 25. Explicit Non-Claims (明示的不主張)

本設計書において、以下の主張は **明示的に行いません（NO）**：

1. **Normalization Proven Fix: NO**
   特徴量スケーリングを導入すれば、g1 の 28 試合の未完了がすべて解消され、30/30 完走することが数学的に証明されたとは主張しません。スケーリングはスケール増幅病理を取り除く基盤であり、完走率は実装後の実証実験で確認されるべき事項です。
2. **PASS Rule Change Unnecessary: NO**
   特徴量側の要因が特定・対策されたからといって、Core Flow 側での「Turn Player は Stage 空時に PASS できない」等のルール見直しが不要になったとは主張しません。
3. **Core Flow Proven Correct: NO**
   現行 Core Flow の設計が完全に正当であるとは主張しません。
4. **Mutation Rate Proven Bad: NO**
   突然変異率 1% や $\sigma = 0.05$ の遺伝的操作子設定自体に欠陥があったとは主張しません。
5. **Fitness Change Required: NO**
   本スケーリングのために適応度関数（MPA）を変更する必要があるとは主張しません。
6. **Multi-Generation Completion Proven: NO**
   多世代進化ループが直ちに完走可能になったとは主張しません。
7. **N=100 Scale Ready: NO**
   大規模（N=100）自己対戦への即時投入準備が完了したとは主張しません。

---

## 26. Implementation Scope Proposal (将来実装タスクの提案)

独立レビュー承認後に着手すべき実装タスク（`BP-SIM-AI-FEATURE-SCALING-V1` 予定）の推奨構成：

1. **新規作成ファイル**:
   - `tools/simulator/src/domain/ai/DecisionFeatureScalingTypes.ts`: スケーリング関数型、レジストリ型定義
   - `tools/simulator/src/engine/ai/DecisionFeatureScalingRegistry.ts`: 306 特徴量の固定契約レジストリ実装
   - `tools/simulator/src/engine/ai/DecisionFeatureScaler.ts`: 純粋関数スケーリングエンジン
2. **既存修正ファイル**:
   - `tools/simulator/src/domain/ai/DecisionFeatureTypes.ts`: `FEATURE_SCHEMA_VERSION = 5` への昇格
   - `tools/simulator/src/engine/ai/DecisionFeatureEncoder.ts`: エンコード末尾での `DecisionFeatureScaler.scale()` 適用
3. **新規テストファイル**:
   - `tools/simulator/src/tests/ai/decisionFeatureScaling.test.ts`: 全不変条件およびレジストリ網羅性検証

---

## 27. Acceptance Criteria For Future Implementation

将来の実装タスクにおける受入基準：

1. **AC-IMP-1**: 全 306 特徴量に対するレジストリが完全実装され、Missing 0, Duplicate 0 であること。
2. **AC-IMP-2**: すべての Context 特徴量および Pattern 特徴量が $[-1.0, 1.0]$ に収まり、$|c_i \cdot p_j| \le 1.0$ が全決定局面で成立すること。
3. **AC-IMP-3**: `FEATURE_SCHEMA_VERSION = 5` が設定され、旧 v4 DNA が `GenomeScorer` により fail-closed で拒絶されること。
4. **AC-IMP-4**: 同一シードにおける g1 オフスプリングの DNA 重み配列が、v4（R2）とビットレベルで完全一致すること（Gene-Level Isolation）。
5. **AC-IMP-5**: 全シミュレータテスト（201 テストファイル、2,750+ テスト）が全面 PASS すること。

---

## 28. Remaining Scope (残余スコープ)

1. **`BP-SIM-AI-FEATURE-SCALING-DESIGN-V1`**: **DESIGNED / PENDING INDEPENDENT REVIEW**（本タスク）
2. **`BP-SIM-AI-FEATURE-SCALING-V1`**: **NOT STARTED**（実装・テスト・Controlled A/B 検証）
3. **`Controlled Multi-Generation Evidence V1`**: **BLOCKED / WAITING**（スケーリング実装後に再挑戦）
4. **`Rule-side PASS / Core Flow`**: **SEPARATE DISCUSSION**（別ブランチ・別会話にて継続審議）
5. **`N=100 Multi-Generation`**: **NOT EXECUTED**

---

**READY FOR INDEPENDENT REVIEW**
