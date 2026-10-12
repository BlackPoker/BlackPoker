# BlackPoker Simulator Genetic Operators Design V1
# + Runtime Performance Telemetry / Artifact Policy (Follow-up R1)

作業ID: `BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R1`  
ステータス: **PROPOSED / DESIGNED (PENDING INDEPENDENT REVIEW)**  
対象リポジトリ: `BlackPoker/BlackPoker`  
対象ブランチ: `BlackPoker/issue551-core-flow`  
先行仕様:
- `tools/simulator/docs/ai-fitness-design-v1.md` (Formal Accepted)
- `tools/simulator/docs/ai-population-selection-design-v1.md` (Formal Accepted)
- `tools/simulator/src/domain/ai/DecisionDNATypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/DecisionDNACodec.ts` (Implemented)
- `tools/simulator/src/domain/ai/PopulationSelectionTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/PopulationSelector.ts` (Implemented)
- `tools/simulator/src/engine/simulation/BatchSimulationRunner.ts` (Implemented)

---

## 1. Purpose (設計目的)

本設計書は、BlackPoker Simulator AI 自己対戦進化（Phase 4.0: Self-Play Evolution）において、親個体の選択（Selection）の後に実行される **遺伝的操作子（Genetic Operators: Crossover / Mutation / Elite Inheritance / Offspring Lineage / 次世代 Population 境界）** の境界契約（Boundary Contract）を定義する。

さらに、今後の大規模自動対戦および世代交代実験において、必要な計算資源と所要時間を正確に見積もり・分析可能とするための **実行時間計測テレメトリ（Runtime Performance Telemetry）** および **実行時成果物保存方針（Runtime Artifact Policy）** を確定する。

### R1 Follow-up における厳格化事項
1. **1試合の実時間計測境界 (`matchTotalElapsedMs`)**: 単なるシミュレーションループのみでなく、セッション生成・レギュレーションセットアップ等の実コストを含んだ総経過時間を主指標（Canonical Metric）として確立。
2. **並列実行時のバッチ時間とスループット定義**: 個別試合時間の単純和（`sumMatchTotalElapsedMs`）と実際のバッチ経過時間（`batchWallClockElapsedMs`）を明確に分離し、並列度（`concurrency`）を考慮したスループット計算式を定義。
3. **Seed Derivation Algorithm の厳密化 (`seed-derivation-v1`)**: 曖昧な文字列ハッシュではなく、純粋 uint32 境界・固定 uint32 ドメインタグ・アバランシェミキサーによる決定論的アルゴリズムと Known Test Vectors を明記。
4. **Mutation 決定論契約の厳密化 (`deterministic-normal-approx-v1`)**: 初等超越関数（`Math.log`, `Math.sqrt`, `Math.cos`）に依存しない Irwin-Hall / CLT 近似正規分布を採用し、移植性の高い決定論保証境界を確立。非有限値検知時は Fail-Closed で例外停止。
5. **決定論的 Offspring Identity**: 世代番号とオフスプリングインデックスに基づく決定論的 ID（`gen-000012-offspring-000042`）を確定し、乱数 UUID や時刻依存を完全排除。

> [!IMPORTANT]
> **本作業のスコープ境界**  
> 本ドキュメントは **DESIGN ONLY（設計仕様の確定のみ）** であり、Crossover、Mutation、Generation Runner、Evolution Loop、Telemetry 計測のプロダクションコード（TypeScript）の実装は行いません。

---

## 2. Prerequisites (前提条件と最重要原則)

### 2.1 Formal Accepted 済み前提コンポーネント
- **Decision Feature Schema v4**: Viewer-Relative, Secret-Safe, Stage Semantics Preservation。
- **Decision DNA v1**:
  - スコアリングモデル: `linear-bilinear-v1`
  - 重み構造:
    - `patternWeights`: 143 次元（パターンバイアス）
    - `contextPatternWeights`: 163（コンテキスト特徴量） $\times$ 143（パターン特徴量） = 23,309 次元（行優先フラット配列）
    - 総重み次元数: 143 + 23,309 = **23,452 次元**
    - `metadata`: JSON-safe DTO（スコアリング計算には影響を与えない）
- **GenomePolicy / GenomeScorer**: 決定論的 Argmax ポリシー。
- **Outcome-First Fitness Design & Evaluation V1**:
  - 最重要原則: **"Victory is the objective. Life is a resource, not a score."**
  - 勝敗結果（Outcome）に基づく Match Point Average (MPA)。
  - 残りライフ、ターン数、ダメージ等のテレメトリは Fitness に一切算入しない。
  - 3 値ステータス: `VALID`（Tier 1）, `INSUFFICIENT_EVIDENCE`（Tier 2）, `INVALID`（Tier 3）。
- **Population & Tournament Selection V1 + R1**:
  - Population と Fitness は別スナップショットとして管理（DNA への Fitness 直接書き込み禁止）。
  - `VALID` 個体のみが通常選択プール（Standard Selection Pool）の対象。
  - 決定論的 Mulberry32 トーナメント選択（Provisional Default $k=3$、`selectionSeed` 明示入力必須）。
  - エリート選択（Provisional Default $E=1$）。

### 2.2 遺伝的操作子の基本原則（Rule-Agnostic 原則）
Crossover および Mutation は、BlackPoker の個別ルールや特定アクションに依存してはならない。

