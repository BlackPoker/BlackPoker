# BlackPoker Simulator Genetic Operators Design V1
# + Runtime Performance Telemetry / Artifact Policy (Follow-up R2)

作業ID: `BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2`  
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
- `tools/simulator/src/engine/random/RandomSource.ts` (Implemented)
- `tools/simulator/src/engine/random/DeterministicShuffle.ts` (Implemented)
- `tools/simulator/src/engine/simulation/BatchSimulationRunner.ts` (Implemented)

---

## 1. Purpose (設計目的)

本設計書は、BlackPoker Simulator AI 自己対戦進化（Phase 4.0: Self-Play Evolution）において、親個体の選択（Selection）の後に実行される **遺伝的操作子（Genetic Operators: Crossover / Mutation / Elite Inheritance / Offspring Lineage / 次世代 Population 境界）** の境界契約（Boundary Contract）を定義する。

さらに、今後の大規模自動対戦および世代交代実験において、必要な計算資源と所要時間を正確に見積もり・分析可能とするための **実行時間計測テレメトリ（Runtime Performance Telemetry）** および **実行時成果物保存方針（Runtime Artifact Policy）** を確定する。

### R2 Follow-up における確定・厳格化事項
1. **PRNG 消費規約の完全固定 (Finding 1)**:
   - `SeededRandom.next()` から 32-bit 符号なし整数を生成する Canonical 変換関数 `nextUint32V1(rng)` を定義（1 呼出 = 正確に 1 回の PRNG draw 消費）。`nextInt()` の raw word 生成使用は禁止。
   - 正規ノイズ近似用 16-bit 整数は `nextUint32V1(rng) >>> 16`（上位 16 ビット）に完全固定（1 個 = 1 PRNG draw）。
2. **乱数ストリームの完全分離**:
   - 1 個の Offspring 生成内においても、Crossover 用シードと Mutation 用シードを独立派生させ、一方のアルゴリズム変更が他方の乱数列に波及しないようストリームを完全分離。
   - 自己交配回避リトライ（Self-Mating Retry）も独立ストリームからシードを派生。
3. **既存 Seed 導出ユーティリティの再利用 (Option A 採用)**:
   - Simulator 内の Seed 体系の重複・増殖を防ぐため、R1 Draft で新設された独自 `seed-derivation-v1` は採用せず、既存の `DeterministicShuffle.ts` の `deriveSeed(baseSeed, streamKey)` を Canonical 方式として再利用。
   - 固定 Evolution Stream Keys（`evolution-selection-v1`, `evolution-offspring-v1-${i}`, `evolution-crossover-v1`, `evolution-mutation-v1`, `evolution-self-mating-retry-v1-${r}`）と Known Test Vectors を明記。
4. **Crossover & Mutation の PRNG 乱数消費スケジュール確定**:
   - Crossover: 遺伝子巡回順序を `patternWeights` (143) $\rightarrow$ `contextPatternWeights` (23,309) に固定。各遺伝子につき exactly 1 draw（合計 23,452 draws 固定）。
   - Mutation: 各遺伝子につき判定 1 draw。変異時のみ追加 12 draws（上位 16 ビット）。総 draw 数は $23,452 + 12 \times \text{mutatedGeneCount}$。
   - 変異率変更時の決定論スコープ（同一 config, seed, input に対して成立）を明記。
5. **Cross-Platform 決定論性の保証境界厳格化 (Finding 2)**:
   - 過剰保証を排除。同一 Node.js ランタイム、同一実装バージョン、同一 DNA、同一設定、同一シード、同一ストリームキーにおいて bit-exact を保証。
   - 異種アーキテクチャ（x64 vs arm64）や OS 間は「Cross-Platform Conformance Target」として定義し、将来のテストによる実測検証を経て Supported Runtime Matrix を拡大する。
