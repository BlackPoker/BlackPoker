# BlackPoker Simulator Generation Runner Design V1 (Follow-up R3)
# (Generation g 自己対戦評価・適応度集計・次世代遷移実行境界契約)

作業ID: `BP-SIM-AI-GENERATION-RUNNER-DESIGN-V1-R3`
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

### R3 Follow-up における確定・厳格化事項
1. **`maxDecisionsPerMatch` および `generationSeed` の事前 Fail-Fast Validation 契約確立 (Finding 1)**:
   - Runner は試合を 1 試合も開始する前に、`maxDecisionsPerMatch` を有限整数かつ $\ge 1$（`typeof === "number" && Number.isFinite() && Number.isInteger() && >= 1`）として厳格検証。`0`、負数、小数、`NaN`、`Infinity`、`-Infinity` はすべて `GenerationRunnerConfigurationError` で Fail-Fast 拒絶。
   - `generationSeed` についても有限整数（`Number.isFinite() && Number.isInteger()`）として厳格検証。`0` は合法値として受容し、小数（例: `1.5`）や非有限数（`NaN`、`Infinity`、`-Infinity`）は `GenerationRunnerConfigurationError` で Fail-Fast 拒絶。
   - 全静的設定不備を試合実行前に完全に検出する Canonical Validation 順序を確定。
2. **実行障害フェーズ診断情報（Execution Phase Diagnostics）の保持 (Finding 2)**:
   - 単一 Fail-Closed 境界を維持しつつ、障害発生フェーズを識別する内部型 `GenerationRunnerExecutionPhase = "SESSION_FACTORY" | "POLICY_FACTORY" | "RUNNER"` を定義。
   - `GenerationRunnerExecutionError` に `phase`、`matchIndex`、`p1GenomeId`、`p2GenomeId`、`causeName` を保持させ、どのフェーズでどの試合が失敗したかを正確に診断可能化。動的変動データ（タイムスタンプ、絶対パス、UUID等）は除外。
   - 例外発生時は即座に世代全体の実行を中止し、残余対戦は実行されず、部分的な戦績・適応度・次世代母集団は一切生成しない（No Partial Result, Zero Leak）。
3. **Builder Config Resolver の内部実装詳細化（Internalization） (Finding 3)**:
   - `resolveCanonicalBuilderConfig()` を Public API として export するのを廃止し、Runner 内部のヘルパー（Internal Helper）としてカプセル化。
   - 公開型定義一覧（Interface Reference）から削除し、不要な Public API 露出を排除。解決セマンティクス（`populationSize`、`selectionConfig`、`geneticOperatorConfig`、`eliteCount < resolvedPopulationSize`、下流への透過伝搬）は完全維持。

### R2 Follow-up における確定事項 (継続維持)
1. **Canonical Builder Config 事前解決と設定ドリフトの根絶 (Finding 1)**:
   - Runner は対戦実行を開始する前の最優先ステップとして、`GenerationBuilder` と全く同一の解決セマンティクスで `builderConfig` を事前解決（`resolvedBuilderConfig: GenerationBuilderConfig`）する。
   - `resolvedPopulationSize`: `builderConfig?.populationSize ?? DEFAULT_GENERATION_BUILDER_CONFIG.populationSize`（有限整数かつ $\ge 2$ を検証）。
   - `resolvedSelectionConfig`: `PopulationSelector.validateConfig({ ...DEFAULT_GENERATION_BUILDER_CONFIG.selectionConfig, ...builderConfig?.selectionConfig })`。
   - `resolvedGeneticOperatorConfig`: `validateGeneticOperatorConfig({ ...DEFAULT_GENERATION_BUILDER_CONFIG.geneticOperatorConfig, ...builderConfig?.geneticOperatorConfig })`。
   - `eliteCount < resolvedPopulationSize` を対戦実行前に検証。違反時は試合を実行することなく `GenerationRunnerConfigurationError` をスロー（`REEVALUATION_REQUIRED` ではなく事前設定エラーとして Fail-Fast 拒絶）。
   - 解決済み `resolvedBuilderConfig.selectionConfig` を `PopulationSelector.assessReadiness()` に渡し、解決済み `resolvedBuilderConfig` 全体を `GenerationBuilder.buildNextGeneration()` に渡すことで、Runner と Builder 間の設定不整合（Configuration Drift）を完全に排除。
2. **統一試合実行境界（Unified Match Execution Boundary）の確立 (Finding 2)**:
   - 試合実行の 3 フェーズ（`SESSION_FACTORY`: `sessionFactory(matchContext)`、`POLICY_FACTORY`: `new GenomePolicy(p1DNA) / new GenomePolicy(p2DNA)`、`RUNNER`: `SimulationRunner.run(session, policies, { maxDecisions })`）を単一の Fail-Closed な `try / catch` 境界で統合。
   - 3 フェーズのいずれで例外が発生した場合も、直ちに `GenerationRunnerExecutionError` をスローして即時中断。
   - 実行時例外を試合レベルの `FAILED` として握りつぶしたり、個体 DNA の `INVALID` 適応度へ自動帰属させたりしない。
   - 障害発生時は直ちに中断され、残余対戦は実行されず、戦績集約・`FitnessEvaluationSnapshot` の生成・Builder 呼び出し・次世代母集団の生成はいずれも行われない。
   - Runner が正常に完走した場合、評価された全試合は `COMPLETED` または `INCOMPLETE` であり、全個体の `failedMatches === 0` が保証される。

