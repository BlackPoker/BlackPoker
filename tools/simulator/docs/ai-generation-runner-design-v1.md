# BlackPoker Simulator Generation Runner Design V1
# (Generation g 自己対戦評価・適応度集計・次世代遷移実行境界契約)

作業ID: `BP-SIM-AI-GENERATION-RUNNER-DESIGN-V1`  
ステータス: **PROPOSED / DESIGNED (PENDING INDEPENDENT REVIEW)**  
対象リポジトリ: `BlackPoker/BlackPoker`  
対象ブランチ: `BlackPoker/issue551-core-flow`  
先行仕様（Prerequisites）:
- `tools/simulator/docs/ai-fitness-design-v1.md` (Formal Accepted, SHA: `3b064b5f1b20351d2571680308399472875398a5`)
- `tools/simulator/docs/ai-population-selection-design-v1.md` (Formal Accepted)
- `tools/simulator/docs/ai-genetic-operators-design-v1.md` (Formal Accepted, SHA: `8a7fa95db288a50ae33f3890fb9ea37fe4342045`)
- `tools/simulator/docs/ai-generation-builder-design-v1.md` (Formal Accepted, SHA: `a86c940b974ec7c3675c9debe4d91556fa9ea677`)
- Generation Builder Production Implementation: `BP-SIM-AI-GENERATION-BUILDER-V1-R3` (Formal Accepted, SHA: `a1634df3bae143dd3401fff85ffb1180c082fcb7`)
- `tools/simulator/src/domain/ai/FitnessEvaluationTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/FitnessEvaluator.ts` (Implemented)
- `tools/simulator/src/domain/ai/PopulationSelectionTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/PopulationSelector.ts` (Implemented)
- `tools/simulator/src/domain/ai/GeneticOperatorTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/GeneticOperators.ts` (Implemented)
- `tools/simulator/src/domain/ai/GenerationBuilderTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/GenerationBuilder.ts` (Implemented)
- `tools/simulator/src/domain/simulation/BatchSimulationTypes.ts` (Implemented)
- `tools/simulator/src/engine/simulation/BatchSimulationRunner.ts` (Implemented)
- `tools/simulator/src/engine/simulation/SimulationRunner.ts` (Implemented)
- `tools/simulator/src/engine/ai/GenomePolicy.ts` (Implemented)
- `tools/simulator/src/domain/ai/PolicyExperimentTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/PolicyExperimentRunner.ts` (Implemented)
- `tools/simulator/src/engine/random/DeterministicShuffle.ts` (`deriveSeed` Implemented)

---

## 1. Purpose (設計目的)

本設計書は、BlackPoker Simulator AI 自己対戦進化（Phase 4.0: Self-Play Evolution）において、Formal Accepted 済みとなった **Fitness Evaluator**、**Population Selection**、**Genetic Operators**、**Runtime Telemetry**、および **Generation Builder** を垂直統合し、

$$\text{PopulationSnapshot}(g) \xrightarrow{\text{Self-Play Evaluation}} \text{FitnessEvaluationSnapshot}(g) \xrightarrow{\text{GenerationBuilder}} \text{PopulationSnapshot}(g+1)$$

という **「ちょうど1世代分（One Generation Only）」** の自己対戦評価・適応度集計・次世代遷移の実行境界（Generation Runner Execution Boundary）を定義する。

Generation Runner は、母集団 $N$ 個体の全ペアによる決定論的 **Double Round Robin（二重総当たり戦）** スケジュールを構築・実行し、勝敗結果を `FitnessEvaluator` へ委譲して客観的な適応度スナップショットを生成した上で、`GenerationBuilder` を通じて次世代母集団を安全かつアトミックに導出する。

> [!IMPORTANT]
> **本作業のスコープ境界 (DESIGN ONLY)**  
> 本ドキュメントは **DESIGN ONLY（設計仕様の確定のみ）** であり、Generation Runner の TypeScript プロダクションコード実装、テストコード実装、および複数世代を繰り返す Evolution Loop の実装は一切行いません。

---

## 2. Non-Goals (明示的非対象スコープ)

Generation Runner V1 の責務を単一世代遷移に厳密に集中させるため、次の項目を明示的にスコープ外（Non-Goals）とする:

1. **Evolution Loop (複数世代反復ループ)**:
   - 「100世代回す」「収束するまでループする」等の世代反復制御は Generation Runner の責務外であり、将来の上位オーケストレータ（Evolution Loop）が担当する。
2. **停止条件・収束判定 (Stopping Criteria)**:
   - 最大世代数到達、適応度飽和、多様性枯渇等の判定は行わない。
3. **Hall of Fame / Champion Preservation**:
   - 歴代最高ゲノムの選定・殿堂入り対戦・過去世代プールとの比較対戦は含めない（現世代内自己対戦のみ）。
4. **Rating / ランキングシステム (Elo, Glicko)**:
   - 相対レーティングの算出や更新は行わず、Outcome-First Fitness (MPA) のみを評価対象とする。
5. **永続化・チェックポイント (Persistence / Checkpoint / Resume)**:
   - ディスク（ファイルシステム）、データベースへの保存・復元、チェックポイント管理は含めない。
6. **分散・並列実行基盤 (Distributed Execution / Cluster / GPU / Cloud)**:
   - クラスタ分散実行、GPU 並列化、Mac mini 最適化等のインフラ関心事は含めない。
7. **GUI / 進化可視化 (Evolution UI)**:
   - チャート描画、リアルタイム進捗画面等は含めない。
8. **自動ハイパーパラメータチューニング (Auto Parameter Tuning)**:
   - 突然変異率やトーナメントサイズの動的最適化は行わない。
9. **初期母集団生成 (Initial Population Generation)**:
   - Generation 0 のランダム DNA 生成や starter population 構築は対象外（有効な `PopulationSnapshot` を入力として受け取る）。

---

## 3. Prerequisites (前提事実と先行契約)

Generation Runner V1 は、既に Independent Review を経て Formal Accepted となった以下のアーキテクチャ資産と不変契約に直接依拠する:

1. **Outcome-First Fitness 原則 (`ai-fitness-design-v1.md`)**:
   - *"Victory is the objective. Life is a resource, not a score."*
   - 勝敗（Outcome: Win, Loss, Draw）のみを適応度の源泉とし、残りライフ、被ダメージ、ターン数、所要時間、意思決定数等の実行時テレメトリを適応度計算から完全隔離。
2. **母集団モデルと選択契約 (`ai-population-selection-design-v1.md`)**:
   - 母集団は不変スナップショット（`PopulationSnapshot`）として表現。
   - 親選択は `VALID` 個体のみを対象とし、`INSUFFICIENT_EVIDENCE` や `INVALID` は完全除外。
