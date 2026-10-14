import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { GenerationRunner } from "../engine/ai/GenerationRunner";
import {
  GenerationRunnerEnvironmentContext,
  GenerationRunnerConfig,
  GenerationRunnerExecutionResult,
  GenerationEvaluationManifest,
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

/**
 * Lightweight fail-closed assertion helper for evidence verification
 */
function assertEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`EVIDENCE_ASSERTION_FAILED: ${message}`);
  }
}

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
    fitnessConfig: {
      minimumCompletedMatches: number;
      minimumCompletionRate: number;
    };
    builderConfig: {
      populationSize: number;
    };
  };
  canonicalManifest: GenerationEvaluationManifest;
  run1: {
    status: string;
    wallClockElapsedMs: number;
    matchExecutionElapsedMs: number;
    matchesPerSecond: number;
    totalDecisions: number;
    runtimeMetrics?: any;
    digest: string;
  };
  run2: {
    status: string;
    wallClockElapsedMs: number;
    matchExecutionElapsedMs: number;
    matchesPerSecond: number;
    totalDecisions: number;
    runtimeMetrics?: any;
    digest: string;
  };
  determinism: {
    digestsEqual: boolean;
    logicalDeepEqual: boolean;
  };
  scheduleVerification: {
    totalMatches: number;
    selfMatchCount: number;
    matchIndexContinuous: boolean;
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
    seatBalanceVerified: boolean;
    allMandatoryAssertionsPassed: boolean;
  };
  generationTransition: {
    status: string;
    fitnessGeneration: number;
    validCount: number;
    requiredCount: number;
    advanced: boolean;
    nextPopulationSize?: number;
    nextPopulationGeneration?: number;
    buildResultPresent: boolean;
    reason?: string;
  };
  extrapolatedBenchmark: {
    observedMatchesPerSecondRun1: number;
    observedMatchesPerSecondRun2: number;
    extrapolated9900MatchesTimeSecRun1: number;
    extrapolated9900MatchesTimeSecRun2: number;
    disclaimer: string;
  };
}

