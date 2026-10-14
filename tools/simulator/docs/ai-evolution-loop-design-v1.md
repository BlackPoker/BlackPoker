# BlackPoker Simulator AI Evolution Loop V1 設計仕様書

作業ID: `BP-SIM-AI-EVOLUTION-LOOP-DESIGN-V1-R1`
ステータス: **PROPOSED / DESIGNED (PENDING INDEPENDENT REVIEW)**
改訂版数: V1-R1
作成日時: 2026-10-14  
対象ブランチ: `BlackPoker/issue551-core-flow`  

---

## 1. Status / Scope

### 1.1 ドキュメントステータス
本設計仕様書は、Formal Accepted 済みの単一世代実行エンジン `GenerationRunner`（BP-SIM-AI-GENERATION-RUNNER-V1）をプリミティブとして活用し、決定論的かつ Fail-Closed に複数世代の進化（$\text{Population}(g) \rightarrow \text{Population}(g+1) \rightarrow \text{Population}(g+2) \rightarrow \dots$）を統括する **Evolution Loop V1** のアーキテクチャ境界および設計仕様を定義するものである。

現時点のステータスは **PROPOSED / DESIGNED (PENDING INDEPENDENT REVIEW)** であり、独立レビューの完了まで Formal Accepted を宣言しない。

### 1.2 本改訂（V1-R1）の目的
前版 V1 の独立レビューにおいて指摘された以下の課題を是正する：
1. **プロセス遵守（Process Compliance）の厳格化**:
   - Host Node/npm/npx の完全排除（Docker コンテナ内のみ許可）。
   - 禁止内部パス（`.gemini/**`, `antigravity/brain/**`, `transcript*.jsonl` 等）への意図的アクセスの完全根絶。
   - PowerShell による書き込み・スクリプト生成の禁止（参照専用の徹底）。
   - 事実と乖離のない正確なコンプライアンス報告。
2. **母集団規模契約（Population Size Contract）の明確化**:
   - `EvolutionLoop` 自身は母集団サイズ（$N$）を固定・強制せず、Caller から渡された `runnerConfig` をそのまま各世代へ伝達する。
   - 世代交代に伴う母集団サイズの変化（例: $g0: N=6 \rightarrow g1: N=100$）をアーキテクチャ上合法とする。
   - 将来の Controlled Evidence（$N=6$, 3世代, 90試合）において、母集団サイズ $N=6$ が維持される根拠（Caller が `builderConfig.populationSize = 6` を明示すること）を契約上確定する。

### 1.3 本作業のスコープ境界
- **作業種別**: **DESIGN FOLLOW-UP ONLY**
- **Production 実装の禁止**: 本フェーズにおいて `EvolutionLoop.ts`, `EvolutionLoopTypes.ts` 等のソースコードの作成・変更は行わない。
- **テストコード作成の禁止**: `src/tests/ai/evolutionLoop.test.ts` 等の作成は行わない。
- **実対戦実行の禁止**: 複数世代実対戦、ベンチマーク実行、スケーリング検証は行わない。
- **将来実装予定ファイル**:
  - `tools/simulator/src/domain/ai/EvolutionLoopTypes.ts`
  - `tools/simulator/src/engine/ai/EvolutionLoop.ts`
  - `tools/simulator/src/tests/ai/evolutionLoop.test.ts`

---

## 2. Formal Prerequisites

本設計は、以下の Formal Accepted 済みコンポーネントおよびエビデンスを前提基盤として策定されている。

| コンポーネント / エビデンス | Formal ステータス | 確定コミット SHA | 概要 |
|---|---|---|---|
| **Generation Runner Design V1-R4** | **FORMAL ACCEPTED** | `c45478bd23822689718f4c82ccb6befb8731a873` | 1世代実行境界設計仕様書 (`ai-generation-runner-design-v1.md`) |
| **Generation Runner Production V1** | **FORMAL ACCEPTED** | `2587017da393bd9c96172d5772ea5e0be3ebdb59` | `GenerationRunner.ts`, `GenerationRunnerTypes.ts`, Canonical 60 Tests |
| **Controlled One-Generation Evidence V1-R1** | **FORMAL ACCEPTED** | `269017fcd0cdc3ce55e2c3021f8a06c4fd9e49c7` | Official light-entry16, $N=6$, $R=1$, 30 matches, $g=0 \rightarrow g=1$ 実機完走 |
| **N=100 Scale Evidence V1-R1** | **FORMAL ACCEPTED** | `0146f4ac6e071d8fd47f02e8f62f9dc37964ed30` | Official light-entry16, $N=100$, $R=1$, 9,900 matches, 19.93 min, 8.28 matches/sec, 780,786 decisions, 9,900 COMPLETED, $g=0 \rightarrow g=1$ 単独実機完走 |
| **Evolution Loop Design V1** | **SUPERSEDED BY R1** | `9809bb2bb3852d376be639b0a72f66dce2fd85ba` | 本仕様書により置換 |

Expected Start HEAD: `9809bb2bb3852d376be639b0a72f66dce2fd85ba`

---

## 3. Architecture Boundary

### 3.1 レイヤ構造と責務配置
Evolution Loop は、1世代実行プリミティブである `GenerationRunner` の上位に位置するオーケストレーション境界である。

```text
+-----------------------------------------------------------------------------------+
|                            EvolutionLoop (Orchestrator)                           |
|  - Loop Config Validation (generationCount >= 1, campaignSeed, SafeInteger)       |
|  - Generation Seed Schedule (deriveSeed(campaignSeed, streamKey))                 |
|  - Sequential Generation Invocation (g -> g+1 -> g+2 ...)                         |
|  - Generation Chain Integrity Verification (generation, buildResult, population)  |
|  - Immediate Logical Stop on REEVALUATION_REQUIRED                                |
|  - Deterministic History Assembly (No full intermediate Population duplication)   |
|  - Runtime Metrics Sidecar Separation                                             |
+-----------------------------------------------------------------------------------+
                                         │ calls GenerationRunner.run()
                                         ▼ (One Generation Only)
+-----------------------------------------------------------------------------------+
|                           GenerationRunner (1-Gen Primitive)                      |
|  - Double Round Robin Match Planning & Execution                                  |
|  - GameSession / SimulationRunner / GenomePolicy Orchestration                    |
|  - FitnessEvaluator (Outcome-First V1, MPA)                                       |
|  - PopulationSelector Readiness Preflight                                         |
|  - GenerationBuilder Next Generation Assembly                                     |
+-----------------------------------------------------------------------------------+
```