3. **遺伝的操作子とストリーム分離 (`ai-genetic-operators-design-v1.md`)**:
   - 交叉、突然変異、自己交配回避リトライは各独立した Canonical Evolution Stream Keys に基づき決定論的に動作。
   - エリート個体の Genotype は完全保存されるが、**Fitness Score は次世代へ非継承（ゼロから再評価）**。
4. **次世代構築エンジン (`ai-generation-builder-design-v1.md`)**:
   - 単一親系列（Single-Series Parent Selection）契約。
   - 有効適応度ゲート（Effective Readiness Gate: $\text{validCount} \ge \text{eliteCount}$）。
   - Canonical Logical DNA Reference (`genome:<genomeId>`) による参照隔離。
5. **シミュレーション実行・失敗隔離基盤 (`BatchSimulationRunner.ts` / `SimulationRunner.ts`)**:
   - `sessionFactory` および `policyFactory` による試合間インスタンス完全隔離。
   - `COMPLETED`, `INCOMPLETE`, `FAILED` の厳格な3値ステータス分類。
   - `INCOMPLETE != DRAW`（未決着は引き分けとみなさない）。

---

## 4. Architecture (全体アーキテクチャ)

Generation Runner は、BlackPoker Simulator のドメイン層とシミュレーション実行層の中間に位置する「単一世代オーケストレータ」として機能する。

```text
========================================================================================
                                 Evolution Loop (将来スコープ)
                 for (let g = 0; g < maxGenerations; g++) { run(...) }
========================================================================================
                                           │
                                           │ generationSeed(g)
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                        Generation Runner V1 (本設計スコープ)                          │
│                                                                                      │
│  [Step 1] Population Validation                                                      │
│    PopulationSnapshot(g) の構造・一意性・不変性を検証 (N >= 2)                       │
│                                                                                      │
│  [Step 2] Canonical Double Round Robin Schedule Construction                         │
│    Canonical Ordering (genomeId 昇順) -> 全ペア A vs B / B vs A 生成                 │
│    Total Matches: N * (N - 1) * R (R = pairRepetitions)                              │
│                                                                                      │
│  [Step 3] Deterministic Match Execution (Production Simulation Path)                 │
│    for each match in schedule:                                                       │
│      pairSeed = deriveSeed(generationSeed, streamKey)                                │
│      GenomePolicy(p1.dna) vs GenomePolicy(p2.dna)                                    │
│      GameSession.advance() via SimulationRunner.run()                                │
│      Outcome: COMPLETED (Winner) | INCOMPLETE | FAILED                               │
│                                                                                      │
│  [Step 4] Deterministic Outcome Aggregation                                          │
│    全試合結果を各ゲノムの PolicyParticipantOutcomeSummary へ集約                      │
│                                                                                      │
│  [Step 5] Fitness Evaluation (Outcome-First V1)                                      │
│    FitnessEvaluator.evaluateParticipant() による評価                                 │
│    -> FitnessEvaluationSnapshot(g) 構築 (1:1 整合)                                   │
│                                                                                      │
│  [Step 6] Delegation to Generation Builder                                           │
│    GenerationBuilder.buildNextGeneration({                                           │
│      population, fitnessSnapshot, targetGeneration: g+1, generationSeed, ...         │
│    })                                                                                │
│                                                                                      │
│  [Step 7] Return Generation Runner Result                                            │
│    - ADVANCED: { population(g+1), buildResult, fitnessSnapshot(g), manifest }        │
│    - REEVALUATION_REQUIRED: { fitnessSnapshot(g), reason, manifest }                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ GenerationRunnerResult
                                           ▼
========================================================================================
                                 Evolution Loop (将来スコープ)
                 次世代 seed の導出、チェックポイント保存、停止条件判定
========================================================================================
```

---

## 5. Generation Runner Boundary (責務境界)

### 5.1 One Generation Only 原則
Generation Runner は、**「世代 $g$ から世代 $g+1$ への遷移をちょうど1回実行すること」** にのみ責務を負う。
- 内部に `while (generation < max)` や再帰呼び出しを持たない。
- 成功（`ADVANCED`）時でも次世代の Runner を自動呼び出しせず、直ちに呼び出し元へ結果を返却して終了する。
- 再評価要求（`REEVALUATION_REQUIRED`）時でも、勝手に追加の対戦を実行したり、シードを変更して再試行したりしない（Hidden Re-evaluation の厳禁）。

### 5.2 処理ステップの責務分担
| ステップ | 担当コンポーネント | 責務内容 |
|---|---|---|
| 1. 入力検証 | Generation Runner | 母集団サイズ（$N \ge 2$）、世代番号整合性、シード値正当性の検証 |
| 2. 対戦計画 | Generation Runner | Canonical Double Round Robin スケジュール生成、Match Identity 付与 |
| 3. 試合実行 | SimulationRunner / GameSession | 本番シミュレーション経路を通じた対戦実行、合法的観測と Argmax 選択 |
| 4. 戦績集計 | Generation Runner | 全試合結果から各個体の勝敗・引き分け・未決着・失敗数の決定論的集約 |
| 5. 適応度評価 | FitnessEvaluator | Outcome-First 契約に基づく MPA 算出、VALID / INSUFFICIENT / INVALID 判定 |
| 6. 次世代構築 | GenerationBuilder | 親選択、エリート選出、交叉・変異、次世代スナップショット（$g+1$）アセンブリ |

---

## 6. Input Types & Parameter Contracts (入力型契約)

```typescript
/**
 * Generation Runner の実行パラメータ
 */
export interface RunGenerationParams {
  /** 評価対象の現世代母集団スナップショット (N >= 2) */
  readonly population: PopulationSnapshot;

  /** 当該世代の自己対戦評価・親選択・子個体生成を統括する基本乱数シード (有限整数) */
  readonly generationSeed: number;

  /** 同一世代の比較可能性を保証する評価コンテキスト情報 */
  readonly context: ComparableEvaluationContext;

  /**
   * 各試合固有の fresh な GameSession を生成するファクトリ関数
   * (OfficialRegulationMatchFactory 等の本番ファクトリを利用)
   */
  readonly sessionFactory: (context: BatchMatchContext) => GameSession;

  /** 実行オプション設定 (未指定時はデフォルト値適用) */
  readonly config?: Partial<GenerationRunnerConfig>;
}
```

---

## 7. Config (設定契約)