### R1 Follow-up における確定・厳格化事項 (継続維持)
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
│  [Step 1 & 2] Canonical Preflight Validation & Context Assembly (Fail-Fast)          │
│    1. generationSeed 検証: 有限整数 (0 合法, fraction / NaN / Infinity reject)       │
│    2. environment 文字列検証: 非空文字列 (environmentRef, regulationId 等)           │
│    3. population 整合性検証: N >= 2, 重複ID不在, 不変性保証                          │
│    4. pairRepetitions 検証: 有限整数 >= 1 (<=0, fraction, NaN reject)                │
│    5. maxDecisionsPerMatch 検証: 有限整数 >= 1 (0, 負数, fraction, NaN, Inf reject)  │
│    6. resolvedFitnessConfig = FitnessEvaluator.validateConfig(...)                   │
│    7. resolvedBuilderConfig = resolveCanonicalBuilderConfig(...) (内部ヘルパー)      │
│       - populationSize >= 2, selectionConfig 検証, geneticOperatorConfig 検証         │
│       - eliteCount < resolvedPopulationSize 検証 (違反時 ConfigurationError)         │
│    8. Canonical Schedule ID: double-round-robin-v1:r=${R}:max-decisions=${M}            │
│    9. Canonical Seed ID: evolution-evaluation-pair-v1:generation-seed=${seed}           │
│    10. Canonical ComparableEvaluationContext 構築 (Single Source of Truth)           │
│                                                                                      │
│  [Step 3] Canonical Double Round Robin Schedule Construction                         │
│    Canonical Ordering (genomeId 昇順) -> 全ペア A vs B / B vs A 生成                 │
│    Total Matches: N * (N - 1) * R (R = pairRepetitions)                              │
│    Fitness Evidence Preflight: perGenomeScheduledMatches >= minimumCompletedMatches  │
│                                                                                      │
│  [Step 4] Sequential Match Execution (Unified 3-Phase Fail-Closed Boundary)          │
│    for each match in schedule (Canonical matchIndex 順次実行):                       │
│      pairSeed = deriveSeed(generationSeed, streamKey)                                │
│      matchContext = buildMatchContext(matchIndex, pairSeed)                          │
│      try {                                                                           │
│        phase = "SESSION_FACTORY";                                                    │
│        session = params.sessionFactory(matchContext)                                 │
│        phase = "POLICY_FACTORY";                                                     │
│        policies = { p1: new GenomePolicy, p2: new GenomePolicy }                     │
│        phase = "RUNNER";                                                             │
│        simResult = SimulationRunner.run(session, policies, ...)                      │
│      } catch (err) {                                                                 │
│        throw new GenerationRunnerExecutionError(msg, {                               │
│          phase, matchIndex, p1GenomeId, p2GenomeId, causeName                        │
│        });                                                                           │
│      }                                                                               │
│      // 正常完走時は全試合 completed または incomplete のみ (failedMatches === 0)    │
│                                                                                      │
│  [Step 5] Deterministic Outcome Aggregation                                          │
│    全試合結果 (全件 failedMatches === 0) を PolicyParticipantOutcomeSummary へ集約   │
│                                                                                      │
│  [Step 6] Fitness Evaluation (Outcome-First V1)                                      │
│    FitnessEvaluator.evaluateParticipant() による評価                                 │
│    -> FitnessEvaluationSnapshot(g) 構築 (1:1 整合, Canonical Context 保持)           │
│                                                                                      │
│  [Step 7] Readiness Preflight Check                                                  │
│    readiness = PopulationSelector.assessReadiness(...,                               │
│      resolvedBuilderConfig.selectionConfig, evaluationContext)                       │
│    effectiveRequiredCount = max(readiness.requiredCount, eliteCount)                 │
│    if (readiness !== READY || validCount < effectiveRequiredCount)                   │
│      -> return REEVALUATION_REQUIRED (Builder 未呼出, nextPopulation: undefined)     │
│                                                                                      │
│  [Step 8] Delegation to Generation Builder                                           │
│    GenerationBuilder.buildNextGeneration({                                           │
│      population, fitnessSnapshot, targetGeneration: g+1, generationSeed,             │
│      config: resolvedBuilderConfig, expectedContext: evaluationContext               │
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
| 1. 入力検証 | Generation Runner | 母集団サイズ（$N \ge 2$）、環境不変情報、シード値正当性（有限整数, 0合法, 小数/非有限reject）の検証 |
| 2. 設定・文脈構築 | Generation Runner | 全静的設定解決（`pairRepetitions`, `maxDecisions`, Fitness & Builder）、`eliteCount < populationSize` 事前検証、Canonical Context 一元構築 |
| 3. 対戦計画 | Generation Runner | Canonical Double Round Robin スケジュール生成、Match Identity 付与、証拠数事前検証 |
| 4. 試合実行 | Runner / Session / Policy | `SESSION_FACTORY`, `POLICY_FACTORY`, `RUNNER` の 3 フェーズ統一 Fail-Closed 境界下での逐次実行 |
| 5. 失敗検出 | Generation Runner | 実行例外検出時のフェーズ診断情報（phase, matchIndex, p1, p2, cause）保持と即時 Fail-Closed 停止 |
| 6. 戦績集計 | Generation Runner | 完走試合結果から各個体の勝敗・引き分け・未決着数の決定論的集約（`failedMatches === 0`） |
| 7. 適応度評価 | FitnessEvaluator | Outcome-First 契約に基づく MPA 算出、VALID / INSUFFICIENT 判定 |
| 8. 適格性事前判定 | Generation Runner / Selector | `resolvedBuilderConfig.selectionConfig` と Effective Gate による事前検証（不足時 Builder 未呼出） |
| 9. 次世代構築 | GenerationBuilder | 内部解決済み `resolvedBuilderConfig` による決定論的次世代アセンブリ（親選択、エリート、交叉・変異） |

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

### 7.1 GenerationRunnerConfig 型定義 & 入力検証契約
V1 は逐次実行固定（Sequential Execution Only）とし、`concurrency` オプションは削除する。

```typescript
import {
  FitnessEvaluationConfig,
  DEFAULT_FITNESS_EVALUATION_CONFIG,
} from "./FitnessEvaluationTypes.js";
import {
  DEFAULT_GENERATION_BUILDER_CONFIG,
  GenerationBuilderConfig,
} from "./GenerationBuilderTypes.js";
import {
  PopulationSelectionConfig,
} from "./PopulationSelectionTypes.js";
import {
  GeneticOperatorConfig,
} from "./GeneticOperatorTypes.js";
import { PopulationSelector } from "./PopulationSelector.js";
import { validateGeneticOperatorConfig } from "./GeneticOperators.js";

/**
 * Generation Runner 評価・実行設定
 */
export interface GenerationRunnerConfig {
  /**
   * 各 unordered pair に対する side-swapped pair (Leg 0 + Leg 1) の反復実行回数
   * 有限正の整数 >= 1 (デフォルト: 1)
   */
  readonly pairRepetitions: number;

  /**
   * 1試合あたりの最大意思決定手数
   * 有限正の整数 >= 1 (デフォルト: 500)
   */
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

#### 7.1.1 `maxDecisionsPerMatch` の厳格な Fail-Fast 検証契約 (Finding 1)
`maxDecisionsPerMatch` は `SimulationRunner.run` へ直接渡され、対戦が `COMPLETED` となるか `INCOMPLETE` となるかの判定境界を直接決定する重要な比較可能条件（Comparable Condition）である。
値が `0` や `NaN` の場合、試合が意図せず即座に `INCOMPLETE` 化し、`Infinity` の場合は意思決定上限キャップとして機能しなくなる。
したがって、Runner は試合を **1 試合も開始する前に** 次の契約を厳格に検証する:

- **型・有限性・整数性・下限値契約**:
  - `typeof value === "number"`
  - `Number.isFinite(value)`
  - `Number.isInteger(value)`
  - `value >= 1`
- **拒絶対象（Invalid Values）**:
  - `0`
  - 負の整数（例: `-1`, `-500`）
  - 小数（例: `1.5`, `500.2`）
  - `NaN`
  - `Infinity`, `-Infinity`
  - 文字列や boolean 等の非 number 型
- **違反時の処置**:
  - 対戦を1件も実行することなく、直ちに **`GenerationRunnerConfigurationError`** をスローして Fail-Fast 停止する。

#### 7.1.2 `generationSeed` の厳格な Fail-Fast 検証契約 (Finding 1)
`generationSeed` は世代全体の対戦スケジュールシード系列、親選択、交叉・変異シード導出の Single Source of Truth である。
- **型・有限性・整数性契約**:
  - `typeof value === "number"`
  - `Number.isFinite(value)`
  - `Number.isInteger(value)`
  - `generationSeed = 0` は合法なシード値として正しく受容される。
- **拒絶対象（Invalid Values）**:
  - 小数（例: `1.5`）
  - `NaN`
  - `Infinity`, `-Infinity`
  - 文字列等の非 number 型
- **負の整数に関する契約整合性**:
  - 既存の `deriveSeed` および Accepted PRNG 契約に準拠し、有限整数であれば負数も合法として受容する。
- **違反時の処置**:
  - 直ちに **`GenerationRunnerConfigurationError`** をスローして Fail-Fast 停止する。

### 7.2 Canonical Builder Config 事前解決契約 (内部実装詳細, Finding 3)
Runner が対戦実行後に Builder 設定不備で異常終了することを防止し、また Runner と Builder 間での設定解釈の乖離（Configuration Drift）を根絶するため、**対戦スケジュール実行前の最優先 Preflight ステップ** として `GenerationBuilder` と全く同一の解決セマンティクスで `builderConfig` を事前解決する。

> [!IMPORTANT]
> **内部ヘルパー契約 (Not a Public API)**
> この事前解決ロジックは Generation Runner の **内部実装詳細（Internal Helper）** であり、Public API として `export` されない。Runner 外部の Caller が直接呼び出す契約ではないため、不要な Public API 露出を排除する。

```typescript
/**
 * Generation Builder 設定の正規事前解決 (Runner 内部実装詳細)
 * (GenerationBuilder.buildNextGeneration と厳密に同一の解決セマンティクス)
 */
function resolveCanonicalBuilderConfig(
  builderConfig?: Partial<GenerationBuilderConfig>
): GenerationBuilderConfig {
  const resolvedPopulationSize =
    builderConfig?.populationSize !== undefined
      ? builderConfig.populationSize
      : DEFAULT_GENERATION_BUILDER_CONFIG.populationSize;

  if (
    typeof resolvedPopulationSize !== "number" ||
    !Number.isFinite(resolvedPopulationSize) ||
    !Number.isInteger(resolvedPopulationSize) ||
    resolvedPopulationSize < 2
  ) {
    throw new GenerationRunnerConfigurationError(
      `builderConfig.populationSize must be an integer >= 2, received ${resolvedPopulationSize}`
    );
  }

  let resolvedSelectionConfig: PopulationSelectionConfig;
  try {
    resolvedSelectionConfig = PopulationSelector.validateConfig({
      ...DEFAULT_GENERATION_BUILDER_CONFIG.selectionConfig,
      ...builderConfig?.selectionConfig,
    });
  } catch (err) {
    throw new GenerationRunnerConfigurationError(
      `Invalid builderConfig.selectionConfig: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let resolvedOperatorConfig: GeneticOperatorConfig;
  try {
    resolvedOperatorConfig = validateGeneticOperatorConfig({
      ...DEFAULT_GENERATION_BUILDER_CONFIG.geneticOperatorConfig,
      ...builderConfig?.geneticOperatorConfig,
    });
  } catch (err) {
    throw new GenerationRunnerConfigurationError(
      `Invalid builderConfig.geneticOperatorConfig: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const eliteCount = resolvedSelectionConfig.eliteCount;
  if (eliteCount >= resolvedPopulationSize) {
    throw new GenerationRunnerConfigurationError(
      `builderConfig.selectionConfig.eliteCount (${eliteCount}) must be strictly less than resolved populationSize (${resolvedPopulationSize})`
    );
  }

  return Object.freeze({
    populationSize: resolvedPopulationSize,
    selectionConfig: resolvedSelectionConfig,
    geneticOperatorConfig: resolvedOperatorConfig,
  });
}
```

#### 事前解決に関する重要契約
1. **対戦前 Fail-Fast の徹底**:
   - `populationSize < 2`、非整数、`tournamentSize` 不正、`mutationRate` 不正、および `eliteCount >= resolvedPopulationSize` のいずれの不備も、対戦を1試合も実行することなく **`GenerationRunnerConfigurationError` で即時停止** する。
2. **Configuration Error vs REEVALUATION_REQUIRED**:
   - `eliteCount >= resolvedPopulationSize` は母集団の適応度不足による「再評価要求（`REEVALUATION_REQUIRED`）」ではなく、開始前の「静的設定不備」である。対戦実行前に `GenerationRunnerConfigurationError` で reject し、計算資源の無駄遣いを遮断する。
3. **下流コンポーネントへの Authoritative 伝搬**:
   - Step 7 の適格性判定（`PopulationSelector.assessReadiness`）には `resolvedBuilderConfig.selectionConfig` を渡す。
   - Step 8 の次世代構築（`GenerationBuilder.buildNextGeneration`）には `config: resolvedBuilderConfig` として解決済み設定オブジェクトを透過的に引き渡す。
   - これにより、Runner が検証した設定と Builder が実行する設定の完全一致を保証し、設定ドリフトを根絶する。

### 7.3 全静的設定解決と検証順序 (Canonical Validation Order)
Runner は試合開始前に次の順序で静的設定を確定・検証し、完全な `resolvedConfig` を構築する:

```typescript
export interface GenerationRunnerResolvedConfig {
  readonly pairRepetitions: number;
  readonly maxDecisionsPerMatch: number;
  readonly fitnessConfig: FitnessEvaluationConfig;
  readonly builderConfig: GenerationBuilderConfig;
}
```

1. **`generationSeed` の検証**: 有限整数、0 合法、fraction/NaN/Infinity は拒絶。
2. **`environment` の検証**: `environmentRef`, `regulationId`, `frameId`, `rulePackageVersion` が非空文字列であることを検証。
3. **`population` の検証**: $N \ge 2$、重複 genomeId 不在、不変性を検証。
4. **`pairRepetitions` の検証**: 有限整数 $\ge 1$（デフォルト: 1）。
5. **`maxDecisionsPerMatch` の検証**: 有限整数 $\ge 1$（デフォルト: 500）。
6. **`fitnessConfig` の検証**: `FitnessEvaluator.validateConfig(config.fitnessConfig)` による正規解決。
7. **`builderConfig` の検証**: 内部ヘルパー `resolveCanonicalBuilderConfig(config.builderConfig)` による正規解決。
8. **`eliteCount < target populationSize` の検証**: 不正時 Fail-Fast。
9. **適応度証拠数の事前検証**: $\text{perGenomeScheduledMatches} \ge \text{minimumCompletedMatches}$ を事前検証。

上記 1〜9 の検証がすべて正常完了して初めて、対戦スケジュールの実行へ進む。

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

### 11.1 統一試合実行境界とフェーズ診断 (Unified Match Execution Boundary with Phase Diagnostics)
Generation Runner は、各試合を `matchIndex` 順に逐次実行する。ここで、試合の実行に関わる 3 つのフェーズ:
1. **`SESSION_FACTORY`**: 試合固有の `GameSession` インスタンス生成
2. **`POLICY_FACTORY`**: 両プレイヤーの `GenomePolicy` インスタンス生成
3. **`RUNNER`**: `SimulationRunner.run` によるシミュレーション実行

を **単一の Fail-Closed な `try / catch` 境界** の下で統合管理し、障害発生時にどのフェーズで失敗したかを正確に診断可能とする:

```typescript
/**
 * 試合実行フェーズ識別型 (Runner 診断用)
 */
export type GenerationRunnerExecutionPhase =
  | "SESSION_FACTORY"
  | "POLICY_FACTORY"
  | "RUNNER";

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

  let currentPhase: GenerationRunnerExecutionPhase = "SESSION_FACTORY";
  let session: GameSession;
  let policies: Record<string, DecisionPolicy>;
  let simResult: SimulationResult;

  try {
    // Phase 1: SESSION_FACTORY (試合固有 fresh GameSession の生成)
    currentPhase = "SESSION_FACTORY";
    session = params.sessionFactory(matchContext);

    // Phase 2: POLICY_FACTORY (各プレイヤー GenomePolicy の生成)
    currentPhase = "POLICY_FACTORY";
    policies = {
      p1: new GenomePolicy(match.p1Dna),
      p2: new GenomePolicy(match.p2Dna),
    };

    // Phase 3: RUNNER (本番シミュレーションの逐次実行)
    currentPhase = "RUNNER";
    simResult = SimulationRunner.run(session, policies, {
      maxDecisions: resolvedConfig.maxDecisionsPerMatch,
    });
  } catch (err) {
    const causeName = err instanceof Error ? err.name : undefined;
    const causeMessage = err instanceof Error ? err.message : String(err);
    // Fail-Closed: どのフェーズで障害が発生したかを記録して即座に中断
    throw new GenerationRunnerExecutionError(
      `Match execution failed during ${currentPhase} at matchIndex ${match.matchIndex} (${match.p1GenomeId} vs ${match.p2GenomeId}): ${causeMessage}`,
      {
        phase: currentPhase,
        matchIndex: match.matchIndex,
        p1GenomeId: match.p1GenomeId,
        p2GenomeId: match.p2GenomeId,
        causeName,
        causeMessage,
      }
    );
  }

  // 正常完走判定 (COMPLETED vs INCOMPLETE)
  if (simResult.completed) {
    if (simResult.winner === "p1") {
      outcomes.recordWin(match.p1GenomeId, match.p2GenomeId, match);
    } else if (simResult.winner === "p2") {
      outcomes.recordWin(match.p2GenomeId, match.p1GenomeId, match);
    } else {
      outcomes.recordDraw(match.p1GenomeId, match.p2GenomeId, match);
    }
  } else {
    outcomes.recordIncomplete(match.p1GenomeId, match.p2GenomeId, match);
  }
}
```

### 11.2 実行時例外の Fail-Closed 境界と診断契約 (Finding 2)
現行のシミュレータ基盤には、エラーの原因が個体 DNA 起因か、セッション生成不備か、ルールエンジン実装バグか、インフラ障害（OOM等）かを客観的・安全に峻別する Failure Attribution 型が存在しない。
したがって、V1 では:
1. **フェーズ識別診断情報の保持 (Diagnostic Properties)**:
   - `GenerationRunnerExecutionError` には、最低限次の診断情報を保持する:
     - `phase`: 障害発生フェーズ（`"SESSION_FACTORY"` / `"POLICY_FACTORY"` / `"RUNNER"`）
     - `matchIndex`: 失敗した試合の通し番号
     - `p1GenomeId`: Player 1 の個体 ID
     - `p2GenomeId`: Player 2 の個体 ID
     - `causeName`: 原因エラーのクラス名／識別名（利用可能な場合）
2. **動的揮発性データ（Volatile Runtime Data）の厳格な排除**:
   - 決定論的診断契約を汚染しないため、実行時の動的揮発性データ（実行時刻 timestamp, wall-clock, 実行マシンの絶対パス, ホスト名, 乱数 UUID 等）は Canonical diagnostics プロパティに必須として含めない。
3. **全フェーズ例外の即時 Fail-Closed 停止**:
   - `SESSION_FACTORY`、`POLICY_FACTORY`、`RUNNER` のいずれで例外が発生した場合も、エラーを握りつぶして試合レベル `FAILED` として特定個体の適応度へ流したり、個体を `INVALID` として自動淘汰したりしない。
   - **Runner 全体を `GenerationRunnerExecutionError` により Fail-Closed で即時停止** させる。
4. **実行中断と後続処理の完全遮断 (No Partial Result, Zero Leak)**:
   - 1 試合でも例外が発生した場合、直ちに実行が停止されるため、残余の予定試合は一切実行されない。
   - 部分的な戦績サマリー集約は行われず、`FitnessEvaluationSnapshot` は生成されず、`GenerationBuilder` は呼び出されず、次世代母集団は一切生成されない。
   - 障害発生は `REEVALUATION_REQUIRED`（論理的適応度証拠不足）ではなく、**実行時障害（Execution Failure）** として明確に区別される。
5. **正常完走時の全試合完了保証**:
   - したがって、Generation Runner が正常に `FitnessEvaluationSnapshot` の構築まで到達した場合、**全個体の全試合が `COMPLETED` または `INCOMPLETE` であり、`failedMatches === 0` が数学的・論理的に保証** される。

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
Generation Builder の例外から `readinessStatus` を後付け推測するのではなく、Runner 自身が Builder 呼出前に、事前解決済みの **`resolvedBuilderConfig.selectionConfig`** を用いて **`PopulationSelector.assessReadiness()`** を正式実行する:

```typescript
const readiness = PopulationSelector.assessReadiness(
  params.population,
  fitnessSnapshot,
  resolvedBuilderConfig.selectionConfig,
  evaluationContext
);
```

### 13.2 Effective Readiness Gate & Builder 呼出
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
  上記を満たし `readiness.status === "READY"` かつ `validCount >= effectiveRequiredCount` の場合のみ、事前解決済みの `resolvedBuilderConfig` を透過的に渡して `GenerationBuilder.buildNextGeneration()` を呼び出す:

```typescript
const buildResult = GenerationBuilder.buildNextGeneration({
  population: params.population,
  fitnessSnapshot,
  targetGeneration: params.population.generation + 1,
  generationSeed: params.generationSeed,
  config: resolvedBuilderConfig,
  expectedContext: evaluationContext,
});
```
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

### 15.1 エラー型と責務
1. **`GenerationRunnerConfigurationError`**:
   - 事前検証（Preflight Validation）で検出された設定不備（不正な `generationSeed`, 不正な `environment`, `populationSize < 2`, `pairRepetitions < 1`, `maxDecisionsPerMatch < 1`, 不正な `builderConfig`, `eliteCount >= populationSize`, 証拠不足等）を表す。
   - 対戦実行前に Fail-Fast で即時スローされる。
2. **`GenerationRunnerIntegrityError`**:
   - 内部計算の保存則違反、重複個体 ID、重複 `matchIndex`、結果件数不一致、または非互換コンテキスト等、システム論理の整合性破損を表す。
3. **`GenerationRunnerExecutionError`**:
   - 対戦実行ループ内の 3 フェーズ（`SESSION_FACTORY`, `POLICY_FACTORY`, `RUNNER`）における実行時例外、または Generation Builder からの予期せぬ実行時例外（Contract Drift）を表す。
   - 障害発生時の診断プロパティとして `phase`, `matchIndex`, `p1GenomeId`, `p2GenomeId`, `causeName`, `causeMessage` を保持する。
   - 決定論性を害する動的揮発性データ（timestamp, absolute path, hostname, UUID）は厳格に排除される。

```typescript
export type GenerationRunnerExecutionPhase =
  | "SESSION_FACTORY"
  | "POLICY_FACTORY"
  | "RUNNER";

export interface GenerationRunnerExecutionDiagnostics {
  readonly phase: GenerationRunnerExecutionPhase;
  readonly matchIndex: number;
  readonly p1GenomeId: string;
  readonly p2GenomeId: string;
  readonly causeName?: string;
  readonly causeMessage?: string;
}

export class GenerationRunnerExecutionError extends GenerationRunnerError {
  public readonly phase: GenerationRunnerExecutionPhase;
  public readonly matchIndex: number;
  public readonly p1GenomeId: string;
  public readonly p2GenomeId: string;
  public readonly causeName?: string;
  public readonly causeMessage?: string;

  public constructor(
    message: string,
    diagnostics: GenerationRunnerExecutionDiagnostics
  ) {
    super(message);
    this.name = "GenerationRunnerExecutionError";
    this.phase = diagnostics.phase;
    this.matchIndex = diagnostics.matchIndex;
    this.p1GenomeId = diagnostics.p1GenomeId;
    this.p2GenomeId = diagnostics.p2GenomeId;
    this.causeName = diagnostics.causeName;
    this.causeMessage = diagnostics.causeMessage;
  }
}
```

---

## 16. Canonical 60-Test Plan (検証テスト計画)

将来のプロダクション実装（`BP-SIM-AI-GENERATION-RUNNER-V1`）において検証すべき全 60 項目の Canonical Test Plan を R3 契約に合わせて改訂・確定する。

### Group A: Config & Context Validation (Tests 1–9)
1. `N >= 2` の有効母集団を受容すること。
2. `pairRepetitions` のデフォルト値が 1 であること。
3. `pairRepetitions <= 0` または非整数・非有限数を `GenerationRunnerConfigurationError` で reject すること。
4. **[R3 改訂] `maxDecisionsPerMatch` に不正な値（0、負数、小数、NaN、Infinity 等）が指定された場合、対戦実行前に `GenerationRunnerConfigurationError` で即時 reject すること。**
5. **[R3 改訂] `generationSeed = 0` および負の整数が合法なシードとして正しく受容され、小数（1.5 等の非整数）、NaN、Infinity 等の非有限シードは対戦実行前に `GenerationRunnerConfigurationError` で即時 reject されること。**
6. **[R2 改訂] `builderConfig.populationSize` に不正な値（< 2 または非整数）が指定された場合、対戦実行前に `GenerationRunnerConfigurationError` で即時 reject すること。**
7. **[R2 改訂] `builderConfig.selectionConfig` や `builderConfig.geneticOperatorConfig` に不正な値（範囲外の突然変異率、負の `eliteCount` 等）が指定された場合、対戦実行前に `GenerationRunnerConfigurationError` で即時 reject すること。**
8. **[R2 改訂] `builderConfig.selectionConfig.eliteCount >= resolvedPopulationSize` の設定不備を、対戦実行前に `GenerationRunnerConfigurationError` で即時 reject すること（`REEVALUATION_REQUIRED` ではなく事前設定エラーとして拒絶）。**
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
29. **[R3 改訂] 試合実行中の 3 フェーズ（`SESSION_FACTORY`, `POLICY_FACTORY`, `RUNNER`）のいずれかで例外が発生した場合、障害フェーズ（`phase`）および診断プロパティ（`matchIndex`, `p1GenomeId`, `p2GenomeId`, `causeName`）を保持した `GenerationRunnerExecutionError` で即座に Fail-Closed 停止すること。**
30. **[R3 改訂] 試合実行例外による中断時、残余試合は一切実行されず、部分的な戦績サマリー集約は行われず、`FitnessEvaluationSnapshot` や次世代母集団が一切生成されない（Zero Side-effect / Zero Leak）こと。**
31. 重複した `matchIndex` の結果が存在する場合、またはスケジュール計画数に対して実行結果が 1 件でも欠損している場合、`GenerationRunnerIntegrityError` で停止すること。
32. 試合結果の参加個体 ID と計画個体 ID が不一致の場合、`GenerationRunnerIntegrityError` で停止すること。

### Group E: Fitness Evaluation & Attribution (Tests 33–39)
33. 適応度評価が `FitnessEvaluator.evaluateParticipant()` へ正しく委譲されること。
34. 残りライフ（Remaining Life）が適応度計算に一切使用されていないこと。
35. ターン数（Turn Count）が適応度計算に一切使用されていないこと。
36. 実行所要時間（Duration / Latency）が適応度計算に一切使用されていないこと。
37. 全敗（wins = 0, draws = 0）の個体でも `VALID`（スコア 0.0）として適格保存されること。
38. **[R3 改訂] Generation Runner V1 が `sessionFactory`、`GenomePolicy`、または `SimulationRunner.run` の実行時例外を特定 Genome の `INVALID` として自動帰属せず、安全に Fail-Closed すること。また対戦完走時は全個体の `failedMatches === 0` が数学的・論理的に保証されること。**
39. 完了試合数不足の個体が `INSUFFICIENT_EVIDENCE`（適応度 null）となること。

### Group F: Readiness & Generation Transition (Tests 40–46)
40. 生成された `FitnessEvaluationSnapshot` の世代番号が $g$ と厳密に一致すること。
41. 母集団エントリと適応度エントリが完全な 1:1 対応を成していること。
42. **[R2 改訂] `GenerationBuilder` が目標世代 $g+1$ で正しく呼び出され、事前解決済みの `resolvedBuilderConfig` が完全かつ透過的に渡されること（Runner と Builder の設定不一致・Drift の防止）。**
43. `GenerationBuilder` へ同一の `generationSeed` が透過的に渡されること。
44. 正常遷移時、ステータス `ADVANCED` と世代 $g+1$ の母集団スナップショットが返却されること。
45. **[R2 改訂] Readiness Preflight により有効個体数不足（standard または effective: `max(requiredCount, eliteCount)`）を `resolvedBuilderConfig.selectionConfig` に基づき検出し、Builder を呼び出すことなく `status: "REEVALUATION_REQUIRED"` と完全な `SelectionReadiness` を返却すること。**
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
58. **[R2 改訂] モックやダミーではない本番シミュレーション経路（`sessionFactory` $\rightarrow$ `GenomePolicy` $\rightarrow$ `SimulationRunner.run`）の 3 フェーズが単一の Fail-Closed 実行境界下で順次実行されていること。**
59. **[R3 改訂] `resolveCanonicalBuilderConfig` がモジュール内部ヘルパーとして隠蔽され公開 API としてエクスポートされていないこと、および Generation Runner が個別のアクション名（`action.attack` 等）を直接解釈しないこと。**
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

### [Issue G] Builder Config をいつどのように解決・検証し、ドリフトを防ぐか？ (Finding 1 / Finding 3)
- **決定**: **Runner 開始時に `resolveCanonicalBuilderConfig()`（モジュール内部ヘルパー、非エクスポート）により事前解決し、`eliteCount < populationSize` を含めて対戦前に `GenerationRunnerConfigurationError` で検証する**。
- **根拠**: 対戦を何千試合も実行した後に Builder の設定エラーでクラッシュすることは計算資源の重大な浪費である。また、`eliteCount >= populationSize` は個体の実力不足による「再評価要求（`REEVALUATION_REQUIRED`）」ではなく明らかな設定不備である。事前解決した `resolvedBuilderConfig` を Readiness 評価および Builder 呼出にそのまま引き渡すことで、Runner と Builder 間の設定ドリフトを原理的に排除する。また、`resolveCanonicalBuilderConfig` は Runner 内部実装詳細であり、公開 API サーフェスには露出させない。

### [Issue H] 試合実行中の 3 フェーズ（Session生成、Policy生成、Runner実行）の例外をどう扱うか？ (Finding 2)
- **決定**: **3 フェーズ（`SESSION_FACTORY`, `POLICY_FACTORY`, `RUNNER`）すべてを単一の Fail-Closed `try / catch` で包括し、いかなる例外も即座に障害フェーズ識別子と診断情報（`matchIndex`, `p1GenomeId`, `p2GenomeId`, `causeName`）を付与した `GenerationRunnerExecutionError` としてスローして対戦を即時中断する**。
- **根拠**: 現行シミュレータには Failure Attribution 契約が存在せず、セッション生成やポリシー初期化、シミュレータ内部の例外を安全に特定 Genome の責任として `INVALID` 淘汰することはできない。1試合でも障害が発生した場合は残余試合を実行せず、中途半端な戦績集約や適応度スナップショット、次世代生成を一切行わず、クリーンに即時停止することが最善の堅牢性を保証する。また、動的揮発性データ（timestamp, absolute path, UUID 等）を診断情報から排除することで決定論的診断契約を保護する。

### [Issue I] `maxDecisionsPerMatch` と `generationSeed` の事前入力検証契約をどう定義するか？ (Finding 1)
- **決定**:
  - `maxDecisionsPerMatch`: 有限の正の整数（$\ge 1$）のみを受容。0、負数、小数、NaN、Infinity は対戦実行前に `GenerationRunnerConfigurationError` で Fail-Fast 拒絶する。
  - `generationSeed`: 有限の整数のみを受容。`0` および負の整数は合法。小数（1.5 等の非整数）、NaN、Infinity は対戦実行前に `GenerationRunnerConfigurationError` で Fail-Fast 拒絶する。
  - 事前検証順序: 1. `generationSeed`, 2. `environment`, 3. `population`, 4. `pairRepetitions`, 5. `maxDecisionsPerMatch`, 6. `fitnessConfig`, 7. `builderConfig`, 8. `eliteCount < target populationSize`, 9. Schedule evidence preflight。
- **根拠**: `SimulationRunner.run()` に渡される最大判断手数が不正な場合、対戦が未完了のまま誤って進行したり無限ループとなる恐れがある。また、シードの非有限数や小数はシード導出関数において NaN 汚染や契約破壊を引き起こす。全試合の実行を開始する前に厳格に Fail-Fast で拒絶することが必須である。

---

## 18. Future Scope (将来の展望と分離境界)

1. **BP-SIM-AI-GENERATION-RUNNER-V1**: 本 R3 設計書に基づく Generation Runner の TypeScript 実装および Canonical 60-Test のパス。
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
  PopulationSelectionConfig,
  PopulationSnapshot,
  SelectionReadiness,
} from "./PopulationSelectionTypes.js";
import {
  FitnessEvaluationConfig,
  DEFAULT_FITNESS_EVALUATION_CONFIG,
} from "./FitnessEvaluationTypes.js";
import {
  DEFAULT_GENERATION_BUILDER_CONFIG,
  GenerationBuilderConfig,
  GenerationBuildResult,
} from "./GenerationBuilderTypes.js";
import {
  GeneticOperatorConfig,
} from "./GeneticOperatorTypes.js";
import { GameSession } from "../session/GameSession.js";
import { BatchMatchContext } from "../simulation/BatchSimulationTypes.js";
import { PopulationSelector } from "./PopulationSelector.js";
import { validateGeneticOperatorConfig } from "./GeneticOperators.js";

export type GenerationRunnerExecutionPhase =
  | "SESSION_FACTORY"
  | "POLICY_FACTORY"
  | "RUNNER";

export interface GenerationRunnerExecutionDiagnostics {
  readonly phase: GenerationRunnerExecutionPhase;
  readonly matchIndex: number;
  readonly p1GenomeId: string;
  readonly p2GenomeId: string;
  readonly causeName?: string;
  readonly causeMessage?: string;
}

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
  public readonly phase: GenerationRunnerExecutionPhase;
  public readonly matchIndex: number;
  public readonly p1GenomeId: string;
  public readonly p2GenomeId: string;
  public readonly causeName?: string;
  public readonly causeMessage?: string;

  public constructor(
    message: string,
    diagnostics: GenerationRunnerExecutionDiagnostics
  ) {
    super(message);
    this.name = "GenerationRunnerExecutionError";
    this.phase = diagnostics.phase;
    this.matchIndex = diagnostics.matchIndex;
    this.p1GenomeId = diagnostics.p1GenomeId;
    this.p2GenomeId = diagnostics.p2GenomeId;
    this.causeName = diagnostics.causeName;
    this.causeMessage = diagnostics.causeMessage;
  }
}
```
