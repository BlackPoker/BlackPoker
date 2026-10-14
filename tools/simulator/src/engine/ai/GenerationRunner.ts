/**
 * Generation Runner V1 Engine (BP-SIM-AI-GENERATION-RUNNER-DESIGN-V1-R4 / BP-SIM-AI-GENERATION-RUNNER-V1)
 *
 * BlackPoker Simulator AI 基盤における 1 世代実行境界エンジン。
 * PopulationSnapshot(g) から Double Round Robin 自己対戦評価、Outcome 集計、
 * 適応度評価、Readiness 事前判定、および GenerationBuilder を通じた
 * 次世代母集団 PopulationSnapshot(g+1) への遷移を決定論的・Fail-Closed に統括する。
 *
 * 設計仕様: tools/simulator/docs/ai-generation-runner-design-v1.md
 *
 * 最重要設計原則:
 * 1. One Generation Only (1 世代遷移のみに責務を限定し、Evolution Loop は持たない)
 * 2. 決定論性 (Supported Deterministic Runtime 完全一致、Deep Equal 保証)
 * 3. 統一試合実行境界 (SESSION_FACTORY, POLICY_FACTORY, RUNNER の単一 Fail-Closed 境界)
 * 4. エラー責務境界の分離 (Configuration / Integrity / ExecutionError 実在試合専用)
 * 5. Builder Contract Drift の IntegrityError へのマッピング (ダミー試合診断の排除)
 * 6. Builder Config 事前解決と設定ドリフトの根絶
 * 7. 論理結果と実行時メトリクスの完全分離
 */

import {
  DEFAULT_GENERATION_RUNNER_CONFIG,
  GenerationEvaluationManifest,
  GenerationEvaluationMatch,
  GenerationMatchOutcome,
  GenerationRunnerAdvancedResult,
  GenerationRunnerConfigurationError,
  GenerationRunnerExecutionDiagnostics,
  GenerationRunnerExecutionError,
  GenerationRunnerExecutionPhase,
  GenerationRunnerExecutionResult,
  GenerationRunnerIntegrityError,
  GenerationRunnerLogicalResult,
  GenerationRunnerReevaluationRequiredResult,
  GenerationRunnerRuntimeMetrics,
  RunGenerationParams,
  canonicalEvaluationScheduleId,
  canonicalSeedScheduleIdentity,
  getEvaluationPairStreamKey,
} from "../../domain/ai/GenerationRunnerTypes";
import {
  ComparableEvaluationContext,
  FitnessEvaluationSnapshot,
  PopulationFitnessEntry,
  PopulationSelectionConfig,
  PopulationSnapshot,
  SelectionReadiness,
} from "../../domain/ai/PopulationSelectionTypes";
import {
  FitnessEvaluationConfig,
} from "../../domain/ai/FitnessEvaluationTypes";
import {
  DEFAULT_GENERATION_BUILDER_CONFIG,
  GenerationBuilderConfig,
  GenerationBuildResult,
} from "../../domain/ai/GenerationBuilderTypes";
import {
  GeneticOperatorConfig,
} from "../../domain/ai/GeneticOperatorTypes";
import {
  PolicyParticipantOutcomeSummary,
  PolicyParticipantSeatSummary,
} from "../../domain/ai/PolicyExperimentTypes";
import { BatchMatchContext, BatchSimulationOptions } from "../../domain/simulation/BatchSimulationTypes";
import { DecisionPolicy } from "../simulation/DecisionPolicy";
import { SimulationResult, SimulationRunner } from "../simulation/SimulationRunner";
import { GenomePolicy } from "./GenomePolicy";
import { FitnessEvaluator } from "./FitnessEvaluator";
import { PopulationSelector } from "./PopulationSelector";
import { GenerationBuilder } from "./GenerationBuilder";
import { validateGeneticOperatorConfig } from "./GeneticOperators";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { deriveSeed } from "../random/DeterministicShuffle";