```typescript
/**
 * Generation Runner 評価・実行設定
 */
export interface GenerationRunnerConfig {
  /**
   * 各 unordered pair に対する side-swapped pair (Leg 0 + Leg 1) の反復実行回数
   * 有限正の整数 >= 1 (デフォルト: 1)
   */
  readonly pairRepetitions: number;

  /** 1試合あたりの最大意思決定手数 (有限正の整数 >= 1, デフォルト: 500) */
  readonly maxDecisionsPerMatch: number;

  /** Outcome-First Fitness 評価設定 */
  readonly fitnessConfig: FitnessEvaluationConfig;

  /** 次世代母集団アセンブリ設定 (Generation Builder 用) */
  readonly builderConfig?: Partial<GenerationBuilderConfig>;

  /**
   * 実行並列度 (有限正の整数 >= 1, デフォルト: 1)
   * ※ Concurrency は execution concern であり、論理結果に一切影響を与えてはならない
   */
  readonly concurrency: number;
}

/**
 * デフォルト設定値 (Provisional Engineering Defaults)
 */
export const DEFAULT_GENERATION_RUNNER_CONFIG: GenerationRunnerConfig = Object.freeze({
  pairRepetitions: 1,
  maxDecisionsPerMatch: 500,
  fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
  concurrency: 1,
});
```

---

## 8. Canonical Double Round Robin Schedule (対戦スケジュール)

### 8.1 採用理由 (Why Double Round Robin)
Generation Runner V1 では、対戦スケジュール方式として **Double Round Robin（二重総当たり戦）** を固定採用する。理由は以下の通りである:
1. **完全な対戦相手対称性**: すべての個体が母集団内の全く同一の相手集合と戦うため、対戦相手の引き（opponent sampling bias）による運の要素を完全に排除できる。
2. **座席バイアスの相殺**: BlackPoker の先攻・後攻差を、全ペアでの side swap（$p_1$ と $p_2$ の入替）により数学的に完全に中和する。
3. **適応度の高精度比較**: Tournament Selection が要求する「個体間の客観的な実力差」を最も偏りなく評価できる。
4. **単純性と決定論性**: ランダムサンプリングやスイス式のような動的マッチングを排し、事前計画可能で再現性の高いスケジュール契約を実現する。

### 8.2 試合数算定公式 (Match Count Formula)
母集団個体数を $N$（$N \ge 2$）、ペア反復数を $R$（`pairRepetitions` $\ge 1$）とする。

- **非順序ペア総数 (Total Unordered Pairs)**:
  $$\text{totalPairs} = \frac{N(N - 1)}{2}$$
- **1ペア・1反復あたりの試合数**:
  $$2 \quad (\text{Leg 0: } A=p_1, B=p_2 \quad / \quad \text{Leg 1: } B=p_1, A=p_2)$$
- **世代全体の総試合数 (Total Scheduled Matches)**:
  $$\text{totalMatches} = \frac{N(N - 1)}{2} \times 2 \times R = N(N - 1)R$$
- **1個体あたりの予定試合数 (Per-Genome Scheduled Matches)**:
  $$\text{perGenomeScheduledMatches} = 2(N - 1)R$$
- **1個体あたりの座席別予定試合数**:
  $$\text{matchesAsP1} = (N - 1)R, \quad \text{matchesAsP2} = (N - 1)R$$

#### 代表的な規模での試算
| 母集団規模 $N$ | 反復数 $R$ | 総試合数 $\text{totalMatches}$ | 個体あたり試合数 $\text{perGenome}$ | $p_1$ / $p_2$ 試合数 |
|---|---|---|---|---|
| $N = 2$ | $R = 1$ | 2 | 2 | 1 / 1 |
| $N = 4$ | $R = 1$ | 12 | 6 | 3 / 3 |
| $N = 4$ | $R = 2$ | 24 | 12 | 6 / 6 |
| $N = 10$ | $R = 1$ | 90 | 18 | 9 / 9 |
| $N = 100$ | $R = 1$ | **9,900** | **198** | **99 / 99** |
| $N = 100$ | $R = 2$ | 19,800 | 396 | 198 / 198 |

### 8.3 規模に関する注意 (Do Not Hardcode 100)
Generation Builder のデフォルト個体数は 100 であるが、Generation Runner は $N = 100$ をハードコードしてはならない。任意の $N \ge 2$ について同一の計算式と契約が成立しなければならない。また、恣意的な上限（例: $N \le 1000$）は課さない。

### 8.4 適応度証拠の先行検証 (Fitness Evidence Preflight)
`FitnessEvaluationConfig` の `minimumCompletedMatches` に対し、予定試合数が不足している場合（例: $N=2, R=1 \implies \text{perGenome}=2$ であるのに対し、$\text{minimumCompletedMatches} = 10$ の場合）、全試合が正常終了しても全個体が確実に `INSUFFICIENT_EVIDENCE` となり次世代へ進めない。

したがって、Generation Runner は実行開始前の Preflight 検証において:
$$\text{perGenomeScheduledMatches} < \text{fitnessConfig.minimumCompletedMatches}$$
である場合、対戦を1試合も実行することなく **`GenerationRunnerConfigurationError` により Fail-Fast で即時停止** しなければならない。Runner が勝手に `pairRepetitions` を引き上げて帳尻を合わせてはならない。

---

## 9. Canonical Ordering & Pair Construction (カノニカル順序付け)

### 9.1 Population Canonical Ordering
入力された `population.entries` の順序に依存しない決定論性を保証するため、スケジュール構築前に個体配列のシャローコピーを作成し、`genomeId` の昇順（UTF-16 code unit order）でソートする。
- 元の `population.entries` 配列を変更（破壊）してはならない。
- これにより、入力配列の順序がシャッフルされても、生成されるスケジュールおよび試合順序は 100% 不変となる。

### 9.2 Canonical Pair Ordering
ソート済み個体系列 $G_0 < G_1 < \dots < G_{N-1}$ に対し、以下の辞書順二重ループにより unordered pair を生成する:

```text
pairIndex = 0
for i = 0 .. N - 2:
  for j = i + 1 .. N - 1:
    // pairIndex: 0 .. (N*(N-1)/2 - 1)
    pairIndex++
```

### 9.3 Leg Ordering & Match Index
各 unordered pair $(G_i, G_j)$ に対し、反復インデックス $r \in [0, R-1]$ に基づいて次の2つの Leg を連続して配置する:
- **Leg 0**: $p_1 = G_i, \quad p_2 = G_j$
- **Leg 1**: $p_1 = G_j, \quad p_2 = G_i$

全体の `matchIndex` は、このカノニカル順序に従って $0$ から $\text{totalMatches} - 1$ まで連続した非負整数として一意に割り振られる。

---

## 10. Seed Derivation & Evaluation Stream Contract (シード導出契約)

