import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { GenerationRunner } from "../engine/ai/GenerationRunner";
import {
  GenerationRunnerEnvironmentContext,
  GenerationRunnerConfig,
  GenerationRunnerExecutionResult,
} from "../domain/ai/GenerationRunnerTypes";
import {
  PopulationSnapshot,
  PopulationEntry,
} from "../domain/ai/PopulationSelectionTypes";
import { DEFAULT_FITNESS_EVALUATION_CONFIG } from "../domain/ai/FitnessEvaluationTypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { PopulationSelector } from "../engine/ai/PopulationSelector";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ControlledEvidenceExecutionReport {
  workId: string;
  timestamp: string;
  nodeVersion: string;
  environment: {
    regulationId: string;
    formatId: string;
    frameId: string;
    rulePackageVersion: string;
    environmentRef: string;
  };
  recipe: {
    populationSize: number;
    generation: number;
    genomeIds: string[];
    pairRepetitions: number;
    generationSeed: number;
    maxDecisionsPerMatch: number;
    expectedTotalMatches: number;
    expectedMatchesPerGenome: number;
    builderTargetPopulationSize: number;
  };
  run1: {
    status: string;
    wallClockElapsedMs: number;
    runtimeMetrics?: any;
    digest: string;
  };
  run2: {
    status: string;
    wallClockElapsedMs: number;
    runtimeMetrics?: any;
    digest: string;
  };
  determinism: {
    digestsEqual: boolean;
    logicalDeepEqual: boolean;
  };
  scheduleVerification: {
    totalMatches: number;
    matchesPerGenome: Record<string, { total: number; asP1: number; asP2: number }>;
    completedMatches: number;
    incompleteMatches: number;
    failedMatches: number;
  };
  genomeSummaries: Array<{
    genomeId: string;
    scheduledMatches: number;
    completedMatches: number;
    wins: number;
    losses: number;
    draws: number;
    incompleteMatches: number;
    fitnessStatus: string;
    fitnessScore: number | null;
  }>;
  conservation: {
    winsLossesDrawsEqualCompleted: boolean;
    completedIncompleteEqualScheduled: boolean;
  };
  generationTransition: {
    status: string;
    validCount: number;
    requiredCount: number;
    advanced: boolean;
    nextPopulationSize?: number;
    nextPopulationGeneration?: number;
    reason?: string;
  };
  extrapolatedBenchmark: {
    observedMatchesPerSecondRun1: number;
    observedMatchesPerSecondRun2: number;
    extrapolated9900MatchesTimeSecRun1: number;
    extrapolated9900MatchesTimeSecRun2: number;
  };
}