```text
【絶対禁止事項】
1. 特定の Action ID（例: "action.down", "action.pass"）を参照して交叉点や変異率を変更すること。
2. カードのスート・ランク・役のセマンティクスを参照して重み操作を行うこと。
3. 特定の Rule Package（例: "standard-rule"）専用の特別処理を遺伝操作子に組み込むこと。
4. Telemetry（実行時間、ターン数、残りライフ等）を突然変異量や交叉確率へフィードバックすること。
```

---

## 3. Scope & Non-Goals (スコープと非目標)

### 3.1 本設計のスコープ
- Crossover オペレータの候補比較、V1 推奨方式、構造的粒度の定義。
- Mutation オペレータの候補比較、V1 推奨方式（`deterministic-normal-approx-v1`）、変異パラメータ・数値クランプ・Fail-Closed 契約の定義。
- Parent Pair 契約と Self-Mating 回避・リトライ規約。
- Seed Domain Separation モデルと `seed-derivation-v1`（アルゴリズム、固定 uint32 タグ、Test Vectors）。
- 決定論的 Offspring Identity（`gen-000012-offspring-000042`）および Lineage（系統情報）の表現形式。
- Elite Inheritance（ジェノタイプ完全保存と Fitness 非継承）の境界定義。
- 次世代 Population 生成境界（`populationSize = eliteCount + offspringCount`）。
- 実行時間計測テレメトリ（1 試合 `matchTotalElapsedMs` 主指標、setup/simulation 内訳、バッチ時間、並列スループット）。
- 実行環境・ハードウェア・実験メタデータの構造定義。
- 実行時成果物の保存レイアウト（`.artifacts/ai-runs/<runId>/`）と Git 除外方針。

### 3.2 Non-Goals (本作業で実施しないこと)
- TypeScript による Crossover / Mutation クラスのプロダクション実装。
- 世代交代を実行する Generation Runner / Evolution Loop の実装。
- GameSession, Regulation, FitnessEvaluator, PopulationSelector のプロダクションコード修正。
- 外部データベースを用いた巨大な系統系譜（Genealogy Tree）管理システムの構築。
- マルチプロセス並列実行エンジンの実装（並列実行時の Telemetry 記録契約のみを設計）。

---

## 4. Crossover Candidates Comparison (交叉候補方式の比較)

Decision DNA v1（23,452 次元）に対する代表的な交叉方式を比較検討する。

| 方式名 | 概要 | 長所 | 短所 | V1 評価 |
| :--- | :--- | :--- | :--- | :--- |
| **A. Uniform Crossover (一様交叉)** | 各重みインデックス $i$ ごとに、独立確率 $P_x$（通常 0.5）で親 A または親 B の重みを選択する。 | ・完全に対称かつ汎用的。<br>・位置バイアス（Positional Bias）がゼロ。<br>・重み配列の並び順に依存しない。<br>・実装が極めて単純。 | ・23k 次元で完全に独立選択すると、双線形相互作用の共適応（Co-adaptation）が分断されるリスクがある。 | **V1 推奨基盤** |
| **B. One-Point / Two-Point Crossover (1点・2点交叉)** | フラット配列上の 1 つまたは 2 つのインデックスを境界として親の配列を分割・結合する。 | ・連続したブロック（局所相関）を一体として保持できる。 | ・配列のインデックス配置順序に強い位置バイアスが生じる。<br>・双線形行列（$163 \times 143$）を行優先フラット化しているため、幾何学的な意味での局所性が歪む。 | **不採用** |
| **C. Arithmetic / Blend Crossover (BLX-$\alpha$, 算術交叉)** | 両親の重みの線形結合 $w' = \alpha w_A + (1-\alpha) w_B$、またはその周辺の一様分布からサンプリングする。 | ・連続値最適化において滑らかな中間解を生成できる。 | ・重みの平均化によりコントラストが薄まり、Argmax 方針における明確な意思決定分離が鈍化しやすい。<br>・極端な特徴量バイアスが失われやすい。 | **不採用** |

---

## 5. Recommended Crossover V1 (V1推奨交叉方式)

### 推奨: Block-Segmented Uniform Crossover (ブロック分割型一様交叉)

V1 においては、**Block-Segmented Uniform Crossover** を採用する。

#### 選定理由
1. **Positional Bias の排除**: 1点・2点交叉のように「配列の先頭にあるパターンは親 A、末尾にあるパターンは親 B」という人為的なインデックス順バイアスを排除できる。
2. **完全な対称性と再現性**: 両親に対して偏りがなく、$P_x = 0.5$ により等しい遺伝的寄与を与える。
3. **ゲーム規則からの完全な独立性**: Action ID やルール定義を一切参照せず、純粋な浮動小数点配列操作として決定論的に完結する。

> [!NOTE]
> 本方式は「理論上最適」と断定するものではなく、実装の堅牢性・再現性・対称性を最大化するための **Provisional Engineering Default（暫定エンジニアリングデフォルト）** である。

---

## 6. Crossover Granularity (交叉の粒度と重み構造整合)

Decision DNA v1 の内部構造に基づき、交叉を適用する論理的粒度を定義する。

### 6.1 既存の Decision DNA v1 構造
`DecisionDNATypes.ts` に定義されている構造は以下の 2 つの重みブロックのみである（存在しない架空のブロックは一切定義しない）:
1. `patternWeights`: 143 次元（パターンバイアスベクトル）
2. `contextPatternWeights`: 23,309 次元（コンテキスト $\times$ パターンの双線形相互作用行列、行優先フラット配列）
※ `contextWeights` 単体は V1 には存在しない（Argmax 意思決定において定数項として相殺されるため）。