### 10.1 外部入力シード境界
Generation Runner は、入力として外部から与えられた `generationSeed`（有限整数, 0 も合法）のみを使用する。
Runner 自身が `Date.now()`、`Math.random()`、UUID 等からシードを自律生成することは厳禁とする。

### 10.2 Evaluation Stream Key 契約
Generation Builder や Genetic Operators の既存 Stream Key との衝突を完全に防止するため、Generation Runner 専用の Evaluation Stream Key を定義する。

```typescript
/**
 * Generation Runner 専用 Canonical Evaluation Stream Key 命名規則
 */
export function getEvaluationPairStreamKey(pairIndex: number, repetitionIndex: number): string {
  return `evolution-evaluation-pair-v1-${pairIndex}-${repetitionIndex}`;
}
```

- 既存の `evolution-selection-v1`、`evolution-offspring-v1-*`、`evolution-crossover-v1`、`evolution-mutation-v1`、`evolution-self-mating-retry-v1-*` には一切変更を加えない。

### 10.3 Pair Seed の導出
各 unordered pair および反復ごとに、純粋関数 `deriveSeed`（32-bit FNV-1a）を用いて一意の `pairSeed` を導出する:
$$\text{pairSeed} = \text{deriveSeed}(\text{generationSeed}, \text{getEvaluationPairStreamKey}(\text{pairIndex}, \text{repetitionIndex}))$$

### 10.4 Mirrored Legs と Seed の安全性監査 (Mandatory Seed Semantics Audit)
V1 の基本原則として、同一 pair / repetition の両 Leg（Leg 0 と Leg 1）で **同一の `pairSeed` を `matchSeed` として共用** する（Mirrored Leg Seed）。

#### 本番ソースコードに基づくシード挙動監査結果
`OfficialRegulationMatchSetup.setupDraftZones` の実装を監査した結果:
```typescript
const p1Rng = new SeededRandom(deriveSeed(matchSeed, "p1-deck"));
const p2Rng = new SeededRandom(deriveSeed(matchSeed, "p2-deck"));
const p1Shuffled = shuffleCards(p1RemainingDeck, p1Rng);
const p2Shuffled = shuffleCards(p2RemainingDeck, p2Rng);
```
- **Leg 0 ($A=p_1, B=p_2$)**:
  - 個体 $A$ のデッキは `deriveSeed(pairSeed, "p1-deck")` でシャッフルされる。
  - 個体 $B$ のデッキは `deriveSeed(pairSeed, "p2-deck")` でシャッフルされる。
- **Leg 1 ($B=p_1, A=p_2$)**:
  - 個体 $B$ のデッキは `deriveSeed(pairSeed, "p1-deck")` でシャッフルされる。
  - 個体 $A$ のデッキは `deriveSeed(pairSeed, "p2-deck")` でシャッフルされる。

#### 監査の結論
1. **完全な鏡像配牌 (Duplicate Deal)**:
   個体 $B$ が Leg 1 で手にする山札のカード順は、個体 $A$ が Leg 0 で手にした山札のカード順と完全に一致する。同様に、個体 $A$ が Leg 1 で手にする山札は、個体 $B$ が Leg 0 で手にした山札と完全に一致する。これはコントラクトブリッジにおける「デュプリケート競技」と全く同一の完全対称・公平条件を実現する。
2. **座席・先攻決定の対称性**:
   `executeFirstPlayerDetermination` においても各座席の山札トップが比較されるため、Leg 0 で $p_1$ が先攻を獲得した場合、Leg 1 でも $p_1$（座席を交代した相手個体）が先攻を獲得する。両者ともに先攻と後攻の双方を全く同一の配牌条件下でプレイする。
3. **ゲーム内ランダム性の完全分離**:
   対戦中に発生するライフシャッフル等は `deriveRuntimeShuffleSeed(matchSeed, counter)`（ストリームプレフィックス: `runtime-shuffle-${counter}`）により独立導出されるため、デッキシャッフルと干渉しない。
4. **既存実績との整合**:
   本契約は、本番で安定稼働している `PolicyExperimentRunner`（Leg 1 と Leg 2 で同一 `baseSeed` を共用）の実績設計と 100% 整合しており、安全であることが実証された。

---

## 11. Match Execution Path (本番シミュレーション経路)

### 11.1 本番経路の直接再利用
Generation Runner は、自己対戦専用の独自ルールエンジンや簡易戦闘ロジックを新設してはならない。必ず本番 Simulator の正規実行パイプラインを利用する:

```text
DecisionDNA (p1) ──> GenomePolicy ──┐
                                     ├──> SimulationRunner.run(session, { p1, p2 }, options)
DecisionDNA (p2) ──> GenomePolicy ──┘                     │
                                                          ▼
                                                  SimulationResult
```

### 11.2 インスタンス完全隔離 (Freshness Contract)
各試合の実行にあたり:
- `sessionFactory(ctx)` により、完全に独立した fresh な `GameSession` インスタンスを生成する。
- 各プレイヤーの `GenomePolicy` は、当該試合の `p1.dna` および `p2.dna` から新しくインスタンス化する（内部でディープクローンされ状態汚染を遮断）。

---

## 12. Outcome Classification (勝敗判定とステータス分類)

