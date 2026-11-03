import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  WORK_ID,
  REGULATION_ID,
  FRAME_ID,
  RULE_PACKAGE_VERSION,
  POPULATION_SIZE,
  TOTAL_GENERATIONS,
  PAIR_REPETITIONS,
  CAMPAIGN_SEED,
  TOTAL_TRAINING_MATCHES,
  TOTAL_VALIDATION_MATCHES,
  TOTAL_EXPLORATORY_MATCHES,
  TOTAL_EXPERIMENT_MATCHES,
  REQUIRED_STAGE2_AUDIT_FILES,
  generateStage2SeedPlan,
  deriveStage2TrainingSeedsByEngine,
  assertNoSeedCollisions,
  createStage2InitialPopulation,
  createStage2ValidationOpponents,
  createStage2ExploratoryOpponents,
  createZeroDecisionDNA,
  computeDiversityMetrics,
  verifyCheckpointIntegrity,
  auditStage2SeedRegistry,
  auditStage2Artifacts,
  computeFileSha256,
  runPreflightCheck,
  determineMatchCategory,
  aggregateValidationDecisionsFromResult,
  computeGenerationChampionValidationScores,
  generateStage2AuditProvenanceAddendum,
} from "../../cli/stage2EvolutionRunner.js";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator.js";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";

// =============================================================================
// テスト用 Fixture 生成ヘルパー
// =============================================================================