### 3.2 厳格な境界ルール
1. **GenerationRunner への一元委譲**:
   - `EvolutionLoop` は、対戦実行・適応度評価・親選択・世代交代のすべてを `GenerationRunner.run(...)` 経由でのみ実行する。
   - `EvolutionLoop` が直接 `SimulationRunner`, `GameSession`, `GenomePolicy`, `FitnessEvaluator`, `PopulationSelector`, `GenerationBuilder` を呼び出すことは厳格に禁止する。
2. **GenerationRunner 契約の不変維持 ("One Generation Only")**:
   - `GenerationRunner` に複数世代実行機能（`runMany`, `runEvolution` 等）を追加しない。
   - `GenerationRunner` は「入力された `PopulationSnapshot(g)` を評価し、適応度集計および次世代生成を行って `PopulationSnapshot(g+1)` を返す」単一世代実行責務に専念する。
3. **責務の非複製**:
   - `GenerationRunner` が所有するバリデーション（DNA の妥当性、ゲノムID重複、Fitness 設定、Builder 設定の解決など）を `EvolutionLoop` に重複実装しない。
   - `EvolutionLoop` はループ固有の入力条件および世代間チェーン整合性のみを検証する。

---

## 4. Public API

### 4.1 エントリポイント
`EvolutionLoop` は単一の明確な公開エントリポイントを提供する。

```typescript
export class EvolutionLoop {
  /**
   * 複数世代の自己対戦進化ループを決定論的・Fail-Closed に順次実行します。
   *
   * @param params 進化ループ実行パラメータ
   * @returns 総合実行結果 (決定論的論理結果 + 実行時メトリクス)
   * @throws EvolutionLoopConfigurationError ループ固有の静的設定が不正な場合
   * @throws EvolutionLoopIntegrityError 世代チェーン整合性契約に違反した場合
   * @throws GenerationRunnerError Runner から発生した例外 (そのまま透過)
   */
  public static run(params: RunEvolutionLoopParams): EvolutionLoopExecutionResult;
}
```

### 4.2 公開型定義
```typescript
/**
 * Evolution Loop の設定パラメータ
 */
export interface EvolutionLoopConfig {
  /** 実行対象の世代遷移数 (finite integer >= 1) */
  readonly generationCount: number;
  /** 各世代の GenerationRunner へ渡す設定オーバーライド */
  readonly runnerConfig?: Partial<GenerationRunnerConfig>;
}

/**
 * Evolution Loop の実行パラメータ
 */
export interface RunEvolutionLoopParams {
  /** 初期母集団スナップショット (g = initialPopulation.generation) */
  readonly initialPopulation: PopulationSnapshot;
  /** ループ全体の基準シード (finite integer, 0 / negative legal) */
  readonly campaignSeed: number;
  /** 全世代共通の不変実行環境コンテキスト */
  readonly environment: GenerationRunnerEnvironmentContext;
  /** 全世代共通の GameSession 生成ファクトリ */
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  /** ループ設定 */
  readonly config: EvolutionLoopConfig;
}
```

---

## 5. Configuration & Population Size Semantics

### 5.1 generationCount のセマンティクス
`generationCount` は **「実行したい世代遷移（Transition）数」** と定義する。

- 例 1: `initialPopulation.generation = 0`, `generationCount = 1`
  - $g=0$ を評価 $\rightarrow$ $g=1$ を生成（1 遷移）
  - 成功時の最終世代: $\text{finalPopulation.generation} = 1$
  - `GenerationRunner.run` 呼出回数: 1回
- 例 2: `initialPopulation.generation = 0`, `generationCount = 3`
  - $g=0 \rightarrow g=1 \rightarrow g=2 \rightarrow g=3$（3 遷移）
  - 成功時の最終世代: $\text{finalPopulation.generation} = 3$
  - `GenerationRunner.run` 呼出回数: 3回
- 目標世代の算出公式:
  $$\text{targetGeneration} = \text{initialPopulation.generation} + \text{generationCount}$$

### 5.2 generationCount のバリデーション & 安全な整数演算
- **許容型**: 有限な正の整数（`typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1`）
- **安全な整数範囲の検証**:
  JavaScript の `number` 型における整数オーバーフローを防止するため、目標世代番号が安全な整数の範囲内であることを検証する：
  ```typescript
  if (!Number.isSafeInteger(initialPopulation.generation + config.generationCount)) {
    throw new EvolutionLoopConfigurationError(
      `targetGeneration (${initialPopulation.generation + config.generationCount}) exceeds Number.MAX_SAFE_INTEGER`
    );
  }
  ```
- **拒絶対象**:
  - `0`: 拒絶（遷移なしのループ実行は無効）
  - 負の整数（`-1`, `-5` 等）: 拒絶
  - 小数（`1.5`, `2.1` 等）: 拒絶
  - `NaN`, `Infinity`, `-Infinity`: 拒絶
  - 非数値型（`string`, `null`, `undefined` 等）: 拒絶
- **アーキテクチャ上の上限**: 100 や 1000 といった恣意的な上限値は課さない。

### 5.3 campaignSeed のセマンティクスとバリデーション
`campaignSeed` は進化ループ全体のルート基準シードである。

- **許容型**: 有限な整数（`typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)`）
- **合法値**:
  - `0`: 合法
  - 負の整数（`-1`, `-42` 等）: 合法
  - 正の整数: 合法
- **拒絶対象**:
  - 小数（`42.5` 等）: 拒絶
  - `NaN`, `Infinity`, `-Infinity`: 拒絶
  - 非数値型: 拒絶

### 5.4 母集団規模セマンティクス（Population Size Contract）
Evolution Loop Core における母集団規模の取り扱い方針を以下のように厳格に定義する：

