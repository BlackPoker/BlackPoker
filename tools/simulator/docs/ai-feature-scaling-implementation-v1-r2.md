# BlackPoker Simulator
# Decision Feature Scaling Implementation V1-R2 Report

作業ID: `BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1-R2`  
ステータス: **PENDING INDEPENDENT REVIEW**  
実施日時: 2026-10-15  
対象ブランチ: `BlackPoker/issue551-core-flow`  
開始コミット: `2a7e6dffc141b8632b18a17802ad45ff09a229bf` (`BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1-R1`)  
ベースコミット: `4c9f8c273d9c2bd8068173dd1333bcc55547668a` (`BP-SIM-AI-FEATURE-SCALING-DESIGN-V1-R2` Formal Accepted)

---

## 1. Document Identity
- **文書名**: BlackPoker Simulator Decision Feature Scaling Implementation V1-R2 Report
- **作業ID**: `BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1-R2`
- **対象ブランチ**: `BlackPoker/issue551-core-flow`
- **開始コミット SHA**: `2a7e6dffc141b8632b18a17802ad45ff09a229bf`
- **ベースコミット SHA**: `4c9f8c273d9c2bd8068173dd1333bcc55547668a` (`BP-SIM-AI-FEATURE-SCALING-DESIGN-V1-R2` Formal Accepted)
- **位置づけ**: Formal Accepted 済みの Feature Scaling Design V1-R2 に基づく Production 実装 Evidence の整合化・確定レポート（Documentation / Evidence Correction Only）

---

## 2. Historical Status
- **Evolution Loop Design V1-R2**: FORMAL ACCEPTED
- **Evolution Loop Production V1**: FORMAL ACCEPTED
- **DNA PASS Score Analysis V1-R2**: FORMAL ACCEPTED (`36816a1893512c8bf602a9ffc5a10dcf45b92041`)
- **Feature Scaling Design V1**: NOT ACCEPTED
- **Feature Scaling Design V1-R1**: NOT ACCEPTED
- **Feature Scaling Design V1-R2**: FORMAL ACCEPTED (`4c9f8c273d9c2bd8068173dd1333bcc55547668a`)
- **Feature Scaling Implementation V1**: NOT ACCEPTED (`85781bedb765914d55dfc04daf9de8fff8fed38e`, dist 混入および Evidence 不整合により却下)
- **Feature Scaling Implementation V1-R1**: NOT ACCEPTED / SUPERSEDED BY R2 (`2a7e6dffc141b8632b18a17802ad45ff09a229bf`, parameter 列挙不一致および diff 説明混同により R2 へ差し替え)
- **Feature Scaling Implementation V1-R2**: **IMPLEMENTED / PENDING INDEPENDENT REVIEW**

---

## 3. Scope
- **本作業 (V1-R2) の範囲**: **DOCUMENTATION / EVIDENCE CORRECTION ONLY**
  - Production Source 変更: **なし (0 diff)**
  - Test コード変更: **なし (0 diff)**
  - ルール変更 (`src/domain/rules/`, `src/engine/rules/`): **なし (0 diff)**
  - Core Flow 変更: **なし (0 diff)**
  - Scaling 実装ロジック変更: **なし (0 diff)**
  - Self-play / Evolution 実行: **なし (未実行)**
  - ビルド成果物 (`dist/**`): **Base コミットからの累積差分 0 files / 0 lines 維持**
- **既存 R1 成果物の保持**:
  - `tools/simulator/docs/ai-feature-scaling-implementation-v1.md` は R1 Historical Artifact として内容を変更せず完全に保持する。

---

## 4. R1 Review Corrections
V1-R1 の独立レビューで指摘された以下の 2 点の Evidence / Documentation 不整合を本 R2 で完全に是正しました。

1. **Parameter 列挙の Canonical Registry 不一致の是正**:
   - V1-R1 レポートにおいて、`NONNEGATIVE_COUNT` に `2, 8, 20, 30`、`AGGREGATE_SUM` に `10`、`SIZE` に `20, 30` といった Canonical Registry に存在しないスケール値が例示列挙されていました。
   - R2 では手計算や推測を一切排除し、Accepted Canonical Registry JSON (`docs/ai-feature-scaling-registry-v1-r2.json`) および `DecisionFeatureScalingRegistry.ts` から実測集計した厳密な Parameter 分布表を掲載し、これらが唯一の真実情報源 (Single Source of Truth) であることを明記しました。