`SimulationRunner.run()` の返却値（`SimulationResult`）および `BatchMatchResult` に従い、試合結果を厳密に 3 値分類する:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Match Outcome 3値分類                           │
├─────────────────┬──────────────────────────────────────────────────────┤
│ 1. COMPLETED    │ 正常に勝敗が決着、またはルール上の正規引き分け       │
│                 │ (simResult.completed === true)                       │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 2. INCOMPLETE   │ 最大判断手数 (maxDecisionsPerMatch) 到達等による未決着│
│                 │ (simResult.completed === false) ※ DRAW とは厳格に区別│
├─────────────────┼──────────────────────────────────────────────────────┤
│ 3. FAILED       │ セッション初期化、ポリシー初期化、実行中の例外発生   │
│                 │ (simResult 未到達、または捕捉された例外レコードあり) │
└─────────────────┴──────────────────────────────────────────────────────┘
```

### 12.1 勝敗の帰属ルール
1. **COMPLETED で $p_1$ 勝利 (`winner === "p1"`)**:
   - $p_1$ ゲノム: `wins += 1`
   - $p_2$ ゲノム: `losses += 1`
2. **COMPLETED で $p_2$ 勝利 (`winner === "p2"`)**:
   - $p_1$ ゲノム: `losses += 1`
   - $p_2$ ゲノム: `wins += 1`
3. **COMPLETED で引き分け (`winner === undefined`)**:
   - 両ゲノム: `draws += 1`
4. **INCOMPLETE (`completed === false`)**:
   - **引き分け（Draw）としては絶対に計上しない**。
   - `completedMatches` には含めず、両ゲノムの `incompleteMatches += 1` として記録。
5. **FAILED**:
   - 両ゲノムの `failedMatches += 1` として記録。

### 12.2 インフラ例外と試合レベル FAILED の峻別
- **試合レベル FAILED**: ルールエンジンや個別ポリシーの予期せぬ例外。結果レコードに記録され、Fitness 評価層で当該個体の失格（`status: "INVALID"`）として決定論的に処理される。
- **インフラ例外 (Infrastructure Exception)**: Out of Memory、プロセス中断、外部 I/O 障害等のシステム崩壊。これらを試合レベルの FAILED として握りつぶして続行することは厳禁であり、Runner 全体を **Fail-Closed で直ちに throw 中断** させる。

---

## 13. Per-Genome Outcome Aggregation (個体別戦績集約)

全対戦完了後、各個体について集約された戦績は、既存の `PolicyParticipantOutcomeSummary` 型へ正確に変換される。

```typescript
export interface PolicyParticipantOutcomeSummary {
  readonly participantId: string; // genomeId
  readonly scheduledMatches: number; // 2 * (N - 1) * R
  readonly completedMatches: number; // wins + losses + draws
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly incompleteMatches: number;
  readonly failedMatches: number;
  readonly winRateOnCompleted: number; // completedMatches > 0 ? wins / completedMatches : 0
  readonly asP1: PolicyParticipantSeatSummary;
  readonly asP2: PolicyParticipantSeatSummary;
}
```

### 保存則ゲート (Conservation Gates)
集約結果は、次の等式を 1 件の例外もなく満たさなければならない:
1. `wins + losses + draws === completedMatches`
2. `completedMatches + incompleteMatches + failedMatches === scheduledMatches`
3. `asP1.scheduledMatches === (N - 1) * R`
4. `asP2.scheduledMatches === (N - 1) * R`

---

## 14. Fitness Evaluation (適応度評価委譲)

Generation Runner 自身は独自の適応度算出ロジックを持たず、集約した `PolicyParticipantOutcomeSummary` を Formal Accepted 済みの **`FitnessEvaluator.evaluateParticipant()`** へそのまま渡して評価を委譲する。

### 14.1 厳格な隔離原則 (Forbidden Fitness Inputs)
以下の項目を Generation Runner から適応度計算へ混入させて加点・減点・補正を行うことを厳重に禁止する:
- 残りライフ（Remaining Life）、与ダメージ・被ダメージ
- ターン数（Turn Count）
- 試合所要時間（Elapsed Time / Latency）、CPU時間、メモリ使用量
- 意思決定手数（Total Decisions）
- シミュレーションスループット（Matches per Second）

### 14.2 3値評価ステータスの受容
`FitnessEvaluator` の返却値（`FitnessEvaluationResult`）に従い、各個体は次のいずれかに決定される:
- **`VALID`**: $\text{failedMatches} = 0 \land \text{completedMatches} \ge \text{minCompleted} \land \text{completionRate} \ge \text{minRate}$。Authoritative な適応度スコア（$0.0 \le \text{fitnessScore} \le 1.0$）を持つ。
- **`INSUFFICIENT_EVIDENCE`**: 対戦完了数または完了率が不足。`fitnessScore = null`。
- **`INVALID`**: $\text{failedMatches} > 0$。即座に失格・除外。`fitnessScore = null`。

### 14.3 Fitness Evaluation Snapshot の構築
全個体の評価結果から `FitnessEvaluationSnapshot(g)` を構築する:
- `generation === population.generation` の厳密一致。
- `entries` は `genomeId` 昇順でソートされ、入力母集団と完全な 1:1 対応を保持する。

---

## 15. Comparable Context (比較可能評価コンテキスト契約)

同一世代のすべての対戦および適応度評価は、同一の比較可能コンテキスト（`ComparableEvaluationContext`）下で実行されなければならない。

```typescript
export interface ComparableEvaluationContext {
  readonly environmentRef: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly fitnessConfig: FitnessEvaluationConfig;
  readonly generation: number;
  readonly evaluationScheduleId: string;     // "double-round-robin-v1"
  readonly seedScheduleIdentity: string;     // "evolution-evaluation-pair-v1"
}
```

- **`evaluationScheduleId`**: Double Round Robin 契約を示す決定論的 Logical ID（`"double-round-robin-v1"`）。日付・時刻・UUID・ファイルパスを含んではならない。
- **`seedScheduleIdentity`**: シード派生契約を示す決定論的 Logical ID（`"evolution-evaluation-pair-v1"`）。

---

## 16. Generation Builder Delegation (次世代構築への委譲)

適応度評価スナップショット（`FitnessEvaluationSnapshot(g)`）が完成した後、次世代母集団の生成を Formal Accepted 済みの **`GenerationBuilder.buildNextGeneration()`** へ委譲する。

```typescript
const buildResult = GenerationBuilder.buildNextGeneration({
  population: params.population,
  fitnessSnapshot,
  targetGeneration: params.population.generation + 1,
  generationSeed: params.generationSeed, // 同一の generationSeed を透過的に渡す
  config: params.config?.builderConfig,
  expectedContext: params.context,
});
```

### 16.1 シードの再派生を行わない原則 (Do Not Derive New Builder Seed)
Generation Runner は、Generation Builder 用のシード（例: `builderSeed = deriveSeed(...)`）を新設してはならない。
入力された `generationSeed` をそのまま Builder へ渡す。Generation Builder は内部で `evolution-selection-v1` や `evolution-offspring-v1-*` を用いてストリームを独立派生するため、Evaluation Stream との名前空間衝突は発生しない。

### 16.2 Generation Seed の所有権境界
Generation Runner は `generationSeed(g)` を消費する側であり、次世代用シード `generationSeed(g+1)` を決定する権限を持たない。次世代シードの導出は上位の Evolution Loop の責務である。

---

## 17. Result & Status Model (実行結果モデル)

Generation Runner の返却値は、アトミックな状態遷移を表現する Discriminated Union とする:

```typescript
/**
 * 成功裏に次世代への遷移が完了した結果
 */
export interface GenerationRunnerAdvancedResult {
  readonly status: "ADVANCED";
  /** 世代 g+1 の未評価母集団スナップショット */
  readonly nextPopulation: PopulationSnapshot;
  /** 世代 g+1 構築の詳細メタデータ (エリートID, 子個体家系情報等) */
  readonly buildResult: GenerationBuildResult;
  /** 世代 g の適応度評価スナップショット */
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  /** 評価実行マニフェスト (再現用メタデータ) */
  readonly manifest: GenerationEvaluationManifest;
}

