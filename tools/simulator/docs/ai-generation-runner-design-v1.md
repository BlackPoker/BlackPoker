# BlackPoker Simulator Generation Runner Design V1 (Follow-up R1)
# (Generation g 自己対戦評価・適応度集計・次世代遷移実行境界契約)

作業ID: `BP-SIM-AI-GENERATION-RUNNER-DESIGN-V1-R1`
ステータス: **PROPOSED / DESIGNED (PENDING INDEPENDENT REVIEW)**
対象リポジトリ: `BlackPoker/BlackPoker`  
対象ブランチ: `BlackPoker/issue551-core-flow`  
先行仕様（Prerequisites）:
- `tools/simulator/docs/ai-fitness-design-v1.md` (Formal Accepted, SHA: `c30e4c07061382b0f73f2102dac0b6ece604dbfb`)
- `tools/simulator/src/engine/ai/FitnessEvaluator.ts` (Formal Accepted Implementation, SHA: `774c9a84601bf149b3ba1585a6611b305989749f`)
- `tools/simulator/docs/ai-population-selection-design-v1.md` (Formal Accepted R1, SHA: `5b1d3dc8cc64f6c35af1b970125e9218c4687068`)
- `tools/simulator/src/engine/ai/PopulationSelector.ts` (Formal Accepted Implementation R1, SHA: `a52228ca88964b968f361e9f0693bc75b4a3ce10`)
- `tools/simulator/docs/ai-genetic-operators-design-v1.md` (Formal Accepted R2, SHA: `8206639052944460682a58e5090e18aa3c161a17`)
- `tools/simulator/src/engine/ai/GeneticOperators.ts` (Formal Accepted Implementation R1, SHA: `a349c2f0c606230b7a3523acbaa0be7473c120f7`)
- Runtime Match Telemetry V1-R1 (Formal Accepted Implementation, SHA: `d9fe8377141f0308c9b91ee90f910d3c2aaf0023`)
- `tools/simulator/docs/ai-generation-builder-design-v1.md` (Formal Accepted R4, SHA: `a86c940b974ec7c3675c9debe4d91556fa9ea677`)
- `tools/simulator/src/engine/ai/GenerationBuilder.ts` (Formal Accepted Implementation R3, SHA: `a1634df3bae143dd3401fff85ffb1180c082fcb7`)
- `tools/simulator/src/domain/ai/FitnessEvaluationTypes.ts` (Implemented)
- `tools/simulator/src/domain/ai/PopulationSelectionTypes.ts` (Implemented)
- `tools/simulator/src/domain/ai/GeneticOperatorTypes.ts` (Implemented)
- `tools/simulator/src/domain/ai/GenerationBuilderTypes.ts` (Implemented)
- `tools/simulator/src/domain/simulation/BatchSimulationTypes.ts` (Implemented)
- `tools/simulator/src/engine/simulation/BatchSimulationRunner.ts` (Implemented)
- `tools/simulator/src/engine/simulation/SimulationRunner.ts` (Implemented)
- `tools/simulator/src/engine/ai/GenomePolicy.ts` (Implemented)
- `tools/simulator/src/domain/ai/PolicyExperimentTypes.ts` (Implemented)
- `tools/simulator/src/engine/ai/PolicyExperimentRunner.ts` (Implemented)
- `tools/simulator/src/engine/random/DeterministicShuffle.ts` (`deriveSeed` Implemented)

---

## 1. Purpose (設計目的)

本設計書は、BlackPoker Simulator AI 自己対戦進化（Phase 4.0: Self-Play Evolution）において、先行して Formal Accepted 済みとなった **Fitness Evaluator**、**Population Selection**、**Genetic Operators**、**Runtime Match Telemetry**、および **Generation Builder** を垂直統合し、

$$\text{PopulationSnapshot}(g) \xrightarrow{\text{Self-Play Evaluation}} \text{FitnessEvaluationSnapshot}(g) \xrightarrow{\text{GenerationBuilder}} \text{PopulationSnapshot}(g+1)$$

という **「ちょうど1世代分（One Generation Only）」** の自己対戦評価・適応度集計・次世代遷移の実行境界（Generation Runner Execution Boundary）を定義する。

Generation Runner は、母集団 $N$ 個体の全ペアによる決定論的 **Double Round Robin（二重総当たり戦）** スケジュールを構築・実行し、勝敗結果を `FitnessEvaluator` へ委譲して客観的な適応度スナップショットを生成した上で、`GenerationBuilder` を通じて次世代母集団を安全かつアトミックに導出する。

### R1 Follow-up における確定・厳格化事項
1. **Comparable Evaluation Context の Single Source of Truth 確立 (Finding 1)**:
   - 外部から完成形の `ComparableEvaluationContext` を受け取る方式を完全廃止（`fitnessConfig` の二重 Source of Truth を排除）。
   - 入力パラメータは環境固有の不変情報 `environment: GenerationRunnerEnvironmentContext` のみとし、`fitnessConfig`（Authoritative Resolved Config）、`generation`（`population.generation`）、`evaluationScheduleId`、`seedScheduleIdentity` はすべて Runner 内部で派生・構築する。
   - スケジュール ID に `pairRepetitions` と `maxDecisionsPerMatch` を包含（`double-round-robin-v1:r=${pairRepetitions}:max-decisions=${maxDecisionsPerMatch}`）。
   - シードスケジュール ID に `generationSeed` を包含（`evolution-evaluation-pair-v1:generation-seed=${generationSeed}`）。