6. **Timing 用語と統計値算出規約の厳密化 (Finding 3)**:
   - `sumMatchTotalElapsedMs` を「CPU work」「CPU time」「CPU換算仕事量」と呼ばず、「Aggregate Match Latency」または「Sum of Per-Match Wall-Clock Latencies」（各試合 wall-clock latency の単純和）として定義。`CPU Time Recorded: NO` を明記。
   - スループット計算の分母はバッチ全体の実ウォールクロック時間 `batchWallClockElapsedMs`。
   - Median（奇数: 中央値、偶数: 中央2値の平均、0試合時: Fail-Fast / NA）および P95（Nearest-Rank Method、補間不使用）の計算規約を確定。
7. **Artifact Root 表記の統一**:
   - Canonical Artifact Root を `tools/simulator/.artifacts/ai-runs/<runId>/` に統一（`tools/simulator/runs/` 誤記の排除）。Git 管理対象外。

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
- **RandomSource & DeterministicShuffle**:
  - `SeededRandom`: Mulberry32 アルゴリズムに基づく 32-bit PRNG。
  - `deriveSeed(baseSeed, streamKey)`: 32-bit FNV-1a による決定論的ストリーム派生。

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
- PRNG 消費規約（`nextUint32V1`, `uint16` 上位16ビット、1 draw 単位の明確化）。
- Crossover オペレータの推奨方式（Block-Segmented Uniform Crossover）、遺伝子順序、消費 draw 数。
- Mutation オペレータの推奨方式（`deterministic-normal-approx-v1`）、遺伝子順序、判定 draw・ノイズ draw 数、非有限値 Fail-Closed 契約。
- Crossover / Mutation / Self-Mating Retry の乱数ストリーム分離設計。
- 既存 `deriveSeed(baseSeed, streamKey)` 再利用に基づく Seed 体系および固定 Evolution Stream Keys。
- 決定論的 Offspring Identity（`gen-000012-offspring-000042`）および Lineage（系統情報）の表現形式。
- Elite Inheritance（ジェノタイプ完全保存と Fitness 非継承）の境界定義。
- 次世代 Population 生成境界（`populationSize = eliteCount + offspringCount`）。
- 実行時間計測テレメトリ（1 試合 `matchTotalElapsedMs` 主指標、setup/simulation 内訳、バッチ時間、並列スループット）。
- Timing 用語の厳格化（`sumMatchTotalElapsedMs` を CPU time / CPU work と呼ばない、`CPU Time Recorded: NO`）。
- 統計量（Median, P95 Nearest-Rank Method）の厳密な算出アルゴリズム。
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

## 6. Crossover Granularity & PRNG Consumption Contract (交叉の粒度と乱数消費規約)

### 6.1 重み構造と巡回順序
`DecisionDNATypes.ts` に定義されている 2 つの重みブロックを以下の **Canonical 順序** で巡回する:
1. `patternWeights`: 143 次元（インデックス $0 \dots 142$）
2. `contextPatternWeights`: 23,309 次元（行優先フラット配列、インデックス $0 \dots 23308$）

総重み遺伝子数: $143 + 23,309 = \mathbf{23,452}$ 次元。

### 6.2 PRNG Draw 消費スケジュール
- 各遺伝子につき、**exactly 1 回の `nextUint32V1(rng)`** を消費する。
- 判定ロジック:
  - $\text{word} < \text{0x80000000}$ (2147483648) $\implies$ 親 A の重みを採用
  - $\text{word} \ge \text{0x80000000}$ (2147483648) $\implies$ 親 B の重みを採用
  - これにより、$P_x = 0.5$（50% 確率）の等確率交叉が厳密に成立する。
- **Crossover 総 Draw 数**:
  $$\text{Total Crossover Draws} = \mathbf{23,452} \quad (\text{完全固定})$$
- `metadata` やその他の補助フィールドに対して PRNG draw は一切消費しない。

---

## 7. Parent Pair Contract & Assembler Responsibility (親ペア契約と責務境界)

### 7.1 厳格な責務境界
1. **Population Selection レイヤの責務**:
   - `PopulationSelector` は、評価スナップショットとトーナメント選択に基づき、個別の「親候補（Selected Parent）」を選出する。
2. **Parent Pair Assembler の責務**:
   - 選出された親候補から Parent A と Parent B のペアリングを構築する。
   - 同一ゲノム ID による自己交配の検知と、後述のリトライ（Self-Mating Retry）を統括する。