/**
 * 適応度評価は完了したが、VALID 個体不足等により次世代へ進めない結果
 */
export interface GenerationRunnerReevaluationRequiredResult {
  readonly status: "REEVALUATION_REQUIRED";
  /** 診断・分析用に保持される世代 g の適応度評価スナップショット */
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  /** 再評価が必要となった具体的理由 */
  readonly reason: string;
  /** 選択適格性評価の詳細 */
  readonly readiness: SelectionReadiness;
  /** 評価実行マニフェスト */
  readonly manifest: GenerationEvaluationManifest;
  /** 次世代母集団は存在しない (undefined / null) */
  readonly nextPopulation?: undefined;
  readonly buildResult?: undefined;
}

/**
 * Generation Runner の実行結果型
 */
export type GenerationRunnerResult =
  | GenerationRunnerAdvancedResult
  | GenerationRunnerReevaluationRequiredResult;
```

### 17.1 不完全な次世代母集団の完全禁止
- `REEVALUATION_REQUIRED` の場合、空の母集団（Empty Population）や部分的な母集団（Partial Population）、あるいはフォールバック母集団を返却してはならない。次世代母集団は厳格に `undefined` とする。
- これにより、上位の Evolution Loop は診断用スナップショットを検査した上で、安全に停止するか、対戦パラメータを見直して再評価するかを決定論的に判断できる。

---

## 18. Error Taxonomy (エラー体系)

Generation Runner における例外は、以下の 3 階層に厳格に分離する:

```text
Error
 └─ GenerationRunnerError (基底抽象型)
      ├─ GenerationRunnerConfigurationError (開始前設定不備)
      ├─ GenerationRunnerIntegrityError     (データ構造・保存則破壊)
      └─ GenerationRunnerExecutionError     (実行時致命的障害)
