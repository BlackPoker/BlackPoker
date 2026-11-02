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
  isEqualCampaignLogicalResult,
  canonicalJsonStringify,
  normalizeCampaignLogicalResult,
} from "../../domain/ai/EvolutionCampaignTypes";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager";
import { FileCampaignCheckpointStorage } from "../../engine/simulation/FileCampaignCheckpointStorage";
import {
  EvaluationOpponentDefinition,
  EvaluationSeedCollisionError,
  IndependentEvaluationLogicalResult,
  IndependentEvaluationResult,
  OpponentEvaluationSummary,
} from "../../domain/ai/EvolutionEvaluationTypes";
import { EvolutionLoop } from "../../engine/ai/EvolutionLoop";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import { GenerationRunner } from "../../engine/ai/GenerationRunner";
import { deriveSeed } from "../../engine/random/DeterministicShuffle";
import { canonicalGenerationStreamKey } from "../../domain/ai/EvolutionLoopTypes";
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
      pairs: [
        {
          pairIndex: 0,
          matchSeed: 9991,
          opponentId: "first-legal",
          candidateGenomeId: "test-cand",
          candidateDnaDigest: digest,
          leg0: {
            legIndex: 0,
            candidateSeat: "p1",
            opponentSeat: "p2",
            completed: true,
            candidateWon: true,
            candidateDraw: false,
            candidateLost: false,
            totalDecisions: 10,
            turnCount: 5,
            failed: false,
            incomplete: false,
          },
          leg1: {
            legIndex: 1,
            candidateSeat: "p2",
            opponentSeat: "p1",
            completed: true,
            candidateWon: true,
            candidateDraw: false,
            candidateLost: false,
            totalDecisions: 10,
            turnCount: 5,
            failed: false,
            incomplete: false,
          },
          pairScore: meanScore,
          status: "COMPLETED",
        },
      ],
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
      allowCampaignExtension: true,
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

    // 世代 0 と 世代 1 の論理結果が完全一致すること (isEqualCampaignLogicalResult による厳格ディープ照合)
    expect(isEqualCampaignLogicalResult(resultResumed.logicalResult, resultContinuous.logicalResult)).toBe(true);

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
        builderConfig: {
          populationSize: 4,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 1,
          },
          geneticOperatorConfig: {
            mutationRate: 0.1,
            mutationSigma: 0.05,
            mutationClampMin: -1.0,
            mutationClampMax: 1.0,
            maxSelfMatingRetries: 5,
          },
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

  // ===========================================================================
  // Test 12: 実対戦した Training Seed が空にならず正本スケジュール件数と一致する
  // ===========================================================================
  it("Test 12: records non-empty training seeds from authoritative schedule", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-training-seeds-v1",
      campaignSeed: 44001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [80001, 80002],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);
    expect(result.status).toBe("COMPLETED");

    // 第0世代の Training Seeds が正本スケジュール件数 (N*(N-1)*R = 4*3*1 = 12) と一致すること
    const gen0TrainingSeeds = result.seedRegistry.trainingSeedsByGeneration[0];
    expect(gen0TrainingSeeds).toBeDefined();
    expect(gen0TrainingSeeds.length).toBe(12);
    for (const seed of gen0TrainingSeeds) {
      expect(typeof seed).toBe("number");
      expect(Number.isFinite(seed)).toBe(true);
    }
  });

  // ===========================================================================
  // Test 13: Training match count が実スケジュール件数と一致する
  // ===========================================================================
  it("Test 13: trainingMatchCount matches planned schedule length", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const pop = createTestPopulation(4, 0);
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-match-count-v1",
      campaignSeed: 55001,
      totalGenerations: 1,
      initialPopulation: pop,
      validationOpponents: testOpponents,
      validationSeeds: [90001, 90002],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const result = EvolutionCampaignManager.run(config);
    const expectedSchedule = GenerationRunner.planSchedule(
      pop,
      deriveSeed(config.campaignSeed, canonicalGenerationStreamKey(0)),
      1
    );

    expect(result.history[0].trainingMatchCount).toBe(expectedSchedule.length);
    expect(result.runtimeMetrics.totalTrainingMatches).toBe(expectedSchedule.length);
  });

  // ===========================================================================
  // Test 14: Training / Validation の Seed 衝突で Fail-Closed 拒絶する
  // ===========================================================================
  it("Test 14: rejects training and validation seed collision fail-closed", () => {
    const pop = createTestPopulation(4, 0);
    const campaignSeed = 66001;
    const g0Seed = deriveSeed(campaignSeed, canonicalGenerationStreamKey(0));
    const plannedSchedule = GenerationRunner.planSchedule(pop, g0Seed, 1);
    const collidingSeed = plannedSchedule[0].matchSeed;

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-seed-collision-v1",
      campaignSeed,
      totalGenerations: 1,
      initialPopulation: pop,
      validationOpponents: testOpponents,
      validationSeeds: [collidingSeed, 99999], // Training seed と衝突させる
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    expect(() => {
      EvolutionCampaignManager.run(config);
    }).toThrow(EvaluationSeedCollisionError);
  });

  // ===========================================================================
  // Test 15: Checkpoint 内の Validation 履歴改変を検知して拒絶する
  // ===========================================================================
  it("Test 15: rejects tampered validation history in checkpoint", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-tamper-val-history-v1",
      campaignSeed: 77001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [110001, 110002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-tamper-val-history-v1-checkpoint.json";
    const originalJson = memoryStorage.load(checkpointPath)!;
    const parsed = JSON.parse(originalJson);

    // history 内の candidateFitnessScore を改ざん
    parsed.history[0].candidateFitnessScore = 999.9;
    memoryStorage.save(checkpointPath, JSON.stringify(parsed));

    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(checkpointPath, config, memoryStorage);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 16: Checkpoint 内の Seed Registry 配列改変を検知して拒絶する
  // ===========================================================================
  it("Test 16: rejects tampered seed registry in checkpoint", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-tamper-seeds-v1",
      campaignSeed: 88001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [120001, 120002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-tamper-seeds-v1-checkpoint.json";
    const originalJson = memoryStorage.load(checkpointPath)!;
    const parsed = JSON.parse(originalJson);

    // seedRegistry 内の配列要素を改ざん
    parsed.seedRegistry.trainingSeedsByGeneration[0][0] = 9999999;
    memoryStorage.save(checkpointPath, JSON.stringify(parsed));

    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(checkpointPath, config, memoryStorage);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 17: Champion DNA 本体と Digest 不一致を検知して拒絶する
  // ===========================================================================
  it("Test 17: rejects mismatched champion DNA and dnaDigest even if checksum recomputed", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-dna-digest-mismatch-v1",
      campaignSeed: 99002,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [130001, 130002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-dna-digest-mismatch-v1-checkpoint.json";
    const originalJson = memoryStorage.load(checkpointPath)!;
    const parsed = JSON.parse(originalJson);

    // provisionalBestChampion.dna の重みを改ざんし、dnaDigest と不一致にする
    parsed.provisionalBestChampion.dna.patternWeights = [...parsed.provisionalBestChampion.dna.patternWeights];
    parsed.provisionalBestChampion.dna.patternWeights[0] = 999.0;
    // チェックサムを再計算してチェックサム検証をすり抜けさせようとする
    const { checksum: _discard, ...withoutChecksum } = parsed;
    parsed.checksum = EvolutionCampaignManager.computeCheckpointChecksum(withoutChecksum);
    memoryStorage.save(checkpointPath, JSON.stringify(parsed));

    // DNA Digest 不一致により拒絶されること
    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(checkpointPath, config, memoryStorage);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 18: Runner 設定変更で Resume を Fail-Closed 拒絶する
  // ===========================================================================
  it("Test 18: rejects resume when runnerConfig differs from checkpoint", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-runner-change-v1",
      campaignSeed: 101001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [140001, 140002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
      runnerConfig: {
        pairRepetitions: 1,
      },
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-runner-change-v1-checkpoint.json";

    // 異なる runnerConfig で resume を試みる
    const resumeConfig: EvolutionCampaignConfig = {
      ...config,
      totalGenerations: 2,
      runnerConfig: {
        pairRepetitions: 2, // 変更
      },
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };

    expect(() => {
      EvolutionCampaignManager.run(resumeConfig);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 19: Validation 設定変更で Resume を Fail-Closed 拒絶する
  // ===========================================================================
  it("Test 19: rejects resume when validation settings differ from checkpoint", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-val-change-v1",
      campaignSeed: 102001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [150001, 150002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
      significanceLevelAlpha: 0.05,
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-val-change-v1-checkpoint.json";

    // 異なる validationSeeds で resume を試みる
    const resumeConfigDiffSeeds: EvolutionCampaignConfig = {
      ...config,
      totalGenerations: 2,
      validationSeeds: [150001, 999999], // 変更
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };
    expect(() => {
      EvolutionCampaignManager.run(resumeConfigDiffSeeds);
    }).toThrow(EvolutionCampaignIntegrityError);

    // 異なる significanceLevelAlpha で resume を試みる
    const resumeConfigDiffAlpha: EvolutionCampaignConfig = {
      ...config,
      totalGenerations: 2,
      significanceLevelAlpha: 0.01, // 変更
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };
    expect(() => {
      EvolutionCampaignManager.run(resumeConfigDiffAlpha);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 20: 永続 Storage 設定不足で Fail-Fast 拒絶する
  // ===========================================================================
  it("Test 20: fails fast when checkpointDir or resume path is set without storage adapter", () => {
    const configWithDirOnly: EvolutionCampaignConfig = {
      campaignId: "campaign-storage-missing-v1",
      campaignSeed: 103001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [160001, 160002],
      sessionFactory: testSessionFactory,
      checkpointDir: "/some/path",
      checkpointStorage: undefined, // 未指定
      minimumCompletedPairs: 2,
    };

    expect(() => {
      EvolutionCampaignManager.run(configWithDirOnly);
    }).toThrow(EvolutionCampaignConfigurationError);

    const configWithResumeOnly: EvolutionCampaignConfig = {
      campaignId: "campaign-storage-missing-v2",
      campaignSeed: 103002,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [160001, 160002],
      sessionFactory: testSessionFactory,
      resumeFromCheckpointPath: "/some/checkpoint.json",
      checkpointStorage: undefined, // 未指定
      minimumCompletedPairs: 2,
    };

    expect(() => {
      EvolutionCampaignManager.run(configWithResumeOnly);
    }).toThrow(EvolutionCampaignConfigurationError);
  });

  // ===========================================================================
  // Test 21: 同一 Campaign の中断再開と連続実行の論理結果一致（allowCampaignExtension 契約）
  // ===========================================================================
  it("Test 21: validates allowCampaignExtension contract and logical result identity", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const configBase: EvolutionCampaignConfig = {
      campaignId: "campaign-extension-test-v1",
      campaignSeed: 104001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [170001, 170002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    // 1世代実行して保存
    EvolutionCampaignManager.run(configBase);
    const checkpointPath = "test-dir/campaign-extension-test-v1-checkpoint.json";

    // allowCampaignExtension なしで 2世代への延長を試みると拒絶されること
    const resumeWithoutExtensionFlag: EvolutionCampaignConfig = {
      ...configBase,
      totalGenerations: 2,
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: false,
    };
    expect(() => {
      EvolutionCampaignManager.run(resumeWithoutExtensionFlag);
    }).toThrow(EvolutionCampaignIntegrityError);

    // allowCampaignExtension: true で再開
    const resumeWithExtension: EvolutionCampaignConfig = {
      ...configBase,
      totalGenerations: 2,
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };
    const resultResumed = EvolutionCampaignManager.run(resumeWithExtension);

    // 最初から 2世代連続実行
    const memoryStorageCont = new InMemoryCampaignCheckpointStorage();
    const resultContinuous = EvolutionCampaignManager.run({
      ...configBase,
      totalGenerations: 2,
      checkpointStorage: memoryStorageCont,
    });

    expect(isEqualCampaignLogicalResult(resultResumed.logicalResult, resultContinuous.logicalResult)).toBe(true);
  });

  // ===========================================================================
  // Test 22: 異常終了時の診断 Evidence（FAIL-SAFE）と世代非前進の保証
  // ===========================================================================
  it("Test 22: records diagnosticInfo and preserves completedGenerations on abort", () => {
    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-diagnostic-test-v1",
      campaignSeed: 105001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [180001, 180002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    // Case A: EvolutionLoop が REEVALUATION_REQUIRED で停止した場合
    vi.spyOn(EvolutionLoop, "run").mockReturnValueOnce({
      logicalResult: {
        status: "REEVALUATION_REQUIRED",
        reason: "Insufficient completed matches across population",
        generations: [],
        readiness: { status: "REEVALUATION_REQUIRED", validCount: 0, requiredCount: 2 },
      } as any,
      runtimeMetrics: { totalExecutionTimeMs: 10, generations: [] },
    });

    const resultReeval = EvolutionCampaignManager.run(config);
    expect(resultReeval.status).toBe("REEVALUATION_REQUIRED");
    expect(resultReeval.completedGenerations).toBe(0); // 世代が進んでいないこと
    expect(resultReeval.diagnosticInfo).toBeDefined();
    expect(resultReeval.diagnosticInfo?.failedGeneration).toBe(0);
    expect(resultReeval.diagnosticInfo?.status).toBe("REEVALUATION_REQUIRED");
    expect(resultReeval.diagnosticInfo?.trainingStatus.isCompleted).toBe(false);
    expect(resultReeval.diagnosticInfo?.canResume).toBe(false);

    // Case B: Validation 評価が INVALID_EVIDENCE で失敗した場合
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockReturnValueOnce({
      candidateGenomeId: "mock-cand",
      candidateDnaDigest: "mock-digest",
      seeds: [180001, 180002],
      seedCategory: "VALIDATION",
      opponents: {},
      evidenceStatus: "INVALID_EVIDENCE",
      improvementStatus: "IMPROVEMENT_UNVERIFIED",
      totalMatches: 4,
      completedMatches: 0,
      summaryText: "Validation failed: insufficient matches",
    } as any);

    const resultValFail = EvolutionCampaignManager.run(config);
    expect(resultValFail.status).toBe("FAILED");
    expect(resultValFail.completedGenerations).toBe(0); // 世代が進んでいないこと
    expect(resultValFail.diagnosticInfo).toBeDefined();
    expect(resultValFail.diagnosticInfo?.failedGeneration).toBe(0);
    expect(resultValFail.diagnosticInfo?.status).toBe("FAILED");
    expect(resultValFail.diagnosticInfo?.trainingStatus.isCompleted).toBe(true);
    expect(resultValFail.diagnosticInfo?.validationStatus?.evidenceStatus).toBe("INVALID_EVIDENCE");
  });

  // ===========================================================================
  // Test 23: 正規化論理結果の全フィールド比較（完全一致）
  // ===========================================================================
  it("Test 23: verifies isEqualCampaignLogicalResult with identical logical properties", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-23",
      campaignSeed: 230001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2301, 2302],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const resA = EvolutionCampaignManager.run(config);
    const resB = EvolutionCampaignManager.run(config);

    expect(isEqualCampaignLogicalResult(resA.logicalResult, resB.logicalResult)).toBe(true);
  });

  // ===========================================================================
  // Test 24: DNA 変更による比較不一致の検知
  // ===========================================================================
  it("Test 24: detects DNA modification in finalPopulation or provisionalBestChampion", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-24",
      campaignSeed: 240001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2401, 2402],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const resA = EvolutionCampaignManager.run(config);
    const resB = EvolutionCampaignManager.run(config);

    // 1. finalPopulation の DNA 重みを改変
    const tamperedFinalPop = JSON.parse(JSON.stringify(resB.logicalResult));
    tamperedFinalPop.finalPopulation.entries[0].dna.patternWeights = [
      ...tamperedFinalPop.finalPopulation.entries[0].dna.patternWeights,
    ];
    tamperedFinalPop.finalPopulation.entries[0].dna.patternWeights[0] = 999.0;
    expect(isEqualCampaignLogicalResult(resA.logicalResult, tamperedFinalPop)).toBe(false);

    // 2. provisionalBestChampion の DNA 重みを改変
    const tamperedChampion = JSON.parse(JSON.stringify(resB.logicalResult));
    tamperedChampion.provisionalBestChampion.dna.patternWeights = [
      ...tamperedChampion.provisionalBestChampion.dna.patternWeights,
    ];
    tamperedChampion.provisionalBestChampion.dna.patternWeights[0] = 888.0;
    expect(isEqualCampaignLogicalResult(resA.logicalResult, tamperedChampion)).toBe(false);
  });

  // ===========================================================================
  // Test 25: Validation 結果変更による比較不一致の検知
  // ===========================================================================
  it("Test 25: detects validation result modification", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-25",
      campaignSeed: 250001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2501, 2502],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const resA = EvolutionCampaignManager.run(config);
    const resB = EvolutionCampaignManager.run(config);

    // validationResult の pairs スコアを変更
    const tampered = JSON.parse(JSON.stringify(resB.logicalResult));
    tampered.history[0].validationResult.pairs[0].pairScore = 0.0;
    expect(isEqualCampaignLogicalResult(resA.logicalResult, tampered)).toBe(false);

    // validationResult の opponent meanPairScore を変更
    const tamperedOpp = JSON.parse(JSON.stringify(resB.logicalResult));
    tamperedOpp.history[0].validationResult.opponents["first-legal"].meanPairScore = 0.99;
    expect(isEqualCampaignLogicalResult(resA.logicalResult, tamperedOpp)).toBe(false);
  });

  // ===========================================================================
  // Test 26: Seed Registry 変更による比較不一致の検知
  // ===========================================================================
  it("Test 26: detects seed registry modification", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-26",
      campaignSeed: 260001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2601, 2602],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const resA = EvolutionCampaignManager.run(config);
    const resB = EvolutionCampaignManager.run(config);

    // allUsedSeeds の改変
    const tamperedSeeds = JSON.parse(JSON.stringify(resB.logicalResult));
    tamperedSeeds.seedRegistry.allUsedSeeds.push(999999);
    expect(isEqualCampaignLogicalResult(resA.logicalResult, tamperedSeeds)).toBe(false);
  });

  // ===========================================================================
  // Test 27: タイムスタンプ差だけでは一致（決定論的論理同一性）
  // ===========================================================================
  it("Test 27: considers results equal even if generation timestamps differ", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-27",
      campaignSeed: 270001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2701, 2702],
      sessionFactory: testSessionFactory,
      checkpointStorage: new InMemoryCampaignCheckpointStorage(),
      minimumCompletedPairs: 2,
    };

    const resA = EvolutionCampaignManager.run(config);
    const tamperedTs = JSON.parse(JSON.stringify(resA.logicalResult));
    tamperedTs.history[0].timestamp = "2099-12-31T23:59:59.999Z";

    expect(isEqualCampaignLogicalResult(resA.logicalResult, tamperedTs)).toBe(true);
  });

  // ===========================================================================
  // Test 28: Campaign 延長時の目標世代数縮小要求の Fail-Closed 拒絶
  // ===========================================================================
  it("Test 28: rejects reduction of target generations on campaign extension", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const configBase: EvolutionCampaignConfig = {
      campaignId: "campaign-test-28",
      campaignSeed: 280001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2801, 2802],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 2,
      minimumCompletedPairs: 2,
    };

    const runRes = EvolutionCampaignManager.run(configBase);
    expect(runRes.completedGenerations).toBe(2);

    const checkpointPath = "test-dir/campaign-test-28-checkpoint.json";
    // チェックポイントの totalTargetGenerations を 10 に書き換える (元々の目標が 10 だった状態を再現)
    const originalJson = memoryStorage.load(checkpointPath)!;
    const parsed = JSON.parse(originalJson);
    parsed.totalTargetGenerations = 10;
    parsed.configSnapshot.totalTargetGenerations = 10;
    const { checksum: _discard, ...withoutChecksum } = parsed;
    parsed.checksum = EvolutionCampaignManager.computeCheckpointChecksum(withoutChecksum);
    memoryStorage.save(checkpointPath, JSON.stringify(parsed));

    // allowCampaignExtension: true で、元々の目標10を下回る 3 で再開要求 -> 拒絶
    const resumeConfigShrink: EvolutionCampaignConfig = {
      ...configBase,
      totalGenerations: 3, // 10 未満
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };

    expect(() => {
      EvolutionCampaignManager.run(resumeConfigShrink);
    }).toThrow(EvolutionCampaignIntegrityError);

    // 10 以上の場合は再開できること
    const resumeConfigValid: EvolutionCampaignConfig = {
      ...configBase,
      totalGenerations: 10,
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };
    expect(() => {
      EvolutionCampaignManager.loadCheckpoint(checkpointPath, resumeConfigValid, memoryStorage);
    }).not.toThrow();
  });

  // ===========================================================================
  // Test 29: builderConfig.populationSize 変更による Resume 拒絶
  // ===========================================================================
  it("Test 29: rejects resume when builderConfig.populationSize differs", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-29",
      campaignSeed: 290001,
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [2901, 2902],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
      runnerConfig: {
        builderConfig: {
          populationSize: 4,
        },
      },
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-test-29-checkpoint.json";

    // populationSize を 8 に変更して再開を試みる
    const resumeConfigDiffPop: EvolutionCampaignConfig = {
      ...config,
      totalGenerations: 2,
      runnerConfig: {
        builderConfig: {
          populationSize: 8,
        },
      },
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };

    expect(() => {
      EvolutionCampaignManager.run(resumeConfigDiffPop);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 30: 実行環境識別子 (environmentRef) 不一致による Resume 拒絶
  // ===========================================================================
  it("Test 30: rejects resume when environmentRef differs", () => {
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-30",
      campaignSeed: 300001,
      environmentRef: "env-production-v1",
      totalGenerations: 1,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [3001, 3002],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      minimumCompletedPairs: 2,
    };

    EvolutionCampaignManager.run(config);
    const checkpointPath = "test-dir/campaign-test-30-checkpoint.json";

    // 異なる environmentRef で再開を試行
    const resumeConfigDiffEnv: EvolutionCampaignConfig = {
      ...config,
      environmentRef: "env-production-v2",
      totalGenerations: 2,
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    };

    expect(() => {
      EvolutionCampaignManager.run(resumeConfigDiffEnv);
    }).toThrow(EvolutionCampaignIntegrityError);
  });

  // ===========================================================================
  // Test 31: Checkpoint 未保存時の中断における canResume = false の検証
  // ===========================================================================
  it("Test 31: reports canResume = false when no checkpoint has been saved", () => {
    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-31",
      campaignSeed: 310001,
      totalGenerations: 3,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [3101, 3102],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 3, // 第3世代完了まで保存しない
      minimumCompletedPairs: 2,
    };

    // 第0世代で REEVALUATION_REQUIRED
    vi.spyOn(EvolutionLoop, "run").mockReturnValueOnce({
      logicalResult: {
        status: "REEVALUATION_REQUIRED",
        reason: "Test failure",
        generations: [],
        readiness: { status: "REEVALUATION_REQUIRED", validCount: 0, requiredCount: 2 },
      } as any,
      runtimeMetrics: { totalExecutionTimeMs: 10, generations: [] },
    });

    const result = EvolutionCampaignManager.run(config);
    expect(result.status).toBe("REEVALUATION_REQUIRED");
    expect(result.diagnosticInfo).toBeDefined();
    expect(result.diagnosticInfo?.canResume).toBe(false);
    expect(result.diagnosticInfo?.lastValidCheckpointGeneration).toBeUndefined();
    // 診断ファイルは保存されること
    expect(result.diagnosticInfo?.diagnosticFilePath).toBe("test-dir/campaign-test-31-diagnostic.json");
    expect(memoryStorage.exists("test-dir/campaign-test-31-diagnostic.json")).toBe(true);
    // checkpoint ファイルは未作成であること
    expect(memoryStorage.exists("test-dir/campaign-test-31-checkpoint.json")).toBe(false);
  });

  // ===========================================================================
  // Test 32: Checkpoint 間隔を跨ぐ中断・再開
  // ===========================================================================
  it("Test 32: canResume references last saved checkpoint across interval generations", () => {
    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-32",
      campaignSeed: 320001,
      totalGenerations: 4,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [3201, 3202],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 2, // 世代2 (completedGenerations: 2) で保存
      minimumCompletedPairs: 2,
    };

    let genCount = 0;
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      if (genCount < 2) {
        genCount++;
        return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
      }
      return {
        logicalResult: {
          status: "REEVALUATION_REQUIRED",
          reason: "Failure at gen 2",
          generations: [],
          readiness: { status: "REEVALUATION_REQUIRED", validCount: 0, requiredCount: 2 },
        } as any,
        runtimeMetrics: { totalExecutionTimeMs: 10, generations: [] },
      };
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const result = EvolutionCampaignManager.run(config);
    expect(result.status).toBe("REEVALUATION_REQUIRED");
    expect(result.completedGenerations).toBe(2);
    // completedGenerations: 2 で checkpointIntervalGenerations: 2 を満たしたため保存されている
    expect(result.diagnosticInfo?.canResume).toBe(true);
    expect(result.diagnosticInfo?.lastValidCheckpointGeneration).toBe(2);
    expect(memoryStorage.exists("test-dir/campaign-test-32-checkpoint.json")).toBe(true);
  });

  // ===========================================================================
  // Test 33: 異常終了時の診断 Evidence（別名ファイル）の安全永続化
  // ===========================================================================
  it("Test 33: preserves existing checkpoint and writes separate diagnostic file on abort", () => {
    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const config: EvolutionCampaignConfig = {
      campaignId: "campaign-test-33",
      campaignSeed: 330001,
      totalGenerations: 3,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [3301, 3302],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 1, // 毎世代保存
      minimumCompletedPairs: 2,
    };

    // 世代0は成功させてチェックポイントを保存
    let genCount = 0;
    vi.spyOn(EvolutionLoop, "run").mockImplementation((p) => {
      if (genCount === 0) {
        genCount++;
        return createMockLoopResult(p.initialPopulation.generation, p.campaignSeed, 4);
      }
      return {
        logicalResult: {
          status: "REEVALUATION_REQUIRED",
          reason: "Aborted at gen 1",
          generations: [],
          readiness: { status: "REEVALUATION_REQUIRED", validCount: 0, requiredCount: 2 },
        } as any,
        runtimeMetrics: { totalExecutionTimeMs: 10, generations: [] },
      };
    });
    vi.spyOn(EvolutionIndependentEvaluator, "evaluate").mockImplementation((p) => {
      return createMockValResult(p.candidateDNA, 0.6);
    });

    const result = EvolutionCampaignManager.run(config);
    expect(result.status).toBe("REEVALUATION_REQUIRED");

    // 正常なチェックポイントファイルが存在し、世代0の内容を保持していること
    const checkpointPath = "test-dir/campaign-test-33-checkpoint.json";
    expect(memoryStorage.exists(checkpointPath)).toBe(true);
    const ckpt = JSON.parse(memoryStorage.load(checkpointPath)!);
    expect(ckpt.completedGenerations).toBe(1);

    // 診断ファイルが別名で保存され、正常チェックポイントを破壊していないこと
    const diagPath = "test-dir/campaign-test-33-diagnostic.json";
    expect(memoryStorage.exists(diagPath)).toBe(true);
    const diag = JSON.parse(memoryStorage.load(diagPath)!);
    expect(diag.status).toBe("REEVALUATION_REQUIRED");
    expect(diag.failedGeneration).toBe(1);
    expect(diag.canResume).toBe(true);
    expect(diag.lastValidCheckpointGeneration).toBe(1);
    expect(result.diagnosticInfo?.diagnosticFilePath).toBe(diagPath);
  });

  // ===========================================================================
  // Test 34: 実機 SessionFactory を使用した同一 totalGenerations 中断再開の完全性検証
  // ===========================================================================
  it("Test 34: executes live session interrupted run and resume with identical totalGenerations", () => {
    const memoryStorage = new InMemoryCampaignCheckpointStorage();
    const configBase: EvolutionCampaignConfig = {
      campaignId: "campaign-live-interrupt-v1",
      campaignSeed: 340001,
      totalGenerations: 2,
      initialPopulation: createTestPopulation(4, 0),
      validationOpponents: testOpponents,
      validationSeeds: [3401],
      sessionFactory: testSessionFactory,
      checkpointDir: "test-dir",
      checkpointStorage: memoryStorage,
      checkpointIntervalGenerations: 1,
      minimumCompletedPairs: 1,
      runnerConfig: {
        maxDecisionsPerMatch: 500,
        fitnessConfig: {
          minimumCompletedMatches: 1,
          minimumCompletionRate: 0.5,
        },
        builderConfig: {
          populationSize: 4,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 1,
          },
          geneticOperatorConfig: {
            mutationRate: 0.1,
            mutationSigma: 0.05,
            mutationClampMin: -1.0,
            mutationClampMax: 1.0,
            maxSelfMatingRetries: 5,
          },
        },
      },
      maxDecisionsPerMatch: 500,
    };

    // Step 1: 世代1まで実行して中断（totalGenerations = 1）
    const runPart1 = EvolutionCampaignManager.run({
      ...configBase,
      totalGenerations: 1,
    });
    expect(runPart1.status).toBe("COMPLETED");
    expect(runPart1.completedGenerations).toBe(1);

    const checkpointPath = "test-dir/campaign-live-interrupt-v1-checkpoint.json";
    expect(memoryStorage.exists(checkpointPath)).toBe(true);

    // Step 2: チェックポイントから再開して世代2まで完了 (allowCampaignExtension: true)
    const runPart2 = EvolutionCampaignManager.run({
      ...configBase,
      totalGenerations: 2,
      resumeFromCheckpointPath: checkpointPath,
      allowCampaignExtension: true,
    });
    expect(runPart2.status).toBe("COMPLETED");
    expect(runPart2.completedGenerations).toBe(2);

    // Step 3: 最初から世代2まで連続実行
    const memoryStorageCont = new InMemoryCampaignCheckpointStorage();
    const runContinuous = EvolutionCampaignManager.run({
      ...configBase,
      totalGenerations: 2,
      checkpointStorage: memoryStorageCont,
    });
    expect(runContinuous.status).toBe("COMPLETED");
    expect(runContinuous.completedGenerations).toBe(2);

    // 中断再開結果と連続実行結果が isEqualCampaignLogicalResult で完全一致すること
    expect(isEqualCampaignLogicalResult(runPart2.logicalResult, runContinuous.logicalResult)).toBe(true);
  });
});