1. **EvolutionLoop によるサイズ不変性の非強制**:
   - `EvolutionLoop` 自身は、母集団サイズ（$N$）が世代間で一定であることを強制しない。
   - `initialPopulation.entries.length` と次世代の母集団サイズを一致させるために、`EvolutionLoop` が `runnerConfig` や `builderConfig` を自動的に書き換えることは厳格に禁止する。
2. **GenerationRunner / GenerationBuilder 契約の尊重**:
   - 母集団サイズの決定および変更は、`GenerationRunner` および `GenerationBuilder` の既存契約（`builderConfig.populationSize`）に従う。
   - `EvolutionLoop` は、Caller から渡された `runnerConfig` をそのまま全世代の `GenerationRunner.run` へ渡す。
3. **母集団サイズ変更の合法性（Variable Population Size is Legal）**:
   - 例えば、初期母集団が $N=6$ であり、`runnerConfig.builderConfig.populationSize = 100` が指定されていた場合：
     - 第 0 世代の対戦評価: $N=6$（30 試合）
     - 第 0 世代 $\rightarrow$ 第 1 世代の GenerationBuilder: $N=100$ を生成
     - 第 1 世代の対戦評価: $N=100$（9,900 試合）
     という遷移はアーキテクチャ上完全に合法である。
   - これはエラーではなく、設定された契約に忠実な実行結果として受容される。
4. **暗黙のサイズ一定仮定の排除**:
   - `EvolutionLoop` は `currentPopulation.entries.length === initialPopulation.entries.length` をループ完全性（Integrity）の条件としてはならない。
5. **母集団の不変性（No Size Mutation by Loop）**:
   - `EvolutionLoop` は母集団エントリの追加、削除、クローン再構成、水増し、切り捨て（truncate）を行わない。直前の Runner が生成した `nextPopulation` をそのまま次世代の入力として引き渡す。
6. **サイズ一定を望む場合の Caller 責務**:
   - キャンペーンにおいて全世代の母集団サイズを一定（例: $N=6$）に保ちたい場合、**Caller が `runnerConfig.builderConfig.populationSize = 6` を明示的に指定する責務を持つ**。

### 5.5 世代間の環境・設定の固定
Evolution Loop V1 において、以下の設定は全世代にわたって完全に固定される：
- **`environment`**: `environmentRef`, `regulationId`, `frameId`, `rulePackageVersion` は全世代不変。
- **`sessionFactory`**: ループ開始時に渡された同一ファクトリを全世代の Runner へ引き渡す。
- **`runnerConfig`**: `pairRepetitions`, `maxDecisionsPerMatch`, `fitnessConfig`, `builderConfig` は全世代不変。
- **カリキュラム学習の排除**: 世代ごとのルール変更、突然変異率の動的アニーリング、対戦スケジュール変更等のカリキュラム制御は V1 のスコープ外とする。

---

## 6. Generation Seed Schedule

### 6.1 シード派生設計と命名規則
各世代の `GenerationRunner` に渡す `generationSeed` は、既存の純粋関数 `deriveSeed(baseSeed, streamKey)`（FNV-1a 32-bit PRNG シード導出）を用いて算出する。

- **Canonical Stream Prefix**: `evolution-loop-generation-v1`
- **Canonical Stream Key 公式**:
  $$\text{streamKey} = \text{"evolution-loop-generation-v1-" + sourceGeneration}$$
- **Generation Seed 導出公式**:
  $$\text{generationSeed} = \text{deriveSeed}(\text{campaignSeed}, \text{"evolution-loop-generation-v1-" + sourceGeneration})$$
- **Loop Seed Schedule Identity**:
  $$\text{seedScheduleIdentity} = \text{"evolution-loop-generation-v1:campaign-seed=" + campaignSeed}$$

### 6.2 直接導出（Direct Derivation）の原則
各世代の `generationSeed` は、必ず `campaignSeed` と当該世代の `sourceGeneration` から**直接導出**する。

$$\text{seed}_{g} = \text{deriveSeed}(\text{campaignSeed}, \text{"evolution-loop-generation-v1-" + } g)$$

**厳格な禁止事項（Chaining の禁止）**:
前世代のシードから連鎖的に派生させる方式（例: $\text{seed}_{g+1} = \text{deriveSeed}(\text{seed}_{g}, \dots)$）は厳格に禁止する。

**直接導出を採用する設計根拠**:
1. **決定論的アドレス指定（Deterministic Addressing）**:
   `campaignSeed` と `sourceGeneration` の組が決定すれば、どの世代から開始しても、途中の世代を単独実行しても、常に同一の `generationSeed` が一意に確定する。
2. **将来のレジューム親和性**:
   前世代のシード状態をメモリやファイルから復旧・連鎖させる必要がなく、世代番号と基準シードのみで完全な再現性を維持できる。
3. **世代総数からの独立性**:
   `generationCount` が 1 であろうと 5 であろうと、第 0 世代の `generationSeed` は完全に一致する。

### 6.3 シード階層構造（Seed Hierarchy）
```text
campaignSeed (Loop Root)
  │
  ├─ deriveSeed(campaignSeed, "evolution-loop-generation-v1-0") ──> generationSeed (g=0)
  │     ├─ GenerationRunner 内部:
  │     │     └─ deriveSeed(generationSeed, "evolution-evaluation-pair-v1-p-r") ──> pairSeed
  │     └─ GenerationBuilder 内部:
  │           ├─ deriveSeed(generationSeed, "evolution-selection-v1") ──> selectionSeed
  │           └─ deriveSeed(generationSeed, "evolution-offspring-v1-i") ──> offspringSeed
  │
  ├─ deriveSeed(campaignSeed, "evolution-loop-generation-v1-1") ──> generationSeed (g=1)
  │     └─ ...
  │
  └─ deriveSeed(campaignSeed, "evolution-loop-generation-v1-2") ──> generationSeed (g=2)
        └─ ...
```

### 6.4 シード一意性に関する数学的制約
`deriveSeed` は 32-bit 符号なし整数（$0 \dots 2^{32}-1$）を返す。したがって、誕生日攻撃（Birthday Paradox）の原理に基づき、異なる世代番号であっても理論上シード値のハッシュ衝突（Collision）が発生する可能性はゼロではない。本設計では「全世代のシード値が数学的に必ずユニークである」という過剰な主張は行わない。