3. **Crossover レイヤの責務**:
   - 既に確定した `GeneticParentPair` を受け取り、交叉処理を実行する。
   - **Crossover 内部で親の再選択を行ってはならない**。

```typescript
export interface GeneticParentPair {
  readonly parentA: SelectedParent;
  readonly parentB: SelectedParent;
}
```

### 7.2 厳格な契約境界
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
  - **独立リトライシード**:
    $$\text{retrySeed} = \text{deriveSeed}(\text{offspringSeed}, \text{"evolution-self-mating-retry-v1-" } + \text{retryIndex})$$
    - リトライ操作は独立した乱数ストリームを消費し、**Crossover ストリームおよび Mutation ストリームを一切消費・汚染しない**。
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
Mulberry32 PRNG から 16-bit 整数乱数 $u_k \in [0, 65535]$ を 12 個サンプリングする。  
後述の PRNG 消費規約に基づき、各 $u_k$ は `nextUint32V1(rng) >>> 16`（上位 16 ビット）とする:

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
1. **移植性と決定論性（Transcendental Math の排除）**: Box-Muller で使用される `Math.log` や `Math.cos` は、CPU アーキテクチャや JS エンジンの実装差により最下位ビットの微小差が生じる可能性がある。本近似方式は 32-bit 整数加算・乗算のみで完結するため、環境を跨いだ高い再現性を担保できる。
2. **計算効率**: 超越関数呼び出しがなく、高速な整数加算 12 回で済むため、23,452 次元の変異処理を極めて低コストで実行できる。
3. **有界性**: 出力は厳密に $[-6, +6] \times \sigma$ の範囲に収まるため、極端な特異点が発生しない。

---

## 11. Mutation Parameters & PRNG Consumption Contract (突然変異パラメータと乱数消費規約)

### 11.1 パラメータとエンジニアリングデフォルト

| パラメータ名 | 型 | Provisional Default | 意味と役割 |
| :--- | :--- | :--- | :--- |
| `mutationRate` ($p_m$) | `number` | `0.01` (1.0%) | 各重みが変異対象となる確率。全 23,452 重みのうち平均約 234 個が変異。 |
| `mutationSigma` ($\sigma$) | `number` | `0.05` | 摂動規模（標準偏差相当）。重みの微小調整に適した規模。 |
| `mutationClampMin` | `number` | `-10.0` | 変異後の重み下限値。 |
| `mutationClampMax` | `number` | `+10.0` | 変異後の重み上限値。 |

設定検証において、必ず $0 \le \text{mutationRate} \le 1$ かつ $\text{mutationClampMin} < \text{mutationClampMax}$ である有限数を検証する。

### 11.2 変異発生判定の uint32 閾値規約
浮動小数点比較の丸め誤差を排除するため、変異判定は 32-bit 整数空間で厳密に行う:

$$\text{threshold} = \begin{cases} 4294967296 & (\text{mutationRate} === 1) \\ \lfloor \text{mutationRate} \times 4294967296 \rfloor & (\text{otherwise}) \end{cases}$$

Mulberry32 から得られた 32-bit 符号なし整数 `word`（`nextUint32V1(rng)`）に対し:
$$\text{word} < \text{threshold} \implies \text{変異実行}$$

- `mutationRate = 0`: $\text{threshold} = 0 \implies$ 変異率 0% 保証。
- `mutationRate = 1`: $\text{threshold} = 4294967296 \implies$ 全遺伝子で無条件変異（変異率 100% 保証）。

### 11.3 遺伝子巡回順序と PRNG Draw 消費スケジュール
- **Canonical 順序**:
  1. `patternWeights` ($0 \dots 142$)
  2. `contextPatternWeights` ($0 \dots 23308$)
- **各遺伝子における PRNG Draw 消費**:
  - **Step 1 (変異判定)**: exactly 1 回の `nextUint32V1(rng)` を消費。
  - **Step 2 (非変異時)**: `word >= threshold` の場合、追加の PRNG draw は **0 回**（消費なし）。
  - **Step 3 (変異時)**: `word < threshold` の場合、**exactly 12 回の `nextUint32V1(rng)`** を追加消費。各 word の上位 16 ビット（`w >>> 16`）を $u_1 \dots u_{12}$ として使用。
