import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { RulePackage } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../../engine/session/GameSession";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenerationRunnerConfig } from "../../domain/ai/GenerationRunnerTypes";
import {
  PopulationEntry,
  PopulationSnapshot,
  FitnessEvaluationSnapshot,
  PopulationFitnessEntry,
} from "../../domain/ai/PopulationSelectionTypes";
import {
  EvolutionCampaignConfig,
  EvolutionCampaignConfigurationError,
  EvolutionCampaignExecutionError,
  EvolutionCampaignIntegrityError,
  InMemoryCampaignCheckpointStorage,
} from "../../domain/ai/EvolutionCampaignTypes";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager";
import { FileCampaignCheckpointStorage } from "../../engine/simulation/FileCampaignCheckpointStorage";
import {
  EvaluationOpponentDefinition,
  IndependentEvaluationLogicalResult,
  IndependentEvaluationResult,
  OpponentEvaluationSummary,
} from "../../domain/ai/EvolutionEvaluationTypes";
import { EvolutionLoop } from "../../engine/ai/EvolutionLoop";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import {
  EvolutionGenerationRecord,
  EvolutionLoopExecutionResult,
} from "../../domain/ai/EvolutionLoopTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Evolution Campaign Orchestrator Foundation (Work 3-2)", () => {
  let rulePackage: RulePackage;
  let standardPackSessionCreator: (matchSeed: number) => GameSession;
  let tempTestDir: string;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    const catalog = await loadRegulationCatalog();
    const reg = catalog.regulations.get("standard-pack");
    if (!reg) throw new Error("standard-pack regulation not found");
    const frame = catalog.frames.get(reg.frameId);
    if (!frame) throw new Error(`frame ${reg.frameId} not found`);

    standardPackSessionCreator = (matchSeed: number) => {
      const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
        playerNames: { p1: "Campaign P1", p2: "Campaign P2" },
      });
      if (outcome.type !== "READY") {
        throw new Error(`Failed to setup standard-pack session: ${outcome.reason}`);
      }
      return new GameSession(outcome.state, rulePackage, { matchSeed });
    };

    tempTestDir = path.resolve(__dirname, `../../.tmp_campaign_test_${Date.now()}`);
    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempTestDir)) {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const testSessionFactory = (ctx: BatchMatchContext) => {
    return standardPackSessionCreator(ctx.matchSeed);
  };

  const createTestPopulation = (size: number = 4, generation: number = 0): PopulationSnapshot => {
    const entries: PopulationEntry[] = [];
    for (let i = 0; i < size; i++) {
      const genomeId = `ind-g${generation}-${String(i).padStart(3, "0")}`;
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: `dna-${genomeId}` });
      entries.push({
        genomeId,
        dnaRef: `genome:${genomeId}`,
        generation,
        dna,
      });
    }
    return {
      generation,
      entries,
    };
  };

  const testOpponents: readonly EvaluationOpponentDefinition[] = [
    {
      opponentId: "first-legal",
      name: "FirstLegal Baseline",
      targetWinRate: 0.55,
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(),
    },
  ];

  const defaultRunnerConfig: Partial<GenerationRunnerConfig> = {
    maxDecisionsPerMatch: 500,
    fitnessConfig: {
      minimumCompletedMatches: 1,
      minimumCompletionRate: 0.5,
    },
  };

  // ===========================================================================
  // モック生成ヘルパー
  // ===========================================================================
  function createMockLoopResult(
    sourceGeneration: number,
    campaignSeed: number,
    popSize: number = 4
  ): EvolutionLoopExecutionResult {
    const currentPop = createTestPopulation(popSize, sourceGeneration);
    const nextPop = createTestPopulation(popSize, sourceGeneration + 1);
    const genSeed = 1000 + sourceGeneration;

    const entries: PopulationFitnessEntry[] = currentPop.entries.map((entry, idx) => ({
      genomeId: entry.genomeId,
      result: {
        status: "VALID",
        fitnessScore: 0.5 + idx * 0.1,
        wins: idx,
        losses: popSize - 1 - idx,
        draws: 0,
        completedMatches: popSize - 1,
        scheduledMatches: popSize - 1,
        completionRate: 1.0,
      },
    }));

    const fitnessSnapshot: FitnessEvaluationSnapshot = {
      generation: sourceGeneration,
      context: {
        environmentRef: "test",
        regulationId: "standard-pack",
        frameId: "entry16",
        rulePackageVersion: "1.0.0",
        fitnessConfig: { minimumCompletedMatches: 1, minimumCompletionRate: 0.5 },
        generation: sourceGeneration,
        evaluationScheduleId: "test-sched",
        seedScheduleIdentity: `seed-${genSeed}`,
      },
      entries,
    };

    const genRecord: EvolutionGenerationRecord = {
      status: "ADVANCED",
      stepIndex: sourceGeneration,
      sourceGeneration,
      targetGeneration: sourceGeneration + 1,
      generationSeed: genSeed,
      manifest: {
        generation: sourceGeneration,
        populationSize: popSize,
        pairRepetitions: 1,
        totalMatches: popSize * (popSize - 1),
        generationSeed: genSeed,
        evaluationScheduleId: "test-sched",
        seedScheduleIdentity: `seed-${genSeed}`,
      },
      fitnessSnapshot,
      buildMetadata: {
        sourceGeneration,
        targetGeneration: sourceGeneration + 1,
        generationSeed: genSeed,
        selectionSeed: genSeed + 1,
        populationSize: popSize,
        eliteCount: 1,
        offspringCount: popSize - 1,
        eliteGenomeIds: [currentPop.entries[0].genomeId],
        offspringLineages: [],
      },
    };

    return {
      logicalResult: {
        status: "COMPLETED",
        manifest: {
          campaignSeed,
          initialGeneration: sourceGeneration,
          requestedTransitions: 1,
          targetGeneration: sourceGeneration + 1,
          generationSeedScheduleIdentity: `seed-${campaignSeed}`,
        },
        completedTransitions: 1,
        finalPopulation: nextPop,
        generations: [genRecord],
      },
      runtimeMetrics: {
        totalExecutionTimeMs: 10,
        generations: [],
      },
    };
  }

  function createMockValResult(
    candidateDNA: DecisionDNA,
    meanScore: number = 0.6,
    status: "VALID" | "INVALID_EVIDENCE" = "VALID"
  ): IndependentEvaluationResult {
    const digest = EvolutionIndependentEvaluator.computeDnaDigest(candidateDNA);
    const opponentSummary: OpponentEvaluationSummary = {
      opponentId: "first-legal",
      opponentName: "FirstLegal Baseline",
      role: "BASELINE",
      totalPairs: 2,
      completedPairs: 2,
      incompletePairs: 0,
      failedPairs: 0,
      pairScores: [meanScore, meanScore],
      meanPairScore: meanScore,
      sampleVariance: 0,
      standardError: 0,
      confidenceInterval95: { lower: meanScore, upper: meanScore, confidenceLevel: 0.95 },
      statisticalTest: {
        method: "STUDENT_T",
        pValue: 0.01,
        alphaUsed: 0.05,
        isStatisticallySignificant: meanScore > 0.5,
        oneSidedLowerBound: meanScore - 0.05,
      },
      targetWinRate: 0.55,
      targetMet: meanScore >= 0.55,
      evidenceStatus: status,
      improvementStatus: "IMPROVEMENT_VERIFIED",
    };

    const logicalResult: IndependentEvaluationLogicalResult = {
      evaluatorVersion: 1,
      candidateGenomeId: "test-cand",
      candidateDnaDigest: digest,
      rulePackageVersion: "1.0.0",
      featureSchemaVersion: 6,
      regulationId: "standard-pack",
      seedCategory: "VALIDATION",
      significanceLevelAlpha: 0.05,
      bonferroniAdjustedAlpha: 0.05,
      opponents: { "first-legal": opponentSummary },
      pairs: [],
      totalPairs: 2,
      totalMatches: 4,
      allTargetsMet: meanScore >= 0.55,
      baselineSuperior: true,
      championImproved: true,
      evidenceStatus: status,
      improvementStatus: "IMPROVEMENT_VERIFIED",
      summaryText: "Mock validation result",
    };

    const timestamp = new Date().toISOString();
    return {
      ...logicalResult,
      logicalResult,
      runtimeMetrics: {
        timestamp,
        totalExecutionTimeMs: 1,
      },
      timestamp,
    };
  }

  // ===========================================================================
  // Test 1: 設定の Fail-Fast 入力検証
  // ===========================================================================
  it("Test 1: validateConfig rejects invalid configuration fail-fast", () => {
    const validConfig: EvolutionCampaignConfig = {
      campaignId: "test-campaign-v1",
      campaignSeed: 1000,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [5001, 5002],
      sessionFactory: testSessionFactory,
    };

    // totalGenerations < 1
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, totalGenerations: 0 });
    }).toThrow(EvolutionCampaignConfigurationError);

    // campaignSeed non-finite
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, campaignSeed: NaN });
    }).toThrow(EvolutionCampaignConfigurationError);

    // validationSeeds empty
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, validationSeeds: [] });
    }).toThrow(EvolutionCampaignConfigurationError);

    // validationSeeds duplicate
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, validationSeeds: [5001, 5001] });
    }).toThrow(EvolutionCampaignConfigurationError);

    // significanceLevelAlpha out of bounds
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, significanceLevelAlpha: 0 });
    }).toThrow(EvolutionCampaignConfigurationError);
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, significanceLevelAlpha: 0.5 });
    }).toThrow(EvolutionCampaignConfigurationError);

    // initialPopulation generation != 0
    expect(() => {
      EvolutionCampaignManager.validateConfig({
        ...validConfig,
        initialPopulation: createTestPopulation(4, 1),
      });
    }).toThrow(EvolutionCampaignConfigurationError);

    // initialPopulation entries empty
    expect(() => {
      EvolutionCampaignManager.validateConfig({
        ...validConfig,
        initialPopulation: { generation: 0, entries: [] },
      });
    }).toThrow(EvolutionCampaignConfigurationError);

    // validationOpponents empty
    expect(() => {
      EvolutionCampaignManager.validateConfig({ ...validConfig, validationOpponents: [] });
    }).toThrow(EvolutionCampaignConfigurationError);
  });

  // ===========================================================================
  // Test 2: Champion 候補選定契約 (世代内最上位・決定論的 Tie-Break・P_g 限定)
  // ===========================================================================
  it("Test 2: selectGenerationChampionCandidate selects deterministic best candidate strictly from sourcePopulation", () => {
    const pop = createTestPopulation(4, 0);

    const fitnessSnapshot: FitnessEvaluationSnapshot = {
      generation: 0,
      context: {
        environmentRef: "test",
        regulationId: "standard-pack",
        frameId: "entry16",
        rulePackageVersion: "1.0.0",
        fitnessConfig: {
          minimumCompletedMatches: 1,
          minimumCompletionRate: 0.5,
        },
        generation: 0,
        evaluationScheduleId: "test-schedule",
        seedScheduleIdentity: "test-seed",
      },
      entries: [
        {
          genomeId: "ind-g0-000",
          result: {
            status: "VALID",
            fitnessScore: 0.6,
            wins: 3,
            draws: 0,
            losses: 2,
            completedMatches: 5,
            scheduledMatches: 5,
            completionRate: 1.0,
          },
        },
        {
          genomeId: "ind-g0-001",
          result: {
            status: "VALID",
            fitnessScore: 0.8,
            wins: 4,
            draws: 0,
            losses: 1,
            completedMatches: 5,
            scheduledMatches: 5,
            completionRate: 1.0,
          },
        },
        {
          genomeId: "ind-g0-002",
          result: {
            status: "VALID",
            fitnessScore: 0.8,
            wins: 4,
            draws: 0,
            losses: 1,
            completedMatches: 5,
            scheduledMatches: 5,
            completionRate: 1.0,
          },
        },
        {
          genomeId: "ind-g0-003",
          result: {
            status: "INVALID",
            fitnessScore: null,
            failedMatches: 1,
            scheduledMatches: 5,
          },
        },
      ],
    };

    // 003 は INVALID なので除外。001 と 002 は score=0.8, wins=4 で同点 -> genomeId昇順で ind-g0-001 が選ばれる
    const candidate = EvolutionCampaignManager.selectGenerationChampionCandidate(
      fitnessSnapshot,
      pop
    );

    expect(candidate.genomeId).toBe("ind-g0-001");
    expect(candidate.fitnessScore).toBe(0.8);
    // DNA は必ず sourcePopulation のエントリと一致
    expect(candidate.dna).toBe(pop.entries[1].dna);
  });

  // ===========================================================================
  // Test 3: 多世代ステップ駆動実行 (N=4, G=2, 正常完走)
  // ===========================================================================
  it("Test 3: executes multi-generation campaign step-driven and completes successfully", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      const gen = p.initialPopulation.generation;
      return createMockLoopResult(gen, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-step-driven-v1",
      campaignSeed: 42001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [8001, 8002],
      sessionFactory: testSessionFactory,
      checkpointDir: "memory-checkpoints",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 1,
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);

    expect(result.status).toBe("COMPLETED");
    expect(result.completedGenerations).toBe(2);
    expect(result.totalTargetGenerations).toBe(2);
    expect(result.history.length).toBe(2);
    expect(result.history[0].generation).toBe(0);
    expect(result.history[1].generation).toBe(1);

    // 最終母集団は未対戦 P_2 (generation=2)
    expect(result.finalPopulation.generation).toBe(2);
    expect(result.finalPopulation.entries.length).toBe(4);

    // 暫定 Champion が存在し、isHoldoutVerified は false
    expect(result.provisionalBestChampion).not.toBeNull();
    expect(result.provisionalBestChampion?.isHoldoutVerified).toBe(false);

    // Checkpoint が保存されていること
    expect(memoryStorage.entries.size).toBeGreaterThan(0);
  });

  // ===========================================================================
  // Test 4: Validation 追跡と暫定最良 Champion の更新判定
  // ===========================================================================
  it("Test 4: tracks validation mean score and updates best champion only upon genuine improvement", () => {
    let callCount = 0;
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      callCount++;
      // 第0世代は 0.60, 第1世代は 0.75 (改善)
      const score = callCount === 1 ? 0.6 : 0.75;
      return createMockValResult(p.candidateDNA, score);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-tracking-v1",
      campaignSeed: 55001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [9101, 9102],
      sessionFactory: testSessionFactory,
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);

    expect(result.status).toBe("COMPLETED");
    const h0 = result.history[0];
    const h1 = result.history[1];

    // g0 では初期の暫定最良 Champion が設定されるため isBestChampionUpdated は true
    expect(h0.isBestChampionUpdated).toBe(true);
    // g1 では 0.75 > 0.60 なので更新される
    expect(h1.isBestChampionUpdated).toBe(true);
    expect(result.provisionalBestChampion?.generation).toBe(1);
    expect(result.provisionalBestChampion?.validationMeanWinRate).toBe(0.75);
  });

  // ===========================================================================
  // Test 5: Early Stopping による安全終了 (未改善と異常終了の分離)
  // ===========================================================================
  it("Test 5: early stopping triggers safely on consecutive non-improvement and discards unplayed offspring", () => {
    let callCount = 0;
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      callCount++;
      // g0=0.70, g1=0.60 (未改善), g2=0.55 (未改善) -> patience=2 で g2 後に停止
      const score = callCount === 1 ? 0.7 : callCount === 2 ? 0.6 : 0.55;
      return createMockValResult(p.candidateDNA, score);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-early-stop-v1",
      campaignSeed: 66001,
      totalGenerations: 5,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [10001, 10002],
      sessionFactory: testSessionFactory,
      earlyStopping: {
        patience: 2,
        minGenerations: 0,
      },
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);

    expect(result.status).toBe("EARLY_STOPPED");
    expect(result.stopReason).toContain("Early stopping triggered at generation 2");
    expect(result.completedGenerations).toBe(3); // g=0, 1, 2 まで完了
    // Champion は第0世代のものが維持されている
    expect(result.provisionalBestChampion?.generation).toBe(0);
    expect(result.provisionalBestChampion?.validationMeanWinRate).toBe(0.7);
  });

  // ===========================================================================
  // Test 6: 異常終了時の Fail-Closed (無効 Evidence による中断)
  // ===========================================================================
  it("Test 6: halts campaign fail-closed when validation returns INVALID_EVIDENCE", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.5, "INVALID_EVIDENCE");
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-fail-closed-v1",
      campaignSeed: 77001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [20001, 20002],
      sessionFactory: testSessionFactory,
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);

    expect(result.status).toBe("FAILED");
    expect(result.stopReason).toContain("evidenceStatus=\"INVALID_EVIDENCE\"");
    expect(result.completedGenerations).toBe(0);
  });

  // ===========================================================================
  // Test 7: Seed Registry の衝突防止と追跡保証
  // ===========================================================================
  it("Test 7: ensures seed registry tracks all used seeds without collisions", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const validationSeeds = [20001, 20002];
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-seed-registry-v1",
      campaignSeed: 77001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds,
      sessionFactory: testSessionFactory,
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);

    expect(result.seedRegistry.validationSeeds).toEqual(validationSeeds);
    expect(result.seedRegistry.trainingSeedsByGeneration[0]).toBeDefined();
    expect(result.seedRegistry.trainingSeedsByGeneration[1]).toBeDefined();

    // 全使用済みシードに重複がないこと
    const allSeeds = result.seedRegistry.allUsedSeeds;
    const uniqueSeeds = new Set(allSeeds);
    expect(uniqueSeeds.size).toBe(allSeeds.length);

    // Validation Seeds が allUsedSeeds に含まれていること
    for (const vs of validationSeeds) {
      expect(uniqueSeeds.has(vs)).toBe(true);
    }
  });

  // ===========================================================================
  // Test 8: Checkpoint の原子的保存と完全性 (InMemory & FileStorage)
  // ===========================================================================
  it("Test 8: saves checkpoint atomically with valid SHA-256 checksum", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const fileStorage = new FileCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-checkpoint-save-v1",
      campaignSeed: 88001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [30001, 30002],
      sessionFactory: testSessionFactory,
      checkpointDir: tempTestDir,
      checkpointStorage: fileStorage,
      checkpointIntervalGenerations: 1,
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);
    expect(result.status).toBe("COMPLETED");

    const checkpointFile = path.resolve(tempTestDir, `${config.campaignId}-checkpoint.json`);
    expect(fs.existsSync(checkpointFile)).toBe(true);

    const loaded = EvolutionCampaignManager.loadCheckpoint(
      checkpointFile,
      {
        campaignId: config.campaignId,
        campaignSeed: config.campaignSeed,
      },
      fileStorage
    );

    expect(loaded.campaignId).toBe(config.campaignId);
    expect(loaded.completedGenerations).toBe(1);
    expect(loaded.checksum).toBeDefined();

    // チェックサム検証
    const { checksum, ...withoutChecksum } = loaded;
    const recomputed = EvolutionCampaignManager.computeCheckpointChecksum(withoutChecksum);
    expect(checksum).toBe(recomputed);
  });

  // ===========================================================================
  // Test 9: Checkpoint 改ざん検出 (Fail-Closed Tamper Detection)
  // ===========================================================================
  it("Test 9: rejects corrupted or tampered checkpoint fail-closed", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-tamper-test-v1",
      campaignSeed: 99001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [40001, 40002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-tamper-test-v1-checkpoint.json";
    expect(memoryStorage.exists(checkpointPath)).toBe(true);

    const originalJson = memoryStorage.load(checkpointPath)!;
    const parsed = JSON.parse(originalJson);

    // 1. チェックサム不一致改ざん
    const tamperedChecksum = { ...parsed, checksum: "deadbeef".repeat(8) };
    memoryStorage.save(checkpointPath, JSON.stringify(tamperedChecksum));
    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(
        checkpointPath,
        { campaignId: config.campaignId, campaignSeed: config.campaignSeed },
        memoryStorage
      );
    }).toThrow(EvolutionCampaignIntegrityError);

    // 2. 設定値の不一致改ざん (campaignSeed 改ざん)
    memoryStorage.save(checkpointPath, originalJson); // 元に戻す
    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(
        checkpointPath,
        { campaignId: config.campaignId, campaignSeed: 12345 }, // 異なる seed を期待
        memoryStorage
      );
    }).toThrow(EvolutionCampaignIntegrityError);

    // 3. 世代番号の内部不整合改ざん
    const inconsistentGen = { ...parsed, completedGenerations: 99 };
    const { checksum: _discard, ...withoutChecksum } = inconsistentGen;
    const newChecksum = EvolutionCampaignManager.computeCheckpointChecksum(withoutChecksum);
    inconsistentGen.checksum = newChecksum;
    memoryStorage.save(checkpointPath, JSON.stringify(inconsistentGen));
    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(
        checkpointPath,
        { campaignId: config.campaignId, campaignSeed: config.campaignSeed },
        memoryStorage
      );
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 10: Checkpoint からの Resume と通常実行の論理結果完全一致
  // ===========================================================================
  it("Test 10: resumes from checkpoint and produces identical generation logical results as continuous run", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();

    // Run A: 世代 0 のみ実行してチェックポイント保存
    const configRunA: EvolutionCampaignConfig = {
      campaignId: "campaign-resume-match-v1",
      campaignSeed: 123456,
      totalGenerations: 1, // 世代 0 のみ
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [50001, 50002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 1,
      minimumCompletedPairs: 2,
    };
    const resultRunA = EvolutionCampaignManager.run(configRunA);
    expect(resultRunA.completedGenerations).toBe(1);

    const checkpointPath = "test-dir/campaign-resume-match-v1-checkpoint.json";
    expect(memoryStorage.exists(checkpointPath)).toBe(true);

    // Run B: Checkpoint から再開して世代 1 まで実行 (totalGenerations = 2)
    const configRunB: EvolutionCampaignConfig = {
      ...configRunA,
      totalGenerations: 2,
      resumeFromCheckpointPath: checkpointPath,
    };
    const resultResumed = EvolutionCampaignManager.run(configRunB);
    expect(resultResumed.completedGenerations).toBe(2);
    expect(resultResumed.history.length).toBe(2);

    // Run C: 最初から世代 0〜1 を一括実行 (totalGenerations = 2)
    const memoryStorageC = new InMemoryCampaignCheckpointStorage();
    const configRunC: EvolutionCampaignConfig = {
      ...configRunA,
      totalGenerations: 2,
      checkpointStorage: memoryStorageC,
    };
    const resultContinuous = EvolutionCampaignManager.run(configRunC);
    expect(resultContinuous.completedGenerations).toBe(2);

    // 世代 0 と 世代 1 の論理結果が完全一致すること
    expect(resultResumed.history[0].candidateGenomeId).toBe(
      resultContinuous.history[0].candidateGenomeId
    );
    expect(resultResumed.history[0].candidateDnaDigest).toBe(
      resultContinuous.history[0].candidateDnaDigest
    );
    expect(resultResumed.history[1].candidateGenomeId).toBe(
      resultContinuous.history[1].candidateGenomeId
    );
    expect(resultResumed.history[1].candidateDnaDigest).toBe(
      resultContinuous.history[1].candidateDnaDigest
    );
    expect(resultResumed.provisionalBestChampion?.genomeId).toBe(
      resultContinuous.provisionalBestChampion?.genomeId
    );
    expect(resultResumed.provisionalBestChampion?.dnaDigest).toBe(
      resultContinuous.provisionalBestChampion?.dnaDigest
    );

    // 完了済みの totalGenerations: 2 のまま再開した場合、追加実行されないこと (Double Execution Guard)
    const resumedAgain = EvolutionCampaignManager.run({
      ...configRunB,
      totalGenerations: 2,
      resumeFromCheckpointPath: checkpointPath,
    });
    expect(resumedAgain.completedGenerations).toBe(2);
    expect(resumedAgain.status).toBe("COMPLETED");
  });

  // ===========================================================================
  // Test 11: 最小実機 E2E 対戦統合検証 (N=4, G=1, 実機 SessionFactory)
  // ===========================================================================
  it("Test 11: executes live end-to-end integration with minimal population (N=4, G=1)", () => {
    // モックなしで実機対戦を実行
    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-live-e2e-v1",
      campaignSeed: 33001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0), // N=4 (tournamentSize 3 を満たす最小安定サイズ)
      validationOpponents: testOpponents,
      validationSeeds: [70001], // 1 Seed = 1 ペア (2 試合)
      sessionFactory: testSessionFactory,
      checkpointDir: "live-checkpoints",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 1,
      runnerConfig: {
        maxDecisionsPerMatch: 500,
        fitnessConfig: {
          minimumCompletedMatches: 1,
          minimumCompletionRate: 0.5,
        },
      },
      maxDecisionsPerMatch: 500,
    };

    const result = EvolutionCampaignManager.run(config);

    expect(result.status).toBe("COMPLETED");
    expect(result.completedGenerations).toBe(1);
    expect(result.history.length).toBe(1);
    expect(result.provisionalBestChampion).not.toBeNull();
    expect(result.provisionalBestChampion?.isHoldoutVerified).toBe(false);
    expect(memoryStorage.exists("live-checkpoints/campaign-live-e2e-v1-checkpoint.json")).toBe(true);
  });
});
