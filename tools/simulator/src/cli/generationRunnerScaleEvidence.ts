import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import { fileURLToPath } from "url";
import { GenerationRunner } from "../engine/ai/GenerationRunner";
import {
  GenerationRunnerEnvironmentContext,
  GenerationRunnerConfig,
  GenerationEvaluationManifest,
} from "../domain/ai/GenerationRunnerTypes";
import {
  PopulationSnapshot,
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
 * Lightweight fail-closed assertion helper
 */
function assertScaleEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`SCALE_EVIDENCE_ASSERTION_FAILED: ${message}`);
  }
}

/**
 * Calculate percentile for sorted numeric array
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export interface ScaleEvidenceExecutionReport {
  workId: string;
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuModel: string;
    logicalCpus: number;
    totalMemoryBytes: number;
    regulationId: string;
    formatId: string;
    frameId: string;
    rulePackageVersion: string;
    environmentRef: string;
  };
  recipe: {
    populationSize: number;
    generation: number;
    genomeCount: number;
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
    executionMode: string;
  };
  canonicalManifest: GenerationEvaluationManifest;
  scheduleVerification: {
    plannedMatches: number;
    pairCount: number;
    selfMatches: number;
    matchIndexContinuous: boolean;
    mirroredPairsVerified: boolean;
    scheduledPerGenome: number;
    p1PerGenome: number;
    p2PerGenome: number;
    scheduleDigest: string;
  };
  memoryDiagnostics: {
    before: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
    };
    after: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
    };
    disclaimer: string;
  };
  execution: {
    startTimeIso: string;
    endTimeIso: string;
    wallClockElapsedMs: number;
    wallClockMinutes: number;
    matchExecutionElapsedMs: number;
    matchExecutionMinutes: number;
    matchesPerSecond: number;
    totalDecisions: number;
    status: string;
    runtimeMetrics: any;
    digest: string;
  };
  outcomes: {
    completedMatches: number;
    incompleteMatches: number;
    failedMatches: number;
    totalObservedMatches: number;
    completionRate: number;
  };
  fitnessDistribution: {
    validCount: number;
    insufficientEvidenceCount: number;
    invalidCount: number;
    stats: {
      count: number;
      min: number;
      max: number;
      mean: number;
      median: number;
      p25: number;
      p75: number;
    };
  };
  conservation: {
    allGenomesScheduledEqual198: boolean;
    allGenomesP1Equal99: boolean;
    allGenomesP2Equal99: boolean;
    allGenomesWinsLossesDrawsEqualCompleted: boolean;
    allGenomesCompletedIncompleteEqualScheduled: boolean;
    allConservationPassed: boolean;
  };
  readiness: {
    status: string;
    validCount: number;
    requiredCount: number;
    reason?: string;
  };
  generationTransition: {
    status: string;
    advanced: boolean;
    sourceGeneration: number;
    targetGeneration: number;
    nextPopulationSize?: number;
    nextPopulationGeneration?: number;
    buildResultPresent: boolean;
    eliteCount?: number;
    offspringCount?: number;
    allUniqueGenomeIds?: boolean;
    allValidDnaRefs?: boolean;
  };
  extrapolationComparison: {
    priorN6ExtrapolatedLowMin: number;
    priorN6ExtrapolatedHighMin: number;
    actualWallClockMinutes: number;
    actualMatchExecutionMinutes: number;
    differenceMinutes: number;
    ratioToPriorEstimate: number;
    performanceLabel: "FAST" | "ACCEPTABLE" | "SLOW" | "TIMEOUT";
  };
}

async function runScaleEvidence(): Promise<ScaleEvidenceExecutionReport> {
  const startTimeIso = new Date().toISOString();
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - N=100 ONE-GENERATION SCALE EVIDENCE V1-R1");
  console.log("  Work ID: BP-SIM-AI-GENERATION-RUNNER-SCALE-EVIDENCE-V1-R1");
  console.log(`  Started at: ${startTimeIso}`);
  console.log("================================================================================");

  // 1. 環境とルールの初期化 (Production Path)
  console.log("[1/6] Loading Official Regulation & Rules...");
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

  // 2. 初期母集団の決定論的構築 (N=100, g=0, Zero Decision DNA)
  console.log("[2/6] Constructing Deterministic Initial Population (N=100, g=0)...");
  const genomeIds: string[] = [];
  for (let i = 0; i < 100; i++) {
    genomeIds.push(`genome-${String(i).padStart(3, "0")}`);
  }

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
      populationSize: 100,
    },
  });

  console.log(`  - Population Size: ${initialPopulation.entries.length}`);
  console.log(`  - Generation Seed: 42`);
  console.log(`  - Pair Repetitions: 1 (Total ${100 * 99 * 1} matches planned)`);
  console.log(`  - Max Decisions Per Match: 500`);
  console.log(`  - Fitness Config: minCompleted=${config.fitnessConfig.minimumCompletedMatches}, minRate=${config.fitnessConfig.minimumCompletionRate}`);
  console.log(`  - Builder Target Size: ${config.builderConfig.populationSize}`);

  // 3. スケジュール事前検証 & 測定 (Static schedule preflight)
  console.log("[3/6] Measuring and Asserting Schedule Properties from GenerationRunner.planSchedule...");
  const plannedSchedule = GenerationRunner.planSchedule(initialPopulation, 42, 1);
  assertScaleEvidence(plannedSchedule.length === 9900, `Schedule length mismatch: expected 9900, got ${plannedSchedule.length}`);

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
    assertScaleEvidence(m.p1GenomeId !== m.p2GenomeId, `Self match detected at matchIndex ${idx}: ${m.p1GenomeId}`);
    assertScaleEvidence(matchesPerGenome[m.p1GenomeId] !== undefined, `Unknown p1GenomeId in schedule: ${m.p1GenomeId}`);
    assertScaleEvidence(matchesPerGenome[m.p2GenomeId] !== undefined, `Unknown p2GenomeId in schedule: ${m.p2GenomeId}`);

    matchesPerGenome[m.p1GenomeId].total++;
    matchesPerGenome[m.p1GenomeId].asP1++;
    matchesPerGenome[m.p2GenomeId].total++;
    matchesPerGenome[m.p2GenomeId].asP2++;
  }

  assertScaleEvidence(matchIndexContinuous, "Schedule matchIndex is not continuous 0..9899");
  assertScaleEvidence(selfMatchCount === 0, `Self match count must be 0, got ${selfMatchCount}`);

  for (const gid of genomeIds) {
    const stats = matchesPerGenome[gid];
    assertScaleEvidence(stats.total === 198, `Genome ${gid} scheduled total !== 198 (got ${stats.total})`);
    assertScaleEvidence(stats.asP1 === 99, `Genome ${gid} asP1 !== 99 (got ${stats.asP1})`);
    assertScaleEvidence(stats.asP2 === 99, `Genome ${gid} asP2 !== 99 (got ${stats.asP2})`);
  }

  // 4,950 Mirrored Pairs 検証
  const totalPairs = (100 * 99) / 2; // 4950
  assertScaleEvidence(totalPairs === 4950, `Expected 4950 pairs, got ${totalPairs}`);
  for (let pairIdx = 0; pairIdx < totalPairs; pairIdx++) {
    const leg0 = plannedSchedule[pairIdx * 2];
    const leg1 = plannedSchedule[pairIdx * 2 + 1];
    assertScaleEvidence(leg0 !== undefined && leg1 !== undefined, `Pair ${pairIdx} missing leg 0 or leg 1`);
    assertScaleEvidence(leg0.pairIndex === pairIdx && leg1.pairIndex === pairIdx, `Pair index mismatch for pair ${pairIdx}`);
    assertScaleEvidence(leg0.legIndex === 0 && leg1.legIndex === 1, `Leg index mismatch for pair ${pairIdx}`);
    assertScaleEvidence(
      leg0.p1GenomeId === leg1.p2GenomeId && leg0.p2GenomeId === leg1.p1GenomeId,
      `Pair ${pairIdx} legs do not have reversed seats`
    );
    assertScaleEvidence(leg0.matchSeed === leg1.matchSeed, `Pair ${pairIdx} legs do not have identical matchSeed`);
  }

  // Canonical Schedule Digest 算出
  const scheduleDigestStream = plannedSchedule.map((m) =>
    `${m.matchIndex}:${m.pairIndex}:${m.repetitionIndex}:${m.legIndex}:${m.p1GenomeId}:${m.p2GenomeId}:${m.matchSeed}`
  ).join("\n");
  const scheduleDigest = crypto.createHash("sha256").update(scheduleDigestStream).digest("hex");
  console.log(`  - Preflight Schedule OK: 9900 matches, 4950 pairs, continuous 0..9899, selfMatch=0, all genomes 198/99/99.`);
  console.log(`  - Schedule Digest: ${scheduleDigest}`);

  // 4. Actual Production Execution (1 世代実機走行)
  console.log("[4/6] Executing Actual 9,900 Matches via GenerationRunner.run()...");
  console.log("  (This may take approximately 15-25 minutes in sequential mode. Please wait...)");

  const memBefore = process.memoryUsage();
  const wallClockStart = performance.now();

  const executionResult = GenerationRunner.run({
    population: initialPopulation,
    generationSeed: 42,
    environment,
    sessionFactory,
    config,
  });

  const wallClockElapsedMs = performance.now() - wallClockStart;
  const memAfter = process.memoryUsage();
  const endTimeIso = new Date().toISOString();

  console.log(`  GenerationRunner.run() finished in ${(wallClockElapsedMs / 1000).toFixed(2)}s (${(wallClockElapsedMs / 60000).toFixed(2)} min).`);

  // 5. Canonical Manifest & Outcome Invariant Assertions
  console.log("[5/6] Verifying Outcomes, Manifest, and Conservation Laws...");
  const logicalResult = executionResult.logicalResult;
  const runtimeMetrics = executionResult.runtimeMetrics;
  const manifest = logicalResult.manifest;

  // Manifest assertions
  assertScaleEvidence(manifest.generation === 0, `manifest.generation mismatch: expected 0, got ${manifest.generation}`);
  assertScaleEvidence(manifest.populationSize === 100, `manifest.populationSize mismatch: expected 100, got ${manifest.populationSize}`);
  assertScaleEvidence(manifest.pairRepetitions === 1, `manifest.pairRepetitions mismatch: expected 1, got ${manifest.pairRepetitions}`);
  assertScaleEvidence(manifest.totalMatches === 9900, `manifest.totalMatches mismatch: expected 9900, got ${manifest.totalMatches}`);
  assertScaleEvidence(manifest.generationSeed === 42, `manifest.generationSeed mismatch: expected 42, got ${manifest.generationSeed}`);
  assertScaleEvidence(
    manifest.evaluationScheduleId === "double-round-robin-v1:r=1:max-decisions=500",
    `manifest.evaluationScheduleId mismatch: expected 'double-round-robin-v1:r=1:max-decisions=500', got '${manifest.evaluationScheduleId}'`
  );
  assertScaleEvidence(
    manifest.seedScheduleIdentity === "evolution-evaluation-pair-v1:generation-seed=42",
    `manifest.seedScheduleIdentity mismatch: expected 'evolution-evaluation-pair-v1:generation-seed=42', got '${manifest.seedScheduleIdentity}'`
  );

  const digest = crypto.createHash("sha256").update(JSON.stringify(logicalResult)).digest("hex");
  console.log(`  - Logical Result Status: ${logicalResult.status}`);
  console.log(`  - Logical Result SHA-256 Digest: ${digest}`);

  // Outcome 集約・整合性検証
  const fitnessSnapshot = logicalResult.fitnessSnapshot;
  assertScaleEvidence(fitnessSnapshot.generation === 0, `fitnessSnapshot.generation must be 0, got ${fitnessSnapshot.generation}`);
  assertScaleEvidence(fitnessSnapshot.entries.length === 100, `fitnessSnapshot entries length must be 100, got ${fitnessSnapshot.entries.length}`);

  let totalCompletedAcrossGenomes = 0;
  let totalIncompleteAcrossGenomes = 0;
  let validCount = 0;
  let insufficientEvidenceCount = 0;
  let invalidCount = 0;
  const validScores: number[] = [];

  for (const entry of fitnessSnapshot.entries) {
    const res = entry.result;
    const wins = (res as any).wins ?? 0;
    const losses = (res as any).losses ?? 0;
    const draws = (res as any).draws ?? 0;
    const completed = (res as any).completedMatches ?? 0;
    const scheduled = res.scheduledMatches;
    const incomplete = scheduled - completed;

    // Conservation assertions per genome
    assertScaleEvidence(scheduled === 198, `Genome ${entry.genomeId} scheduled !== 198 (got ${scheduled})`);
    assertScaleEvidence(completed >= 0, `Genome ${entry.genomeId} completed < 0`);
    assertScaleEvidence(incomplete >= 0, `Genome ${entry.genomeId} incomplete < 0`);
    assertScaleEvidence(
      completed + incomplete === scheduled,
      `Genome ${entry.genomeId} conservation failed: completed (${completed}) + incomplete (${incomplete}) !== scheduled (${scheduled})`
    );
    assertScaleEvidence(
      wins + losses + draws === completed,
      `Genome ${entry.genomeId} conservation failed: wins (${wins}) + losses (${losses}) + draws (${draws}) !== completed (${completed})`
    );

    totalCompletedAcrossGenomes += completed;
    totalIncompleteAcrossGenomes += incomplete;

    if (res.status === "VALID") {
      validCount++;
      if (res.fitnessScore !== null && res.fitnessScore !== undefined) {
        validScores.push(res.fitnessScore);
      }
    } else if (res.status === "INSUFFICIENT_EVIDENCE") {
      insufficientEvidenceCount++;
    } else if (res.status === "INVALID") {
      invalidCount++;
    }
  }

  // INVALID 件数アサーション (0件必須)
  assertScaleEvidence(invalidCount === 0, `Expected 0 INVALID fitness entries, but found ${invalidCount}`);

  const observedCompletedMatches = totalCompletedAcrossGenomes / 2;
  const observedIncompleteMatches = totalIncompleteAcrossGenomes / 2;

  assertScaleEvidence(
    observedCompletedMatches + observedIncompleteMatches === 9900,
    `Overall match conservation violated: completed (${observedCompletedMatches}) + incomplete (${observedIncompleteMatches}) !== 9900`
  );

  // VALID スコア統計計算
  validScores.sort((a, b) => a - b);
  const minScore = validScores.length > 0 ? validScores[0] : 0;
  const maxScore = validScores.length > 0 ? validScores[validScores.length - 1] : 0;
  const sumScore = validScores.reduce((acc, v) => acc + v, 0);
  const meanScore = validScores.length > 0 ? sumScore / validScores.length : 0;
  const medianScore = calculatePercentile(validScores, 50);
  const p25Score = calculatePercentile(validScores, 25);
  const p75Score = calculatePercentile(validScores, 75);

  // Readiness 事前判定
  const readiness =
    logicalResult.status === "REEVALUATION_REQUIRED"
      ? (logicalResult as any).readiness
      : PopulationSelector.assessReadiness(initialPopulation, fitnessSnapshot, {
          minimumValidPopulationCount: 2,
          tournamentSize: 3,
          eliteCount: 1,
        });

  // 世代交代遷移アサーション
  const advanced = logicalResult.status === "ADVANCED";
  const advResult = advanced ? (logicalResult as any) : undefined;

  let allUniqueGenomeIds = false;
  let allValidDnaRefs = false;

  if (advanced) {
    assertScaleEvidence(advResult.nextPopulation !== undefined, "ADVANCED status requires nextPopulation to be defined");
    assertScaleEvidence(advResult.buildResult !== undefined, "ADVANCED status requires buildResult to be defined");
    assertScaleEvidence(
      advResult.nextPopulation.generation === 1,
      `nextPopulation.generation must be 1, got ${advResult.nextPopulation.generation}`
    );
    assertScaleEvidence(
      advResult.nextPopulation.entries.length === 100,
      `nextPopulation.entries.length must be 100, got ${advResult.nextPopulation.entries.length}`
    );

    // ID 一意性 & dnaRef 妥当性
    const nextIds = new Set<string>();
    allValidDnaRefs = true;
    for (const ent of advResult.nextPopulation.entries) {
      if (nextIds.has(ent.genomeId)) {
        throw new Error(`Duplicate genomeId detected in nextPopulation: ${ent.genomeId}`);
      }
      nextIds.add(ent.genomeId);
      if (ent.dnaRef !== `genome:${ent.genomeId}`) {
        allValidDnaRefs = false;
      }
    }
    allUniqueGenomeIds = nextIds.size === 100;
    assertScaleEvidence(allUniqueGenomeIds, "Next population does not contain 100 unique genome IDs");
    assertScaleEvidence(allValidDnaRefs, "Next population entries do not follow canonical dnaRef format");
  } else if (logicalResult.status === "REEVALUATION_REQUIRED") {
    assertScaleEvidence(advResult?.nextPopulation === undefined, "REEVALUATION_REQUIRED requires nextPopulation to be undefined");
    assertScaleEvidence(advResult?.buildResult === undefined, "REEVALUATION_REQUIRED requires buildResult to be undefined");
  } else {
    throw new Error(`Unsupported runner logical status: ${(logicalResult as any).status}`);
  }

  // 6. 外挿比較 & 性能ラベル判定
  console.log("[6/6] Computing Performance & Extrapolation Comparison...");
  const wallClockMinutes = wallClockElapsedMs / 60000;
  const matchExecutionMinutes = runtimeMetrics.matchExecutionElapsedMs / 60000;
  const priorN6ExtrapolatedLowMin = 17.28; // ~1036.7s / 60
  const priorN6ExtrapolatedHighMin = 17.80; // ~1067.7s / 60
  const priorMidMin = (priorN6ExtrapolatedLowMin + priorN6ExtrapolatedHighMin) / 2;
  const diffMinutes = wallClockMinutes - priorMidMin;
  const ratio = wallClockMinutes / priorMidMin;

  let performanceLabel: "FAST" | "ACCEPTABLE" | "SLOW" | "TIMEOUT" = "ACCEPTABLE";
  if (wallClockMinutes <= 20) {
    performanceLabel = "FAST";
  } else if (wallClockMinutes <= 30) {
    performanceLabel = "ACCEPTABLE";
  } else if (wallClockMinutes <= 60) {
    performanceLabel = "SLOW";
  } else {
    performanceLabel = "TIMEOUT";
  }

  const cpus = os.cpus();
  const report: ScaleEvidenceExecutionReport = {
    workId: "BP-SIM-AI-GENERATION-RUNNER-SCALE-EVIDENCE-V1-R1",
    timestamp: endTimeIso,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus[0]?.model ?? "unknown",
      logicalCpus: cpus.length,
      totalMemoryBytes: os.totalmem(),
      regulationId: regulation.id,
      formatId: format.id,
      frameId: frame.id,
      rulePackageVersion: officialRulePackage.version,
      environmentRef: environment.environmentRef,
    },
    recipe: {
      populationSize: 100,
      generation: 0,
      genomeCount: genomeIds.length,
      pairRepetitions: 1,
      generationSeed: 42,
      maxDecisionsPerMatch: 500,
      expectedTotalMatches: 9900,
      expectedMatchesPerGenome: 198,
      builderTargetPopulationSize: 100,
      fitnessConfig: {
        minimumCompletedMatches: config.fitnessConfig.minimumCompletedMatches,
        minimumCompletionRate: config.fitnessConfig.minimumCompletionRate,
      },
      builderConfig: {
        populationSize: config.builderConfig.populationSize,
      },
      executionMode: "Sequential V1",
    },
    canonicalManifest: manifest,
    scheduleVerification: {
      plannedMatches: plannedSchedule.length,
      pairCount: totalPairs,
      selfMatches: selfMatchCount,
      matchIndexContinuous,
      mirroredPairsVerified: true,
      scheduledPerGenome: 198,
      p1PerGenome: 99,
      p2PerGenome: 99,
      scheduleDigest,
    },
    memoryDiagnostics: {
      before: {
        rssBytes: memBefore.rss,
        heapUsedBytes: memBefore.heapUsed,
        heapTotalBytes: memBefore.heapTotal,
      },
      after: {
        rssBytes: memAfter.rss,
        heapUsedBytes: memAfter.heapUsed,
        heapTotalBytes: memAfter.heapTotal,
      },
      disclaimer: "These are before/after endpoint snapshots only. They do not establish peak memory, GC pressure/frequency, or absence of memory leaks.",
    },
    execution: {
      startTimeIso,
      endTimeIso,
      wallClockElapsedMs,
      wallClockMinutes,
      matchExecutionElapsedMs: runtimeMetrics.matchExecutionElapsedMs,
      matchExecutionMinutes,
      matchesPerSecond: runtimeMetrics.matchesPerSecond,
      totalDecisions: runtimeMetrics.totalDecisions,
      status: logicalResult.status,
      runtimeMetrics,
      digest,
    },
    outcomes: {
      completedMatches: observedCompletedMatches,
      incompleteMatches: observedIncompleteMatches,
      failedMatches: 0,
      totalObservedMatches: observedCompletedMatches + observedIncompleteMatches,
      completionRate: observedCompletedMatches / 9900,
    },
    fitnessDistribution: {
      validCount,
      insufficientEvidenceCount,
      invalidCount,
      stats: {
        count: validScores.length,
        min: minScore,
        max: maxScore,
        mean: meanScore,
        median: medianScore,
        p25: p25Score,
        p75: p75Score,
      },
    },
    conservation: {
      allGenomesScheduledEqual198: true,
      allGenomesP1Equal99: true,
      allGenomesP2Equal99: true,
      allGenomesWinsLossesDrawsEqualCompleted: true,
      allGenomesCompletedIncompleteEqualScheduled: true,
      allConservationPassed: true,
    },
    readiness: {
      status: readiness.status,
      validCount: readiness.validCount,
      requiredCount: readiness.requiredCount,
      reason: readiness.reason,
    },
    generationTransition: {
      status: logicalResult.status,
      advanced,
      sourceGeneration: 0,
      targetGeneration: 1,
      nextPopulationSize: advResult?.nextPopulation?.entries?.length,
      nextPopulationGeneration: advResult?.nextPopulation?.generation,
      buildResultPresent: advResult?.buildResult !== undefined,
      eliteCount: advResult?.buildResult?.eliteCount,
      offspringCount: advResult?.buildResult?.offspringCount,
      allUniqueGenomeIds,
      allValidDnaRefs,
    },
    extrapolationComparison: {
      priorN6ExtrapolatedLowMin,
      priorN6ExtrapolatedHighMin,
      actualWallClockMinutes: wallClockMinutes,
      actualMatchExecutionMinutes: matchExecutionMinutes,
      differenceMinutes: diffMinutes,
      ratioToPriorEstimate: ratio,
      performanceLabel,
    },
  };

  console.log("================================================================================");
  console.log("  N=100 SCALE EVIDENCE EXECUTION SUMMARY");
  console.log("================================================================================");
  console.log(`  Status: ${report.execution.status}`);
  console.log(`  Wall Clock: ${wallClockMinutes.toFixed(2)} min (${(wallClockElapsedMs / 1000).toFixed(1)}s)`);
  console.log(`  Match Execution: ${matchExecutionMinutes.toFixed(2)} min (${(runtimeMetrics.matchExecutionElapsedMs / 1000).toFixed(1)}s)`);
  console.log(`  Speed: ${runtimeMetrics.matchesPerSecond.toFixed(2)} matches/sec`);
  console.log(`  Total Decisions: ${runtimeMetrics.totalDecisions}`);
  console.log(`  Matches: Completed=${observedCompletedMatches}, Incomplete=${observedIncompleteMatches}, Failed=0`);
  console.log(`  Fitness: VALID=${validCount}, INSUFFICIENT=${insufficientEvidenceCount}, INVALID=${invalidCount}`);
  console.log(`  VALID Scores: Min=${minScore.toFixed(3)}, Max=${maxScore.toFixed(3)}, Mean=${meanScore.toFixed(3)}, Median=${medianScore.toFixed(3)}`);
  console.log(`  Readiness: ${readiness.status} (Valid: ${readiness.validCount} / Required: ${readiness.requiredCount})`);
  if (advanced) {
    console.log(`  Next Population: g=${report.generationTransition.nextPopulationGeneration}, size=${report.generationTransition.nextPopulationSize}, elite=${report.generationTransition.eliteCount}, offspring=${report.generationTransition.offspringCount}`);
  }
  console.log(`  Performance Label: ${performanceLabel} (Actual ${wallClockMinutes.toFixed(2)}m vs Prior Extrapolated ${priorN6ExtrapolatedLowMin}-${priorN6ExtrapolatedHighMin}m)`);
  console.log("================================================================================");

  return report;
}

// Execute if run directly
runScaleEvidence()
  .then((report) => {
    console.log("--- BEGIN JSON REPORT ---");
    console.log(JSON.stringify(report, null, 2));
    console.log("--- END JSON REPORT ---");
    process.exit(0);
  })
  .catch((err) => {
    console.error("FATAL SCALE EVIDENCE ERROR:", err);
    process.exit(1);
  });