function createMockValidStage2Fixture(fixtureDir: string) {
  fs.mkdirSync(fixtureDir, { recursive: true });

  const seedPlan = generateStage2SeedPlan();
  const dummyPop = createStage2InitialPopulation();
  const champDna = dummyPop.entries[0].dna;
  const champDigest = EvolutionIndependentEvaluator.computeDnaDigest(champDna);

  // 1. preflight-manifest.json
  const manifest = {
    workId: WORK_ID,
    gitCommitSha: "mock-commit-sha-1234567890abcdef",
    isGitClean: true,
    timestamp: "2026-11-03T12:00:00.000Z",
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: 6,
    campaignSeed: CAMPAIGN_SEED,
    populationSize: POPULATION_SIZE,
    totalGenerations: TOTAL_GENERATIONS,
    pairRepetitions: PAIR_REPETITIONS,
    totalPlannedMatches: {
      training: TOTAL_TRAINING_MATCHES,
      validation: TOTAL_VALIDATION_MATCHES,
      exploratory: TOTAL_EXPLORATORY_MATCHES,
      total: TOTAL_EXPERIMENT_MATCHES,
    },
    plannedTrainingSeedsByGen: seedPlan.trainingSeedsByGeneration,
    seedGenerationContract:
      "ENGINE_DETERMINISTIC_DERIVATION: deriveSeed(campaignSeed, canonicalGenerationStreamKey(g)) -> deriveSeed(genSeed, getEvaluationPairStreamKey(pairIndex, r))",
    validationSeeds: seedPlan.validationSeeds,
    exploratorySeeds: seedPlan.exploratorySeeds,
    validationOpponents: [
      { opponentId: "baseline-first-legal", name: "FirstLegal", role: "BASELINE" },
      { opponentId: "baseline-seeded-random", name: "SeededRandom", role: "BASELINE" },
    ],
    exploratoryOpponents: [
      { opponentId: "baseline-first-legal", name: "FirstLegal", role: "BASELINE" },
      { opponentId: "baseline-seeded-random", name: "SeededRandom", role: "BASELINE" },
      { opponentId: "baseline-zero-dna", name: "ZeroDNA", role: "BASELINE" },
    ],
    storageClass: "FileCampaignCheckpointStorage",
    artifactsDirectory: fixtureDir,
  };
  fs.writeFileSync(path.join(fixtureDir, "preflight-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // 2. campaign-stage2-evolution-checkpoint.json
  const checkpointBase = {
    checkpointVersion: 1,
    campaignId: "campaign-stage2-evolution",
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: 6,
    totalTargetGenerations: TOTAL_GENERATIONS,
    completedGenerations: TOTAL_GENERATIONS,
    nextGenerationToProcess: TOTAL_GENERATIONS,
    nextPopulation: dummyPop,
    provisionalBestChampion: {
      generation: 4,
      genomeId: "ind-g4-000",
      dna: champDna,
      dnaDigest: champDigest,
      selectionReason: "Highest validation win rate",
      fitnessScore: 1.0,
      validationMeanWinRate: 0.825,
      validationOpponentSummaries: {},
      isHoldoutVerified: false,
    },
    history: [],
    seedRegistry: {
      trainingSeedsByGeneration: seedPlan.trainingSeedsByGeneration,
      validationSeeds: seedPlan.validationSeeds,
      holdoutSeeds: [],
      allUsedSeeds: [...seedPlan.allTrainingSeedsList, ...seedPlan.validationSeeds],
    },
    earlyStoppingState: {
      enabled: false,
      patience: 3,
      minGenerations: 2,
      noImprovementCount: 0,
      bestValidationMeanScore: 0.825,
      triggered: false,
    },
    configSnapshot: {
      campaignId: "campaign-stage2-evolution",
      campaignSeed: CAMPAIGN_SEED,
      regulationId: REGULATION_ID,
      frameId: FRAME_ID,
      rulePackageVersion: RULE_PACKAGE_VERSION,
      featureSchemaVersion: 6,
      totalTargetGenerations: TOTAL_GENERATIONS,
      initialPopulationDigest: {
        generation: 0,
        individuals: dummyPop.entries.map((e) => ({
          genomeId: e.genomeId,
          dnaDigest: champDigest,
        })),
      },
      validationOpponents: [
        { opponentId: "baseline-first-legal", name: "FirstLegal", role: "BASELINE", targetWinRate: 0.55 },
        { opponentId: "baseline-seeded-random", name: "SeededRandom", role: "BASELINE", targetWinRate: 0.55 },
      ],
      validationSeeds: seedPlan.validationSeeds,
      significanceLevelAlpha: 0.05,
      minimumCompletedPairs: 5,
      maxDecisionsPerMatch: 500,
    },
    timestamp: "2026-11-03T12:05:00.000Z",
  };
  const chkChecksum = EvolutionCampaignManager.computeCheckpointChecksum(checkpointBase);
  const checkpoint = { ...checkpointBase, checksum: chkChecksum };
  fs.writeFileSync(path.join(fixtureDir, "campaign-stage2-evolution-checkpoint.json"), JSON.stringify(checkpoint, null, 2), "utf-8");

  // 3. campaign-stage2-evolution-result.json
  const historyRecords = [];
  for (let g = 0; g < TOTAL_GENERATIONS; g++) {
    const pairs = [];
    const flScore = g === 4 ? 1.0 : 0.8;
    const srScore = g === 4 ? 0.65 : 0.6;
    for (let p = 0; p < 10; p++) {
      pairs.push({
        pairIndex: p,
        matchSeed: seedPlan.validationSeeds[p],
        opponentId: "baseline-first-legal",
        pairScore: flScore,
        leg0: { totalDecisions: 120 },
        leg1: { totalDecisions: 120 },
      });
    }
    for (let p = 0; p < 10; p++) {
      pairs.push({
        pairIndex: 10 + p,
        matchSeed: seedPlan.validationSeeds[p],
        opponentId: "baseline-seeded-random",
        pairScore: srScore,
        leg0: { totalDecisions: 120 },
        leg1: { totalDecisions: 120 },
      });
    }

    historyRecords.push({
      generation: g,
      generationSeed: 20261104 + g,
      trainingSeedScheduleIdentity: `schedule-gen-${g}`,
      trainingMatchCount: 56,
      candidateGenomeId: `ind-g${g}-000`,
      candidateDnaDigest: champDigest,
      candidateFitnessScore: 0.75,
      validationResult: {
        evaluatorVersion: 1,
        candidateGenomeId: `ind-g${g}-000`,
        candidateDnaDigest: champDigest,
        rulePackageVersion: RULE_PACKAGE_VERSION,
        featureSchemaVersion: 6,
        regulationId: REGULATION_ID,
        seedCategory: "VALIDATION",
        significanceLevelAlpha: 0.05,
        bonferroniAdjustedAlpha: 0.025,
        opponents: {
          "baseline-first-legal": {
            opponentId: "baseline-first-legal",
            opponentName: "FirstLegal",
            role: "BASELINE",
            totalPairs: 10,
            completedPairs: 10,
            incompletePairs: 0,
            failedPairs: 0,
            pairScores: new Array(10).fill(flScore),
            meanPairScore: flScore,
            sampleVariance: 0,
            standardError: 0,
            confidenceInterval95: { lower: 0.5, upper: 0.7, confidenceLevel: 0.95 },
            statisticalTest: {
              method: "EXACT_BINOMIAL",
              pValue: 0.01,
              alphaUsed: 0.025,
              isStatisticallySignificant: true,
              oneSidedLowerBound: 0.52,
            },
            targetWinRate: 0.55,
            targetMet: true,
            evidenceStatus: "VALID",
            improvementStatus: "IMPROVEMENT_UNVERIFIED",
          },
          "baseline-seeded-random": {
            opponentId: "baseline-seeded-random",
            opponentName: "SeededRandom",
            role: "BASELINE",
            totalPairs: 10,
            completedPairs: 10,
            incompletePairs: 0,
            failedPairs: 0,
            pairScores: new Array(10).fill(srScore),
            meanPairScore: srScore,
            sampleVariance: 0,
            standardError: 0,
            confidenceInterval95: { lower: 0.55, upper: 0.75, confidenceLevel: 0.95 },
            statisticalTest: {
              method: "EXACT_BINOMIAL",
              pValue: 0.005,
              alphaUsed: 0.025,
              isStatisticallySignificant: true,
              oneSidedLowerBound: 0.55,
            },
            targetWinRate: 0.55,
            targetMet: true,
            evidenceStatus: "VALID",
            improvementStatus: "IMPROVEMENT_UNVERIFIED",
          },
        },
        pairs,
        totalPairs: 20,
        totalMatches: 40,
        allTargetsMet: true,
        baselineSuperior: true,
        championImproved: false,
        evidenceStatus: "VALID",
        improvementStatus: "IMPROVEMENT_UNVERIFIED",
        summaryText: "Validation Success",
      },
      isBestChampionUpdated: true,
      timestamp: "2026-11-03T12:05:00.000Z",
    });
  }

  const campaignResult = {
    campaignVersion: 1,
    campaignId: "campaign-stage2-evolution",
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: 6,
    totalTargetGenerations: TOTAL_GENERATIONS,
    completedGenerations: TOTAL_GENERATIONS,
    status: "COMPLETED",
    stopReason: "COMPLETED_NORMALLY",
    provisionalBestChampion: checkpointBase.provisionalBestChampion,
    history: historyRecords,
    finalPopulation: dummyPop,
    seedRegistry: {
      trainingSeedsByGeneration: seedPlan.trainingSeedsByGeneration,
      validationSeeds: seedPlan.validationSeeds,
      holdoutSeeds: [],
      allUsedSeeds: [...seedPlan.allTrainingSeedsList, ...seedPlan.validationSeeds],
    },
    summaryText: "Campaign completed 5 generations normally.",
  };
  fs.writeFileSync(path.join(fixtureDir, "campaign-stage2-evolution-result.json"), JSON.stringify(campaignResult, null, 2), "utf-8");

  // 4. campaign-stage2-evolution-metrics.json
  const metrics = {
    campaignId: "campaign-stage2-evolution",
    totalMatchesExecuted: 600,
    trainingMatchesExecuted: 280,
    validationMatchesExecuted: 200,
    exploratoryMatchesExecuted: 120,
    completedMatches: 600,
    failedMatches: 0,
    incompleteMatches: 0,
    decisionStats: {
      total: { matchCount: 600, totalDecisions: 72000, maxDecisionsInSingleMatch: 200, minDecisionsInSingleMatch: 60, matchesReachingDecisionLimit: 0 },
      training: { matchCount: 280, totalDecisions: 33600, maxDecisionsInSingleMatch: 200, minDecisionsInSingleMatch: 60, matchesReachingDecisionLimit: 0 },
      validation: { matchCount: 200, totalDecisions: 24000, maxDecisionsInSingleMatch: 190, minDecisionsInSingleMatch: 65, matchesReachingDecisionLimit: 0 },
      exploratory: { matchCount: 120, totalDecisions: 14400, maxDecisionsInSingleMatch: 180, minDecisionsInSingleMatch: 70, matchesReachingDecisionLimit: 0 },
    },
    elapsedTotalMs: 25000,
    generationElapsedMs: [null],
    sampledPeakRssMB: 250.5,
    sampledPeakHeapUsedMB: 120.3,
    checkpointSizeBytes: fs.statSync(path.join(fixtureDir, "campaign-stage2-evolution-checkpoint.json")).size,
  };
  fs.writeFileSync(path.join(fixtureDir, "campaign-stage2-evolution-metrics.json"), JSON.stringify(metrics, null, 2), "utf-8");

  // 5. stage2-exploratory-result.json
  const exploratoryResult = {
    evaluatorVersion: 1,
    candidateGenomeId: "ind-g4-000",
    candidateDnaDigest: champDigest,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: 6,
    regulationId: REGULATION_ID,
    seedCategory: "VALIDATION",
    significanceLevelAlpha: 0.05,
    bonferroniAdjustedAlpha: 0.05 / 3,
    opponents: {
      "baseline-first-legal": {
        opponentId: "baseline-first-legal",
        opponentName: "FirstLegal",
        role: "BASELINE",
        totalPairs: 20,
        completedPairs: 20,
        incompletePairs: 0,
        failedPairs: 0,
        pairScores: new Array(20).fill(0.6),
        meanPairScore: 0.6,
        sampleVariance: 0,
        standardError: 0,
        confidenceInterval95: { lower: 0.5, upper: 0.7, confidenceLevel: 0.95 },
        statisticalTest: {
          method: "STUDENT_T",
          pValue: 0.001,
          alphaUsed: 0.05 / 3,
          isStatisticallySignificant: true,
          oneSidedLowerBound: 0.53,
        },
        targetWinRate: 0.55,
        targetMet: true,
        evidenceStatus: "VALID",
        improvementStatus: "IMPROVEMENT_UNVERIFIED",
      },
      "baseline-seeded-random": {
        opponentId: "baseline-seeded-random",
        opponentName: "SeededRandom",
        role: "BASELINE",
        totalPairs: 20,
        completedPairs: 20,
        incompletePairs: 0,
        failedPairs: 0,
        pairScores: new Array(20).fill(0.65),
        meanPairScore: 0.65,
        sampleVariance: 0,
        standardError: 0,
        confidenceInterval95: { lower: 0.55, upper: 0.75, confidenceLevel: 0.95 },
        statisticalTest: {
          method: "STUDENT_T",
          pValue: 0.0276, // Bonferroni alpha = 0.01667 より大きいため非有意
          alphaUsed: 0.05 / 3,
          isStatisticallySignificant: false,
          oneSidedLowerBound: 0.56,
        },
        targetWinRate: 0.55,
        targetMet: true,
        evidenceStatus: "VALID",
        improvementStatus: "IMPROVEMENT_UNVERIFIED",
      },
      "baseline-zero-dna": {
        opponentId: "baseline-zero-dna",
        opponentName: "ZeroDNA",
        role: "BASELINE",
        totalPairs: 20,
        completedPairs: 20,
        incompletePairs: 0,
        failedPairs: 0,
        pairScores: new Array(20).fill(0.55),
        meanPairScore: 0.55,
        sampleVariance: 0,
        standardError: 0,
        confidenceInterval95: { lower: 0.45, upper: 0.65, confidenceLevel: 0.95 },
        statisticalTest: {
          method: "STUDENT_T",
          pValue: 0.001,
          alphaUsed: 0.05 / 3,
          isStatisticallySignificant: true,
          oneSidedLowerBound: 0.48,
        },
        targetWinRate: 0.55,
        targetMet: true,
        evidenceStatus: "VALID",
        improvementStatus: "IMPROVEMENT_UNVERIFIED",
      },
    },
    pairs: [],
    totalPairs: 60,
    totalMatches: 120,
    allTargetsMet: true,
    baselineSuperior: false,
    championImproved: false,
    evidenceStatus: "VALID",
    improvementStatus: "IMPROVEMENT_UNVERIFIED",
    summaryText: "Exploratory evaluation completed with VALID status",
    logicalResult: {
      opponents: {
        "baseline-first-legal": {
          opponentId: "baseline-first-legal",
          opponentName: "FirstLegal",
          statisticalTest: { isStatisticallySignificant: true },
        },
        "baseline-seeded-random": {
          opponentId: "baseline-seeded-random",
          opponentName: "SeededRandom",
          statisticalTest: { isStatisticallySignificant: false, pValue: 0.0276 },
        },
        "baseline-zero-dna": {
          opponentId: "baseline-zero-dna",
          opponentName: "ZeroDNA",
          statisticalTest: { isStatisticallySignificant: true },
        },
      },
    },
  };
  fs.writeFileSync(path.join(fixtureDir, "stage2-exploratory-result.json"), JSON.stringify(exploratoryResult, null, 2), "utf-8");

  // 6. AUDIT_PROVENANCE_NOTE.md
  const note = `# Stage 2 Controlled Evolution 実験出自・監査証跡メモ\n- Work ID: ${WORK_ID}\n- Git Commit SHA: mock-commit-sha-1234567890abcdef\n- Git Clean: CLEAN\n`;
  fs.writeFileSync(path.join(fixtureDir, "AUDIT_PROVENANCE_NOTE.md"), note, "utf-8");

  // 7. stage2-evolution-evidence.json
  const evidence = {
    workId: WORK_ID,
    gitCommitSha: "mock-commit-sha-1234567890abcdef",
    isGitClean: true,
    timestamp: "2026-11-03T12:05:00.000Z",
    status: "SUCCESS",
    stopReason: "COMPLETED_NORMALLY",
    totalMatchesExecuted: 600,
    matchBreakdown: {
      trainingMatches: 280,
      validationMatches: 200,
      exploratoryMatches: 120,
      completedMatches: 600,
      failedMatches: 0,
      incompleteMatches: 0,
    },
    decisionStats: {
      totalDecisions: 72000,
      trainingDecisions: 33600,
      validationDecisions: 24000,
      exploratoryDecisions: 14400,
    },
    timingStats: {
      elapsedTotalMs: 25000,
      generationElapsedMs: [null],
      generationTimingStatus: "UNMEASURED",
      overallMatchesPerSec: 24.0,
      timingMeasurementNote:
        "DIRECT_OBSERVATION: Total elapsed time observed via performance.now(). Generation-level elapsed time is UNMEASURED as boundary timers were not isolated in campaign manager.",
    },
    memoryStats: {
      sampledPeakRssMB: 250.5,
      sampledPeakHeapUsedMB: 120.3,
      memorySamplingMethod: "SESSION_FACTORY_INVOCATION_SAMPLING",
      memoryMeasurementNote: "SAMPLED_MAXIMUM",
    },
    seedAudit: {
      status: "PASS",
      details: "170 unique seeds correctly distributed",
      totalUniqueSeedsUsed: 170,
      uniqueTrainingSeedsCount: 140,
      validationSeedsCount: 10,
      exploratorySeedsCount: 20,
      seedCollisionsDetected: 0,
    },
    championEvolution: {
      finalChampionGenomeId: "ind-g4-000",
      finalChampionDnaDigest: champDigest,
      finalChampionValidationScore: 0.825,
      generationChampions: historyRecords.map((h) => {
        const scores = computeGenerationChampionValidationScores(h.validationResult, h.generation);
        return {
          generation: h.generation,
          genomeId: h.candidateGenomeId,
          dnaDigest: h.candidateDnaDigest,
          fitnessScore: h.candidateFitnessScore,
          firstLegalMeanScore: scores.firstLegalMeanScore,
          seededRandomMeanScore: scores.seededRandomMeanScore,
          overallBaselineMeanScore: scores.overallBaselineMeanScore,
          validationMeanScore: scores.firstLegalMeanScore,
        };
      }),
    },
    diversityMetrics: [
      {
        uniqueDnaDigestCount: 1,
        averageNonZeroWeights: 0,
        weightStandardDeviation: 0,
        finalPopulationP5Note: "P5 is untested offspring population after Gen 4.",
      },
    ],
    exploratoryEvaluation: {
      candidateGenomeId: "ind-g4-000",
      candidateDnaDigest: champDigest,
      totalExploratoryMatches: 120,
      opponentScores: {
        "baseline-first-legal": { opponentId: "baseline-first-legal", name: "FirstLegal", meanPairScore: 0.6, targetWinRate: 0.55, confidenceInterval95: [0.5, 0.7], isStatisticallySignificant: true },
        "baseline-seeded-random": { opponentId: "baseline-seeded-random", name: "SeededRandom", meanPairScore: 0.65, targetWinRate: 0.55, confidenceInterval95: [0.55, 0.75], isStatisticallySignificant: false, pValue: 0.0276 },
        "baseline-zero-dna": { opponentId: "baseline-zero-dna", name: "ZeroDNA", meanPairScore: 0.55, targetWinRate: 0.55, confidenceInterval95: [0.45, 0.65], isStatisticallySignificant: true },
      },
      overallExploratoryStatus: "VALID",
      improvementStatus: "IMPROVEMENT_UNVERIFIED",
    },
    stallDiagnostics: {
      passHeavyStallStatus: "UNVERIFIED",
      passHeavyStallDetected: false,
      matchesReachingDecisionLimit: 0,
      stallNote: "UNVERIFIED: Action logs were not retained in outcomes. 0 matches reached limit.",
    },
  };
  fs.writeFileSync(path.join(fixtureDir, "stage2-evolution-evidence.json"), JSON.stringify(evidence, null, 2), "utf-8");

  // 8. MANIFEST_SHA256.json
  const manifestItems = REQUIRED_STAGE2_AUDIT_FILES.map((relFile) => {
    const fullP = path.join(fixtureDir, relFile);
    return {
      path: relFile,
      sha256: computeFileSha256(fullP),
      size: fs.statSync(fullP).size,
    };
  });
  fs.writeFileSync(path.join(fixtureDir, "MANIFEST_SHA256.json"), JSON.stringify(manifestItems, null, 2), "utf-8");
}

// =============================================================================
// テストスイート
// =============================================================================

describe("Stage 2 Controlled Evolution Runner & Audit Tests (Work 3-4)", () => {
  let tempFixtureDir: string;

  beforeEach(() => {
    tempFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-stage2-audit-fixture-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ---------------------------------------------------------------------------
  // 1. パラメータと Seed 体系の数学的整合性
  // ---------------------------------------------------------------------------
  it("Test 1: 実験パラメータ定数と試合規模の整合性を検証", () => {
    expect(WORK_ID).toBe("BP-SIM-AI-V92-WORK3-STAGE2-CONTROLLED-EVOLUTION");
    expect(REGULATION_ID).toBe("standard-pack");
    expect(FRAME_ID).toBe("pack");
    expect(POPULATION_SIZE).toBe(8);
    expect(TOTAL_GENERATIONS).toBe(5);
    expect(PAIR_REPETITIONS).toBe(1);

    // 28ペア x 2legs x 5世代 = 280試合
    expect(TOTAL_TRAINING_MATCHES).toBe(280);
    // 2相手 x 10シード x 2legs x 5世代 = 200試合
    expect(TOTAL_VALIDATION_MATCHES).toBe(200);
    // 3相手 x 20シード x 2legs = 120試合
    expect(TOTAL_EXPLORATORY_MATCHES).toBe(120);
    // 合計 600 試合
    expect(TOTAL_EXPERIMENT_MATCHES).toBe(600);
    expect(TOTAL_TRAINING_MATCHES + TOTAL_VALIDATION_MATCHES + TOTAL_EXPLORATORY_MATCHES).toBe(600);
  });

  it("Test 2: SeedPlan 生成と衝突ゼロの検証 (計170一意シード)", () => {
    const plan = generateStage2SeedPlan();

    // Training: 5世代それぞれ28一意シード (計140個)
    let totalUniqueTraining = 0;
    for (let g = 0; g < 5; g++) {
      expect(plan.uniqueTrainingSeedsByGen[g].length).toBe(28);
      expect(plan.trainingSeedsByGeneration[g].length).toBe(56); // 28 * 2legs
      totalUniqueTraining += plan.uniqueTrainingSeedsByGen[g].length;
    }
    expect(totalUniqueTraining).toBe(140);
    expect(plan.allTrainingSeedsList.length).toBe(140);

    // Validation: 10一意シード
    expect(plan.validationSeeds.length).toBe(10);
    expect(plan.validationSeeds[0]).toBe(92001);
    expect(plan.validationSeeds[9]).toBe(92010);

    // Exploratory: 20一意シード
    expect(plan.exploratorySeeds.length).toBe(20);
    expect(plan.exploratorySeeds[0]).toBe(93001);
    expect(plan.exploratorySeeds[19]).toBe(93020);

    // 衝突検証 (assertNoSeedCollisions が例外を投げない)
    expect(() => assertNoSeedCollisions(plan)).not.toThrow();

    // 全シード一意数
    expect(new Set(plan.allUsedSeeds).size).toBe(170);
  });

  it("Test 3: Seed 衝突の検知・拒絶検証 (世代間・Validation・Exploratory)", () => {
    const validPlan = generateStage2SeedPlan();

    // 世代間衝突の注入
    const genOverlapPlan = {
      ...validPlan,
      uniqueTrainingSeedsByGen: {
        ...validPlan.uniqueTrainingSeedsByGen,
        1: [validPlan.uniqueTrainingSeedsByGen[0][0], ...validPlan.uniqueTrainingSeedsByGen[1].slice(1)],
      },
    };
    expect(() => assertNoSeedCollisions(genOverlapPlan)).toThrow(/Duplicate training seed/);

    // Validation 衝突の注入
    const valCollisionPlan = {
      ...validPlan,
      validationSeeds: [validPlan.allTrainingSeedsList[0], ...validPlan.validationSeeds.slice(1)],
    };
    expect(() => assertNoSeedCollisions(valCollisionPlan)).toThrow(/Collision between validation seed/);

    // Exploratory 衝突の注入
    const expCollisionPlan = {
      ...validPlan,
      exploratorySeeds: [validPlan.validationSeeds[0], ...validPlan.exploratorySeeds.slice(1)],
    };
    expect(() => assertNoSeedCollisions(expCollisionPlan)).toThrow(/Collision between exploratory seed/);
  });

  // ---------------------------------------------------------------------------
  // 2. 初期母集団 & Baseline Opponents 生成
  // ---------------------------------------------------------------------------
  it("Test 4: 初期母集団 (N=8) の生成とスキーマ整合性を検証", () => {
    const pop = createStage2InitialPopulation();
    expect(pop.generation).toBe(0);
    expect(pop.entries.length).toBe(8);

    for (const entry of pop.entries) {
      expect(entry.generation).toBe(0);
      expect(entry.dna).toBeDefined();
      expect(() => DecisionDNACodec.validate(entry.dna)).not.toThrow();
      // 全重み 0
      expect(entry.dna.patternWeights.every((w) => w === 0)).toBe(true);
      expect(entry.dna.contextPatternWeights.every((w) => w === 0)).toBe(true);
    }
  });

  it("Test 5: Validation および Exploratory Opponents の生成を検証", () => {
    const valOpps = createStage2ValidationOpponents();
    expect(valOpps.length).toBe(2);
    expect(valOpps.map((o) => o.opponentId)).toEqual(["baseline-first-legal", "baseline-seeded-random"]);

    const expOpps = createStage2ExploratoryOpponents();
    expect(expOpps.length).toBe(3);
    expect(expOpps.map((o) => o.opponentId)).toEqual([
      "baseline-first-legal",
      "baseline-seeded-random",
      "baseline-zero-dna",
    ]);
  });

  // ---------------------------------------------------------------------------
  // 3. 多様性指標計算
  // ---------------------------------------------------------------------------
  it("Test 6: 母集団多様性指標 (DiversityMetrics) 計算を検証", () => {
    const zeroDna1 = createZeroDecisionDNA({ id: "dna1" });
    const zeroDna2 = createZeroDecisionDNA({ id: "dna2" });

    const zeroMetrics = computeDiversityMetrics([zeroDna1, zeroDna2]);
    expect(zeroMetrics.uniqueDnaDigestCount).toBe(1);
    expect(zeroMetrics.averageNonZeroWeights).toBe(0);
    expect(zeroMetrics.weightStandardDeviation).toBe(0);

    // 異なる重みの DNA
    const mutatedDna = DecisionDNACodec.clone(zeroDna1);
    (mutatedDna.patternWeights as number[])[0] = 0.5;
    (mutatedDna.patternWeights as number[])[1] = -0.5;

    const divMetrics = computeDiversityMetrics([zeroDna1, mutatedDna]);
    expect(divMetrics.uniqueDnaDigestCount).toBe(2);
    expect(divMetrics.averageNonZeroWeights).toBe(1); // (0 + 2) / 2 = 1
    expect(divMetrics.weightStandardDeviation).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Checkpoint 完全性検証
  // ---------------------------------------------------------------------------
  it("Test 7: Checkpoint 完全性検証 (verifyCheckpointIntegrity)", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    const chkPath = path.join(tempFixtureDir, "campaign-stage2-evolution-checkpoint.json");

    // 正常ケース
    const validResult = verifyCheckpointIntegrity(chkPath, "campaign-stage2-evolution");
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors.length).toBe(0);
    expect(validResult.state?.completedGenerations).toBe(5);

    // チェックサム改ざんケース
    const rawChk = JSON.parse(fs.readFileSync(chkPath, "utf-8"));
    const tamperedChk = { ...rawChk, checksum: "tampered_fake_checksum_value" };
    fs.writeFileSync(chkPath, JSON.stringify(tamperedChk, null, 2), "utf-8");

    const tamperedResult = verifyCheckpointIntegrity(chkPath, "campaign-stage2-evolution");
    expect(tamperedResult.isValid).toBe(false);
    expect(tamperedResult.errors.some((e) => e.includes("checksum mismatch"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5. 成果物監査関数 (auditStage2Artifacts: Fail-Closed)
  // ---------------------------------------------------------------------------
  it("Test 8: 正常 Fixture で auditStage2Artifacts が全項目 PASS となることを検証", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    const audit = auditStage2Artifacts(tempFixtureDir);

    expect(audit.isValid).toBe(true);
    expect(audit.errors.length).toBe(0);
    expect(audit.provenanceNotePresent).toBe(true);
    expect(audit.manifestIntegrity.hasManifestShaFile).toBe(true);
    expect(audit.manifestIntegrity.mismatches.length).toBe(0);
    expect(audit.checkpointIntegrity.isValid).toBe(true);

    expect(audit.verifications.totalMatches.status).toBe("PASS");
    expect(audit.verifications.trainingMatches.status).toBe("PASS");
    expect(audit.verifications.validationMatches.status).toBe("PASS");
    expect(audit.verifications.exploratoryMatches.status).toBe("PASS");
    expect(audit.verifications.completionStatus.status).toBe("PASS");
    expect(audit.verifications.abnormalMatches.status).toBe("PASS");
    expect(audit.verifications.checkpointCompletedGenerations.status).toBe("PASS");
    expect(audit.verifications.exploratoryOpponentsCount.status).toBe("PASS");
    expect(audit.verifications.finalChampionIntegrity.status).toBe("PASS");
    expect(audit.verifications.decisionStatsAccounting.status).toBe("PASS");
    expect(audit.verifications.manifestSeedMatch.status).toBe("PASS");
    expect(audit.verifications.championOverallBaselineScore.status).toBe("PASS");
    expect(audit.verifications.exploratorySignificanceAccuracy.status).toBe("PASS");
    expect(audit.verifications.timingMeasurementHonesty.status).toBe("PASS");
    expect(audit.verifications.passStallMeasurementHonesty.status).toBe("PASS");

    expect(audit.seedAudit?.status).toBe("PASS");
    expect(audit.seedAudit?.totalUniqueSeedsUsed).toBe(170);
  });

  it("Test 9: 必須ファイル欠落時の Fail-Closed 検証", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    // 必須ファイル 1 つを削除
    fs.unlinkSync(path.join(tempFixtureDir, "stage2-exploratory-result.json"));

    const audit = auditStage2Artifacts(tempFixtureDir);
    expect(audit.isValid).toBe(false);
    expect(audit.errors.some((e) => e.includes("Required Stage 2 artifact file is missing"))).toBe(true);
  });

  it("Test 10: MANIFEST_SHA256 不一致時の Fail-Closed 検証", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    // 結果ファイルを少し改ざん
    const resPath = path.join(tempFixtureDir, "campaign-stage2-evolution-result.json");
    const resObj = JSON.parse(fs.readFileSync(resPath, "utf-8"));
    resObj.summaryText = "Tampered text";
    fs.writeFileSync(resPath, JSON.stringify(resObj, null, 2), "utf-8");

    const audit = auditStage2Artifacts(tempFixtureDir);
    expect(audit.isValid).toBe(false);
    expect(audit.manifestIntegrity.mismatches.length).toBeGreaterThan(0);
    expect(audit.errors.some((e) => e.includes("MANIFEST_SHA256 mismatch"))).toBe(true);
  });

  it("Test 11: 試合数不一致 (600試合以外) 時の Fail-Closed 検証", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    // evidence の試合数を改ざん
    const evPath = path.join(tempFixtureDir, "stage2-evolution-evidence.json");
    const evObj = JSON.parse(fs.readFileSync(evPath, "utf-8"));
    evObj.totalMatchesExecuted = 599; // 1試合不足
    fs.writeFileSync(evPath, JSON.stringify(evObj, null, 2), "utf-8");

    // MANIFEST_SHA256 も更新してハッシュ照合ではなくロジック照合での検知をテスト
    const manifestItems = REQUIRED_STAGE2_AUDIT_FILES.map((relFile) => {
      const fullP = path.join(tempFixtureDir, relFile);
      return { path: relFile, sha256: computeFileSha256(fullP), size: fs.statSync(fullP).size };
    });
    fs.writeFileSync(path.join(tempFixtureDir, "MANIFEST_SHA256.json"), JSON.stringify(manifestItems, null, 2), "utf-8");

    const audit = auditStage2Artifacts(tempFixtureDir);
    expect(audit.isValid).toBe(false);
    expect(audit.verifications.totalMatches.status).toBe("FAIL");
    expect(audit.errors.some((e) => e.includes("Total matches mismatch"))).toBe(true);
  });

  it("Test 12: AUDIT_PROVENANCE_NOTE.md 欠落時の Fail-Closed 検証", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    fs.unlinkSync(path.join(tempFixtureDir, "AUDIT_PROVENANCE_NOTE.md"));

    const audit = auditStage2Artifacts(tempFixtureDir);
    expect(audit.isValid).toBe(false);
    expect(audit.provenanceNotePresent).toBe(false);
    expect(audit.errors.some((e) => e.includes("AUDIT_PROVENANCE_NOTE.md is required"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. R1 指摘対応の必須検証テスト (意思決定数・Seed・Validation・統計)
  // ---------------------------------------------------------------------------
  it("Test 13: [必須] Training と Validation の意思決定数自動分離の検証 (determineMatchCategory)", () => {
    const seedPlan = generateStage2SeedPlan();

    // 1. Training 対戦コンテキスト (gen-*-match-*)
    const trainingCtx = {
      matchIndex: 0,
      matchId: "gen-0-match-000000-ind-g0-000-vs-ind-g0-001",
      baseSeed: 20261104,
      matchSeed: seedPlan.trainingSeedsByGeneration[0][0],
      playerSeeds: { p1: 1, p2: 2 },
    };
    expect(determineMatchCategory(trainingCtx, "CAMPAIGN", seedPlan)).toBe("TRAINING");

    // 2. Validation 対戦コンテキスト (matchSeed が validationSeeds に含まれる)
    const valCtxBySeed = {
      matchIndex: 0,
      matchId: "arbitrary-val-match",
      baseSeed: 92001,
      matchSeed: 92001,
      playerSeeds: { p1: 1, p2: 2 },
    };
    expect(determineMatchCategory(valCtxBySeed, "CAMPAIGN", seedPlan)).toBe("VALIDATION");

    // 3. Validation 対戦コンテキスト (matchId に -cand-vs- が含まれる)
    const valCtxById = {
      matchIndex: 0,
      matchId: "pair-0-leg0-12345-cand-vs-baseline-first-legal",
      baseSeed: 12345,
      matchSeed: 12345,
      playerSeeds: { p1: 1, p2: 2 },
    };
    expect(determineMatchCategory(valCtxById, "CAMPAIGN", seedPlan)).toBe("VALIDATION");

    // 4. Exploratory 対戦コンテキスト (outerCategory が EXPLORATORY)
    const expCtx = {
      matchIndex: 0,
      matchId: "pair-0-leg0-93001-cand-vs-baseline-first-legal",
      baseSeed: 93001,
      matchSeed: 93001,
      playerSeeds: { p1: 1, p2: 2 },
    };
    expect(determineMatchCategory(expCtx, "EXPLORATORY", seedPlan)).toBe("EXPLORATORY");
  });

  it("Test 14: [必須] 3分類の合計と総意思決定数の一致検証", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    const evPath = path.join(tempFixtureDir, "stage2-evolution-evidence.json");
    const ev = JSON.parse(fs.readFileSync(evPath, "utf-8"));

    const ds = ev.decisionStats;
    expect(ds.trainingDecisions).toBeGreaterThan(0);
    expect(ds.validationDecisions).toBeGreaterThan(0);
    expect(ds.exploratoryDecisions).toBeGreaterThan(0);
    expect(ds.trainingDecisions + ds.validationDecisions + ds.exploratoryDecisions).toBe(ds.totalDecisions);
  });

  it("Test 15: [必須] Validation が実際に行われたのに意思決定数が 0 の場合の監査検出 (Fail-Closed)", () => {
    createMockValidStage2Fixture(tempFixtureDir);
    const evPath = path.join(tempFixtureDir, "stage2-evolution-evidence.json");
    const ev = JSON.parse(fs.readFileSync(evPath, "utf-8"));

    // Validation 意思決定数を 0 に改ざん (旧 R0 バグのシミュレーション)
    ev.decisionStats.validationDecisions = 0;
    ev.decisionStats.trainingDecisions = ev.decisionStats.totalDecisions - ev.decisionStats.exploratoryDecisions;
    fs.writeFileSync(evPath, JSON.stringify(ev, null, 2), "utf-8");

    // MANIFEST_SHA256 も更新
    const manifestItems = REQUIRED_STAGE2_AUDIT_FILES.map((relFile) => {
      const fullP = path.join(tempFixtureDir, relFile);
      return { path: relFile, sha256: computeFileSha256(fullP), size: fs.statSync(fullP).size };
    });
    fs.writeFileSync(path.join(tempFixtureDir, "MANIFEST_SHA256.json"), JSON.stringify(manifestItems, null, 2), "utf-8");

    // 厳格モードでは FAIL となること
    const auditStrict = auditStage2Artifacts(tempFixtureDir, { allowLegacyR0Schema: false });
    expect(auditStrict.isValid).toBe(false);
    expect(auditStrict.verifications.decisionStatsAccounting.status).toBe("FAIL");
    expect(auditStrict.errors.some((e) => e.includes("Validation decisions recorded as 0"))).toBe(true);

    // allowLegacyR0Schema: true の場合は警告を出して再計算値により PASS となること
    const auditLegacy = auditStage2Artifacts(tempFixtureDir, { allowLegacyR0Schema: true });
    expect(auditLegacy.isValid).toBe(true);
    expect(auditLegacy.verifications.decisionStatsAccounting.status).toBe("PASS");
    expect(auditLegacy.warnings.some((w) => w.includes("Legacy R0 schema misclassified validation decisions"))).toBe(true);
  });

  it("Test 16: [必須] 保存 Result からの Validation 意思決定数独立集計の検証 (aggregateValidationDecisionsFromResult)", () => {
    const liveResultPath = path.resolve(__dirname, "../../../.artifacts/stage2-evolution/campaign-stage2-evolution-result.json");
    if (!fs.existsSync(liveResultPath)) {
      return;
    }

    const campaignResult = JSON.parse(fs.readFileSync(liveResultPath, "utf-8"));
    const recount = aggregateValidationDecisionsFromResult(campaignResult);

    expect(recount.totalMatches).toBe(200); // 40 matches x 5 generations
    expect(recount.totalDecisions).toBe(37081); // 独立レビュー指摘の実測集計値と完全一致

    // 各世代の試合数が 40 試合であることを検証
    for (let g = 0; g < 5; g++) {
      expect(recount.byGeneration[g].matches).toBe(40);
      expect(recount.byGeneration[g].decisions).toBeGreaterThan(0);
    }
  });

  it("Test 17: 正規 Engine Seed 導出契約 (deriveStage2TrainingSeedsByEngine) と実機 Result の完全一致", () => {
    const liveResultPath = path.resolve(__dirname, "../../../.artifacts/stage2-evolution/campaign-stage2-evolution-result.json");
    if (!fs.existsSync(liveResultPath)) {
      return;
    }

    const campaignResult = JSON.parse(fs.readFileSync(liveResultPath, "utf-8"));
    const derived = deriveStage2TrainingSeedsByEngine(CAMPAIGN_SEED);
    const actualSeedsByGen = campaignResult.seedRegistry.trainingSeedsByGeneration;

    for (let g = 0; g < 5; g++) {
      const derivedGenSeeds = derived.trainingSeedsByGeneration[g];
      const actualGenSeeds = actualSeedsByGen[g];
      expect(derivedGenSeeds).toEqual(actualGenSeeds);
    }
  });

  it("Test 18: Validation 世代別スコア (FirstLegal, SeededRandom, 全 Baseline 平均) 計算と最終 Champion 勝率整合性の検証", () => {
    const liveResultPath = path.resolve(__dirname, "../../../.artifacts/stage2-evolution/campaign-stage2-evolution-result.json");
    if (!fs.existsSync(liveResultPath)) {
      return;
    }

    const campaignResult = JSON.parse(fs.readFileSync(liveResultPath, "utf-8"));
    const gen4History = campaignResult.history.find((h: any) => h.generation === 4);
    expect(gen4History).toBeDefined();

    const gen4Scores = computeGenerationChampionValidationScores(gen4History.validationResult, 4);
    expect(gen4Scores.firstLegalMeanScore).toBe(1.0);
    expect(gen4Scores.seededRandomMeanScore).toBe(0.65);
    expect(gen4Scores.overallBaselineMeanScore).toBe(0.825);

    // 最終 Champion の validationMeanWinRate と全 Baseline 平均スコアが完全一致すること
    expect(campaignResult.provisionalBestChampion.validationMeanWinRate).toBe(0.825);
    expect(campaignResult.provisionalBestChampion.validationMeanWinRate).toBe(gen4Scores.overallBaselineMeanScore);
  });

  it("Test 19: 探索評価の統計的有意性 (Bonferroni補正) と evidenceStatus の区別検証", () => {
    const liveExpPath = path.resolve(__dirname, "../../../.artifacts/stage2-evolution/stage2-exploratory-result.json");
    if (!fs.existsSync(liveExpPath)) {
      return;
    }

    const exploratoryResult = JSON.parse(fs.readFileSync(liveExpPath, "utf-8"));
    const opponents = exploratoryResult.opponents;

    // FirstLegal: 有意
    expect(opponents["baseline-first-legal"].statisticalTest.isStatisticallySignificant).toBe(true);
    expect(opponents["baseline-first-legal"].meanPairScore).toBe(0.975);

    // SeededRandom: Bonferroni 補正下 (alpha = 0.01667) で p=0.0276 > 0.01667 のため非有意
    expect(opponents["baseline-seeded-random"].statisticalTest.isStatisticallySignificant).toBe(false);
    expect(opponents["baseline-seeded-random"].statisticalTest.pValue).toBeCloseTo(0.0276, 3);
    expect(opponents["baseline-seeded-random"].meanPairScore).toBe(0.65);

    // ZeroDNA: 有意
    expect(opponents["baseline-zero-dna"].statisticalTest.isStatisticallySignificant).toBe(true);
    expect(opponents["baseline-zero-dna"].meanPairScore).toBe(0.975);

    // 全体判定: evidenceStatus は VALID、improvementStatus は IMPROVEMENT_UNVERIFIED
    expect(exploratoryResult.evidenceStatus).toBe("VALID");
    expect(exploratoryResult.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
    expect(exploratoryResult.baselineSuperior).toBe(false);
  });

  it("Test 20: 原本 ZIP (stage2-evolution-archive.zip) の完全無改変検証 (SHA-256一致)", () => {
    const zipPath = path.resolve(__dirname, "../../../.artifacts/stage2-evolution-archive.zip");
    if (!fs.existsSync(zipPath)) {
      return;
    }

    const actualHash = computeFileSha256(zipPath);
    const expectedHash = "41c147e45b8866e3142ef333a7e3ef1348b34063582e6b1152c2c9011ccbbbb0";
    expect(actualHash.toLowerCase()).toBe(expectedHash.toLowerCase());
  });

  it("Test 21: 監査補足資料 (Addendum) 生成および Addendum 完全監査 PASS の検証", () => {
    const liveArtifactsDir = path.resolve(__dirname, "../../../.artifacts/stage2-evolution");
    const liveAddendumDir = path.resolve(__dirname, "../../../.artifacts/stage2-evolution-addendum");
    if (!fs.existsSync(liveArtifactsDir) || !fs.existsSync(liveAddendumDir)) {
      return;
    }

    const addendumData = generateStage2AuditProvenanceAddendum(liveArtifactsDir, liveAddendumDir);
    expect(addendumData.auditStatus).toBe("PASS");
    expect(addendumData.decisionStatsRecount.totalDecisions).toBe(107386);
    expect(addendumData.decisionStatsRecount.trainingDecisions).toBe(55345);
    expect(addendumData.decisionStatsRecount.validationDecisions).toBe(37081);
    expect(addendumData.decisionStatsRecount.exploratoryDecisions).toBe(14960);
    expect(addendumData.validationScoresClarification.gen4OverallBaselineMeanScore).toBe(0.825);
    expect(addendumData.statisticalSignificanceClarification.seededRandomSignificant).toBe(false);
    expect(addendumData.statisticalSignificanceClarification.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");

    // MANIFEST_SHA256 の照合
    const manifestPath = path.join(liveAddendumDir, "MANIFEST_SHA256.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifestList = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    for (const item of manifestList) {
      const fp = path.join(liveAddendumDir, item.path);
      expect(fs.existsSync(fp)).toBe(true);
      expect(computeFileSha256(fp)).toBe(item.sha256);
    }
  });

  it("Test 22: 実機 Stage 2 成果物 (.artifacts/stage2-evolution) の完全監査 (Legacy モード & Addendum 突合)", () => {
    const liveArtifactsDir = path.resolve(__dirname, "../../../.artifacts/stage2-evolution");
    const liveAddendumDir = path.resolve(__dirname, "../../../.artifacts/stage2-evolution-addendum");
    if (!fs.existsSync(liveArtifactsDir)) {
      return;
    }

    const audit = auditStage2Artifacts(liveArtifactsDir, {
      allowLegacyR0Schema: true,
      addendumDir: fs.existsSync(liveAddendumDir) ? liveAddendumDir : undefined,
    });

    expect(audit.isValid).toBe(true);
    expect(audit.errors).toEqual([]);
    expect(audit.provenanceNotePresent).toBe(true);

    // Manifest SHA256 完全一致
    expect(audit.manifestIntegrity.hasManifestShaFile).toBe(true);
    expect(audit.manifestIntegrity.mismatches).toEqual([]);
    expect(audit.manifestIntegrity.matchedFilesCount).toBe(7);

    // Checkpoint 完全性
    expect(audit.checkpointIntegrity.isValid).toBe(true);

    // 全 15 照合項目の PASS
    expect(audit.verifications.totalMatches.status).toBe("PASS");
    expect(audit.verifications.trainingMatches.status).toBe("PASS");
    expect(audit.verifications.validationMatches.status).toBe("PASS");
    expect(audit.verifications.exploratoryMatches.status).toBe("PASS");
    expect(audit.verifications.completionStatus.status).toBe("PASS");
    expect(audit.verifications.abnormalMatches.status).toBe("PASS");
    expect(audit.verifications.checkpointCompletedGenerations.status).toBe("PASS");
    expect(audit.verifications.exploratoryOpponentsCount.status).toBe("PASS");
    expect(audit.verifications.finalChampionIntegrity.status).toBe("PASS");

    // 新規照合項目 (R1 指摘対応)
    expect(audit.verifications.decisionStatsAccounting.status).toBe("PASS");
    expect(audit.verifications.manifestSeedMatch.status).toBe("PASS");
    expect(audit.verifications.championOverallBaselineScore.status).toBe("PASS");
    expect(audit.verifications.exploratorySignificanceAccuracy.status).toBe("PASS");
    expect(audit.verifications.timingMeasurementHonesty.status).toBe("PASS");
    expect(audit.verifications.passStallMeasurementHonesty.status).toBe("PASS");

    // Seed 監査
    expect(audit.seedAudit?.status).toBe("PASS");

    // Addendum 監査
    if (fs.existsSync(liveAddendumDir)) {
      expect(audit.addendumAudit?.isValid).toBe(true);
    }
  });
});