2. **Logical Deterministic Result と Runtime Telemetry Sidecar の完全分離 (Finding 2)**:
   - `GenerationRunnerLogicalResult`（決定論的結果）と `GenerationRunnerRuntimeMetrics`（非決定論的実行時メトリクス）を明確に分離。
   - `GenerationEvaluationManifest` から実行時間（wall-clock）やタイムスタンプを完全排除し、純粋な論理メタデータのみを保持。
   - Deep Equal 一致保証のスコープを `GenerationRunnerLogicalResult` に限定。
3. **FAILED 試合の Fail-Closed 境界と誤淘汰防止 (Finding 3)**:
   - 現行 Simulator では例外の原因（Genome起因か、Rule Engineバグか、インフラ障害か）を自動帰属する Failure Attribution 型が存在しない。
   - 1試合でも FAILED を検出した場合、当該個体の適応度へ流して `INVALID` とするのではなく、**Runner 全体を `GenerationRunnerExecutionError` で Fail-Closed 停止** させる。
   - 正常個体の誤淘汰を防止し、FitnessEvaluationSnapshot まで到達した場合は全個体の `failedMatches === 0` を保証。
4. **Readiness Preflight による完全な SelectionReadiness 取得 (Finding 4)**:
   - `GenerationBuilderExecutionError` が `readinessStatus` しか保持しない問題に対処し、Runner 自身が Builder 呼出前に `PopulationSelector.assessReadiness()` を先行実行。
   - Builder の Effective Readiness Gate（$\text{validCount} \ge \text{eliteCount}$）を考慮した `effectiveRequiredCount = max(requiredCount, eliteCount)` を算出し、不足時は Builder を呼び出さずに `status: "REEVALUATION_REQUIRED"` と完全な `SelectionReadiness` を返却。
   - Preflight が READY なのに Builder が例外を返した場合は契約逸脱（Contract Drift）として Fail-Closed。
5. **Prerequisite SHA 訂正および型定義・import の厳格化 (Finding 5)**:
   - 設計ヘッダーの先行仕様コミット SHA を Git 履歴上の実体 SHA へ訂正。
   - `FitnessEvaluationConfig` の import 元を `PopulationSelectionTypes` から `FitnessEvaluationTypes` へ是正。
6. **V1 逐次実行契約の確定 (Finding 6)**:
   - 現行本番 `BatchSimulationRunner` は逐次ループ実行であり並列バッチは未実装であるため、V1 Public Config から `concurrency` を削除し、**SEQUENTIAL EXECUTION ONLY** を正式契約とする（並列実行は将来スコープへ Deferred）。

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
   - クラスタ分散実行、GPU 並列化、マルチスレッド並列実行等のインフラ関心事は含めない（V1 は逐次実行固定）。
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
                                           │ generationSeed(g), environment
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                     Generation Runner V1 (本設計スコープ: 逐次実行)                   │
│                                                                                      │
│  [Step 1] Population & Environment Validation                                        │
│    PopulationSnapshot(g) の構造・一意性・不変性を検証 (N >= 2)                       │
│    environment 不変文字列検証 (Fail-Fast)                                            │
│                                                                                      │
│  [Step 2] Authoritative Config & Canonical Context Assembly                          │
│    resolvedFitnessConfig = FitnessEvaluator.validateConfig(config.fitnessConfig)     │
│    Canonical Schedule ID: double-round-robin-v1:r=${R}:max-decisions=${M}            │
│    Canonical Seed ID: evolution-evaluation-pair-v1:generation-seed=${seed}           │
│    Canonical ComparableEvaluationContext 構築 (Single Source of Truth)               │
│                                                                                      │
│  [Step 3] Canonical Double Round Robin Schedule Construction                         │
│    Canonical Ordering (genomeId 昇順) -> 全ペア A vs B / B vs A 生成                 │
│    Total Matches: N * (N - 1) * R (R = pairRepetitions)                              │
│    Fitness Evidence Preflight: perGenomeScheduledMatches >= minimumCompletedMatches  │
│                                                                                      │
│  [Step 4] Sequential Match Execution (Production Simulation Path)                    │
│    for each match in schedule (Canonical matchIndex 順次実行):                       │
│      pairSeed = deriveSeed(generationSeed, streamKey)                                │
│      matchContext = buildMatchContext(matchIndex, pairSeed)                          │
│      session = sessionFactory(matchContext)                                          │
│      policies = { p1: new GenomePolicy(p1DNA), p2: new GenomePolicy(p2DNA) }         │
│      result = SimulationRunner.run(session, policies, { maxDecisions })              │
│      if (result is FAILED) -> throw GenerationRunnerExecutionError (Fail-Closed)     │
│                                                                                      │
│  [Step 5] Deterministic Outcome Aggregation                                          │
│    全試合結果 (全件 failedMatches === 0) を PolicyParticipantOutcomeSummary へ集約   │
│                                                                                      │
│  [Step 6] Fitness Evaluation (Outcome-First V1)                                      │
│    FitnessEvaluator.evaluateParticipant() による評価                                 │
│    -> FitnessEvaluationSnapshot(g) 構築 (1:1 整合, Canonical Context 保持)           │
│                                                                                      │
│  [Step 7] Readiness Preflight Check                                                  │
│    readiness = PopulationSelector.assessReadiness(...)                               │
│    effectiveRequiredCount = max(readiness.requiredCount, eliteCount)                 │
│    if (readiness !== READY || validCount < effectiveRequiredCount)                   │
│      -> return REEVALUATION_REQUIRED (Builder 未呼出, nextPopulation: undefined)     │
│                                                                                      │
│  [Step 8] Delegation to Generation Builder                                           │
│    GenerationBuilder.buildNextGeneration({                                           │
│      population, fitnessSnapshot, targetGeneration: g+1, generationSeed, ...         │
│    })                                                                                │
│                                                                                      │
│  [Step 9] Return Execution Result                                                    │
│    - logicalResult: ADVANCED { nextPopulation(g+1), buildResult, fitnessSnapshot }   │
│    - runtimeMetrics: GenerationRunnerRuntimeMetrics (Sidecar, Deep Equal 対象外)     │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           │ GenerationRunnerExecutionResult
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
| 1. 入力検証 | Generation Runner | 母集団サイズ（$N \ge 2$）、環境不変情報、シード値正当性の検証 |
| 2. コンテキスト構築 | Generation Runner | Authoritative な設定解決と Canonical Comparable Context の一元構築 |
| 3. 対戦計画 | Generation Runner | Canonical Double Round Robin スケジュール生成、Match Identity 付与 |
| 4. 試合実行 | SimulationRunner / GameSession | 本番シミュレーション経路を通じた逐次対戦実行、合法的観測と Argmax 選択 |
| 5. 失敗検出 | Generation Runner | FAILED 試合検出時の即座な Fail-Closed 例外停止（誤淘汰防止） |
| 6. 戦績集計 | Generation Runner | 全試合結果から各個体の勝敗・引き分け・未決着数の決定論的集約 |
| 7. 適応度評価 | FitnessEvaluator | Outcome-First 契約に基づく MPA 算出、VALID / INSUFFICIENT 判定 |
| 8. 適格性事前判定 | Generation Runner / Selector | `PopulationSelector.assessReadiness` と Effective Gate による事前検証 |
| 9. 次世代構築 | GenerationBuilder | 親選択、エリート選出、交叉・変異、次世代スナップショット（$g+1$）アセンブリ |