---

## 7. Canonical Seed Vectors

将来の実装テスト（Conformance Test）における厳密な期待値として、Node.js 実行環境で既存の `deriveSeed`（`src/engine/random/DeterministicShuffle.ts`）を用いて算出したテストベクトルを以下に記録する。

| campaignSeed | sourceGeneration | Stream Key | Canonical generationSeed (10進数) | Canonical generationSeed (16進数) |
|---|---|---|---|---|
| **42** | 0 | `evolution-loop-generation-v1-0` | `4143575905` | `0xf6f9f361` |
| **42** | 1 | `evolution-loop-generation-v1-1` | `4126798286` | `0xf5f9f1ce` |
| **42** | 2 | `evolution-loop-generation-v1-2` | `4110020667` | `0xf4f9f03b` |
| **0** | 0 | `evolution-loop-generation-v1-0` | `1656168205` | `0x62b71f0d` |
| **-1** | 0 | `evolution-loop-generation-v1-0` | `3416915273` | `0xcba9fd49` |

---

## 8. Loop Algorithm

### 8.1 擬似コードアルゴリズム
```typescript
function runEvolutionLoop(params: RunEvolutionLoopParams): EvolutionLoopExecutionResult {
  const startTime = Date.now();

  // 1. ループ静的入力検証
  validateEvolutionLoopConfig(params.config);
  validateCampaignSeed(params.campaignSeed);

  const initialGeneration = params.initialPopulation.generation;
  const requestedTransitions = params.config.generationCount;
  const targetGeneration = initialGeneration + requestedTransitions;

  if (!Number.isSafeInteger(targetGeneration)) {
    throw new EvolutionLoopConfigurationError(
      `targetGeneration (${targetGeneration}) exceeds Number.MAX_SAFE_INTEGER`
    );
  }

  const manifest: EvolutionLoopManifest = {
    initialGeneration,
    requestedTransitions,
    targetGeneration,
    campaignSeed: params.campaignSeed,
    generationSeedScheduleIdentity: `evolution-loop-generation-v1:campaign-seed=${params.campaignSeed}`,
  };

  let currentPopulation = params.initialPopulation;
  const generationRecords: EvolutionGenerationRecord[] = [];
  const runtimeRecords: EvolutionGenerationRuntimeRecord[] = [];

  // 2. 世代遷移順次実行ループ
  for (let stepIndex = 0; stepIndex < requestedTransitions; stepIndex++) {
    const sourceGeneration = currentPopulation.generation;
    const generationSeed = deriveSeed(
      params.campaignSeed,
      `evolution-loop-generation-v1-${sourceGeneration}`
    );

    // Runner 呼出 (One-Generation Primitive)
    // runnerConfig は caller 指定のまま無改変で渡す
    const runnerResult = GenerationRunner.run({
      population: currentPopulation,
      generationSeed,
      environment: params.environment,
      sessionFactory: params.sessionFactory,
      config: params.config.runnerConfig,
    });

    const { logicalResult, runtimeMetrics } = runnerResult;

    // 世代チェーン整合性の検証
    verifyGenerationChainIntegrity(sourceGeneration, logicalResult);

    // 実行時レコードの記録
    runtimeRecords.push({
      stepIndex,
      sourceGeneration,
      generationSeed,
      runnerMetrics: runtimeMetrics,
    });

    // 3. REEVALUATION_REQUIRED 検知時の即時論理停止
    if (logicalResult.status === "REEVALUATION_REQUIRED") {
      generationRecords.push({
        status: "REEVALUATION_REQUIRED",
        stepIndex,
        sourceGeneration,
        generationSeed,
        manifest: logicalResult.manifest,
        fitnessSnapshot: logicalResult.fitnessSnapshot,
        reason: logicalResult.reason,
        readiness: logicalResult.readiness,
      });

      const loopLogicalResult: EvolutionLoopReevaluationRequiredResult = {
        status: "REEVALUATION_REQUIRED",
        manifest,
        completedTransitions: stepIndex,
        finalPopulation: currentPopulation,
        generations: generationRecords,
        reason: logicalResult.reason,
        readiness: logicalResult.readiness,
      };

      const loopRuntimeMetrics: EvolutionLoopRuntimeMetrics = {
        totalExecutionTimeMs: Date.now() - startTime,
        generations: runtimeRecords,
      };

      return {
        logicalResult: loopLogicalResult,
        runtimeMetrics: loopRuntimeMetrics,
      };
    }

    // 4. ADVANCED 正常遷移時の処理
    const { buildResult } = logicalResult;

    generationRecords.push({
      status: "ADVANCED",
      stepIndex,
      sourceGeneration,
      targetGeneration: logicalResult.nextPopulation.generation,
      generationSeed,
      manifest: logicalResult.manifest,
      fitnessSnapshot: logicalResult.fitnessSnapshot,
      buildMetadata: {
        sourceGeneration: buildResult.sourceGeneration,
        targetGeneration: buildResult.targetGeneration,
        generationSeed: buildResult.generationSeed,
        selectionSeed: buildResult.selectionSeed,
        populationSize: buildResult.populationSize,
        eliteCount: buildResult.eliteCount,
        offspringCount: buildResult.offspringCount,
        eliteGenomeIds: buildResult.eliteGenomeIds,
        offspringLineages: buildResult.offspringLineages,
      },
    });

    // 次世代母集団へ更新 (サイズ変更があってもそのまま継承)
    currentPopulation = logicalResult.nextPopulation;
  }

  // 5. 全世代正常完了結果の返却
  const loopLogicalResult: EvolutionLoopCompletedResult = {
    status: "COMPLETED",
    manifest,
    completedTransitions: requestedTransitions,
    finalPopulation: currentPopulation,
    generations: generationRecords,
  };

  const loopRuntimeMetrics: EvolutionLoopRuntimeMetrics = {
    totalExecutionTimeMs: Date.now() - startTime,
    generations: runtimeRecords,
  };

  return {
    logicalResult: loopLogicalResult,
    runtimeMetrics: loopRuntimeMetrics,
  };
}
```

---

## 9. REEVALUATION_REQUIRED Semantics