### 6.2 粒度の選択肢比較
- **Flat Full-Array Uniform Crossover**: 23,452 次元を 1 本のフラット配列とみなし、全要素を一様に $P_x = 0.5$ で選択。
- **Block-Level Unit Swap**: `patternWeights` 全体を親 A から、`contextPatternWeights` 全体を親 B から選ぶ（粒度が粗すぎる）。
- **Block-Segmented Uniform Crossover (推奨)**:
  - `patternWeights`（143 要素）に対して独立に Uniform Crossover（$P_x = 0.5$）を適用。
  - `contextPatternWeights`（23,309 要素）に対して独立に Uniform Crossover（$P_x = 0.5$）を適用。
  - 各ブロックの境界を意識し、型安全な DTO 構造を維持したままオフスプリングを生成する。

---

## 7. Parent Pair Contract (親ペア入力契約)

親ペアは、先行する Population Selection レイヤ（`PopulationSelector`）から提供される。

```typescript
export interface GeneticParentPair {
  readonly parentA: SelectedParent;
  readonly parentB: SelectedParent;
}
```

### 厳格な契約境界
1. **Fitness の再計算・再確認禁止**: Crossover レイヤは親の `fitnessScore` や勝敗統計を再検証しない。Selection レイヤが選出した出力をそのまま信用して受容する。
2. **provisionalScore の参照禁止**: Selection レイヤを通過した個体のみが渡されるため、Crossover 側で `provisionalScore` を覗き見たり、それに応じて交叉確率を変動させたりしてはならない。
3. **DNA の不変性**: 入力された親 DNA オブジェクト（`parentA.dna`, `parentB.dna`）を変更（mutate）してはならず、必ず新たな DNA オブジェクトを構築して返却する。

---

## 8. Self-Mating Policy & Retry Logic (自己交配回避とリトライ契約)

トーナメント選択は各親の選出において独立に行われるため、偶然に同一の個体が親 A と親 B の両方に選出されるケース（Self-Mating: 自己交配）が発生し得る。

### 8.1 自己交配の区別
- **Case 1 (同一 ID 自己交配)**: `parentA.genomeId === parentB.genomeId`（同一インスタンス・同一ゲノム ID）。
- **Case 2 (同義ゲノム交配)**: `parentA.genomeId !== parentB.genomeId` だが、DNA の重み配列が完全に一致するクローン。

### 8.2 V1 ポリシー
- **Case 1 に対するリトライ契約**:
  - Selection Pool 内の適格個体数（`validPoolSize`）が 2 以上の場合、親 B の再選択（Retry）を試行する。
  - **最大リトライ回数**: `maxSelfMatingRetries = 3`（Provisional Default）。
  - リトライ時のシード消費: `deriveSeedV1(offspringSeed, SELF_MATING_RETRY_V1, retryIndex)` を用いて決定論的に進行する。
  - **リトライ枯渇時の動作（Fail-Closed 原則の維持）**:
    - リトライを 3 回繰り返しても同一個体が選ばれ続けた場合、あるいは `validPoolSize === 1` の極限状態の場合、**例外終了（クラッシュ）はさせず、自己交配（Self-Mating）として受容する**。
    - 自己交配の場合、Crossover は実質的に親 A のクローンを出力し、その後の Mutation によって多様性を導入する（無性生殖＋変異モデル）。
    - **【絶対禁止】**: リトライが枯渇したからといって、適格でない `INSUFFICIENT_EVIDENCE` や `INVALID` 個体を親 B としてフォールバック採用してはならない。
- **Case 2 に対する方針**:
  - V1 では重みの一致判定（23k 次元の全比較）によるブロッキングは行わない。将来の多様性維持課題（Open Question）として扱う。

---

## 9. Mutation Candidates Comparison (突然変異候補方式の比較)

突然変異の対象遺伝子の選択方式を比較する。

| 方式名 | 概要 | 特徴と評価 | V1 評価 |
| :--- | :--- | :--- | :--- |
| **A. Per-Gene Probability (一様確率変異)** | 各重みインデックス $i$ に対して独立に確率 $p_m$ で変異を発生させる。 | ・標準的遺伝的アルゴリズムの王道。<br>・ゲノム全体に均等な探索圧力を配分。<br>・次元数 $N=23,452$ に対して適切な $p_m$（例: $0.01$ または $1/N$）を設定可能。 | **V1 推奨** |
| **B. Fixed-N Mutated Genes (固定個数変異)** | ゲノム全体からランダムにちょうど $K$ 個（例: 200 個）の重みを選んで変異させる。 | ・毎世代の変異遺伝子数が厳密に一定になる。<br>・非復元抽出のオーバーヘッドが 23k 次元で発生する。 | **不採用** |
| **C. Block-Level Mutation (ブロック単位変異)** | コンテキスト行単位やパターン単位など、意味のあるブロック全体をまとめて変異させる。 | ・協調的な変化を起こしやすい反面、粗すぎて既存の優良な意思決定構造を壊滅させやすい。 | **不採用** |

---

## 10. Recommended Mutation V1 (V1推奨突然変異方式)

### 推奨: Deterministic Normal-Like Perturbation V1 (`deterministic-normal-approx-v1`)

各重み $w_i$ に対し、独立確率 $p_m$（`mutationRate`）で決定論的正規分布近似ノイズを加算する。

$$w'_i = \text{clamp}(w_i + \delta_i, \text{mutationClampMin}, \text{mutationClampMax})$$

ここで、摂動量 $\delta_i$ は **初等超越関数（`Math.log`, `Math.sqrt`, `Math.cos` 等）を使用しない Irwin-Hall / 中心極限定理（CLT）整数和近似アルゴリズム** により算出する。

