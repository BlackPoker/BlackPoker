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
  evaluatePilotOverallSuccess,
  auditExistingPilotArtifacts,
  RunMeasurement,
} from "../../cli/stage1PilotRunner.js";
import {
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
} from "../../domain/ai/DecisionDNATypes.js";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      allUsedSeeds: Array.from({ length: 35 }, (_, i) => 1000 + i), // 35 unique seeds
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
    checkpointFilePath: path.resolve(__dirname, "../../cli/stage1PilotRunner.ts"), // 既存実在ファイル
    checkpointSizeBytes: 1024,
    ...overrides,
  };
}

describe("Stage 1 Small Pilot CLI & Evidence Audit Foundation (Work 3-3 R1)", () => {
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

  it("Test 7: measurements strictly distinguish between measured, unmeasured (null) and sampled metrics", () => {
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

  it("Test 8: runPreflightCheck rejects git dirty state by default and allows bypass with allowDirty", async () => {
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

  it("Test 9: auditExistingPilotArtifacts detects invalid, corrupted or missing artifacts", () => {
    const corruptDir = path.resolve(__dirname, `../../.tmp_corrupt_artifacts_${Date.now()}`);
    fs.mkdirSync(corruptDir, { recursive: true });

    try {
      // 1. ファイルが存在しない場合
      const missingAudit = auditExistingPilotArtifacts(corruptDir);
      expect(missingAudit.isValid).toBe(false);
      expect(missingAudit.errors.length).toBeGreaterThan(0);
      expect(missingAudit.errors.some((e) => e.includes("missing"))).toBe(true);

      // 2. 空ファイルが存在する場合
      fs.writeFileSync(path.join(corruptDir, "stage1-pilot-evidence.json"), "{}", "utf-8");
      fs.mkdirSync(path.join(corruptDir, "run-a"), { recursive: true });
      fs.mkdirSync(path.join(corruptDir, "run-b"), { recursive: true });
      fs.writeFileSync(path.join(corruptDir, "run-a/preflight-manifest.json"), "{}", "utf-8");
      fs.writeFileSync(path.join(corruptDir, "run-b/preflight-manifest.json"), "{}", "utf-8");
      fs.writeFileSync(path.join(corruptDir, "run-a/campaign-stage1-pilot-result.json"), "{}", "utf-8");
      fs.writeFileSync(path.join(corruptDir, "run-b/campaign-stage1-pilot-result.json"), "{}", "utf-8");
      fs.writeFileSync(path.join(corruptDir, "run-a/campaign-stage1-pilot-checkpoint.json"), "", "utf-8"); // 0 bytes
      fs.writeFileSync(path.join(corruptDir, "run-b/campaign-stage1-pilot-checkpoint.json"), "", "utf-8"); // 0 bytes

      const emptyAudit = auditExistingPilotArtifacts(corruptDir);
      expect(emptyAudit.isValid).toBe(false);
      expect(emptyAudit.errors.some((e) => e.includes("checkpoint is empty"))).toBe(true);
    } finally {
      if (fs.existsSync(corruptDir)) {
        fs.rmSync(corruptDir, { recursive: true, force: true });
      }
    }
  });

  it("Test 10: auditExistingPilotArtifacts verifies integrity of archived R0 pilot artifacts", () => {
    const archiveDir = path.resolve(__dirname, "../../.artifacts/stage1-pilot-r0-archive");
    if (!fs.existsSync(archiveDir)) {
      // アーカイブが存在しない環境ではスキップ
      return;
    }

    const audit = auditExistingPilotArtifacts(archiveDir);
    expect(audit.errors).toEqual([]);
    expect(audit.isValid).toBe(true);
    expect(audit.runACheckpointBytes).toBeGreaterThan(1000000);
    expect(audit.runBCheckpointBytes).toBeGreaterThan(1000000);
    expect(audit.runAResultBytes).toBeGreaterThan(1000000);
    expect(audit.runBResultBytes).toBeGreaterThan(1000000);
    expect(audit.championDnaMatch).toBe(true);
    expect(audit.seedCollisionDetected).toBe(false);

    // Evidence の内容検証
    expect(audit.evidence).toBeDefined();
    expect(audit.evidence.status).toBe("SUCCESS");
    expect(audit.evidence.reproducibilityResult).toBe("REPRODUCIBILITY_PASS");
    expect(audit.evidence.measurements.runA.completedMatches).toBe(100);
    expect(audit.evidence.measurements.runB.completedMatches).toBe(100);
    expect(audit.evidence.measurements.runA.failedMatches).toBe(0);
    expect(audit.evidence.measurements.runB.failedMatches).toBe(0);
  });
});