2. **Diff Semantics の明確な分離**:
   - V1-R1 レポートにおいて、「R1 コミット単体の差分 (delta)」と「Design Base コミットからの累積差分 (cumulative diff)」の説明が混同されていました。
   - R2 では、R1 コミット単体に「dist generated artifacts の Base 状態への復元差分」が含まれていた事実を明記し、Design Base (`4c9f8c273d9c2bd8068173dd1333bcc55547668a`) からの累積比較において `dist/**` および Rules / Core Flow の差分が厳格に 0 であることを論理的に分離して記述しました。

---

## 5. Canonical Schema v5
- **Feature Schema Version**: `5` (`FEATURE_SCHEMA_VERSION = 5`)
- **Context 特徴量**: 163 次元
- **Pattern 特徴量**: 143 次元
- **総特徴量次元**: 306 次元
- **DNA 相互作用重み**: 23,452 重み
  - Pattern 線形重み: 143
  - Context-Pattern 双線形相互作用重み: $163 \times 143 = 23,309$
  - 合計: $143 + 23,309 = 23,452$
- **DNA Format**: 1
- **Scoring Model**: `linear-bilinear-v1`
- **特徴量順序およびインデックス**: Schema v4 と完全一致（順序・配置の変更なし）

---

## 6. Canonical Scaling Classes
全 306 特徴量は、Canonical Registry に定義された以下の 9 つのクラスに厳密に分類されます。

| Scaling Class | 定義・入力域 | 正規化関数 | 出力域 | 特徴量数 (Context / Pattern / 合計) |
|---|---|---|---|---|
| **`BOOLEAN`** | 二値フラグ $x \in \{0, 1\}$ | `identity(x) = x` | $[0, 1]$ | 29 / 22 / **51** |
| **`ONE_HOT`** | 排他カテゴリ $x \in \{0, 1\}$ | `identity(x) = x` | $[0, 1]$ | 8 / 15 / **23** |
| **`HASH_BUCKET`** | ハッシュ衝突バケット $x \in \{0, 1\}$ | `identity(x) = x` | $[0, 1]$ | 32 / 32 / **64** |
| **`RATIO_0_1`** | カバレッジ比率 $x \in [0, 1]$ | `identity(x) = x` | $[0, 1]$ | 0 / 1 / **1** |
| **`BOUNDED_CARD_VALUE`** | 既知カード数値 $x \in [0, 13]$ | `linear_bound_division(x, 13) = x / 13` | $[0, 1]$ | 6 / 4 / **10** |
| **`NONNEGATIVE_COUNT`** | 非負カウント $x \in [0, \infty)$ | `saturating_rational(x, s) = x / (x + s)` | $[0, 1)$ | 69 / 54 / **123** |
| **`AGGREGATE_SUM`** | 非負合計値 $x \in [0, \infty)$ | `saturating_rational(x, s) = x / (x + s)` | $[0, 1)$ | 7 / 6 / **13** |
| **`SIZE`** | ユニットサイズ $x \in [0, \infty)$ | `saturating_rational(x, 10) = x / (x + 10)` | $[0, 1)$ | 3 / 8 / **11** |
| **`SIGNED_DELTA`** | 正負差分 $x \in (-\infty, \infty)$ | `signed_saturating_rational(x, s) = x / (|x| + s)` | $(-1, 1)$ | 9 / 1 / **10** |
| **合計** | - | - | - | 163 / 143 / **306** |

---

## 7. Canonical Function Distribution
全 306 特徴量の正規化関数の分布は以下の通りです（Docker 内 Node.js による実測値）。

| 正規化純粋関数 | 数学定義 | Context 件数 | Pattern 件数 | 合計件数 |
|---|---|---|---|---|
| **`identity`** | $f(x) = x$ | 69 | 70 | **139** |
| **`saturating_rational`** | $f(x) = \frac{x}{x + s}$ | 79 | 68 | **147** |
| **`linear_bound_division`** | $f(x) = \frac{x}{b}$ | 6 | 4 | **10** |
| **`signed_saturating_rational`** | $f(x) = \frac{x}{|x| + s}$ | 9 | 1 | **10** |
| **合計** | - | **163** | **143** | **306** |

---

## 8. Canonical Parameter Distribution
Accepted Canonical Registry (`docs/ai-feature-scaling-registry-v1-r2.json`) から Docker 内 Node.js により自動集計した厳密なパラメータ分布は以下の通りです。

