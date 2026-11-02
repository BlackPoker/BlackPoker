import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  WORK_ID,
  REGULATION_ID,
  FRAME_ID,
  POPULATION_SIZE,
  TOTAL_GENERATIONS,
  CAMPAIGN_SEED,
  VALIDATION_SEEDS,
  createStage1InitialPopulation,
  createStage1ValidationOpponents,
  runPreflightCheck,
  getGitStatusInfo,
  computeFileSha256,
  verifyCheckpointIntegrity,
  evaluatePilotOverallSuccess,
  auditExistingPilotArtifacts,
  RunMeasurement,
} from "../../cli/stage1PilotRunner.js";
import {
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
} from "../../domain/ai/DecisionDNATypes.js";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator.js";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// テスト用 Mock 生成ヘルパー
// =============================================================================

function createMockRunMeasurement(overrides?: Partial<RunMeasurement>): RunMeasurement {
  const dummyPop = createStage1InitialPopulation();
  const dummyChampDna = dummyPop.entries[0].dna;
  const dummyChampDigest = EvolutionIndependentEvaluator.computeDnaDigest(dummyChampDna);

  const dummyLogicalResult: any = {
    campaignVersion: 1,
    campaignId: "campaign-stage1-pilot",
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: "1.0.0",
    featureSchemaVersion: 6,
    totalTargetGenerations: 2,
    completedGenerations: 2,
    status: "COMPLETED",
    stopReason: "COMPLETED_NORMALLY",
    seedRegistry: {
      trainingSeedsByGeneration: {},
      validationSeeds: VALIDATION_SEEDS,
      holdoutSeeds: [],
      allUsedSeeds: Array.from({ length: 35 }, (_, i) => 1000 + i),
    },
    finalPopulation: dummyPop,
    provisionalBestChampion: {
      genomeId: "ind-g1-000",
      generation: 1,
      dna: dummyChampDna,
      dnaDigest: dummyChampDigest,
      validationMeanWinRate: 0.5,
    },
    history: [],
    summaryText: "Mock Summary Text",
  };

  return {
    runId: "RUN_A",
    campaignId: "campaign-stage1-pilot",
    artifactsDir: "/dummy/dir",
    executionResult: {
      ...dummyLogicalResult,
      logicalResult: dummyLogicalResult,
      timestamp: new Date().toISOString(),
      runtimeMetrics: {
        timestamp: new Date().toISOString(),
        totalExecutionTimeMs: 10000,
        generationsExecuted: 2,
        totalTrainingMatches: 60,
        totalValidationMatches: 40,
      },
    },
    totalMatchesExecuted: 100,
    trainingMatchesExecuted: 60,
    validationMatchesExecuted: 40,
    completedMatches: 100,
    failedMatches: 0,
    incompleteMatches: 0,
    totalDecisions: 1500,
    trainingDecisions: 900,
    validationDecisions: 600,
    elapsedTotalMs: 10000,
    elapsedTrainingMs: null,
    elapsedValidationMs: null,
    trainingMatchesPerSec: null,
    validationMatchesPerSec: null,
    generationTimesMs: null,
    timingMeasurementNote: "UNMEASURED: Proportional phase breakdown estimation is prohibited.",
    memoryStart: { rss: 100, heapTotal: 50, heapUsed: 30, external: 10, arrayBuffers: 5 },
    memoryEnd: { rss: 120, heapTotal: 60, heapUsed: 40, external: 10, arrayBuffers: 5 },
    sampledPeakRssBytes: 150 * 1024 * 1024,
    sampledPeakHeapUsedBytes: 80 * 1024 * 1024,
    memorySamplingMethod: "SESSION_FACTORY_INVOCATION_SAMPLING",
    memoryMeasurementNote: "SAMPLED_MAXIMUM: Memory was sampled at SessionFactory invocations.",
    checkpointFilePath: path.resolve(__dirname, "../../cli/stage1PilotRunner.ts"),
    checkpointSizeBytes: 1024,
    ...overrides,
  };
}

// =============================================================================
// CI 用完全小規模監査 Fixture 生成ヘルパー
// =============================================================================