### 9.1 論理停止（Logical Stop）の原則
`GenerationRunner` が `REEVALUATION_REQUIRED` を返した場合（有効個体数不足などにより安全な次世代選択・生成が行えない状態）：
- **例外（Exception）ではない**: これはアルゴリズムの制御フローとして想定された正常な論理結果であり、例外を throw してプロセスを異常終了させてはならない。
- **即時停止**: ループは直ちに停止し、それ以降の世代（`stepIndex + 1` 以降）の `GenerationRunner.run` は一切呼び出さない。

### 9.2 自動リトライの厳格な禁止
`EvolutionLoop` は、`REEVALUATION_REQUIRED` を受けて以下のような「自己都合の自動リトライや回復」を行ってはならない：
1. 同一母集団を別のシード値で勝手に再評価する
2. 反復回数 $R$（`pairRepetitions`）や最大手数（`maxDecisionsPerMatch`）を自動的に増やして再実行する
3. 適応度評価の閾値（`minimumCompletedMatches`, `minimumCompletionRate` 等）を自動的に緩和する
4. エリート個体を水増ししたり、不適格個体を繰り上げて無理に次世代を生成する
5. 母集団サイズ（`populationSize`）を勝手に変更して救済する

### 9.3 完了遷移数と最終母集団の保証
- **`completedTransitions`**: 正常に `ADVANCED` を達成した先行ステップ数を正確に記録する（例: $g0 \rightarrow g1$ 成功後に $g1$ で停止した場合、`completedTransitions = 1`）。
- **`finalPopulation`**: 最後に正常に生成された母集団（第 0 世代で停止した場合は初期母集団 `initialPopulation`）を保持し、その世代番号は `sourceGeneration` と厳密に一致する。

---

## 10. Error Taxonomy

### 10.1 エラー階層構造
Evolution Loop レイヤ固有のエラー型は以下の2種のみとし、Runner の実行時エラーは既存のエラー型をそのまま透過させる。

```text
Error
  │
  ├─ GenerationRunnerError (既存)
  │     ├─ GenerationRunnerConfigurationError (静的設定不備)
  │     ├─ GenerationRunnerIntegrityError (内部整合性・契約不整合)
  │     └─ GenerationRunnerExecutionError (実在試合の実行時障害)
  │
  └─ EvolutionLoopError (新規基底エラー)
        ├─ EvolutionLoopConfigurationError (ループ固有の静的設定不備)
        └─ EvolutionLoopIntegrityError (世代間チェーン整合性違反)
```

### 10.2 各エラー型の責務境界
1. **`EvolutionLoopConfigurationError`**:
   - `generationCount` が正の整数でない（0, 負数, 小数, NaN, Infinity）。
   - `campaignSeed` が有限な整数でない（小数, NaN, Infinity）。
   - `initialGeneration + generationCount` が安全な整数の範囲外（`!Number.isSafeInteger`）。
2. **`EvolutionLoopIntegrityError`**:
   - `GenerationRunner` が返した結果が世代チェーン契約と矛盾している場合（後述の Chain Integrity 参照）。
3. **`GenerationRunnerError` の透過伝搬**:
   - `GenerationRunner` が throw した `GenerationRunnerConfigurationError`, `GenerationRunnerIntegrityError`, `GenerationRunnerExecutionError` は、`EvolutionLoop` で catch して別の例外に再分類したり、ダミーの診断情報（`matchIndex = -1` 等）へ再ラップしたりせず、**そのまま上位へ throw** する。
   - 例外発生時は中途半端な部分成功結果（Partial Logical Result）を返さず、確実にフェイルクローズする。

---

## 11. Chain Integrity

### 11.1 世代チェーン検証ルール
各ステップにおいて `GenerationRunner.run` から正常に結果が返った直後、`EvolutionLoop` は以下の契約を厳格に検証する。違反が検知された場合は即座に `EvolutionLoopIntegrityError` を throw して停止する。

1. **Manifest Generation 照合**:
   $$\text{runnerResult.logicalResult.manifest.generation} === \text{sourceGeneration}$$
2. **Fitness Snapshot Generation 照合**:
   $$\text{runnerResult.logicalResult.fitnessSnapshot.generation} === \text{sourceGeneration}$$
3. **ADVANCED 時の次世代番号照合**:
   $$\text{runnerResult.logicalResult.nextPopulation.generation} === \text{sourceGeneration} + 1$$
4. **ADVANCED 時の Builder Source Generation 照合**:
   $$\text{runnerResult.logicalResult.buildResult.sourceGeneration} === \text{sourceGeneration}$$
5. **ADVANCED 時の Builder Target Generation 照合**:
   $$\text{runnerResult.logicalResult.buildResult.targetGeneration} === \text{sourceGeneration} + 1$$
6. **ADVANCED 時の Builder Population Size 照合**:
   $$\text{runnerResult.logicalResult.buildResult.populationSize} === \text{runnerResult.logicalResult.nextPopulation.entries.length}$$
7. **ADVANCED 時の Population オブジェクト同一性照合**:
   $$\text{runnerResult.logicalResult.buildResult.population} === \text{runnerResult.logicalResult.nextPopulation}$$

---

## 12. Logical Result

### 12.1 論理結果のデータ構造
```typescript
/**
 * 進化ループ全体の論理マニフェスト (完全決定論的)
 */
export interface EvolutionLoopManifest {
  readonly initialGeneration: number;
  readonly requestedTransitions: number;
  readonly targetGeneration: number;
  readonly campaignSeed: number;
  readonly generationSeedScheduleIdentity: string;
}

/**
 * 世代遷移が要求数すべて完了した論理結果
 */
export interface EvolutionLoopCompletedResult {
  readonly status: "COMPLETED";
  readonly manifest: EvolutionLoopManifest;
  readonly completedTransitions: number;
  readonly finalPopulation: PopulationSnapshot;
  readonly generations: readonly EvolutionGenerationRecord[];
}

/**
 * 途中で評価不足により停止した論理結果
 */
export interface EvolutionLoopReevaluationRequiredResult {
  readonly status: "REEVALUATION_REQUIRED";
  readonly manifest: EvolutionLoopManifest;
  readonly completedTransitions: number;
  readonly finalPopulation: PopulationSnapshot;
  readonly generations: readonly EvolutionGenerationRecord[];
  readonly reason: string;
  readonly readiness: SelectionReadiness;
}

/**
 * Evolution Loop の決定論的論理結果型 (Deep Equal 保証対象)
 */
export type EvolutionLoopLogicalResult =
  | EvolutionLoopCompletedResult
  | EvolutionLoopReevaluationRequiredResult;
```