- **1 個体の Mutation 総 Draw 数式**:
  $$\text{Total Mutation Draws} = \mathbf{23,452} + 12 \times \text{mutatedGeneCount}$$

### 11.4 変異率変更時の決定論スコープ
`mutationRate` を変更した場合、変異判定結果が変化するため、以降の PRNG 消費位置（アライメント）も変化し得る。  
これは V1 の設計として完全に許容される。  
すなわち、決定論性（Determinism Contract）は **同一設定・同一シード・同一入力** に対して成立するものであり、異なる `mutationRate` 間でノイズストリームの同一性までは保証しない。

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

## 13. PRNG Consumption Contract & Determinism Scope (乱数消費規約と再現性境界)

遺伝的操作は、**完全な決定論的再現性（Seeded Determinism）** を持たなければならない。

```text
【絶対禁止事項】
Math.random()
Date.now()
crypto.randomUUID()
環境時刻・プロセスPIDに基づく非決定論的乱数
```

### 13.1 Canonical uint32 変換関数 (`nextUint32V1`)
既存 `RandomSource` インターフェース（`SeededRandom`）の `next()` は $[0, 1)$ の浮動小数点数を返す。  
遺伝的操作において 32-bit 符号なし整数（word）を得るための標準変換関数を以下のように固定する:

```typescript
export function nextUint32V1(rng: RandomSource): number {
  return Math.floor(rng.next() * 4294967296) >>> 0;
}
```

- **契約**: 1 回の `nextUint32V1(rng)` 呼び出しは、`rng.next()` を **正確に 1 回消費** する。
- **禁止**: `nextInt()` を遺伝操作の生の乱数ワード生成に使用してはならない（範囲変換の内部計算によるアライメントズレを防ぐため）。

### 13.2 Canonical uint16 変換規約
Irwin-Hall 正規ノイズ近似で使用する 16-bit 乱数 $u_k$ は、以下のように定義する:

```typescript
const word = nextUint32V1(rng);
const u16 = word >>> 16; // 上位 16 ビット (upper 16 bits)
```

- **契約**: 必ず **上位 16 ビット** を使用する。下位 16 ビットを使用する実装は許容しない。
- 1 個の $u_k$ 生成 = 1 回の PRNG draw（`nextUint32V1`）。

### 13.3 決定論性保証境界（Determinism Scope）
過剰保証（「あらゆる未知の環境でビット完全一致」等）を排除し、V1 において正式に保証する境界を以下に限定する:

- **正式保証スコープ (Supported Deterministic Runtime)**:
  - 同一のサポート対象 Node.js ランタイム（例: Node.js v20.x LTS）
  - 同一のオペレータ実装バージョン
  - 同一の入力 Decision DNA
  - 同一の Genetic Config
  - 同一の Seed 値
  - 同一の Stream Key 契約
  上記が満たされる場合、生成される Offspring DNA の全 23,452 重みは **ビット単位で 100% 完全一致（Bit-exact Reproduction）** する。

- **クロスプラットフォーム（Cross-Platform Conformance Target）**:
  - CPU アーキテクチャ（x64 vs arm64）や OS（Linux, Windows, macOS）間については、設計段階で bit-exact を断言しない。
  - 代わりに「Cross-Platform Conformance Target」として位置づけ、Production 実装後に同一の Test Vector を複数環境で実行して bit-exact を実測検証する。
  - 実測で bit-exact が確認された環境のみを「Supported Deterministic Runtime Matrix」に追加する。
  - 万一、将来のクロスプラットフォームテストでビット差が検出された場合は、直ちにゲーム性や Fitness の破壊（Game/Fitness Correctness Failure）とは扱わず、「遺伝操作子の移植性課題（Genetic Operator Portability Issue）」として切り分ける。

---

## 14. Seed Architecture Decision & Domain Separation (シード体系判断と領域分離)