---

## 6. Input Types & Parameter Contracts (入力型契約)

二重 Source of Truth を排除するため、`RunGenerationParams` は完成形の `ComparableEvaluationContext` ではなく、環境固有の不変情報のみを受け取る。

```typescript
/**
 * Generation Runner が受け取る環境固有の不変情報
 */
export interface GenerationRunnerEnvironmentContext {
  /** ルールセット識別子 (非空, 例: "rules-vnext:playtest") */
  readonly environmentRef: string;
  /** レギュレーション識別子 (非空, 例: "light-entry16") */
  readonly regulationId: string;
  /** フレーム識別子 (非空, 例: "entry16") */
  readonly frameId: string;
  /** ルールパッケージ版数 (非空, 例: "9.1.2") */
  readonly rulePackageVersion: string;
}

/**
 * Generation Runner の実行パラメータ
 */
export interface RunGenerationParams {
  /** 評価対象の現世代母集団スナップショット (N >= 2) */
  readonly population: PopulationSnapshot;

  /** 当該世代の自己対戦評価・親選択・子個体生成を統括する基本乱数シード (有限整数) */
  readonly generationSeed: number;

  /** 環境固有の不変情報 (非空文字列を必須とする) */
  readonly environment: GenerationRunnerEnvironmentContext;

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

V1 は逐次実行固定（Sequential Execution Only）とし、`concurrency` オプションは削除する。

```typescript
import {
  FitnessEvaluationConfig,
  DEFAULT_FITNESS_EVALUATION_CONFIG,
} from "./FitnessEvaluationTypes.js";
import { GenerationBuilderConfig } from "./GenerationBuilderTypes.js";

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
}

/**
 * デフォルト設定値 (Provisional Engineering Defaults)
 */
export const DEFAULT_GENERATION_RUNNER_CONFIG: GenerationRunnerConfig = Object.freeze({
  pairRepetitions: 1,
  maxDecisionsPerMatch: 500,
  fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
});
```

---

## 8. Canonical Comparable Evaluation Context (評価文脈の一元構築)

### 8.1 Single Source of Truth
Caller が個別に `context.fitnessConfig` や `context.generation` を指定することは禁止する。Runner は自身が解決した確定値から `ComparableEvaluationContext` を唯一の決定論的真実として構築する:

```typescript
// 1. Fitness Config の正規解決 (Authoritative)
const resolvedFitnessConfig = FitnessEvaluator.validateConfig(params.config?.fitnessConfig);

// 2. Schedule ID および Seed ID の導出
const evaluationScheduleId = canonicalEvaluationScheduleId(
  resolvedConfig.pairRepetitions,
  resolvedConfig.maxDecisionsPerMatch
);
const seedScheduleIdentity = canonicalSeedScheduleIdentity(params.generationSeed);