### 12.2 不変条件（Invariants）
- **`COMPLETED` 時**:
  - `completedTransitions === manifest.requestedTransitions`
  - `generations.length === manifest.requestedTransitions`
  - 全ての `generations` レコードのステータスが `"ADVANCED"`
  - `finalPopulation.generation === manifest.targetGeneration`
- **`REEVALUATION_REQUIRED` 時**:
  - 末尾の `generations` レコードのステータスが `"REEVALUATION_REQUIRED"`
  - `completedTransitions === preceding ADVANCED records count`
  - `finalPopulation.generation === sourceGeneration of failed step`

---

## 13. Generation History

### 13.1 メモリ爆発防止と中間母集団の排除
進化ループが多世代に及ぶ場合、各世代の母集団（`PopulationSnapshot`）全体を履歴配列に保持し続けると、DNA 配列（数万次元）とメタデータによってメモリ消費量（Heap Used）が世代数に比例して増大し、Out Of Memory のリスクが高まる。

**設計決定**:
- 各世代の履歴レコード（`EvolutionGenerationRecord`）には、**`PopulationSnapshot` を保持しない**。
- `finalPopulation` のみをルート結果の最上位に保持する。
- 中間世代の評価結果・選択結果・系統情報（Lineage）は、スリムなメタデータとして保持する。

### 13.2 世代履歴レコード型定義
```typescript
/**
 * ADVANCED 成功時の世代履歴レコード
 */
export interface EvolutionGenerationAdvancedRecord {
  readonly status: "ADVANCED";
  readonly stepIndex: number;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly generationSeed: number;
  readonly manifest: GenerationEvaluationManifest;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly buildMetadata: {
    readonly sourceGeneration: number;
    readonly targetGeneration: number;
    readonly generationSeed: number;
    readonly selectionSeed: number;
    readonly populationSize: number;
    readonly eliteCount: number;
    readonly offspringCount: number;
    readonly eliteGenomeIds: readonly string[];
    readonly offspringLineages: readonly OffspringLineageMetadata[];
  };
}

/**
 * REEVALUATION_REQUIRED 停止時の世代履歴レコード
 */
export interface EvolutionGenerationReevaluationRecord {
  readonly status: "REEVALUATION_REQUIRED";
  readonly stepIndex: number;
  readonly sourceGeneration: number;
  readonly generationSeed: number;
  readonly manifest: GenerationEvaluationManifest;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly reason: string;
  readonly readiness: SelectionReadiness;
}

export type EvolutionGenerationRecord =
  | EvolutionGenerationAdvancedRecord
  | EvolutionGenerationReevaluationRecord;
```

---

## 14. Runtime Sidecar

### 14.1 実行時メトリクスの分離
論理結果（`EvolutionLoopLogicalResult`）と非決定論的な実行時計測値（`EvolutionLoopRuntimeMetrics`）を完全に分離する。

```typescript
/**
 * 単一世代の実行時メトリクスレコード
 */
export interface EvolutionGenerationRuntimeRecord {
  readonly stepIndex: number;
  readonly sourceGeneration: number;
  readonly generationSeed: number;
  readonly runnerMetrics?: GenerationRunnerRuntimeMetrics;
}

/**
 * ループ全体の実行時メトリクスコンテナ
 */
export interface EvolutionLoopRuntimeMetrics {
  readonly totalExecutionTimeMs: number;
  readonly generations: readonly EvolutionGenerationRuntimeRecord[];
}

/**
 * Evolution Loop 総合実行結果
 */
export interface EvolutionLoopExecutionResult {
  readonly logicalResult: EvolutionLoopLogicalResult;
  readonly runtimeMetrics: EvolutionLoopRuntimeMetrics;
}
```

### 14.2 実行時フィードバックの禁止（No Runtime Feedback）
実行時間、秒間試合数（matches/sec）、CPU 負荷、ヒープメモリ使用量などの実行時テレメトリを、アルゴリズムの制御（世代停止、突然変異率の変更、対戦数の削減、母集団サイズの縮小等）へ入力・フィードバックすることは厳格に禁止する。進化の挙動はシード値と論理入力のみによって100%決定されなければならない。

---

## 15. Determinism Boundary

### 15.1 決定論的等価性の保証（Deep Equal Guarantee）
同一の Supported Deterministic Runtime（同一 Node.js バージョン、同一アーキテクチャ）において、以下の条件が同一であれば、`EvolutionLoopLogicalResult` はビットレベルで完全一致（Deep Equal / JSON Round-trip 一致）する。

1. 同一の実装コード
2. 同一の `initialPopulation`（DNA 重み、メタデータ、配列順序）
3. 同一の `campaignSeed`
4. 同一の `environment`
5. 同一の決定論的 `sessionFactory`
6. 同一の `runnerConfig`
7. 同一の `generationCount`

### 15.2 論理結果からの非決定論的要素の排除
`EvolutionLoopLogicalResult` には、以下の非決定論的要素を一切含めない：
- `Date.now()`, `new Date()` 等のタイムスタンプ
- `performance.now()` 等の経過時間計測値
- ランダム UUID
- 実行ホスト名、プロセス ID、ファイルシステムの絶対パス

---

## 16. Fitness / Context Boundary

### 16.1 Fitness は Generation-Local である原則
適応度スコア（`fitnessScore`）は、**「その世代内の対戦環境において、当該母集団内の個体間で相対的に選考を行うため」** にのみ存在する。

**厳格な禁止事項**:
- **世代間スコア比較の禁止**: 第 0 世代の Fitness 0.65 と第 5 世代の Fitness 0.70 を直接比較して「能力が向上した」と判断するロジックを Loop Core に実装してはならない。
- **世代間ランキングの禁止**: 異なる世代の個体を同一の適応度ランキングでソートしてはならない。
- **収束判定・改善率計算の禁止**: `fitnessDelta`, `improvementRate`, `convergenceStagnation` などの指標をループ制御やコア結果に含めてはならない。

