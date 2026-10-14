import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { EvolutionLoop } from "../../engine/ai/EvolutionLoop";
import {
  EvolutionLoopConfigurationError,
  EvolutionLoopIntegrityError,
  RunEvolutionLoopParams,
  canonicalGenerationStreamKey,
  canonicalLoopSeedScheduleIdentity,
} from "../../domain/ai/EvolutionLoopTypes";
import { GenerationRunner } from "../../engine/ai/GenerationRunner";
import {
  GenerationRunnerConfigurationError,
  GenerationRunnerEnvironmentContext,
  GenerationRunnerExecutionError,
  GenerationRunnerExecutionResult,
  GenerationRunnerIntegrityError,
} from "../../domain/ai/GenerationRunnerTypes";
import {
  ComparableEvaluationContext,
  PopulationEntry,
  PopulationSnapshot,
} from "../../domain/ai/PopulationSelectionTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { deriveSeed } from "../../engine/random/DeterministicShuffle";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";
import { GameSession } from "../../engine/session/GameSession";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Evolution Loop V1 Canonical 48-Test Suite (BP-SIM-AI-EVOLUTION-LOOP-V1)", () => {
  const defaultEnvironment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: "rules-vnext:playtest",
    regulationId: "light-entry16",
    frameId: "entry16",
    rulePackageVersion: "1.0.0",
  });

  const dummySessionFactory = (_ctx: BatchMatchContext): GameSession => {
    return {} as GameSession;
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

  const createComparableContext = (
    generation: number,
    generationSeed: number
  ): ComparableEvaluationContext => ({
    environmentRef: defaultEnvironment.environmentRef,
    regulationId: defaultEnvironment.regulationId,
    frameId: defaultEnvironment.frameId,
    rulePackageVersion: defaultEnvironment.rulePackageVersion,
    fitnessConfig: {
      minimumCompletedMatches: 1,
      minimumCompletionRate: 0.5,
    },
    generation,
    evaluationScheduleId: "double-round-robin-v1:r=1:max-decisions=500",
    seedScheduleIdentity: `evolution-evaluation-pair-v1:generation-seed=${generationSeed}`,
  });

  const createMockRunnerAdvancedResult = (
    sourceGeneration: number,
    generationSeed: number,
    options?: {
      populationSize?: number;
      nextPopulationSize?: number;
      distinctBuildPopulation?: boolean;
      manifestGeneration?: number;
      fitnessGeneration?: number;
      nextPopulationGeneration?: number;
      buildSourceGeneration?: number;
      buildTargetGeneration?: number;
      buildPopulationSize?: number;
      eliteCount?: number;
      offspringCount?: number;
    }
  ): GenerationRunnerExecutionResult => {
    const currentPopSize = options?.populationSize ?? 4;
    const targetPopSize = options?.nextPopulationSize ?? currentPopSize;
    const manifestGen = options?.manifestGeneration ?? sourceGeneration;
    const fitnessGen = options?.fitnessGeneration ?? sourceGeneration;
    const nextPopGen = options?.nextPopulationGeneration ?? sourceGeneration + 1;
    const buildSourceGen = options?.buildSourceGeneration ?? sourceGeneration;
    const buildTargetGen = options?.buildTargetGeneration ?? sourceGeneration + 1;
    const buildPopSize = options?.buildPopulationSize ?? targetPopSize;
    const eliteCount = options?.eliteCount ?? 1;
    const offspringCount = options?.offspringCount ?? (targetPopSize - eliteCount);

    const nextPop = createTestPopulation(targetPopSize, nextPopGen);
    const buildPop = options?.distinctBuildPopulation
      ? createTestPopulation(targetPopSize, nextPopGen)
      : nextPop;

    return {
      logicalResult: {
        status: "ADVANCED",
        manifest: {
          generation: manifestGen,
          populationSize: currentPopSize,
          pairRepetitions: 1,
          totalMatches: currentPopSize * (currentPopSize - 1),
          generationSeed,
          evaluationScheduleId: "double-round-robin-v1:r=1:max-decisions=500",
          seedScheduleIdentity: `evolution-evaluation-pair-v1:generation-seed=${generationSeed}`,
        },
        fitnessSnapshot: {
          generation: fitnessGen,
          context: createComparableContext(fitnessGen, generationSeed),
          entries: [],
        },
        nextPopulation: nextPop,
        buildResult: {
          population: buildPop,
          sourceGeneration: buildSourceGen,
          targetGeneration: buildTargetGen,
          generationSeed,
          selectionSeed: 12345,
          populationSize: buildPopSize,
          eliteCount,
          offspringCount,
          eliteGenomeIds: ["ind-g0-000"],
          offspringLineages: [],
        },
      },
      runtimeMetrics: {
        totalExecutionTimeMs: 10,
        matchExecutionElapsedMs: 8,
        matchesPerSecond: 100,
        totalDecisions: 50,
      },
    };
  };

  const createMockRunnerReevaluationResult = (
    sourceGeneration: number,
    generationSeed: number,
    options?: {
      reason?: string;
      manifestGeneration?: number;
      fitnessGeneration?: number;
    }
  ): GenerationRunnerExecutionResult => {
    const manifestGen = options?.manifestGeneration ?? sourceGeneration;
    const fitnessGen = options?.fitnessGeneration ?? sourceGeneration;
    const reason = options?.reason ?? "Insufficient eligible entries for selection";

    return {
      logicalResult: {
        status: "REEVALUATION_REQUIRED",
        manifest: {
          generation: manifestGen,
          populationSize: 4,
          pairRepetitions: 1,
          totalMatches: 12,
          generationSeed,
          evaluationScheduleId: "double-round-robin-v1:r=1:max-decisions=500",
          seedScheduleIdentity: `evolution-evaluation-pair-v1:generation-seed=${generationSeed}`,
        },
        fitnessSnapshot: {
          generation: fitnessGen,
          context: createComparableContext(fitnessGen, generationSeed),
          entries: [],
        },
        reason,
        readiness: {
          status: "REEVALUATION_REQUIRED",
          validCount: 1,
          requiredCount: 2,
          reason,
        },
      },
      runtimeMetrics: {
        totalExecutionTimeMs: 5,
        matchExecutionElapsedMs: 4,
        matchesPerSecond: 50,
        totalDecisions: 20,
      },
    };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Group A — Config & Seed Validation (Tests 1–10)
  // =========================================================================
  describe("Group A — Config & Seed Validation (Tests 1–10)", () => {
    it("Test 1: generationCount = 1 is legally accepted", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };

      const result = EvolutionLoop.run(params);
      expect(result.logicalResult.status).toBe("COMPLETED");
      expect(result.logicalResult.completedTransitions).toBe(1);
      expect(result.logicalResult.finalPopulation.generation).toBe(1);
    });

    it("Test 2: generationCount = 0 is rejected with EvolutionLoopConfigurationError", () => {
      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 0 },
      };

      expect(() => EvolutionLoop.run(params)).toThrow(EvolutionLoopConfigurationError);
    });

    it("Test 3: negative generationCount is rejected with EvolutionLoopConfigurationError", () => {
      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: -1 },
      };

      expect(() => EvolutionLoop.run(params)).toThrow(EvolutionLoopConfigurationError);
    });

    it("Test 4: fraction, NaN, Infinity generationCount are rejected with EvolutionLoopConfigurationError", () => {
      const baseParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
      };

      expect(() =>
        EvolutionLoop.run({ ...baseParams, config: { generationCount: 1.5 } })
      ).toThrow(EvolutionLoopConfigurationError);
      expect(() =>
        EvolutionLoop.run({ ...baseParams, config: { generationCount: NaN } })
      ).toThrow(EvolutionLoopConfigurationError);
      expect(() =>
        EvolutionLoop.run({ ...baseParams, config: { generationCount: Infinity } })
      ).toThrow(EvolutionLoopConfigurationError);
      expect(() =>
        EvolutionLoop.run({ ...baseParams, config: { generationCount: -Infinity } })
      ).toThrow(EvolutionLoopConfigurationError);
    });

    it("Test 5: campaignSeed = 0 is legally accepted", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 0,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };

      const result = EvolutionLoop.run(params);
      expect(result.logicalResult.manifest.campaignSeed).toBe(0);
    });

    it("Test 6: negative campaignSeed is legally accepted", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: -42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };

      const result = EvolutionLoop.run(params);
      expect(result.logicalResult.manifest.campaignSeed).toBe(-42);
    });

    it("Test 7: fraction, NaN, Infinity campaignSeed are rejected with EvolutionLoopConfigurationError", () => {
      const baseParams = {
        initialPopulation: createTestPopulation(4, 0),
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };

      expect(() =>
        EvolutionLoop.run({ ...baseParams, campaignSeed: 42.5 })
      ).toThrow(EvolutionLoopConfigurationError);
      expect(() =>
        EvolutionLoop.run({ ...baseParams, campaignSeed: NaN })
      ).toThrow(EvolutionLoopConfigurationError);
      expect(() =>
        EvolutionLoop.run({ ...baseParams, campaignSeed: Infinity })
      ).toThrow(EvolutionLoopConfigurationError);
      expect(() =>
        EvolutionLoop.run({ ...baseParams, campaignSeed: -Infinity })
      ).toThrow(EvolutionLoopConfigurationError);
    });

    it("Test 8: targetGeneration exact and unsafe integer rejected with EvolutionLoopConfigurationError", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const normalParams: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 2),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      };
      const normalResult = EvolutionLoop.run(normalParams);
      expect(normalResult.logicalResult.manifest.targetGeneration).toBe(5);

      const unsafeParams: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, Number.MAX_SAFE_INTEGER),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };
      expect(() => EvolutionLoop.run(unsafeParams)).toThrow(EvolutionLoopConfigurationError);
    });

    it("Test 9: Canonical Generation Stream Key (evolution-loop-generation-v1-${g}) generated exactly", () => {
      expect(canonicalGenerationStreamKey(0)).toBe("evolution-loop-generation-v1-0");
      expect(canonicalGenerationStreamKey(1)).toBe("evolution-loop-generation-v1-1");
      expect(canonicalGenerationStreamKey(42)).toBe("evolution-loop-generation-v1-42");
    });

    it("Test 10: Canonical Seed Vectors (42, 0, -1) match design document Section 7 exactly", () => {
      // campaignSeed 42
      expect(deriveSeed(42, "evolution-loop-generation-v1-0")).toBe(4143575905);
      expect(deriveSeed(42, "evolution-loop-generation-v1-1")).toBe(4126798286);
      expect(deriveSeed(42, "evolution-loop-generation-v1-2")).toBe(4110020667);

      // campaignSeed 0
      expect(deriveSeed(0, "evolution-loop-generation-v1-0")).toBe(1656168205);

      // campaignSeed -1
      expect(deriveSeed(-1, "evolution-loop-generation-v1-0")).toBe(3416915273);
    });
  });

  // =========================================================================
  // Group B — Seed Schedule Contract (Tests 11–17)
  // =========================================================================
  describe("Group B — Seed Schedule Contract (Tests 11–17)", () => {
    it("Test 11: same campaignSeed and sourceGeneration always yield identical generationSeed", () => {
      const seedA = deriveSeed(42, canonicalGenerationStreamKey(3));
      const seedB = deriveSeed(42, canonicalGenerationStreamKey(3));
      expect(seedA).toBe(seedB);
    });

    it("Test 12: generationSeed is directly derived from campaignSeed + sourceGeneration", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      };

      EvolutionLoop.run(params);

      expect(runnerSpy).toHaveBeenCalledTimes(3);
      expect(runnerSpy.mock.calls[0][0].generationSeed).toBe(
        deriveSeed(42, "evolution-loop-generation-v1-0")
      );
      expect(runnerSpy.mock.calls[1][0].generationSeed).toBe(
        deriveSeed(42, "evolution-loop-generation-v1-1")
      );
      expect(runnerSpy.mock.calls[2][0].generationSeed).toBe(
        deriveSeed(42, "evolution-loop-generation-v1-2")
      );
    });

    it("Test 13: generationSeed does not depend on chaining from previous generation seed", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 2 },
      };

      EvolutionLoop.run(params);

      const g1Seed = runnerSpy.mock.calls[1][0].generationSeed;
      expect(g1Seed).toBe(deriveSeed(42, "evolution-loop-generation-v1-1"));
      // Must NOT be derived from g0's seed
      const g0Seed = runnerSpy.mock.calls[0][0].generationSeed;
      expect(g1Seed).not.toBe(deriveSeed(g0Seed, "evolution-loop-generation-v1-1"));
    });

    it("Test 14: generationSeed schedule is independent from requested generationCount", () => {
      const seeds1: number[] = [];
      const seeds3: number[] = [];

      vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        seeds1.push(p.generationSeed);
        return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
      });

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      });

      vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        seeds3.push(p.generationSeed);
        return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
      });

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(seeds1[0]).toBe(seeds3[0]);
    });

    it("Test 15: g2 direct-start seed equals g0->g2 reached seed", () => {
      const reachedSeeds: number[] = [];
      const directSeeds: number[] = [];

      vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        reachedSeeds.push(p.generationSeed);
        return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
      });

      // g0 -> g1 -> g2 -> g3 (generationCount=3)
      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        directSeeds.push(p.generationSeed);
        return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
      });

      // Direct start at g=2
      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 2),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      });

      // Third call in reached run (index 2) is g=2
      expect(reachedSeeds[2]).toBe(directSeeds[0]);
      expect(directSeeds[0]).toBe(deriveSeed(42, "evolution-loop-generation-v1-2"));
    });

    it("Test 16: Loop Seed Schedule Identity is exact", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };

      const result = EvolutionLoop.run(params);
      expect(result.logicalResult.manifest.generationSeedScheduleIdentity).toBe(
        "evolution-loop-generation-v1:campaign-seed=42"
      );
      expect(canonicalLoopSeedScheduleIdentity(42)).toBe(
        "evolution-loop-generation-v1:campaign-seed=42"
      );
    });

    it("Test 17: no seed uniqueness assumption is encoded (duplicates do not throw)", () => {
      // Simulate multiple runner calls receiving duplicate seeds (e.g. hash collision scenario)
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      };

      // Ensure execution completes successfully without any "duplicate seed" error
      const result = EvolutionLoop.run(params);
      expect(result.logicalResult.status).toBe("COMPLETED");
      expect(result.logicalResult.completedTransitions).toBe(3);
    });
  });

  // =========================================================================
  // Group C — Successful Multi-Generation Transition & Population Contract (Tests 18–27)
  // =========================================================================
  describe("Group C — Successful Multi-Generation Transition & Population Contract (Tests 18–27)", () => {
    it("Test 18: generationCount = 1 calls GenerationRunner.run exactly once", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      });

      expect(runnerSpy).toHaveBeenCalledTimes(1);
    });

    it("Test 19: generationCount = 3 calls GenerationRunner.run exactly 3 times sequentially", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(runnerSpy).toHaveBeenCalledTimes(3);
    });

    it("Test 20: input population.generation advances g, g+1, g+2 on each call", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(runnerSpy.mock.calls[0][0].population.generation).toBe(0);
      expect(runnerSpy.mock.calls[1][0].population.generation).toBe(1);
      expect(runnerSpy.mock.calls[2][0].population.generation).toBe(2);
    });

    it("Test 21: identical environment context reference is passed to all Runner calls", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      for (let i = 0; i < 3; i++) {
        expect(runnerSpy.mock.calls[i][0].environment).toBe(defaultEnvironment);
      }
    });

    it("Test 22: identical sessionFactory reference is passed to all Runner calls", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      for (let i = 0; i < 3; i++) {
        expect(runnerSpy.mock.calls[i][0].sessionFactory).toBe(dummySessionFactory);
      }
    });

    it("Test 23: identical runnerConfig reference is passed unmodified without defaults merge or population rewrite", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const customRunnerConfig = Object.freeze({
        pairRepetitions: 2,
        maxDecisionsPerMatch: 300,
      });

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: {
          generationCount: 3,
          runnerConfig: customRunnerConfig,
        },
      });

      for (let i = 0; i < 3; i++) {
        expect(runnerSpy.mock.calls[i][0].config).toBe(customRunnerConfig);
      }
    });

    it("Test 24: previous nextPopulation is passed directly, preserving Variable N without truncation or padding", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        const sourceGen = p.population.generation;
        // Step 0: input N=2, output N=3
        // Step 1: input N=3, output N=5
        const nextSize = sourceGen === 0 ? 3 : 5;
        return createMockRunnerAdvancedResult(sourceGen, p.generationSeed, {
          populationSize: p.population.entries.length,
          nextPopulationSize: nextSize,
        });
      });

      const initialPop = createTestPopulation(2, 0); // N=2
      const result = EvolutionLoop.run({
        initialPopulation: initialPop,
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 2 },
      });

      // Call 0 received N=2
      expect(runnerSpy.mock.calls[0][0].population.entries.length).toBe(2);
      // Call 1 received N=3 (generated by Call 0)
      expect(runnerSpy.mock.calls[1][0].population.entries.length).toBe(3);
      // Final population has N=5 (generated by Call 1)
      expect(result.logicalResult.finalPopulation.entries.length).toBe(5);
    });

    it("Test 25: COMPLETED finalPopulation.generation strictly matches targetGeneration", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(result.logicalResult.finalPopulation.generation).toBe(3);
      expect(result.logicalResult.finalPopulation.generation).toBe(
        result.logicalResult.manifest.targetGeneration
      );
    });

    it("Test 26: generations history length strictly matches generationCount", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(result.logicalResult.generations.length).toBe(3);
    });

    it("Test 27: initialPopulation object is not mutated and preserves immutability", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const initialPop = createTestPopulation(4, 0);
      const cloneBefore = JSON.parse(JSON.stringify(initialPop));

      EvolutionLoop.run({
        initialPopulation: initialPop,
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(initialPop).toEqual(cloneBefore);
    });
  });

  // =========================================================================
  // Group D — REEVALUATION_REQUIRED Logical Stop (Tests 28–34)
  // =========================================================================
  describe("Group D — REEVALUATION_REQUIRED Logical Stop (Tests 28–34)", () => {
    it("Test 28: g0 REEVALUATION_REQUIRED causes immediate logical stop", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerReevaluationResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(runnerSpy).toHaveBeenCalledTimes(1);
      expect(result.logicalResult.status).toBe("REEVALUATION_REQUIRED");
      expect(result.logicalResult.completedTransitions).toBe(0);
      expect(result.logicalResult.generations.length).toBe(1);
    });

    it("Test 29: ADVANCED then REEVALUATION_REQUIRED yields completedTransitions = 1", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        if (p.population.generation === 0) {
          return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
        }
        return createMockRunnerReevaluationResult(p.population.generation, p.generationSeed);
      });

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(runnerSpy).toHaveBeenCalledTimes(2);
      expect(result.logicalResult.status).toBe("REEVALUATION_REQUIRED");
      expect(result.logicalResult.completedTransitions).toBe(1);
      expect(result.logicalResult.generations.length).toBe(2);
      expect(result.logicalResult.generations[0].status).toBe("ADVANCED");
      expect(result.logicalResult.generations[1].status).toBe("REEVALUATION_REQUIRED");
    });

    it("Test 30: no automatic retry on REEVALUATION_REQUIRED", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerReevaluationResult(p.population.generation, p.generationSeed)
      );

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(runnerSpy).toHaveBeenCalledTimes(1);
    });

    it("Test 31: no alternate seed retry on REEVALUATION_REQUIRED", () => {
      const calledSeeds: number[] = [];
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        calledSeeds.push(p.generationSeed);
        return createMockRunnerReevaluationResult(p.population.generation, p.generationSeed);
      });

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      expect(calledSeeds.length).toBe(1);
      expect(calledSeeds[0]).toBe(deriveSeed(42, "evolution-loop-generation-v1-0"));
    });

    it("Test 32: no subsequent GenerationRunner.run call after REEVALUATION_REQUIRED", () => {
      const runnerSpy = vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        if (p.population.generation === 0) {
          return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
        }
        return createMockRunnerReevaluationResult(p.population.generation, p.generationSeed);
      });

      EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 5 },
      });

      expect(runnerSpy).toHaveBeenCalledTimes(2);
    });

    it("Test 33: reason and readiness are preserved exactly in logical result", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerReevaluationResult(p.population.generation, p.generationSeed, {
          reason: "Custom test failure reason",
        })
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      });

      if (result.logicalResult.status !== "REEVALUATION_REQUIRED") {
        throw new Error("Expected REEVALUATION_REQUIRED");
      }
      expect(result.logicalResult.reason).toBe("Custom test failure reason");
      expect(result.logicalResult.readiness.reason).toBe("Custom test failure reason");
    });

    it("Test 34: finalPopulation is current unadvanced population on REEVALUATION_REQUIRED", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) => {
        if (p.population.generation === 0) {
          return createMockRunnerAdvancedResult(p.population.generation, p.generationSeed);
        }
        return createMockRunnerReevaluationResult(p.population.generation, p.generationSeed);
      });

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      });

      // Stopped at g=1 evaluation, so finalPopulation is g=1 population
      expect(result.logicalResult.finalPopulation.generation).toBe(1);
    });
  });

  // =========================================================================
  // Group E — Integrity Verification & Error Propagation (Tests 35–40)
  // =========================================================================
  describe("Group E — Integrity Verification & Error Propagation (Tests 35–40)", () => {
    it("Test 35: manifest generation mismatch throws EvolutionLoopIntegrityError", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed, {
          manifestGeneration: 999, // Mismatch!
        })
      );

      expect(() =>
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        })
      ).toThrow(EvolutionLoopIntegrityError);
    });

    it("Test 36: fitnessSnapshot generation mismatch throws EvolutionLoopIntegrityError", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed, {
          fitnessGeneration: 999, // Mismatch!
        })
      );

      expect(() =>
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        })
      ).toThrow(EvolutionLoopIntegrityError);
    });

    it("Test 37: ADVANCED next population generation mismatch throws EvolutionLoopIntegrityError", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed, {
          nextPopulationGeneration: 999, // Mismatch!
        })
      );

      expect(() =>
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        })
      ).toThrow(EvolutionLoopIntegrityError);
    });

    it("Test 38: build source/target/populationSize mismatch throws EvolutionLoopIntegrityError; distinct reference with valid Public Contract is ACCEPTED", () => {
      // Sub-case A: buildSourceGeneration mismatch
      vi.spyOn(GenerationRunner, "run").mockReturnValueOnce(
        createMockRunnerAdvancedResult(0, 42, { buildSourceGeneration: 999 })
      );
      expect(() =>
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        })
      ).toThrow(EvolutionLoopIntegrityError);

      // Sub-case B: buildTargetGeneration mismatch
      vi.spyOn(GenerationRunner, "run").mockReturnValueOnce(
        createMockRunnerAdvancedResult(0, 42, { buildTargetGeneration: 999 })
      );
      expect(() =>
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        })
      ).toThrow(EvolutionLoopIntegrityError);

      // Sub-case C: populationSize mismatch
      vi.spyOn(GenerationRunner, "run").mockReturnValueOnce(
        createMockRunnerAdvancedResult(0, 42, { buildPopulationSize: 999 })
      );
      expect(() =>
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        })
      ).toThrow(EvolutionLoopIntegrityError);

      // Sub-case D: distinct reference but valid Public Contract -> ACCEPTED!
      const distinctMock = createMockRunnerAdvancedResult(0, 42, {
        distinctBuildPopulation: true,
      });
      // Verify in test that buildResult.population !== nextPopulation
      expect(distinctMock.logicalResult.buildResult?.population).not.toBe(
        distinctMock.logicalResult.nextPopulation
      );

      vi.spyOn(GenerationRunner, "run").mockReturnValueOnce(distinctMock);
      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      });

      expect(result.logicalResult.status).toBe("COMPLETED");
      expect(result.logicalResult.finalPopulation.generation).toBe(1);
    });

    it("Test 39: GenerationRunnerExecutionError propagates unchanged as same error instance", () => {
      const runnerError = new GenerationRunnerExecutionError("Match crashed", {
        phase: "RUNNER",
        matchIndex: 0,
        p1GenomeId: "p1",
        p2GenomeId: "p2",
        causeName: "FatalCrash",
      });

      vi.spyOn(GenerationRunner, "run").mockImplementation(() => {
        throw runnerError;
      });

      try {
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBe(runnerError); // Exact same reference
      }
    });

    it("Test 40: GenerationRunnerConfigurationError and GenerationRunnerIntegrityError propagate unchanged as same error instance", () => {
      const configError = new GenerationRunnerConfigurationError("Invalid runner config");
      vi.spyOn(GenerationRunner, "run").mockImplementationOnce(() => {
        throw configError;
      });

      try {
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBe(configError);
      }

      const integrityError = new GenerationRunnerIntegrityError("Corrupt runner state");
      vi.spyOn(GenerationRunner, "run").mockImplementationOnce(() => {
        throw integrityError;
      });

      try {
        EvolutionLoop.run({
          initialPopulation: createTestPopulation(4, 0),
          campaignSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: dummySessionFactory,
          config: { generationCount: 1 },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBe(integrityError);
      }
    });
  });

  // =========================================================================
  // Group F — History, Determinism & Boundaries (Tests 41–48)
  // =========================================================================
  describe("Group F — History, Determinism & Boundaries (Tests 41–48)", () => {
    it("Test 41: history preserves fitnessSnapshot, manifest, and buildMetadata accurately", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      });

      const record = result.logicalResult.generations[0];
      if (record.status !== "ADVANCED") {
        throw new Error("Expected ADVANCED");
      }

      expect(record.manifest.generation).toBe(0);
      expect(record.fitnessSnapshot.generation).toBe(0);
      expect(record.buildMetadata.sourceGeneration).toBe(0);
      expect(record.buildMetadata.targetGeneration).toBe(1);
      expect(record.buildMetadata.populationSize).toBe(4);
      expect(record.buildMetadata.eliteCount).toBe(1);
      expect(record.buildMetadata.offspringCount).toBe(3);
      expect(record.buildMetadata.eliteGenomeIds).toEqual(["ind-g0-000"]);
    });

    it("Test 42: history does NOT retain intermediate PopulationSnapshot (buildMetadata only)", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 2 },
      });

      for (const record of result.logicalResult.generations) {
        expect("population" in record).toBe(false);
        expect("nextPopulation" in record).toBe(false);
        expect("buildResult" in record).toBe(false);
        if (record.status === "ADVANCED") {
          expect("buildMetadata" in record).toBe(true);
          expect("population" in record.buildMetadata).toBe(false);
        }
      }
    });

    it("Test 43: only finalPopulation is retained at root logical result", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 2 },
      });

      expect(result.logicalResult.finalPopulation).toBeDefined();
      expect(result.logicalResult.finalPopulation.generation).toBe(2);
    });

    it("Test 44: runtime metrics are separated from logical Deep Equal", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const params: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 1 },
      };

      const resultA = EvolutionLoop.run(params);
      const resultB = EvolutionLoop.run(params);

      // Logical results are deep equal
      expect(JSON.stringify(resultA.logicalResult)).toBe(
        JSON.stringify(resultB.logicalResult)
      );
      // Runtime metrics are separated top-level sidecars
      expect(resultA.runtimeMetrics).toBeDefined();
      expect(typeof resultA.runtimeMetrics.totalExecutionTimeMs).toBe("number");
    });

    it("Test 45: same deterministic inputs yield 100% Deep Equal logical result", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const paramsA: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      };

      const paramsB: RunEvolutionLoopParams = {
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 3 },
      };

      const resultA = EvolutionLoop.run(paramsA);
      const resultB = EvolutionLoop.run(paramsB);

      expect(resultA.logicalResult).toEqual(resultB.logicalResult);
    });

    it("Test 46: no timestamp, elapsed time, or UUID inside logical result", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 2 },
      });

      const manifestStr = JSON.stringify(result.logicalResult.manifest);
      expect(manifestStr).not.toMatch(/time|elapsed|duration|uuid|timestamp/i);
    });

    it("Test 47: no cross-generation fitness ranking, no early-stop fitness logic, no runtime feedback in core", () => {
      vi.spyOn(GenerationRunner, "run").mockImplementation((p) =>
        createMockRunnerAdvancedResult(p.population.generation, p.generationSeed)
      );

      const result = EvolutionLoop.run({
        initialPopulation: createTestPopulation(4, 0),
        campaignSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: dummySessionFactory,
        config: { generationCount: 2 },
      });

      const rootProps = Object.keys(result.logicalResult);
      expect(rootProps).not.toContain("fitnessDelta");
      expect(rootProps).not.toContain("improvementRate");
      expect(rootProps).not.toContain("convergence");
      expect(rootProps).not.toContain("historicalBest");
      expect(rootProps).not.toContain("rating");
      expect(rootProps).not.toContain("champion");
    });

    it("Test 48: EvolutionLoop uses GenerationRunner only and does not directly orchestrate SimulationRunner or GameSession", () => {
      const sourcePath = path.resolve(__dirname, "../../engine/ai/EvolutionLoop.ts");
      const source = fs.readFileSync(sourcePath, "utf-8");

      // Verify no direct imports of forbidden runtime primitives
      expect(source).not.toMatch(/from\s+["'].*SimulationRunner["']/);
      expect(source).not.toMatch(/from\s+["'].*GameSession["']/);
      expect(source).not.toMatch(/from\s+["'].*GenomePolicy["']/);
      expect(source).not.toMatch(/from\s+["'].*FitnessEvaluator["']/);
      expect(source).not.toMatch(/from\s+["'].*PopulationSelector["']/);
      expect(source).not.toMatch(/from\s+["'].*GenerationBuilder["']/);
      expect(source).not.toMatch(/from\s+["'].*GeneticOperators["']/);

      // Verify GenerationRunner is imported and called
      expect(source).toMatch(/GenerationRunner\.run/);
    });
  });
});