| Scaling Class | Parameter Key / Value | Context 件数 | Pattern 件数 | 合計件数 |
|---|---|---|---|---|
| **`BOOLEAN`** | `{}` (パラメータなし) | 29 | 22 | **51** |
| **`ONE_HOT`** | `{}` (パラメータなし) | 8 | 15 | **23** |
| **`HASH_BUCKET`** | `{}` (パラメータなし) | 32 | 32 | **64** |
| **`RATIO_0_1`** | `{}` (パラメータなし) | 0 | 1 | **1** |
| **`BOUNDED_CARD_VALUE`** | `{"bound": 13}` | 6 | 4 | **10** |
| **`NONNEGATIVE_COUNT`** | `{"scale": 4}` | 19 | 38 | **57** |
| | `{"scale": 5}` | 23 | 14 | **37** |
| | `{"scale": 10}` | 19 | 2 | **21** |
| | `{"scale": 50}` | 8 | 0 | **8** |
| | *(小計)* | *69* | *54* | ***123*** |
| **`AGGREGATE_SUM`** | `{"scale": 20}` | 0 | 6 | **6** |
| | `{"scale": 30}` | 7 | 0 | **7** |
| | *(小計)* | *7* | *6* | ***13*** |
| **`SIZE`** | `{"scale": 10}` | 3 | 8 | **11** |
| | *(小計)* | *3* | *8* | ***11*** |
| **`SIGNED_DELTA`** | `{"scale": 10}` | 8 | 0 | **8** |
| | `{"scale": 20}` | 0 | 1 | **1** |
| | `{"scale": 30}` | 1 | 0 | **1** |
| | *(小計)* | *9* | *1* | ***10*** |
| **総合計** | - | **163** | **143** | **306** |

### Parameter 集合に関する厳格な確認
- `NONNEGATIVE_COUNT`: 存在するパラメータ値は **`{4, 5, 10, 50}` のみ**（`2, 8, 20, 30` は Canonical Registry に一切存在しません）。
- `AGGREGATE_SUM`: 存在するパラメータ値は **`{20, 30}` のみ**（`10` は Canonical Registry に一切存在しません）。
- `SIZE`: 存在するパラメータ値は **`{10}` のみ**（`20, 30` は Canonical Registry に一切存在しません）。
- `SIGNED_DELTA`: 存在するパラメータ値は **`{10, 20, 30}` のみ**。
- `BOUNDED_CARD_VALUE`: 存在するパラメータ値は **`{13}` のみ**。
- 各 Feature の具体的 parameter は、`DecisionFeatureScalingRegistry.ts` および Formal Accepted `ai-feature-scaling-registry-v1-r2.json` を Canonical Source of Truth とします。

---

## 9. Context / Pattern Domains
- **Context 特徴量ベクトル出力域**:
  $$c \in [-1, 1]^{163}$$
  - 非負クラス 154 本: 出力域 $[0, 1]$ または $[0, 1)$
  - `SIGNED_DELTA` 9 本: 出力域 $(-1, 1)$
- **Pattern 特徴量ベクトル出力域**:
  $$p \in [-1, 1]^{143}$$
  - 非負クラス 142 本: 出力域 $[0, 1]$ または $[0, 1)$
  - `SIGNED_DELTA` 1 本 (`effect_assignment_size_delta_sum`, Index 133, scale=20): 出力域 $(-1, 1)$
  - ※ $[0, 1]^{143}$ という誤記・制約は完全に撤廃されています。

---

## 10. Mathematical Invariants
全特徴量が $[-1, 1]$ に収束することにより、以下の数学的不変条件が厳密に成立します。

1. **単一特徴量の有界性**:
   $$|c_i| \le 1.0 \quad (\forall i \in \{0, \dots, 162\}), \quad |p_j| \le 1.0 \quad (\forall j \in \{0, \dots, 142\})$$
2. **相互作用項の積の有界性**:
   $$|c_i \cdot p_j| \le 1.0 \quad (\forall i, j)$$
3. **Bilinear 相互作用寄与の有界性**:
   $$|M_{ij} \cdot c_i \cdot p_j| \le |M_{ij}|$$
4. **Pattern 線形寄与の有界性**:
   $$|w_j \cdot p_j| \le |w_j|$$

これにより、DNA PASS Score Analysis V1-R2 で発見された「未正規化特徴量（最大 137 等）による微小変異重みの過剰増幅」が数学的に完全に遮断されます。

