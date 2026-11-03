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
      validationMeanWinRate: 0.6,
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
      bestValidationMeanScore: 0.6,
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
            pairScores: new Array(10).fill(0.6),
            meanPairScore: 0.6,
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
            pairScores: new Array(10).fill(0.65),
            meanPairScore: 0.65,
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
        pairs: [],
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
    generationElapsedMs: [5000, 5000, 5000, 5000, 5000],
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
          method: "EXACT_BINOMIAL",
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
          method: "EXACT_BINOMIAL",
          pValue: 0.0005,
          alphaUsed: 0.05 / 3,
          isStatisticallySignificant: true,
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
          method: "EXACT_BINOMIAL",
          pValue: 0.05,
          alphaUsed: 0.05 / 3,
          isStatisticallySignificant: false,
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
    baselineSuperior: true,
    championImproved: false,
    evidenceStatus: "VALID",
    improvementStatus: "IMPROVEMENT_UNVERIFIED",
    summaryText: "Exploratory evaluation completed with VALID status",
    logicalResult: {
      opponents: {
        "baseline-first-legal": { opponentId: "baseline-first-legal", opponentName: "FirstLegal" },
        "baseline-seeded-random": { opponentId: "baseline-seeded-random", opponentName: "SeededRandom" },
        "baseline-zero-dna": { opponentId: "baseline-zero-dna", opponentName: "ZeroDNA" },
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
      generationElapsedMs: [5000, 5000, 5000, 5000, 5000],
      overallMatchesPerSec: 24.0,
      timingMeasurementNote: "DIRECT_OBSERVATION",
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
      finalChampionValidationScore: 0.6,
      generationChampions: historyRecords.map((h) => ({
        generation: h.generation,
        genomeId: h.candidateGenomeId,
        dnaDigest: h.candidateDnaDigest,
        fitnessScore: h.candidateFitnessScore,
        validationMeanScore: 0.6,
      })),
    },
    diversityMetrics: [
      { uniqueDnaDigestCount: 1, averageNonZeroWeights: 0, weightStandardDeviation: 0 },
    ],
    exploratoryEvaluation: {
      candidateGenomeId: "ind-g4-000",
      candidateDnaDigest: champDigest,
      totalExploratoryMatches: 120,
      opponentScores: {
        "baseline-first-legal": { opponentId: "baseline-first-legal", name: "FirstLegal", meanPairScore: 0.6, targetWinRate: 0.55, confidenceInterval95: [0.5, 0.7] },
        "baseline-seeded-random": { opponentId: "baseline-seeded-random", name: "SeededRandom", meanPairScore: 0.65, targetWinRate: 0.55, confidenceInterval95: [0.55, 0.75] },
        "baseline-zero-dna": { opponentId: "baseline-zero-dna", name: "ZeroDNA", meanPairScore: 0.55, targetWinRate: 0.55, confidenceInterval95: [0.45, 0.65] },
      },
      overallExploratoryStatus: "VALID",
    },
    stallDiagnostics: {
      passHeavyStallDetected: false,
      matchesReachingDecisionLimit: 0,
      stallNote: "No stall observed.",
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
});