```

1. **`GenerationRunnerConfigurationError` (開始前 Fail-Fast)**:
   - $N < 2$ の母集団指定。
   - `pairRepetitions < 1`、非有限数、小数指定。
   - `generationSeed` の非有限数指定。
   - 予定試合数不足（$\text{perGenomeScheduledMatches} < \text{minimumCompletedMatches}$）。
   - `sessionFactory` が関数でない。
2. **`GenerationRunnerIntegrityError` (データ整合性違反)**:
   - 母集団内の重複 `genomeId`。
   - 世代番号の不一致（`population.generation !== context.generation`）。
   - 試合結果の欠損、重複 `matchIndex`。
   - 保存則違反（総試合数不一致、座席数不一致）。
3. **`GenerationRunnerExecutionError` (予期せぬ実行障害)**:
   - システムインフラ例外（OOM、致命的内部エラー）。
   - なお、`REEVALUATION_REQUIRED` は例外ではなく `status: "REEVALUATION_REQUIRED"` の論理結果として返却される。

---

## 19. Determinism (決定論性保証境界)

### 19.1 Supported Deterministic Runtime 境界
先行仕様（`ai-genetic-operators-design-v1.md` / `ai-generation-builder-design-v1.md`）と完全整合させ、無条件な万能保証を排除し、以下の定義域において **Bit-exact / Deep Equal 完全再現性** を保証する:

- 同一のサポート対象ランタイム（Node.js LTS 等）
- 同一の Generation Runner 実装バージョン
- 同一の SimulationRunner / GameSession 実装バージョン
- 同一の入力 `PopulationSnapshot(g)`
- 同一の `generationSeed`
- 同一の実行設定（`GenerationRunnerConfig`）
- 同一のルール環境・レギュレーション
- 同一の対戦スケジュール契約（`double-round-robin-v1`）
- 同一のシード派生契約（`evolution-evaluation-pair-v1`）

### 19.2 Cross-Platform Conformance Target
異なる OS（Linux, Windows, macOS）や CPU アーキテクチャ（x64, arm64）間は、テストベクトルにより実測検証される適合目標（Conformance Target）とする。

### 19.3 入力配列順序非依存性 (Input Order Independence)
同一の個体集合において、`population.entries` 配列の並び順のみをランダムにシャッフルして渡しても、Canonical Ordering により生成されるスケジュール、試合シード系列、適応度スナップショット、および次世代母集団は **完全一致（Deep Equal）** する。

### 19.4 実行完了順序非依存性 (Completion Order Independence)
将来的に非同期実行や並列実行（Concurrency > 1）が導入された場合でも、Promise の完了順序やコールバック順序を戦績集計に反映させてはならない。必ず `matchIndex` または Canonical `genomeId` で再整列してから集計し、実行順序による非決定性を排除する。

---

## 20. Concurrency (並列実行の扱い)

- **Execution Concern vs Fitness Concern**:
  並列度（`concurrency`）は計算効率に関する関心事（Execution Concern）であり、適応度評価や世代遷移の結果（Fitness Concern）に一切影響を与えてはならない。
- $\text{concurrency} = 1$ で順次実行した場合と、$\text{concurrency} > 1$ で並行実行した場合の論理結果（`GenerationRunnerResult`）は、**完全一致（Deep Equal）** でなければならない。

---

## 21. Runtime Telemetry Separation (実行時テレメトリの完全隔離)

Generation Runner は、各試合の所要時間やバッチ全体の実行時メトリクスを観測・集計できる。ただし、次の原則を厳守する:

1. **結果モデルへの独立同居**:
   テレメトリデータは `GenerationEvaluationManifest.runtimeTelemetry` 等の専用フィールドに分離して格納する。
2. **適応度・選択へのフィードバック禁止 (No Feedback Loop)**:
   - 処理の速い個体を高評価してはならない。
   - 処理の遅い個体を低評価してはならない。
   - 意思決定手数やスループットを親選択・エリート選出・対戦相手決定の条件としてはならない。

---

## 22. Complexity (計算量とスケーラビリティ)

### 22.1 計算量
- **試合数計算量**:
  $$\mathcal{O}(N^2 R)$$
  $N=100, R=1$ で 9,900 試合、$N=1,000, R=1$ で約 100 万試合となる。
- **時間計算量**:
  $$\mathcal{O}(N^2 R \times \text{AverageDecisionsPerMatch})$$

### 22.2 メモリ計算量と V1 方式決定 (Streaming vs Materialization)
- **V1 決定**:
  $N=100, R=1$ の場合、対戦記述子（`GenerationEvaluationMatch`）は 9,900 件であり、全件をメモリ上に配列として実体化（Materialize）しても数メガバイト未満に収まる。
  したがって、V1 では実装の明瞭性と検証容易性を最優先し、**インメモリでの一括スケジュール実体化（In-Memory Materialization）を基本採用** する。
- **将来スケーラビリティ (Future Scalability)**:
  $N \gg 1000$ 等の超大規模母集団に対しては、メモリ保護のための決定論的イテレータ（Deterministic Generator / Streaming Iterator）およびチャンク実行への移行を将来の課題として整理する。

---

## 23. Canonical 60-Test Plan (検証テスト計画)

将来のプロダクション実装（`BP-SIM-AI-GENERATION-RUNNER-V1`）において検証すべき全 60 項目の Canonical Test Plan を策定する。

### Group A: Config Validation (Tests 1–9)
1. `N >= 2` の有効母集団を受容すること。
2. `pairRepetitions` のデフォルト値が 1 であること。
3. `pairRepetitions = 0` を `GenerationRunnerConfigurationError` で reject すること。
4. `pairRepetitions < 0`（負数）を reject すること。
5. `pairRepetitions` に小数（例: 1.5）を指定した場合 reject すること。
6. `pairRepetitions` に `NaN` または `Infinity` を指定した場合 reject すること。
7. `generationSeed = 0` が合法なシードとして正しく受容されること。
8. `generationSeed` に非有限数（`NaN` / `Infinity`）を指定した場合 reject すること。
9. $\text{perGenomeScheduledMatches} < \text{minimumCompletedMatches}$ の設定不備を対戦実行前に Fail-Fast で reject すること。

### Group B: Schedule Construction (Tests 10–18)
10. $N=2, R=1$ において総試合数が正確に 2 試合であること。
11. $N=3, R=1$ において総試合数が正確に 6 試合であること。
12. $N=4, R=2$ において総試合数が正確に 24 試合であること。
13. 任意の $N, R$ で総試合数が $N(N-1)R$ と厳密に一致すること。
14. 同一個体同士の対戦（自己対戦: $G_i \text{ vs } G_i$）が 1 試合も存在しないこと。
15. 各 unordered pair において、反復ごとに必ず Leg 0 と Leg 1 の 2 試合が存在すること。
16. 全個体について $p_1$ 回数と $p_2$ 回数が同数（$(N-1)R$）であり完全に均衡していること。
17. スケジュールの `matchIndex` が 0 から連番で欠番なく連続していること。
18. 入力母集団の `entries` 配列の順序を変更しても、生成されるスケジュールが完全に同一であること。

### Group C: Seed Derivation (Tests 19–24)
19. 同一入力に対し、導出される全 `pairSeed` 系列が完全に同一であること。
20. 母集団の入力順序を変更しても、全試合の `pairSeed` 系列が不変であること。
21. 異なる `generationSeed` を与えた場合、固定 fixture においてシード系列が変化し得ること（Negative Control）。
22. 異なるシードに対する過剰な万能相違保証（Universal Must-Differ）を課さないこと。
23. 各 pair / repetition ごとに `pairSeed` が独立して分離導出されること。
24. Generation Runner のシード派生が、既存の Generation Builder / Genetic Operators の Stream Key 契約に一切影響を与えないこと。

### Group D: Outcome Aggregation (Tests 25–32)
25. COMPLETED 試合における $p_1$ 勝利が、$p_1$ の win および $p_2$ の loss へ正確に集計されること。
26. COMPLETED 試合における $p_2$ 勝利が、$p_2$ の win および $p_1$ の loss へ正確に集計されること。
27. COMPLETED 試合における引き分けが、双方の draw へ正確に集計されること。
28. INCOMPLETE 試合が draw として扱われず、双方の `incompleteMatches` へ厳密に集計されること。
29. FAILED 試合が双方の `failedMatches` へ厳密に集計されること。
30. スケジュール計画数に対して実行結果が 1 件でも欠損している場合、`GenerationRunnerIntegrityError` で停止すること。
31. 重複した `matchIndex` の結果が存在する場合、`GenerationRunnerIntegrityError` で停止すること。
32. 試合結果の参加個体 ID と計画個体 ID が不一致の場合、`GenerationRunnerIntegrityError` で停止すること。

### Group E: Fitness Evaluation (Tests 33–39)
33. 適応度評価が `FitnessEvaluator.evaluateParticipant()` へ正しく委譲されること。
34. 残りライフ（Remaining Life）が適応度計算に一切使用されていないこと。
35. ターン数（Turn Count）が適応度計算に一切使用されていないこと。
36. 実行所要時間（Duration / Latency）が適応度計算に一切使用されていないこと。
37. 全敗（wins = 0, draws = 0）の個体でも `VALID`（スコア 0.0）として適格保存されること。
38. FAILED 試合が 1 件でも存在する個体が即座に `INVALID`（適応度 null）となること。
39. 完了試合数不足の個体が `INSUFFICIENT_EVIDENCE`（適応度 null）となること。

### Group F: Generation Transition (Tests 40–46)
40. 生成された `FitnessEvaluationSnapshot` の世代番号が $g$ と厳密に一致すること。
41. 母集団エントリと適応度エントリが完全な 1:1 対応を成していること。
42. `GenerationBuilder` が目標世代 $g+1$ で正しく呼び出されること。
43. `GenerationBuilder` へ同一の `generationSeed` が透過的に渡されること。
44. 正常遷移時、ステータス `ADVANCED` と世代 $g+1$ の母集団スナップショットが返却されること。
45. `GenerationBuilderExecutionError`（`REEVALUATION_REQUIRED`）発生時、ステータス `REEVALUATION_REQUIRED` が返り、次世代母集団が `undefined` であること。
46. `REEVALUATION_REQUIRED` 時に Runner が勝手に再試行（Hidden Retry）を行わないこと。

### Group G: Determinism (Tests 47–52)
47. 同一ランタイム・同一バージョン・同一入力・同一設定・同一シードで 2 回実行した結果が Bit-exact / Deep Equal に完全一致すること。
48. 入力母集団の配列シャッフルに対し、最終結果が完全一致すること。
49. 試合の実行完了順序が変動しても、最終集約結果が完全一致すること。
50. Concurrency 1 と Concurrency 2 の実行結果が意味論的に完全一致すること（並列化サポート時）。
51. 出力データ構造内に `Date.now()` 等の動的タイムスタンプが一切含まれないこと。
52. 出力データ構造内に UUID や外部ランダム値が一切含まれないこと。

### Group H: Boundary & Isolation (Tests 53–60)
53. Generation Runner が 1 世代のみを実行し、自律的に次世代ループを開始しないこと。
54. 内部に Evolution Loop（複数世代ループ）のコードが存在しないこと。
55. 過去世代や Hall of Fame との対戦が存在しないこと。
56. ファイルシステムや DB への永続化処理を行わないこと。
57. 収集された Runtime Telemetry が適応度や選択結果に 1 ビットも影響を与えていないこと。
58. モックやダミーではない本番のシミュレーション実行経路（`SimulationRunner` / `GameSession`）が使用されていること。
59. Generation Runner が個別のアクション名（`action.attack` 等）を直接解釈していないこと。
60. 入力された現世代の `PopulationSnapshot(g)` が一切破壊・変更されていないこと。

---

## 24. Open Design Questions & Resolutions (設計課題と決定事項)

設計過程において検討された主要論点と、その正式決定内容は以下の通りである:

### [Issue A] Mirrored Legs において同一 pairSeed を共用して安全か？
- **決定**: **安全であり、正式採用する**。
- **根拠**: 本番コードの監査により、同一シード下で座席を入れ替えた場合、両者が全く同一のデッキ配牌を相手の立場からプレイする「鏡像配牌（Duplicate Deal）」となり、先攻・後攻バイアスを最も美しく相殺できることが確認された。また、`PolicyExperimentRunner` でも同一方式が本番採用されている。

### [Issue B] スケジュールを全件 Materialize するか、Iterator にするか？
- **決定**: **V1 では In-Memory Materialization を正式採用する**。
- **根拠**: V1 の標準規模（$N=100, R=1$）において 9,900 件の記述子配列は数メガバイト程度であり、メモリ圧迫のリスクが極めて低い。配列として実体化する方がスライシング、シャッフル検証、並列分散、テストが圧倒的にシンプルとなる。

### [Issue C] 既存の SimulationRunner で p1/p2 別 GenomePolicy をどう渡すか？
- **決定**: **`policies: { p1: policyA, p2: policyB }` の標準辞書で渡す**。
- **根拠**: `SimulationRunner.run(session, policies)` は第2引数として `Record<string, DecisionPolicy>` を受け取る仕様であり、`policies["p1"]` と `policies["p2"]` に各参加個体の `GenomePolicy` を渡すことで追加改修なしに完全対応できる。

### [Issue D] FAILED / INCOMPLETE の本番ステータスマッピングは？
- **決定**: `simResult.completed ? "COMPLETED" : "INCOMPLETE"`、例外発生時は `"FAILED"` とする。
- **根拠**: `BatchSimulationRunner` の本番マッピングと 100% 一致させ、`INCOMPLETE != DRAW` および `FAILED > 0 => INVALID` の契約を維持する。

### [Issue E] FitnessEvaluator へ渡す正確な入力型は？
- **決定**: **`PolicyParticipantOutcomeSummary`**。
- **根拠**: `FitnessEvaluator.evaluateParticipant(summary)` が要求する標準集約型をそのまま使用し、新しい並行型を作らない。

### [Issue F] REEVALUATION_REQUIRED をどう表現するか（Result か Error か）？
- **決定**: **Discriminated Union の結果型（`status: "REEVALUATION_REQUIRED"`）として表現する**。
- **根拠**: 有効個体数不足は進化アルゴリズム上「起こり得る通常の探索状態」であり、システム例外ではない。例外を throw してプロセスを落とすのではなく、診断用 `FitnessEvaluationSnapshot` を保持した結果オブジェクトを返すことで、上位 Evolution Loop が再評価やリトライ方針を柔軟に決定できるようにする。

---

## 25. Future Scope (将来の展望と分離境界)

本設計の完了後、次の段階として以下の開発が計画される:
1. **BP-SIM-AI-GENERATION-RUNNER-V1**: 本設計書に基づく Generation Runner の TypeScript 実装および Canonical 60-Test のパス。
2. **BP-SIM-AI-EVOLUTION-LOOP-DESIGN-V1**: 複数世代を反復実行する Evolution Loop の設計（シード系列チェーン、収束条件、チェックポイント、ファイル永続化）。
3. **Phase 4.1 (Hall of Fame & Large Scale Evolution)**: 歴代チャンピオン個体の保存、大規模並列対戦、評価。

---

## 26. Interface Reference (型定義一覧)

```typescript
import {
  ComparableEvaluationContext,
  FitnessEvaluationConfig,
  FitnessEvaluationSnapshot,
  PopulationSnapshot,
  SelectionReadiness,
} from "./PopulationSelectionTypes.js";
import {
  GenerationBuilderConfig,
  GenerationBuildResult,
} from "./GenerationBuilderTypes.js";
import { GameSession } from "../session/GameSession.js";
import { BatchMatchContext } from "../simulation/BatchSimulationTypes.js";