### 14.1 既存ユーティリティ再利用の決定 (Option A 採用)
シミュレータコードベース内における Seed 導出方式の重複・増殖を防ぐため、設計判断を行う:

- **Option A (採用)**: `tools/simulator/src/engine/random/DeterministicShuffle.ts` の既存 `deriveSeed(baseSeed, streamKey)` を Evolution でも再利用する。
  - **採用理由**:
    1. 既に実装・単体テスト済みであり、安定稼働の実績がある。
    2. 32-bit FNV-1a アルゴリズムにより完全な決定論性を持つ。
    3. 文字列キーによる直感的かつ柔軟なドメイン分離が可能。
    4. シミュレータ内で複数の異なる Seed ハッシュ体系が乱立するのを防ぎ、アーキテクチャの一貫性を維持できる。
    5. 遺伝操作の実行頻度に対し、文字列ハッシュ計算のオーバーヘッドは対戦シミュレーション全体と比較して極めて軽微であり、性能ボトルネックにならない。
- **Option B (不採用・廃止)**: R1 Draft で提案された純粋 uint32 ワードベースの独自 `seed-derivation-v1`（FNV word + Murmur3 fmix32）。
  - **理由**: Option A の既存ユーティリティで要件（決定論性・ドメイン分離）が完全に満たされており、第 2 のシード導出方式を新設する技術的必要性がないため不採用とする。

### 14.2 既存 `deriveSeed` の仕様
```typescript
export function deriveSeed(baseSeed: number, streamKey: string): number {
  const str = `${baseSeed}:${streamKey}`;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
```

### 14.3 Canonical Evolution Stream Keys
進化処理における各サブストリームのキー文字列は、以下の **固定フォーマット** に完全統一する（表記揺れ厳禁）:

| 用途 | Stream Key フォーマット | 具体例 |
| :--- | :--- | :--- |
| トーナメント選択 | `evolution-selection-v1` | `evolution-selection-v1` |
| 子個体ベースシード | `evolution-offspring-v1-${offspringIndex}` | `evolution-offspring-v1-0`, `evolution-offspring-v1-42` |
| 交叉乱数ストリーム | `evolution-crossover-v1` | `evolution-crossover-v1` |
| 突然変異乱数ストリーム | `evolution-mutation-v1` | `evolution-mutation-v1` |
| 自己交配リトライ | `evolution-self-mating-retry-v1-${retryIndex}` | `evolution-self-mating-retry-v1-0`, `evolution-self-mating-retry-v1-1` |

### 14.4 シード派生階層モデル (Hierarchical Derivation Model)
```text
generationSeed
  ├── deriveSeed(generationSeed, "evolution-selection-v1")
  │     └── selectionSeed (トーナメント親選択に使用)
  │
  ├── deriveSeed(generationSeed, "evolution-offspring-v1-0")
  │     └── offspringSeed[0]
  │           ├── deriveSeed(offspringSeed[0], "evolution-crossover-v1")
  │           │     └── crossoverSeed (交叉オペレータに使用)
  │           ├── deriveSeed(offspringSeed[0], "evolution-mutation-v1")
  │           │     └── mutationSeed (変異オペレータに使用)
  │           └── deriveSeed(offspringSeed[0], "evolution-self-mating-retry-v1-0")
  │                 └── retrySeed[0] (自己交配リトライ親選択に使用)
  │
  └── deriveSeed(generationSeed, "evolution-offspring-v1-1")
        └── offspringSeed[1]
              └── ...
```

### 14.5 Evolution Known Test Vectors (実装時検証用テストベクトル)
`generationSeed = 12345` に対する Canonical Test Vectors を以下のように定義する:

1. **Selection Seed**:
   `deriveSeed(12345, "evolution-selection-v1") === 1967515842` (`0x7545e8c2`)
2. **Offspring 0 Base Seed**:
   `deriveSeed(12345, "evolution-offspring-v1-0") === 4024959625` (`0xefe80289`)
3. **Offspring 1 Base Seed**:
   `deriveSeed(12345, "evolution-offspring-v1-1") === 4008182006` (`0xeee800f6`)