#### 10.1 整数 PRNG による正規分布近似アルゴリズム
Mulberry32 PRNG から 16-bit 整数乱数 $u_k \in [0, 65535]$ を 12 個生成する:

$$S = \sum_{k=1}^{12} u_k$$

期待値オフセット:
$$E[S] = 12 \times 32767.5 = 393,210 \quad (\text{完全な整数})$$

分散および標準偏差:
$$V[S] = 12 \times \frac{65536^2 - 1}{12} \approx 65536^2 \implies \sigma_S \approx 65536$$

正規化近似値:
$$\text{normalApprox} = \frac{S - 393210}{65536}$$

摂動量:
$$\delta_i = \text{mutationSigma} \times \text{normalApprox}$$

#### 10.2 選定理由
1. **移植性と決定論性（Transcendental Math の排除）**: Box-Muller で使用される `Math.log` や `Math.cos` は、CPU アーキテクチャ（x86 vs ARM）や JS エンジンの実装差により最下位ビット（ULP）の微小差が生じる可能性がある。本近似方式は 32-bit 整数加算・乗算のみで完結するため、環境を跨いだ完全な再現性を担保できる。
2. **計算効率**: 超越関数呼び出しがなく、高速な整数加算 12 回で済むため、23,452 次元の変異処理を極めて低コストで実行できる。
3. **有界性**: 出力は厳密に $[-6, +6] \times \sigma$ の範囲に収まるため、極端な特異点が発生しない。

---

## 11. Mutation Parameters & Provisional Defaults (突然変異パラメータと暫定デフォルト)

V1 における突然変異パラメータおよびそのエンジニアリングデフォルト値は以下の通りとする。

| パラメータ名 | 型 | Provisional Default | 意味と役割 |
| :--- | :--- | :--- | :--- |
| `mutationRate` ($p_m$) | `number` | `0.01` (1.0%) | 各重みが変異対象となる確率。全 23,452 重みのうち平均約 234 個が変異。 |
| `mutationSigma` ($\sigma$) | `number` | `0.05` | 摂動規模（標準偏差相当）。重みの微小調整に適した規模。 |
| `mutationClampMin` | `number` | `-10.0` | 変異後の重み下限値。 |
| `mutationClampMax` | `number` | `+10.0` | 変異後の重み上限値。 |

### 11.1 変異発生判定の uint32 閾値規約
浮動小数点比較の丸め誤差を排除するため、変異判定は 32-bit 整数空間で厳密に行う:

$$\text{threshold} = \lfloor \text{mutationRate} \times 4294967296 \rfloor$$

Mulberry32 から得られた 32-bit 符号なし整数 `randomUint32` に対し:
$$\text{randomUint32} < \text{threshold} \implies \text{変異実行}$$

- **境界挙動**:
  - `mutationRate = 0`: $\text{threshold} = 0$ となり、いかなる乱数値に対しても変異は発生しない（変異率 0% 保証）。
  - `mutationRate = 1`: $\text{threshold} = 4294967296$ となり、全遺伝子で無条件に変異が発生する（変異率 100% 保証）。

### 11.2 パラメータ制約
設定検証において、必ず $\text{mutationClampMin} < \text{mutationClampMax}$ であることを検証する。

---

## 12. Numeric Safety & Weight Clamping (数値安全性と Fail-Closed 契約)

### 12.1 不正数値の完全排除と Fail-Closed 規約
突然変異および交叉処理の出力において、以下の非有限値が発生することは厳格に禁止される:
- `NaN`
- `Infinity`
- `-Infinity`

> [!IMPORTANT]
> **非有限値検知時の Fail-Closed 契約**  
> 演算途中で万一非有限値が検出された場合、**元の重みへサイレントにフォールバック（隠蔽）してはならず**、直ちに `GeneticOperatorError` をスローして安全に処理を中断・失敗（Fail-Closed）させなければならない。

### 12.2 重みクランプ契約
- 加算結果が上限値 `+10.0` を超えた場合は `+10.0` へクランプする。
- 加算結果が下限値 `-10.0` を下回った場合は `-10.0` へクランプする。
- 既存の `DecisionDNACodec.validateDecisionDNA()`（全要素が有限浮動小数点数であること）と 100% 整合する。

---

## 13. Genetic Seed Contract & Mulberry32 PRNG (決定論的シード契約)

遺伝的操作は、**完全な決定論的再現性（Seeded Determinism）** を持たなければならない。

```text
【絶対禁止事項】
Math.random()
Date.now()
crypto.randomUUID()
環境時刻・プロセスPIDに基づく非決定論的乱数
```

### 13.1 乱数生成器の契約
- 32-bit 整数のシード値 `geneticSeed` を入力として受け取る。
- 既存の `PopulationSelector` やシミュレータコアと同様に、**Mulberry32 PRNG** アルゴリズムを使用する。

### 13.2 決定論保証境界（Determinism Scope）
- **同一ランタイム・同一プラットフォーム**: 同一の親ペア、同一の設定、同一の `geneticSeed`、同一の `seed-derivation-v1`、同一のオペレータバージョンであれば、生成されるオフスプリング DNA の全 23,452 重みは **ビット単位で 100% 完全一致** する。
- **クロスプラットフォーム（x86 vs ARM 等）**: `deterministic-normal-approx-v1` は初等超越関数を含まないため、標準的な IEEE 754 準拠環境において極めて高い再現性を維持する。

---

## 14. Seed Domain Separation Model & `seed-derivation-v1`

Selection の乱数ストリームと、Genetic Operators の乱数ストリームを同一の線形乱数消費列で暗黙共有してはならない。