// 3. 一元化された Canonical Context の構築
const evaluationContext: ComparableEvaluationContext = Object.freeze({
  environmentRef: params.environment.environmentRef,
  regulationId: params.environment.regulationId,
  frameId: params.environment.frameId,
  rulePackageVersion: params.environment.rulePackageVersion,
  fitnessConfig: resolvedFitnessConfig,
  generation: params.population.generation,
  evaluationScheduleId,
  seedScheduleIdentity,
});
```

### 8.2 Canonical Evaluation Schedule ID 命名規則
`pairRepetitions` と `maxDecisionsPerMatch` は対戦回数および未決着（INCOMPLETE）発生率を左右し、適応度判定に直接影響を与える比較可能条件である。したがって、これらを明示的に含める:

```typescript
export function canonicalEvaluationScheduleId(
  pairRepetitions: number,
  maxDecisionsPerMatch: number
): string {
  return `double-round-robin-v1:r=${pairRepetitions}:max-decisions=${maxDecisionsPerMatch}`;
}
```
- 例: `double-round-robin-v1:r=1:max-decisions=500`

### 8.3 Canonical Seed Schedule Identity 命名規則
異なる `generationSeed` で評価された適応度は同一のシード系列として比較してはならないため、シード値を明示的に含める:

```typescript
export function canonicalSeedScheduleIdentity(generationSeed: number): string {
  return `evolution-evaluation-pair-v1:generation-seed=${generationSeed}`;
}
```
- 例: `evolution-evaluation-pair-v1:generation-seed=42`

---

## 9. Canonical Double Round Robin Schedule (対戦スケジュール)

### 9.1 採用理由 (Why Double Round Robin)
1. **完全な対戦相手対称性**: すべての個体が母集団内の全く同一の相手集合と戦うため、対戦相手の引き（opponent sampling bias）による運の要素を完全に排除できる。
2. **座席バイアスの対称化**: Mirrored seed + side swap により、先攻・後攻の座席差および配牌差を対称化し、決定論的な paired comparison を可能にする。
3. **適応度の高精度比較**: Tournament Selection が要求する「個体間の客観的な実力差」を最も偏りなく評価できる。
4. **単純性と決定論性**: ランダムサンプリングを排し、事前計画可能で再現性の高いスケジュール契約を実現する。

### 9.2 試合数算定公式 (Match Count Formula)
母集団個体数を $N$（$N \ge 2$）、ペア反復数を $R$（`pairRepetitions` $\ge 1$）とする。

- **非順序ペア総数**: $\text{totalPairs} = \frac{N(N - 1)}{2}$
- **世代全体の総試合数**: $\text{totalMatches} = N(N - 1)R$
- **1個体あたりの予定試合数**: $\text{perGenomeScheduledMatches} = 2(N - 1)R$
- **1個体あたりの座席別予定試合数**: $\text{matchesAsP1} = (N - 1)R, \quad \text{matchesAsP2} = (N - 1)R$

### 9.3 規模と上限の不在 (Do Not Hardcode 100)
Generation Builder のデフォルト個体数は 100 であるが、Generation Runner は $N = 100$ をハードコードしない。任意の $N \ge 2$ について同一の計算式と契約が成立する。また、恣意的な上限（例: $N \le 1000$）は課さない。

### 9.4 適応度証拠の先行検証 (Fitness Evidence Preflight)
実行開始前の Preflight 検証において:
$$\text{perGenomeScheduledMatches} < \text{resolvedFitnessConfig.minimumCompletedMatches}$$
である場合、対戦を1試合も実行することなく **`GenerationRunnerConfigurationError` により Fail-Fast で即時停止** する。Runner が勝手に `pairRepetitions` を引き上げて帳尻を合わせてはならない。
※なお、`minimumCompletionRate` は実際の対戦結果（未決着数）に依存するため事前判定はできず、対戦完了後の Fitness 評価層で判定される。

---

## 10. Ordering & Seed Derivation (順序付けとシード契約)

### 10.1 Population Canonical Ordering
入力された `population.entries` の順序に依存しない決定論性を保証するため、スケジュール構築前に個体配列のシャローコピーを作成し、`genomeId` の昇順（UTF-16 code unit order）でソートする（元配列非破壊）。

### 10.2 Canonical Pair & Leg Ordering
ソート済み個体系列 $G_0 < G_1 < \dots < G_{N-1}$ に対し、辞書順二重ループ ($i = 0 \dots N-2, j = i+1 \dots N-1$) により pair を生成し、各反復 $r \in [0, R-1]$ において次の順序で配置する:
- **Leg 0**: $p_1 = G_i, \quad p_2 = G_j$
- **Leg 1**: $p_1 = G_j, \quad p_2 = G_i$

全体の `matchIndex` は、このカノニカル順序に従って $0$ から $\text{totalMatches} - 1$ まで連続した連番となる。

### 10.3 Evaluation Stream Key & Pair Seed
```typescript
export function getEvaluationPairStreamKey(pairIndex: number, repetitionIndex: number): string {
  return `evolution-evaluation-pair-v1-${pairIndex}-${repetitionIndex}`;
}
```
$$\text{pairSeed} = \text{deriveSeed}(\text{generationSeed}, \text{getEvaluationPairStreamKey}(\text{pairIndex}, \text{repetitionIndex}))$$

### 10.4 Mirrored Leg Seed
同一 pair / repetition の両 Leg（Leg 0 と Leg 1）で **同一の `pairSeed` を `matchSeed` として共用** する。
- 座席を交代した同一デッキ配牌（Duplicate Deal）となり、座席バイアスが対称化される。
- ゲーム内シャッフルは独立ストリーム `runtime-shuffle-${counter}` を使用するため干渉しない。

---

## 11. Match Execution & Outcome Classification (試合実行と勝敗分類)

### 11.1 逐次実行パイプライン (Production Path)
Generation Runner は、各試合を `matchIndex` 順に逐次実行する:

```typescript
for (const match of schedule) {
  const matchContext: BatchMatchContext = {
    matchIndex: match.matchIndex,
    matchId: generateLogicalMatchId(params.population.generation, match),
    baseSeed: params.generationSeed,
    matchSeed: match.matchSeed,
    playerSeeds: {
      p1: deriveSeed(match.matchSeed, "p1"),
      p2: deriveSeed(match.matchSeed, "p2"),
    },
  };

  const session = params.sessionFactory(matchContext);
  const policies = {
    p1: new GenomePolicy(match.p1Dna),
    p2: new GenomePolicy(match.p2Dna),
  };

  let simResult: SimulationResult;
  try {
    simResult = SimulationRunner.run(session, policies, {
      maxDecisions: resolvedConfig.maxDecisionsPerMatch,
    });
  } catch (err) {
    // 予期せぬ例外発生時は試合レベル FAILED として即座に Fail-Closed 停止
    throw new GenerationRunnerExecutionError(
      `Match failed at index ${match.matchIndex}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 正常終了ステータスの集計 (COMPLETED vs INCOMPLETE)
  ...
}
```

### 11.2 FAILED 試合の Fail-Closed 境界 (誤淘汰防止)
現行のシミュレータ基盤には、エラーの原因が個体 DNA 起因か、ルールエンジン実装バグか、インフラ障害（OOM等）かを客観的・安全に峻別する Failure Attribution 型が存在しない。
したがって、V1 では:
- **1 試合でも FAILED を検出した場合、当該個体の適応度へ流すのではなく、Runner 全体を `GenerationRunnerExecutionError` により Fail-Closed で即時停止** する。
- これにより、システム不具合による正常個体の誤淘汰（誤った `INVALID` 判定）を根本から防止する。
- したがって、Generation Runner が `FitnessEvaluationSnapshot` の構築まで到達した場合、**全個体について `failedMatches === 0` が数学的に保証** される。

### 11.3 INCOMPLETE と DRAW の扱い
- **INCOMPLETE (`simResult.completed === false`)**:
  - 最大判断手数到達等による未決着。
  - **決して DRAW（引き分け）としては計上しない**。
  - `completedMatches` には含めず、双方の `incompleteMatches += 1` として記録し、`FitnessEvaluator` の完了率（`completionRate`）判定に委譲する。
- **COMPLETED DRAW (`simResult.completed === true && simResult.winner === undefined`)**:
  - ルール上の正規引き分けのみ、双方の `draws += 1` として計上する。

---

## 12. Per-Genome Outcome Aggregation & Fitness (戦績集約と適応度評価)

### 12.1 個体別戦績集約 (`PolicyParticipantOutcomeSummary`)
全試合（全件 FAILED なし）の完了後、各個体の戦績を既存の `PolicyParticipantOutcomeSummary` へ集約する。次の保存則を満たさなければ `GenerationRunnerIntegrityError` をスローする:
1. `wins + losses + draws === completedMatches`
2. `completedMatches + incompleteMatches === scheduledMatches` (failedMatches は 0)
3. `asP1.scheduledMatches === (N - 1) * R`
4. `asP2.scheduledMatches === (N - 1) * R`

### 12.2 適応度評価委譲
集約した各サマリーを `FitnessEvaluator.evaluateParticipant(summary, resolvedFitnessConfig)` へ渡して評価を委譲する。
- 残りライフ、被ダメージ、ターン数、所要時間等のテレメトリは適応度計算へ一切混入させない。
- 全個体の結果から `FitnessEvaluationSnapshot(g)` を構築する（`context` は Step 2 で構築した Canonical Context を保持）。

---

## 13. Readiness Preflight & Generation Transition (適格性事前判定と次世代遷移)

### 13.1 Readiness Preflight Check
Generation Builder の例外から `readinessStatus` を後付け推測するのではなく、Runner 自身が Builder 呼出前に **`PopulationSelector.assessReadiness()`** を正式実行する:

```typescript
const readiness = PopulationSelector.assessReadiness(
  params.population,
  fitnessSnapshot,
  resolvedConfig.builderConfig?.selectionConfig,
  evaluationContext
);
```

### 13.2 Effective Readiness Gate
Generation Builder には $\text{validCount} \ge \text{eliteCount}$ という Effective Gate が存在する。
Runner はこれを事前考慮し、有効要求数を次のように定義する:
$$\text{effectiveRequiredCount} = \max(\text{readiness.requiredCount}, \text{eliteCount})$$

- **再評価要求判定**:
  `readiness.status === "REEVALUATION_REQUIRED"` または `readiness.validCount < effectiveRequiredCount` の場合:
  - **`GenerationBuilder.buildNextGeneration()` を呼び出してはならない**。
  - 状態遷移を行わず、直ちに `status: "REEVALUATION_REQUIRED"` の論理結果を返却する。
  - この際、`readiness` には `{ status: "REEVALUATION_REQUIRED", validCount: readiness.validCount, requiredCount: effectiveRequiredCount, reason: ... }` を格納し、次世代母集団は厳格に `undefined` とする。
- **整合性エラー判定**:
  `readiness.status === "INVALID_POPULATION"` または `"INCOMPARABLE_EVALUATION"` の場合は、論理的再評価ではなくシステム不整合であるため、`GenerationRunnerIntegrityError` をスローする。
- **正常遷移判定**:
  上記を満たし `readiness.status === "READY"` かつ `validCount >= effectiveRequiredCount` の場合のみ、`GenerationBuilder.buildNextGeneration()` を呼び出す。
  ※もし Builder が予期せぬ `GenerationBuilderExecutionError` をスローした場合は、契約逸脱（Contract Drift）として `GenerationRunnerExecutionError` をスローする。

---

## 14. Result Model & Determinism (結果モデルと決定論性)

### 14.1 型定義と分離
決定論的一致が保証される論理結果と、実行環境に依存する実行時メトリクスを構造的に完全分離する:

```typescript
/**
 * 世代交代が正常完了した論理結果
 */
export interface GenerationRunnerAdvancedResult {
  readonly status: "ADVANCED";
  readonly nextPopulation: PopulationSnapshot;
  readonly buildResult: GenerationBuildResult;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly manifest: GenerationEvaluationManifest;
}

/**
 * 適応度評価は完了したが次世代へ進めない論理結果
 */
export interface GenerationRunnerReevaluationRequiredResult {
  readonly status: "REEVALUATION_REQUIRED";
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly reason: string;
  readonly readiness: SelectionReadiness;
  readonly manifest: GenerationEvaluationManifest;
  readonly nextPopulation?: undefined;
  readonly buildResult?: undefined;
}

/**
 * 決定論的論理結果 (Deep Equal 保証対象)
 */
export type GenerationRunnerLogicalResult =
  | GenerationRunnerAdvancedResult
  | GenerationRunnerReevaluationRequiredResult;

/**
 * 実行時メトリクス (Sidecar, Deep Equal 対象外)
 */
export interface GenerationRunnerRuntimeMetrics {
  readonly totalExecutionTimeMs: number;
  readonly matchExecutionElapsedMs: number;
  readonly matchesPerSecond: number;
  readonly totalDecisions: number;
}

/**
 * Generation Runner の総合実行結果
 */
export interface GenerationRunnerExecutionResult {
  readonly logicalResult: GenerationRunnerLogicalResult;
  readonly runtimeMetrics?: GenerationRunnerRuntimeMetrics;
}
```

### 14.2 論理マニフェスト (Logical Manifest)
`GenerationEvaluationManifest` には純粋な決定論的メタデータのみを含め、実行時間（wall-clock）やタイムスタンプは含めない:

```typescript
export interface GenerationEvaluationManifest {
  readonly generation: number;
  readonly populationSize: number;
  readonly pairRepetitions: number;
  readonly totalMatches: number;
  readonly generationSeed: number;
  readonly evaluationScheduleId: string;
  readonly seedScheduleIdentity: string;
}
```

### 14.3 決定論性保証境界 (Determinism Scope)
- **Deep Equal 保証対象**: `GenerationRunnerExecutionResult.logicalResult` のみ。
- **Supported Deterministic Runtime 境界**: 同一 Node.js LTS、同一実装版数、同一入力、同一設定、同一シード、同一 Stream Key 契約下において、Bit-exact / Deep Equal を保証。
- **入力順序非依存性**: `population.entries` 配列をシャッフルして渡しても `logicalResult` は 100% 一致。
- **メトリクスの非フィードバック**: `runtimeMetrics` は適応度・選択・次世代生成に一切関与しない。

---

## 15. Error Taxonomy (エラー体系)

```text
Error
 └─ GenerationRunnerError (基底型)
      ├─ GenerationRunnerConfigurationError (開始前設定不備: N<2, R<1, 証拠不足等)
      ├─ GenerationRunnerIntegrityError     (データ整合性違反: 重複ID, 保存則違反, Incomparable等)
      └─ GenerationRunnerExecutionError     (実行障害: FAILED試合検出, Contract Drift等)
```

---

## 16. Canonical 60-Test Plan (検証テスト計画)

将来のプロダクション実装（`BP-SIM-AI-GENERATION-RUNNER-V1`）において検証すべき全 60 項目の Canonical Test Plan を R1 契約に合わせて改訂・確定する。

### Group A: Config & Context Validation (Tests 1–9)
1. `N >= 2` の有効母集団を受容すること。
2. `pairRepetitions` のデフォルト値が 1 であること。
3. `pairRepetitions = 0` を `GenerationRunnerConfigurationError` で reject すること。
4. `pairRepetitions < 0`（負数）を reject すること。
5. `pairRepetitions` に小数（例: 1.5）を指定した場合 reject すること。
6. `pairRepetitions` に `NaN` または `Infinity` を指定した場合 reject すること。
7. `generationSeed = 0` が合法なシードとして正しく受容されること。
8. `generationSeed` に非有限数（`NaN` / `Infinity`）を指定した場合 reject すること。
9. $\text{perGenomeScheduledMatches} < \text{minimumCompletedMatches}$ の設定不備を対戦実行前に Fail-Fast で reject すること。

### Group B: Schedule Construction & Context Identity (Tests 10–18)
10. $N=2, R=1$ において総試合数が正確に 2 試合であること。
11. $N=3, R=1$ において総試合数が正確に 6 試合であること。
12. $N=4, R=2$ において総試合数が正確に 24 試合であること。
13. 任意の $N, R$ で総試合数が $N(N-1)R$ と厳密に一致すること。
14. 同一個体同士の対戦（自己対戦: $G_i \text{ vs } G_i$）が 1 試合も存在しないこと。
15. 各 unordered pair において、反復ごとに必ず Leg 0 と Leg 1 の 2 試合が存在すること。
16. 全個体について $p_1$ 回数と $p_2$ 回数が同数（$(N-1)R$）であり完全に均衡していること。
17. スケジュールの `matchIndex` が 0 から連番で欠番なく連続していること。
18. 入力母集団の `entries` 配列の順序を変更しても、生成されるスケジュールが完全に同一であること。

### Group C: Seed Derivation & Context Identifiers (Tests 19–24)
19. 同一入力に対し、導出される全 `pairSeed` 系列が完全に同一であること。
20. 母集団の入力順序を変更しても、全試合の `pairSeed` 系列が不変であること。
21. 異なる `generationSeed` を与えた場合、固定 fixture においてシード系列が変化し得ること（Negative Control）。
22. 異なるシードに対する過剰な万能相違保証（Universal Must-Differ）を課さないこと。
23. `pairRepetitions` または `maxDecisionsPerMatch` が異なる場合、`evaluationScheduleId` が正しく差別化されること。
24. `generationSeed` が異なる場合、`seedScheduleIdentity` が正しく差別化されること。

### Group D: Outcome Aggregation & Conservation (Tests 25–32)
25. COMPLETED 試合における $p_1$ 勝利が、$p_1$ の win および $p_2$ の loss へ正確に集計されること。
26. COMPLETED 試合における $p_2$ 勝利が、$p_2$ の win および $p_1$ の loss へ正確に集計されること。
27. COMPLETED 試合における引き分けが、双方の draw へ正確に集計されること。
28. INCOMPLETE 試合が draw として扱われず、双方の `incompleteMatches` へ厳密に集計されること。
29. **[R1 改訂] 1試合でも FAILED 試合が発生した場合、`GenerationRunnerExecutionError` で即座に Fail-Closed 停止し、Fitness Snapshot や次世代が生成されないこと。**
30. スケジュール計画数に対して実行結果が 1 件でも欠損している場合、`GenerationRunnerIntegrityError` で停止すること。
31. 重複した `matchIndex` の結果が存在する場合、`GenerationRunnerIntegrityError` で停止すること。
32. 試合結果の参加個体 ID と計画個体 ID が不一致の場合、`GenerationRunnerIntegrityError` で停止すること。

### Group E: Fitness Evaluation & Attribution (Tests 33–39)
33. 適応度評価が `FitnessEvaluator.evaluateParticipant()` へ正しく委譲されること。
34. 残りライフ（Remaining Life）が適応度計算に一切使用されていないこと。
35. ターン数（Turn Count）が適応度計算に一切使用されていないこと。
36. 実行所要時間（Duration / Latency）が適応度計算に一切使用されていないこと。
37. 全敗（wins = 0, draws = 0）の個体でも `VALID`（スコア 0.0）として適格保存されること。
38. **[R1 改訂] Generation Runner V1 が FAILED 試合を特定 Genome の INVALID として自動帰属せず、安全に Fail-Closed すること。**
39. 完了試合数不足の個体が `INSUFFICIENT_EVIDENCE`（適応度 null）となること。

### Group F: Readiness & Generation Transition (Tests 40–46)
40. 生成された `FitnessEvaluationSnapshot` の世代番号が $g$ と厳密に一致すること。
41. 母集団エントリと適応度エントリが完全な 1:1 対応を成していること。
42. `GenerationBuilder` が目標世代 $g+1$ で正しく呼び出されること。
43. `GenerationBuilder` へ同一の `generationSeed` が透過的に渡されること。
44. 正常遷移時、ステータス `ADVANCED` と世代 $g+1$ の母集団スナップショットが返却されること。
45. **[R1 改訂] Readiness Preflight により有効個体数不足（standard または effective）を検出し、Builder を呼び出すことなく `status: "REEVALUATION_REQUIRED"` と完全な `SelectionReadiness` を返却すること。**
46. `REEVALUATION_REQUIRED` 時に Runner が勝手に再試行（Hidden Retry）を行わないこと。

### Group G: Determinism & Metrics Separation (Tests 47–52)
47. **[R1 改訂] 同一環境・同一入力で 2 回実行した際、`logicalResult` が Deep Equal に完全一致すること（`runtimeMetrics` は一致比較対象外）。**
48. 入力母集団の配列シャッフルに対し、`logicalResult` が完全一致すること。
49. **[R1 改訂] 結果集約の純粋ロジックにおいて、同一試合結果群が異なる完了順序で到着しても `matchIndex` 再整列により同一集約結果が得られること。**
50. **[R1 改訂] Generation Runner V1 の Public Config に concurrency オプションが存在せず、実行が厳密に Sequential であること。**
51. 出力論理データ構造内に動的タイムスタンプが一切含まれないこと。
52. 出力論理データ構造内に UUID や外部ランダム値が一切含まれないこと。

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

## 17. Open Design Questions & Resolutions (設計課題と決定事項)

### [Issue A] Mirrored Legs において同一 pairSeed を共用して安全か？
- **決定**: **安全であり、正式採用する**。
- **根拠**: 同一シード下で座席を入れ替えた場合、両者が全く同一のデッキ配牌を相手の立場からプレイする「鏡像配牌（Duplicate Deal）」となり、先攻・後攻バイアスを対称化できる。`PolicyExperimentRunner` でも同一方式が本番採用されている。

### [Issue B] スケジュールを全件 Materialize するか、Iterator にするか？
- **決定**: **V1 では In-Memory Materialization を正式採用する**。
- **根拠**: $N=100, R=1$ において 9,900 件の記述子配列は数メガバイト程度であり、メモリ圧迫のリスクが極めて低い。配列として実体化する方がスライシング、シャッフル検証、テストが圧倒的にシンプルとなる。

### [Issue C] 既存の SimulationRunner で p1/p2 別 GenomePolicy をどう渡すか？
- **決定**: **`policies: { p1: policyA, p2: policyB }` の標準辞書で渡す**。
- **根拠**: `SimulationRunner.run(session, policies)` は第2引数として `Record<string, DecisionPolicy>` を受け取る本番仕様であり、追加改修なしに完全対応できる。

### [Issue D] FAILED / INCOMPLETE の本番ステータスマッピングと帰属は？
- **決定**: `simResult.completed ? "COMPLETED" : "INCOMPLETE"`。例外発生時は **Runner 全体を Fail-Closed 停止** とする。
- **根拠**: Failure Attribution 契約が存在しない V1 において、インフラやエンジン起因の障害を Genome の責任として `INVALID` にすると正常個体を誤淘汰する危険があるため、安全側に倒して Fail-Closed とする。

### [Issue E] Comparable Context の二重 Source of Truth をどう排除するか？
- **決定**: **外部からは `environment` のみを受け取り、Context は Runner 自身が一元構築する**。
- **根拠**: `fitnessConfig`、`generation`、`evaluationScheduleId`、`seedScheduleIdentity` を Runner 解決値から自動導出することで、Caller による不整合な Context 入力を原理的に遮断する。

### [Issue F] Readiness をどう取得し、REEVALUATION_REQUIRED をどう返すか？
- **決定**: **Runner が `PopulationSelector.assessReadiness()` を先行実行し、不足時は Builder を呼ばずに Discriminated Union の論理結果として返す**。
- **根拠**: Builder 例外への依存を排除し、完全な `SelectionReadiness`（有効数・要求数・理由）を診断用に保持したクリーンな論理結果を返却する。

---

## 18. Future Scope (将来の展望と分離境界)

1. **BP-SIM-AI-GENERATION-RUNNER-V1**: 本 R1 設計書に基づく Generation Runner の TypeScript 実装および Canonical 60-Test のパス。
2. **BP-SIM-AI-EVOLUTION-LOOP-DESIGN-V1**: 複数世代を反復実行する Evolution Loop の設計（シード系列チェーン、収束条件、チェックポイント、ファイル永続化）。
3. **Formal Failure Attribution Contract**: Genome 起因例外とインフラ障害を区別し、安全に Genome を失格判定する拡張契約。
4. **Parallel Batch Execution**: Worker Threads 等による並列シミュレーション実行。
5. **Phase 4.1 (Hall of Fame & Large Scale Evolution)**: 歴代チャンピオン個体の保存、大規模並列対戦。

---

## 19. Interface Reference (型定義一覧)

```typescript
import {
  ComparableEvaluationContext,
  FitnessEvaluationSnapshot,
  PopulationSnapshot,
  SelectionReadiness,
} from "./PopulationSelectionTypes.js";
import {
  FitnessEvaluationConfig,
  DEFAULT_FITNESS_EVALUATION_CONFIG,
} from "./FitnessEvaluationTypes.js";
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

export interface GenerationRunnerEnvironmentContext {
  readonly environmentRef: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
}

export interface GenerationRunnerConfig {
  readonly pairRepetitions: number;
  readonly maxDecisionsPerMatch: number;
  readonly fitnessConfig: FitnessEvaluationConfig;
  readonly builderConfig?: Partial<GenerationBuilderConfig>;
}

export const DEFAULT_GENERATION_RUNNER_CONFIG: GenerationRunnerConfig = Object.freeze({
  pairRepetitions: 1,
  maxDecisionsPerMatch: 500,
  fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
});

export interface RunGenerationParams {
  readonly population: PopulationSnapshot;
  readonly generationSeed: number;
  readonly environment: GenerationRunnerEnvironmentContext;
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

export type GenerationRunnerLogicalResult =
  | GenerationRunnerAdvancedResult
  | GenerationRunnerReevaluationRequiredResult;

export interface GenerationRunnerRuntimeMetrics {
  readonly totalExecutionTimeMs: number;
  readonly matchExecutionElapsedMs: number;
  readonly matchesPerSecond: number;
  readonly totalDecisions: number;
}

export interface GenerationRunnerExecutionResult {
  readonly logicalResult: GenerationRunnerLogicalResult;
  readonly runtimeMetrics?: GenerationRunnerRuntimeMetrics;
}

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