### 16.2 評価目的の純粋性（Victory is the Objective）
`GenerationRunner` および `FitnessEvaluator` の設計原則を継承し、以下の要素を評価指標（Fitness）に混入させてはならない：
- 残りライフ（Remaining Life）
- 与ダメージ／被ダメージ
- ターン数／試合時間
- 特定カード／特定アクションの使用頻度

勝利（Outcome: 勝敗）のみを目的関数とし、ライフや手札は目的ではなく勝利のためのリソースとして扱う。

---

## 17. Out of Scope

以下の機能は、Evolution Loop V1 では明示的にスコープ外（Future Scope）とする：
1. **Parallel Evaluation**: マルチスレッド（Worker Threads）、マルチプロセス、分散並列対戦。
2. **Hall of Fame**: 歴代最強個体や Baseline AI を集積した殿堂プールの管理。
3. **Rating Systems**: Elo レーティング、Glicko レーティング、TrueSkill の算出。
4. **Persistence & Checkpoint**: データベース、ローカルファイルへの自動永続化、中断・再開（Resume）。
5. **Auto Retry**: 評価不足時やエラー時の自動リトライ。
6. **Dynamic Curriculum**: 世代進行に伴う対戦相手プール動的変更、突然変異スケジュール。
7. **Cancellation / AbortSignal**: 外部シグナルによる安全な非同期中断。
8. **UI / Progress Bar / Console Logging**: コアエンジンへの表示・進捗ログの混入。

---

## 18. Canonical 48 Tests

将来の Production 実装（`BP-SIM-AI-EVOLUTION-LOOP-V1`）において実装すべきカノニカルな 48 のテストケースを以下に定義する。テスト件数は 48 件を厳格に維持する。

### Group A — Config & Seed Validation (Tests 1–10)
- **Test 1**: `generationCount = 1` が正常に受容されること。
- **Test 2**: `generationCount = 0` が `EvolutionLoopConfigurationError` で拒絶されること。
- **Test 3**: `generationCount` が負の数の場合、`EvolutionLoopConfigurationError` で拒絶されること。
- **Test 4**: `generationCount` が小数、`NaN`, `Infinity` の場合、`EvolutionLoopConfigurationError` で拒絶されること。
- **Test 5**: `campaignSeed = 0` が合法なシードとして受容されること。
- **Test 6**: `campaignSeed` が負の整数の場合、合法なシードとして受容されること。
- **Test 7**: `campaignSeed` が小数、`NaN`, `Infinity` の場合、`EvolutionLoopConfigurationError` で拒絶されること。
- **Test 8**: `targetGeneration` が `initialGeneration + generationCount` と等しく、かつ `!Number.isSafeInteger` の場合に `EvolutionLoopConfigurationError` で拒絶されること。
- **Test 9**: Canonical な Generation Stream Key（`evolution-loop-generation-v1-${g}`）が正確に生成されること。
- **Test 10**: Canonical Seed Vectors（42, 0, -1）の導出結果が設計書第7章の値と完全一致すること。

### Group B — Seed Schedule Contract (Tests 11–17)
- **Test 11**: 同一の `campaignSeed` かつ同一の `sourceGeneration` からは常に同一の `generationSeed` が得られること。
- **Test 12**: `generationSeed` が `campaignSeed` と `sourceGeneration` から直接導出されること。
- **Test 13**: `generationSeed` が前世代のシード値に一切依存（Chaining）しないこと。
- **Test 14**: `generationSeed` のスケジュールが要求された `generationCount` の大きさに影響されないこと。
- **Test 15**: $g=2$ から開始したループの $g=2$ シード値と、$g=0$ から $g=2$ に到達したループの $g=2$ シード値が完全一致すること。
- **Test 16**: Loop Seed Schedule Identity（`evolution-loop-generation-v1:campaign-seed=${campaignSeed}`）が正確であること。
- **Test 17**: シード値の一意性に関する過剰な前提（衝突が絶対に起きないという仮定）がコード上に埋め込まれていないこと。

### Group C — Successful Multi-Generation Transition & Population Contract (Tests 18–27)
- **Test 18**: `generationCount = 1` の場合、`GenerationRunner.run` が正確に1回呼び出されること。
- **Test 19**: `generationCount = 3` の場合、`GenerationRunner.run` が正確に3回順次呼び出されること。
- **Test 20**: 各ステップの Runner 呼出において、`population.generation` が $g, g+1, g+2$ と順次進むこと。
- **Test 21**: 全ての Runner 呼出に対して同一の `environment` コンテキストが渡されること。
- **Test 22**: 全ての Runner 呼出に対して同一の `sessionFactory` が渡されること。
- **Test 23**: 全ての Runner 呼出に対して同一の `runnerConfig` が無改変で渡され、`EvolutionLoop` が `runnerConfig.builderConfig.populationSize` を自動変更・上書き・補完しないこと。
- **Test 24**: 前世代の `nextPopulation` がそのまま次世代の入力 `population` として直接渡され、Builder 設定により母集団サイズ $N$ が変化した場合（例: 初期 $N=2$ から Builder target $N=3$ への遷移）であっても、生成された $N=3$ の `nextPopulation` がそのまま次の世代の入力となり、`EvolutionLoop` が初期サイズ $N=2$ へ戻したり truncate/水増ししたりしないこと。
- **Test 25**: `COMPLETED` 結果の `finalPopulation.generation` が `targetGeneration` と厳密に一致すること。
- **Test 26**: `generations` 履歴配列の長さが `generationCount` と厳密に一致すること。
- **Test 27**: 渡された `initialPopulation` オブジェクトが変更されず不変（Immutable）を維持していること。