---

## 11. Runtime Registry Ownership
- **静的純粋 TypeScript Registry**: `tools/simulator/src/domain/ai/DecisionFeatureScalingRegistry.ts`
- **設計 JSON アーティファクト**: `tools/simulator/docs/ai-feature-scaling-registry-v1-r2.json`
- **所有権・依存性ルール**:
  - 本番 AI ランタイムコードは `DecisionFeatureScalingRegistry.ts` を直接参照し、Node.js の `fs`, `path` や外部 JSON ファイルへの実行時依存を一切持ちません（Architecture Boundary Test で検証済み）。
  - TypeScript 静的 Registry と 設計 JSON は、自動テスト `decisionFeatureScaling.test.ts` により全 306 特徴量にわたって 100% の双方向完全一致（Parity）が保証されています。

---

## 12. Production Implementation Status
- **R2 での変更**: **NO (0 diff)**
- 本番コンポーネントの実装状況:
  1. `DecisionFeatureScalingRegistry.ts`: 306 特徴量の静的ルール定義テーブル。
  2. `DecisionFeatureScaler.ts`: 純粋関数群および Fail-Closed な検証・変換エンジン。
  3. `DecisionFeatureEncoder.ts`: エンコードパイプライン末尾でのスケーリング適用統合。
  4. `DecisionFeatureTypes.ts`: `FEATURE_SCHEMA_VERSION = 5` 定義。
  5. `DecisionDNATypes.ts`: Schema v5 適合性検証・Fail-Closed 拒絶。
  6. `KnownCardAggregateEncoder.ts`: Joker rank 0 セマンティクスの維持。
  7. `GenomeScorer.ts`: 汎用 linear-bilinear スコアラー（Scaling ロジックへの直接結合なし）。

---

## 13. Negative Pattern Regression Evidence
Pattern ベクトル内の `SIGNED_DELTA` 特徴量について、R1 で追加された以下の Golden Regression テストを厳格に保持しています。

- **対象特徴量**: `effect_assignment_size_delta_sum`
- **ドメイン**: `PATTERN`
- **インデックス**: `133`
- **スケーリングクラス**: `SIGNED_DELTA`
- **正規化関数**: `signed_saturating_rational`
- **スケールパラメータ**: `scale = 20`
- **Golden 検証結果**:
  - raw = $-10 \implies \frac{-10}{|-10| + 20} = -\frac{10}{30} = -\frac{1}{3} \approx -0.3333333333$
  - 出力域: $(-1, 0)$
  - 厳密な反対称性: $f(-x) = -f(x)$ ($f(-10) = -f(10) = -1/3$)
  - 全 Context 値域 $c_i \in [-1, 1]$ に対して相互作用積 $|c_i \cdot p_j| \le 1.0$ を確認
- **テスト検証ステータス**: **PASS** (`decisionFeatureScaling.test.ts`)

---

## 14. v4 DNA Compatibility
- **旧 DNA の拒絶**: Schema v4 以前の DNA を読み込んだ場合、`DecisionDNAValidationError` または `DecisionFeatureScalingError` により即時 Fail-Closed に例外送出します。
- **サイレントマイグレーション**: **完全禁止**（無効なゼロパディングや暗黙変換は行いません）。
- **DNA Format**: `1`

---

## 15. R1 Historical Test Evidence
R1（コミット `2a7e6dffc141b8632b18a17802ad45ff09a229bf`）において実機実行・検証されたテスト結果は以下の通りです。
本 R2 は Documentation / Evidence 修正のみであり Production / Test コードの変更がないため、これらの結果は Historical Evidence として正確に引き継がれます。

- **AI テストスイート**: **27/27 suites PASS** (509 tests passed, 0 failed)
- **アーキテクチャ境界テスト**: **1/1 suite PASS** (7 tests passed, 0 failed)
- **全体リグレッションテスト (`npm test`)**: **202/202 suites PASS** (2,777 tests passed, 0 failed)
- **プレイアビリティ検証 (`npm run playable:check`)**: **PASS** (100% 正常完走, Exit Code 0)
- **プロダクションビルド検証 (`npm run build`)**: **PASS** (`tsc` エラー 0 件, `vite build` 正常完了, Exit Code 0)

---

## 16. Diff Semantics
本作業における差分は、以下の 2 つの視点を厳格に区別して理解・検証する必要があります。