### 14.1 既存ユーティリティの整理と位置づけ
既存コードベースには、対戦シミュレーション用の `DeterministicShuffle.deriveSeed` および `BatchSimulationRunner.deriveSeed` が存在する。これらは文字列テンプレート結合（`${baseSeed}:${streamKey}`）と FNV-1a を用いている。
AI 進化・遺伝操作においては、文字列アロケーションオーバーヘッドおよびエンコーディング曖昧性を完全に排除するため、純粋な uint32 ワード境界の **`seed-derivation-v1`** を正式定義する。

### 14.2 `seed-derivation-v1` アルゴリズム仕様
入力は 3 つの 32-bit 符号なし整数（`parentSeed`, `domainTag`, `index`）を受け取り、決定論的に 1 つの 32-bit 符号なし整数を出力する。

```typescript
export function deriveSeedV1(
  parentSeed: number,
  domainTag: number,
  index: number
): number {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit offset basis

  // Word 1: parentSeed
  h ^= (parentSeed >>> 0);
  h = Math.imul(h, 16777619) >>> 0; // FNV-1a prime

  // Word 2: domainTag
  h ^= (domainTag >>> 0);
  h = Math.imul(h, 16777619) >>> 0;

  // Word 3: index
  h ^= (index >>> 0);
  h = Math.imul(h, 16777619) >>> 0;

  // Final Avalanche Mixer (Murmur3 fmix32)
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;

  return h >>> 0;
}
```

### 14.3 固定 uint32 ドメインタグ定義
文字列ハッシュではなく、明確な 32-bit 定数タグを使用する:

| タグ定数名 | 16進数値 (uint32) | 意味・ASCII表現 |
| :--- | :--- | :--- |
| `SELECTION_V1` | `0x53454c31` | トーナメント選択用乱数ストリーム (`"SEL1"`) |
| `OFFSPRING_V1` | `0x4f464631` | 子個体生成（交叉・変異）用乱数ストリーム (`"OFF1"`) |
| `SELF_MATING_RETRY_V1` | `0x534d5231` | 自己交配回避リトライ用乱数ストリーム (`"SMR1"`) |

### 14.4 Known Test Vectors (実装時検証用テストベクトル)
以下のテストベクトルを Canonical Reference として定義する:

1. `deriveSeedV1(12345, 0x53454c31, 0) === 792183663` (`0x2f37bf6f`)
2. `deriveSeedV1(12345, 0x4f464631, 0) === 2335402472` (`0x8b3359e8`)
3. `deriveSeedV1(12345, 0x4f464631, 1) === 3485246005` (`0xcfbd7235`)
4. `deriveSeedV1(0, 0x53454c31, 0) === 791699075` (`0x2f305a83`)
5. `deriveSeedV1(2335402472, 0x534d5231, 0) === 76806788` (`0x0493f484`)

---

## 15. Offspring Identity / Lineage (子個体識別と系統追跡契約)

### 15.1 決定論的 Offspring genomeId 規約
世代スナップショットの完全な再現性を保証するため、`genomeId` に `randomUUID` やタイムスタンプを使用してはならない。

- **フォーマット**: `gen-${pad(generation, 6)}-offspring-${pad(offspringIndex, 6)}`
- **具体例**:
  - 世代 12 の 0 番目の子: `gen-000012-offspring-000000`
  - 世代 12 の 42 番目の子: `gen-000012-offspring-000042`

### 15.2 エリート個体の Identity
- エリート個体は新規 Offspring ではなく既存 genotype の継続であるため、**既存の `genomeId` をそのまま維持** する。
- 一方、`PopulationEntry.generation` は新世代番号（$g+1$）へ更新される。
- これにより、同一 DNA が複数世代にわたって生き残っていることが ID から透過的に追跡可能となる。

### 15.3 系統メタデータ (Lineage Contract)
オフスプリングの `metadata`（`DecisionDNAMetadata`）には、以下を記録可能とする:

```typescript
export interface OffspringLineageMetadata {
  readonly genomeId: string;
  readonly generation: number;
  readonly offspringIndex: number;
  readonly parentGenomeIds: readonly string[]; // [parentAId, parentBId] または [parentAId]
  readonly crossoverOperatorVersion: "block-segmented-uniform-v1" | "none";
  readonly mutationOperatorVersion: "deterministic-normal-approx-v1" | "none";
  readonly seedDerivationVersion: "seed-derivation-v1";
  readonly geneticSeed: number;
}
```
※ Fitness スコアは系統メタデータには記録しない。

---

## 16. Elite Inheritance Contract (エリート継承契約)

前世代で最も優秀であった個体（Best-Known Genotype）の消失を防ぐため、エリート保存（Elitism）を適用する。

### 16.1 厳格な継承ルール
1. **Genotype の完全不変保存**: エリートに選ばれた個体の DNA は、Crossover を受けず、Mutation も受けない。ビット単位で完全に同一の重み配列が次世代に引き継がれる。
2. **Fitness Score の非継承（最重要原則）**:
   - **前世代の `fitnessScore` は次世代へ絶対に引き継いではならない**。
   - エリート個体であっても、次世代（Generation $g+1$）の評価コンテキストにおいて、他の全個体と全く同列に対戦を実施し、**ゼロから再評価（Re-evaluated）されなければならない**。

```text
【エリート原則の数式表現】
Genotype Inheritance:
  DNA_{elite}(g+1) = DNA_{best}(g)   (完全一致)

Fitness Non-Inheritance:
  Fitness_{elite}(g+1) = Evaluate(DNA_{elite}(g+1), Context(g+1))
  ※ Fitness(g) の持ち越しは厳禁
```