### Group D — REEVALUATION_REQUIRED Logical Stop (Tests 28–34)
- **Test 28**: 第 0 世代の評価で `REEVALUATION_REQUIRED` が返った場合、ループが即座に論理停止すること。
- **Test 29**: 1世代目が `ADVANCED`、2世代目が `REEVALUATION_REQUIRED` の場合、`completedTransitions = 1` となること。
- **Test 30**: `REEVALUATION_REQUIRED` 発生時に自動的な再実行（Retry）が行われないこと。
- **Test 31**: `REEVALUATION_REQUIRED` 発生時に別シードでの再試行が行われないこと。
- **Test 32**: 停止後の後続世代に対して `GenerationRunner.run` が呼び出されないこと。
- **Test 33**: 停止理由（`reason`）および選考準備状況（`readiness`）が結果オブジェクトへ正確に転記されること。
- **Test 34**: 停止時の `finalPopulation` が直近に成功した未評価母集団（または初期母集団）と一致すること。

### Group E — Integrity Verification & Error Propagation (Tests 35–40)
- **Test 35**: Runner 結果の `manifest.generation` が `sourceGeneration` と不一致の場合、`EvolutionLoopIntegrityError` が発生すること。
- **Test 36**: Runner 結果の `fitnessSnapshot.generation` が `sourceGeneration` と不一致の場合、`EvolutionLoopIntegrityError` が発生すること。
- **Test 37**: `ADVANCED` なのに `nextPopulation.generation !== sourceGeneration + 1` の場合、`EvolutionLoopIntegrityError` が発生すること。
- **Test 38**: `buildResult` の世代番号が不整合、または `buildResult.populationSize !== nextPopulation.entries.length` の場合、`EvolutionLoopIntegrityError` が発生すること。
- **Test 39**: Runner が `GenerationRunnerExecutionError` を throw した場合、そのまま透過して上位へ伝搬すること。
- **Test 40**: Runner が `GenerationRunnerConfigurationError` または `GenerationRunnerIntegrityError` を throw した場合、そのまま透過して上位へ伝搬すること。

### Group F — History, Determinism & Boundaries (Tests 41–48)
- **Test 41**: `generations` 履歴レコードが `fitnessSnapshot`, `manifest`, `buildMetadata` を正確に保持していること。
- **Test 42**: `generations` 履歴レコードが中間世代の `PopulationSnapshot` を保持せずメモリを浪費しないこと。
- **Test 43**: 最終世代の母集団（`finalPopulation`）のみがルート結果に保持されること。
- **Test 44**: 実行時メトリクス（`runtimeMetrics`）が論理結果の Deep Equal 比較から完全に分離されていること。
- **Test 45**: 同一の決定論的入力に対して、再実行時の論理結果が 100% Deep Equal であること。
- **Test 46**: 論理結果オブジェクト内にタイムスタンプ、経過ミリ秒、UUID が一切含まれていないこと。
- **Test 47**: コアエンジン内に世代間適応度比較、早期終了、実行時フィードバックが存在しないこと。
- **Test 48**: `EvolutionLoop` が `GenerationRunner` のみを実行プリミティブとして呼び出し、`SimulationRunner` や `GameSession` を直接オーケストレーションしていないこと。

---

## 19. Future N=6 Controlled Evidence Specification

本設計が Formal Accepted となり、Production 実装およびテストが完了した後の最初の実機エビデンス計画を以下のように定義する（**現フェーズでは実行しない**）。

- **環境規約**: `light-entry16`
- **初期母集団規模**: $N = 6$
- **初期世代**: $g = 0$
- **要求世代遷移数**: `generationCount = 3`（目標世代 $g = 3$）
- **基準シード**: `campaignSeed = 42`
- **対戦スケジュール**: Double Round Robin ($R = 1$)
- **最大手数**: `maxDecisionsPerMatch = 500`
- **Runner Config 指定**:
  ```typescript
  runnerConfig: {
    pairRepetitions: 1,
    maxDecisionsPerMatch: 500,
    builderConfig: {
      populationSize: 6,
    },
  }
  ```
  ※ `GenerationRunner` の `resolveCanonicalBuilderConfig` 契約により、トップレベル partial で `populationSize: 6` を指定することで、デフォルトの選択設定（$k=3, E=1$）および遺伝操作設定を維持したまま、次世代母集団サイズを 6 に固定する。
- **対戦数および母集団規模の成立根拠（Conditional Wording）**:
  「本エビデンスでは Caller が `runnerConfig.builderConfig.populationSize = 6` を明示的に固定するため、全世代が `ADVANCED` した場合、各世代の評価対象母集団サイズは $N=6$ を維持し、1世代あたり 30 試合（$6 \times 5 \times 1 = 30$）、3 遷移で合計 90 試合となる」
- **初期母集団 DNA（Initial DNA）**:
  本エビデンスの目的は強度評価ではなくループセマンティクス（決定論性、整合性、遷移制御）の実機実証であるため、`DecisionDNACodec.createZeroDecisionDNA` 等を用いた決定論的なベースライン個体群（deterministic valid baseline population）を使用する。
- **期待値（全世代 ADVANCED 時）**:
  - `GenerationRunner` 呼出回数: 3 回
  - 1世代あたりの対戦数: 30 試合
  - 総実対戦数: 90 試合
  - 最終到達世代: $g = 3$
- **決定論性検証**: 同一条件で Run A と Run B を実行し、`EvolutionLoopLogicalResult` の 100% Deep Equal を検証する。

---

## 20. Future Extensions

以下の項目は、将来のフェーズ（Phase 4.1 以降）において検討可能な拡張事項である：
1. **Parallel GenerationRunner Evaluation**:
   - `GenerationRunner` 内部の対戦ループを Worker Threads 等で並列化する拡張。`EvolutionLoop` の世代直列性契約を壊さずにスループットを向上可能。
2. **Deterministic Checkpoint & Resume V1**:
   - `finalPopulation` と `campaignSeed`、および到達世代番号を決定論的 JSON アーティファクトとして保存し、途中から再開する機能。直接導出シードスケジュールにより最小のオーバーヘッドで実現可能。
3. **Hall of Fame V1**:
   - 各世代のエリート個体や特定基準を満たしたゲノムを不変アーカイブとして保存し、定期的に世代内対戦のベンチマーク相手としてサンプリングする機能。
4. **Curriculum Learning & Dynamic Schedules**:
   - レギュレーションや対戦相手分布を世代ごとに段階的に引き上げる拡張（別の上位メタコントローラとして分離設計）。
