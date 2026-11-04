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
  TOTAL_EXPERIMENT_MATCHES,
  HOLDOUT_SEEDS_COUNT,
  TOTAL_HOLDOUT_MATCHES,
  REQUIRED_STAGE3_AUDIT_FILES,
  DEFAULT_STAGE3_ARTIFACTS_DIR,
  LEGACY_STAGE3_ARTIFACTS_DIR,
  validateArtifactsDirectory,
  resolveArtifactsDirectoryFromArgs,
  generateStage3SeedPlan,
  deriveStage3TrainingSeedsByEngine,
  assertNoSeedCollisions,
  createStage3InitialPopulation,
  createStage3ValidationOpponents,
  createZeroDecisionDNA,
  computeDiversityMetrics,
  auditStage3Artifacts,
  computeFileSha256,
  runPreflightCheck,
  determineMatchCategory,
  computeGenerationChampionValidationScores,
  InstrumentedCheckpointStorage,
  saveStage3Artifacts,
  Stage3ExecutionOutput,
} from "../../cli/stage3EvolutionRunner.js";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator.js";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager.js";
import { InMemoryCampaignCheckpointStorage } from "../../domain/ai/EvolutionCampaignTypes.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";

// =============================================================================
// テスト用 Fixture 生成ヘルパー
// =============================================================================