---

## 17. Next Generation Population Boundary & Size (次世代母集団構成境界とサイズ)

次世代母集団のサイズ構成は以下の関係式を満たす。

$$\text{populationSize} = \text{eliteCount} + \text{offspringCount}$$

### 17.1 設定可能性契約
- `populationSize`: Provisional Default = `100`（$\ge 2$ の任意値として設定可能）。
- `eliteCount`: Provisional Default = `1`（$0 \le \text{eliteCount} < \text{populationSize}$）。
- `offspringCount`: $\text{populationSize} - \text{eliteCount}$（例: $100 - 1 = 99$ 個体）。
- **ハードコードの禁止**: 次世代を構築する Generation Builder は、母集団サイズ 100 を固定値としてコードに焼き付けてはならず、コンフィグから可変に受け取る設計とする。

---

## 18. Diversity Considerations (多様性確保とFitness非混合)

母集団の早期収束（Premature Convergence）を防ぐための多様性（Diversity）維持策について、境界契約を定義する。

### 18.1 最重要原則: Fitness への非混合
多様性指標（遺伝的距離、行動エントロピー、ユニーク手番率等）を、**Fitness スコアや Selection スコアに直接加算・混合することは厳禁**とする。
BlackPoker の進化適応度は、あくまで「対戦結果（Outcome）」のみによって決定されなければならない（Outcome-First 原則）。

---

## 19. Runtime Performance Telemetry Principles (実行時間計測の基本方針)

「1 試合に何 ms かかったか」「100 万試合を回すのに何時間必要か」を正確に予測・把握できなければならない。

### 19.1 最重要原則
1. **観測専用（Observation Only）**: 計測された実行時間（Elapsed Time）は、テレメトリおよび計算資源見積もり専用であり、**ゲームロジック、意思決定、Fitness 計算、選択処理には 1 ピコ秒たりとも影響を与えてはならない**。
2. **非決定論性の受容**: 実行時間は OS のスケジューリング、CPU 負荷、クロック変動、Docker オーバーヘッド等によって変動する。したがって、実行時間そのものは決定論的テストの検証対象としてはならず、統計値（平均、中央値、p95）として扱う。
3. **高精度モノトニッククロック**: 時刻同期や閏秒の影響を受ける `Date.now()` ではなく、Node.js 標準の高精度モノトニッククロック（`performance.now()`）を使用する。

---

## 20. Match Timing Contract (1試合単位の計測仕様)

### 20.1 主指標: `matchTotalElapsedMs` (Canonical Metric)
将来の対戦計算時間の見積もり（$\text{Total Time} \approx N \times \text{meanMatchTotalElapsedMs}$）に用いる Canonical Metric は **`matchTotalElapsedMs`** とする。

- **計測開始境界**: 1 試合に必要な処理の開始（Session 生成 / Match Setup 呼び出し直前）。
- **計測終了境界**: シミュレーションが完了し、最終 Match Result / Status が確定した直後。
- **内訳指標**:
  - `matchTotalElapsedMs`: **必須**。1 試合の全処理ウォールクロック時間。
  - `simulationElapsedMs`: **推奨・準必須**。`GameSession.step()` ループ純粋実行時間。
  - `setupElapsedMs`: **推奨 / オプション**。Session 生成・Regulation セットアップ所要時間。
  - 関係式: `matchTotalElapsedMs >= setupElapsedMs + simulationElapsedMs`（フレームワークの微小オーバーヘッドを許容）。

### 20.2 FAILED / INCOMPLETE における計測保持
- `COMPLETED` だけでなく、`INCOMPLETE`（手数上限到達中断）や `FAILED`（例外発生）の全試合で必ず `matchTotalElapsedMs` を記録する。
- 例外発生時も try-finally により Timing Record を欠落させない。

### 20.3 ログ I/O コストの分離
- 個別試合の `matchTotalElapsedMs` からは、ディスクへの生ログ書き込み（I/O）所要時間を原則除外する。
- これにより、純粋な計算コストと I/O コストを分離して評価できる。

```typescript
export interface MatchTimingRecord {
  readonly matchIndex: number;
  readonly matchSeed: number;
  readonly generation: number;
  readonly participantAId: string;
  readonly participantBId: string;
  readonly seatAssignment: "P1_A_P2_B" | "P1_B_P2_A";
  readonly status: "COMPLETED" | "INCOMPLETE" | "FAILED";
  readonly matchTotalElapsedMs: number;  // 主指標
  readonly simulationElapsedMs?: number; // 内訳: シミュレーションループ時間
  readonly setupElapsedMs?: number;      // 内訳: セットアップ時間
  readonly decisionCount: number;        // 手数
}
```

---

## 21. Batch / DNA / Generation Timing (バッチ・DNA・世代単位の集計仕様)

### 21.1 バッチ時間メトリクスの分離（Finding 2）
並列実行（`concurrency > 1`）において、個別試合時間の単純和とバッチ全体の経過時間は一致しないため、用語を厳格に分離する:

- **`sumMatchTotalElapsedMs`**: $\sum_{i=1}^{M} \text{matchTotalElapsedMs}_i$（全試合の累積処理時間、CPU 換算仕事量）。
- **`batchWallClockElapsedMs`**: バッチ開始から全試合終了・集計完了までの実際のウォールクロック経過時間。
- **スループット計算式**:
  $$\text{matchesPerSecond} = \frac{\text{matchCount}}{\text{batchWallClockElapsedMs} / 1000}$$
  ※ 並列実行時に `sumMatchTotalElapsedMs` を分母として用いることは厳禁。