### A. R1 コミット単体差分 (`85781bed...` $\rightarrow$ `2a7e6dff...`)
R1 コミットには以下の 2 種類の変更が含まれていました。
1. **著作者による機能的変更 (Functional / Authored Changes)**:
   - `tools/simulator/docs/ai-feature-scaling-implementation-v1.md` (Evidence 修正)
   - `tools/simulator/docs/ai-self-play-roadmap.md` (Roadmap 更新)
   - `tools/simulator/src/tests/ai/decisionFeatureScaling.test.ts` (Negative Pattern テスト追加)
2. **ビルド生成物の復元 (Restoration of Generated Artifacts)**:
   - V1 コミットで誤って混入した `tools/simulator/dist/**` のビルド生成物を、Base コミット (`4c9f8c273d9c2bd8068173dd1333bcc55547668a`) の状態へチェックアウト復元。

### B. Base コミットからの累積差分 (`4c9f8c273...` $\rightarrow$ R2 Final)
Design R2 Base コミット (`4c9f8c273d9c2bd8068173dd1333bcc55547668a`) から R2 Final までの累積差分において：
- `tools/simulator/dist/**` diff: **0 files / 0 lines**
- `tools/simulator/src/domain/rules/**` diff: **0 files / 0 lines**
- `tools/simulator/src/engine/rules/**` diff: **0 files / 0 lines**
- プロダクション AI コード: Scaling Registry, Scaler, Encoder 統合のみ。
- テストコード: Scaling 単体・リグレッションテストおよび Schema v5 テストフィクスチャ更新のみ。

---

## 17. dist Restoration Evidence
- `git diff --stat 4c9f8c273d9c2bd8068173dd1333bcc55547668a -- tools/simulator/dist` $\implies$ **0 files / 0 lines**
- 本 R2 ではビルド生成物の生成・変更・コミットを一切行わず、Base コミットの状態が完全に維持されていることを確認済みです。

---

## 18. Rules / Core Flow Integrity
- **基本方針**: **RULES UNCHANGED / NO CHANGE PLANNED**
- PASS Rule、Core Flow、Turn Player PASS legality、Stage Empty behavior、End Action semantics は一切変更されていません。
- Base コミットからの差分:
  - `git diff --stat 4c9f8c273d9c2bd8068173dd1333bcc55547668a -- tools/simulator/src/domain/rules tools/simulator/src/engine/rules` $\implies$ **0 files / 0 lines**

---

## 19. CI Status
- **R1 コミット (`2a7e6dffc141b8632b18a17802ad45ff09a229bf`) CI 実績**:
  - Run ID: `38738196817`
  - Job Check Run ID: `116432792616`
  - Status: `completed`
  - Conclusion: `success`
  - URL: [GitHub Actions Job Run 116432792616](https://github.com/BlackPoker/BlackPoker/actions/runs/38738196817/job/116432792616)
- **R2 コミット CI**:
  - R2 コミット push 後、GitHub Actions の Exact SHA CI 実行結果を確認・追記します。

---

## 20. Explicit Non-Claims
本作業の完了にあたり、以下の事項について未証明・未解決であることを明示します。

- **Feature Scaling Behavioral Improvement Proven**: **NO** (スケーリングによる対戦行動の質的向上が証明されたわけではない)
- **PASS Stall Solved**: **NO** (PASS 連打による未完了試合の根本解決が実証されたわけではない)
- **Strong DNA Proven**: **NO** (強力な DNA が獲得されたわけではない)
- **Multi-Generation Completion Proven**: **NO** (多世代進化の完走が確認されたわけではない)
- **Cycle Detection Implemented**: **NO** (サイクル検出は未実装)
- **Test DNA Implemented**: **NO** (テスト DNA の分離は未実装)
- **Rule Change Required**: **NO** (「現方針として Rules を変更しない」ことを意味し、ルール改定が不要であると科学的に証明されたことを意味しない)

---

## 21. Remaining Scope
- **Controlled v4/v5 Self-play A/B**: 独立レビュー受領後に初めて着手
- **Controlled Multi-Generation Evolution**: 待機中 (WAITING)
- **Semantic State / Cycle Detection**: 未着手 (NOT STARTED)
- **Competitive / Test DNA 分離**: 未着手 (NOT STARTED)
- **N=100 多世代実機評価**: 未実行 (NOT EXECUTED)

---

## 22. Final Status
**IMPLEMENTED / PENDING INDEPENDENT REVIEW**