4. **Crossover Seed (for Offspring 0)**:
   `deriveSeed(4024959625, "evolution-crossover-v1") === 3354403331` (`0xc7f02203`)
5. **Mutation Seed (for Offspring 0)**:
   `deriveSeed(4024959625, "evolution-mutation-v1") === 88400338` (`0x0544e1d2`)
6. **Self-Mating Retry 0 Seed (for Offspring 0)**:
   `deriveSeed(4024959625, "evolution-self-mating-retry-v1-0") === 1504965328` (`0x59b3f2d0`)

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
  readonly seedDerivationVersion: "derive-seed-fnv1a-v1";
  readonly offspringSeed: number;
  readonly crossoverSeed?: number;
  readonly mutationSeed?: number;
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
  readonly matchTotalElapsedMs: number;  // 主指標 (wall-clock latency)
  readonly simulationElapsedMs?: number; // 内訳: シミュレーションループ時間
  readonly setupElapsedMs?: number;      // 内訳: セットアップ時間
  readonly decisionCount: number;        // 手数
}
```

---

## 21. Batch Timing, Throughput & Statistics Contract (バッチ時間・スループット・統計値契約)

### 21.1 バッチ時間メトリクス用語の厳格化 (Finding 3)
用語の混乱を防ぐため、以下の定義を厳格に順守する:

- **`matchTotalElapsedMs`**: 1 試合のウォールクロック所要時間（Wall-Clock Latency）。
- **`sumMatchTotalElapsedMs`**: 各試合の `matchTotalElapsedMs` の単純和。
  - **重要**: 本指標を **「CPU work」「CPU time」「CPU換算仕事量」と呼んではならない**。
  - 正式な定義名: **「Aggregate Match Latency」** または **「Sum of Per-Match Wall-Clock Latencies」**。
  - 今回の実装では CPU 時間そのものは計測しない（`CPU Time Recorded: NO`）。
- **`batchWallClockElapsedMs`**: バッチ全体の実際のウォールクロック経過時間（バッチ開始から全試合完了・集計終了まで）。
- **`matchesPerSecond` (実スループット)**:
  $$\text{matchesPerSecond} = \frac{\text{matchCount}}{\text{batchWallClockElapsedMs} / 1000}$$
  ※ 並列実行時（`concurrency > 1`）に `sumMatchTotalElapsedMs` を分母として用いることは厳禁。

### 21.2 統計値算出規約 (Median & P95 Contract)
集計環境や言語処理系に依存しない一意な統計値算出アルゴリズムを以下のように確定する:

#### A. 中央値 (Median)
ソート済み昇順サンプル $x[0 \dots n-1]$ に対し:
- $n$ が奇数の場合: 中央の要素 $x[(n - 1) / 2]$
- $n$ が偶数の場合: 中央の 2 要素の算術平均 $(x[n / 2 - 1] + x[n / 2]) / 2$
- $n = 0$（試合数 0）の場合: Timing Summary 生成不可として Fail-Fast または `null` / Not Available とする（曖昧な 0 埋めは行わない）。

#### B. 95 パーセンタイル (P95 Nearest-Rank Method)
補間方式（Linear Interpolation 等）によるランタイム差異を排除するため、**最近傍ランク法（Nearest-Rank Method）** を Canonical 方式とする:
- ソート済み昇順サンプル $x[0 \dots n-1]$ に対し:
  $$\text{rank} = \lceil 0.95 \times n \rceil$$
  $$\text{index} = \max(0, \text{rank} - 1)$$
  $$\text{p95} = x[\text{index}]$$
- これにより、どの環境でも同一のレイテンシログから完全に同一の p95 値が計算できる。

### 21.3 将来の PC 性能比較における指標
異なる PC 環境間で処理能力を比較・ベンチマークする際は、以下の指標群を主要比較対象とする:
1. `meanMatchTotalElapsedMs`
2. `p95MatchTotalElapsedMs`
3. `batchWallClockElapsedMs`
4. `matchesPerSecond`
5. `concurrency`
6. ハードウェア情報 (`cpuModel`, `nodeVersion`, `platform`, `arch`)
※ `sumMatchTotalElapsedMs` は補助的な分析値としてのみ扱う。

### 21.4 `run-summary.json` スキーマ
```json
{
  "runId": "20261013T090000Z-gen001",
  "buildSha": "41a4d3114dba2c2eccff7f21e23572cd9f3ad7f2",
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

成果物ルートの表記は、ドキュメント・ロードマップ・報告書のすべてで **`tools/simulator/.artifacts/ai-runs/<runId>/`** に完全統一する（`tools/simulator/runs/` 等の表記は禁止）。

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
- **動作**: `sumMatchTotalElapsedMs`（単純和）, `meanMatchTotalElapsedMs`, `medianMatchTotalElapsedMs`, `p95MatchTotalElapsedMs` 等が集計・出力される。

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

### Case K: シード導出の決定論性と Known Test Vectors (R2 Option A)
- **条件**: `generationSeed = 12345` に対し、既存の `deriveSeed(baseSeed, streamKey)` を実行。
- **動作**:
  - `deriveSeed(12345, "evolution-selection-v1") === 1967515842`
  - `deriveSeed(12345, "evolution-offspring-v1-0") === 4024959625`
  - `deriveSeed(4024959625, "evolution-crossover-v1") === 3354403331`
  - `deriveSeed(4024959625, "evolution-mutation-v1") === 88400338`
  - `deriveSeed(4024959625, "evolution-self-mating-retry-v1-0") === 1504965328`
  - Known Test Vectors と 100% 完全一致する。

### Case L: 同一親・同一 geneticSeed・同一オペレータバージョン
- **条件**: 同一の親ペア、同一の `geneticSeed`、同一のオペレータバージョン。
- **動作**: 生成されるオフスプリング DNA の重み配列は 100% 同一となる。

### Case M: クロスプラットフォーム適合性ターゲット (Finding 2)
- **条件**: PC A（x86_64）と PC B（ARM64）で同一の入力からオフスプリングを生成。
- **動作**: 超越関数を排除した整数和正規分布近似により、高精度の再現性を目指す。Production 実装後に実測テストを実施し、一致が確認された環境を Supported Deterministic Runtime Matrix へ追加する。

### Case N: 同一 Generation Build Input と決定論的 genomeId
- **条件**: 世代 12 において 100 個体を生成。
- **動作**: オフスプリング ID は常に `gen-000012-offspring-000000` から `gen-000012-offspring-000098` までの完全同一の決定論的文字列系列となる。

### Case O: PRNG Draw 消費スケジュールの完全再現性 (R2 Finding 1)
- **条件**: 全 23,452 遺伝子の個体に対し、Crossover と Mutation を実行。
- **動作**:
  - Crossover: 23,452 回の `nextUint32V1()` を正確に消費。
  - Mutation: 23,452 回の変異判定 draw を消費。変異が 230 箇所発生した場合、追加で $230 \times 12 = 2,760$ 回の draw を消費。
  - Mutation 総 draw 数: $23,452 + 2,760 = 26,212$ draws。
  - 同一シードであれば、変異箇所・ノイズ値・乱数消費回数が 1 draw もズレることなく完全に再現する。

### Case P: Median および P95 の計算例 (R2 Finding 3)
- **条件**: 4 試合のレイテンシサンプル `[10, 20, 30, 40]` ms（ソート済み）。
- **動作**:
  - サンプル数 $n = 4$（偶数）。
  - 中央値（Median）: 中央 2 要素（20 と 30）の算術平均 $\implies (20 + 30) / 2 = \mathbf{25.0\text{ ms}}$。
  - 95 パーセンタイル（P95 Nearest-Rank）:
    $$\text{rank} = \lceil 0.95 \times 4 \rceil = \lceil 3.8 \rceil = 4$$
    $$\text{index} = \max(0, 4 - 1) = 3$$
    $$\text{p95} = x[3] = \mathbf{40.0\text{ ms}}$$
  - 補間を行わないため、任意の実装言語・環境で完全に同一の値が得られる。

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