export interface GenerationEvaluationMatch {
  readonly matchIndex: number;
  readonly pairIndex: number;
  readonly repetitionIndex: number;
  readonly legIndex: 0 | 1;
  readonly p1GenomeId: string;
  readonly p2GenomeId: string;
  readonly matchSeed: number;
}

export interface GenerationEvaluationManifest {
  readonly generation: number;
  readonly populationSize: number;
  readonly pairRepetitions: number;
  readonly totalMatches: number;
  readonly generationSeed: number;
  readonly evaluationScheduleId: string;
  readonly seedScheduleIdentity: string;
}

export interface GenerationRunnerConfig {
  readonly pairRepetitions: number;
  readonly maxDecisionsPerMatch: number;
  readonly fitnessConfig: FitnessEvaluationConfig;
  readonly builderConfig?: Partial<GenerationBuilderConfig>;
  readonly concurrency: number;
}

export interface RunGenerationParams {
  readonly population: PopulationSnapshot;
  readonly generationSeed: number;
  readonly context: ComparableEvaluationContext;
  readonly sessionFactory: (context: BatchMatchContext) => GameSession;
  readonly config?: Partial<GenerationRunnerConfig>;
}

export interface GenerationRunnerAdvancedResult {
  readonly status: "ADVANCED";
  readonly nextPopulation: PopulationSnapshot;
  readonly buildResult: GenerationBuildResult;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly manifest: GenerationEvaluationManifest;
}

export interface GenerationRunnerReevaluationRequiredResult {
  readonly status: "REEVALUATION_REQUIRED";
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly reason: string;
  readonly readiness: SelectionReadiness;
  readonly manifest: GenerationEvaluationManifest;
  readonly nextPopulation?: undefined;
  readonly buildResult?: undefined;
}

export type GenerationRunnerResult =
  | GenerationRunnerAdvancedResult
  | GenerationRunnerReevaluationRequiredResult;

export class GenerationRunnerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerError";
  }
}

export class GenerationRunnerConfigurationError extends GenerationRunnerError {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerConfigurationError";
  }
}

export class GenerationRunnerIntegrityError extends GenerationRunnerError {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerIntegrityError";
  }
}

export class GenerationRunnerExecutionError extends GenerationRunnerError {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerExecutionError";
  }
}
```