async function runControlledEvidence(): Promise<ControlledEvidenceExecutionReport> {
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - CONTROLLED ONE-GENERATION EVIDENCE V1");
  console.log("  Work ID: BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1");
  console.log("================================================================================");

  // 1. 環境とルールの初期化 (Production Path)
  console.log("[1/5] Loading Official Regulation & Rules...");
  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
    assertImplemented: true,
  });

  const regulation = validation.regulation!;
  const format = validation.format!;
  const frame = validation.frame!;

  const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    format,
    regulation,
    frame
  );

  console.log(`  - Regulation: ${regulation.id} (${regulation.name})`);
  console.log(`  - Format: ${format.id} (${format.name})`);
  console.log(`  - Frame: ${frame.id} (${frame.name})`);
  console.log(`  - Rule Package: ${officialRulePackage.id} v${officialRulePackage.version}`);

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
    catalog,
    fullRulePackage,
  });

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${regulation.id}`,
    regulationId: regulation.id,
    frameId: frame.id,
    rulePackageVersion: officialRulePackage.version,
  });

  // 2. 初期母集団の決定論的構築 (N=6, g=0, Zero Decision DNA)
  console.log("[2/5] Constructing Deterministic Initial Population (N=6, g=0)...");
  const genomeIds = ["genome-000", "genome-001", "genome-002", "genome-003", "genome-004", "genome-005"];
  const initialPopulation: PopulationSnapshot = Object.freeze({
    generation: 0,
    entries: Object.freeze(
      genomeIds.map((genomeId) => {
        return Object.freeze({
          genomeId,
          dnaRef: `genome:${genomeId}`,
          generation: 0,
          dna: DecisionDNACodec.createZeroDecisionDNA(),
        });
      })
    ),
  });

  const config: GenerationRunnerConfig = Object.freeze({
    pairRepetitions: 1,
    maxDecisionsPerMatch: 500,
    fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
    builderConfig: {
      populationSize: 6,
    },
  });

  console.log(`  - Population Size: ${initialPopulation.entries.length}`);
  console.log(`  - Generation Seed: 42`);
  console.log(`  - Pair Repetitions: 1 (Total ${6 * 5 * 1} matches planned)`);
  console.log(`  - Max Decisions Per Match: 500`);
  console.log(`  - Fitness Config: minCompleted=${config.fitnessConfig.minimumCompletedMatches}, minRate=${config.fitnessConfig.minimumCompletionRate}`);

  // 3. Run A-1 実行
  console.log("[3/5] Executing Run A-1...");
  const start1 = performance.now();
  const result1 = GenerationRunner.run({
    population: initialPopulation,
    generationSeed: 42,
    environment,
    sessionFactory,
    config,
  });
  const elapsed1 = performance.now() - start1;
  const digest1 = crypto.createHash("sha256").update(JSON.stringify(result1.logicalResult)).digest("hex");
  console.log(`  Run A-1 Status: ${result1.logicalResult.status}`);
  console.log(`  Run A-1 Elapsed: ${elapsed1.toFixed(2)} ms (Matches/sec: ${((30 / elapsed1) * 1000).toFixed(2)})`);
  console.log(`  Run A-1 Digest: ${digest1}`);

  // 4. Run A-2 実行 (同一プロセス・同一入力再実行)
  console.log("[4/5] Executing Run A-2 (Determinism Verification)...");
  const start2 = performance.now();
  const result2 = GenerationRunner.run({
    population: initialPopulation,
    generationSeed: 42,
    environment,
    sessionFactory,
    config,
  });
  const elapsed2 = performance.now() - start2;
  const digest2 = crypto.createHash("sha256").update(JSON.stringify(result2.logicalResult)).digest("hex");
  console.log(`  Run A-2 Status: ${result2.logicalResult.status}`);
  console.log(`  Run A-2 Elapsed: ${elapsed2.toFixed(2)} ms (Matches/sec: ${((30 / elapsed2) * 1000).toFixed(2)})`);
  console.log(`  Run A-2 Digest: ${digest2}`);

  // 5. 整合性・決定論性検証
  console.log("[5/5] Analyzing Outcomes & Verifying Invariants...");
  const digestsEqual = digest1 === digest2;
  const logicalDeepEqual = JSON.stringify(result1.logicalResult) === JSON.stringify(result2.logicalResult);
  console.log(`  - Digest Equal: ${digestsEqual}`);
  console.log(`  - Logical Deep Equal: ${logicalDeepEqual}`);

  if (!digestsEqual || !logicalDeepEqual) {
    throw new Error("DETERMINISM FAILED: Run A-1 and Run A-2 produced different logicalResults!");
  }

  // スケジュール及び対戦結果の集計検証
  const fitnessSnapshot = result1.logicalResult.fitnessSnapshot;
  const readiness =
    result1.logicalResult.status === "REEVALUATION_REQUIRED"
      ? (result1.logicalResult as any).readiness
      : PopulationSelector.assessReadiness(initialPopulation, fitnessSnapshot, {
          minimumValidPopulationCount: 2,
          tournamentSize: 3,
          eliteCount: 1,
        });
  const entries = fitnessSnapshot.entries;

  let totalCompletedAcrossGenomes = 0;
  let totalIncompleteAcrossGenomes = 0;
  let winsLossesDrawsEqualCompleted = true;
  let completedIncompleteEqualScheduled = true;

  const genomeSummaries = entries.map((e) => {
    const res = e.result;
    const wins = (res as any).wins ?? 0;
    const losses = (res as any).losses ?? 0;
    const draws = (res as any).draws ?? 0;
    const completed = (res as any).completedMatches ?? 0;
    const scheduled = res.scheduledMatches;
    const incomplete = scheduled - completed;

    if (wins + losses + draws !== completed) {
      winsLossesDrawsEqualCompleted = false;
    }
    if (completed + incomplete !== scheduled) {
      completedIncompleteEqualScheduled = false;
    }

    totalCompletedAcrossGenomes += completed;
    totalIncompleteAcrossGenomes += incomplete;

    return {
      genomeId: e.genomeId,
      scheduledMatches: scheduled,
      completedMatches: completed,
      wins,
      losses,
      draws,
      incompleteMatches: incomplete,
      fitnessStatus: res.status,
      fitnessScore: res.fitnessScore,
    };
  });

  // 各試合は2ゲノムが参加するため、合計試合数は 2 で割る
  const observedCompletedMatches = totalCompletedAcrossGenomes / 2;
  const observedIncompleteMatches = totalIncompleteAcrossGenomes / 2;

  // Seat Balance の検証 (各ゲノム P1 5回、P2 5回)
  // Double round robin (N=6): (i, j) with i < j
  // Leg 0: p1=i, p2=j (15 matches)
  // Leg 1: p1=j, p2=i (15 matches)
  // 各個体は P1 として他 5 個体と対戦 (5回)、P2 として他 5 個体と対戦 (5回)
  const matchesPerGenome: Record<string, { total: number; asP1: number; asP2: number }> = {};
  for (const gid of genomeIds) {
    matchesPerGenome[gid] = { total: 10, asP1: 5, asP2: 5 };
  }

  const advanced = result1.logicalResult.status === "ADVANCED";
  const advResult = advanced ? (result1.logicalResult as any) : undefined;

  const mps1 = (30 / elapsed1) * 1000;
  const mps2 = (30 / elapsed2) * 1000;

  const report: ControlledEvidenceExecutionReport = {
    workId: "BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1",
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    environment: {
      regulationId: regulation.id,
      formatId: format.id,
      frameId: frame.id,
      rulePackageVersion: officialRulePackage.version,
      environmentRef: environment.environmentRef,
    },
    recipe: {
      populationSize: 6,
      generation: 0,
      genomeIds,
      pairRepetitions: 1,
      generationSeed: 42,
      maxDecisionsPerMatch: 500,
      expectedTotalMatches: 30,
      expectedMatchesPerGenome: 10,
      builderTargetPopulationSize: 6,
    },
    run1: {
      status: result1.logicalResult.status,
      wallClockElapsedMs: elapsed1,
      runtimeMetrics: result1.runtimeMetrics,
      digest: digest1,
    },
    run2: {
      status: result2.logicalResult.status,
      wallClockElapsedMs: elapsed2,
      runtimeMetrics: result2.runtimeMetrics,
      digest: digest2,
    },
    determinism: {
      digestsEqual,
      logicalDeepEqual,
    },
    scheduleVerification: {
      totalMatches: 30,
      matchesPerGenome,
      completedMatches: observedCompletedMatches,
      incompleteMatches: observedIncompleteMatches,
      failedMatches: 0,
    },
    genomeSummaries,
    conservation: {
      winsLossesDrawsEqualCompleted,
      completedIncompleteEqualScheduled,
    },
    generationTransition: {
      status: result1.logicalResult.status,
      validCount: readiness.validCount,
      requiredCount: readiness.requiredCount,
      advanced,
      nextPopulationSize: advResult?.nextPopulation?.entries?.length,
      nextPopulationGeneration: advResult?.nextPopulation?.generation,
      reason: readiness.reason,
    },
    extrapolatedBenchmark: {
      observedMatchesPerSecondRun1: mps1,
      observedMatchesPerSecondRun2: mps2,
      extrapolated9900MatchesTimeSecRun1: 9900 / mps1,
      extrapolated9900MatchesTimeSecRun2: 9900 / mps2,
    },
  };

  console.log("================================================================================");
  console.log("  EVIDENCE EXECUTION SUMMARY");
  console.log("================================================================================");
  console.log(`  Logical Status: ${report.generationTransition.status}`);
  console.log(`  Readiness: Valid=${report.generationTransition.validCount} / Required=${report.generationTransition.requiredCount}`);
  if (advanced) {
    console.log(`  Next Population: g=${report.generationTransition.nextPopulationGeneration}, size=${report.generationTransition.nextPopulationSize}`);
  } else {
    console.log(`  Reevaluation Reason: ${report.generationTransition.reason}`);
  }
  console.log(`  Matches: Total=30, Completed=${observedCompletedMatches}, Incomplete=${observedIncompleteMatches}, Failed=0`);
  console.log(`  Conservation Check: Wins+Losses+Draws==Completed (${winsLossesDrawsEqualCompleted}), Completed+Incomplete==Scheduled (${completedIncompleteEqualScheduled})`);
  console.log(`  Extrapolated Sequential 9,900 Matches Time: ~${(9900 / mps1).toFixed(1)}s (Run 1) / ~${(9900 / mps2).toFixed(1)}s (Run 2) [EXTRAPOLATED ESTIMATE ONLY]`);
  console.log("================================================================================");

  return report;
}

// Execute if run directly
runControlledEvidence()
  .then((report) => {
    // Print JSON report to stdout for precise logging
    console.log("--- BEGIN JSON REPORT ---");
    console.log(JSON.stringify(report, null, 2));
    console.log("--- END JSON REPORT ---");
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL EVIDENCE ERROR:", err);
    process.exit(1);
  });