### 21.2 バッチ集計メトリクス一覧
一定の対戦バッチ終了時に、以下の統計量を集計・記録する:
- `matchCount`: 総試合数
- `completedCount`, `incompleteCount`, `failedCount`: 状態別試合数
- `sumMatchTotalElapsedMs`: 個別試合時間の総和
- `batchWallClockElapsedMs`: バッチの実ウォールクロック経過時間
- `meanMatchTotalElapsedMs`: 算術平均 (`sumMatchTotalElapsedMs / matchCount`)
- `medianMatchTotalElapsedMs`: 中央値 (p50)
- `p95MatchTotalElapsedMs`: 95 パーセンタイル
- `minMatchTotalElapsedMs`, `maxMatchTotalElapsedMs`: 最小・最大時間
- `matchesPerSecond`: 秒間処理試合数
- `concurrency`: 実行並列度

### 21.3 `run-summary.json` 必須出力項目
```json
{
  "runId": "20261013T090000Z-gen001",
  "buildSha": "09b26c9452b1ee516f3cc30c6ee3d1d03fe93395",
  "buildRef": "BlackPoker/issue551-core-flow",
  "startedAt": "2026-10-13T09:00:00.000Z",
  "finishedAt": "2026-10-13T09:02:30.000Z",
  "matchCount": 1000,
  "completedCount": 998,
  "incompleteCount": 2,
  "failedCount": 0,
  "sumMatchTotalElapsedMs": 95400.5,
  "batchWallClockElapsedMs": 14200.2,
  "meanMatchTotalElapsedMs": 95.4,
  "medianMatchTotalElapsedMs": 92.1,
  "p95MatchTotalElapsedMs": 138.5,
  "minMatchTotalElapsedMs": 62.0,
  "maxMatchTotalElapsedMs": 280.4,
  "matchesPerSecond": 70.42,
  "concurrency": 8
}
```

---

## 22. Execution Environment & Hardware Metadata (実行環境・ハードウェアメタデータ仕様)

```typescript
export interface ExecutionEnvironmentMetadata {
  readonly buildSha: string;
  readonly buildRef: string;
  readonly nodeVersion: string;
  readonly platform: string;        // process.platform (例: "linux", "win32")
  readonly arch: string;            // process.arch (例: "x64", "arm64")
  readonly cpuModel: string;        // os.cpus()[0]?.model
  readonly logicalCpuCount: number; // os.cpus().length
  readonly concurrency: number;     // 実行並列度 (例: 1, 8)
}
```

---

## 23. Runtime Artifact Policy (実行時成果物方針)

大規模自己対戦やベンチマーク実行によって生成される大量のログデータは、**絶対に Git リポジトリへコミットしてはならない**。

### 23.1 基本方針
- **Git 管理対象**: ソースコード、型定義、ドキュメント、単体テスト、固定 Fixture、`.gitignore`。
- **Git 非管理対象（除外）**:
  - 対戦ログ生データ（`matches.jsonl`）
  - ベンチマーク詳細時間ログ（`timing.jsonl`）
  - エラーダンプ（`errors.jsonl`）
  - 大量対戦の集計ファイル（`run-summary.json`）
- **成果物ルート**: `tools/simulator/.artifacts/`（`.gitignore` に登録済み）。

---

## 24. Artifact Layout (.artifacts/ai-runs/<runId>/)

```text
tools/simulator/.artifacts/ai-runs/<runId>/
├── run-summary.json             # ラン全体のメタデータと集計統計（軽量）
├── matches.jsonl                # 全対戦の個別レコード（1行1試合、ストリーミング追記）
├── timing.jsonl                 # 高精度レイテンシイベントログ
└── errors.jsonl                 # 発生したエラー・例外スタック（0件の場合は空）
```

---

## 25. Git Policy (厳格なGit非コミット方針)

### 25.1 Independent Review への成果物伝達契約
自己対戦やベンチマークを実行した場合、最終報告チャットにおいて以下の情報を明記する:
- **Artifact Root**: `tools/simulator/.artifacts/ai-runs/<runId>/`
- **Run ID**: ラン識別子
- **生成ファイル一覧**: `run-summary.json`, `matches.jsonl` 等
- **主要集計サマリ**: `run-summary.json` の主要抜粋

ユーザーはこのパスから該当ファイルを取り出し、必要に応じてレビュー用チャットへ直接アップロードできる運用とする。

---

## 26. Worked Examples (具体的ユースケース検証)

### Case A: 同一親ペア・同一 geneticSeed
- **条件**: 親 A、親 B、および `geneticSeed = 12345` が与えられる。
- **結果**: 交叉および変異の乱数決定論性により、2 回実行しても生成されるオフスプリング DNA の 23,452 重みは 100% 完全に一致する。

### Case B: 同一親ペア・異なる geneticSeed
- **条件**: 親 A、親 B に対して、`geneticSeed = 12345` と `geneticSeed = 67890` を与える。
- **結果**: 交叉における親選択判定および変異ノイズが異なるため、それぞれ異なるオフスプリング DNA が生成される。

### Case C: 同一 genomeId の親ペア (自己交配)
- **条件**: トーナメント選択で同一個体（ID: `genome-001`）が親 A と親 B の両方に選出。母集団内の適格個体数は 5 個体。
- **動作**: 親 B の再選択（Retry）を実行（最大 3 回）。リトライ枯渇時も例外停止せず自己交配を受容し、親 A の変異クローンを出力する。適格でない個体へのフォールバックは絶対に行わない。