function createMockValidStage3Fixture(fixtureDir: string) {
  fs.mkdirSync(fixtureDir, { recursive: true });

  const seedPlan = generateStage3SeedPlan();
  const dummyPop = createStage3InitialPopulation();
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
      total: TOTAL_EXPERIMENT_MATCHES,
    },
    plannedTrainingSeedsByGen: seedPlan.trainingSeedsByGeneration,
    seedGenerationContract: seedPlan.seedGenerationContract,
    validationSeeds: seedPlan.validationSeeds,
    plannedHoldoutSeeds: seedPlan.holdoutSeeds,
    holdoutStatus: "PLANNED_UNUSED_IN_THIS_RUN",
    validationOpponents: [
      { opponentId: "baseline-first-legal", name: "FirstLegal", role: "BASELINE" },
      { opponentId: "baseline-seeded-random", name: "SeededRandom", role: "BASELINE" },
    ],
    storageClass: "FileCampaignCheckpointStorage",
    artifactsDirectory: fixtureDir,
  };
  fs.writeFileSync(path.join(fixtureDir, "preflight-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  // 2. campaign-stage3-evolution-checkpoint.json
  const checkpointBase = {
    checkpointVersion: 1,
    campaignId: "stage3-large-scale-evolution",
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: 6,
    totalTargetGenerations: TOTAL_GENERATIONS,
    completedGenerations: TOTAL_GENERATIONS,
    nextGenerationToProcess: TOTAL_GENERATIONS,
    nextPopulation: dummyPop, // P10 (オフスプリング)
    provisionalBestChampion: {
      generation: 9, // Gen 9 で評価された個体
      genomeId: "ind-g9-000",
      dna: champDna,
      dnaDigest: champDigest,
      selectionReason: "Highest validation win rate",
      fitnessScore: 0.95,
      validationMeanWinRate: 0.85,
      validationOpponentSummaries: {},
      isHoldoutVerified: false,
    },
    history: [],
    seedRegistry: {
      trainingSeedsByGeneration: seedPlan.trainingSeedsByGeneration,
      validationSeeds: seedPlan.validationSeeds,
      allUsedSeeds: seedPlan.allUsedSeeds,
    },
  };
  const checkpointChecksum = EvolutionCampaignManager.computeCheckpointChecksum(checkpointBase as any);
  const checkpoint = {
    ...checkpointBase,
    checksum: checkpointChecksum,
  };
  fs.writeFileSync(
    path.join(fixtureDir, "campaign-stage3-evolution-checkpoint.json"),
    JSON.stringify(checkpoint, null, 2),
    "utf-8"
  );

  // 3. campaign-stage3-evolution-result.json
  const result = {
    executionTimeMs: 120000,
    status: "SUCCESS",
    logicalResult: {
      campaignId: "stage3-large-scale-evolution",
      status: "COMPLETED",
      stopReason: "All target generations (10) completed successfully",
      completedGenerations: TOTAL_GENERATIONS,
      provisionalBestChampion: checkpoint.provisionalBestChampion,
      finalPopulation: dummyPop,
      history: [],
      seedRegistry: checkpoint.seedRegistry,
    },
    environment: {
      environmentRef: "stage3-evolution-environment",
      regulationId: REGULATION_ID,
      frameId: FRAME_ID,
      rulePackageVersion: RULE_PACKAGE_VERSION,
    },
  };
  fs.writeFileSync(
    path.join(fixtureDir, "campaign-stage3-evolution-result.json"),
    JSON.stringify(result, null, 2),
    "utf-8"
  );

  // 4. campaign-stage3-evolution-metrics.json
  const generationTimings = [];
  for (let g = 0; g < TOTAL_GENERATIONS; g++) {
    generationTimings.push({
      generation: g,
      totalElapsedMs: 12000.0,
      trainingElapsedMs: 8000.0,
      validationElapsedMs: 3800.0,
      checkpointSaveElapsedMs: 200.0,
    });
  }

  const metrics = {
    workId: WORK_ID,
    timestamp: "2026-11-03T12:00:00.000Z",
    totalMatchesExecuted: TOTAL_EXPERIMENT_MATCHES,
    trainingMatchesExecuted: TOTAL_TRAINING_MATCHES,
    validationMatchesExecuted: TOTAL_VALIDATION_MATCHES,
    completedMatches: TOTAL_EXPERIMENT_MATCHES,
    failedMatches: 0,
    incompleteMatches: 0,
    decisionStats: {
      total: { matchCount: TOTAL_EXPERIMENT_MATCHES, totalDecisions: 300000, maxDecisionsInSingleMatch: 250, minDecisionsInSingleMatch: 40, matchesReachingDecisionLimit: 0 },
      training: { matchCount: TOTAL_TRAINING_MATCHES, totalDecisions: 210000, maxDecisionsInSingleMatch: 250, minDecisionsInSingleMatch: 40, matchesReachingDecisionLimit: 0 },
      validation: { matchCount: TOTAL_VALIDATION_MATCHES, totalDecisions: 90000, maxDecisionsInSingleMatch: 200, minDecisionsInSingleMatch: 45, matchesReachingDecisionLimit: 0 },
    },
    passAndStallTelemetry: {
      total: {
        matchCount: TOTAL_EXPERIMENT_MATCHES,
        totalDecisions: 300000,
        totalPassDecisions: 45000,
        passRatio: 0.15,
        maxConsecutivePassesInSingleMatch: 4,
        matchesReachingDecisionLimit: 0,
        potentialStallMatchesCount: 0,
        exceptionOrIncompleteMatches: 0,
      },
      training: {
        matchCount: TOTAL_TRAINING_MATCHES,
        totalDecisions: 210000,
        totalPassDecisions: 31500,
        passRatio: 0.15,
        maxConsecutivePassesInSingleMatch: 4,
        matchesReachingDecisionLimit: 0,
        potentialStallMatchesCount: 0,
        exceptionOrIncompleteMatches: 0,
      },
      validation: {
        matchCount: TOTAL_VALIDATION_MATCHES,
        totalDecisions: 90000,
        totalPassDecisions: 13500,
        passRatio: 0.15,
        maxConsecutivePassesInSingleMatch: 3,
        matchesReachingDecisionLimit: 0,
        potentialStallMatchesCount: 0,
        exceptionOrIncompleteMatches: 0,
      },
    },
    streamingTelemetry: {
      total: {
        streamingDecisionsCount: 1500,
        matchesWithStreamingCount: 300,
        maxLegalPatternsCount: 1024,
        totalEvaluatedLegalPatternsCount: 500000,
        streamingEvaluationTotalElapsedMs: "UNMEASURED",
        instantiationFailuresCount: 0,
        appliedStreamingIndicesSummary: { "0": 1000, "1": 500 },
        uncompletedMatchesCount: 0,
      },
      training: {
        streamingDecisionsCount: 1000,
        matchesWithStreamingCount: 200,
        maxLegalPatternsCount: 1024,
        totalEvaluatedLegalPatternsCount: 350000,
        streamingEvaluationTotalElapsedMs: "UNMEASURED",
        instantiationFailuresCount: 0,
        appliedStreamingIndicesSummary: { "0": 700, "1": 300 },
        uncompletedMatchesCount: 0,
      },
      validation: {
        streamingDecisionsCount: 500,
        matchesWithStreamingCount: 100,
        maxLegalPatternsCount: 512,
        totalEvaluatedLegalPatternsCount: 150000,
        streamingEvaluationTotalElapsedMs: "UNMEASURED",
        instantiationFailuresCount: 0,
        appliedStreamingIndicesSummary: { "0": 300, "1": 200 },
        uncompletedMatchesCount: 0,
      },
    },
    elapsedTotalMs: 120000.0,
    generationTimings,
    generationTimingStatus: "MEASURED",
    sampledPeakRssBytes: 150000000,
    sampledPeakHeapUsedBytes: 80000000,
    memorySamplingMethod: "Periodic process.memoryUsage() sampling inside sessionFactory",
    memoryMeasurementNote: "Sampled peak observation",
    timingMeasurementNote: "performance.now() measurement",
    throughputMatchesPerSec: 16.0,
    throughputDecisionsPerSec: 2500.0,
    generationMemoryHistory: [],
    generationCheckpointSizes: [],
    diversityHistory: [],
    validationScoresHistory: [],
    evaluatedChampionCandidates: [],
    finalChampion: {
      generation: 9,
      genomeId: "ind-g9-000",
      dnaDigest: champDigest,
      validationMeanWinRate: 0.85,
      selectionReason: "Highest validation win rate",
      isP10Offspring: false,
    },
  };
  fs.writeFileSync(
    path.join(fixtureDir, "campaign-stage3-evolution-metrics.json"),
    JSON.stringify(metrics, null, 2),
    "utf-8"
  );

  // 5. stage3-evolution-evidence.json
  const evidence = {
    workId: WORK_ID,
    gitCommitSha: "mock-commit-sha-1234567890abcdef",
    isGitClean: true,
    actualMatches: {
      training: TOTAL_TRAINING_MATCHES,
      validation: TOTAL_VALIDATION_MATCHES,
      total: TOTAL_EXPERIMENT_MATCHES,
      completed: TOTAL_EXPERIMENT_MATCHES,
      failed: 0,
      incomplete: 0,
    },
    decisionStats: metrics.decisionStats,
    passAndStallTelemetry: metrics.passAndStallTelemetry,
    streamingTelemetry: metrics.streamingTelemetry,
    timings: {
      elapsedTotalMs: 120000.0,
      generationTimings,
      status: "MEASURED",
    },
    championCandidate: metrics.finalChampion,
    holdoutStatus: "PLANNED_UNUSED_IN_THIS_RUN",
    auditStatus: "READY_FOR_PRE_HOLDOUT_REVIEW",
  };
  fs.writeFileSync(
    path.join(fixtureDir, "stage3-evolution-evidence.json"),
    JSON.stringify(evidence, null, 2),
    "utf-8"
  );

  // 6. AUDIT_STAGE3_EVIDENCE.md & STAGE3_AUDIT_REPORT.md
  fs.writeFileSync(path.join(fixtureDir, "AUDIT_STAGE3_EVIDENCE.md"), "# Mock Audit MD", "utf-8");
  fs.writeFileSync(path.join(fixtureDir, "STAGE3_AUDIT_REPORT.md"), "# Mock Audit Report MD", "utf-8");

  // 7. MANIFEST_SHA256.json
  const manifestSha256: Record<string, string> = {};
  for (const f of REQUIRED_STAGE3_AUDIT_FILES) {
    manifestSha256[f] = computeFileSha256(path.join(fixtureDir, f));
  }
  fs.writeFileSync(
    path.join(fixtureDir, "MANIFEST_SHA256.json"),
    JSON.stringify(manifestSha256, null, 2),
    "utf-8"
  );
}

// =============================================================================
// テストスイート
// =============================================================================

describe("Stage 3 Large-Scale Evolution Runner (Work 3-5)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage3-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. 実験条件と定数の整合性", () => {
    it("母集団12、10世代、合計1,920試合の計算契約が正しいこと", () => {
      expect(POPULATION_SIZE).toBe(12);
      expect(TOTAL_GENERATIONS).toBe(10);
      expect(PAIR_REPETITIONS).toBe(1);

      // Training: 12 * 11 = 132 matches / gen -> 10 gens = 1,320
      expect(TOTAL_TRAINING_MATCHES).toBe(1320);

      // Validation: 2 opponents * 15 seeds * 2 legs = 60 matches / gen -> 10 gens = 600
      expect(TOTAL_VALIDATION_MATCHES).toBe(600);

      // Total planned
      expect(TOTAL_EXPERIMENT_MATCHES).toBe(1920);

      // Holdout (planned, unused): 4 opponents * 30 seeds * 2 legs = 240
      expect(HOLDOUT_SEEDS_COUNT).toBe(30);
      expect(TOTAL_HOLDOUT_MATCHES).toBe(240);
    });
  });

  describe("2. Seed 体系導出と衝突検査", () => {
    it("660個の一意Training Seedが決定論的に導出され、内部衝突がゼロであること", () => {
      const plan = generateStage3SeedPlan();
      expect(plan.allTrainingSeedsList.length).toBe(660); // 660 unique pair seeds

      let totalGenMatchesSeeds = 0;
      const uniqueTraining = new Set<number>();
      for (let g = 0; g < TOTAL_GENERATIONS; g++) {
        expect(plan.uniqueTrainingSeedsByGen[g].length).toBe(66);
        expect(plan.trainingSeedsByGeneration[g].length).toBe(132); // 66 pairs * 2 legs
        totalGenMatchesSeeds += plan.trainingSeedsByGeneration[g].length;
        for (const s of plan.uniqueTrainingSeedsByGen[g]) {
          uniqueTraining.add(s);
        }
      }
      expect(totalGenMatchesSeeds).toBe(1320); // 1,320 matches
      expect(uniqueTraining.size).toBe(660);
      expect(plan.validationSeeds.length).toBe(15);
      expect(plan.holdoutSeeds.length).toBe(30);

      // 衝突ゼロの検証
      expect(() => assertNoSeedCollisions(plan)).not.toThrow();
    });

    it("Stage 1 および Stage 2 の使用 Seed と衝突がないこと", () => {
      const plan = generateStage3SeedPlan();
      expect(() => assertNoSeedCollisions(plan)).not.toThrow();
    });
  });

  describe("3. Preflight チェック", () => {
    it("正常な設定で Preflight が PASS すること", async () => {
      const preflight = await runPreflightCheck(tempDir, { allowDirty: true });
      expect(preflight.isValid).toBe(true);
      expect(preflight.errors).toHaveLength(0);
      expect(preflight.manifest.workId).toBe(WORK_ID);
      expect(preflight.manifest.totalPlannedMatches.total).toBe(1920);
      expect(preflight.manifest.holdoutStatus).toBe("PLANNED_UNUSED_IN_THIS_RUN");
    });
  });

  describe("4. PASS テレメトリーおよび対戦カテゴリ判定", () => {
    it("determineMatchCategory が matchSeed と matchId に基づき正しく分類すること", () => {
      const plan = generateStage3SeedPlan();

      const trainCtx = { matchIndex: 0, matchId: "gen-0-match-1", baseSeed: 100, matchSeed: 100, playerSeeds: { p1: 1, p2: 2 } };
      expect(determineMatchCategory(trainCtx, plan)).toBe("TRAINING");

      const valCtx = { matchIndex: 0, matchId: "val-gen-0-cand-vs-first-legal", baseSeed: 94001, matchSeed: 94001, playerSeeds: { p1: 1, p2: 2 } };
      expect(determineMatchCategory(valCtx, plan)).toBe("VALIDATION");
    });

    it("computeGenerationChampionValidationScores が正しくスコアと95% CIを計算すること", () => {
      const mockValResult = {
        pairs: [
          { opponentId: "baseline-first-legal", pairScore: 0.75 },
          { opponentId: "baseline-first-legal", pairScore: 0.5 },
          { opponentId: "baseline-seeded-random", pairScore: 1.0 },
          { opponentId: "baseline-seeded-random", pairScore: 0.75 },
        ],
      };
      const scores = computeGenerationChampionValidationScores(mockValResult, 0);
      expect(scores.generation).toBe(0);
      expect(scores.firstLegalMeanScore).toBe(0.625);
      expect(scores.seededRandomMeanScore).toBe(0.875);
      expect(scores.overallBaselineMeanScore).toBe(0.75);
      expect(scores.confidenceInterval95[0]).toBeLessThanOrEqual(scores.overallBaselineMeanScore);
      expect(scores.confidenceInterval95[1]).toBeGreaterThanOrEqual(scores.overallBaselineMeanScore);
    });
  });

  describe("5. CheckpointStorage ラッパー (InstrumentedCheckpointStorage)", () => {
    it("save 時に実行時間とファイルサイズが記録されること", () => {
      const inMemory = new InMemoryCampaignCheckpointStorage();
      const instrumented = new InstrumentedCheckpointStorage(inMemory);

      const dummyState = { completedGenerations: 3, foo: "bar" };
      instrumented.save("mock/path/cp.json", JSON.stringify(dummyState));

      expect(instrumented.saveDurations[2]).toBeDefined();
      expect(instrumented.saveDurations[2]).toBeGreaterThanOrEqual(0);
      expect(instrumented.savedSizes[2]).toBeGreaterThan(0);
    });
  });

  describe("6. 成果物監査 (auditStage3Artifacts) - 正常系", () => {
    it("完全な Fixture に対し auditStage3Artifacts が PASS すること", () => {
      createMockValidStage3Fixture(tempDir);
      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(true);
      expect(audit.errors).toHaveLength(0);
      expect(audit.checks.manifestComprehensive).toBe(true);
      expect(audit.checks.sha256ChecksumsMatch).toBe(true);
      expect(audit.checks.checkpointIntegrityVerified).toBe(true);
      expect(audit.checks.seedPlanVerified).toBe(true);
      expect(audit.checks.matchesCountMatches).toBe(true);
      expect(audit.checks.decisionStatsFiniteAndValid).toBe(true);
      expect(audit.checks.passAndStallTelemetryValid).toBe(true);
      expect(audit.checks.generationTimingsMeasuredAndValid).toBe(true);
      expect(audit.checks.championDnaDigestMatches).toBe(true);
      expect(audit.checks.championEvaluatedInHistoryNotP10).toBe(true);
      expect(audit.checks.holdoutUnused).toBe(true);
    });
  });

  describe("7. 成果物監査 (auditStage3Artifacts) - Fail-Closed 異常系", () => {
    it("MANIFEST_SHA256.json が存在しない場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      fs.unlinkSync(path.join(tempDir, "MANIFEST_SHA256.json"));

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.errors.some((e) => e.includes("MANIFEST_SHA256.json does not exist"))).toBe(true);
    });

    it("MANIFEST_SHA256.json から必須ファイルが欠落している場合は FAIL (網羅性検証)", () => {
      createMockValidStage3Fixture(tempDir);
      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      delete manifestObj["campaign-stage3-evolution-metrics.json"];
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.manifestComprehensive).toBe(false);
      expect(audit.errors.some((e) => e.includes("campaign-stage3-evolution-metrics.json"))).toBe(true);
    });

    it("ファイルの SHA-256 チェックサムが不一致の場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      // 改ざん
      fs.appendFileSync(path.join(tempDir, "AUDIT_STAGE3_EVIDENCE.md"), "\nTampered!");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.sha256ChecksumsMatch).toBe(false);
    });

    it("試合数が計画1,920試合と不一致の場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      const metricsPath = path.join(tempDir, "campaign-stage3-evolution-metrics.json");
      const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      metrics.totalMatchesExecuted = 1919;
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      // Manifest ハッシュを再計算して整合させても FAIL することを確認
      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestObj["campaign-stage3-evolution-metrics.json"] = computeFileSha256(metricsPath);
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.matchesCountMatches).toBe(false);
    });

    it("PASS テレメトリーの passRatio が非有限値または不正な場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      const metricsPath = path.join(tempDir, "campaign-stage3-evolution-metrics.json");
      const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      delete metrics.passAndStallTelemetry.total.passRatio;
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestObj["campaign-stage3-evolution-metrics.json"] = computeFileSha256(metricsPath);
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.passAndStallTelemetryValid).toBe(false);
    });

    it("世代時間計測が UNMEASURED の場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      const metricsPath = path.join(tempDir, "campaign-stage3-evolution-metrics.json");
      const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      metrics.generationTimingStatus = "UNMEASURED";
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestObj["campaign-stage3-evolution-metrics.json"] = computeFileSha256(metricsPath);
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.generationTimingsMeasuredAndValid).toBe(false);
    });

    it("最終 Champion が Gen 10 (P10 オフスプリング) 扱いの場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      const metricsPath = path.join(tempDir, "campaign-stage3-evolution-metrics.json");
      const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      metrics.finalChampion.generation = 10;
      metrics.finalChampion.isP10Offspring = true;
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestObj["campaign-stage3-evolution-metrics.json"] = computeFileSha256(metricsPath);
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.championEvaluatedInHistoryNotP10).toBe(false);
    });

    it("ストリーミング実体化失敗が存在する場合は FAIL (Fail-Closed)", () => {
      createMockValidStage3Fixture(tempDir);
      const metricsPath = path.join(tempDir, "campaign-stage3-evolution-metrics.json");
      const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      metrics.streamingTelemetry.total.instantiationFailuresCount = 1;
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestObj["campaign-stage3-evolution-metrics.json"] = computeFileSha256(metricsPath);
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.streamingTelemetryValid).toBe(false);
    });

    it("ストリーミングテレメトリーが欠落している場合は FAIL", () => {
      createMockValidStage3Fixture(tempDir);
      const metricsPath = path.join(tempDir, "campaign-stage3-evolution-metrics.json");
      const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      delete metrics.streamingTelemetry;
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      const manifestPath = path.join(tempDir, "MANIFEST_SHA256.json");
      const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestObj["campaign-stage3-evolution-metrics.json"] = computeFileSha256(metricsPath);
      fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), "utf-8");

      const audit = auditStage3Artifacts(tempDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checks.streamingTelemetryValid).toBe(false);
    });
  });

  describe("5. 出力先ディレクトリ安全性・原本保護 (Fail-Closed)", () => {
    it("旧原本ディレクトリを指定した場合は即座に例外をスローすること", () => {
      expect(() => {
        validateArtifactsDirectory(LEGACY_STAGE3_ARTIFACTS_DIR);
      }).toThrow(/Legacy artifacts must be strictly protected/);
    });

    it("非空ディレクトリを指定した場合は即座に例外をスローすること", () => {
      const nonEmptyDir = path.join(tempDir, "non-empty");
      fs.mkdirSync(nonEmptyDir, { recursive: true });
      fs.writeFileSync(path.join(nonEmptyDir, "existing.txt"), "data", "utf-8");

      expect(() => {
        validateArtifactsDirectory(nonEmptyDir);
      }).toThrow(/Output directory must be newly created or empty/);
    });

    it("空ディレクトリまたは存在しない新規ディレクトリは通過すること", () => {
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(() => {
        validateArtifactsDirectory(emptyDir);
      }).not.toThrow();

      const newDir = path.join(tempDir, "brand-new");
      expect(() => {
        validateArtifactsDirectory(newDir);
      }).not.toThrow();
    });

    it("CLI引数および環境変数から出力先を解決できること", () => {
      const customPath = path.resolve(process.cwd(), "custom-out");
      expect(resolveArtifactsDirectoryFromArgs(["--output-dir", "custom-out"])).toBe(customPath);

      process.env.STAGE3_ARTIFACTS_DIR = "env-out";
      expect(resolveArtifactsDirectoryFromArgs([])).toBe(path.resolve(process.cwd(), "env-out"));
      delete process.env.STAGE3_ARTIFACTS_DIR;

      expect(resolveArtifactsDirectoryFromArgs([])).toBe(DEFAULT_STAGE3_ARTIFACTS_DIR);
    });
  });
});