/**
 * Builder Config 正規解決内部ヘルパー
 * ※モジュール内部限定 (Non-exported)
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

export class GenerationRunner {
  /**
   * カノニカル Double Round Robin スケジュールを決定論的に生成
   */
  public static planSchedule(
    population: PopulationSnapshot,
    generationSeed: number,
    pairRepetitions: number = 1
  ): GenerationEvaluationMatch[] {
    // UTF-16 code unit order で昇順ソート (元配列非破壊)
    const sortedEntries = [...population.entries].sort((a, b) => {
      if (a.genomeId < b.genomeId) return -1;
      if (a.genomeId > b.genomeId) return 1;
      return 0;
    });

    const N = sortedEntries.length;
    const R = pairRepetitions;
    let pairIndex = 0;
    let matchIndex = 0;
    const schedule: GenerationEvaluationMatch[] = [];

    for (let i = 0; i < N - 1; i++) {
      for (let j = i + 1; j < N; j++) {
        const gI = sortedEntries[i];
        const gJ = sortedEntries[j];
        for (let r = 0; r < R; r++) {
          const streamKey = getEvaluationPairStreamKey(pairIndex, r);
          const pairSeed = deriveSeed(generationSeed, streamKey);

          // Leg 0: p1 = gI, p2 = gJ
          schedule.push({
            matchIndex: matchIndex++,
            pairIndex,
            repetitionIndex: r,
            legIndex: 0,
            p1GenomeId: gI.genomeId,
            p2GenomeId: gJ.genomeId,
            matchSeed: pairSeed,
          });

          // Leg 1: p1 = gJ, p2 = gI
          schedule.push({
            matchIndex: matchIndex++,
            pairIndex,
            repetitionIndex: r,
            legIndex: 1,
            p1GenomeId: gJ.genomeId,
            p2GenomeId: gI.genomeId,
            matchSeed: pairSeed,
          });
        }
        pairIndex++;
      }
    }

    return schedule;
  }

  /**
   * 試合結果群をカノニカル順に再整列・検証し、個体別戦績サマリーへ集約
   */
  public static aggregateOutcomes(
    schedule: readonly GenerationEvaluationMatch[],
    outcomes: readonly GenerationMatchOutcome[],
    population: PopulationSnapshot,
    pairRepetitions: number
  ): Map<string, PolicyParticipantOutcomeSummary> {
    if (outcomes.length !== schedule.length) {
      throw new GenerationRunnerIntegrityError(
        `Match count mismatch: expected ${schedule.length} matches, but received ${outcomes.length} outcomes`
      );
    }

    const seenIndices = new Set<number>();
    for (const o of outcomes) {
      if (seenIndices.has(o.matchIndex)) {
        throw new GenerationRunnerIntegrityError(
          `Duplicate matchIndex detected in outcomes: ${o.matchIndex}`
        );
      }
      seenIndices.add(o.matchIndex);
    }

    // matchIndex 昇順に再整列 (到着順序非依存)
    const sortedOutcomes = [...outcomes].sort((a, b) => a.matchIndex - b.matchIndex);

    for (let i = 0; i < schedule.length; i++) {
      const planned = schedule[i];
      const actual = sortedOutcomes[i];
      if (actual.matchIndex !== planned.matchIndex) {
        throw new GenerationRunnerIntegrityError(
          `Match index sequence mismatch at position ${i}: planned ${planned.matchIndex}, but got ${actual.matchIndex}`
        );
      }
      if (actual.p1GenomeId !== planned.p1GenomeId || actual.p2GenomeId !== planned.p2GenomeId) {
        throw new GenerationRunnerIntegrityError(
          `Match participant mismatch at matchIndex ${planned.matchIndex}: planned (${planned.p1GenomeId} vs ${planned.p2GenomeId}), but got (${actual.p1GenomeId} vs ${actual.p2GenomeId})`
        );
      }
    }

    // 個体別集計用レコードの初期化
    type SeatRecord = {
      scheduledMatches: number;
      completedMatches: number;
      wins: number;
      losses: number;
      draws: number;
      incompleteMatches: number;
    };
    const genomeRecords = new Map<string, { asP1: SeatRecord; asP2: SeatRecord }>();
    for (const entry of population.entries) {
      genomeRecords.set(entry.genomeId, {
        asP1: { scheduledMatches: 0, completedMatches: 0, wins: 0, losses: 0, draws: 0, incompleteMatches: 0 },
        asP2: { scheduledMatches: 0, completedMatches: 0, wins: 0, losses: 0, draws: 0, incompleteMatches: 0 },
      });
    }

    // 各試合の集約
    for (const outcome of sortedOutcomes) {
      const p1Rec = genomeRecords.get(outcome.p1GenomeId);
      const p2Rec = genomeRecords.get(outcome.p2GenomeId);
      if (!p1Rec || !p2Rec) {
        throw new GenerationRunnerIntegrityError(
          `Outcome contains unknown genomeId: (${outcome.p1GenomeId} vs ${outcome.p2GenomeId})`
        );
      }

      p1Rec.asP1.scheduledMatches++;
      p2Rec.asP2.scheduledMatches++;

      if (outcome.completed) {
        p1Rec.asP1.completedMatches++;
        p2Rec.asP2.completedMatches++;
        if (outcome.winner === "p1") {
          p1Rec.asP1.wins++;
          p2Rec.asP2.losses++;
        } else if (outcome.winner === "p2") {
          p2Rec.asP2.wins++;
          p1Rec.asP1.losses++;
        } else {
          p1Rec.asP1.draws++;
          p2Rec.asP2.draws++;
        }
      } else {
        p1Rec.asP1.incompleteMatches++;
        p2Rec.asP2.incompleteMatches++;
      }
    }

    const N = population.entries.length;
    const R = pairRepetitions;
    const summaries = new Map<string, PolicyParticipantOutcomeSummary>();

    for (const entry of population.entries) {
      const rec = genomeRecords.get(entry.genomeId)!;
      const asP1: PolicyParticipantSeatSummary = {
        scheduledMatches: rec.asP1.scheduledMatches,
        completedMatches: rec.asP1.completedMatches,
        wins: rec.asP1.wins,
        losses: rec.asP1.losses,
        draws: rec.asP1.draws,
        incompleteMatches: rec.asP1.incompleteMatches,
        failedMatches: 0,
        winRateOnCompleted: rec.asP1.completedMatches > 0 ? rec.asP1.wins / rec.asP1.completedMatches : 0,
      };
      const asP2: PolicyParticipantSeatSummary = {
        scheduledMatches: rec.asP2.scheduledMatches,
        completedMatches: rec.asP2.completedMatches,
        wins: rec.asP2.wins,
        losses: rec.asP2.losses,
        draws: rec.asP2.draws,
        incompleteMatches: rec.asP2.incompleteMatches,
        failedMatches: 0,
        winRateOnCompleted: rec.asP2.completedMatches > 0 ? rec.asP2.wins / rec.asP2.completedMatches : 0,
      };

      const scheduledMatches = asP1.scheduledMatches + asP2.scheduledMatches;
      const completedMatches = asP1.completedMatches + asP2.completedMatches;
      const wins = asP1.wins + asP2.wins;
      const losses = asP1.losses + asP2.losses;
      const draws = asP1.draws + asP2.draws;
      const incompleteMatches = asP1.incompleteMatches + asP2.incompleteMatches;

      // 保存則検証
      if (wins + losses + draws !== completedMatches) {
        throw new GenerationRunnerIntegrityError(
          `Conservation law violated for genome '${entry.genomeId}': wins + losses + draws !== completedMatches`
        );
      }
      if (completedMatches + incompleteMatches !== scheduledMatches) {
        throw new GenerationRunnerIntegrityError(
          `Conservation law violated for genome '${entry.genomeId}': completedMatches + incompleteMatches !== scheduledMatches`
        );
      }
      if (asP1.scheduledMatches !== (N - 1) * R) {
        throw new GenerationRunnerIntegrityError(
          `Conservation law violated for genome '${entry.genomeId}': asP1.scheduledMatches (${asP1.scheduledMatches}) !== (N - 1) * R (${(N - 1) * R})`
        );
      }
      if (asP2.scheduledMatches !== (N - 1) * R) {
        throw new GenerationRunnerIntegrityError(
          `Conservation law violated for genome '${entry.genomeId}': asP2.scheduledMatches (${asP2.scheduledMatches}) !== (N - 1) * R (${(N - 1) * R})`
        );
      }

      summaries.set(entry.genomeId, {
        participantId: entry.genomeId,
        scheduledMatches,
        completedMatches,
        wins,
        losses,
        draws,
        incompleteMatches,
        failedMatches: 0,
        winRateOnCompleted: completedMatches > 0 ? wins / completedMatches : 0,
        asP1,
        asP2,
      });
    }

    return summaries;
  }

  /**
   * 単一世代 (Generation g -> g+1) の自己対戦評価・適応度集計・次世代遷移を実行
   */
  public static run(params: RunGenerationParams): GenerationRunnerExecutionResult {
    const startTime = Date.now();

    // =========================================================================
    // 1. 入力パラメータの Fail-Fast 事前検証
    // =========================================================================
    if (!params || typeof params !== "object") {
      throw new GenerationRunnerConfigurationError("params must be a valid non-null object");
    }

    // 1.1 generationSeed の検証 (有限整数, 0合法, 小数/NaN/Infinity は拒絶)
    if (
      typeof params.generationSeed !== "number" ||
      !Number.isFinite(params.generationSeed) ||
      !Number.isInteger(params.generationSeed)
    ) {
      throw new GenerationRunnerConfigurationError(
        `generationSeed must be a finite integer, received ${params.generationSeed}`
      );
    }

    // 1.2 environment の検証
    if (!params.environment || typeof params.environment !== "object") {
      throw new GenerationRunnerConfigurationError("environment must be a valid non-null object");
    }
    const envProps = ["environmentRef", "regulationId", "frameId", "rulePackageVersion"] as const;
    for (const prop of envProps) {
      const val = params.environment[prop];
      if (typeof val !== "string" || val.trim().length === 0) {
        throw new GenerationRunnerConfigurationError(
          `environment.${prop} must be a non-empty string, received ${val}`
        );
      }
    }

    // 1.3 population の検証
    if (!params.population || typeof params.population !== "object") {
      throw new GenerationRunnerConfigurationError("population must be a valid non-null object");
    }
    if (
      typeof params.population.generation !== "number" ||
      !Number.isFinite(params.population.generation) ||
      !Number.isInteger(params.population.generation) ||
      params.population.generation < 0
    ) {
      throw new GenerationRunnerConfigurationError(
        `population.generation must be a non-negative integer, received ${params.population.generation}`
      );
    }
    if (!Array.isArray(params.population.entries) || params.population.entries.length < 2) {
      throw new GenerationRunnerConfigurationError(
        `population.entries must have at least 2 entries, received ${params.population.entries?.length}`
      );
    }

    // 母集団エントリの整合性 & 重複ID検査 (Integrity Error)
    const seenGenomeIds = new Set<string>();
    for (let i = 0; i < params.population.entries.length; i++) {
      const entry = params.population.entries[i];
      if (!entry || typeof entry !== "object") {
        throw new GenerationRunnerIntegrityError(`Population entry at index ${i} must be a valid object`);
      }
      if (typeof entry.genomeId !== "string" || entry.genomeId.trim().length === 0) {
        throw new GenerationRunnerIntegrityError(`Population entry at index ${i} has empty or non-string genomeId`);
      }
      if (seenGenomeIds.has(entry.genomeId)) {
        throw new GenerationRunnerIntegrityError(
          `Duplicate genomeId found in population: '${entry.genomeId}'`
        );
      }
      seenGenomeIds.add(entry.genomeId);
      if (entry.generation !== params.population.generation) {
        throw new GenerationRunnerIntegrityError(
          `Population entry '${entry.genomeId}' generation (${entry.generation}) !== population.generation (${params.population.generation})`
        );
      }
      try {
        DecisionDNACodec.validate(entry.dna);
      } catch (err) {
        throw new GenerationRunnerIntegrityError(
          `Population entry '${entry.genomeId}' has invalid DecisionDNA: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 1.4 sessionFactory の検証
    if (typeof params.sessionFactory !== "function") {
      throw new GenerationRunnerConfigurationError("sessionFactory must be a function");
    }

    // 1.5 pairRepetitions の検証
    const pairRepetitions = params.config?.pairRepetitions !== undefined
      ? params.config.pairRepetitions
      : DEFAULT_GENERATION_RUNNER_CONFIG.pairRepetitions;
    if (
      typeof pairRepetitions !== "number" ||
      !Number.isFinite(pairRepetitions) ||
      !Number.isInteger(pairRepetitions) ||
      pairRepetitions < 1
    ) {
      throw new GenerationRunnerConfigurationError(
        `pairRepetitions must be a finite integer >= 1, received ${pairRepetitions}`
      );
    }

    // 1.6 maxDecisionsPerMatch の検証
    const maxDecisionsPerMatch = params.config?.maxDecisionsPerMatch !== undefined
      ? params.config.maxDecisionsPerMatch
      : DEFAULT_GENERATION_RUNNER_CONFIG.maxDecisionsPerMatch;
    if (
      typeof maxDecisionsPerMatch !== "number" ||
      !Number.isFinite(maxDecisionsPerMatch) ||
      !Number.isInteger(maxDecisionsPerMatch) ||
      maxDecisionsPerMatch < 1
    ) {
      throw new GenerationRunnerConfigurationError(
        `maxDecisionsPerMatch must be a finite integer >= 1, received ${maxDecisionsPerMatch}`
      );
    }

    // 1.7 fitnessConfig の検証
    let resolvedFitnessConfig: FitnessEvaluationConfig;
    try {
      resolvedFitnessConfig = FitnessEvaluator.validateConfig(params.config?.fitnessConfig);
    } catch (err) {
      throw new GenerationRunnerConfigurationError(
        `Invalid fitnessConfig: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 1.8 builderConfig の検証 (内部ヘルパー, eliteCount < populationSize を事前検証)
    const resolvedBuilderConfig = resolveCanonicalBuilderConfig(params.config?.builderConfig);

    // 1.9 適応度証拠数の事前検証 (perGenomeScheduledMatches >= minimumCompletedMatches)
    const N = params.population.entries.length;
    const perGenomeScheduledMatches = 2 * (N - 1) * pairRepetitions;
    if (perGenomeScheduledMatches < resolvedFitnessConfig.minimumCompletedMatches) {
      throw new GenerationRunnerConfigurationError(
        `Insufficient scheduled matches per genome: perGenomeScheduledMatches (${perGenomeScheduledMatches}) < minimumCompletedMatches (${resolvedFitnessConfig.minimumCompletedMatches})`
      );
    }

    // =========================================================================
    // 2. Canonical Comparable Evaluation Context の一元構築
    // =========================================================================
    const evaluationScheduleId = canonicalEvaluationScheduleId(
      pairRepetitions,
      maxDecisionsPerMatch
    );
    const seedScheduleIdentity = canonicalSeedScheduleIdentity(params.generationSeed);

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

    // =========================================================================
    // 3. スケジュール生成 & DNA マップ構築
    // =========================================================================
    const schedule = GenerationRunner.planSchedule(
      params.population,
      params.generationSeed,
      pairRepetitions
    );

    const dnaMap = new Map<string, any>();
    for (const entry of params.population.entries) {
      dnaMap.set(entry.genomeId, entry.dna);
    }

    // =========================================================================
    // 4. 統一 Fail-Closed 境界下での試合逐次実行
    // =========================================================================
    let totalDecisions = 0;
    const matchExecutionStart = Date.now();
    const rawOutcomes: GenerationMatchOutcome[] = [];

    for (const match of schedule) {
      const matchContext: BatchMatchContext = {
        matchIndex: match.matchIndex,
        matchId: `gen-${params.population.generation}-match-${String(match.matchIndex).padStart(6, "0")}-${match.p1GenomeId}-vs-${match.p2GenomeId}`,
        baseSeed: params.generationSeed,
        matchSeed: match.matchSeed,
        playerSeeds: {
          p1: deriveSeed(match.matchSeed, "p1"),
          p2: deriveSeed(match.matchSeed, "p2"),
        },
      };

      const p1Dna = dnaMap.get(match.p1GenomeId);
      const p2Dna = dnaMap.get(match.p2GenomeId);
      if (!p1Dna || !p2Dna) {
        throw new GenerationRunnerIntegrityError(
          `Genome DNA missing for match at index ${match.matchIndex} (${match.p1GenomeId} vs ${match.p2GenomeId})`
        );
      }

      let currentPhase: GenerationRunnerExecutionPhase = "SESSION_FACTORY";
      let session: ReturnType<BatchSimulationOptions["sessionFactory"]>;
      let policies: Record<string, DecisionPolicy>;
      let simResult: SimulationResult;

      try {
        currentPhase = "SESSION_FACTORY";
        session = params.sessionFactory(matchContext);

        currentPhase = "POLICY_FACTORY";
        policies = {
          p1: new GenomePolicy(p1Dna),
          p2: new GenomePolicy(p2Dna),
        };

        currentPhase = "RUNNER";
        simResult = SimulationRunner.run(session, policies, {
          maxDecisions: maxDecisionsPerMatch,
        });
      } catch (err) {
        const causeName = err instanceof Error ? err.name : undefined;
        const causeMessage = err instanceof Error ? err.message : String(err);
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

      totalDecisions += (simResult.totalDecisions || 0);

      const outcome: GenerationMatchOutcome = {
        matchIndex: match.matchIndex,
        p1GenomeId: match.p1GenomeId,
        p2GenomeId: match.p2GenomeId,
        completed: simResult.completed,
        winner: simResult.completed
          ? (simResult.winner === "p1" || simResult.winner === "p2" ? simResult.winner : undefined)
          : undefined,
      };
      rawOutcomes.push(outcome);
    }
    const matchExecutionEnd = Date.now();

    // =========================================================================
    // 5. 戦績集約 & 保存則検証
    // =========================================================================
    const outcomeSummaries = GenerationRunner.aggregateOutcomes(
      schedule,
      rawOutcomes,
      params.population,
      pairRepetitions
    );

    // =========================================================================
    // 6. 適応度評価委譲 & FitnessEvaluationSnapshot 構築
    // =========================================================================
    // カノニカル順序 (sortedEntries) でエントリを生成
    const sortedEntries = [...params.population.entries].sort((a, b) => {
      if (a.genomeId < b.genomeId) return -1;
      if (a.genomeId > b.genomeId) return 1;
      return 0;
    });

    const fitnessEntries: PopulationFitnessEntry[] = sortedEntries.map((entry) => {
      const summary = outcomeSummaries.get(entry.genomeId)!;
      const result = FitnessEvaluator.evaluateParticipant(summary, resolvedFitnessConfig);
      return {
        genomeId: entry.genomeId,
        result,
      };
    });

    const fitnessSnapshot: FitnessEvaluationSnapshot = Object.freeze({
      generation: params.population.generation,
      context: evaluationContext,
      entries: Object.freeze(fitnessEntries),
    });

    // =========================================================================
    // 7. Readiness Preflight & Generation Transition
    // =========================================================================
    const readiness = PopulationSelector.assessReadiness(
      params.population,
      fitnessSnapshot,
      resolvedBuilderConfig.selectionConfig,
      evaluationContext
    );

    if (readiness.status === "INVALID_POPULATION" || readiness.status === "INCOMPARABLE_EVALUATION") {
      throw new GenerationRunnerIntegrityError(
        readiness.reason ?? `Selection readiness preflight failed with integrity status: ${readiness.status}`
      );
    }

    const eliteCount = resolvedBuilderConfig.selectionConfig.eliteCount;
    const effectiveRequiredCount = Math.max(readiness.requiredCount, eliteCount);

    const manifest: GenerationEvaluationManifest = Object.freeze({
      generation: params.population.generation,
      populationSize: sortedEntries.length,
      pairRepetitions,
      totalMatches: schedule.length,
      generationSeed: params.generationSeed,
      evaluationScheduleId,
      seedScheduleIdentity,
    });

    let logicalResult: GenerationRunnerLogicalResult;

    if (readiness.status === "REEVALUATION_REQUIRED" || readiness.validCount < effectiveRequiredCount) {
      const effectiveReason =
        readiness.status === "REEVALUATION_REQUIRED"
          ? readiness.reason
          : `Insufficient valid candidates for effective elite count: required at least ${effectiveRequiredCount} (eliteCount=${eliteCount}), but got ${readiness.validCount}`;

      const reevaluationReadiness: SelectionReadiness = {
        status: "REEVALUATION_REQUIRED",
        validCount: readiness.validCount,
        requiredCount: effectiveRequiredCount,
        reason: effectiveReason,
      };

      logicalResult = {
        status: "REEVALUATION_REQUIRED",
        fitnessSnapshot,
        reason: effectiveReason ?? "Reevaluation required",
        readiness: reevaluationReadiness,
        manifest,
        nextPopulation: undefined,
        buildResult: undefined,
      };
    } else {
      let buildResult: GenerationBuildResult;
      try {
        buildResult = GenerationBuilder.buildNextGeneration({
          population: params.population,
          fitnessSnapshot,
          targetGeneration: params.population.generation + 1,
          generationSeed: params.generationSeed,
          config: resolvedBuilderConfig,
          expectedContext: evaluationContext,
        });
      } catch (builderErr) {
        throw new GenerationRunnerIntegrityError(
          `Builder contract drift: GenerationBuilder threw or rejected despite Runner readiness preflight being READY: ${
            builderErr instanceof Error ? builderErr.message : String(builderErr)
          }`
        );
      }

      logicalResult = {
        status: "ADVANCED",
        nextPopulation: buildResult.population,
        buildResult,
        fitnessSnapshot,
        manifest,
      };
    }

    // =========================================================================
    // 8. 実行時メトリクス算出 & 総合結果返却
    // =========================================================================
    const matchExecutionElapsedMs = matchExecutionEnd - matchExecutionStart;
    const totalExecutionTimeMs = Date.now() - startTime;
    const matchesPerSecond =
      matchExecutionElapsedMs > 0 ? (schedule.length / matchExecutionElapsedMs) * 1000 : 0;

    const runtimeMetrics: GenerationRunnerRuntimeMetrics = {
      totalExecutionTimeMs,
      matchExecutionElapsedMs,
      matchesPerSecond,
      totalDecisions,
    };

    return {
      logicalResult,
      runtimeMetrics,
    };
  }
}