function createValidAuditFixture(fixtureRoot: string) {
  const runADir = path.join(fixtureRoot, "run-a");
  const runBDir = path.join(fixtureRoot, "run-b");
  fs.mkdirSync(runADir, { recursive: true });
  fs.mkdirSync(runBDir, { recursive: true });

  const dummyPop = createStage1InitialPopulation();
  const champDna = dummyPop.entries[0].dna;
  const champDigest = EvolutionIndependentEvaluator.computeDnaDigest(champDna);

  // Training Seeds: Gen0 15ペア(30試合), Gen1 15ペア(30試合)
  const gen0Seeds: number[] = [];
  for (let i = 0; i < 15; i++) {
    gen0Seeds.push(1001 + i, 1001 + i); // 座席反転 Leg0, Leg1
  }
  const gen1Seeds: number[] = [];
  for (let i = 0; i < 15; i++) {
    gen1Seeds.push(1016 + i, 1016 + i); // 座席反転 Leg0, Leg1
  }
  const valSeeds = [91001, 91002, 91003, 91004, 91005];

  const uniqueTraining = Array.from(new Set([...gen0Seeds, ...gen1Seeds]));
  const allUsedSeeds = [...uniqueTraining, ...valSeeds]; // 計 35 個

  const seedRegistry = {
    trainingSeedsByGeneration: { 0: gen0Seeds, 1: gen1Seeds },
    validationSeeds: valSeeds,
    holdoutSeeds: [],
    allUsedSeeds,
  };

  const validationOpponentsRecord: any = {
    "baseline-first-legal": {
      opponentId: "baseline-first-legal",
      name: "FirstLegal",
      role: "BASELINE",
      meanPairScore: 0.5,
      targetMet: false,
      evidenceStatus: "VALID",
      improvementStatus: "IMPROVEMENT_UNVERIFIED",
    },
    "baseline-seeded-random": {
      opponentId: "baseline-seeded-random",
      name: "SeededRandom",
      role: "BASELINE",
      meanPairScore: 0.5,
      targetMet: false,
      evidenceStatus: "VALID",
      improvementStatus: "IMPROVEMENT_UNVERIFIED",
    },
  };

  const history = [
    {
      generation: 0,
      candidateGenomeId: "ind-g0-000",
      candidateFitnessScore: 10.0,
      candidateDnaDigest: champDigest,
      isBestChampionUpdated: true,
      validationResult: {
        evaluatorVersion: 1,
        candidateGenomeId: "ind-g0-000",
        candidateDnaDigest: champDigest,
        opponents: validationOpponentsRecord,
        pairs: [],
        totalPairs: 10,
        totalMatches: 20,
      },
      timestamp: "2026-11-03T00:00:00.000Z",
    },
    {
      generation: 1,
      candidateGenomeId: "ind-g1-000",
      candidateFitnessScore: 12.0,
      candidateDnaDigest: champDigest,
      isBestChampionUpdated: true,
      validationResult: {
        evaluatorVersion: 1,
        candidateGenomeId: "ind-g1-000",
        candidateDnaDigest: champDigest,
        opponents: validationOpponentsRecord,
        pairs: [],
        totalPairs: 10,
        totalMatches: 20,
      },
      timestamp: "2026-11-03T00:00:00.000Z",
    },
  ];

  const logicalResult = {
    campaignVersion: 1,
    campaignId: "campaign-stage1-pilot",
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: "1.0.0",
    featureSchemaVersion: 6,
    totalTargetGenerations: 2,
    completedGenerations: 2,
    status: "COMPLETED",
    stopReason: "COMPLETED_NORMALLY",
    provisionalBestChampion: {
      genomeId: "ind-g1-000",
      generation: 1,
      dna: champDna,
      dnaDigest: champDigest,
      validationMeanWinRate: 0.5,
    },
    history,
    finalPopulation: dummyPop,
    seedRegistry,
    summaryText: "Fixture Summary Text",
  };

  const metrics = {
    runId: "RUN_A",
    campaignId: "campaign-stage1-pilot",
    totalMatchesExecuted: 100,
    trainingMatchesExecuted: 60,
    validationMatchesExecuted: 40,
    completedMatches: 100,
    failedMatches: 0,
    incompleteMatches: 0,
    totalDecisions: 1500,
    trainingDecisions: 900,
    validationDecisions: 600,
    elapsedTotalMs: 10000,
    matchesPerSec: 10,
    sampledPeakRssMB: 150,
    sampledPeakHeapUsedMB: 80,
    checkpointSizeBytes: 5000,
  };

  const manifest = {
    workId: WORK_ID,
    gitCommitSha: "mock-fixture-commit-sha",
    isGitClean: true,
    timestamp: "2026-11-03T00:00:00.000Z",
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: "1.0.0",
    featureSchemaVersion: 6,
    campaignSeed: CAMPAIGN_SEED,
    populationSize: 6,
    totalGenerations: 2,
    pairRepetitions: 1,
    plannedTrainingMatchesByGen: { 0: 30, 1: 30 },
    plannedTrainingSeedsByGen: { 0: gen0Seeds, 1: gen1Seeds },
    validationSeeds: valSeeds,
    validationOpponents: [
      { opponentId: "baseline-first-legal", name: "FirstLegal", role: "BASELINE" },
      { opponentId: "baseline-seeded-random", name: "SeededRandom", role: "BASELINE" },
    ],
    earlyStoppingEnabled: false,
    holdoutMatchesPlanned: 0,
    storageClass: "FileCampaignCheckpointStorage",
    artifactsDirectory: fixtureRoot,
  };

  // Checkpoint 作成とチェックサム計算
  const checkpointStateWithoutChecksum = {
    checkpointVersion: 1,
    campaignId: "campaign-stage1-pilot",
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: "1.0.0",
    featureSchemaVersion: 6,
    totalTargetGenerations: 2,
    completedGenerations: 2,
    nextGenerationToProcess: 2,
    nextPopulation: dummyPop,
    provisionalBestChampion: logicalResult.provisionalBestChampion,
    history,
    seedRegistry,
    earlyStoppingState: {
      enabled: false,
      patience: 3,
      minGenerations: 1,
      noImprovementCount: 0,
      bestValidationMeanScore: 0.5,
      triggered: false,
    },
    configSnapshot: {
      campaignId: "campaign-stage1-pilot",
      campaignSeed: CAMPAIGN_SEED,
      regulationId: REGULATION_ID,
      frameId: FRAME_ID,
      rulePackageVersion: "1.0.0",
      featureSchemaVersion: 6,
      totalTargetGenerations: 2,
    },
    timestamp: "2026-11-03T00:00:00.000Z",
  };
  const checksum = EvolutionCampaignManager.computeCheckpointChecksum(checkpointStateWithoutChecksum as any);
  const checkpointState = { ...checkpointStateWithoutChecksum, checksum };

  // Run A ファイル書き出し
  fs.writeFileSync(path.join(runADir, "preflight-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  fs.writeFileSync(path.join(runADir, "campaign-stage1-pilot-result.json"), JSON.stringify(logicalResult, null, 2), "utf-8");
  fs.writeFileSync(path.join(runADir, "campaign-stage1-pilot-metrics.json"), JSON.stringify(metrics, null, 2), "utf-8");
  fs.writeFileSync(path.join(runADir, "campaign-stage1-pilot-checkpoint.json"), JSON.stringify(checkpointState, null, 2), "utf-8");

  // Run B ファイル書き出し (runId のみ変更)
  const metricsB = { ...metrics, runId: "RUN_B" };
  fs.writeFileSync(path.join(runBDir, "preflight-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  fs.writeFileSync(path.join(runBDir, "campaign-stage1-pilot-result.json"), JSON.stringify(logicalResult, null, 2), "utf-8");
  fs.writeFileSync(path.join(runBDir, "campaign-stage1-pilot-metrics.json"), JSON.stringify(metricsB, null, 2), "utf-8");
  fs.writeFileSync(path.join(runBDir, "campaign-stage1-pilot-checkpoint.json"), JSON.stringify(checkpointState, null, 2), "utf-8");

  // Evidence 作成
  const evidence = {
    workId: WORK_ID,
    gitCommitSha: "mock-fixture-commit-sha",
    isGitClean: true,
    timestamp: "2026-11-03T00:00:00.000Z",
    status: "SUCCESS",
    reproducibilityResult: "REPRODUCIBILITY_PASS",
    dnaEvolutionRecord: {
      initialPopulationDigest: champDigest,
      gen0CandidateDigest: champDigest,
      gen1CandidateDigest: champDigest,
      provisionalBestChampionDigest: champDigest,
      gen1ChampionNonZeroWeightsCount: 0,
    },
    generationDetails: [
      {
        generation: 0,
        candidateGenomeId: "ind-g0-000",
        candidateFitnessScore: 10.0,
        candidateDnaDigest: champDigest,
        isBestChampionUpdated: true,
        validationOpponents: validationOpponentsRecord,
      },
      {
        generation: 1,
        candidateGenomeId: "ind-g1-000",
        candidateFitnessScore: 12.0,
        candidateDnaDigest: champDigest,
        isBestChampionUpdated: true,
        validationOpponents: validationOpponentsRecord,
      },
    ],
    measurements: {
      runA: {
        totalMatches: 100,
        completedMatches: 100,
        failedMatches: 0,
        incompleteMatches: 0,
        totalDecisions: 1500,
        trainingDecisions: 900,
        validationDecisions: 600,
        elapsedTotalMs: 10000,
      },
      runB: {
        totalMatches: 100,
        completedMatches: 100,
        failedMatches: 0,
        incompleteMatches: 0,
        totalDecisions: 1500,
        trainingDecisions: 900,
        validationDecisions: 600,
        elapsedTotalMs: 10000,
      },
    },
  };
  fs.writeFileSync(path.join(fixtureRoot, "stage1-pilot-evidence.json"), JSON.stringify(evidence, null, 2), "utf-8");
  fs.writeFileSync(path.join(fixtureRoot, "AUDIT_PROVENANCE_NOTE.md"), "# Mock Provenance Note", "utf-8");

  // MANIFEST_SHA256.json の作成 (全ファイルの実ハッシュを計算して格納)
  const relPaths = [
    "run-a/preflight-manifest.json",
    "run-a/campaign-stage1-pilot-result.json",
    "run-a/campaign-stage1-pilot-metrics.json",
    "run-a/campaign-stage1-pilot-checkpoint.json",
    "run-b/preflight-manifest.json",
    "run-b/campaign-stage1-pilot-result.json",
    "run-b/campaign-stage1-pilot-metrics.json",
    "run-b/campaign-stage1-pilot-checkpoint.json",
    "stage1-pilot-evidence.json",
  ];
  const manifestShaList = relPaths.map((p) => {
    const fullP = path.join(fixtureRoot, p);
    return {
      path: p,
      sha256: computeFileSha256(fullP),
      size: fs.statSync(fullP).size,
    };
  });
  fs.writeFileSync(path.join(fixtureRoot, "MANIFEST_SHA256.json"), JSON.stringify(manifestShaList, null, 2), "utf-8");
}

// =============================================================================
// テストスイート
// =============================================================================

describe("Stage 1 Small Pilot CLI & Evidence Audit Foundation (Work 3-3 R2)", () => {
  const tempTestDir = path.resolve(__dirname, `../../.tmp_stage1_cli_test_${Date.now()}`);

  it("Test 1: createStage1InitialPopulation creates exact N=6 population with valid Decision DNA", () => {
    const pop = createStage1InitialPopulation();
    expect(pop.generation).toBe(0);
    expect(pop.entries.length).toBe(POPULATION_SIZE);
    expect(pop.entries.length).toBe(6);

    for (let i = 0; i < pop.entries.length; i++) {
      const entry = pop.entries[i];
      expect(entry.genomeId).toBe(`ind-g0-${String(i).padStart(3, "0")}`);
      expect(entry.generation).toBe(0);
      expect(entry.dna.dnaFormatVersion).toBe(1);
      expect(entry.dna.featureSchemaVersion).toBe(6);
      expect(entry.dna.patternWeights.length).toBe(DNA_PATTERN_DIMENSION);
      expect(entry.dna.contextPatternWeights.length).toBe(DNA_INTERACTION_DIMENSION);
    }
  });

  it("Test 2: createStage1ValidationOpponents creates exactly FirstLegal and SeededRandom Baseline opponents", () => {
    const opponents = createStage1ValidationOpponents();
    expect(opponents.length).toBe(2);

    const firstLegal = opponents.find((o) => o.opponentId === "baseline-first-legal");
    expect(firstLegal).toBeDefined();
    expect(firstLegal?.role).toBe("BASELINE");
    expect(firstLegal?.name).toBe("FirstLegal");

    const seededRandom = opponents.find((o) => o.opponentId === "baseline-seeded-random");
    expect(seededRandom).toBeDefined();
    expect(seededRandom?.role).toBe("BASELINE");
    expect(seededRandom?.name).toBe("SeededRandom");
  });

  it("Test 3: runPreflightCheck passes on standard environment and generates valid manifest (with allowDirty)", async () => {
    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }

    try {
      const preflight = await runPreflightCheck(tempTestDir, { allowDirty: true });
      expect(preflight.errors).toEqual([]);
      expect(preflight.passed).toBe(true);

      const m = preflight.manifest;
      expect(m.workId).toBe(WORK_ID);
      expect(m.regulationId).toBe(REGULATION_ID);
      expect(m.frameId).toBe(FRAME_ID);
      expect(m.populationSize).toBe(6);
      expect(m.totalGenerations).toBe(2);
      expect(m.pairRepetitions).toBe(1);
      expect(m.campaignSeed).toBe(CAMPAIGN_SEED);
      expect(m.validationSeeds).toEqual(VALIDATION_SEEDS);
      expect(m.earlyStoppingEnabled).toBe(false);
      expect(m.holdoutMatchesPlanned).toBe(0);
      expect(typeof m.isGitClean).toBe("boolean");

      // Training Schedule は各世代 30 試合（計 60 試合）
      expect(m.plannedTrainingMatchesByGen[0]).toBe(30);
      expect(m.plannedTrainingMatchesByGen[1]).toBe(30);
      expect(m.plannedTrainingSeedsByGen[0].length).toBe(30);
      expect(m.plannedTrainingSeedsByGen[1].length).toBe(30);
    } finally {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    }
  });

  it("Test 4: evaluatePilotOverallSuccess rejects when reproducibility fails", () => {
    const runA = createMockRunMeasurement({ runId: "RUN_A" });
    const runB = createMockRunMeasurement({ runId: "RUN_B" });

    const verdict = evaluatePilotOverallSuccess({
      runA,
      runB,
      reproducibilityResult: "REPRODUCIBILITY_FAIL",
      plannedMatchesPerRun: 100,
    });

    expect(verdict.isSuccess).toBe(false);
    expect(verdict.status).toBe("FAILED");
    expect(verdict.conditionCheck.reproducibilityPassed).toBe(false);
    expect(verdict.reasons.some((r) => r.includes("Deterministic reproducibility"))).toBe(true);
  });

  it("Test 5: evaluatePilotOverallSuccess rejects when failed or incomplete matches exist", () => {
    const runA = createMockRunMeasurement({
      runId: "RUN_A",
      completedMatches: 99,
      failedMatches: 1,
    });
    const runB = createMockRunMeasurement({ runId: "RUN_B" });

    const verdict = evaluatePilotOverallSuccess({
      runA,
      runB,
      reproducibilityResult: "REPRODUCIBILITY_PASS",
      plannedMatchesPerRun: 100,
    });

    expect(verdict.isSuccess).toBe(false);
    expect(verdict.status).toBe("FAILED");
    expect(verdict.conditionCheck.noFailedOrIncompleteMatches).toBe(false);
    expect(verdict.reasons.some((r) => r.includes("abnormal matches"))).toBe(true);
  });

  it("Test 6: evaluatePilotOverallSuccess rejects when total match count is insufficient", () => {
    const runA = createMockRunMeasurement({
      runId: "RUN_A",
      totalMatchesExecuted: 99,
      completedMatches: 99,
    });
    const runB = createMockRunMeasurement({ runId: "RUN_B" });

    const verdict = evaluatePilotOverallSuccess({
      runA,
      runB,
      reproducibilityResult: "REPRODUCIBILITY_PASS",
      plannedMatchesPerRun: 100,
    });

    expect(verdict.isSuccess).toBe(false);
    expect(verdict.status).toBe("FAILED");
    expect(verdict.conditionCheck.matchesCountExact).toBe(false);
    expect(verdict.reasons.some((r) => r.includes("total matches executed"))).toBe(true);
  });

  it("Test 7: evaluatePilotOverallSuccess rejects when checkpoint checksum is invalid", () => {
    const tempDir = path.resolve(__dirname, `../../.tmp_chk_integ_test_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const corruptChkPath = path.join(tempDir, "corrupt-checkpoint.json");
      // ファイルは存在しサイズも正常だがチェックサムが不一致の JSON
      fs.writeFileSync(
        corruptChkPath,
        JSON.stringify({
          checkpointVersion: 1,
          campaignId: "campaign-stage1-pilot",
          checksum: "invalid-tampered-checksum-12345",
          completedGenerations: 2,
          seedRegistry: { allUsedSeeds: [] },
          nextPopulation: { entries: [] },
        }),
        "utf-8"
      );

      const runA = createMockRunMeasurement({
        runId: "RUN_A",
        checkpointFilePath: corruptChkPath,
        checkpointSizeBytes: fs.statSync(corruptChkPath).size,
      });
      const runB = createMockRunMeasurement({ runId: "RUN_B" });

      const verdict = evaluatePilotOverallSuccess({
        runA,
        runB,
        reproducibilityResult: "REPRODUCIBILITY_PASS",
        plannedMatchesPerRun: 100,
      });

      expect(verdict.isSuccess).toBe(false);
      expect(verdict.status).toBe("FAILED");
      expect(verdict.conditionCheck.checkpointsIntegrityVerified).toBe(false);
      expect(verdict.reasons.some((r) => r.includes("checkpoint integrity verification failed"))).toBe(true);
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("Test 8: measurements strictly distinguish between measured, unmeasured (null) and sampled metrics", () => {
    const measurement = createMockRunMeasurement();

    // 未測定値は null
    expect(measurement.elapsedTrainingMs).toBeNull();
    expect(measurement.elapsedValidationMs).toBeNull();
    expect(measurement.trainingMatchesPerSec).toBeNull();
    expect(measurement.validationMatchesPerSec).toBeNull();
    expect(measurement.generationTimesMs).toBeNull();
    expect(measurement.timingMeasurementNote).toContain("UNMEASURED");

    // 実測値
    expect(measurement.elapsedTotalMs).toBe(10000);
    expect(measurement.totalMatchesExecuted).toBe(100);

    // サンプリング最大値
    expect(measurement.sampledPeakRssBytes).toBeGreaterThan(0);
    expect(measurement.sampledPeakHeapUsedBytes).toBeGreaterThan(0);
    expect(measurement.memorySamplingMethod).toBe("SESSION_FACTORY_INVOCATION_SAMPLING");
    expect(measurement.memoryMeasurementNote).toContain("SAMPLED_MAXIMUM");
  });

  it("Test 9: runPreflightCheck rejects git dirty state by default and allows bypass with allowDirty", async () => {
    const gitInfo = getGitStatusInfo();
    const testSubDir = path.resolve(__dirname, `../../.tmp_preflight_git_test_${Date.now()}`);
    fs.mkdirSync(testSubDir, { recursive: true });

    try {
      if (!gitInfo.isClean) {
        // 現在の作業ツリーが dirty の場合、デフォルトではエラーになるはず
        const preflightDefault = await runPreflightCheck(testSubDir);
        expect(preflightDefault.passed).toBe(false);
        expect(preflightDefault.errors.some((e) => e.includes("Git working tree is dirty"))).toBe(true);

        // allowDirty: true では Git dirty エラーがバイパスされるはず
        const preflightAllowed = await runPreflightCheck(testSubDir, { allowDirty: true });
        expect(preflightAllowed.passed).toBe(true);
      } else {
        // 作業ツリーが clean の場合はデフォルトでも PASS
        const preflightDefault = await runPreflightCheck(testSubDir);
        expect(preflightDefault.passed).toBe(true);
      }
    } finally {
      if (fs.existsSync(testSubDir)) {
        fs.rmSync(testSubDir, { recursive: true, force: true });
      }
    }
  });

  it("Test 10: auditExistingPilotArtifacts passes on clean self-contained audit fixture", () => {
    const fixtureDir = path.resolve(__dirname, `../../.tmp_valid_audit_fixture_${Date.now()}`);
    fs.mkdirSync(fixtureDir, { recursive: true });

    try {
      createValidAuditFixture(fixtureDir);

      const audit = auditExistingPilotArtifacts(fixtureDir);
      expect(audit.errors).toEqual([]);
      expect(audit.isValid).toBe(true);

      // Checkpoint 完全性
      expect(audit.checkpointIntegrity.runA.isValid).toBe(true);
      expect(audit.checkpointIntegrity.runB.isValid).toBe(true);

      // MANIFEST_SHA256 完全性
      expect(audit.manifestIntegrity.hasManifestShaFile).toBe(true);
      expect(audit.manifestIntegrity.totalFilesChecked).toBe(9);
      expect(audit.manifestIntegrity.matchedFilesCount).toBe(9);
      expect(audit.manifestIntegrity.mismatches).toEqual([]);

      // 照合項目 (全項目 PASS)
      expect(audit.verifications.trainingMatches.status).toBe("PASS");
      expect(audit.verifications.validationMatches.status).toBe("PASS");
      expect(audit.verifications.completionStatus.status).toBe("PASS");
      expect(audit.verifications.abnormalMatches.status).toBe("PASS");
      expect(audit.verifications.totalDecisions.status).toBe("PASS");
      expect(audit.verifications.generationFitness.status).toBe("PASS");
      expect(audit.verifications.validationScores.status).toBe("PASS");
      expect(audit.verifications.championDnaAndDigest.status).toBe("PASS");
      expect(audit.verifications.checkpointCompletedGenerations.status).toBe("PASS");
      expect(audit.verifications.reproducibilityVerdict.status).toBe("PASS");

      // Seed Registry 実構造検証
      expect(audit.seedAudit.runA?.status).toBe("PASS");
      expect(audit.seedAudit.runA?.totalUniqueSeedsUsed).toBe(35);
      expect(audit.seedAudit.runA?.validationSeedsCount).toBe(5);
      expect(audit.seedAudit.runA?.uniqueTrainingSeedsCount).toBe(30);
      expect(audit.seedAudit.runA?.seedCollisionsDetected).toBe(0);
      expect(audit.seedAudit.runA?.seatInversionPairMatchesValid).toBe(true);
      expect(audit.seedAudit.runA?.aggregatedAllUsedSeedsMatch).toBe(true);
      expect(audit.seedAudit.runA?.totalMatchesExplained.totalMatches).toBe(100);

      expect(audit.provenanceNotePresent).toBe(true);
    } finally {
      if (fs.existsSync(fixtureDir)) {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    }
  });

  it("Test 11: auditExistingPilotArtifacts detects various specific integrity failures", () => {
    const fixtureDir = path.resolve(__dirname, `../../.tmp_corrupt_subtests_${Date.now()}`);
    fs.mkdirSync(fixtureDir, { recursive: true });

    try {
      createValidAuditFixture(fixtureDir);

      // 11-A: Metrics の試合数不一致を検出
      const metricsPath = path.join(fixtureRoot(fixtureDir), "run-a/campaign-stage1-pilot-metrics.json");
      const origMetrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
      fs.writeFileSync(metricsPath, JSON.stringify({ ...origMetrics, trainingMatchesExecuted: 59 }, null, 2), "utf-8");

      let audit = auditExistingPilotArtifacts(fixtureDir);
      expect(audit.isValid).toBe(false);
      expect(audit.verifications.trainingMatches.status).toBe("FAIL");
      expect(audit.errors.some((e) => e.includes("Training match count mismatch"))).toBe(true);

      // 復元
      fs.writeFileSync(metricsPath, JSON.stringify(origMetrics, null, 2), "utf-8");

      // 11-B: Checkpoint のチェックサム改ざんを検出
      const chkPath = path.join(fixtureDir, "run-a/campaign-stage1-pilot-checkpoint.json");
      const origChk = JSON.parse(fs.readFileSync(chkPath, "utf-8"));
      fs.writeFileSync(chkPath, JSON.stringify({ ...origChk, checksum: "bad-tampered-checksum" }, null, 2), "utf-8");

      audit = auditExistingPilotArtifacts(fixtureDir);
      expect(audit.isValid).toBe(false);
      expect(audit.checkpointIntegrity.runA.isValid).toBe(false);
      expect(audit.errors.some((e) => e.includes("Checkpoint checksum mismatch"))).toBe(true);

      // 復元
      fs.writeFileSync(chkPath, JSON.stringify(origChk, null, 2), "utf-8");

      // 11-C: Validation スコア不一致を検出
      const resPath = path.join(fixtureDir, "run-a/campaign-stage1-pilot-result.json");
      const origRes = JSON.parse(fs.readFileSync(resPath, "utf-8"));
      const tamperedRes = JSON.parse(JSON.stringify(origRes));
      tamperedRes.history[0].validationResult.opponents["baseline-first-legal"].meanPairScore = 0.999;
      fs.writeFileSync(resPath, JSON.stringify(tamperedRes, null, 2), "utf-8");

      audit = auditExistingPilotArtifacts(fixtureDir);
      expect(audit.isValid).toBe(false);
      expect(audit.verifications.validationScores.status).toBe("FAIL");
      expect(audit.errors.some((e) => e.includes("Validation scores mismatch"))).toBe(true);

      // 復元
      fs.writeFileSync(resPath, JSON.stringify(origRes, null, 2), "utf-8");

      // 11-D: Seed 衝突（世代間重複）を検出
      const tamperedSeedRes = JSON.parse(JSON.stringify(origRes));
      tamperedSeedRes.seedRegistry.trainingSeedsByGeneration[1] = tamperedSeedRes.seedRegistry.trainingSeedsByGeneration[0]; // Gen0 と同シード
      fs.writeFileSync(resPath, JSON.stringify(tamperedSeedRes, null, 2), "utf-8");

      audit = auditExistingPilotArtifacts(fixtureDir);
      expect(audit.isValid).toBe(false);
      expect(audit.errors.some((e) => e.includes("crossGenOverlap=true"))).toBe(true);

      // 復元
      fs.writeFileSync(resPath, JSON.stringify(origRes, null, 2), "utf-8");

      // 11-E: MANIFEST_SHA256 の不一致を検出 (Evidence ファイルを変更)
      const evPath = path.join(fixtureDir, "stage1-pilot-evidence.json");
      fs.writeFileSync(evPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(evPath, "utf-8")), extraNote: "tampered" }, null, 2), "utf-8");

      audit = auditExistingPilotArtifacts(fixtureDir);
      expect(audit.isValid).toBe(false);
      expect(audit.manifestIntegrity.mismatches.length).toBeGreaterThan(0);
      expect(audit.errors.some((e) => e.includes("MANIFEST_SHA256 mismatch"))).toBe(true);
    } finally {
      if (fs.existsSync(fixtureDir)) {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    }

    function fixtureRoot(root: string) {
      return root;
    }
  });

  it("Test 12: auditExistingPilotArtifacts on real R0 archive (audited when present, marked UNVERIFIED when absent)", () => {
    const archiveDir = path.resolve(__dirname, "../../.artifacts/stage1-pilot-r0-archive");
    if (!fs.existsSync(archiveDir)) {
      // アーカイブが存在しない環境（CI ベアラナー等）では、偽りの合格にせず未実施を明示
      console.log("NOTICE: R0 Archive not present in this workspace environment (Audit UNVERIFIED/SKIPPED)");
      expect(fs.existsSync(archiveDir)).toBe(false);
      return;
    }

    // アーカイブが存在する場合は、実機 200 試合の完全監査を実施
    const audit = auditExistingPilotArtifacts(archiveDir);
    expect(audit.errors).toEqual([]);
    expect(audit.isValid).toBe(true);

    // Checkpoint 完全性
    expect(audit.checkpointIntegrity.runA.isValid).toBe(true);
    expect(audit.checkpointIntegrity.runB.isValid).toBe(true);
    expect(audit.runACheckpointBytes).toBeGreaterThan(1000000);
    expect(audit.runBCheckpointBytes).toBeGreaterThan(1000000);

    // MANIFEST_SHA256 完全性 (全ファイルの一致)
    expect(audit.manifestIntegrity.hasManifestShaFile).toBe(true);
    expect(audit.manifestIntegrity.mismatches).toEqual([]);
    expect(audit.manifestIntegrity.matchedFilesCount).toBe(15);

    // 照合項目
    expect(audit.verifications.trainingMatches.status).toBe("PASS");
    expect(audit.verifications.validationMatches.status).toBe("PASS");
    expect(audit.verifications.completionStatus.status).toBe("PASS");
    expect(audit.verifications.abnormalMatches.status).toBe("PASS");
    expect(audit.verifications.totalDecisions.status).toBe("PASS");
    expect(audit.verifications.championDnaAndDigest.status).toBe("PASS");
    expect(audit.verifications.checkpointCompletedGenerations.status).toBe("PASS");
    expect(audit.verifications.reproducibilityVerdict.status).toBe("PASS");

    // Seed 監査 (Training 60試合 = 30シード, Validation 40試合 = 5シード, 合計一意35シード)
    expect(audit.seedAudit.runA?.status).toBe("PASS");
    expect(audit.seedAudit.runA?.totalUniqueSeedsUsed).toBe(35);
    expect(audit.seedAudit.runA?.uniqueTrainingSeedsCount).toBe(30);
    expect(audit.seedAudit.runA?.validationSeedsCount).toBe(5);
    expect(audit.seedAudit.runA?.seedCollisionsDetected).toBe(0);
    expect(audit.seedAudit.runA?.seatInversionPairMatchesValid).toBe(true);
    expect(audit.seedAudit.runA?.aggregatedAllUsedSeedsMatch).toBe(true);

    // 出自メモの存在
    expect(audit.provenanceNotePresent).toBe(true);
  });
});