async function runControlledEvidence(): Promise<ControlledEvidenceExecutionReport> {
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - CONTROLLED ONE-GENERATION EVIDENCE V1-R1");
  console.log("  Work ID: BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1-R1");
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

  // Schedule の事前生成・実測 (Finding 2)
  console.log("[2.5/5] Measuring and Asserting Schedule Properties from GenerationRunner.planSchedule...");
  const plannedSchedule = GenerationRunner.planSchedule(initialPopulation, 42, 1);
  assertEvidence(plannedSchedule.length === 30, `Schedule length mismatch: expected 30, got ${plannedSchedule.length}`);

  const matchesPerGenome: Record<string, { total: number; asP1: number; asP2: number }> = {};
  for (const gid of genomeIds) {
    matchesPerGenome[gid] = { total: 0, asP1: 0, asP2: 0 };
  }

  let selfMatchCount = 0;
  let matchIndexContinuous = true;

  for (let idx = 0; idx < plannedSchedule.length; idx++) {
    const m = plannedSchedule[idx];
    if (m.matchIndex !== idx) {
      matchIndexContinuous = false;
    }
    if (m.p1GenomeId === m.p2GenomeId) {
      selfMatchCount++;
    }
    assertEvidence(m.p1GenomeId !== m.p2GenomeId, `Self match detected at matchIndex ${idx}: ${m.p1GenomeId}`);
    assertEvidence(matchesPerGenome[m.p1GenomeId] !== undefined, `Unknown p1GenomeId in schedule: ${m.p1GenomeId}`);
    assertEvidence(matchesPerGenome[m.p2GenomeId] !== undefined, `Unknown p2GenomeId in schedule: ${m.p2GenomeId}`);

    matchesPerGenome[m.p1GenomeId].total++;
    matchesPerGenome[m.p1GenomeId].asP1++;
    matchesPerGenome[m.p2GenomeId].total++;
    matchesPerGenome[m.p2GenomeId].asP2++;
  }

  assertEvidence(matchIndexContinuous, "Schedule matchIndex is not continuous 0..29");
  assertEvidence(selfMatchCount === 0, `Self match count must be 0, got ${selfMatchCount}`);

  for (const gid of genomeIds) {
    const stats = matchesPerGenome[gid];
    assertEvidence(stats.total === 10, `Genome ${gid} scheduled total matches !== 10 (got ${stats.total})`);
    assertEvidence(stats.asP1 === 5, `Genome ${gid} asP1 !== 5 (got ${stats.asP1})`);
    assertEvidence(stats.asP2 === 5, `Genome ${gid} asP2 !== 5 (got ${stats.asP2})`);
  }

  // Mirrored pair verification (15 pairs, 2 legs each)
  for (let pairIdx = 0; pairIdx < 15; pairIdx++) {
    const leg0 = plannedSchedule.find((m) => m.pairIndex === pairIdx && m.legIndex === 0);
    const leg1 = plannedSchedule.find((m) => m.pairIndex === pairIdx && m.legIndex === 1);
    assertEvidence(leg0 !== undefined && leg1 !== undefined, `Pair ${pairIdx} missing leg 0 or leg 1`);
    assertEvidence(
      leg0.p1GenomeId === leg1.p2GenomeId && leg0.p2GenomeId === leg1.p1GenomeId,
      `Pair ${pairIdx} legs do not have reversed seats`
    );
    assertEvidence(leg0.matchSeed === leg1.matchSeed, `Pair ${pairIdx} legs do not have identical matchSeed`);
  }
  console.log(`  - Schedule measured: 30 matches, continuous 0..29, selfMatch=0, all genomes total=10, P1=5, P2=5, 15 mirrored pairs verified.`);

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

  // 5. Canonical Manifest 検証 (Finding 1)
  console.log("[5/5] Analyzing Outcomes & Verifying Invariants...");
  const manifest1 = result1.logicalResult.manifest;
  const manifest2 = result2.logicalResult.manifest;

  assertEvidence(manifest1 !== undefined, "Run A-1 manifest is undefined");
  assertEvidence(manifest1.generation === 0, `manifest1.generation mismatch: expected 0, got ${manifest1.generation}`);
  assertEvidence(manifest1.populationSize === 6, `manifest1.populationSize mismatch: expected 6, got ${manifest1.populationSize}`);
  assertEvidence(manifest1.pairRepetitions === 1, `manifest1.pairRepetitions mismatch: expected 1, got ${manifest1.pairRepetitions}`);
  assertEvidence(manifest1.totalMatches === 30, `manifest1.totalMatches mismatch: expected 30, got ${manifest1.totalMatches}`);
  assertEvidence(manifest1.generationSeed === 42, `manifest1.generationSeed mismatch: expected 42, got ${manifest1.generationSeed}`);
  assertEvidence(
    manifest1.evaluationScheduleId === "double-round-robin-v1:r=1:max-decisions=500",
    `manifest1.evaluationScheduleId mismatch: expected 'double-round-robin-v1:r=1:max-decisions=500', got '${manifest1.evaluationScheduleId}'`
  );
  assertEvidence(
    manifest1.seedScheduleIdentity === "evolution-evaluation-pair-v1:generation-seed=42",
    `manifest1.seedScheduleIdentity mismatch: expected 'evolution-evaluation-pair-v1:generation-seed=42', got '${manifest1.seedScheduleIdentity}'`
  );

  assertEvidence(manifest2 !== undefined, "Run A-2 manifest is undefined");
  assertEvidence(manifest2.generation === 0, `manifest2.generation mismatch: expected 0, got ${manifest2.generation}`);
  assertEvidence(manifest2.populationSize === 6, `manifest2.populationSize mismatch: expected 6, got ${manifest2.populationSize}`);
  assertEvidence(manifest2.pairRepetitions === 1, `manifest2.pairRepetitions mismatch: expected 1, got ${manifest2.pairRepetitions}`);
  assertEvidence(manifest2.totalMatches === 30, `manifest2.totalMatches mismatch: expected 30, got ${manifest2.totalMatches}`);
  assertEvidence(manifest2.generationSeed === 42, `manifest2.generationSeed mismatch: expected 42, got ${manifest2.generationSeed}`);
  assertEvidence(
    manifest2.evaluationScheduleId === "double-round-robin-v1:r=1:max-decisions=500",
    `manifest2.evaluationScheduleId mismatch: expected 'double-round-robin-v1:r=1:max-decisions=500', got '${manifest2.evaluationScheduleId}'`
  );
  assertEvidence(
    manifest2.seedScheduleIdentity === "evolution-evaluation-pair-v1:generation-seed=42",
    `manifest2.seedScheduleIdentity mismatch: expected 'evolution-evaluation-pair-v1:generation-seed=42', got '${manifest2.seedScheduleIdentity}'`
  );

  assertEvidence(
    JSON.stringify(manifest1) === JSON.stringify(manifest2),
    "Run A-1 manifest is not deep equal to Run A-2 manifest"
  );
  console.log(`  - Manifest Verified: evaluationScheduleId='${manifest1.evaluationScheduleId}', seedScheduleIdentity='${manifest1.seedScheduleIdentity}'`);

  // 決定論性検証 (Finding 3 / 25-27)
  const digestsEqual = digest1 === digest2;
  const logicalDeepEqual = JSON.stringify(result1.logicalResult) === JSON.stringify(result2.logicalResult);
  console.log(`  - Digest Equal: ${digestsEqual}`);
  console.log(`  - Logical Deep Equal: ${logicalDeepEqual}`);

  assertEvidence(digestsEqual, `Digest mismatch: run1=${digest1}, run2=${digest2}`);
  assertEvidence(logicalDeepEqual, "Run A-1 and Run A-2 produced different logicalResults");

  // スケジュール及び対戦結果の集計検証 (Finding 3)
  const fitnessSnapshot = result1.logicalResult.fitnessSnapshot;
  assertEvidence(fitnessSnapshot.generation === 0, `fitnessSnapshot.generation must be 0, got ${fitnessSnapshot.generation}`);

  const readiness =
    result1.logicalResult.status === "REEVALUATION_REQUIRED"
      ? (result1.logicalResult as any).readiness
      : PopulationSelector.assessReadiness(initialPopulation, fitnessSnapshot, {
          minimumValidPopulationCount: 2,
          tournamentSize: 3,
          eliteCount: 1,
        });
  const entries = fitnessSnapshot.entries;
  assertEvidence(entries.length === 6, `fitnessSnapshot entries length must be 6, got ${entries.length}`);

  let totalCompletedAcrossGenomes = 0;
  let totalIncompleteAcrossGenomes = 0;

  const genomeSummaries = entries.map((e) => {
    const res = e.result;
    const wins = (res as any).wins ?? 0;
    const losses = (res as any).losses ?? 0;
    const draws = (res as any).draws ?? 0;
    const completed = (res as any).completedMatches ?? 0;
    const scheduled = res.scheduledMatches;
    const incomplete = scheduled - completed;

    // Fail-Closed Genome Assertions (Finding 3 / Section 20)
    assertEvidence(scheduled === 10, `Genome ${e.genomeId} scheduledMatches !== 10 (got ${scheduled})`);
    assertEvidence(completed >= 0, `Genome ${e.genomeId} completedMatches < 0`);
    assertEvidence(incomplete >= 0, `Genome ${e.genomeId} incompleteMatches < 0`);
    assertEvidence(
      completed + incomplete === scheduled,
      `Genome ${e.genomeId} conservation failed: completed (${completed}) + incomplete (${incomplete}) !== scheduled (${scheduled})`
    );
    assertEvidence(
      wins + losses + draws === completed,
      `Genome ${e.genomeId} conservation failed: wins (${wins}) + losses (${losses}) + draws (${draws}) !== completed (${completed})`
    );

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

  // Outcome Count Fail-Closed Assertions (Finding 3 / Section 18-19)
  assertEvidence(
    observedCompletedMatches + observedIncompleteMatches === 30,
    `Overall match conservation violated: completed (${observedCompletedMatches}) + incomplete (${observedIncompleteMatches}) !== 30`
  );
  assertEvidence(
    observedCompletedMatches === 30,
    `Expected 30 completed matches, got ${observedCompletedMatches}`
  );
  assertEvidence(
    observedIncompleteMatches === 0,
    `Expected 0 incomplete matches, got ${observedIncompleteMatches}`
  );

  // Status & Transition Fail-Closed Assertions (Finding 3 / Section 22-24)
  const status = result1.logicalResult.status;
  assertEvidence(
    status === "ADVANCED" || status === "REEVALUATION_REQUIRED",
    `Unsupported runner logical status: ${status}`
  );

  const advanced = status === "ADVANCED";
  const advResult = advanced ? (result1.logicalResult as any) : undefined;

  if (advanced) {
    assertEvidence(advResult.nextPopulation !== undefined, "ADVANCED status requires nextPopulation to be present");
    assertEvidence(advResult.buildResult !== undefined, "ADVANCED status requires buildResult to be present");
    assertEvidence(
      advResult.nextPopulation.generation === 1,
      `nextPopulation.generation must be 1, got ${advResult.nextPopulation.generation}`
    );
    assertEvidence(
      advResult.nextPopulation.entries.length === 6,
      `nextPopulation.entries.length must be 6, got ${advResult.nextPopulation.entries.length}`
    );
  } else {
    assertEvidence(advResult?.nextPopulation === undefined, "REEVALUATION_REQUIRED requires nextPopulation to be undefined");
    assertEvidence(advResult?.buildResult === undefined, "REEVALUATION_REQUIRED requires buildResult to be undefined");
    assertEvidence(readiness !== undefined, "REEVALUATION_REQUIRED requires readiness to be present");
  }

  const mps1 = (30 / elapsed1) * 1000;
  const mps2 = (30 / elapsed2) * 1000;

  const report: ControlledEvidenceExecutionReport = {
    workId: "BP-SIM-AI-GENERATION-RUNNER-EVIDENCE-V1-R1",
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
      fitnessConfig: {
        minimumCompletedMatches: config.fitnessConfig.minimumCompletedMatches,
        minimumCompletionRate: config.fitnessConfig.minimumCompletionRate,
      },
      builderConfig: {
        populationSize: config.builderConfig!.populationSize!,
      },
    },
    canonicalManifest: manifest1,
    run1: {
      status: result1.logicalResult.status,
      wallClockElapsedMs: elapsed1,
      matchExecutionElapsedMs: result1.runtimeMetrics.matchExecutionElapsedMs,
      matchesPerSecond: result1.runtimeMetrics.matchesPerSecond,
      totalDecisions: result1.runtimeMetrics.totalDecisions,
      runtimeMetrics: result1.runtimeMetrics,
      digest: digest1,
    },
    run2: {
      status: result2.logicalResult.status,
      wallClockElapsedMs: elapsed2,
      matchExecutionElapsedMs: result2.runtimeMetrics.matchExecutionElapsedMs,
      matchesPerSecond: result2.runtimeMetrics.matchesPerSecond,
      totalDecisions: result2.runtimeMetrics.totalDecisions,
      runtimeMetrics: result2.runtimeMetrics,
      digest: digest2,
    },
    determinism: {
      digestsEqual,
      logicalDeepEqual,
    },
    scheduleVerification: {
      totalMatches: plannedSchedule.length,
      selfMatchCount,
      matchIndexContinuous,
      matchesPerGenome,
      completedMatches: observedCompletedMatches,
      incompleteMatches: observedIncompleteMatches,
      failedMatches: 0,
    },
    genomeSummaries,
    conservation: {
      winsLossesDrawsEqualCompleted: true,
      completedIncompleteEqualScheduled: true,
      seatBalanceVerified: true,
      allMandatoryAssertionsPassed: true,
    },
    generationTransition: {
      status: result1.logicalResult.status,
      fitnessGeneration: fitnessSnapshot.generation,
      validCount: readiness.validCount,
      requiredCount: readiness.requiredCount,
      advanced,
      nextPopulationSize: advResult?.nextPopulation?.entries?.length,
      nextPopulationGeneration: advResult?.nextPopulation?.generation,
      buildResultPresent: advResult?.buildResult !== undefined,
      reason: readiness.reason,
    },
    extrapolatedBenchmark: {
      observedMatchesPerSecondRun1: mps1,
      observedMatchesPerSecondRun2: mps2,
      extrapolated9900MatchesTimeSecRun1: 9900 / mps1,
      extrapolated9900MatchesTimeSecRun2: 9900 / mps2,
      disclaimer: "EXTRAPOLATED ESTIMATE ONLY",
    },
  };

  console.log("================================================================================");
  console.log("  EVIDENCE EXECUTION SUMMARY (ALL INVARIANTS ASSERTED & PASSED)");
  console.log("================================================================================");
  console.log(`  Canonical evaluationScheduleId: ${manifest1.evaluationScheduleId}`);
  console.log(`  Canonical seedScheduleIdentity: ${manifest1.seedScheduleIdentity}`);
  console.log(`  Logical Status: ${report.generationTransition.status}`);
  console.log(`  Readiness: Valid=${report.generationTransition.validCount} / Required=${report.generationTransition.requiredCount}`);
  if (advanced) {
    console.log(`  Next Population: g=${report.generationTransition.nextPopulationGeneration}, size=${report.generationTransition.nextPopulationSize}, buildResult=${report.generationTransition.buildResultPresent}`);
  } else {
    console.log(`  Reevaluation Reason: ${report.generationTransition.reason}`);
  }
  console.log(`  Matches: Total=30, Completed=${observedCompletedMatches}, Incomplete=${observedIncompleteMatches}, Failed=0`);
  console.log(`  Conservation: ALL PASS (Seat Balance, Conservation, SelfMatch=0, Index Continuity)`);
  console.log(`  Determinism: Digests Equal (${digestsEqual}), Logical Deep Equal (${logicalDeepEqual})`);
  console.log(`  Extrapolated Sequential 9,900 Matches Time: ~${(9900 / mps1).toFixed(1)}s (Run 1) / ~${(9900 / mps2).toFixed(1)}s (Run 2) [EXTRAPOLATED ESTIMATE ONLY]`);
  console.log("================================================================================");

  return report;
}

// Execute if run directly
runControlledEvidence()
  .then((report) => {
    console.log("--- BEGIN JSON REPORT ---");
    console.log(JSON.stringify(report, null, 2));
    console.log("--- END JSON REPORT ---");
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL EVIDENCE ERROR:", err);
    process.exit(1);
  });