### Case D: エリート個体の継承
- **条件**: 世代 $g$ で最高適応度（$0.85$）を記録した個体 `genome-elite`。
- **動作**: ジェノタイプ（DNA 重み）はそのまま世代 $g+1$ に引き継がれるが、前世代の適応度スコア $0.85$ は破棄され、ゼロから再評価される。

### Case E: 突然変異による非有限値の発生防止 (Fail-Closed)
- **条件**: 変異計算過程で `NaN` や `Infinity` が検出された場合。
- **動作**: サイレントフォールバックを行わず、直ちに `GeneticOperatorError` をスローして安全に処理を中断する。

### Case F: 100 試合の実行時間集計
- **条件**: 100 試合のバッチ対戦が実行され、各試合の `matchTotalElapsedMs` が記録される。
- **動作**: `sumMatchTotalElapsedMs`, `meanMatchTotalElapsedMs`, `medianMatchTotalElapsedMs`, `p95MatchTotalElapsedMs` 等が集計・出力される。

### Case G: 同一 Seed・異なるハードウェア環境での実行
- **条件**: 同一の対戦シード系列を用いて、PC A（Intel Core i7）と PC B（Apple M2）で対戦を実行。
- **結果**: ゲーム論理結果は 100% 完全一致するが、`matchTotalElapsedMs` はハードウェア性能に応じて異なる（Timing の非決定論性の受容）。

### Case H: 並列度 1 vs 並列度 8 (Concurrency の区別)
- **条件**: 800 試合を実行。Case H1 は `concurrency = 1`、Case H2 は `concurrency = 8`。
- **動作**: 1 試合あたりの個別レイテンシ（`meanMatchTotalElapsedMs`）は約 120 ms で同等だが、バッチ全体のウォールクロック時間（`batchWallClockElapsedMs`）は Case H1 で約 96 秒、Case H2 で約 15 秒となる。

### Case I: 1 試合の実時間内訳と将来計算時間算出 (Finding 1)
- **条件**: 1 試合の計測において、`setupElapsedMs = 5.2 ms`, `simulationElapsedMs = 94.8 ms`。
- **動作**:
  - `matchTotalElapsedMs = 100.0 ms` として記録される。
  - 将来の計算量見積もり（例: 1,000,000 試合）には、シミュレーション時間（94.8 ms）ではなく、セッション生成コストを含んだ **100.0 ms** を使用する（$1,000,000 \times 100.0\text{ ms} = 100,000\text{ 秒} \approx 27.78\text{ 時間}$）。

### Case J: 並列バッチスループット算出 (Finding 2)
- **条件**: 100 試合を `concurrency = 8` で実行。`sumMatchTotalElapsedMs = 10,000 ms`, `batchWallClockElapsedMs = 1,500 ms`。
- **動作**:
  - 正しいスループット: $\text{matchesPerSecond} = 100 / (1500 / 1000) = 66.67\text{ matches/sec}$。
  - 誤った計算式（$100 / (10000 / 1000) = 10$）は使用しない。

### Case K: シード導出の決定論性 (Finding 3)
- **条件**: `generationSeed = 12345` に対し、`deriveSeedV1` を実行。
- **動作**:
  - `deriveSeedV1(12345, 0x53454c31, 0)` は常に `792183663` を返却。
  - `deriveSeedV1(12345, 0x4f464631, 0)` は常に `2335402472` を返却。
  - Known Test Vectors と完全一致する。

### Case L: 同一親・同一 geneticSeed・同一オペレータバージョン (Finding 4)
- **条件**: 同一の親ペア、同一の `geneticSeed`、オペレータバージョン `deterministic-normal-approx-v1`。
- **動作**: 生成されるオフスプリング DNA の重み配列は 100% 同一となる。

### Case M: 同一親・異なるハードウェア環境 (Finding 4)
- **条件**: PC A（x86_64）と PC B（ARM64）で同一の入力からオフスプリングを生成。
- **動作**: 超越関数を排除した整数和正規分布近似により、定義された決定論スコープ内で同一の DNA を再現する。

### Case N: 同一 Generation Build Input と決定論的 genomeId (Finding 5)
- **条件**: 世代 12 において 100 個体を生成。
- **動作**: オフスプリング ID は常に `gen-000012-offspring-000000` から `gen-000012-offspring-000098` までの完全同一の決定論的文字列系列となる。

---

## 27. Non-Goals (将来対応・非スコープ事項)

- ニューラルネットワーク型ゲノム構造への拡張（V1 は線形・双線形 DNA に特化）。
- 動的集団サイズ調整アルゴリズム（可変 Population Size）。
- 分散クラスタマシン間での分散遺伝的アルゴリズム（MPI 等）。
- リアルタイム対戦中のオンライントレーニング・強化学習。

---

## 28. Open Questions (将来の検討課題)

1. **双線形相互作用ブロックの局所構造保存**:
   - 行優先フラット配列の完全一様交叉では、同一コンテキスト行の相関が崩れやすい可能性がある。将来、行単位の交叉（Row-wise Uniform Crossover）を比較実験すべきか。
2. **自己適応型突然変異（Self-Adaptive Mutation Rate）**:
   - 世代経過に伴い進化が停滞した場合に変異率 $\sigma$ や $p_m$ を自動調整する仕組みを導入すべきか。
3. **同義 DNA（クローン）の検出コスト**:
   - 23,452 次元の完全一致判定を全ペアに対して行う場合の計算オーバーヘッドと、多様性維持効果のトレードオフ検証。
